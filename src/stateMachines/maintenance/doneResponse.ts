/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { type ProvisioningFailure } from '../../models/RCS.Config.js'

export type StatusType = 'SUCCESS' | 'FAILED'
export const StatusSuccess: StatusType = 'SUCCESS'
export const StatusFailed: StatusType = 'FAILED'

export interface DoneResponse {
  taskName: string
  status: StatusType
  message: string
  /** Structured failure (code, step, reason) when status is FAILED. Additive; older callers omit it. */
  failure?: ProvisioningFailure
}

export const doneSuccess = function (taskName: string, detail = ''): DoneResponse {
  return { taskName, status: StatusSuccess, message: detail }
}
export const doneFail = function (taskName: string, detail = '', failure?: ProvisioningFailure): DoneResponse {
  const response: DoneResponse = { taskName, status: StatusFailed, message: detail }
  if (failure != null) {
    response.failure = failure
  }
  return response
}
