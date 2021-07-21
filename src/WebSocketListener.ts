/*********************************************************************
 * Copyright (c) Intel Corporation 2019
 * SPDX-License-Identifier: Apache-2.0
 * Author: Madhavi Losetty
 * Description: Simple Websocket server
 **********************************************************************/
import * as WebSocket from 'ws'
import { v4 as uuid } from 'uuid'

import { WebSocketConfig, ClientObject } from './RCS.Config'
import { IWebSocketListener } from './interfaces/IWebSocketListener'
import { IClientManager } from './interfaces/IClientManager'
import { IDataProcessor } from './interfaces/IDataProcessor'
import { ILogger } from './interfaces/ILogger'

export class WebSocketListener implements IWebSocketListener {
  clientManager: IClientManager
  dataProcessor: IDataProcessor
  wsServer: WebSocket.Server
  wsConfig: WebSocketConfig
  logger: ILogger

  constructor (logger: ILogger, wsConfig: WebSocketConfig, clientManager: IClientManager, dataProcessor: IDataProcessor) {
    this.logger = logger
    this.wsConfig = wsConfig
    this.clientManager = clientManager
    this.dataProcessor = dataProcessor
  }

  /**
   * @description Creates a WebSocket server based on config info
   */
  connect (): boolean {
    try {
      this.wsServer = new WebSocket.Server({ port: this.wsConfig.WebSocketPort })

      if (this.wsServer !== null) {
        this.wsServer.on('connection', this.onClientConnected)
        this.logger.info(`RPS Microservice socket listening on port: ${this.wsConfig.WebSocketPort} ...!`)
        return true
      } else {
        this.logger.error('Failed to start WebSocket server')
        return false
      }
    } catch (error) {
      this.logger.error(`Failed to start WebSocket server : ${error}`)
      return false
    }
  }

  /**
   * @description Called on connection event of WebSocket Server
   * @param {WebSocket} ws  websocket object
   */
  onClientConnected = (ws: WebSocket): void => {
    try {
      const clientId = uuid()

      const client: ClientObject = { ClientId: clientId, ClientSocket: ws, ciraconfig: {}, network: {} }
      this.clientManager.addClient(client)

      ws.on('message', async (data: WebSocket.Data) => {
        await this.onMessageReceived(data, clientId)
      })
      ws.on('close', () => {
        this.onClientDisconnected(clientId)
      })
      ws.on('error', (error) => {
        this.onError(error, clientId)
      })

      this.logger.debug(`client : ${clientId} Connection accepted.`)
    } catch (error) {
      this.logger.error(`Failed on client connection: ${JSON.stringify(error)}`)
    }
  }

  /**
   * @description Called on close event of WebSocket Server
   * @param {Number} index Index of the connected client
   */
  onClientDisconnected (clientId: string): void {
    try {
      this.clientManager.removeClient(clientId)
      this.logger.debug(`Connection ended for client : ${clientId}`)
    } catch (error) {
      this.logger.error(`Failed to close connection : ${error}`)
    }
  }

  /**
   * @description Called on error event of WebSocket Server
   * @param {Error} error Websocket error
   */
  onError (error: Error, clientId: string): void {
    this.logger.error(`${clientId} : ${error.message}`)
  };

  /**
   * @description Called on message event of WebSocket Server
   * @param {Number} index Index of the connected client
   * @param {WSMessage} message Received from the client
   */
  async onMessageReceived (message: WebSocket.Data, clientId: string): Promise<void> {
    try {
      // this.logger.debug(`Message from client ${clientId}: ${JSON.stringify(message, null, "\t")}`);
      let responseMsg: any
      if (this.dataProcessor) {
        responseMsg = await this.dataProcessor.processData(message, clientId)
        if (responseMsg) {
          this.onSendMessage(responseMsg, clientId)
        }
      }
    } catch (error) {
      this.logger.error(`Failed to process message received from client: ${error}`)
    }
  }

  /**
   * @external sendMessage
   * @description sends a message to the connected client
   * @param {Number} index Index of the connected client
   * @param {JSON} message Message in JSON format to be sent to client
   */
  onSendMessage (message: string, clientId: string): void {
    try {
      const index = this.clientManager.getClientIndex(clientId)
      this.logger.debug(`${clientId} : response message sent to device: ${JSON.stringify(message, null, '\t')}`)
      if (index > -1) {
        this.clientManager.clients[index].ClientSocket.send(JSON.stringify(message))
      }
    } catch (error) {
      this.logger.error(`Failed to send message to AMT: ${error}`)
    }
  }
}
