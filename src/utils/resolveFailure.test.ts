/*********************************************************************
 * Copyright (c) Intel Corporation 2026
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { describe, expect, it } from 'vitest'
import { resolveFailure } from './resolveFailure.js'
import { GATEWAY_TIMEOUT_ERROR } from './constants.js'

describe('resolveFailure', () => {
  describe('resolution order', () => {
    it('reports a non-zero return value as AMT_METHOD_FAILED and carries the raw number', () => {
      const failure = resolveFailure('ADD_WIFI_SETTINGS', 'WirelessNetwork', { returnValue: 2066 })
      expect(failure).toEqual({
        Code: 'AMT_METHOD_FAILED',
        Component: 'WirelessNetwork',
        Step: 'ADD_WIFI_SETTINGS',
        Reason: 'AMT answered the request with a non-zero return value',
        AmtReturnValue: 2066
      })
    })

    it('keeps the step code over a non-zero return value and still carries the raw number', () => {
      const failure = resolveFailure('CHECK_ADMIN_SETUP', 'Activation', {
        code: 'RPS_ACTIVATION_FAILED',
        returnValue: 5
      })
      expect(failure.Code).toBe('RPS_ACTIVATION_FAILED')
      expect(failure.AmtReturnValue).toBe(5)
    })

    it('prefers a non-zero return value over a generic error, keeping the error text as detail', () => {
      const failure = resolveFailure('ADD_WIFI_SETTINGS', 'WirelessNetwork', {
        error: new Error('ReturnValue 2066'),
        returnValue: 2066
      })
      expect(failure.Code).toBe('AMT_METHOD_FAILED')
      expect(failure.AmtReturnValue).toBe(2066)
      expect(failure.Detail).toBe('ReturnValue 2066')
    })

    it('does not treat return value 0 as a failure source', () => {
      const failure = resolveFailure('STEP', 'CIRAConnection', {
        returnValue: 0,
        code: 'RPS_MPS_SAVE_DEVICE_FAILED'
      })
      expect(failure.Code).toBe('RPS_MPS_SAVE_DEVICE_FAILED')
      expect(failure.AmtReturnValue).toBeUndefined()
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
    it('lets a decoded return value win over the step code and keeps the error text as detail', () => {
      const failure = resolveFailure('ADD_PROXY_CONFIGS', 'CIRAProxy', {
        code: 'RPS_UNEXPECTED_ERROR',
        error: new Error('ReturnValue 2066'),
        returnValue: 2066,
        table: 'PT_STATUS'
      })
      expect(failure).toEqual({
        Code: 'AMT_PT_UNSUPPORTED',
        Component: 'CIRAProxy',
        Step: 'ADD_PROXY_CONFIGS',
        Reason: 'Operation or value is not supported by this AMT firmware',
        AmtReturnValue: 2066,
        Detail: 'ReturnValue 2066'
      })
    })

    it('decodes Setup / AdminSetup values with the host-based setup table, not PT_STATUS', () => {
      const failure = resolveFailure('CHECK_ADMIN_SETUP', 'Activation', {
        code: 'RPS_ACTIVATION_FAILED',
        returnValue: 3,
        table: 'HOST_BASED_SETUP'
      })
      expect(failure.Code).toBe('IPS_RV_INVALID_PARAMETER')
      expect(failure.AmtReturnValue).toBe(3)
    })

    it('decodes AddNextCertInChain values with its own table', () => {
      const failure = resolveFailure('CHECK_CERT_CHAIN_RESPONSE', 'Activation', {
        code: 'RPS_CERT_INVALID',
        returnValue: 4,
        table: 'ADD_NEXT_CERT_IN_CHAIN'
      })
      expect(failure.Code).toBe('IPS_RV_CERT_CHAIN_CERT_VERIFY_FAILED')
      expect(failure.Reason).toBe('AMT could not verify the certificate')
    })

    it('decodes CIM and WiFi port values with their tables', () => {
      expect(resolveFailure('S', 'CIRAConnection', { returnValue: 1, table: 'CIM' }).Code).toBe('CIM_RV_NOT_SUPPORTED')
      expect(resolveFailure('S', 'WirelessNetwork', { returnValue: 1, table: 'WIFI_PORT_CONFIGURATION' }).Code).toBe(
        'AMT_WIFI_NOT_SUPPORTED'
      )
    })

    it('keeps the step code and the raw number for a value the table does not list', () => {
      const failure = resolveFailure('CHECK_ADMIN_SETUP', 'Activation', {
        code: 'RPS_ACTIVATION_FAILED',
        returnValue: 2054,
        table: 'HOST_BASED_SETUP'
      })
      expect(failure.Code).toBe('RPS_ACTIVATION_FAILED')
      expect(failure.AmtReturnValue).toBe(2054)
      const noStepCode = resolveFailure('ADD_WIFI_SETTINGS', 'WirelessNetwork', {
        returnValue: 2066,
        table: 'WIFI_PORT_CONFIGURATION'
      })
      expect(noStepCode.Code).toBe('AMT_METHOD_FAILED')
      expect(noStepCode.AmtReturnValue).toBe(2066)
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
