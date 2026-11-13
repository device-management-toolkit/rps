/*********************************************************************
 * Copyright (c) Intel Corporation 2026
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { type FailureComponent, type ProvisioningFailure } from '../models/RCS.Config.js'
import { describeCode, type ErrorCode, fromError } from './errorCatalog.js'

export interface ResolveFailureOptions {
  /**
   * Catalog code for this step. A transport-class error (WSMAN_TIMEOUT, WSMAN_PARSE_ERROR,
   * WSMAN_CONNECTION_RESET, WSMAN_TLS_TUNNEL_FAILED, RPS_EA_TIMEOUT) takes precedence over it.
   * HTTP-status-derived and generic error codes do not: the step code is kept and the status /
   * error text ride in HttpStatus / Detail.
   */
  code?: ErrorCode
  /** The thrown value that caused the failure, if any. */
  error?: unknown
  /** Method ReturnValue, if the failure came from a method response. Carried undecoded. */
  returnValue?: number
}

/** Codes that say nothing specific about the cause; a step's own catalog code is preferred over them. */
const GENERIC_CODES = new Set<string>(['RPS_UNEXPECTED_ERROR', 'RPS_INTERNAL_ERROR'])

/**
 * Builds the structured failure for a step. Resolution order: a transport-class code derived from
 * the thrown error, then the step's catalog code, then AMT_METHOD_FAILED for a non-zero method
 * ReturnValue, then whatever the error resolved to (HTTP status or generic), then the generic
 * unexpected-error code. A non-zero ReturnValue always rides in AmtReturnValue.
 */
export function resolveFailure(
  step: string,
  component: FailureComponent,
  options: ResolveFailureOptions = {}
): ProvisioningFailure {
  const { code, error, returnValue } = options
  const failedReturnValue = typeof returnValue === 'number' && returnValue !== 0 ? returnValue : undefined
  let failure: ProvisioningFailure

  const resolvedError = error != null ? fromError(error) : undefined
  // A transport-class error (timeout, parse, connection reset, TLS tunnel, EA timeout) is an
  // unambiguous cause and wins over the step code. An HTTP status is ambiguous about its source
  // (AMT vs. MPS vs. secret provider), so the step code wins and the status rides in HttpStatus.
  const errorIsSpecific =
    resolvedError != null && resolvedError.httpStatus == null && !GENERIC_CODES.has(resolvedError.code)
  if (errorIsSpecific) {
    failure = { Code: resolvedError.code, Component: component, Step: step, Reason: resolvedError.reason }
  } else if (code != null) {
    failure = { Code: code, Component: component, Step: step, Reason: describeCode(code) }
  } else if (failedReturnValue != null) {
    failure = {
      Code: 'AMT_METHOD_FAILED',
      Component: component,
      Step: step,
      Reason: describeCode('AMT_METHOD_FAILED')
    }
  } else if (resolvedError != null) {
    failure = { Code: resolvedError.code, Component: component, Step: step, Reason: resolvedError.reason }
  } else {
    failure = {
      Code: 'RPS_UNEXPECTED_ERROR',
      Component: component,
      Step: step,
      Reason: describeCode('RPS_UNEXPECTED_ERROR')
    }
  }
  if (failedReturnValue != null) failure.AmtReturnValue = failedReturnValue
  if (resolvedError?.httpStatus != null) failure.HttpStatus = resolvedError.httpStatus
  if (resolvedError?.detail != null) failure.Detail = resolvedError.detail
  return failure
}
