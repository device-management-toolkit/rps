/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import type * as WebSocket from 'ws'
import { type IValidator } from './interfaces/IValidator.js'
import { type ILogger } from './interfaces/ILogger.js'
import { type ClientMsg, ClientAction, type Payload, ClientMethods } from './models/RCS.Config.js'
import { ClientMsgJsonParser } from './utils/ClientMsgJsonParser.js'
import { RPSError } from './utils/RPSError.js'
import { CommandParser } from './CommandParser.js'
import { VersionChecker } from './VersionChecker.js'
import { AMTUserName } from './utils/constants.js'
import { Environment } from './utils/Environment.js'
import got from 'got'
import { devices } from './devices.js'
import { type AMTConfiguration } from './models/index.js'
import { type Configurator } from './Configurator.js'
import { type DeviceCredentials } from './interfaces/ISecretManagerService.js'
export class Validator implements IValidator {
  jsonParser: ClientMsgJsonParser

  constructor(
    private readonly logger: ILogger,
    readonly configurator: Configurator
  ) {
    this.jsonParser = new ClientMsgJsonParser()
  }

  /**
   * @description Parse client message and check for mandatory information
   * @param {WebSocket.Data} message the message coming in over the websocket connection
   * @param {string} clientId Id to keep track of connections
   * @returns {ClientMsg} returns ClientMsg object if client message is valid. Otherwise returns null.
   */
  parseClientMsg(message: WebSocket.Data, clientId: string): ClientMsg | null {
    let msg: ClientMsg | null = null
    try {
      // Parse and convert the message
      if (typeof message === 'string') {
        msg = this.jsonParser.parse(message)

        if (msg?.protocolVersion) {
          if (VersionChecker.isCompatible(msg.protocolVersion)) {
            this.logger.silly(`protocol version supported: ${msg.protocolVersion}`)
          } else {
            throw new RPSError(`protocol version NOT supported: ${msg.protocolVersion}`)
          }
        }

        if (msg.method !== ClientMethods.RESPONSE && msg.method !== ClientMethods.HEARTBEAT) {
          msg = CommandParser.parse(msg)
        }
      }
    } catch (error) {
      this.logger.error(`${clientId}: Failed to parse client message`)
      throw error
    }
    return msg
  }

  /**
   * @description Validate the client message only if action is not acmactivate-success or ccmactivate-success
   * @param {ClientMsg} msg
   * @param {string} clientId
   * @returns {RCSMessage}
   */
  async validateActivationMsg(msg: ClientMsg, clientId: string): Promise<void> {
    const clientObj = devices[clientId]
    const payload: Payload = this.verifyPayload(msg, clientId)
    // Check version and build compatibility
    this.verifyAMTVersion(payload, 'activation')
    // Check for password
    if (!payload.password) {
      throw new RPSError(`Device ${payload.uuid} activation failed. Missing password.`)
    }
    // Check for client requested action and profile activation
    const profile: AMTConfiguration | null = await this.configurator.profileManager.getAmtProfile(
      payload.profile,
      msg.tenantId
    )
    if (!profile) {
      throw new RPSError(
        `Device ${payload.uuid} activation failed. ${payload.profile} does not match list of available AMT profiles.`
      )
    }
    payload.profile = profile
    clientObj.uuid = payload.uuid
    if (profile.activation === ClientAction.ADMINCTLMODE) {
      if (parseFloat(msg.payload.ver) >= 19) {
        clientObj.action = ClientAction.CLIENTCTLMODE
      } else {
        clientObj.action = ClientAction.ADMINCTLMODE
      }
    } else if (profile.activation === ClientAction.CLIENTCTLMODE) {
      clientObj.action = ClientAction.CLIENTCTLMODE
    }
    msg.payload = payload
    clientObj.ClientData = msg
    // Check for the current activation mode on AMT
    await this.verifyCurrentModeForActivation(msg, profile, clientId)

    if (!clientObj.action) {
      throw new RPSError(
        `Device ${payload.uuid} activation failed. Failed to get activation mode for the profile :${payload.profile}`
      )
    }
    // Validate client message to configure ACM message
    if (clientObj.action === ClientAction.ADMINCTLMODE) {
      await this.verifyActivationMsgForACM(msg)
    }
    // }
  }

  /**
   * @description Validate the client message only if action is not acmactivate-success or ccmactivate-success
   * @param {ClientMsg} msg
   * @param {string} clientId
   * @returns {RCSMessage}
   */
  async validateDeactivationMsg(msg: ClientMsg, clientId: string): Promise<void> {
    const clientObj = devices[clientId]
    const payload: Payload = this.verifyPayload(msg, clientId)
    // Check for the current mode
    if (payload.currentMode != null && payload.currentMode >= 0) {
      switch (payload.currentMode) {
        case 0: {
          throw new RPSError(`Device ${payload.uuid} is in pre-provisioning mode.`)
        }
        case 1: {
          clientObj.action = ClientAction.DEACTIVATE
          this.logger.debug(`Device ${payload.uuid} is in client control mode.`)
          break
        }
        case 2: {
          clientObj.action = ClientAction.DEACTIVATE
          this.logger.debug(`Device ${payload.uuid} is in admin control mode.`)
          break
        }
        default: {
          throw new RPSError(
            `Device ${payload.uuid} deactivation failed. It is in unknown mode: ${payload.currentMode}.`
          )
        }
      }
    }
    // Check version and build compatibility
    this.verifyAMTVersion(payload, 'deactivation')
    // Check for forced deactivation request
    if (msg.payload.force) {
      this.logger.debug('bypassing password check')
    } else {
      await this.verifyDevicePassword(payload, clientId)
    }
    // Store the client message
    clientObj.uuid = payload.uuid
    msg.payload = payload
    clientObj.ClientData = msg
  }

  /**
   * @description Validate realm of client message
   * @param {string} realm
   * @param {string} clientId
   * @returns {boolean}
   */
  isDigestRealmValid(realm: string): boolean {
    const regex = /[0-9A-Fa-f]{32}/g
    let isValidRealm = false
    let realmElements: any = {}
    if (realm?.startsWith('Digest:')) {
      realmElements = realm.split('Digest:')
      if (realmElements[1].length === 32 && regex.test(realmElements[1])) {
        isValidRealm = true
      }
    }
    return isValidRealm
  }

  async updateTags(uuid: string, profile: AMTConfiguration): Promise<void> {
    let tags: any[] = []
    if (profile.tags != null && profile?.tags.length > 0) {
      tags = profile.tags
      await got(`${Environment.Config.mps_server}/api/v1/devices`, {
        method: 'PATCH',
        json: {
          guid: uuid,
          tags
        }
      })
    }
  }

  async validateMaintenanceMsg(msg: ClientMsg, clientId: string): Promise<void> {
    const clientObj = devices[clientId]
    const payload: Payload = this.verifyPayload(msg, clientId)
    // Task must be specified
    if (!msg.payload.task) {
      throw new RPSError(`${clientId} - missing maintenance task in message`)
    }
    // Check for the current mode
    if (payload.currentMode != null && payload.currentMode > 0) {
      const mode = payload.currentMode === 1 ? 'client control mode' : 'admin control mode'
      clientObj.action = ClientAction.MAINTENANCE
      this.logger.debug(`Device ${payload.uuid} is in ${mode}.`)
    } else {
      throw new RPSError(`Device ${payload.uuid} is in pre-provisioning mode.`)
    }
    if (msg.payload.force) {
      this.logger.debug('bypassing password check')
    } else {
      await this.verifyDevicePassword(payload, clientId)
    }
    clientObj.uuid = payload.uuid
    clientObj.ClientData = msg
  }

  async verifyDevicePassword(payload: Payload, clientId: string): Promise<void> {
    try {
      const clientObj = devices[clientId]
      const amtDevice = (await this.configurator.secretsManager.getSecretAtPath(
        `devices/${payload.uuid}`
      )) as DeviceCredentials

      if (amtDevice?.AMT_PASSWORD && payload.password && payload.password === amtDevice.AMT_PASSWORD) {
        this.logger.debug(`AMT password matches stored version for Device ${payload.uuid}`)
        clientObj.hostname = clientObj.uuid = payload.uuid
        clientObj.amtPassword = amtDevice.AMT_PASSWORD
        clientObj.mebxPassword = amtDevice.MEBX_PASSWORD
        clientObj.mpsPassword = amtDevice.MPS_PASSWORD
      } else {
        this.logger.error(`stored version for Device ${payload.uuid}`)
        throw new RPSError(`AMT password DOES NOT match stored version for Device ${payload.uuid}`)
      }
    } catch (error) {
      this.logger.error(`AMT device secret provider exception: ${error}`)
      if (error instanceof RPSError) {
        throw new RPSError(`${error.message}`)
      } else {
        throw new Error('AMT device secret provider exception')
      }
    }
  }

  verifyPayload(msg: ClientMsg, clientId: string): Payload {
    if (!msg) {
      throw new RPSError(`${clientId} - Error while Validating the client message`)
    }
    if (!msg.payload.uuid) {
      throw new RPSError(`${clientId} - Missing uuid from payload`)
    }
    if (msg.payload.uuid.length !== 36) {
      throw new RPSError(`${clientId} - uuid not valid length`)
    }
    return msg.payload
  }

  async verifyActivationMsgForACM(msg: ClientMsg): Promise<void> {
    if (!msg.payload.certHashes) {
      throw new RPSError(`Device ${msg.payload.uuid} activation failed. Missing certificate hashes from the device.`)
    }

    if (!msg.payload.fqdn && msg.payload.currentMode !== 2) {
      throw new RPSError(`Device ${msg.payload.uuid} activation failed. Missing DNS Suffix.`)
    }

    if (
      !(await this.configurator.domainCredentialManager.doesDomainExist(msg.payload.fqdn, msg.tenantId)) &&
      msg.payload.currentMode !== 2
    ) {
      throw new RPSError(
        `Device ${msg.payload.uuid} activation failed. Specified AMT domain suffix: ${msg.payload.fqdn} does not match list of available AMT domain suffixes.`
      )
    }
  }

  async verifyCurrentModeForActivation(msg: ClientMsg, profile: AMTConfiguration, clientId: string): Promise<void> {
    const clientObj = devices[clientId]
    switch (msg.payload.currentMode) {
      case 0: {
        this.logger.debug(`Device ${msg.payload.uuid} is in pre-provisioning mode`)
        break
      }
      case 1: {
        if (profile.activation === ClientAction.ADMINCTLMODE) {
          this.logger.debug(
            `Device ${msg.payload.uuid} already enabled in client mode. Upgrading to admin control mode.`
          )
          clientObj.status.Status = 'Upgraded to admin control mode.'
        } else {
          this.logger.debug(`Device ${msg.payload.uuid} already enabled in client mode.`)
          clientObj.status.Status = 'already enabled in client mode.'
        }
        await this.setNextStepsForConfiguration(msg, clientId)
        break
      }
      case 2: {
        if (profile.activation !== ClientAction.ADMINCTLMODE) {
          throw new RPSError(`Device ${msg.payload.uuid} already enabled in admin control mode.`)
        }
        this.logger.debug(`Device ${msg.payload.uuid} already enabled in admin mode.`)
        clientObj.status.Status = 'already enabled in admin mode.'
        await this.setNextStepsForConfiguration(msg, clientId)
        break
      }
      default: {
        throw new RPSError(`Device ${msg.payload.uuid} activation failed. It is in unknown mode.`)
      }
    }
  }

  async getDeviceCredentials(msg: ClientMsg): Promise<DeviceCredentials | null> {
    try {
      const secretData = await this.configurator.secretsManager.getSecretAtPath(`devices/${msg.payload.uuid}`)

      if (secretData == null) {
        this.logger.error(`AMT device DOES NOT exists ${msg.payload.uuid}`)
        return null
      }
      return secretData as DeviceCredentials
    } catch (error) {
      this.logger.error(`Failed to get AMT device info ${msg.payload.uuid}`)
    }
    return null
  }

  async setNextStepsForConfiguration(msg: ClientMsg, clientId: string): Promise<void> {
    const clientObj = devices[clientId]
    let amtDevice: DeviceCredentials | null = null
    try {
      amtDevice = await this.getDeviceCredentials(msg)
    } catch (error) {
      this.logger.error(`AMT device DOES NOT exists ${msg.payload.uuid}`)
    }
    clientObj.activationStatus = true
    msg.payload.username = AMTUserName
    if (amtDevice?.AMT_PASSWORD) {
      if (amtDevice.AMT_PASSWORD !== msg.payload.password) {
        throw new RPSError(`AMT password DOES NOT match stored version for Device ${msg.payload.uuid}`)
      }
      msg.payload.password = amtDevice.AMT_PASSWORD
      this.logger.debug(`AMT password found for Device ${msg.payload.uuid}`)
      await this.updateTags(msg.payload.uuid, msg.payload.profile)
      if (clientObj.action === ClientAction.ADMINCTLMODE || clientObj.action === ClientAction.CLIENTCTLMODE) {
        clientObj.amtPassword = amtDevice.AMT_PASSWORD
        if (clientObj.action === ClientAction.ADMINCTLMODE) {
          clientObj.mebxPassword = amtDevice.MEBX_PASSWORD
        }
      }
    } else {
      this.logger.debug(`AMT credentials not found in secret provider for device ${msg.payload.uuid}`)
    }
    clientObj.ClientData = msg
  }

  verifyAMTVersion(payload: Payload, action: string): void {
    const verifiedVersions = [
      7.0,
      7.1,
      8.0,
      8.1,
      9.0,
      9.1,
      9.5,
      10.0,
      11.0,
      11.5,
      11.6
    ]
    if (verifiedVersions.includes(parseFloat(payload.ver))) {
      if (parseInt(payload.build) < 3000) {
        throw new RPSError(`Device ${payload.uuid} ${action} failed. Please check with your OEM for a firmware update.`)
      }
    } else if (parseFloat(payload.ver) < 7) {
      throw new RPSError(
        `Device ${payload.uuid} ${action} failed. AMT version: ${payload.ver}. Version less than 7 cannot be remotely configured `
      )
    }
  }
}
