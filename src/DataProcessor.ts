/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import type WebSocket from 'ws'

import type { ILogger } from './interfaces/ILogger'
import { ClientMethods, type ClientMsg } from './models/RCS.Config'
import { RPSError } from './utils/RPSError'
import type { IValidator } from './interfaces/IValidator'
import { HttpHandler } from './HttpHandler'
import { parse, type HttpZResponseModel } from 'http-z'
import { devices } from './WebSocketListener'
import { Deactivation } from './stateMachines/deactivation'
import { Maintenance } from './stateMachines/maintenance'
import { Activation } from './stateMachines/activation'
import { parseBody } from './utils/parseWSManResponseBody'
import ClientResponseMsg from './utils/ClientResponseMsg'
export class DataProcessor {
  httpHandler: HttpHandler
  constructor (
    private readonly logger: ILogger,
    readonly validator: IValidator
  ) {
    this.httpHandler = new HttpHandler()
  }

  /**
     * @description Process client data and gets response for desired action
     * @param {WebSocket.Data} message the message coming in over the websocket connection
     * @param {string} clientId Id to keep track of connections
     * @returns {RCSMessage} returns configuration message
     */
  async processData (message: WebSocket.Data, clientId: string): Promise<ClientMsg | null> {
    try {
      let clientMsg: ClientMsg = null

      try {
        clientMsg = this.validator.parseClientMsg(message, clientId)
      } catch (parseErr) {
        throw new RPSError(parseErr)
      }
      switch (clientMsg.method) {
        case ClientMethods.ACTIVATION: {
          await this.activateDevice(clientMsg, clientId)
          break
        }
        case ClientMethods.DEACTIVATION: {
          await this.deactivateDevice(clientMsg, clientId)
          break
        }
        case ClientMethods.RESPONSE: {
          await this.handleResponse(clientMsg, clientId)
          break
        }
        case ClientMethods.MAINTENANCE: {
          await this.maintainDevice(clientMsg, clientId)
          break
        }
        default: {
          const uuid = clientMsg.payload.uuid ? clientMsg.payload.uuid : devices[clientId].ClientData.payload.uuid
          throw new RPSError(`Device ${uuid} Not a supported method received from AMT device`)
        }
      }
    } catch (error) {
      this.logger.error(`${clientId} : Failed to process data - ${error.message}`)
      if (error instanceof RPSError) {
        return ClientResponseMsg.get(clientId, null, 'error', 'failed', error.message)
      } else {
        ClientResponseMsg.get(clientId, null, 'error', 'failed', 'request failed')
      }
    }
  }

  async activateDevice (clientMsg: ClientMsg, clientId: string, activation: Activation = new Activation()): Promise<void> {
    this.logger.debug(`ProcessData: Parsed Message received from device ${clientMsg.payload.uuid}: ${JSON.stringify(clientMsg, null, '\t')}`)
    await this.validator.validateActivationMsg(clientMsg, clientId) // Validate the activation message payload
    // Makes the first wsman call
    this.setConnectionParams(clientId)
    activation.service.start()
    if (devices[clientId].activationStatus) {
      activation.service.send({ type: 'ACTIVATED', clientId, isActivated: true })
    } else {
      activation.service.send({ type: 'ACTIVATION', clientId })
    }
  }

  async deactivateDevice (clientMsg: ClientMsg, clientId: string, deactivation: Deactivation = new Deactivation()): Promise<void> {
    this.logger.debug(`ProcessData: Parsed DEACTIVATION Message received from device ${clientMsg.payload.uuid}: ${JSON.stringify(clientMsg, null, '\t')}`)
    await this.validator.validateDeactivationMsg(clientMsg, clientId) // Validate the deactivation message payload
    this.setConnectionParams(clientId, 'admin', clientMsg.payload.password, clientMsg.payload.uuid)
    deactivation.service.start()
    deactivation.service.send({ type: 'UNPROVISION', clientId, data: null })
  }

  async handleResponse (clientMsg: ClientMsg, clientId: string): Promise<void> {
    const clientObj = devices[clientId]
    const payload = clientObj.ClientData.payload
    const message = parse(clientMsg.payload) as HttpZResponseModel
    if (message.statusCode === 200) {
      const xmlBody = parseBody(message)
      // parse WSMan xml response to json
      const parsedMessage = this.httpHandler.parseXML(xmlBody)
      if (clientObj.pendingPromise != null) {
        clientObj.resolve(parsedMessage)
      }
      this.logger.debug(`Device ${payload.uuid} wsman response ${message.statusCode}: ${JSON.stringify(clientMsg.payload, null, '\t')}`)
    } else {
      let parsedMessage = message
      if (message.statusCode !== 401) { // won't be parsed if it is a 401 since it isn't XML
        const xmlBody = parseBody(message)
        // pares WSMan xml response to json
        parsedMessage = this.httpHandler.parseXML(xmlBody)
      }
      if (clientObj.pendingPromise != null) {
        clientObj.reject(parsedMessage)
      }
      this.logger.debug(`Device ${payload.uuid} wsman response ${message.statusCode}: ${JSON.stringify(clientMsg.payload, null, '\t')}`)
    }
  }

  async maintainDevice (clientMsg: ClientMsg, clientId: string, maintenance: Maintenance = new Maintenance()): Promise<void> {
    this.logger.debug(`ProcessData: Parsed Maintenance message received from device ${clientMsg.payload.uuid}: ${JSON.stringify(clientMsg, null, '\t')}`)
    await this.validator.validateMaintenanceMsg(clientMsg, clientId)
    this.setConnectionParams(clientId, 'admin', clientMsg.payload.password, clientMsg.payload.uuid)
    maintenance.service.start()
    const mEvent = this.buildMaintenanceEvent(clientId, clientMsg.payload)
    maintenance.service.send(mEvent)
  }

  buildMaintenanceEvent (clientId: string, payload: any): any {
    const mEvent: any = {
      clientId
    }
    if (payload == null || payload.task == null) {
      throw new RPSError(`${clientId} - missing payload data`)
    }
    switch (payload.task) {
      case 'synctime':
        mEvent.type = 'SYNCTIME'
        break
      case 'syncip':
        mEvent.type = 'SYNCIP'
        if (payload.ipConfiguration) {
          mEvent.data = payload.ipConfiguration
        } else {
          throw new RPSError(`${clientId} - missing ipConfiguration`)
        }
        break
      case 'changepassword':
        mEvent.type = 'CHANGEPASSWORD'
        // password is optional
        if (payload.taskArg) {
          mEvent.data = payload.taskArg
        }
        break
      case 'synchostname':
        mEvent.type = 'SYNCHOSTNAME'
        if (payload.hostnameInfo) {
          mEvent.data = payload.hostnameInfo
        } else {
          throw new RPSError(`${clientId} - missing HostnameInfo`)
        }
        break
      default:
        throw new RPSError(`${clientId} - unknown task ${payload.task}`)
    }
    return mEvent
  }

  setConnectionParams (clientId: string, username: string = null, password: string = null, uuid: string = null): void {
    const clientObj = devices[clientId]
    clientObj.connectionParams = {
      port: 16992,
      guid: uuid ?? clientObj.ClientData.payload.uuid,
      username: username ?? clientObj.ClientData.payload.username,
      password: password ?? clientObj.ClientData.payload.password
    }
  }
}
