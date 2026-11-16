/*********************************************************************
 * Copyright (c) Intel Corporation 2026
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { Environment } from './Environment.js'

/** Header RPS sends the shared service token under; see AUTH_SERVICE_TOKEN on Console. */
export const SERVICE_TOKEN_HEADER = 'x-service-token'

/** Headers carrying the service token for RPS -> Console calls; empty when none is configured. */
export function consoleServiceTokenHeaders(): Record<string, string> {
  return Environment.Config.console_service_token
    ? { [SERVICE_TOKEN_HEADER]: Environment.Config.console_service_token }
    : {}
}
