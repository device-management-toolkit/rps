/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { AMT, IPS, CIM } from '@device-management-toolkit/wsman-messages'
import { assign, createActor, fromPromise, sendTo, setup } from 'xstate'
import { ClientAction } from '../models/RCS.Config.js'
import { HttpHandler } from '../HttpHandler.js'
import Logger from '../Logger.js'
import { type AMTConfiguration, type AMTDomain } from '../models/index.js'
import { Environment } from '../utils/Environment.js'
import { MqttProvider } from '../utils/MqttProvider.js'
import { devices } from '../devices.js'
import got from 'got'
import { CertManager } from '../certManager.js'
import { PasswordHelper } from '../utils/PasswordHelper.js'
import { SignatureHelper } from '../utils/SignatureHelper.js'
import { Error } from './error.js'
import { FeaturesConfiguration } from './featuresConfiguration.js'
import { NodeForge } from '../NodeForge.js'
import { Configurator } from '../Configurator.js'
import { Validator } from '../Validator.js'
import { DbCreatorFactory } from '../factories/DbCreatorFactory.js'
import { AMTUserName, GATEWAY_TIMEOUT_ERROR } from '../utils/constants.js'
import { CIRAConfiguration } from './ciraConfiguration.js'
import { TLS } from './tls.js'
import { type CommonContext, invokeWsmanCall } from './common.js'
import ClientResponseMsg from '../utils/ClientResponseMsg.js'
import { Unconfiguration } from './unconfiguration.js'
import { type DeviceCredentials } from '../interfaces/ISecretManagerService.js'
import { NetworkConfiguration } from './networkConfiguration.js'
import { error } from 'console'

export interface ActivationContext extends CommonContext {
  profile: AMTConfiguration
  amtDomain: AMTDomain | null
  status: 'success' | 'error'
  errorMessage: string
  generalSettings: AMT.Models.GeneralSettings
  isActivated?: boolean
  hasToUpgrade?: boolean
  amt: AMT.Messages
  ips: IPS.Messages
  cim: CIM.Messages
  certChainPfx: any
  tenantId: string
  canActivate: boolean
  shbcCCMComplete: boolean
  shbcACMComplete: boolean
  friendlyName?: string | null
}

export interface ActivationEvent {
  type: 'ACTIVATION' | 'ACTIVATED' | 'ONFAILED'
  clientId: string
  output?: any
  tenantId: string
  friendlyName: string
}

export class Activation {
  nodeForge: NodeForge
  certManager: CertManager
  signatureHelper: SignatureHelper
  configurator: Configurator
  validator: Validator
  logger: Logger
  dbFactory: DbCreatorFactory
  db: any
  error: Error = new Error()
  networkConfiguration: NetworkConfiguration = new NetworkConfiguration()
  featuresConfiguration: FeaturesConfiguration = new FeaturesConfiguration()
  cira: CIRAConfiguration = new CIRAConfiguration()
  unconfiguration: Unconfiguration = new Unconfiguration()
  tls: TLS = new TLS()

  updateCredentials({ context }): void {
    const device = devices[context.clientId]
    if (device.connectionParams != null && device.amtPassword != null) {
      device.connectionParams.username = AMTUserName
      device.connectionParams.password = device.amtPassword
    }
  }

  getAMTProfile = async ({ input }: { input: ActivationContext }): Promise<AMTConfiguration | null> => {
    this.db = await this.dbFactory.getDb()
    const profile = await this.configurator.profileManager.getAmtProfile(
      devices[input.clientId].ClientData.payload.profile.profileName,
      input.tenantId
    )
    return profile
  }

  getDeviceFromMPS = async ({ input }: { input: ActivationContext }): Promise<any> => {
    const clientObj = devices[input.clientId]
    try {
      if (input.profile != null) {
        const result = await got(
          `${Environment.Config.mps_server}/api/v1/devices/${clientObj.uuid}?tenantId=${input.profile.tenantId}`,
          {
            method: 'GET'
          }
        )

        if (result?.body != null && result?.body !== '') {
          return true // if we have a result the device is already in their tenant and can activated
        }
      } else {
        this.logger.error('Null object in getDeviceFromMPS()')
      }
      return false // if we have a success repsonse, but no result -- it means the device belongs to another tenant --
      // prevent activation without unprovision first.
    } catch (err) {
      return true // no one has registered this device and can be activated
    }
  }

  getAMTDomainCert = async ({ input }: { input: ActivationContext }): Promise<AMTDomain | null> => {
    const domain = await this.configurator.domainCredentialManager.getProvisioningCert(
      devices[input.clientId].ClientData.payload.fqdn,
      input.tenantId
    )
    return domain
  }

  sendMessageToDevice({ context }): void {
    const { clientId, status } = context
    const clientObj = devices[clientId]
    let method: 'failed' | 'success' | 'ok' | 'heartbeat' | null = null
    if (status === 'success') {
      method = 'success'
    } else {
      clientObj.status.Status = context.errorMessage !== '' ? context.errorMessage : 'Failed'
      method = 'failed'
    }
    const responseMessage = ClientResponseMsg.get(clientId, null, status, method, JSON.stringify(clientObj.status))
    this.logger.info(JSON.stringify(responseMessage, null, '\t'))
    devices[clientId].ClientSocket?.send(JSON.stringify(responseMessage))
  }

  createSignedString(clientId: string, hashAlgorithm: string): boolean {
    const clientObj = devices[clientId]
    clientObj.nonce = PasswordHelper.generateNonce()
    const arr: Buffer[] = [clientObj.ClientData.payload.fwNonce, clientObj.nonce]
    try {
      if (clientObj.certObj != null) {
        clientObj.signature = this.signatureHelper.signString(
          Buffer.concat(arr),
          clientObj.certObj.privateKey,
          hashAlgorithm
        )
        return true
      } else {
        return false
      }
    } catch (err) {
      MqttProvider.publishEvent('fail', ['Activator'], 'Failed to activate', clientObj.uuid)
      return false
    }
  }

  getGeneralSettings = async ({ input }: { input: ActivationContext }): Promise<any> => {
    const amt: AMT.Messages = input.amt
    input.xmlMessage = amt.GeneralSettings.Get()
    return await invokeWsmanCall(input, 2)
  }

  getHostBasedSetupService = async ({ input }: { input: ActivationContext }): Promise<any> => {
    const ips: IPS.Messages = input.ips
    input.xmlMessage = ips.HostBasedSetupService.Get()
    return await invokeWsmanCall(input, 2)
  }

  getNextCERTInChain = async ({ input }: { input: ActivationContext }): Promise<any> => {
    input.xmlMessage = this.injectCertificate(input.clientId, input.ips)
    return await invokeWsmanCall(input)
  }

  getPassword = async (input: ActivationContext): Promise<string> => {
    const amtPassword: string | null = await this.configurator.profileManager.getAmtPassword(
      input.profile.profileName,
      input.tenantId
    )
    devices[input.clientId].amtPassword = amtPassword
    if (input.profile.activation === ClientAction.ADMINCTLMODE) {
      const mebxPassword: string | null = await this.configurator.profileManager.getMEBxPassword(
        input.profile.profileName,
        input.tenantId
      )
      devices[input.clientId].mebxPassword = mebxPassword
    }
    const data = `admin:${devices[input.clientId].ClientData.payload.digestRealm}:${amtPassword}`
    const password = SignatureHelper.createMd5Hash(data)
    return password
  }

  sendAdminSetup = async ({ input }: { input: ActivationContext }): Promise<any> => {
    const ips: IPS.Messages = input.ips
    const { clientId, certChainPfx } = input
    const password = await this.getPassword(input)
    this.createSignedString(clientId, certChainPfx.hashAlgorithm)
    const clientObj = devices[clientId]
    if (clientObj.nonce != null && clientObj.signature != null) {
      input.xmlMessage = ips.HostBasedSetupService.AdminSetup(
        2,
        password,
        clientObj.nonce.toString('base64'),
        2,
        clientObj.signature
      )
      return await invokeWsmanCall(input)
    }
    return null
  }

  sendUpgradeClientToAdmin = async ({ input }: { input: ActivationContext }): Promise<any> => {
    const ips: IPS.Messages = input.ips
    const { clientId, certChainPfx } = input
    this.createSignedString(clientId, certChainPfx.hashAlgorithm)
    const clientObj = devices[clientId]
    if (clientObj.nonce != null && clientObj.signature != null) {
      input.xmlMessage = ips.HostBasedSetupService.UpgradeClientToAdmin(
        clientObj.nonce.toString('base64'),
        2,
        clientObj.signature
      )
      return await invokeWsmanCall(input)
    }
    return null
  }

  getActivationStatus = async ({ input }: { input: ActivationContext }): Promise<any> => {
    const ips: IPS.Messages = input.ips
    input.xmlMessage = ips.HostBasedSetupService.Get()
    return await invokeWsmanCall(input)
  }

  sendClientSetup = async ({ input }: { input: ActivationContext }): Promise<any> => {
    const ips: IPS.Messages = input.ips
    const password = await this.getPassword(input)
    input.xmlMessage = ips.HostBasedSetupService.Setup(2, password)
    return await invokeWsmanCall(input)
  }

  changeAMTPassword = async ({ input }: { input: ActivationContext }): Promise<any> => {
    const amt: AMT.Messages = input.amt
    const password = await this.getPassword(input)
    // Convert MD5 hash to raw string which utf16
    const passwordMatch = password.match(/../g) ?? []
    const result = passwordMatch.map((v) => String.fromCharCode(parseInt(v, 16))).join('')
    // Encode to base64
    const encodedPassword = Buffer.from(result, 'binary').toString('base64')
    input.xmlMessage = amt.AuthorizationService.SetAdminACLEntryEx(AMTUserName, encodedPassword)
    return await invokeWsmanCall(input)
  }

  setMEBxPassword = async ({ input }: { input: ActivationContext }): Promise<any> => {
    const amt = new AMT.Messages()
    const mebxPassword = devices[input.clientId].mebxPassword
    if (mebxPassword != null) {
      input.xmlMessage = amt.SetupAndConfigurationService.SetMEBXPassword(mebxPassword)
      return await invokeWsmanCall(input)
    }
    return null
  }

  injectCertificate(clientId: string, ips: IPS.Messages): string | null {
    const clientObj = devices[clientId]
    // inject certificates in proper order with proper flags
    if (clientObj.count != null && clientObj.certObj != null) {
      if (clientObj.count <= clientObj.certObj.certChain.length) {
        let xmlRequestBody = ''
        let isLeaf = false
        let isRoot = false
        if (clientObj.count === 1) {
          isLeaf = true
        } else if (clientObj.count === clientObj.certObj.certChain.length) {
          isRoot = true
        }
        xmlRequestBody = ips.HostBasedSetupService.AddNextCertInChain(
          clientObj.certObj.certChain[clientObj.count - 1],
          isLeaf,
          isRoot
        )
        ++clientObj.count
        this.logger.debug(`xmlRequestBody ${clientObj.uuid} : ${xmlRequestBody}`)
        return xmlRequestBody
      }
    }
    return null
  }

  GetProvisioningCertObj({ context }): void {
    const { amtDomain, clientId } = context
    try {
      if (amtDomain?.provisioningCert != null && amtDomain.provisioningCertPassword != null) {
        // read in cert
        const pfxb64: string = Buffer.from(amtDomain.provisioningCert, 'base64').toString('base64')
        // convert the certificate pfx to an object
        const pfxobj = this.certManager.convertPfxToObject(pfxb64, amtDomain.provisioningCertPassword)
        // return the certificate chain pems and private key
        context.certChainPfx = this.certManager.dumpPfx(pfxobj)
      } else {
        throw error
      }
    } catch (error) {
      this.logger.error(`Device ${devices[clientId].uuid} Failed to get provisioning certificate.`)
      devices[clientId].certObj = null
    }
  }

  compareCertHashes({ context }): void {
    const { clientId, certChainPfx } = context
    // check that provisioning certificate root matches one of the trusted roots from AMT
    for (const hash in devices[clientId].ClientData.payload.certHashes) {
      if (
        devices[clientId].ClientData.payload.certHashes[hash]?.toLowerCase() ===
        certChainPfx.fingerprint?.sha256?.toLowerCase()
      ) {
        devices[clientId].certObj = certChainPfx.provisioningCertificateObj
      } else if (
        devices[clientId].ClientData.payload.certHashes[hash]?.toLowerCase() ===
        certChainPfx.fingerprint?.sha1?.toLowerCase()
      ) {
        devices[clientId].certObj = certChainPfx.provisioningCertificateObj
      }
    }
  }

  readGeneralSettings({ context }): void {
    const clientObj = devices[context.clientId]
    context.generalSettings = context.message.Envelope.Body.AMT_GeneralSettings
    clientObj.ClientData.payload.digestRealm =
      context.generalSettings != null ? context.generalSettings.DigestRealm : null
    clientObj.hostname = clientObj.ClientData.payload.hostname
  }

  readHostBasedSetupService({ context }): void {
    const resBody = context.message.Envelope.Body
    const clientObj = devices[context.clientId]
    clientObj.ClientData.payload.fwNonce = Buffer.from(resBody.IPS_HostBasedSetupService.ConfigurationNonce, 'base64')
    clientObj.ClientData.payload.modes = resBody.IPS_HostBasedSetupService.AllowedControlModes
  }

  setActivationStatus({ context }): void {
    const clientObj = devices[context.clientId]
    this.logger.debug(`Device ${clientObj.uuid} activated in ${clientObj.status.Status}.`)
    clientObj.activationStatus = true
    MqttProvider.publishEvent(
      'success',
      ['Activator', 'execute'],
      `Device activated in ${clientObj.status.Status}`,
      clientObj.uuid
    )
  }

  saveDeviceInfoToSecretProvider = async ({ input }: { input: ActivationContext }): Promise<boolean> => {
    const clientObj = devices[input.clientId]
    if (clientObj.amtPassword != null && (clientObj.mebxPassword != null || clientObj.action === 'ccmactivate')) {
      const data: DeviceCredentials = {
        AMT_PASSWORD: clientObj.amtPassword,
        MEBX_PASSWORD: clientObj.action === ClientAction.ADMINCTLMODE ? clientObj.mebxPassword : null
      }

      await this.configurator.secretsManager.writeSecretWithObject(`devices/${clientObj.uuid}`, data)
      return true
    }
    this.logger.error('Null object in saveDeviceInfoToSecretProvider()')
    return false
  }

  saveDeviceInfoToMPS = async ({ input }: { input: ActivationContext }): Promise<boolean> => {
    const { clientId, profile } = input
    const clientObj = devices[clientId]
    /* Register device metadata with MPS */
    try {
      const deviceInfo = {
        fwVersion: clientObj.ClientData.payload.ver,
        fwBuild: clientObj.ClientData.payload.build,
        fwSku: clientObj.ClientData.payload.sku,
        currentMode: clientObj.ClientData.payload.currentMode?.toString(),
        features: clientObj.ClientData.payload.features,
        ipAddress: clientObj.ClientData.payload.ipConfiguration?.ipAddress,
        lastUpdated: new Date()
      }
      const url = `${Environment.Config.mps_server}/api/v1/devices`
      const jsonData: any = {
        guid: clientObj.uuid,
        hostname: clientObj.hostname,
        mpsusername: clientObj.mpsUsername,
        tags: profile?.tags ?? [],
        tenantId: profile?.tenantId,
        dnsSuffix: clientObj.ClientData?.payload.fqdn,
        deviceInfo
      }
      // friendlyName with an empty string indicates clearing the value
      // otherwise, do not include the property so an update of the device
      // preserves existing value
      if (input.friendlyName != null) {
        jsonData.friendlyName = input.friendlyName
      }
      await got.post(url, { json: jsonData })
      return true
    } catch (err) {
      MqttProvider.publishEvent('fail', ['Activator'], 'unable to register metadata with MPS', clientObj.uuid)
      this.logger.error('unable to register metadata with MPS', err)
    }
    return false
  }

  commitChanges = async ({ input }: { input: ActivationContext }): Promise<any> => {
    input.xmlMessage = input.amt.SetupAndConfigurationService.CommitChanges()
    return await invokeWsmanCall(input)
  }

  machine = setup({
    types: {} as {
      context: ActivationContext
      events: ActivationEvent
      input: ActivationContext
    },
    actors: {
      getAMTProfile: fromPromise(this.getAMTProfile.bind(this)),
      getDeviceFromMPS: fromPromise(this.getDeviceFromMPS.bind(this)),
      getAMTDomainCert: fromPromise(this.getAMTDomainCert.bind(this)),
      getGeneralSettings: fromPromise(this.getGeneralSettings.bind(this)),
      getHostBasedSetupService: fromPromise(this.getHostBasedSetupService.bind(this)),
      getNextCERTInChain: fromPromise(this.getNextCERTInChain.bind(this)),
      sendAdminSetup: fromPromise(this.sendAdminSetup.bind(this)),
      sendUpgradeClientToAdmin: fromPromise(this.sendUpgradeClientToAdmin.bind(this)),
      sendClientSetup: fromPromise(this.sendClientSetup.bind(this)),
      commitChanges: fromPromise(this.commitChanges),
      getActivationStatus: fromPromise(this.getActivationStatus.bind(this)),
      setMEBxPassword: fromPromise(this.setMEBxPassword.bind(this)),
      saveDeviceInfoToSecretProvider: fromPromise(this.saveDeviceInfoToSecretProvider.bind(this)),
      saveDeviceInfoToMPS: fromPromise(this.saveDeviceInfoToMPS.bind(this)),
      changeAMTPassword: fromPromise(this.changeAMTPassword.bind(this)),
      unconfiguration: this.unconfiguration.machine,
      networkConfiguration: this.networkConfiguration.machine,
      featuresConfiguration: this.featuresConfiguration.machine,
      cira: this.cira.machine,
      tls: this.tls.machine,
      error: this.error.machine
    },
    delays: {
      DELAY_TIME_ACTIVATION_SYNC: () => Environment.Config.delay_activation_sync
    },
    guards: {
      isAdminMode: ({ context }) =>
        context.profile != null ? context.profile.activation === ClientAction.ADMINCTLMODE : false,
      isSHBC: ({ context }) => {
        const device = devices[context.clientId]
        if (context.profile != null && device.ClientData?.payload?.ver) {
          return (
            context.profile.activation === ClientAction.ADMINCTLMODE &&
            parseFloat(device.ClientData.payload.ver) >= 19 &&
            device.ClientData.payload.currentMode === 0 &&
            !context.shbcCCMComplete
          )
        }
        return false
      },
      isSHBCCMComplete: ({ context }) => context.shbcCCMComplete === true,
      isSHBCACMComplete: ({ context }) => context.shbcACMComplete === true,
      isCertExtracted: ({ context }) => context.certChainPfx != null,
      isValidCert: ({ context }) => devices[context.clientId].certObj != null,
      isDigestRealmInvalid: ({ context }) =>
        !this.validator.isDigestRealmValid(devices[context.clientId].ClientData.payload.digestRealm),
      maxCertLength: ({ context }) => {
        const device = devices[context.clientId]
        if (device.count != null && device.certObj != null) {
          return device.count <= device.certObj.certChain.length
        }
        return false
      },
      isDeviceAdminModeActivated: ({ context }) => context.message.Envelope.Body?.AdminSetup_OUTPUT?.ReturnValue === 0,
      isDeviceClientModeActivated: ({ context }) => context.message.Envelope.Body?.Setup_OUTPUT?.ReturnValue === 0,
      isDeviceActivatedInACM: ({ context }) =>
        context.message.Envelope.Body?.IPS_HostBasedSetupService?.CurrentControlMode === 2,
      isDeviceActivatedInCCM: ({ context }) =>
        context.message.Envelope.Body?.IPS_HostBasedSetupService?.CurrentControlMode === 1,
      isDeviceCommittedInCCM: ({ context }) => {
        const device = devices[context.clientId]
        return (
          context.message.Envelope.Body?.CommitChanges_OUTPUT?.ReturnValue === 0 &&
          parseFloat(device.ClientData.payload.ver) >= 19 &&
          context.profile?.activation === ClientAction.ADMINCTLMODE &&
          !context.shbcACMComplete
        )
      },
      isCertNotAdded: ({ context }) => context.message.Envelope.Body.AddNextCertInChain_OUTPUT.ReturnValue !== 0,
      isGeneralSettings: ({ context }) => context.targetAfterError === 'GET_GENERAL_SETTINGS',
      isMebxPassword: ({ context }) => context.targetAfterError === 'SET_MEBX_PASSWORD',
      isCheckActivationOnAMT: ({ context }) => context.targetAfterError === 'CHECK_ACTIVATION_ON_AMT',
      isUpgraded: ({ context }) => context.message.Envelope.Body.UpgradeClientToAdmin_OUTPUT.ReturnValue === 0,
      hasCIRAProfile: ({ context }) => (context.profile != null ? context.profile.ciraConfigName != null : false),
      isActivated: ({ context }) => (context.isActivated != null ? context.isActivated : false),
      canActivate: ({ context }) => context.canActivate,
      hasToUpgrade: ({ context }) => (context.hasToUpgrade != null ? context.hasToUpgrade : false),
      canUpgrade: ({ context }) => {
        if (context.profile != null && context.isActivated != null) {
          return (
            (devices[context.clientId].ClientData.payload.currentMode === 1 || context.shbcCCMComplete === true) &&
            context.profile.activation === ClientAction.ADMINCTLMODE
          )
        }

        return false
      }
    },
    actions: {
      'Reset Unauth Count': ({ context }) => {
        devices[context.clientId].unauthCount = 0
      },
      'Read General Settings': this.readGeneralSettings.bind(this),
      'Read Host Based Setup Service': this.readHostBasedSetupService.bind(this),
      'Set activation status': this.setActivationStatus.bind(this),
      'Send Message to Device': this.sendMessageToDevice.bind(this),
      'Get Provisioning CertObj': this.GetProvisioningCertObj.bind(this),
      'Compare Domain Cert Hashes': this.compareCertHashes.bind(this),
      'Update AMT Credentials': this.updateCredentials.bind(this)
    }
  }).createMachine({
    context: ({ input }) => ({
      profile: input.profile,
      amtDomain: input.amtDomain,
      message: input.message,
      clientId: input.clientId,
      xmlMessage: input.xmlMessage,
      status: input.status,
      errorMessage: input.errorMessage,
      tenantId: input.tenantId,
      canActivate: input.canActivate,
      hasToUpgrade: input.hasToUpgrade,
      shbcCCMComplete: input.shbcCCMComplete,
      shbcACMComplete: input.shbcACMComplete,
      generalSettings: input.generalSettings,
      targetAfterError: input.targetAfterError,
      httpHandler: new HttpHandler(),
      isActivated: input.isActivated,
      certChainPfx: input.certChainPfx,
      amt: new AMT.Messages(),
      ips: new IPS.Messages(),
      cim: new CIM.Messages(),
      friendlyName: input.friendlyName
    }),
    id: 'activation-machine',
    initial: 'UNPROVISIONED',
    states: {
      UNPROVISIONED: {
        on: {
          ACTIVATION: {
            actions: assign({
              clientId: ({ event }) => event.clientId,
              isActivated: () => false,
              tenantId: ({ event }) => event.tenantId,
              friendlyName: ({ event }) => event.friendlyName
            }),
            target: 'GET_AMT_PROFILE'
          },
          ACTIVATED: {
            actions: assign({
              clientId: ({ event }) => event.clientId,
              isActivated: () => true,
              tenantId: ({ event }) => event.tenantId,
              friendlyName: ({ event }) => event.friendlyName
            }),
            target: 'GET_AMT_PROFILE'
          }
        }
      },
      GET_AMT_PROFILE: {
        invoke: {
          src: 'getAMTProfile',
          input: ({ context }) => context,
          id: 'get-amt-profile',
          onDone: {
            actions: assign({ profile: ({ event }) => (event as any).output }),
            target: 'CHECK_PROFILE_TYPE'
          },
          onError: {
            actions: assign({ errorMessage: 'Failed to get amt profile from database' }),
            target: 'FAILED'
          }
        }
      },
      CHECK_PROFILE_TYPE: {
        always: [
          {
            guard: 'isActivated',
            target: 'CHECK_TENANT_ACCESS'
          },
          {
            guard: 'isSHBC',
            target: 'GET_GENERAL_SETTINGS'
          },
          {
            guard: 'isAdminMode',
            target: 'GET_AMT_DOMAIN_CERT'
          },
          {
            target: 'GET_GENERAL_SETTINGS'
          }
        ]
      },
      CHECK_TENANT_ACCESS: {
        invoke: {
          src: 'getDeviceFromMPS',
          input: ({ context }) => context,
          id: 'check-tenant-access',
          onDone: {
            actions: assign({ canActivate: ({ event }) => event.output as any }),
            target: 'DETERMINE_CAN_ACTIVATE'
          },
          onError: {
            target: 'GET_GENERAL_SETTINGS'
          }
        }
      },
      DETERMINE_CAN_ACTIVATE: {
        always: [
          {
            guard: 'isSHBC',
            target: 'GET_GENERAL_SETTINGS'
          },
          {
            guard: 'canUpgrade',
            actions: assign({ hasToUpgrade: () => true }),
            target: 'GET_AMT_DOMAIN_CERT'
          },
          {
            guard: 'canActivate',
            target: 'GET_GENERAL_SETTINGS'
          },
          {
            actions: assign({
              errorMessage: 'Device belongs to another tenant. Please unprovision and re-activate device.'
            }),
            target: 'FAILED'
          }
        ]
      },
      GET_AMT_DOMAIN_CERT: {
        invoke: {
          src: 'getAMTDomainCert',
          input: ({ context }) => context,
          id: 'get-amt-domain',
          onDone: {
            actions: assign({ amtDomain: ({ event }) => event.output as any }),
            target: 'EXTRACT_DOMAIN_CERT'
          },
          onError: {
            actions: assign({ errorMessage: 'Failed to get amt domain certificate from database' }),
            target: 'FAILED'
          }
        }
      },
      EXTRACT_DOMAIN_CERT: {
        entry: 'Get Provisioning CertObj',
        always: [
          {
            guard: 'isCertExtracted',
            actions: ({ context }) => {
              devices[context.clientId].count = 1
            },
            target: 'COMPARE_DEVICE_HASHES'
          },
          {
            actions: assign({ errorMessage: 'Failed to extract domain certificate' }),
            target: 'FAILED'
          }
        ]
      },
      COMPARE_DEVICE_HASHES: {
        entry: 'Compare Domain Cert Hashes',
        always: [
          {
            guard: 'isValidCert',
            actions: ({ context }) => {
              devices[context.clientId].count = 1
            },
            target: 'GET_GENERAL_SETTINGS'
          },
          {
            actions: assign({
              errorMessage:
                'Invalid domain certificate, hash does not exists in list of trusted root certificates on AMT'
            }),
            target: 'FAILED'
          }
        ]
      },
      GET_GENERAL_SETTINGS: {
        invoke: {
          src: 'getGeneralSettings',
          input: ({ context }) => context,
          id: 'send-generalsettings',
          onDone: {
            actions: [assign({ message: ({ event }) => event.output }), 'Reset Unauth Count'],
            target: 'READ_GENERAL_SETTINGS'
          },
          onError: {
            actions: assign({
              message: ({ event }) => event.error,
              targetAfterError: ({ event }) => 'GET_GENERAL_SETTINGS'
            }),
            target: 'ERROR'
          }
        }
      },
      READ_GENERAL_SETTINGS: {
        entry: 'Read General Settings',
        always: {
          target: 'CHECK_DIGEST_REALM'
        }
      },
      CHECK_DIGEST_REALM: {
        always: [
          {
            guard: 'isDigestRealmInvalid',
            target: 'INVALID_DIGEST_REALM'
          },
          {
            guard: 'canUpgrade',
            target: 'IPS_HOST_BASED_SETUP_SERVICE'
          },
          {
            guard: 'isActivated',
            target: 'CHANGE_AMT_PASSWORD'
          },
          {
            guard: 'isSHBC',
            target: 'SETUP'
          },
          {
            guard: 'isAdminMode',
            target: 'IPS_HOST_BASED_SETUP_SERVICE'
          },
          {
            target: 'SETUP'
          }
        ]
      },
      IPS_HOST_BASED_SETUP_SERVICE: {
        invoke: {
          src: 'getHostBasedSetupService',
          input: ({ context }) => context,
          id: 'send-hostbasedsetup',
          onDone: {
            actions: [assign({ message: ({ event }) => event.output }), 'Read Host Based Setup Service'],
            target: 'ADD_NEXT_CERT_IN_CHAIN'
          },
          onError: {
            target: 'ERROR'
          }
        }
      },
      ADD_NEXT_CERT_IN_CHAIN: {
        invoke: {
          src: 'getNextCERTInChain',
          input: ({ context }) => context,
          id: 'send-certificate',
          onDone: {
            actions: assign({ message: ({ event }) => event.output }),
            target: 'CHECK_CERT_CHAIN_RESPONSE'
          },
          onError: {
            target: 'ERROR'
          }
        }
      },
      CHECK_CERT_CHAIN_RESPONSE: {
        always: [
          {
            guard: 'isCertNotAdded',
            actions: assign({
              errorMessage: ({ context }) =>
                `Device ${devices[context.clientId].uuid} activation failed. Error while adding the certificates to AMT.`
            }),
            target: 'FAILED'
          },
          {
            guard: 'maxCertLength',
            target: 'ADD_NEXT_CERT_IN_CHAIN'
          },
          {
            guard: 'canUpgrade',
            target: 'UPGRADE_TO_ADMIN_SETUP'
          },
          {
            target: 'ADMIN_SETUP'
          }
        ]
      },
      ADMIN_SETUP: {
        invoke: {
          src: 'sendAdminSetup',
          input: ({ context }) => context,
          id: 'send-adminsetup',
          onDone: {
            actions: assign({ message: ({ event }) => event.output }),
            target: 'CHECK_ADMIN_SETUP'
          },
          onError: [
            {
              guard: ({ event }) => event.error instanceof GATEWAY_TIMEOUT_ERROR,
              target: 'CHECK_ACTIVATION_ON_AMT'
            },
            {
              target: 'ERROR'
            }
          ]
        }
      },
      CHECK_ADMIN_SETUP: {
        always: [
          {
            guard: 'isSHBCCMComplete',
            actions: [
              ({ context }) => {
                devices[context.clientId].status.Status = 'Admin control mode.'
              },
              'Set activation status'
            ],
            target: 'COMMIT_CHANGES'
          },
          {
            guard: 'isDeviceAdminModeActivated',
            actions: [
              ({ context }) => {
                devices[context.clientId].status.Status = 'Admin control mode.'
              },
              'Set activation status'
            ],
            target: 'DELAYED_TRANSITION'
          },
          {
            actions: assign({ errorMessage: 'Failed to activate in admin control mode.' }),
            target: 'FAILED'
          }
        ]
      },
      UPGRADE_TO_ADMIN_SETUP: {
        invoke: {
          src: 'sendUpgradeClientToAdmin',
          input: ({ context }) => context,
          id: 'send-upgrade-to-admin',
          onDone: [
            {
              actions: assign({ message: ({ event }) => event.output }),
              target: 'CHECK_UPGRADE'
            }
          ],
          onError: [
            {
              guard: ({ event }) => event.error instanceof GATEWAY_TIMEOUT_ERROR,
              target: 'CHECK_ACTIVATION_ON_AMT'
            },
            {
              target: 'ERROR'
            }
          ]
        }
      },
      CHECK_UPGRADE: {
        always: [
          {
            guard: 'isSHBCCMComplete',
            actions: [
              ({ context }) => {
                devices[context.clientId].status.Status = 'admin control mode.'
              },
              'Set activation status'
            ],
            target: 'COMMIT_CHANGES'
          },
          {
            guard: 'isDeviceActivatedInACM',
            actions: [
              ({ context }) => {
                devices[context.clientId].status.Status = 'Upgraded to admin control mode.'
              },
              'Set activation status'
            ],
            target: 'CHANGE_AMT_PASSWORD'
          },
          {
            guard: 'isUpgraded',
            actions: [
              ({ context }) => {
                devices[context.clientId].status.Status = 'Upgraded to admin control mode.'
              },
              'Set activation status'
            ],
            target: 'CHANGE_AMT_PASSWORD'
          },
          {
            actions: assign({ errorMessage: 'Failed to upgrade to admin control mode.' }),
            target: 'FAILED'
          }
        ]
      },
      SETUP: {
        invoke: {
          src: 'sendClientSetup',
          input: ({ context }) => context,
          id: 'send-setup',
          onDone: [
            {
              guard: 'isSHBC',
              actions: ['Update AMT Credentials'],
              target: 'COMMIT_CHANGES'
            },
            {
              actions: assign({ message: ({ event }) => event.output }),
              target: 'CHECK_SETUP'
            }
          ],
          onError: [
            {
              guard: ({ event }) => event.error instanceof GATEWAY_TIMEOUT_ERROR,
              target: 'CHECK_ACTIVATION_ON_AMT'
            },
            {
              target: 'ERROR'
            }
          ]
        }
      },
      COMMIT_CHANGES: {
        invoke: {
          src: 'commitChanges',
          input: ({ context }) => context,
          id: 'commit-changes',
          onDone: [
            {
              guard: 'isSHBC',
              actions: [
                assign({ message: ({ event }) => event.output })
              ],
              target: 'CHECK_SETUP'
            },
            {
              guard: 'isSHBCCMComplete',
              actions: [assign({ message: ({ event }) => event.output })],
              target: 'SET_MEBX_PASSWORD'
            }
          ],
          onError: [
            {
              guard: ({ event }) => event.error instanceof GATEWAY_TIMEOUT_ERROR,
              target: 'CHECK_ACTIVATION_ON_AMT'
            },
            {
              target: 'ERROR'
            }
          ]
        }
      },
      CHECK_SETUP: {
        always: [
          {
            // For SHBC CCM flow (AMT >= 19) - check CommitChanges response
            guard: 'isDeviceCommittedInCCM',
            actions: [
              ({ context }) => {
                devices[context.clientId].status.Status = 'Client control mode (SHBC Phase 1).'
                context.shbcCCMComplete = true
                context.isActivated = true
              },
              'Set activation status'
            ],
            target: 'DELAYED_TRANSITION'
          },
          {
            // For regular CCM flow - check CurrentControlMode === 1
            guard: 'isDeviceActivatedInCCM',
            actions: [
              ({ context }) => {
                devices[context.clientId].status.Status = 'Client control mode.'
              },
              'Set activation status'
            ],
            target: 'DELAYED_TRANSITION'
          },
          {
            guard: 'isDeviceClientModeActivated',
            actions: [
              ({ context }) => {
                devices[context.clientId].status.Status = 'Client control mode.'
              },
              'Set activation status'
            ],
            target: 'DELAYED_TRANSITION'
          },
          {
            actions: assign({ errorMessage: 'Failed to activate in client control mode.' }),
            target: 'FAILED'
          }
        ]
      },
      CHECK_ACTIVATION_ON_AMT: {
        invoke: {
          src: 'getActivationStatus',
          input: ({ context }) => context,
          id: 'get-activationstatus',
          onDone: [
            {
              guard: 'hasToUpgrade',
              actions: assign({ message: ({ event }) => event.output }),
              target: 'CHECK_UPGRADE'
            },
            {
              guard: 'isAdminMode',
              actions: assign({ message: ({ event }) => event.output }),
              target: 'CHECK_ADMIN_SETUP'
            },
            {
              actions: assign({ message: ({ event }) => event.output }),
              target: 'CHECK_SETUP'
            }
          ],
          onError: [
            {
              actions: assign({
                message: ({ event }) => event.error,
                targetAfterError: () => 'CHECK_ACTIVATION_ON_AMT'
              }),
              target: 'ERROR'
            }
          ]
        }
      },
      DELAYED_TRANSITION: {
        after: {
          DELAY_TIME_ACTIVATION_SYNC: { target: 'UPDATE_CREDENTIALS' }
        }
      },
      UPDATE_CREDENTIALS: {
        entry: ['Update AMT Credentials'],
        always: [
          {
            guard: 'isSHBCCMComplete',
            actions: assign({ hasToUpgrade: () => true }),
            target: 'SAVE_DEVICE_TO_SECRET_PROVIDER'
          },
          {
            guard: 'isAdminMode',
            target: 'SET_MEBX_PASSWORD'
          },
          {
            target: 'SAVE_DEVICE_TO_SECRET_PROVIDER'
          }
        ]
      },
      SET_MEBX_PASSWORD: {
        invoke: {
          src: 'setMEBxPassword',
          input: ({ context }) => context,
          id: 'send-mebx-password',
          onDone: [
            {
              guard: 'isSHBCCMComplete',
              actions: assign({
                shbcACMComplete: () => true
              }),
              target: 'SAVE_DEVICE_TO_SECRET_PROVIDER'
            },
            {
              actions: [assign({ message: ({ event }) => event.output }), 'Reset Unauth Count'],
              target: 'SAVE_DEVICE_TO_SECRET_PROVIDER'
            }
          ],
          onError: {
            actions: assign({
              message: ({ event }) => event.error,
              targetAfterError: () => 'SET_MEBX_PASSWORD'
            }),
            target: 'ERROR'
          }
        }
      },
      SAVE_DEVICE_TO_SECRET_PROVIDER: {
        invoke: {
          src: 'saveDeviceInfoToSecretProvider',
          input: ({ context }) => context,
          id: 'save-device-secret-provider',
          onDone: 'SAVE_DEVICE_TO_MPS',
          onError: 'SAVE_DEVICE_TO_SECRET_PROVIDER_FAILURE'
        }
      },
      SAVE_DEVICE_TO_MPS: {
        invoke: {
          src: 'saveDeviceInfoToMPS',
          input: ({ context }) => context,
          id: 'save-device-to-mps',
          onDone: [
            {
              guard: 'isSHBCACMComplete',
              target: 'UNCONFIGURATION'
            },
            {
              guard: 'isSHBCCMComplete',
              actions: assign({ hasToUpgrade: () => true }),
              target: 'GET_AMT_DOMAIN_CERT'
            },
            { target: 'UNCONFIGURATION' }
          ],
          onError: 'SAVE_DEVICE_TO_MPS_FAILURE'
        }
      },
      SAVE_DEVICE_TO_SECRET_PROVIDER_FAILURE: {
        entry: assign({ errorMessage: 'Failed to save device information to Secret Provider' }),
        always: 'FAILED'
      },
      SAVE_DEVICE_TO_MPS_FAILURE: {
        entry: assign({ errorMessage: 'Failed to save device information to MPS' }),
        always: 'FAILED'
      },
      CHANGE_AMT_PASSWORD: {
        invoke: {
          src: 'changeAMTPassword',
          input: ({ context }) => context,
          id: 'send-to-change-amt-password',
          onDone: {
            actions: assign({ message: ({ event }) => event.output }),
            target: 'UPDATE_CREDENTIALS'
          },
          onError: {
            actions: assign({ message: ({ event }) => event.error }),
            target: 'ERROR'
          }
        }
      },
      UNCONFIGURATION: {
        entry: sendTo('unconfiguration-machine', { type: 'REMOVECONFIG' }),
        invoke: {
          src: 'unconfiguration',
          id: 'unconfiguration-machine',
          input: ({ context }) => ({
            clientId: context.clientId,
            profile: context.profile,
            httpHandler: context.httpHandler,
            retryCount: 0,
            privateCerts: [],
            tlsSettingData: [],
            publicKeyCertificates: [],
            amt: context.amt,
            ips: context.ips,
            cim: context.cim
          }),
          onDone: 'NETWORK_CONFIGURATION'
        }
      },
      NETWORK_CONFIGURATION: {
        entry: sendTo('network-configuration-machine', { type: 'NETWORKCONFIGURATION' }),
        invoke: {
          src: 'networkConfiguration',
          id: 'network-configuration-machine',
          input: ({ context }) => ({
            clientId: context.clientId,
            amtProfile: context.profile,
            generalSettings: context.generalSettings,
            httpHandler: context.httpHandler,
            message: context.message,
            retryCount: 0,
            amt: context.amt,
            ips: context.ips,
            cim: context.cim
          }),
          onDone: 'FEATURES_CONFIGURATION'
        }
      },
      FEATURES_CONFIGURATION: {
        entry: sendTo('features-configuration-machine', { type: 'CONFIGURE_FEATURES' }),
        invoke: {
          src: 'featuresConfiguration',
          id: 'features-configuration-machine',
          input: ({ context }) => ({
            clientId: context.clientId,
            amtConfiguration: context.profile,
            httpHandler: context.httpHandler,
            isRedirectionChanged: false,
            isOptInServiceChanged: false,
            amt: context.amt,
            ips: context.ips,
            cim: context.cim
          }),
          onDone: [
            {
              guard: 'hasCIRAProfile',
              target: 'CIRA'
            },
            { target: 'TLS' }
          ]
        }
      },
      CIRA: {
        entry: sendTo('cira-machine', { type: 'CONFIGURE_CIRA' }),
        invoke: {
          src: 'cira',
          id: 'cira-machine',
          input: ({ context }) => ({
            clientId: context.clientId,
            profile: context.profile,
            httpHandler: context.httpHandler,
            message: context.message,
            amt: context.amt,
            tenantId: context.tenantId
          }),
          onDone: 'PROVISIONED'
        }
      },
      TLS: {
        entry: sendTo('tls-machine', { type: 'CONFIGURE_TLS' }),
        invoke: {
          src: 'tls',
          id: 'tls-machine',
          input: ({ context }) => ({
            clientId: context.clientId,
            amtProfile: context.profile,
            httpHandler: context.httpHandler,
            message: context.message,
            xmlMessage: '',
            errorMessage: '',
            status: '',
            statusMessage: '',
            retryCount: 0,
            amt: context.amt,
            tlsSettingData: []
          }),
          onDone: 'PROVISIONED'
        }
      },
      PROVISIONED: {
        entry: [
          assign({ status: () => 'success' }),
          'Send Message to Device'
        ],
        type: 'final'
      },
      ERROR: {
        entry: sendTo('error-machine', { type: 'PARSE' }),
        invoke: {
          src: 'error',
          id: 'error-machine',
          input: ({ context }) => ({
            message: context.message,
            clientId: context.clientId
          }),
          onDone: 'NEXT_STATE'
        },
        on: {
          ONFAILED: {
            actions: assign({ errorMessage: ({ event }) => event.output }),
            target: 'FAILED'
          }
        }
      },
      NEXT_STATE: {
        always: [
          {
            guard: 'isGeneralSettings',
            target: 'GET_GENERAL_SETTINGS'
          },
          {
            guard: 'isMebxPassword',
            target: 'SET_MEBX_PASSWORD'
          },
          {
            guard: 'isCheckActivationOnAMT',
            target: 'CHECK_ACTIVATION_ON_AMT'
          },
          {
            actions: assign({ errorMessage: ({ context }) => 'No valid next state' }),
            target: 'FAILED'
          }
        ]
      },
      INVALID_DIGEST_REALM: {
        entry: assign({ errorMessage: 'Not a valid digest realm.' }),
        always: {
          target: 'FAILED'
        }
      },
      FAILED: {
        entry: [
          assign({ status: () => 'error' }),
          'Send Message to Device'
        ],
        type: 'final'
      }
    }
  })

  service = createActor(this.machine, { input: {} as ActivationContext })

  constructor() {
    this.nodeForge = new NodeForge()
    this.certManager = new CertManager(new Logger('CertManager'), this.nodeForge)
    this.signatureHelper = new SignatureHelper(this.nodeForge)
    this.configurator = new Configurator()
    this.validator = new Validator(new Logger('Validator'), this.configurator)
    this.dbFactory = new DbCreatorFactory()
    this.logger = new Logger('Activation_State_Machine')
  }
}
