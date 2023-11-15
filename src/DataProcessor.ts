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
import { Maintenance, type MaintenanceEvent } from './stateMachines/maintenance/maintenance'
import { Activation, type ActivationEvent } from './stateMachines/activation'
import ClientResponseMsg from './utils/ClientResponseMsg'
import { parseChunkedMessage } from './utils/parseChunkedMessage'
import { UNEXPECTED_PARSE_ERROR } from './utils/constants'
import { SyncTimeEventType } from './stateMachines/maintenance/syncTime'
import { ChangePasswordEventType } from './stateMachines/maintenance/changePassword'
import { SyncHostNameEventType } from './stateMachines/maintenance/syncHostName'
import { SyncIPEventType } from './stateMachines/maintenance/syncIP'
import { SyncDeviceInfoEventType } from './stateMachines/maintenance/syncDeviceInfo'
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
    this.setConnectionParams(clientId)
    activation.service.start()
    const event: ActivationEvent = {
      type: devices[clientId].activationStatus ? 'ACTIVATED' : 'ACTIVATION',
      clientId,
      tenantId: clientMsg.tenantId,
      friendlyName: clientMsg.payload.friendlyName
    }
    activation.service.send(event)
  }

  async deactivateDevice (clientMsg: ClientMsg, clientId: string, deactivation: Deactivation = new Deactivation()): Promise<void> {
    this.logger.debug(`ProcessData: Parsed DEACTIVATION Message received from device ${clientMsg.payload.uuid}: ${JSON.stringify(clientMsg, null, '\t')}`)
    await this.validator.validateDeactivationMsg(clientMsg, clientId) // Validate the deactivation message payload
    this.setConnectionParams(clientId, 'admin', clientMsg.payload.password, clientMsg.payload.uuid)
    deactivation.service.start()
    deactivation.service.send({ type: 'UNPROVISION', clientId, tenantId: clientMsg.tenantId, data: null })
  }

  async handleResponse (clientMsg: ClientMsg, clientId: string): Promise<void> {
    const clientObj = devices[clientId]
    let resolveValue = null
    let rejectValue = null
    let statusCode = -1
    try {
      const httpRsp = parse(clientMsg.payload) as HttpZResponseModel
      statusCode = httpRsp.statusCode
      if (statusCode === 200) {
        const xmlBody = parseChunkedMessage(httpRsp.body.text)
        resolveValue = this.httpHandler.parseXML(xmlBody)
        if (!xmlBody || !resolveValue) {
          // AMT fulfilled the request, but there is some problem with the response
          rejectValue = new UNEXPECTED_PARSE_ERROR()
        }
      } else {
        rejectValue = httpRsp
      }
    } catch (error) {
      rejectValue = new UNEXPECTED_PARSE_ERROR()
    }
    if (clientObj.pendingPromise != null) {
      if (resolveValue) {
        clientObj.resolve(resolveValue)
      } else {
        clientObj.reject(rejectValue)
      }
    }
    this.logger.debug(`Device ${clientId}` +
      `wsman response ${statusCode} ${resolveValue ? 'resolved' : 'rejected'}: ` +
      `${JSON.stringify(clientMsg.payload, null, '\t')}`)
  }

  async maintainDevice (clientMsg: ClientMsg, clientId: string, maintenance: Maintenance = new Maintenance()): Promise<void> {
    this.logger.debug(`ProcessData: Parsed Maintenance message received from device ${clientMsg.payload.uuid}: ${JSON.stringify(clientMsg, null, '\t')}`)
    await this.validator.validateMaintenanceMsg(clientMsg, clientId)
    this.setConnectionParams(clientId, 'admin', clientMsg.payload.password, clientMsg.payload.uuid)
    maintenance.service.start()
    const mEvent = this.buildMaintenanceEvent(clientId, clientMsg.payload)
    maintenance.service.send(mEvent)
  }

  buildMaintenanceEvent (clientId: string, payload: any): MaintenanceEvent {
    if (payload?.task == null) {
      throw new RPSError(`${clientId} - missing payload data`)
    }
    let mEvent: MaintenanceEvent
    switch (payload.task) {
      case 'syncdeviceinfo':
        mEvent = { type: SyncDeviceInfoEventType, clientId, deviceInfo: payload }
        break
      case 'synctime':
        mEvent = { type: SyncTimeEventType, clientId }
        break
      case 'syncip':
        if (!payload.ipConfiguration) {
          throw new RPSError(`${clientId} - missing ipConfiguration`)
        }
        mEvent = { type: SyncIPEventType, clientId, targetIPConfig: payload.ipConfiguration }
        break
      case 'changepassword':
        mEvent = { type: ChangePasswordEventType, clientId, newStaticPassword: payload.taskArg }
        break
      case 'synchostname':
        if (!payload.hostnameInfo) {
          throw new RPSError(`${clientId} - missing HostnameInfo`)
        }
        mEvent = { type: SyncHostNameEventType, clientId, hostNameInfo: payload.hostnameInfo }
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
