/*********************************************************************
 * Copyright (c) Intel Corporation 2026
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { describe, expect, it } from 'vitest'
import { describeCode, ErrorCodes, fromError, isDeviceOriginCode } from './errorCatalog.js'
import {
  CONNECTION_RESET_ERROR,
  EA_TIMEOUT_ERROR,
  GATEWAY_TIMEOUT_ERROR,
  TLS_TUNNEL_ERROR,
  UNEXPECTED_PARSE_ERROR
} from './constants.js'
import { RPSError } from './RPSError.js'

describe('errorCatalog', () => {
  describe('describeCode', () => {
    it('describes every code in the catalog', () => {
      for (const code of Object.values(ErrorCodes)) {
        const description = describeCode(code)
        expect(description).not.toContain('Unrecognized')
        expect(description.length).toBeGreaterThan(0)
      }
    })

    it('falls back for an unknown code', () => {
      expect(describeCode('NOPE')).toBe('Unrecognized failure code NOPE')
    })
  })

  describe('isDeviceOriginCode', () => {
    it('is true for what the device reported and false for RPS-side codes', () => {
      expect(isDeviceOriginCode(ErrorCodes.AMT_METHOD_FAILED)).toBe(true)
      expect(isDeviceOriginCode(ErrorCodes.WSMAN_TIMEOUT)).toBe(true)
      expect(isDeviceOriginCode(ErrorCodes.RPS_SECRETS_READ_FAILED)).toBe(false)
    })
  })

  describe('fromError', () => {
    it('maps transport error classes', () => {
      expect(fromError(new GATEWAY_TIMEOUT_ERROR()).code).toBe(ErrorCodes.WSMAN_TIMEOUT)
      expect(fromError(new UNEXPECTED_PARSE_ERROR()).code).toBe(ErrorCodes.WSMAN_PARSE_ERROR)
      expect(fromError(new CONNECTION_RESET_ERROR()).code).toBe(ErrorCodes.WSMAN_CONNECTION_RESET)
      expect(fromError(new TLS_TUNNEL_ERROR('handshake failed')).code).toBe(ErrorCodes.WSMAN_TLS_TUNNEL_FAILED)
      expect(fromError(new EA_TIMEOUT_ERROR()).code).toBe(ErrorCodes.RPS_EA_TIMEOUT)
    })

    it('does not treat a transport error synthetic statusCode as an HTTP status', () => {
      const resolved = fromError(new GATEWAY_TIMEOUT_ERROR())
      expect(resolved.httpStatus).toBeUndefined()
      expect(resolved.detail).toBe('Gateway Timeout')
    })

    it('keeps a custom transport error message as detail', () => {
      expect(fromError(new TLS_TUNNEL_ERROR('handshake failed')).detail).toBe('handshake failed')
    })

    it('maps raw HTTP responses by status code', () => {
      const unauthorized = fromError({ statusCode: 401, statusMessage: 'Unauthorized', headers: [] })
      expect(unauthorized.code).toBe(ErrorCodes.WSMAN_AUTH_FAILED)
      expect(unauthorized.httpStatus).toBe(401)
      expect(unauthorized.detail).toBe('Unauthorized')

      expect(fromError({ statusCode: 400 }).code).toBe(ErrorCodes.WSMAN_BAD_REQUEST)
      expect(fromError({ statusCode: 500 }).code).toBe(ErrorCodes.WSMAN_SERVER_ERROR)
      expect(fromError({ statusCode: 404 }).code).toBe(ErrorCodes.WSMAN_HTTP_ERROR)
    })

    it('does not report an HTTP error from another service as a WSMAN failure', () => {
      // e.g. an HTTP client error from MPS or the secret provider: not AMT, and its text is internal.
      const upstream = Object.assign(new Error('503 from http://vault.internal:8200'), { statusCode: 503 })
      const resolved = fromError(upstream)
      expect(resolved.code).toBe(ErrorCodes.RPS_UNEXPECTED_ERROR)
      expect(resolved.httpStatus).toBe(503)
      expect(isDeviceOriginCode(resolved.code)).toBe(false)

      // HttpResponseError is what the maintenance tasks throw for an MPS response: not AMT either.
      const mps = Object.assign(new Error('Service Unavailable'), { statusCode: 503, name: 'HttpResponseError' })
      expect(fromError(mps).code).toBe(ErrorCodes.RPS_UNEXPECTED_ERROR)
      expect(fromError(mps).httpStatus).toBe(503)
    })

    it('maps RPSError and generic errors', () => {
      const rps = fromError(new RPSError('profile missing', 'NotFound'))
      expect(rps.code).toBe(ErrorCodes.RPS_INTERNAL_ERROR)
      expect(rps.detail).toBe('profile missing')

      const generic = fromError(new Error('boom'))
      expect(generic.code).toBe(ErrorCodes.RPS_UNEXPECTED_ERROR)
      expect(generic.detail).toBe('boom')
    })

    it('handles strings, null and unknown shapes', () => {
      expect(fromError('plain text')).toEqual({
        code: ErrorCodes.RPS_UNEXPECTED_ERROR,
        reason: describeCode(ErrorCodes.RPS_UNEXPECTED_ERROR),
        detail: 'plain text'
      })
      expect(fromError(null).code).toBe(ErrorCodes.RPS_UNEXPECTED_ERROR)
      expect(fromError(undefined).code).toBe(ErrorCodes.RPS_UNEXPECTED_ERROR)
      expect(fromError({ foo: 'bar' }).code).toBe(ErrorCodes.RPS_UNEXPECTED_ERROR)
    })
  })
})
