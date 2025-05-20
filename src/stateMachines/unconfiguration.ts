/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { type CIM, type AMT, type IPS } from '@device-management-toolkit/wsman-messages'
import { assign, fromPromise, sendTo, setup } from 'xstate'
import { CertManager } from '../certManager.js'
import { Configurator } from '../Configurator.js'
import Logger from '../Logger.js'
import { type CIRAConfig } from '../models/RCS.Config.js'
import { NodeForge } from '../NodeForge.js'
import { DbCreatorFactory } from '../factories/DbCreatorFactory.js'
import { SignatureHelper } from '../utils/SignatureHelper.js'
import { Validator } from '../Validator.js'
import { UNEXPECTED_PARSE_ERROR } from '../utils/constants.js'
import { devices } from '../devices.js'
import { type AMTConfiguration } from '../models/index.js'
import { Error } from './error.js'
import { type CommonContext, invokeWsmanCall } from './common.js'
import { Environment } from '../utils/Environment.js'

export interface UnconfigContext extends CommonContext {
  profile: AMTConfiguration | null
  retryCount: number
  privateCerts: any[]
  tlsSettingData: any[]
  publicKeyCertificates: any[]
  status?: 'success' | 'error' | 'wsman' | 'heartbeat_request'
  ciraConfig?: CIRAConfig | null
  is8021xProfileUpdated?: boolean
  wifiEndPointSettings?: any[]
  wiredSettings?: any
  wifiSettings?: any
  amt?: AMT.Messages
  ips?: IPS.Messages
  cim?: CIM.Messages
}
export interface UnconfigEvent {
  type: 'REMOVECONFIG' | 'ONFAILURE'
  clientId: string
  output?: any
  error?: any
}
export class Unconfiguration {
  nodeForge: NodeForge
  certManager: CertManager
  signatureHelper: SignatureHelper
  configurator: Configurator
  validator: Validator
  logger: Logger
  dbFactory: DbCreatorFactory
  db: any
  error: Error = new Error()

  enumerateEthernetPortSettings = async ({ input }): Promise<any> => {
    input.xmlMessage = input.amt.EthernetPortSettings.Enumerate()
    return await invokeWsmanCall(input, 2)
  }

  pullEthernetPortSettings = async ({ input }): Promise<any> => {
    input.xmlMessage = input.amt.EthernetPortSettings.Pull(
      input.message.Envelope.Body?.EnumerateResponse?.EnumerationContext
    )
    return await invokeWsmanCall(input)
  }

  readEthernetPortSettings = ({ context }): void => {
    // As per AMT SDK first entry is WIRED network port and second entry is WIFI
    const pullResponse = context.message.Envelope.Body.PullResponse.Items.AMT_EthernetPortSettings
    const assignSettings = (item): void => {
      if (item.InstanceID.includes('Settings 0')) {
        context.wiredSettings = item
      } else if (item.InstanceID.includes('Settings 1')) {
        context.wifiSettings = item
      }
    }
    if (Array.isArray(pullResponse)) {
      pullResponse.slice(0, 2).forEach(assignSettings)
    } else {
      assignSettings(pullResponse)
    }
  }

  get8021xProfile = async ({ input }): Promise<any> => {
    if (input.ips != null) {
      input.xmlMessage = input.ips.IEEE8021xSettings.Get()
      return await invokeWsmanCall(input, 2)
    } else {
      this.logger.error('Null object in get8021xProfile()')
    }
  }

  disableWired8021xConfiguration = async ({ input }): Promise<any> => {
    if (input.ips != null) {
      const ieee8021xProfile = input.message.Envelope.Body.IPS_IEEE8021xSettings
      delete ieee8021xProfile.Username
      delete ieee8021xProfile.Password
      delete ieee8021xProfile.AuthenticationProtocol
      ieee8021xProfile.Enabled = 3
      input.xmlMessage = input.ips.IEEE8021xSettings.Put(ieee8021xProfile)
      return await invokeWsmanCall(input, 2)
    } else {
      this.logger.error('Null object in disableWired8021xConfiguration()')
    }
  }

  enumerateWifiEndpointSettings = async ({ input }): Promise<any> => {
    input.xmlMessage = input.cim.WiFiEndpointSettings.Enumerate()
    return await invokeWsmanCall(input, 2)
  }

  pullWifiEndpointSettings = async ({ input }): Promise<any> => {
    input.xmlMessage = input.cim.WiFiEndpointSettings.Pull(
      input.message.Envelope.Body?.EnumerateResponse?.EnumerationContext
    )
    return await invokeWsmanCall(input)
  }

  readWiFiEndpointSettingsPullResponse = ({ context }): void => {
    let wifiEndPointSettings: any[] = []
    if (context.message.Envelope.Body.PullResponse.Items?.CIM_WiFiEndpointSettings != null) {
      // CIM_WiFiEndpointSettings is an array if there more than one profile exists, otherwise its just an object from AMT
      if (Array.isArray(context.message.Envelope.Body.PullResponse.Items.CIM_WiFiEndpointSettings)) {
        wifiEndPointSettings = context.message.Envelope.Body.PullResponse.Items.CIM_WiFiEndpointSettings
      } else {
        wifiEndPointSettings.push(context.message.Envelope.Body.PullResponse.Items.CIM_WiFiEndpointSettings)
      }
    }

    context.wifiEndPointSettings = []
    if (wifiEndPointSettings.length > 0) {
      //  ignore the profiles with Priority 0 and without InstanceID, which is required to delete a wifi profile on AMT device
      wifiEndPointSettings.forEach((wifi) => {
        if (wifi.InstanceID != null && wifi.Priority !== 0) {
          context.wifiEndPointSettings?.push({ ...wifi })
        }
      })
    }
  }

  deleteWiFiProfileOnAMTDevice = async ({ input }): Promise<any> => {
    let wifiEndpoints = input.wifiEndPointSettings
    if (wifiEndpoints != null && input.cim != null) {
      // Deletes first profile in the array
      const selector = { name: 'InstanceID', value: wifiEndpoints[0].InstanceID }
      input.xmlMessage = input.cim.WiFiEndpointSettings.Delete(selector)
      wifiEndpoints = wifiEndpoints.slice(1)
      input.wifiEndPointSettings = wifiEndpoints
      return await invokeWsmanCall(input)
    }
    this.logger.error('Null object in deleteWiFiProfileOnAMTDevice()')
    return null
  }

  removeRemoteAccessPolicyRuleUserInitiated = async ({ input }): Promise<any> => {
    if (input.amt != null) {
      const selector = { name: 'PolicyRuleName', value: 'User Initiated' }
      input.xmlMessage = input.amt.RemoteAccessPolicyRule.Delete(selector)
      return await invokeWsmanCall(input)
    } else {
      this.logger.error('Null object in removeRemoteAccessPolicyRuleUserInitiated()')
    }
  }

  removeRemoteAccessPolicyRuleAlert = async ({ input }): Promise<any> => {
    if (input.amt != null) {
      const selector = { name: 'PolicyRuleName', value: 'Alert' }
      input.xmlMessage = input.amt.RemoteAccessPolicyRule.Delete(selector)
      await invokeWsmanCall(input)
    } else {
      this.logger.error('Null object in removeRemoteAccessPolicyRuleAlert()')
    }
  }

  removeRemoteAccessPolicyRulePeriodic = async ({ input }): Promise<any> => {
    if (input.amt != null) {
      const selector = { name: 'PolicyRuleName', value: 'Periodic' }
      input.xmlMessage = input.amt.RemoteAccessPolicyRule.Delete(selector)
      return await invokeWsmanCall(input)
    } else {
      this.logger.error('Null object in removeRemoteAccessPolicyRulePeriodic()')
    }
  }

  enumerateManagementPresenceRemoteSAP = async ({ input }): Promise<any> => {
    if (input.amt != null) {
      input.xmlMessage = input.amt.ManagementPresenceRemoteSAP.Enumerate()
      return await invokeWsmanCall(input)
    } else {
      this.logger.error('Null object in enumerateManagementPresenceRemoteSAP()')
    }
  }

  pullManagementPresenceRemoteSAP = async ({ input }): Promise<any> => {
    if (input.amt != null) {
      input.xmlMessage = input.amt.ManagementPresenceRemoteSAP.Pull(
        input.message.Envelope.Body?.EnumerateResponse?.EnumerationContext
      )
      return await invokeWsmanCall(input)
    } else {
      this.logger.error('Null object in pullManagementPresenceRemoteSAP()')
    }
  }

  deleteRemoteAccessService = async ({ input }): Promise<any> => {
    if (input.amt != null) {
      const selector = {
        name: 'Name',
        value: input.message.Envelope.Body.PullResponse.Items.AMT_ManagementPresenceRemoteSAP.Name
      }
      input.xmlMessage = input.amt.ManagementPresenceRemoteSAP.Delete(selector)
      return await invokeWsmanCall(input)
    } else {
      this.logger.error('Null object in deleteRemoteAccessService()')
    }
  }

  enumeratePublicKeyCertificate = async ({ input }): Promise<any> => {
    if (input.amt != null) {
      input.xmlMessage = input.amt.PublicKeyCertificate.Enumerate()
      return await invokeWsmanCall(input)
    } else {
      this.logger.error('Null object in enumeratePublicKeyCertificate()')
    }
  }

  pullPublicKeyCertificate = async ({ input }): Promise<any> => {
    if (input.amt != null) {
      input.xmlMessage = input.amt.PublicKeyCertificate.Pull(
        input.message.Envelope.Body?.EnumerateResponse?.EnumerationContext
      )
      return await invokeWsmanCall(input)
    } else {
      this.logger.error('Null object in pullPublicKeyCertificate()')
    }
  }

  deletePublicKeyCertificate = async ({ input }): Promise<any> => {
    if (input.amt != null) {
      const selector = { name: 'InstanceID', value: input.publicKeyCertificates[0].InstanceID }
      input.publicKeyCertificates = input.publicKeyCertificates.slice(1)
      input.xmlMessage = input.amt.PublicKeyCertificate.Delete(selector)
      return await invokeWsmanCall(input)
    } else {
      this.logger.error('Null object in deletePublicKeyCertificate()')
    }
  }

  getEnvironmentDetectionSettings = async ({ input }): Promise<any> => {
    if (input.amt != null) {
      input.xmlMessage = input.amt.EnvironmentDetectionSettingData.Get()
      return await invokeWsmanCall(input)
    } else {
      this.logger.error('Null object in getEnvironmentDetectionSettings()')
    }
  }

  clearEnvironmentDetectionSettings = async ({ input }): Promise<any> => {
    if (input.amt != null) {
      const envSettings = input.message.Envelope.Body.AMT_EnvironmentDetectionSettingData
      envSettings.DetectionStrings = []
      input.xmlMessage = input.amt.EnvironmentDetectionSettingData.Put(envSettings)
      return await invokeWsmanCall(input)
    } else {
      this.logger.error('Null object in clearEnvironmentDetectionSettings()')
    }
  }

  enumerateTLSSettingData = async ({ input }): Promise<any> => {
    if (input.amt != null) {
      input.xmlMessage = input.amt.TLSSettingData.Enumerate()
      return await invokeWsmanCall(input)
    } else {
      this.logger.error('Null object in enumerateTLSSettingData()')
    }
  }

  pullTLSSettingData = async ({ input }): Promise<any> => {
    if (input.amt != null) {
      input.xmlMessage = input.amt.TLSSettingData.Pull(
        input.message.Envelope.Body?.EnumerateResponse?.EnumerationContext
      )
      return await invokeWsmanCall(input)
    } else {
      this.logger.error('Null object in pullTLSSettingData()')
    }
  }

  disableRemoteTLSSettingData = async ({ input }): Promise<any> => {
    if (input.amt != null) {
      input.tlsSettingData = input.message.Envelope.Body.PullResponse.Items.AMT_TLSSettingData
      input.tlsSettingData[0].Enabled = false
      input.tlsSettingData[0].AcceptNonSecureConnections = true
      input.tlsSettingData[0].MutualAuthentication = false
      delete input.tlsSettingData[0].TrustedCN
      input.xmlMessage = input.amt.TLSSettingData.Put(input.tlsSettingData[0])
      return await invokeWsmanCall(input)
    } else {
      this.logger.error('Null object in disableRemoteTLSSettingData()')
    }
  }

  commitSetupAndConfigurationService = async ({ input }): Promise<any> => {
    if (input.amt != null) {
      input.xmlMessage = input.amt.SetupAndConfigurationService.CommitChanges()
      return await invokeWsmanCall(input)
    } else {
      this.logger.error('Null object in commitSetupAndConfigurationService()')
    }
  }

  disableLocalTLSSettingData = async ({ input }): Promise<any> => {
    if (input.amt != null) {
      input.tlsSettingData[1].Enabled = false
      delete input.tlsSettingData[1].TrustedCN
      input.xmlMessage = input.amt.TLSSettingData.Put(input.tlsSettingData[1])
      return await invokeWsmanCall(input)
    } else {
      this.logger.error('Null object in disableLocalTLSSettingData()')
    }
  }

  enumerateTLSCredentialContext = async ({ input }): Promise<any> => {
    if (input.amt != null) {
      input.xmlMessage = input.amt.TLSCredentialContext.Enumerate()
      return await invokeWsmanCall(input)
    } else {
      this.logger.error('Null object in enumerateTLSCredentialContext()')
    }
  }

  pullTLSCredentialContext = async ({ input }): Promise<any> => {
    if (input.amt != null) {
      input.xmlMessage = input.amt.TLSCredentialContext.Pull(
        input.message.Envelope.Body.EnumerateResponse.EnumerationContext
      )
      return await invokeWsmanCall(input)
    } else {
      this.logger.error('Null object in pullTLSCredentialContext()')
    }
  }

  deleteTLSCredentialContext = async ({ input }): Promise<any> => {
    if (input.amt != null) {
      input.xmlMessage = input.amt.TLSCredentialContext.Delete(
        input.message.Envelope.Body.PullResponse.Items?.AMT_TLSCredentialContext
      )
      return await invokeWsmanCall(input)
    } else {
      this.logger.error('Null object in deleteTLSCredentialContext()')
    }
  }

  enumeratePublicPrivateKeyPair = async ({ input }): Promise<any> => {
    if (input.amt != null) {
      input.xmlMessage = input.amt.PublicPrivateKeyPair.Enumerate()
      return await invokeWsmanCall(input)
    } else {
      this.logger.error('Null object in enumeratePublicPrivateKeyPair()')
    }
  }

  pullPublicPrivateKeyPair = async ({ input }): Promise<any> => {
    if (input.amt != null) {
      input.xmlMessage = input.amt.PublicPrivateKeyPair.Pull(
        input.message.Envelope.Body.EnumerateResponse.EnumerationContext
      )
      return await invokeWsmanCall(input)
    } else {
      this.logger.error('Null object in pullPublicPrivateKeyPair()')
    }
  }

  deletePublicPrivateKeyPair = async ({ input }): Promise<any> => {
    if (input.amt != null) {
      const selector = { name: 'InstanceID', value: input.privateCerts[0].InstanceID }
      input.privateCerts = input.privateCerts.slice(1)
      input.xmlMessage = input.amt.PublicPrivateKeyPair.Delete(selector)
      return await invokeWsmanCall(input)
    } else {
      this.logger.error('Null object in deletePublicPrivateKeyPair()')
    }
  }

  machine = setup({
    types: {} as {
      context: UnconfigContext
      events: UnconfigEvent
      actions: any
      input: UnconfigContext
    },
    actors: {
      errorMachine: this.error.machine,
      enumerateEthernetPortSettings: fromPromise(this.enumerateEthernetPortSettings),
      pullEthernetPortSettings: fromPromise(this.pullEthernetPortSettings),
      get8021xProfile: fromPromise(this.get8021xProfile),
      disableWired8021xConfiguration: fromPromise(this.disableWired8021xConfiguration),
      enumerateWifiEndpointSettings: fromPromise(this.enumerateWifiEndpointSettings),
      pullWifiEndpointSettings: fromPromise(this.pullWifiEndpointSettings),
      deleteWiFiProfileOnAMTDevice: fromPromise(this.deleteWiFiProfileOnAMTDevice),
      removeRemoteAccessPolicyRuleUserInitiated: fromPromise(this.removeRemoteAccessPolicyRuleUserInitiated),
      removeRemoteAccessPolicyRuleAlert: fromPromise(this.removeRemoteAccessPolicyRuleAlert),
      removeRemoteAccessPolicyRulePeriodic: fromPromise(this.removeRemoteAccessPolicyRulePeriodic),
      enumerateManagementPresenceRemoteSAP: fromPromise(this.enumerateManagementPresenceRemoteSAP),
      pullManagementPresenceRemoteSAP: fromPromise(this.pullManagementPresenceRemoteSAP),
      deleteRemoteAccessService: fromPromise(this.deleteRemoteAccessService),
      enumerateTLSSettingData: fromPromise(this.enumerateTLSSettingData),
      pullTLSSettingData: fromPromise(this.pullTLSSettingData),
      disableRemoteTLSSettingData: fromPromise(this.disableRemoteTLSSettingData),
      disableLocalTLSSettingData: fromPromise(this.disableLocalTLSSettingData),
      commitSetupAndConfigurationService: fromPromise(this.commitSetupAndConfigurationService),
      enumerateTLSCredentialContext: fromPromise(this.enumerateTLSCredentialContext),
      pullTLSCredentialContext: fromPromise(this.pullTLSCredentialContext),
      deleteTLSCredentialContext: fromPromise(this.deleteTLSCredentialContext),
      enumeratePublicPrivateKeyPair: fromPromise(this.enumeratePublicPrivateKeyPair),
      pullPublicPrivateKeyPair: fromPromise(this.pullPublicPrivateKeyPair),
      deletePublicPrivateKeyPair: fromPromise(this.deletePublicPrivateKeyPair),
      enumeratePublicKeyCertificate: fromPromise(this.enumeratePublicKeyCertificate),
      pullPublicKeyCertificate: fromPromise(this.pullPublicKeyCertificate),
      deletePublicKeyCertificate: fromPromise(this.deletePublicKeyCertificate),
      getEnvironmentDetectionSettings: fromPromise(this.getEnvironmentDetectionSettings),
      clearEnvironmentDetectionSettings: fromPromise(this.clearEnvironmentDetectionSettings)
    },
    delays: {
      DELAY_TIME_SETUP_AND_CONFIG_SYNC: () => Environment.Config.delay_setup_and_config_sync
    },
    guards: {
      isExpectedBadRequest: ({ event }) => event.error?.statusCode === 400,
      hasPrivateCerts: ({ context }) => context.privateCerts.length > 0,
      isLMSTLSSettings: ({ context }) =>
        context.message.Envelope.Body.AMT_TLSSettingData?.ElementName === 'Intel(r) AMT LMS TLS Settings',
      is8023TLS: ({ context }) =>
        context.message.Envelope.Body.AMT_TLSSettingData?.ElementName === 'Intel(r) AMT 802.3 TLS Settings' &&
        context.tlsSettingData[1].Enabled,
      tlsSettingDataEnabled: ({ context }) =>
        context.message.Envelope.Body.PullResponse.Items.AMT_TLSSettingData?.[0].Enabled ||
        context.message.Envelope.Body.PullResponse.Items.AMT_TLSSettingData?.[1].Enabled,
      hasMPSEntries: ({ context }) =>
        context.message.Envelope.Body.PullResponse.Items?.AMT_ManagementPresenceRemoteSAP != null,
      hasPublicKeyCertificate: ({ context }) => context.publicKeyCertificates?.length > 0,
      hasEnvSettings: ({ context }) =>
        context.message.Envelope.Body.AMT_EnvironmentDetectionSettingData.DetectionStrings != null,
      hasTLSCredentialContext: ({ context }) =>
        context.message.Envelope.Body.PullResponse.Items?.AMT_TLSCredentialContext != null,
      is8021xProfileEnabled: ({ context }) =>
        context.message.Envelope.Body.IPS_IEEE8021xSettings.Enabled === 2 ||
        context.message.Envelope.Body.IPS_IEEE8021xSettings.Enabled === 6,
      is8021xProfileDisabled: ({ context }) =>
        context.is8021xProfileUpdated != null ? context.is8021xProfileUpdated : false,
      isWifiProfilesExistsOnDevice: ({ context }) =>
        context.wifiEndPointSettings != null ? context.wifiEndPointSettings.length !== 0 : false,
      isWifiProfileDeleted: ({ context }) => context.message.Envelope.Body == null,
      isWifiOnlyDevice: ({ context }) => context.wifiSettings != null && context.wiredSettings?.MACAddress == null,
      isWifiSupportedOnDevice: ({ context }) => context.wifiSettings?.MACAddress != null,
      isWiredSupportedOnDevice: ({ context }) => context.wiredSettings?.MACAddress != null,
      shouldRetry: ({ context, event }) => context.retryCount < 3 && event.output instanceof UNEXPECTED_PARSE_ERROR
    },
    actions: {
      'Update CIRA Status': ({ context }) => {
        const device = devices[context.clientId]
        device.status.CIRAConnection = context.statusMessage
      },
      'Update TLS Status': ({ context }) => {
        const device = devices[context.clientId]
        device.status.TLSConfiguration = context.statusMessage
      },
      'Update Status': ({ context }) => {
        const device = devices[context.clientId]
        device.status.TLSConfiguration = ''
        device.status.CIRAConnection = ''
        device.status.Status = context.statusMessage
      },
      'Reset Unauth Count': ({ context }) => {
        devices[context.clientId].unauthCount = 0
      },
      'Read WiFi Endpoint Settings Pull Response': this.readWiFiEndpointSettingsPullResponse,
      'Reset Retry Count': assign({ retryCount: () => 0 }),
      'Increment Retry Count': assign({ retryCount: ({ context }) => context.retryCount + 1 }),
      'Read Ethernet Port Settings': this.readEthernetPortSettings
    }
  }).createMachine({
    context: ({ input }) => ({
      clientId: input.clientId,
      profile: input.profile,
      httpHandler: input.httpHandler,
      retryCount: input.retryCount,
      privateCerts: input.privateCerts,
      tlsSettingData: input.tlsSettingData,
      publicKeyCertificates: input.publicKeyCertificates,
      is8021xProfileUpdated: input.is8021xProfileUpdated,
      amt: input.amt,
      ips: input.ips,
      cim: input.cim
    }),
    id: 'unconfiuration-machine',
    initial: 'UNCONFIGURED',
    states: {
      UNCONFIGURED: {
        on: {
          REMOVECONFIG: {
            actions: ['Reset Unauth Count', 'Reset Retry Count'],
            target: 'ENUMERATE_ETHERNET_PORT_SETTINGS'
          }
        }
      },
      ERROR: {
        entry: sendTo('error-machine', { type: 'PARSE' }),
        invoke: {
          src: 'errorMachine',
          id: 'error-machine',
          input: ({ context, event }) => ({
            message: event.error,
            clientId: context.clientId
          }),
          onDone: 'ENUMERATE_ETHERNET_PORT_SETTINGS'
        },
        on: {
          ONFAILURE: 'FAILURE'
        }
      },
      ENUMERATE_ETHERNET_PORT_SETTINGS: {
        invoke: {
          src: 'enumerateEthernetPortSettings',
          input: ({ context }) => context,
          id: 'enumerate-ethernet-port-settings',
          onDone: {
            actions: assign({ message: ({ event }) => event.output }),
            target: 'PULL_ETHERNET_PORT_SETTINGS'
          },
          onError: {
            target: 'ERROR'
          }
        }
      },
      PULL_ETHERNET_PORT_SETTINGS: {
        invoke: {
          src: 'pullEthernetPortSettings',
          input: ({ context }) => context,
          id: 'pull-ethernet-port-settings',
          onDone: {
            actions: [assign({ message: ({ event }) => event.output }), 'Reset Retry Count'],
            target: 'CHECK_ETHERNET_PORT_SETTINGS_PULL_RESPONSE'
          },
          onError: [
            {
              guard: 'shouldRetry',
              actions: 'Increment Retry Count',
              target: 'ENUMERATE_ETHERNET_PORT_SETTINGS'
            },
            {
              actions: assign({ errorMessage: () => 'Failed to pull ethernet port settings' }),
              target: 'FAILURE'
            }
          ]
        }
      },
      CHECK_ETHERNET_PORT_SETTINGS_PULL_RESPONSE: {
        entry: 'Read Ethernet Port Settings',
        always: [
          {
            guard: 'isWiredSupportedOnDevice',
            target: 'GET_8021X_PROFILE'
          },
          {
            guard: 'isWifiOnlyDevice',
            target: 'ENUMERATE_WIFI_ENDPOINT_SETTINGS'
          }
        ]
      },
      GET_8021X_PROFILE: {
        invoke: {
          src: 'get8021xProfile',
          input: ({ context }) => context,
          id: 'get-8021x-profile',
          onDone: {
            actions: assign({ message: ({ event }) => event.output }),
            target: 'CHECK_GET_8021X_PROFILE_RESPONSE'
          },
          onError: {
            actions: assign({ errorMessage: () => 'Failed to get 8021x profile' }),
            target: 'FAILURE'
          }
        }
      },
      CHECK_GET_8021X_PROFILE_RESPONSE: {
        always: [
          {
            guard: 'is8021xProfileEnabled',
            target: 'DISABLE_IEEE8021X_WIRED'
          },
          {
            guard: 'isWifiSupportedOnDevice',
            target: 'ENUMERATE_WIFI_ENDPOINT_SETTINGS'
          },
          {
            target: 'REMOVE_REMOTE_ACCESS_POLICY_RULE_USER_INITIATED'
          }
        ]
      },
      DISABLE_IEEE8021X_WIRED: {
        invoke: {
          src: 'disableWired8021xConfiguration',
          input: ({ context }) => context,
          id: 'disable-Wired-8021x-Configuration',
          onDone: [
            {
              guard: 'isWifiSupportedOnDevice',
              actions: assign({ is8021xProfileUpdated: true }),
              target: 'ENUMERATE_WIFI_ENDPOINT_SETTINGS'
            },
            {
              target: 'REMOVE_REMOTE_ACCESS_POLICY_RULE_USER_INITIATED'
            }
          ],
          onError: {
            actions: assign({ errorMessage: () => 'Failed to disable 8021x profile' }),
            target: 'FAILURE'
          }
        }
      },
      ENUMERATE_WIFI_ENDPOINT_SETTINGS: {
        invoke: {
          src: 'enumerateWifiEndpointSettings',
          input: ({ context }) => context,
          id: 'enumerate-wifi-endpoint-settings',
          onDone: {
            actions: assign({
              message: ({ event }) => event.output
            }),
            target: 'PULL_WIFI_ENDPOINT_SETTINGS'
          },
          onError: {
            actions: assign({ errorMessage: () => 'Failed to get enumeration number for wifi endpoint settings' }),
            target: 'FAILURE'
          }
        }
      },
      PULL_WIFI_ENDPOINT_SETTINGS: {
        invoke: {
          src: 'pullWifiEndpointSettings',
          input: ({ context }) => context,
          id: 'pull-wifi-endpoint-settings',
          onDone: {
            actions: [assign({ message: ({ event }) => event.output }), 'Reset Retry Count'],
            target: 'CHECK_WIFI_ENDPOINT_SETTINGS_PULL_RESPONSE'
          },
          onError: [
            {
              guard: 'shouldRetry',
              actions: 'Increment Retry Count',
              target: 'ENUMERATE_WIFI_ENDPOINT_SETTINGS'
            },
            {
              actions: assign({ errorMessage: () => 'Failed to pull wifi endpoint settings' }),
              target: 'FAILURE'
            }
          ]
        }
      },
      CHECK_WIFI_ENDPOINT_SETTINGS_PULL_RESPONSE: {
        entry: 'Read WiFi Endpoint Settings Pull Response',
        always: [
          {
            guard: 'isWifiProfilesExistsOnDevice',
            target: 'DELETE_WIFI_ENDPOINT_SETTINGS'
          },
          {
            target: 'REMOVE_REMOTE_ACCESS_POLICY_RULE_USER_INITIATED'
          }
        ]
      },
      DELETE_WIFI_ENDPOINT_SETTINGS: {
        invoke: {
          src: 'deleteWiFiProfileOnAMTDevice',
          input: ({ context }) => context,
          id: 'delete-wifi-endpoint-settings',
          onDone: {
            actions: assign({ message: ({ event }) => event.output }),
            target: 'CHECK_WIFI_ENDPOINT_SETTINGS_DELETE_RESPONSE'
          },
          onError: {
            actions: assign({ errorMessage: () => 'Failed to delete wifi endpoint settings' }),
            target: 'FAILURE'
          }
        }
      },
      CHECK_WIFI_ENDPOINT_SETTINGS_DELETE_RESPONSE: {
        always: [
          {
            guard: 'isWifiProfileDeleted',
            target: 'FAILURE'
          },
          {
            guard: 'isWifiProfilesExistsOnDevice',
            target: 'DELETE_WIFI_ENDPOINT_SETTINGS'
          },
          {
            target: 'REMOVE_REMOTE_ACCESS_POLICY_RULE_USER_INITIATED'
          }
        ]
      },
      REMOVE_REMOTE_ACCESS_POLICY_RULE_USER_INITIATED: {
        invoke: {
          src: 'removeRemoteAccessPolicyRuleUserInitiated',
          input: ({ context }) => context,
          id: 'remove-remote-access-policy-rule-user-initiated',
          onDone: 'REMOVE_REMOTE_ACCESS_POLICY_RULE_ALERT',
          onError: [
            {
              guard: 'isExpectedBadRequest',
              target: 'REMOVE_REMOTE_ACCESS_POLICY_RULE_ALERT'
            },
            {
              target: 'ERROR'
            }
          ]
        }
      },
      REMOVE_REMOTE_ACCESS_POLICY_RULE_ALERT: {
        invoke: {
          src: 'removeRemoteAccessPolicyRuleAlert',
          input: ({ context }) => context,
          id: 'remove-remote-access-policy-rule-rule-alert',
          onDone: 'REMOVE_REMOTE_ACCESS_POLICY_RULE_PERIODIC',
          onError: 'REMOVE_REMOTE_ACCESS_POLICY_RULE_PERIODIC'
        }
      },
      REMOVE_REMOTE_ACCESS_POLICY_RULE_PERIODIC: {
        invoke: {
          src: 'removeRemoteAccessPolicyRulePeriodic',
          input: ({ context }) => context,
          id: 'remove-remote-access-policy-rule-periodic',
          onDone: 'ENUMERATE_MANAGEMENT_PRESENCE_REMOTE_SAP',
          onError: 'ENUMERATE_MANAGEMENT_PRESENCE_REMOTE_SAP'
        }
      },
      ENUMERATE_MANAGEMENT_PRESENCE_REMOTE_SAP: {
        invoke: {
          src: 'enumerateManagementPresenceRemoteSAP',
          input: ({ context }) => context,
          id: 'enumerate-management-presence-remote-sap',
          onDone: {
            actions: assign({ message: ({ event }) => event.output }),
            target: 'PULL_MANAGEMENT_PRESENCE_REMOTE_SAP'
          },
          onError: {
            actions: assign({ statusMessage: () => 'Failed to enumerate Management Presence Remote SAP' }),
            target: 'FAILURE'
          }
        }
      },
      PULL_MANAGEMENT_PRESENCE_REMOTE_SAP: {
        invoke: {
          src: 'pullManagementPresenceRemoteSAP',
          input: ({ context }) => context,
          id: 'pull-management-presence-remote-sap',
          onDone: {
            actions: assign({ message: ({ event }) => event.output }),
            target: 'PULL_MANAGEMENT_PRESENCE_REMOTE_SAP_RESPONSE'
          },
          onError: {
            actions: assign({ statusMessage: () => 'Failed to Pull Management Presence Remote SAP' }),
            target: 'FAILURE'
          }
        }
      },
      PULL_MANAGEMENT_PRESENCE_REMOTE_SAP_RESPONSE: {
        always: [
          {
            guard: 'hasMPSEntries',
            target: 'DELETE_MANAGEMENT_PRESENCE_REMOTE_SAP'
          },
          {
            target: 'ENUMERATE_TLS_SETTING_DATA'
          }
        ]
      },
      DELETE_MANAGEMENT_PRESENCE_REMOTE_SAP: {
        invoke: {
          src: 'deleteRemoteAccessService',
          input: ({ context }) => context,
          id: 'delete-management-presence-remote-sap',
          onDone: {
            actions: [assign({ statusMessage: () => 'unconfigured' }), 'Update CIRA Status'],
            target: 'ENUMERATE_TLS_SETTING_DATA'
          },
          onError: {
            actions: assign({ statusMessage: () => 'Failed to delete Management Presence Remote SAP' }),
            target: 'FAILURE'
          }
        }
      },
      ENUMERATE_TLS_SETTING_DATA: {
        invoke: {
          src: 'enumerateTLSSettingData',
          input: ({ context }) => context,
          id: 'enumerate-tls-setting-data',
          onDone: { actions: assign({ message: ({ event }) => event.output }), target: 'PULL_TLS_SETTING_DATA' },
          onError: {
            actions: assign({ statusMessage: () => 'Failed to enumerate TLS Setting Data' }),
            target: 'FAILURE'
          }
        }
      },
      PULL_TLS_SETTING_DATA: {
        invoke: {
          src: 'pullTLSSettingData',
          input: ({ context }) => context,
          id: 'pull-tls-setting-data',
          onDone: {
            actions: assign({ message: ({ event }) => event.output }),
            target: 'PULL_TLS_SETTING_DATA_RESPONSE'
          },
          onError: {
            actions: assign({ statusMessage: () => 'Failed to pull TLS Setting Data' }),
            target: 'FAILURE'
          }
        }
      },
      PULL_TLS_SETTING_DATA_RESPONSE: {
        always: [
          { guard: 'tlsSettingDataEnabled', target: 'DISABLE_TLS_SETTING_DATA' },
          { guard: 'is8021xProfileDisabled', target: 'ENUMERATE_PUBLIC_PRIVATE_KEY_PAIR' },
          { target: 'ENUMERATE_PUBLIC_KEY_CERTIFICATE' }]
      },
      DISABLE_TLS_SETTING_DATA: {
        invoke: {
          src: 'disableRemoteTLSSettingData',
          input: ({ context }) => context,
          id: 'disable-tls-setting-data',
          onDone: {
            actions: assign({ message: ({ event }) => event.output }),
            target: 'DISABLE_TLS_SETTING_DATA_RESPONSE'
          },
          onError: {
            target: 'SETUP_AND_CONFIGURATION_SERVICE_COMMIT_CHANGES'
          }
        }
      },
      DISABLE_TLS_SETTING_DATA_2: {
        invoke: {
          src: 'disableLocalTLSSettingData',
          input: ({ context }) => context,
          id: 'disable-tls-setting-data-2',
          onDone: {
            actions: assign({ message: ({ event }) => event.output }),
            target: 'DISABLE_TLS_SETTING_DATA_RESPONSE'
          },
          onError: {
            target: 'SETUP_AND_CONFIGURATION_SERVICE_COMMIT_CHANGES'
          }
        }
      },
      DISABLE_TLS_SETTING_DATA_RESPONSE: {
        always: [
          { guard: 'is8023TLS', target: 'DISABLE_TLS_SETTING_DATA_2' },
          { guard: 'isLMSTLSSettings', target: 'SETUP_AND_CONFIGURATION_SERVICE_COMMIT_CHANGES' },
          { target: 'FAILURE' }]
      },
      SETUP_AND_CONFIGURATION_SERVICE_COMMIT_CHANGES: {
        invoke: {
          src: 'commitSetupAndConfigurationService',
          input: ({ context }) => context,
          id: 'setup-and-configuration-service-commit-changes',
          onDone: {
            actions: [assign({ statusMessage: () => 'unconfigured' }), 'Update TLS Status'],
            target: 'SETUP_AND_CONFIGURATION_SERVICE_COMMIT_CHANGES_RESPONSE'
          },
          onError: {
            actions: assign({ statusMessage: () => 'Failed at setup and configuration service commit changes' }),
            target: 'FAILURE'
          }
        }
      },
      SETUP_AND_CONFIGURATION_SERVICE_COMMIT_CHANGES_RESPONSE: {
        after: { DELAY_TIME_SETUP_AND_CONFIG_SYNC: 'ENUMERATE_TLS_CREDENTIAL_CONTEXT' }
      },
      ENUMERATE_TLS_CREDENTIAL_CONTEXT: {
        invoke: {
          src: 'enumerateTLSCredentialContext',
          input: ({ context }) => context,
          id: 'enumerate-tls-credential-context',
          onDone: { actions: assign({ message: ({ event }) => event.output }), target: 'PULL_TLS_CREDENTIAL_CONTEXT' },
          onError: {
            actions: assign({ statusMessage: () => 'Failed to enumerate TLS Credential context' }),
            target: 'FAILURE'
          }
        }
      },
      PULL_TLS_CREDENTIAL_CONTEXT: {
        invoke: {
          src: 'pullTLSCredentialContext',
          input: ({ context }) => context,
          id: 'pull-tls-credential-context',
          onDone: {
            actions: assign({ message: ({ event }) => event.output }),
            target: 'PULL_TLS_CREDENTIAL_CONTEXT_RESPONSE'
          },
          onError: {
            actions: assign({ statusMessage: () => 'Failed to pull TLS Credential context' }),
            target: 'FAILURE'
          }
        }
      },
      PULL_TLS_CREDENTIAL_CONTEXT_RESPONSE: {
        always: [
          { guard: 'hasTLSCredentialContext', target: 'DELETE_TLS_CREDENTIAL_CONTEXT' },
          { target: 'ENUMERATE_PUBLIC_PRIVATE_KEY_PAIR' }]
      },
      DELETE_TLS_CREDENTIAL_CONTEXT: {
        invoke: {
          src: 'deleteTLSCredentialContext',
          input: ({ context }) => context,
          id: 'delete-tls-credential-context',
          onDone: 'ENUMERATE_PUBLIC_PRIVATE_KEY_PAIR',
          onError: {
            target: 'ENUMERATE_PUBLIC_PRIVATE_KEY_PAIR'
          }
        }
      },
      ENUMERATE_PUBLIC_PRIVATE_KEY_PAIR: {
        invoke: {
          src: 'enumeratePublicPrivateKeyPair',
          input: ({ context }) => context,
          id: 'enumerate-public-private-key-pair',
          onDone: { actions: assign({ message: ({ event }) => event.output }), target: 'PULL_PUBLIC_PRIVATE_KEY_PAIR' },
          onError: {
            actions: assign({ statusMessage: () => 'Failed to enumerate public private key pair' }),
            target: 'FAILURE'
          }
        }
      },
      PULL_PUBLIC_PRIVATE_KEY_PAIR: {
        invoke: {
          src: 'pullPublicPrivateKeyPair',
          input: ({ context }) => context,
          id: 'pull-public-private-key-pair',
          onDone: {
            actions: assign({
              privateCerts: ({ event }) => {
                if (event.output.Envelope.Body.PullResponse.Items === '') return []
                if (Array.isArray(event.output.Envelope.Body.PullResponse.Items?.AMT_PublicPrivateKeyPair)) {
                  return event.output.Envelope.Body.PullResponse.Items.AMT_PublicPrivateKeyPair
                } else {
                  return [event.output.Envelope.Body.PullResponse.Items.AMT_PublicPrivateKeyPair]
                }
              }
            }),
            target: 'PULL_PUBLIC_PRIVATE_KEY_PAIR_RESPONSE'
          },
          onError: {
            actions: assign({ statusMessage: () => 'Failed to pull public private key pair' }),
            target: 'FAILURE'
          }
        }
      },
      PULL_PUBLIC_PRIVATE_KEY_PAIR_RESPONSE: {
        always: [
          { guard: 'hasPrivateCerts', target: 'DELETE_PUBLIC_PRIVATE_KEY_PAIR' },
          { target: 'ENUMERATE_PUBLIC_KEY_CERTIFICATE' }]
      },
      DELETE_PUBLIC_PRIVATE_KEY_PAIR: {
        invoke: {
          src: 'deletePublicPrivateKeyPair',
          input: ({ context }) => context,
          id: 'delete-public-private-key-pair',
          onDone: {
            actions: assign({ message: ({ event }) => event.output }),
            target: 'PULL_PUBLIC_PRIVATE_KEY_PAIR_RESPONSE'
          },
          onError: {
            target: 'PULL_PUBLIC_PRIVATE_KEY_PAIR_RESPONSE'
          }
        }
      },
      ENUMERATE_PUBLIC_KEY_CERTIFICATE: {
        invoke: {
          src: 'enumeratePublicKeyCertificate',
          input: ({ context }) => context,
          id: 'enumerate-public-key-certificate',
          onDone: { actions: assign({ message: ({ event }) => event.output }), target: 'PULL_PUBLIC_KEY_CERTIFICATE' },
          onError: {
            actions: assign({ statusMessage: () => 'Failed to enumerate public key certificate' }),
            target: 'FAILURE'
          }
        }
      },
      PULL_PUBLIC_KEY_CERTIFICATE: {
        invoke: {
          src: 'pullPublicKeyCertificate',
          input: ({ context }) => context,
          id: 'pull-public-key-certificate',
          onDone: {
            actions: assign({
              publicKeyCertificates: ({ event }) => {
                if (event.output.Envelope.Body.PullResponse.Items === '') return []
                if (Array.isArray(event.output.Envelope.Body.PullResponse.Items?.AMT_PublicKeyCertificate)) {
                  return event.output.Envelope.Body.PullResponse.Items.AMT_PublicKeyCertificate
                } else {
                  return [event.output.Envelope.Body.PullResponse.Items.AMT_PublicKeyCertificate]
                }
              }
            }),
            target: 'PULL_PUBLIC_KEY_CERTIFICATE_RESPONSE'
          },
          onError: {
            actions: assign({ statusMessage: () => 'Failed to pull public key certificate' }),
            target: 'FAILURE'
          }
        }
      },
      PULL_PUBLIC_KEY_CERTIFICATE_RESPONSE: {
        always: [
          { guard: 'hasPublicKeyCertificate', target: 'DELETE_PUBLIC_KEY_CERTIFICATE' },
          { target: 'GET_ENVIRONMENT_DETECTION_SETTINGS' }]
      },
      DELETE_PUBLIC_KEY_CERTIFICATE: {
        invoke: {
          src: 'deletePublicKeyCertificate',
          input: ({ context }) => context,
          id: 'delete-public-key-certificate',
          onDone: {
            actions: assign({ message: ({ event }) => event.output }),
            target: 'PULL_PUBLIC_KEY_CERTIFICATE_RESPONSE'
          }, // check if there is any more certificates
          onError: {
            target: 'PULL_PUBLIC_KEY_CERTIFICATE_RESPONSE'
          }
        }
      },
      GET_ENVIRONMENT_DETECTION_SETTINGS: {
        invoke: {
          src: 'getEnvironmentDetectionSettings',
          input: ({ context }) => context,
          id: 'get-environment-detection-settings',
          onDone: {
            actions: assign({ message: ({ event }) => event.output }),
            target: 'GET_ENVIRONMENT_DETECTION_SETTINGS_RESPONSE'
          },
          onError: {
            actions: assign({ statusMessage: () => 'Failed to get environment detection settings' }),
            target: 'FAILURE'
          }
        }
      },
      GET_ENVIRONMENT_DETECTION_SETTINGS_RESPONSE: {
        always: [
          {
            guard: 'hasEnvSettings',
            target: 'CLEAR_ENVIRONMENT_DETECTION_SETTINGS'
          },
          {
            target: 'SUCCESS'
          }
        ]
      },
      CLEAR_ENVIRONMENT_DETECTION_SETTINGS: {
        invoke: {
          src: 'clearEnvironmentDetectionSettings',
          input: ({ context }) => context,
          id: 'put-environment-detection-settings',
          onDone: {
            target: 'SUCCESS'
          },
          onError: {
            actions: assign({ statusMessage: () => 'Failed to put environment detection settings' }),
            target: 'FAILURE'
          }
        }
      },
      FAILURE: {
        entry: ['Update Status'],
        type: 'final'
      },
      SUCCESS: {
        type: 'final'
      }
    }
  })

  constructor() {
    this.nodeForge = new NodeForge()
    this.certManager = new CertManager(new Logger('CertManager'), this.nodeForge)
    this.signatureHelper = new SignatureHelper(this.nodeForge)
    this.configurator = new Configurator()
    this.validator = new Validator(new Logger('Validator'), this.configurator)
    this.dbFactory = new DbCreatorFactory()
    this.logger = new Logger('Unconfiguration_State_Machine')
  }
}
