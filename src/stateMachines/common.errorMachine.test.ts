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
  buildFailure,
  failureAfterErrorMachine,
  reportProvisioningFailure,
  stepFailure,
  toWireFailure
} from './common.js'
import { type ProvisioningFailure } from '../models/RCS.Config.js'
import { GATEWAY_TIMEOUT_ERROR } from '../utils/constants.js'

const clientId = randomUUID()

beforeEach(() => {
  devices[clientId] = { ClientId: clientId, uuid: 'device-uuid', status: {} } as any
})

describe('stepFailure', () => {
  it('records the step, the thrown error and the WSMAN call that was in flight', () => {
    devices[clientId].lastWsmanCall = 'IPS_HostBasedSetupService.AddNextCertInChain'
    devices[clientId].wsmanCallFailed = true
    const failure = stepFailure(
      'ADD_NEXT_CERT_IN_CHAIN',
      'Activation'
    )({
      context: { clientId },
      event: { error: new GATEWAY_TIMEOUT_ERROR() }
    })
    expect(failure).toEqual({
      Code: 'WSMAN_TIMEOUT',
      Component: 'Activation',
      Step: 'ADD_NEXT_CERT_IN_CHAIN',
      Reason: 'Timed out waiting for a WSMAN response from AMT',
      Detail: 'Gateway Timeout',
      WsmanCall: 'IPS_HostBasedSetupService.AddNextCertInChain'
    })
  })

  it('maps an HTTP error from AMT and keeps its status', () => {
    const failure = stepFailure(
      'GET_GENERAL_SETTINGS',
      'Activation'
    )({
      context: { clientId },
      event: { error: { statusCode: 401, statusMessage: 'Unauthorized' } }
    })
    expect(failure.Code).toBe('WSMAN_AUTH_FAILED')
    expect(failure.HttpStatus).toBe(401)
    expect(failure.Step).toBe('GET_GENERAL_SETTINGS')
  })
})

describe('buildFailure WsmanCall', () => {
  it('names the call for a non-zero method return value', () => {
    devices[clientId].lastWsmanCall = 'AMT_WiFiPortConfigurationService.AddWiFiSettings'
    const { failure } = buildFailure(
      'ADD_WIFI_SETTINGS',
      'WirelessNetwork',
      { returnValue: () => 2066 },
      { context: { clientId }, event: {} }
    )
    expect(failure.WsmanCall).toBe('AMT_WiFiPortConfigurationService.AddWiFiSettings')
  })

  it('does not blame an earlier successful call for a transport error raised by another step', () => {
    devices[clientId].lastWsmanCall = 'AMT_GeneralSettings.Get'
    devices[clientId].wsmanCallFailed = false
    const { failure } = buildFailure(
      'INIT_TLS_TUNNEL',
      'Activation',
      { error: () => new GATEWAY_TIMEOUT_ERROR() },
      { context: { clientId }, event: {} }
    )
    expect(failure.Code).toBe('WSMAN_TIMEOUT')
    expect(failure.WsmanCall).toBeUndefined()
  })

  it('does not attach the last call to an RPS-side failure', () => {
    devices[clientId].lastWsmanCall = 'AMT_GeneralSettings.Get'
    const { failure } = buildFailure(
      'GET_AMT_PROFILE',
      'Activation',
      { code: 'RPS_DB_PROFILE_NOT_FOUND', error: () => new Error('connect ECONNREFUSED 10.0.0.5:5432') },
      { context: { clientId }, event: {} }
    )
    expect(failure.WsmanCall).toBeUndefined()
  })
})

describe('failureAfterErrorMachine', () => {
  const fromErrorMachine: ProvisioningFailure = {
    Code: 'WSMAN_AUTH_FAILED',
    Component: 'Activation',
    Step: 'UNAUTHORIZED',
    Reason: 'AMT rejected the digest credentials (HTTP 401)',
    HttpStatus: 401
  }

  it('keeps the failure recorded at the failing step over the error machine one', () => {
    const recorded: ProvisioningFailure = {
      ...fromErrorMachine,
      Component: 'TimeSync',
      Step: 'GET_LOW_ACCURACY_TIME_SYNCH'
    }
    const failure = failureAfterErrorMachine('TimeSync', {
      context: { clientId, failure: recorded },
      event: { failure: fromErrorMachine }
    })
    expect(failure).toBe(recorded)
  })

  it('falls back to the error machine failure, re-homed to the invoking component', () => {
    const failure = failureAfterErrorMachine('Deactivation', {
      context: { clientId },
      event: { failure: fromErrorMachine }
    })
    expect(failure).toEqual({ ...fromErrorMachine, Component: 'Deactivation' })
  })

  it('derives a failure from the last response when nothing structured exists', () => {
    const failure = failureAfterErrorMachine('TLS', {
      context: { clientId, message: { statusCode: 400, statusMessage: 'Bad Request' } },
      event: {}
    })
    expect(failure).toMatchObject({ Code: 'WSMAN_BAD_REQUEST', Component: 'TLS', Step: 'ERROR', HttpStatus: 400 })
  })
})

describe('wire-safe failure', () => {
  const internal: ProvisioningFailure = {
    Code: 'RPS_SECRETS_WRITE_FAILED',
    Component: 'Activation',
    Step: 'SAVE_DEVICE_TO_SECRET_PROVIDER',
    Reason: 'Secret could not be written to the secret provider',
    Detail: 'connect ECONNREFUSED vault.internal:8200'
  }
  const fromDevice: ProvisioningFailure = {
    Code: 'WSMAN_BAD_REQUEST',
    Component: 'TLS',
    Step: 'ADD_CERTIFICATE',
    Reason: 'AMT rejected the WSMAN request as malformed (HTTP 400)',
    HttpStatus: 400,
    Detail: 'Bad Request'
  }

  it('drops Detail for RPS-side codes and keeps it for device-origin codes', () => {
    expect(toWireFailure(internal).Detail).toBeUndefined()
    expect(toWireFailure(internal).Code).toBe('RPS_SECRETS_WRITE_FAILED')
    expect(toWireFailure(fromDevice)).toEqual(fromDevice)
    // the original is not mutated: the log line still needs the detail
    expect(internal.Detail).toBe('connect ECONNREFUSED vault.internal:8200')
  })

  it('sends the wire-safe failure to the device but logs the full one', () => {
    vi.spyOn(MqttProvider, 'publishEvent').mockImplementation(() => undefined)
    const logger = new Logger('test')
    const errorSpy = vi.spyOn(logger, 'error')

    const wire = reportProvisioningFailure(logger, clientId, internal, 'maintenance', 'synctime')

    expect(wire.Detail).toBeUndefined()
    expect(devices[clientId].status.Error).toEqual(wire)
    const record = JSON.parse(errorSpy.mock.calls[0][0].replace('Provisioning failure: ', ''))
    expect(record).toMatchObject({ flow: 'maintenance', task: 'synctime', Detail: internal.Detail })
  })

  it('reports transport diagnostics once and then clears them', () => {
    vi.spyOn(MqttProvider, 'publishEvent').mockImplementation(() => undefined)
    const logger = new Logger('test')
    const errorSpy = vi.spyOn(logger, 'error')
    devices[clientId].wsmanDiagnostics = {
      attempts: 3,
      retriesUsed: 2,
      errorType: 'GatewayTimeoutError',
      tunnelState: 'none',
      sessionId: 'none',
      tunnelNeedsReset: false,
      amtReconfiguring: false
    }

    reportProvisioningFailure(logger, clientId, fromDevice, 'activation')

    expect(JSON.parse(errorSpy.mock.calls[0][0].replace('Provisioning failure: ', '')).wsman.attempts).toBe(3)
    expect(devices[clientId].wsmanDiagnostics).toBeUndefined()
  })
})
