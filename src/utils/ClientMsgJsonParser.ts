/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { type ClientMsg, type Payload, ClientMethods } from '../models/RCS.Config.js'
import { RPSError } from './RPSError.js'

export class ClientMsgJsonParser {
  /**
   * @description Parse client message and check for mandatory information
   * @param {WebSocket.Data} message the message coming in over the websocket connection
   * @returns {ClientMsg} returns ClientMsg object if client message is valid
   */
  parse(message: string): ClientMsg {
    let msg: ClientMsg | null = null
    // Parse and convert the message
    const clientMsg: ClientMsg = JSON.parse(message)
    msg = this.convertClientMsg(clientMsg)
    return msg
  }

  /**
   * @description Convert the message received from client to local object ClientMsg
   * @param {ClientMsg} message
   * @returns {ClientMsg}
   */
  convertClientMsg(message: ClientMsg): ClientMsg {
    if (message.payload) {
      // TLS_DATA payloads are binary and should remain base64-encoded for later processing
      if (message.method === ClientMethods.TLS_DATA) {
        // Keep payload as-is (base64 string) - will be decoded in handleTLSData
        return message
      }
      // CONNECTION_RESET has simple text payload, decode but don't parse as JSON
      if (message.method === ClientMethods.CONNECTION_RESET) {
        message.payload = Buffer.from(message.payload, 'base64').toString('utf8')
        return message
      }
      const decodedPayload = Buffer.from(message.payload, 'base64').toString('utf8')
      if (message.method !== ClientMethods.RESPONSE) {
        message.payload = this.parsePayload(decodedPayload)
      } else {
        message.payload = decodedPayload
      }
    }
    return message
  }

  /**
   * @description Convert the payload received from client
   * @param {string} payloadString
   * @returns {Payload}
   */
  parsePayload(payloadString: string): Payload {
    let payload: Payload
    try {
      payload = JSON.parse(payloadString)
    } catch (error) {
      throw new RPSError(`Failed to parse client message payload. ${error.message}`)
    }
    if (payload.client && payload.ver && payload.build && payload.uuid) {
      if (Array.isArray(payload.uuid)) {
        payload.uuid = this.getUUID(payload.uuid)
      }
    } else {
      throw new RPSError('Invalid payload from client')
    }
    return payload
  }

  zeroLeftPad(str: string, len: number): string | null {
    if (len == null && typeof len !== 'number') {
      return null
    }
    if (str == null) str = '' // If null, this is to generate zero leftpad string
    let zlp = ''
    for (let i = 0; i < len - str.length; i++) {
      zlp += '0'
    }
    return zlp + str
  }

  getUUID(uuid: any[]): any {
    const bufUuid = Buffer.from(uuid)
    const guid = [
      this.zeroLeftPad(bufUuid.readUInt32LE(0).toString(16), 8),
      this.zeroLeftPad(bufUuid.readUInt16LE(4).toString(16), 4),
      this.zeroLeftPad(bufUuid.readUInt16LE(6).toString(16), 4),
      this.zeroLeftPad(bufUuid.readUInt16BE(8).toString(16), 4),
      this.zeroLeftPad(bufUuid.slice(10).toString('hex').toLowerCase(), 12)
    ].join('-')

    return guid
  }
}
