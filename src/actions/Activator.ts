/*********************************************************************
 * Copyright (c) Intel Corporation 2019
 * SPDX-License-Identifier: Apache-2.0
 * Description: Activate AMT in admin control mode
 * Author : Madhavi Losetty
 **********************************************************************/

import { IExecutor } from '../interfaces/IExecutor'
import { ILogger } from '../interfaces/ILogger'
import { SignatureHelper } from '../utils/SignatureHelper'
import { PasswordHelper } from '../utils/PasswordHelper'
import { ClientMsg, ClientAction, ClientObject } from '../models/RCS.Config'
import { IConfigurator } from '../interfaces/IConfigurator'
import { AMTDeviceDTO } from '../repositories/dto/AmtDeviceDTO'
import { ClientResponseMsg } from '../utils/ClientResponseMsg'
import { IClientManager } from '../interfaces/IClientManager'
import { IValidator } from '../interfaces/IValidator'
import { RPSError } from '../utils/RPSError'
import { EnvReader } from '../utils/EnvReader'
import { NetworkConfigurator } from './NetworkConfigurator'
import { AMTUserName } from '../utils/constants'
import { AMTDomain } from '../models'
import got from 'got'
import { MqttProvider } from '../utils/MqttProvider'
import { setMEBXPassword } from '../utils/maintenance/setMEBXPassword'
import { CertManager } from '../CertManager'
import { updateAMTAdminPassword } from '../utils/maintenance/updateAMTAdminPassword'
import { HttpHandler } from '../HttpHandler'
import { AMT, IPS } from '@open-amt-cloud-toolkit/wsman-messages'
import { parseBody } from '../utils/parseWSManResponseBody'
export class Activator implements IExecutor {
  amt: AMT.Messages
  ips: IPS.Messages
  constructor (
    private readonly logger: ILogger,
    readonly configurator: IConfigurator,
    private readonly certManager: CertManager,
    readonly signatureHelper: SignatureHelper,
    private readonly responseMsg: ClientResponseMsg,
    private readonly clientManager: IClientManager,
    private readonly validator: IValidator,
    private readonly networkConfigurator: NetworkConfigurator
  ) {
    this.amt = new AMT.Messages()
    this.ips = new IPS.Messages()
  }

  /**
   * @description Create configuration message to activate AMT in admin control mode
   * @param {any} message valid client message
   * @param {string} clientId Id to keep track of connections
   * @returns {RCSMessage} message to sent to client
   */
  async execute (message: any, clientId: string, httpHandler?: HttpHandler): Promise<ClientMsg> {
    let clientObj: ClientObject
    try {
      clientObj = this.clientManager.getClientObject(clientId)
      const wsmanResponse = message.payload
      if (!clientObj.activationStatus.activated && !wsmanResponse) {
        MqttProvider.publishEvent('fail', ['Activator', 'execute'], 'Missing/invalid WSMan response payload', clientObj.uuid)
        throw new RPSError(`Device ${clientObj.uuid} activation failed. Missing/invalid WSMan response payload.`)
      } else if (clientObj.activationStatus.activated && clientObj.activationStatus.changePassword) {
        const result = await updateAMTAdminPassword(clientId, wsmanResponse, this.responseMsg, this.clientManager, this.configurator, this.validator, httpHandler)
        if (result.method === 'success') {
          clientObj.activationStatus.changePassword = false
          this.clientManager.setClientObject(clientObj)
          this.logger.debug(`${clientId} : AMT admin password updated: ${clientObj.uuid}`)
          return await this.waitAfterActivation(clientId, clientObj, wsmanResponse, httpHandler)
        } else if (result.method === 'error') {
          throw new RPSError(`Device ${clientObj.uuid} failed to update AMT password.`)
        } else {
          return result
        }
      } else if (clientObj.activationStatus.activated) {
        const msg = await this.waitAfterActivation(clientId, clientObj, wsmanResponse, httpHandler)
        return msg
      } else {
        const msg = await this.processWSManJsonResponse(message, clientId, httpHandler)
        if (msg) {
          return msg
        }
      }

      if (clientObj.ClientData.payload.fwNonce && clientObj.action === ClientAction.ADMINCTLMODE) {
        const msg = await this.performACMSteps(clientId, clientObj, httpHandler)
        if (msg) {
          return msg
        }
      }
      if (((clientObj.action === ClientAction.ADMINCTLMODE && clientObj.certObj && clientObj.count > clientObj.certObj.certChain.length) || (clientObj.action === ClientAction.CLIENTCTLMODE)) && !clientObj.activationStatus.activated) {
        const amtPassword: string = await this.configurator.profileManager.getAmtPassword(clientObj.ClientData.payload.profile.profileName)
        clientObj.amtPassword = amtPassword
        this.clientManager.setClientObject(clientObj)

        const data: string = `admin:${clientObj.ClientData.payload.digestRealm}:${amtPassword}`
        const password = SignatureHelper.createMd5Hash(data)
        let xmlRequestBody = ''
        if (clientObj.action === ClientAction.ADMINCTLMODE) {
          await this.createSignedString(clientObj)
          // Activate in ACM
          xmlRequestBody = this.ips.HostBasedSetupService(IPS.Methods.ADMIN_SETUP, (httpHandler.messageId++).toString(), 2, password, clientObj.nonce.toString('base64'), 2, clientObj.signature)
        } else {
          // Activate in CCM
          xmlRequestBody = this.ips.HostBasedSetupService(IPS.Methods.SETUP, (httpHandler.messageId++).toString(), 2, password)
        }
        const wsmanRequest = httpHandler.wrapIt(xmlRequestBody)
        return this.responseMsg.get(clientId, wsmanRequest, 'wsman', 'ok', 'alls good!')
      }
    } catch (error) {
      this.logger.error(`${clientId} : Failed to activate - ${error}`)
      MqttProvider.publishEvent('fail', ['Activator'], 'Failed to activate', clientObj.uuid)
      if (error instanceof RPSError) {
        clientObj.status.Status = error.message
      } else {
        clientObj.status.Status = 'Failed'
      }
      return this.responseMsg.get(clientId, null, 'error', 'failed', JSON.stringify(clientObj.status))
    }
  }

  /**
   * @description check for the matching certificates
   * @param {string} clientId Id to keep track of connections
   * @param {string} cert
   * @param {string} password
   * @returns {any} returns cert object
   */
  GetProvisioningCertObj (clientMsg: ClientMsg, cert: string, password: string, clientId: string): any {
    // TODO: Look to change this to return a type
    try {
      // read in cert
      const pfxb64: string = Buffer.from(cert, 'base64').toString('base64')
      // convert the certificate pfx to an object
      const pfxobj = this.certManager.convertPfxToObject(pfxb64, password)
      if (pfxobj.errorText) {
        return pfxobj
      }
      // return the certificate chain pems and private key
      const certChainPfx = this.certManager.dumpPfx(pfxobj)
      // check that provisioning certificate root matches one of the trusted roots from AMT
      for (const hash in clientMsg.payload.certHashes) {
        if (clientMsg.payload.certHashes[hash]?.toLowerCase() === certChainPfx.fingerprint?.toLowerCase()) {
          return certChainPfx.provisioningCertificateObj
        }
      }
    } catch (error) {
      this.logger.error(`${clientId} : Failed to get provisioning certificate. Error: ${error}`)
      return null
    }
  }

  /**
   * @description Parse the wsman response received from AMT
   * @param {string} clientId Id to keep track of connections
   * @param {string} message
   */
  async processWSManJsonResponse (message: any, clientId: string, httpHandler?: HttpHandler): Promise<ClientMsg> {
    const clientObj = this.clientManager.getClientObject(clientId)
    console.log('message :', message)
    const wsmanResponse = message.payload
    switch (wsmanResponse.statusCode) {
      case 401: {
        const xmlRequestBody = this.amt.GeneralSettings(AMT.Methods.GET, (httpHandler.messageId++).toString())
        const data = httpHandler.wrapIt(xmlRequestBody)
        return this.responseMsg.get(clientId, data, 'wsman', 'ok', 'alls good!')
      }
      case 200: {
        const xmlBody = parseBody(wsmanResponse)
        // pares WSMan xml response to json
        const response = httpHandler.parseXML(xmlBody)
        const method = response.Envelope.Header.ResourceURI.split('/').pop()
        switch (method) {
          case 'AMT_GeneralSettings': {
            return await this.validateGeneralSettings(clientId, clientObj, response, httpHandler)
          }
          case 'IPS_HostBasedSetupService': {
            return await this.validateHostBasedSetupService(clientId, clientObj, response, httpHandler)
          }
          default: {
            throw new RPSError(`Device ${clientObj.uuid} failed to activate`)
          }
        }
      }
      default: {
        throw new RPSError(`Device ${clientObj.uuid} failed to activate`)
      }
    }
  }

  // Todo: Remove any
  async validateGeneralSettings (clientId: string, clientObj: ClientObject, response: any, httpHandler: HttpHandler): Promise<ClientMsg> {
    const digestRealm = response.Envelope.Body.AMT_GeneralSettings.DigestRealm
    // Validate Digest Realm
    if (!this.validator.isDigestRealmValid(digestRealm)) {
      throw new RPSError(`Device ${clientObj.uuid} activation failed. Not a valid digest realm.`)
    }
    clientObj.ClientData.payload.digestRealm = digestRealm
    clientObj.hostname = clientObj.ClientData.payload.hostname
    this.clientManager.setClientObject(clientObj)
    if (clientObj.ClientData.payload.fwNonce == null && clientObj.action === ClientAction.ADMINCTLMODE) {
      const xmlRequestBody = this.ips.HostBasedSetupService(IPS.Methods.GET, (httpHandler.messageId++).toString())
      const data = httpHandler.wrapIt(xmlRequestBody)
      return this.responseMsg.get(clientId, data, 'wsman', 'ok', 'alls good!')
    }
    return null
  }

  // Todo: Remove any
  async validateHostBasedSetupService (clientId: string, clientObj: ClientObject, response: any, httpHandler: HttpHandler): Promise<ClientMsg> {
    const action = response.Envelope.Header.Action.split('/').pop()
    switch (action) {
      case 'GetResponse': {
        clientObj.ClientData.payload.fwNonce = Buffer.from(response.Envelope.Body.IPS_HostBasedSetupService.ConfigurationNonce, 'base64')
        clientObj.ClientData.payload.modes = response.Envelope.Body.IPS_HostBasedSetupService.AllowedControlModes
        this.clientManager.setClientObject(clientObj)
        return null
      }
      case 'AddNextCertInChainResponse': {
        // Response from injectCertificate call
        if (response.Envelope.Body.AddNextCertInChain_OUTPUT.ReturnValue !== 0) {
          throw new RPSError(`Device ${clientObj.uuid} activation failed. Error while adding the certificates to AMT.`)
        }
        this.logger.debug(`cert added to AMT device ${clientObj.uuid}`)
        return null
      }
      case 'AdminSetupResponse': {
        if (response.Envelope.Body.AdminSetup_OUTPUT.ReturnValue !== 0) {
          throw new RPSError(`Device ${clientObj.uuid} activation failed. Error while activating the AMT device in admin mode.`)
        }
        this.logger.debug(`Device ${clientObj.uuid} activated in admin mode.`)
        clientObj.status.Status = 'Admin control mode.'
        clientObj.activationStatus.activated = true
        this.clientManager.setClientObject(clientObj)
        await this.saveDeviceInfoToVault(clientObj)
        await this.saveDeviceInfoToMPS(clientObj)
        const msg = await this.waitAfterActivation(clientId, clientObj, null, httpHandler)
        MqttProvider.publishEvent('success', ['Activator', 'execute'], 'Device activated in admin control mode', clientObj.uuid)
        return msg
      }
      case 'SetupResponse': {
        if (response.Envelope.Body.Setup_OUTPUT.ReturnValue !== 0) {
          throw new RPSError(`Device ${clientObj.uuid} activation failed. Error while activating the AMT device in client mode.`)
        }
        this.logger.debug(`Device ${clientObj.uuid} activated in client mode.`)
        clientObj.status.Status = 'Client control mode'
        clientObj.activationStatus.activated = true
        this.clientManager.setClientObject(clientObj)
        await this.saveDeviceInfoToVault(clientObj)
        await this.saveDeviceInfoToMPS(clientObj)
        const msg = await this.waitAfterActivation(clientId, clientObj, null, httpHandler)
        MqttProvider.publishEvent('success', ['Activator', 'execute'], 'Device activated in client control mode', clientObj.uuid)
        return msg
      }
    }
  }

  /**
   * @description Waiting for few seconds after activation as required by AMT
   * @param {string} clientId Id to keep track of connections
   * @param {ClientObject} clientObj
   * @returns {ClientMsg} returns message to client
   */
  async waitAfterActivation (clientId: string, clientObj: ClientObject, wsmanResponse: any = null, httpHandler: HttpHandler): Promise<ClientMsg> {
    if (clientObj.delayEndTime == null) {
      this.logger.debug(`waiting for ${EnvReader.GlobalEnvConfig.delayTimer} seconds after activation`)
      const endTime: Date = new Date()
      clientObj.delayEndTime = endTime.setSeconds(endTime.getSeconds() + EnvReader.GlobalEnvConfig.delayTimer)
      this.clientManager.setClientObject(clientObj)
      this.logger.debug(`Delay end time : ${clientObj.delayEndTime}`)
    }
    const currentTime = new Date().getTime()
    if (currentTime >= clientObj.delayEndTime || clientObj.activationStatus.missingMebxPassword) {
      this.logger.debug(`Delay ${EnvReader.GlobalEnvConfig.delayTimer} seconds after activation completed`)
      /* Update the wsman stack username and password */
      httpHandler.connectionParams.username = AMTUserName
      httpHandler.connectionParams.password = clientObj.amtPassword
      if (clientObj.action === ClientAction.ADMINCTLMODE) {
        /* Set MEBx password called after the activation as the API is accessible only with admin user */
        const result = await setMEBXPassword(clientId, wsmanResponse, this.responseMsg, this.clientManager, this.configurator, httpHandler)
        // Response from setMEBxPassword call
        if (result.method !== 'success' && result.method !== 'error') {
          return result
        } else if (result.method === 'success') {
          this.logger.debug(`Device ${clientObj.uuid} MEBx password updated.`)
        } else if (result.method === 'error') {
          this.logger.debug(`Device ${clientObj.uuid} failed to update MEBx password.`)
        }
        clientObj.action = ClientAction.NETWORKCONFIG
        this.clientManager.setClientObject(clientObj)
        await this.networkConfigurator.execute(null, clientId)
      } else if (clientObj.action === ClientAction.CLIENTCTLMODE) {
        clientObj.action = ClientAction.NETWORKCONFIG
        this.clientManager.setClientObject(clientObj)
        await this.networkConfigurator.execute(null, clientId)
      }
    } else {
      this.logger.debug(`Current Time: ${currentTime} Delay end time : ${clientObj.delayEndTime}`)
      return this.responseMsg.get(clientId, null, 'heartbeat_request', 'heartbeat', '')
    }
  }

  /**
   * @description Performs the ACM specific steps
   * @param {string} clientId Id to keep track of connections
   * @param {ClientObject} clientObj
   */
  async performACMSteps (clientId: string, clientObj: ClientObject, httpHandler: HttpHandler): Promise<ClientMsg> {
    if (!clientObj.count) {
      clientObj.count = 1
      const amtDomain: AMTDomain = await this.configurator.domainCredentialManager.getProvisioningCert(clientObj.ClientData.payload.fqdn)
      this.logger.debug(`domain : ${JSON.stringify(amtDomain)}`)
      // Verify that the certificate path points to a file that exists
      if (!amtDomain.provisioningCert) {
        MqttProvider.publishEvent('fail', ['Activator'], 'Failed to activate. AMT provisioning certificate not found on server', clientObj.uuid)
        throw new RPSError(`Device ${clientObj.uuid} activation failed. AMT provisioning certificate not found on server`)
      }
      clientObj.certObj = this.GetProvisioningCertObj(clientObj.ClientData, amtDomain.provisioningCert, amtDomain.provisioningCertPassword, clientId)
      if (clientObj.certObj) {
        // Check if we got an error while getting the provisioning cert object
        if (clientObj.certObj.errorText) {
          MqttProvider.publishEvent('fail', ['Activator'], 'Failed to activate', clientObj.uuid)
          throw new RPSError(clientObj.certObj.errorText)
        }
      } else {
        MqttProvider.publishEvent('fail', ['Activator'], 'Failed to activate. Provisioning certificate doesn\'t match any trusted certificates from AMT', clientObj.uuid)
        throw new RPSError(`Device ${clientObj.uuid} activation failed. Provisioning certificate doesn't match any trusted certificates from AMT`)
      }
    }
    return await this.injectCertificate(clientId, clientObj, httpHandler)
  }

  /**
  * @description Injects provisoining certificate into AMT
  * @param {string} clientId Id to keep track of connections
  * @param {ClientObject} clientObj
  */
  async injectCertificate (clientId: string, clientObj: ClientObject, httpHandler: HttpHandler): Promise<ClientMsg> {
    let data
    // inject certificates in proper order with proper flags
    if (clientObj.count <= clientObj.certObj.certChain.length) {
      if (clientObj.count === 1) {
        const xmlRequestBody = this.ips.HostBasedSetupService(IPS.Methods.ADD_NEXT_CERT_IN_CHAIN, (httpHandler.messageId++).toString(), null, null, null, null, null, clientObj.certObj.certChain[clientObj.count - 1], true, false)
        data = httpHandler.wrapIt(xmlRequestBody)
      } else if (clientObj.count > 1 && clientObj.count < clientObj.certObj.certChain.length) {
        const xmlRequestBody = this.ips.HostBasedSetupService(IPS.Methods.ADD_NEXT_CERT_IN_CHAIN, (httpHandler.messageId++).toString(), null, null, null, null, null, clientObj.certObj.certChain[clientObj.count - 1], false, false)
        data = httpHandler.wrapIt(xmlRequestBody)
      } else if (clientObj.count === clientObj.certObj.certChain.length) {
        const xmlRequestBody = this.ips.HostBasedSetupService(IPS.Methods.ADD_NEXT_CERT_IN_CHAIN, (httpHandler.messageId++).toString(), null, null, null, null, null, clientObj.certObj.certChain[clientObj.count - 1], false, true)
        data = httpHandler.wrapIt(xmlRequestBody)
      }
      ++clientObj.count
      this.clientManager.setClientObject(clientObj)
      return this.responseMsg.get(clientId, data, 'wsman', 'ok', 'alls good!')
    }
  }

  /**
   * @description Creates the signed string required by AMT
   * @param {ClientObject} clientObj
   */
  async createSignedString (clientObj: ClientObject): Promise<void> {
    clientObj.nonce = PasswordHelper.generateNonce()
    const arr: Buffer[] = [clientObj.ClientData.payload.fwNonce, clientObj.nonce]
    clientObj.signature = this.signatureHelper.signString(Buffer.concat(arr), clientObj.certObj.privateKey)
    this.clientManager.setClientObject(clientObj)
    if (clientObj.signature.errorText) {
      MqttProvider.publishEvent('fail', ['Activator'], 'Failed to activate', clientObj.uuid)
      throw new RPSError(clientObj.signature.errorText)
    }
  }

  /**
   * @description Saves the AMT device information to the database
   * @param {ClientObject} clientObj
   * @param {string} amtPassword
   */
  async saveDeviceInfoToVault (clientObj: ClientObject): Promise<boolean> {
    if (this.configurator?.amtDeviceRepository) {
      if (clientObj.action === ClientAction.ADMINCTLMODE) {
        await this.configurator.amtDeviceRepository.insert(new AMTDeviceDTO(clientObj.uuid,
          clientObj.hostname,
          clientObj.mpsUsername,
          clientObj.mpsPassword,
          EnvReader.GlobalEnvConfig.amtusername,
          clientObj.amtPassword,
          clientObj.mebxPassword
        ))
        return true
      } else {
        await this.configurator.amtDeviceRepository.insert(new AMTDeviceDTO(clientObj.uuid,
          clientObj.hostname,
          clientObj.mpsUsername,
          clientObj.mpsPassword,
          EnvReader.GlobalEnvConfig.amtusername,
          clientObj.amtPassword,
          null))
      }
      return true
    } else {
      MqttProvider.publishEvent('fail', ['Activator'], 'Unable to write device', clientObj.uuid)
      this.logger.error('unable to write device')
    }
    return false
  }

  async saveDeviceInfoToMPS (clientObj: ClientObject): Promise<boolean> {
    /* Register device metadata with MPS */
    try {
      const profile = await this.configurator.profileManager.getAmtProfile(clientObj.ClientData.payload.profile.profileName)
      let tags = []
      if (profile?.tags != null) {
        tags = profile.tags
      }
      await got(`${EnvReader.GlobalEnvConfig.mpsServer}/api/v1/devices`, {
        method: 'POST',
        json: {
          guid: clientObj.uuid,
          hostname: clientObj.hostname,
          mpsusername: clientObj.mpsUsername,
          tags: tags,
          tenantId: profile.tenantId
        }
      })
      return true
    } catch (err) {
      MqttProvider.publishEvent('fail', ['Activator'], 'unable to register metadata with MPS', clientObj.uuid)
      this.logger.error('unable to register metadata with MPS', err)
    }
    return false
  }
}
