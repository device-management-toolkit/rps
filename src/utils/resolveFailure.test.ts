/*********************************************************************
 * Copyright (c) Intel Corporation 2026
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { describe, expect, it } from 'vitest'
import { resolveFailure } from './resolveFailure.js'
import { GATEWAY_TIMEOUT_ERROR } from './constants.js'

describe('resolveFailure', () => {
  describe('resolution order', () => {
    it('prefers a non-zero return value over everything else', () => {
      const failure = resolveFailure('ADD_WIFI_SETTINGS', 'WirelessNetwork', {
        code: 'RPS_UNEXPECTED_ERROR',
        error: new Error('ignored for code'),
        returnValue: 2066
      })
      expect(failure.Code).toBe('AMT_PT_UNSUPPORTED')
      expect(failure.AmtReturnValue).toBe(2066)
      expect(failure.Reason).toBe('Operation or value is not supported by this AMT firmware')
      expect(failure.Detail).toBe('ignored for code')
    })

    it('does not treat return value 0 as a failure source', () => {
      const failure = resolveFailure('STEP', 'CIRAConnection', {
        returnValue: 0,
        code: 'RPS_MPS_SAVE_DEVICE_FAILED'
      })
      expect(failure.Code).toBe('RPS_MPS_SAVE_DEVICE_FAILED')
      expect(failure.AmtReturnValue).toBeUndefined()
    })

    it('uses the CIM namespace when asked', () => {
      const failure = resolveFailure('WIFI_PORT_STATE', 'WirelessNetwork', {
        returnValue: 4,
        namespace: 'CIM'
      })
      expect(failure.Code).toBe('CIM_RV_FAILED')
      expect(failure.AmtReturnValue).toBe(4)
    })

    it('keeps the step code over an HTTP-status error but still captures HTTP status and detail', () => {
      const failure = resolveFailure('SAVE_DEVICE_TO_MPS', 'Activation', {
        code: 'RPS_MPS_SAVE_DEVICE_FAILED',
        error: { statusCode: 404, statusMessage: 'Not Found' }
      })
      expect(failure.Code).toBe('RPS_MPS_SAVE_DEVICE_FAILED')
      expect(failure.HttpStatus).toBe(404)
      expect(failure.Detail).toBe('Not Found')
    })

    it('lets a transport-class error win over the step code', () => {
      const failure = resolveFailure('GET_GENERAL_SETTINGS', 'Activation', {
        code: 'RPS_ACTIVATION_FAILED',
        error: new GATEWAY_TIMEOUT_ERROR()
      })
      expect(failure.Code).toBe('WSMAN_TIMEOUT')
      expect(failure.Detail).toBe('Gateway Timeout')
    })

    it('maps an HTTP-status error to a WSMAN code when the step gives no code', () => {
      const failure = resolveFailure('GET_GENERAL_SETTINGS', 'Activation', {
        error: { statusCode: 401, statusMessage: 'Unauthorized' }
      })
      expect(failure.Code).toBe('WSMAN_AUTH_FAILED')
      expect(failure.HttpStatus).toBe(401)
    })

    it('uses the step code when the error maps only to a generic code, keeping the error text as detail', () => {
      const failure = resolveFailure('SAVE_DEVICE_TO_MPS', 'Activation', {
        code: 'RPS_MPS_SAVE_DEVICE_FAILED',
        error: new Error('connect ECONNREFUSED')
      })
      expect(failure.Code).toBe('RPS_MPS_SAVE_DEVICE_FAILED')
      expect(failure.Reason).toBe('Device information could not be saved to MPS')
      expect(failure.Detail).toBe('connect ECONNREFUSED')
    })

    it('derives the code from the error when no code is given', () => {
      const failure = resolveFailure('COMMIT_CHANGES', 'Activation', { error: new GATEWAY_TIMEOUT_ERROR() })
      expect(failure).toEqual({
        Code: 'WSMAN_TIMEOUT',
        Component: 'Activation',
        Step: 'COMMIT_CHANGES',
        Reason: 'Timed out waiting for a WSMAN response from AMT',
        Detail: 'Gateway Timeout'
      })
    })

    it('falls back to the unexpected-error code', () => {
      const failure = resolveFailure('STEP', 'Maintenance')
      expect(failure.Code).toBe('RPS_UNEXPECTED_ERROR')
      expect(failure.Detail).toBeUndefined()
      expect(failure.HttpStatus).toBeUndefined()
    })
  })

  describe('return value tables', () => {
    it('decodes IPS_HostBasedSetupService values with the IPS table, not PT_STATUS', () => {
      // 3 is PT_STATUS_INVALID_PT_MODE in the AMT table; for Setup / AdminSetup it means invalid parameter.
      const failure = resolveFailure('CHECK_ADMIN_SETUP', 'Activation', {
        code: 'RPS_ACTIVATION_FAILED',
        returnValue: 3,
        namespace: 'IPS'
      })
      expect(failure.Code).toBe('IPS_RV_INVALID_PARAMETER')
      expect(failure.AmtReturnValue).toBe(3)
      expect(resolveFailure('S', 'Activation', { returnValue: 5, namespace: 'IPS' }).Code).toBe(
        'IPS_RV_AUTHENTICATION_FAILED'
      )
      // Outside the service's own range the value is a PT_STATUS code.
      expect(resolveFailure('S', 'Activation', { returnValue: 2054, namespace: 'IPS' }).Code).toBe(
        'AMT_PT_INVALID_PASSWORD'
      )
    })

    it('decodes AddWiFiSettings values 1-4 with the WiFi table and falls back to PT_STATUS', () => {
      const own = resolveFailure('ADD_WIFI_SETTINGS', 'WirelessNetwork', { returnValue: 1, namespace: 'WIFI' })
      expect(own.Code).toBe('AMT_WIFI_NOT_SUPPORTED')
      const pt = resolveFailure('ADD_WIFI_SETTINGS', 'WirelessNetwork', { returnValue: 2066, namespace: 'WIFI' })
      expect(pt.Code).toBe('AMT_PT_UNSUPPORTED')
    })

    it('keeps the step code and carries the raw number when no table is trusted', () => {
      const failure = resolveFailure('CHECK_CERT_CHAIN_RESPONSE', 'Activation', {
        code: 'RPS_CERT_INVALID',
        returnValue: 4,
        namespace: 'UNMAPPED'
      })
      expect(failure.Code).toBe('RPS_CERT_INVALID')
      expect(failure.AmtReturnValue).toBe(4)
    })
  })

  it('does not read a stale successful HTTP response as an HTTP failure', () => {
    const failure = resolveFailure('ADD_NEXT_CERT_IN_CHAIN', 'Activation', {
      error: { statusCode: 200, statusMessage: 'OK' }
    })
    expect(failure.HttpStatus).toBeUndefined()
    expect(failure.Code).toBe('RPS_UNEXPECTED_ERROR')
  })
})
