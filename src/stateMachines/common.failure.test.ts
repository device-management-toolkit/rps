/*********************************************************************
 * Copyright (c) Intel Corporation 2026
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { describe, expect, it } from 'vitest'
import { assign, createActor, setup } from 'xstate'
import { buildFailure, failAt, returnValueOf } from './common.js'
import { GATEWAY_TIMEOUT_ERROR } from '../utils/constants.js'

describe('returnValueOf', () => {
  it('reads a numeric ReturnValue for the named method', () => {
    const output = { Envelope: { Body: { AddWiFiSettings_OUTPUT: { ReturnValue: 2066 } } } }
    expect(returnValueOf(output, 'AddWiFiSettings')).toBe(2066)
  })

  it('coerces a numeric string', () => {
    const output = { Envelope: { Body: { AddWiFiSettings_OUTPUT: { ReturnValue: '0' } } } }
    expect(returnValueOf(output, 'AddWiFiSettings')).toBe(0)
  })

  it('returns undefined when the output or value is missing', () => {
    expect(returnValueOf(undefined, 'AddWiFiSettings')).toBeUndefined()
    expect(returnValueOf({ Envelope: { Body: {} } }, 'AddWiFiSettings')).toBeUndefined()
    expect(
      returnValueOf({ Envelope: { Body: { Other_OUTPUT: { ReturnValue: 1 } } } }, 'AddWiFiSettings')
    ).toBeUndefined()
    expect(returnValueOf({ Envelope: { Body: { X_OUTPUT: { ReturnValue: 'abc' } } } }, 'X')).toBeUndefined()
  })
})

describe('buildFailure', () => {
  it('uses the legacy message when provided and resolves the code from the error', () => {
    const { failure, message } = buildFailure(
      'GET_GENERAL_SETTINGS',
      'Activation',
      { message: 'Failed to get general settings', error: ({ event }) => event.error },
      { context: {}, event: { error: new GATEWAY_TIMEOUT_ERROR() } }
    )
    expect(message).toBe('Failed to get general settings')
    expect(failure.Code).toBe('WSMAN_TIMEOUT')
    expect(failure.Step).toBe('GET_GENERAL_SETTINGS')
    expect(failure.Component).toBe('Activation')
  })

  it('accepts a message function', () => {
    const { message } = buildFailure(
      'STEP',
      'TLS',
      { code: 'RPS_CERT_INVALID', message: ({ context }) => `bad cert for ${context.uuid}` },
      { context: { uuid: 'abc' }, event: {} }
    )
    expect(message).toBe('bad cert for abc')
  })

  it('defaults the message to the catalog reason', () => {
    const { message } = buildFailure('STEP', 'TLS', { code: 'RPS_CERT_INVALID' }, { context: {}, event: {} })
    expect(message).toBe('Provisioning certificate is not valid for this device')
  })

  it('maps a method return value through the requested namespace', () => {
    const output = { Envelope: { Body: { RequestStateChange_OUTPUT: { ReturnValue: 1 } } } }
    const { failure } = buildFailure(
      'WIFI_PORT_STATE_CHANGE',
      'WirelessNetwork',
      { returnValue: ({ event }) => returnValueOf(event.output, 'RequestStateChange'), namespace: 'CIM' },
      { context: {}, event: { output } }
    )
    expect(failure.Code).toBe('CIM_RV_NOT_SUPPORTED')
    expect(failure.AmtReturnValue).toBe(1)
  })
})

describe('failAt', () => {
  it('returns an assigner that sets errorMessage and failure', () => {
    const assigner = failAt('SAVE_DEVICE_TO_MPS', 'Activation', {
      code: 'RPS_MPS_SAVE_DEVICE_FAILED',
      message: 'Failed to save device information to MPS'
    })
    const result = assigner({ context: {}, event: {} })
    expect(result).toEqual({
      errorMessage: 'Failed to save device information to MPS',
      failure: {
        Code: 'RPS_MPS_SAVE_DEVICE_FAILED',
        Component: 'Activation',
        Step: 'SAVE_DEVICE_TO_MPS',
        Reason: 'Device information could not be saved to MPS'
      }
    })
  })

  it('can target statusMessage for machines that report through it', () => {
    const result = failAt('ADD_MPS', 'CIRAConnection', {
      code: 'WSMAN_REQUEST_FAILED',
      message: 'Failed to add mps',
      assignTo: 'statusMessage'
    })({ context: {}, event: {} })
    expect(result.statusMessage).toBe('Failed to add mps')
    expect(result.errorMessage).toBeUndefined()
    expect((result.failure as any).Code).toBe('WSMAN_REQUEST_FAILED')
  })

  it('works as an xstate assign action on a real machine', () => {
    interface Ctx {
      errorMessage?: string
      failure?: any
    }
    const machine = setup({
      types: {} as { context: Ctx; events: { type: 'FAIL'; error: unknown } }
    }).createMachine({
      context: {},
      initial: 'idle',
      states: {
        idle: {
          on: {
            FAIL: {
              actions: assign(
                failAt('GET_AMT_PROFILE', 'Activation', {
                  message: 'Failed to get amt profile from database',
                  error: ({ event }) => event.error
                })
              ),
              target: 'failed'
            }
          }
        },
        failed: { type: 'final' }
      }
    })
    const actor = createActor(machine).start()
    actor.send({ type: 'FAIL', error: new Error('connection refused') })
    const snapshot = actor.getSnapshot()
    expect(snapshot.value).toBe('failed')
    expect(snapshot.context.errorMessage).toBe('Failed to get amt profile from database')
    expect(snapshot.context.failure).toEqual({
      Code: 'RPS_UNEXPECTED_ERROR',
      Component: 'Activation',
      Step: 'GET_AMT_PROFILE',
      Reason: 'An unexpected error occurred',
      Detail: 'connection refused'
    })
  })
})
