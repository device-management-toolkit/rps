/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import type WebSocket from 'ws'

import type { ILogger } from './interfaces/ILogger.js'
import { ClientMethods, type ClientMsg } from './models/RCS.Config.js'
import { RPSError } from './utils/RPSError.js'
import type { IValidator } from './interfaces/IValidator.js'
import { HttpHandler } from './HttpHandler.js'
import pkg, { type HttpZResponseModel } from 'http-z'
import { Deactivation } from './stateMachines/deactivation.js'
import { Maintenance, type MaintenanceEvent } from './stateMachines/maintenance/maintenance.js'
import { Activation, type ActivationEvent } from './stateMachines/activation.js'
import ClientResponseMsg from './utils/ClientResponseMsg.js'
import { parseChunkedMessage } from './utils/parseChunkedMessage.js'
import { UNEXPECTED_PARSE_ERROR, CONNECTION_RESET_ERROR, type UnexpectedParseError } from './utils/constants.js'
import { SyncTimeEventType } from './stateMachines/maintenance/syncTime.js'
import { ChangePasswordEventType } from './stateMachines/maintenance/changePassword.js'
import { SyncHostNameEventType } from './stateMachines/maintenance/syncHostName.js'
import { SyncIPEventType } from './stateMachines/maintenance/syncIP.js'
import { SyncDeviceInfoEventType } from './stateMachines/maintenance/syncDeviceInfo.js'
import { devices } from './devices.js'
import Logger from './Logger.js'

const tlsLogger = new Logger('TLSDataHandler')
export class DataProcessor {
  httpHandler: HttpHandler
  constructor(
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
  async processData(message: WebSocket.Data, clientId: string): Promise<ClientMsg | null> {
    try {
      let clientMsg: ClientMsg

      try {
        clientMsg = this.validator.parseClientMsg(message, clientId)
      } catch (parseErr) {
        throw new RPSError(parseErr)
      }
      this.logger.debug(`Processing message: method=${clientMsg.method}, client=${clientId}`)

      switch (clientMsg.method) {
        case ClientMethods.ACTIVATION: {
          this.logger.debug(`Routing to ACTIVATION handler`)
          await this.activateDevice(clientMsg, clientId)
          break
        }
        case ClientMethods.DEACTIVATION: {
          this.logger.debug(`Routing to DEACTIVATION handler`)
          await this.deactivateDevice(clientMsg, clientId)
          break
        }
        case ClientMethods.RESPONSE: {
          this.logger.debug(`Routing to RESPONSE handler`)
          await this.handleResponse(clientMsg, clientId)
          break
        }
        case ClientMethods.MAINTENANCE: {
          this.logger.debug(`Routing to MAINTENANCE handler`)
          await this.maintainDevice(clientMsg, clientId)
          break
        }
        case ClientMethods.TLS_DATA: {
          await this.handleTLSData(clientMsg, clientId)
          break
        }
        case ClientMethods.CONNECTION_RESET: {
          await this.handleConnectionReset(clientMsg, clientId)
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
    return null
  }

  async activateDevice(
    clientMsg: ClientMsg,
    clientId: string,
    activation: Activation = new Activation()
  ): Promise<void> {
    this.logger.debug(
      `ProcessData: Parsed Message received from device ${clientMsg.payload.uuid}: ${JSON.stringify(clientMsg, null, '\t')}`
    )
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

  async deactivateDevice(
    clientMsg: ClientMsg,
    clientId: string,
    deactivation: Deactivation = new Deactivation()
  ): Promise<void> {
    this.logger.debug(
      `ProcessData: Parsed DEACTIVATION Message received from device ${clientMsg.payload.uuid}: ${JSON.stringify(clientMsg, null, '\t')}`
    )
    await this.validator.validateDeactivationMsg(clientMsg, clientId) // Validate the deactivation message payload
    this.setConnectionParams(clientId, 'admin', clientMsg.payload.password, clientMsg.payload.uuid)
    deactivation.service.start()
    deactivation.service.send({
      type: 'UNPROVISION',
      clientId,
      tenantId: clientMsg.tenantId,
      output: null,
      error: null
    })
  }

  async handleResponse(clientMsg: ClientMsg, clientId: string): Promise<void> {
    const clientObj = devices[clientId]
    let resolveValue = null
    let rejectValue: UnexpectedParseError | HttpZResponseModel | null = null
    let statusCode = -1
    try {
      const { parse } = pkg
      const httpRsp = parse(clientMsg.payload) as HttpZResponseModel
      statusCode = httpRsp.statusCode
      if (statusCode === 200) {
        const xmlBody = parseChunkedMessage(httpRsp.body.text)
        resolveValue = this.httpHandler.parseXML(xmlBody)
        if (!xmlBody || !resolveValue) {
          // AMT fulfilled the request, but there is some problem with the response
          this.logger.warn(`WSMAN RESPONSE: parse failed`)
          rejectValue = new UNEXPECTED_PARSE_ERROR()
        } else {
          const actionMatch = xmlBody.match(/<a:Action>([^<]+)<\/a:Action>/)
          const action = actionMatch ? actionMatch[1].split('/').pop() : 'unknown'
          this.logger.info(`WSMAN RESPONSE: ${action}`)
          this.logger.debug(`WSMAN RESPONSE XML:\n${xmlBody}`)
        }
      } else {
        this.logger.warn(`WSMAN RESPONSE: HTTP ${statusCode}`)
        rejectValue = httpRsp
      }
    } catch (error) {
      this.logger.warn(`WSMAN RESPONSE: parse error`)
      rejectValue = new UNEXPECTED_PARSE_ERROR()
    }
    if (clientObj.pendingPromise != null) {
      if (clientObj.resolve && clientObj.reject) {
        if (resolveValue) {
          clientObj.resolve(resolveValue)
        } else {
          clientObj.reject(rejectValue)
        }
      }
    }
  }

  async maintainDevice(
    clientMsg: ClientMsg,
    clientId: string,
    maintenance: Maintenance = new Maintenance()
  ): Promise<void> {
    this.logger.debug(
      `ProcessData: Parsed Maintenance message received from device ${clientMsg.payload.uuid}: ${JSON.stringify(clientMsg, null, '\t')}`
    )
    await this.validator.validateMaintenanceMsg(clientMsg, clientId)
    this.setConnectionParams(clientId, 'admin', clientMsg.payload.password, clientMsg.payload.uuid)
    maintenance.service.start()
    const mEvent = this.buildMaintenanceEvent(clientId, clientMsg.payload)
    maintenance.service.send(mEvent)
  }

  buildMaintenanceEvent(clientId: string, payload: any): MaintenanceEvent {
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

  setConnectionParams(
    clientId: string,
    username: string | null = null,
    password: string | null = null,
    uuid: string | null = null
  ): void {
    const clientObj = devices[clientId]
    clientObj.connectionParams = {
      port: 16992,
      guid: uuid ?? clientObj.ClientData.payload.uuid,
      username: username ?? clientObj.ClientData.payload.username,
      password: password ?? clientObj.ClientData.payload.password
    }
  }

  async handleTLSData(clientMsg: ClientMsg, clientId: string): Promise<void> {
    const clientObj = devices[clientId]

    if (clientObj?.tlsTunnelNeedsReset === true) {
      return
    }

    if (clientObj?.tlsTunnelManager != null && clientMsg.payload != null) {
      const data = Buffer.from(clientMsg.payload, 'base64')
      clientObj.tlsTunnelManager.injectData(data)
    }
  }

  async handleConnectionReset(clientMsg: ClientMsg, clientId: string): Promise<void> {
    const clientObj = devices[clientId]
    tlsLogger.warn(`CONNECTION RESET from rpc-go`)

    if (clientObj == null) {
      return
    }

    if (clientObj.tlsTunnelManager != null) {
      clientObj.tlsTunnelManager.close()
      clientObj.tlsTunnelManager = undefined
      clientObj.tlsTunnelSessionId = undefined
    }

    clientObj.tlsResponseBuffer = undefined
    clientObj.tlsTunnelNeedsReset = true
    clientObj.amtReconfiguring = true // Signal that AMT may be reconfiguring - need delay before reconnect

    if (clientObj.pendingPromise != null && clientObj.reject != null) {
      clientObj.reject(new CONNECTION_RESET_ERROR())
    }
  }
}
