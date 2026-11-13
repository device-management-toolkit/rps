/*********************************************************************
 * Copyright (c) Intel Corporation 2026
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { devices } from '../devices.js'
import Logger from '../Logger.js'
import { MqttProvider } from '../utils/MqttProvider.js'
import {
  componentFailureResult,
  recordComponentResult,
  reportProvisioningFailure,
  resolveStatusError
} from './common.js'
import { type ProvisioningFailure } from '../models/RCS.Config.js'

const wifiFailure: ProvisioningFailure = {
  Code: 'AMT_PT_UNSUPPORTED',
  Component: 'WirelessNetwork',
  Step: 'ADD_WIFI_SETTINGS',
  Reason: 'Operation or value is not supported by this AMT firmware',
  AmtReturnValue: 2066
}

describe('componentFailureResult', () => {
  it('carries code, step and return value with the legacy details text', () => {
    expect(componentFailureResult(wifiFailure, 'Failed to add corp-wifi')).toEqual({
      Result: 'Failure',
      Details: 'Failed to add corp-wifi',
      Code: 'AMT_PT_UNSUPPORTED',
      Step: 'ADD_WIFI_SETTINGS',
      AmtReturnValue: 2066
    })
  })

  it('defaults details to the reason and omits a missing return value', () => {
    const { AmtReturnValue, ...noRv } = wifiFailure
    expect(componentFailureResult(noRv)).toEqual({
      Result: 'Failure',
      Details: wifiFailure.Reason,
      Code: 'AMT_PT_UNSUPPORTED',
      Step: 'ADD_WIFI_SETTINGS'
    })
  })

  it('degrades to a plain failure when no structured failure is available', () => {
    expect(componentFailureResult(undefined, 'Failed')).toEqual({ Result: 'Failure', Details: 'Failed' })
    expect(componentFailureResult(undefined)).toEqual({ Result: 'Failure' })
  })
})

describe('recordComponentResult with failure codes', () => {
  const clientId = randomUUID()
  beforeEach(() => {
    devices[clientId] = { ClientId: clientId, status: {} } as any
  })

  it('keeps Code, Step and AmtReturnValue on a Failure', () => {
    recordComponentResult(clientId, 'WirelessNetwork', componentFailureResult(wifiFailure, 'Failed to add corp-wifi.'))
    expect(devices[clientId].status.Components?.WirelessNetwork).toEqual({
      Result: 'Failure',
      Details: 'Failed to add corp-wifi',
      Code: 'AMT_PT_UNSUPPORTED',
      Step: 'ADD_WIFI_SETTINGS',
      AmtReturnValue: 2066
    })
  })

  it('drops failure fields on a Success so they cannot leak from a retry', () => {
    recordComponentResult(clientId, 'TLS', { Result: 'Success', Details: 'ok', Code: 'X', Step: 'Y' } as any)
    expect(devices[clientId].status.Components?.TLS).toEqual({ Result: 'Success', Details: 'Ok' })
  })
})

describe('resolveStatusError', () => {
  const clientId = randomUUID()
  const fallback = { component: 'Activation' as const, code: 'RPS_ACTIVATION_FAILED', message: 'Failed' }
  beforeEach(() => {
    devices[clientId] = { ClientId: clientId, status: {} } as any
  })

  it('prefers the structured failure from context', () => {
    devices[clientId].status.Components = { TLS: { Result: 'Failure', Code: 'OTHER', Step: 'S' } }
    expect(resolveStatusError(clientId, wifiFailure, fallback)).toEqual(wifiFailure)
  })

  it('does not blame a failed component, because component failures never end the flow', () => {
    devices[clientId].status.Components = {
      Activation: { Result: 'Success' },
      WirelessNetwork: {
        Result: 'Failure',
        Details: 'Failed to add wifi settings',
        Code: 'AMT_PT_UNSUPPORTED',
        Step: 'ADD_WIFI_SETTINGS',
        AmtReturnValue: 2066
      }
    }
    expect(resolveStatusError(clientId, undefined, fallback)).toEqual({
      Code: 'RPS_ACTIVATION_FAILED',
      Component: 'Activation',
      Step: 'UNKNOWN',
      Reason: 'Failed'
    })
  })

  it('synthesizes from the legacy text when nothing structured exists', () => {
    expect(resolveStatusError(clientId, undefined, fallback)).toEqual({
      Code: 'RPS_ACTIVATION_FAILED',
      Component: 'Activation',
      Step: 'UNKNOWN',
      Reason: 'Failed'
    })
    expect(resolveStatusError(clientId, undefined, { ...fallback, message: '' }).Reason).toBe(
      'Device activation failed'
    )
  })
})

describe('reportProvisioningFailure', () => {
  const clientId = randomUUID()
  let logger: Logger
  let mqttSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    devices[clientId] = {
      ClientId: clientId,
      uuid: 'device-uuid',
      hostname: 'host-1',
      status: { Status: 'Failed to add corp-wifi' },
      wsmanDiagnostics: {
        attempts: 3,
        retriesUsed: 2,
        errorType: 'GatewayTimeoutError',
        tunnelState: 'none',
        sessionId: 'none',
        tunnelNeedsReset: false,
        amtReconfiguring: false
      }
    } as any
    logger = new Logger('test')
    mqttSpy = vi.spyOn(MqttProvider, 'publishEvent').mockImplementation(() => undefined)
  })

  it('sets status.Error, logs one structured line and publishes an MQTT event with the same content', () => {
    const errorSpy = vi.spyOn(logger, 'error')
    reportProvisioningFailure(logger, clientId, wifiFailure, 'activation')

    expect(devices[clientId].status.Error).toEqual(wifiFailure)

    expect(errorSpy).toHaveBeenCalledTimes(1)
    const line = errorSpy.mock.calls[0][0]
    expect(line.startsWith('Provisioning failure: ')).toBe(true)
    const record = JSON.parse(line.replace('Provisioning failure: ', ''))
    expect(record).toMatchObject({
      flow: 'activation',
      clientId,
      uuid: 'device-uuid',
      hostname: 'host-1',
      ...wifiFailure,
      wsman: { attempts: 3, retriesUsed: 2, errorType: 'GatewayTimeoutError' }
    })

    expect(mqttSpy).toHaveBeenCalledWith(
      'fail',
      ['activation'],
      line.replace('Provisioning failure: ', ''),
      'device-uuid'
    )
  })

  it('keeps RPS-internal detail in the log line but out of the MQTT event', () => {
    const errorSpy = vi.spyOn(logger, 'error')
    const dbFailure: ProvisioningFailure = {
      Code: 'RPS_DB_PROFILE_NOT_FOUND',
      Component: 'Activation',
      Step: 'GET_AMT_PROFILE',
      Reason: 'AMT profile could not be read from the database',
      Detail: 'connect ECONNREFUSED db.internal:5432'
    }
    reportProvisioningFailure(logger, clientId, dbFailure, 'activation')

    expect(errorSpy.mock.calls[0][0]).toContain('db.internal:5432')
    const published = JSON.parse(mqttSpy.mock.calls[0][2])
    expect(published.Code).toBe('RPS_DB_PROFILE_NOT_FOUND')
    expect(published.Detail).toBeUndefined()
    expect(mqttSpy.mock.calls[0][2]).not.toContain('db.internal')
  })

  it('does not leave an unhandled rejection when the MQTT publish fails', async () => {
    mqttSpy.mockImplementation(async () => await Promise.reject(new Error('broker down')))
    const warnSpy = vi.spyOn(logger, 'warn')
    expect(() => reportProvisioningFailure(logger, clientId, wifiFailure, 'activation')).not.toThrow()
    await new Promise((resolve) => setImmediate(resolve))
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('broker down'))
  })

  it('never throws, even for an unknown device', () => {
    expect(() => reportProvisioningFailure(logger, 'missing', wifiFailure, 'deactivation')).not.toThrow()
  })

  it('swallows reporting errors', () => {
    mqttSpy.mockImplementation(() => {
      throw new Error('mqtt down')
    })
    const warnSpy = vi.spyOn(logger, 'warn')
    expect(() => reportProvisioningFailure(logger, clientId, wifiFailure, 'maintenance')).not.toThrow()
    expect(warnSpy).toHaveBeenCalled()
    expect(devices[clientId].status.Error).toEqual(wifiFailure)
  })
})
