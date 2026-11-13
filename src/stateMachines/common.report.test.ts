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
  resolveStatusError,
  toWireFailure
} from './common.js'
import { type ProvisioningFailure } from '../models/RCS.Config.js'

const wifiFailure: ProvisioningFailure = {
  Code: 'AMT_METHOD_FAILED',
  Component: 'WirelessNetwork',
  Step: 'ADD_WIFI_SETTINGS',
  Reason: 'AMT answered the request with a non-zero return value',
  AmtReturnValue: 2066
}

describe('toWireFailure', () => {
  it('keeps the HTTP status and detail of a device-origin failure', () => {
    const failure: ProvisioningFailure = {
      Code: 'WSMAN_BAD_REQUEST',
      Component: 'TLS',
      Step: 'ADD_CERTIFICATE',
      Reason: 'AMT rejected the WSMAN request as malformed (HTTP 400)',
      HttpStatus: 400,
      Detail: 'Bad Request'
    }
    expect(toWireFailure(failure)).toEqual(failure)
  })

  it('drops the HTTP status and detail of an RPS-side failure, which came from an internal service', () => {
    const wire = toWireFailure({
      Code: 'RPS_UNEXPECTED_ERROR',
      Component: 'Maintenance',
      Step: 'GET_DEVICE_FROM_MPS',
      Reason: 'An unexpected error occurred',
      HttpStatus: 404,
      Detail: 'http://mps:3000/api/v1/devices/abc'
    })
    expect(wire).not.toHaveProperty('HttpStatus')
    expect(wire).not.toHaveProperty('Detail')
  })
})

describe('componentFailureResult', () => {
  it('carries code, step and return value with the legacy details text', () => {
    expect(componentFailureResult(wifiFailure, 'Failed to add corp-wifi')).toEqual({
      Result: 'Failure',
      Details: 'Failed to add corp-wifi',
      Code: 'AMT_METHOD_FAILED',
      Step: 'ADD_WIFI_SETTINGS',
      AmtReturnValue: 2066,
      Reason: 'AMT answered the request with a non-zero return value'
    })
  })

  it('defaults details to the reason and omits a missing return value', () => {
    const { AmtReturnValue, ...noRv } = wifiFailure
    expect(componentFailureResult(noRv)).toEqual({
      Result: 'Failure',
      Details: wifiFailure.Reason,
      Code: 'AMT_METHOD_FAILED',
      Step: 'ADD_WIFI_SETTINGS',
      Reason: 'AMT answered the request with a non-zero return value'
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
      Code: 'AMT_METHOD_FAILED',
      Step: 'ADD_WIFI_SETTINGS',
      AmtReturnValue: 2066,
      Reason: 'AMT answered the request with a non-zero return value'
    })
  })

  it('carries the same fields as Status.Error: reason, HTTP status, WSMAN call and wire-safe detail', () => {
    const timeout: ProvisioningFailure = {
      Code: 'WSMAN_BAD_REQUEST',
      Component: 'TLS',
      Step: 'ADD_CERTIFICATE',
      Reason: 'AMT rejected the WSMAN request as malformed (HTTP 400)',
      HttpStatus: 400,
      WsmanCall: 'AMT_PublicKeyManagementService.AddCertificate',
      Detail: 'Bad Request'
    }
    recordComponentResult(clientId, 'TLS', componentFailureResult(timeout, 'Failed to add certificate'))
    expect(devices[clientId].status.Components?.TLS).toEqual({
      Result: 'Failure',
      Details: 'Failed to add certificate',
      Code: 'WSMAN_BAD_REQUEST',
      Step: 'ADD_CERTIFICATE',
      Reason: 'AMT rejected the WSMAN request as malformed (HTTP 400)',
      HttpStatus: 400,
      WsmanCall: 'AMT_PublicKeyManagementService.AddCertificate',
      Detail: 'Bad Request'
    })
  })

  it('keeps RPS-internal detail off the component, as it does for Status.Error', () => {
    const dbFailure: ProvisioningFailure = {
      Code: 'RPS_DB_PROFILE_READ_FAILED',
      Component: 'WiredNetwork',
      Step: 'GET_8021X_PROFILE',
      Reason: 'Profile could not be read from the database',
      Detail: 'connect ECONNREFUSED 10.0.0.5:5432'
    }
    expect(componentFailureResult(dbFailure, 'Failed')).not.toHaveProperty('Detail')
  })

  it('emits the structured log line and MQTT event for a failed component without setting Status.Error', () => {
    const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {})
    const mqttSpy = vi.spyOn(MqttProvider, 'publishEvent').mockImplementation((() => {}) as any)
    recordComponentResult(
      clientId,
      'WirelessNetwork',
      componentFailureResult(wifiFailure, 'Failed to add corp-wifi'),
      wifiFailure
    )
    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(errorSpy.mock.calls[0][0]).toContain('Provisioning failure: ')
    expect(errorSpy.mock.calls[0][0]).toContain('"Component":"WirelessNetwork"')
    expect(mqttSpy).toHaveBeenCalledTimes(1)
    expect(mqttSpy.mock.calls[0][0]).toBe('fail')
    // Marked as a component failure, so it is not read as the activation having failed.
    expect(errorSpy.mock.calls[0][0]).toContain('"scope":"component"')
    expect(mqttSpy.mock.calls[0][1]).toEqual(['activation', 'component'])
    expect(JSON.parse(mqttSpy.mock.calls[0][2] as string).scope).toBe('component')
    expect(devices[clientId].status.Error).toBeUndefined()
    errorSpy.mockRestore()
    mqttSpy.mockRestore()
  })

  it('emits nothing for a component result recorded without its failure, or for a Success', () => {
    const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {})
    const mqttSpy = vi.spyOn(MqttProvider, 'publishEvent').mockImplementation((() => {}) as any)
    recordComponentResult(clientId, 'Activation', componentFailureResult(wifiFailure, 'Failed'))
    recordComponentResult(clientId, 'TLS', { Result: 'Success', Details: 'ok' }, wifiFailure)
    expect(errorSpy).not.toHaveBeenCalled()
    expect(mqttSpy).not.toHaveBeenCalled()
    errorSpy.mockRestore()
    mqttSpy.mockRestore()
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
        Code: 'AMT_METHOD_FAILED',
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
      scope: 'flow',
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
      Code: 'RPS_DB_PROFILE_READ_FAILED',
      Component: 'Activation',
      Step: 'GET_AMT_PROFILE',
      Reason: 'AMT profile could not be read from the database',
      Detail: 'connect ECONNREFUSED db.internal:5432'
    }
    reportProvisioningFailure(logger, clientId, dbFailure, 'activation')

    expect(errorSpy.mock.calls[0][0]).toContain('db.internal:5432')
    const published = JSON.parse(mqttSpy.mock.calls[0][2])
    expect(published.Code).toBe('RPS_DB_PROFILE_READ_FAILED')
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
