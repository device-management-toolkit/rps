/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import type Server from 'ws'
import { WebSocketServer, type Data } from 'ws'
import { randomUUID } from 'node:crypto'
import { type ClientMsg } from './models/RCS.Config.js'
import { type ILogger } from './interfaces/ILogger.js'
import { type DataProcessor } from './DataProcessor.js'
import { Environment } from './utils/Environment.js'
import { devices } from './devices.js'
const maxMessageSize = 1024 * 10 * 10

export class WebSocketListener {
  dataProcessor: DataProcessor
  wsServer: WebSocketServer
  logger: ILogger

  constructor(logger: ILogger, dataProcessor: DataProcessor) {
    this.logger = logger
    this.dataProcessor = dataProcessor
  }

  /**
   * @description Creates a WebSocket server based on config info
   */
  connect(): boolean {
    try {
      this.wsServer = new WebSocketServer({ port: Environment.Config.websocketport })
      this.wsServer.on('connection', this.onClientConnected)
      this.logger.info(`RPS Microservice socket listening on port: ${Environment.Config.websocketport} ...!`)
      return true
    } catch (error) {
      this.logger.error(`Failed to start WebSocket server : ${error}`)
      return false
    }
  }

  /**
   * @description Called on connection event of WebSocket Server
   * @param {WebSocket} ws  websocket object
   */
  onClientConnected = (ws: Server): void => {
    const clientId = randomUUID()
    devices[clientId] = {
      ClientId: clientId,
      ClientSocket: ws,
      ciraconfig: {},
      network: { count: 0 },
      status: {},
      tls: {},
      activationStatus: false,
      unauthCount: 0,
      messageId: 0,
      amtPassword: '',
      connectionParams: { port: 16992, guid: '', username: '', password: '' },
      resolve: (value: unknown) => {},
      reject: (value: unknown) => {}
    }

    ws.on('message', async (data: Data, isBinary: boolean) => {
      const message = isBinary ? data : data.toString()
      await this.onMessageReceived(message, clientId)
    })
    ws.on('close', this.onClientDisconnected.bind(this, clientId))
    ws.on('error', (error) => {
      this.onError(error, clientId)
    })
    this.logger.debug(`client : ${clientId} Connection accepted.`)
  }

  /**
   * @description Called on close event of WebSocket Server
   * @param {string} clientId Index of the connected client
   */
  onClientDisconnected(clientId: string): void {
    delete devices[clientId]
    this.logger.debug(`Connection ended for client : ${clientId}`)
  }

  /**
   * @description Called on error event of WebSocket Server
   * @param {Error} error Websocket error
   * @param {string} clientId
   */
  onError(error: Error, clientId: string): void {
    this.logger.error(`${clientId} : ${error.message}`)
  }

  /**
   * @description Called on message event of WebSocket Server
   * @param {Number} index Index of the connected client
   * @param {WSMessage} message Received from the client
   */
  async onMessageReceived(message: Data, clientId: string): Promise<void> {
    let messageLength
    if (typeof message === 'string') {
      messageLength = Buffer.from(message).length
    } else {
      messageLength = maxMessageSize + 1
    }

    this.logger.debug(`Received message from client ${clientId} (${messageLength} bytes)`)

    if (messageLength > maxMessageSize) {
      this.logger.error(`Incoming message exceeds allowed length (${messageLength} > ${maxMessageSize})`)
      const clientDevice = devices[clientId]
      if (clientDevice?.ClientSocket != null) {
        clientDevice.ClientSocket.close()
      }
    }
    try {
      // Parse to extract method for logging
      if (typeof message === 'string') {
        try {
          const parsed = JSON.parse(message)
          this.logger.debug(`  <- Method: ${parsed.method}, Status: ${parsed.status}`)
        } catch {
          // Not JSON, might be binary or other format
        }
      }

      let responseMsg: ClientMsg | null
      if (this.dataProcessor) {
        responseMsg = await this.dataProcessor.processData(message, clientId)
        if (responseMsg) {
          this.sendMessage(responseMsg, clientId)
        }
      }
    } catch (error) {
      this.logger.error(`Failed to process message received from client: ${error}`)
    }
  }

  /**
   * @external sendMessage
   * @description sends a message to the connected client
   * @param {string} clientId Index of the connected client
   * @param {ClientMsg} message Message to be sent to client
   */
  sendMessage(message: ClientMsg, clientId: string): void {
    try {
      const messageJson = JSON.stringify(message)
      this.logger.debug(`Sending message to client ${clientId}`)
      this.logger.debug(`  -> Method: ${message.method}, Status: ${message.status} (${messageJson.length} bytes)`)
      const clientDevice = devices[clientId]
      if (clientDevice?.ClientSocket != null) {
        clientDevice.ClientSocket.send(messageJson)
      }
    } catch (error) {
      this.logger.error(`Failed to send message to AMT: ${error}`)
    }
  }
}
