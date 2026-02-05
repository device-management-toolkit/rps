/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { type ClientMsg } from '../models/RCS.Config.js'
import { ProtocolVersion } from './constants.js'
import { version } from './version.js'

export default {
  /**
   * @description builds response message to client
   * @param {string} payload
   * @param {string} clientId Id to keep track of connections
   * @returns {ClientMsg} returns message which is sent to client
   */
  get(
    clientId: string,
    payload: string | null,
    method: 'error' | 'wsman' | 'success' | 'heartbeat_request' | 'tls_data',
    status: 'failed' | 'success' | 'ok' | 'heartbeat',
    message = ''
  ): ClientMsg {
    const msg: ClientMsg = {
      method,
      apiKey: 'xxxxx',
      appVersion: version,
      protocolVersion: ProtocolVersion,
      status,
      message,
      payload,
      tenantId: ''
    }

    if (method === 'heartbeat_request') {
      msg.payload = ''
    } else if (method === 'tls_data' && payload != null) {
      // TLS data is already base64-encoded, pass through as-is
      msg.payload = payload
    } else if (method !== 'error' && method !== 'success' && payload != null) {
      msg.payload = Buffer.from(payload).toString('base64')
    }

    return msg
  }
}
