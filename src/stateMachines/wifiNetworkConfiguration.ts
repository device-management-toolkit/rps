/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { type AMT, type CIM } from '@device-management-toolkit/wsman-messages'
import { assign, sendTo, fromPromise, setup } from 'xstate'
import { type WirelessConfig } from '../models/RCS.Config.js'
import Logger from '../Logger.js'
import { type AMTConfiguration } from '../models/index.js'
import { devices } from '../devices.js'
import { Error } from './error.js'
import { Configurator } from '../Configurator.js'
import { DbCreatorFactory } from '../factories/DbCreatorFactory.js'
import { type CommonContext, invokeWsmanCall } from './common.js'
import { type WifiCredentials } from '../interfaces/ISecretManagerService.js'
import { UNEXPECTED_PARSE_ERROR } from '../utils/constants.js'
import {
  getCertFromEnterpriseAssistant,
  initiateCertRequest,
  sendEnterpriseAssistantKeyPairResponse
} from './enterpriseAssistant.js'

export interface WiFiConfigContext extends CommonContext {
  amtProfile: AMTConfiguration | null
  wifiSettings: any
  wifiProfileCount: number
  retryCount: number
  wifiProfileName?: string | null
  wifiProfile?: WirelessConfig
  generalSettings?: AMT.Models.GeneralSettings | null
  wifiEndPointSettings?: any
  authProtocol?: number
  eaResponse?: any
  addTrustedRootCertResponse?: any
  addCertResponse?: any
  keyPairHandle?: string
  profilesAdded?: string
  profilesFailed?: string
  onlyLocalWifiSyncEnabled?: boolean
  amt?: AMT.Messages
  cim?: CIM.Messages
}

export interface WiFiConfigEvent {
  type: 'WIFICONFIG' | 'ONFAILED'
  clientId: string
  output?: any
}
export class WiFiConfiguration {
  configurator: Configurator
  logger: Logger
  dbFactory: DbCreatorFactory
  db: any
  error: Error = new Error()

  updateWifiPort = async ({ input }: { input: WiFiConfigContext }): Promise<any> => {
    // Enumeration 32769 - WiFi is enabled in S0 + Sx/AC
    input.xmlMessage = input.cim?.WiFiPort.RequestStateChange(32769)
    return await invokeWsmanCall(input)
  }

  getWifiProfile = async ({ input }: { input: WiFiConfigContext }): Promise<void> => {
    if (input.amtProfile?.wifiConfigs != null) {
      // Get WiFi profile information based on the profile name from db.
      this.db = await this.dbFactory.getDb()
      input.wifiProfile = await this.db.wirelessProfiles.getByName(
        input.amtProfile.wifiConfigs[input.wifiProfileCount].profileName,
        input.amtProfile.tenantId
      )
      if (input.wifiProfile != null) {
        if (input.wifiProfile.ieee8021xProfileName != null) {
          input.wifiProfile.ieee8021xProfileObject = await this.db.ieee8021xProfiles.getByName(
            input.wifiProfile.ieee8021xProfileName,
            input.wifiProfile.tenantId
          )
          input.authProtocol =
            input.wifiProfile.ieee8021xProfileObject != null
              ? input.wifiProfile.ieee8021xProfileObject.authenticationProtocol
              : 0
        }
        if (this.configurator?.secretsManager) {
          // Get WiFi profile pskPassphrase from vault
          const data = (await this.configurator.secretsManager.getSecretAtPath(
            `Wireless/${input.wifiProfile.profileName}`
          )) as WifiCredentials
          if (data != null) {
            input.wifiProfile.pskPassphrase = data.PSK_PASSPHRASE
          }
        }
        return
      }
    }
    this.logger.error('Null object in getWifiProfile()')
  }

  addWifiConfigs = async ({ input }: { input: WiFiConfigContext }): Promise<any> => {
    if (input.addTrustedRootCertResponse != null) {
      devices[input.clientId].trustedRootCertificateResponse = input.addTrustedRootCertResponse
    } else {
      input.addTrustedRootCertResponse = devices[input.clientId].trustedRootCertificateResponse
    }
    // Get WiFi profile information based on the profile name.
    const selector = { name: 'Name', value: 'WiFi Endpoint 0' }
    // Add  WiFi profile information to WiFi endpoint settings object
    const wifiEndpointSettings: CIM.Models.WiFiEndpointSettings = {
      ElementName: input.wifiProfile != null ? input.wifiProfile.profileName : '',
      InstanceID:
        input.wifiProfile != null ? `Intel(r) AMT:WiFi Endpoint Settings ${input.wifiProfile.profileName}` : '',
      AuthenticationMethod:
        input.wifiProfile != null
          ? (input.wifiProfile.authenticationMethod as CIM.Types.WiFiEndpointSettings.AuthenticationMethod)
          : 6,
      EncryptionMethod:
        input.wifiProfile != null
          ? (input.wifiProfile.encryptionMethod as CIM.Types.WiFiEndpointSettings.EncryptionMethod)
          : 4,
      SSID: input.wifiProfile != null ? input.wifiProfile.ssid : '',
      Priority:
        input.amtProfile?.wifiConfigs != null ? input.amtProfile.wifiConfigs[input.wifiProfileCount].priority : 0
    }

    if (wifiEndpointSettings.AuthenticationMethod === 5 || wifiEndpointSettings.AuthenticationMethod === 7) {
      // const authProtocol = input.wifiProfile.ieee8021xProfileObject.authenticationProtocol
      const ieee8021xSettings: CIM.Models.IEEE8021xSettings = {
        ElementName:
          input.wifiProfile?.ieee8021xProfileObject != null ? input.wifiProfile.ieee8021xProfileObject.profileName : '',
        InstanceID:
          input.wifiProfile?.ieee8021xProfileObject != null
            ? `Intel(r) AMT: 8021X Settings ${input.wifiProfile.ieee8021xProfileObject.profileName}`
            : '',
        AuthenticationProtocol: input.authProtocol as CIM.Types.IEEE8021xSettings.AuthenticationProtocol,
        Username: input.eaResponse?.username
      }
      if (input.authProtocol === 2) {
        ieee8021xSettings.Password = input.eaResponse?.password
      }
      const cert: string =
        input.authProtocol === 2
          ? null
          : input.addCertResponse?.AddCertificate_OUTPUT?.CreatedCertificate?.ReferenceParameters?.SelectorSet?.Selector
              ?._
      const root: string =
        input.addTrustedRootCertResponse?.AddTrustedRootCertificate_OUTPUT?.CreatedCertificate?.ReferenceParameters
          ?.SelectorSet?.Selector?._
      input.xmlMessage = input.amt?.WiFiPortConfigurationService.AddWiFiSettings(
        wifiEndpointSettings,
        selector,
        ieee8021xSettings,
        cert,
        root
      )
    } else {
      wifiEndpointSettings.PSKPassPhrase = input.wifiProfile?.pskPassphrase
      input.xmlMessage = input.amt?.WiFiPortConfigurationService.AddWiFiSettings(wifiEndpointSettings, selector)
    }

    // Increment the count to keep track of profiles added to AMT
    input.wifiProfileName = input.wifiProfile != null ? input.wifiProfile.profileName : null
    ++input.wifiProfileCount
    return await invokeWsmanCall(input)
  }

  getWifiPortConfigurationService = async ({ input }: { input: WiFiConfigContext }): Promise<any> => {
    input.xmlMessage = input.amt?.WiFiPortConfigurationService.Get()
    return await invokeWsmanCall(input, 2)
  }

  putWifiPortConfigurationService = async ({ input }: { input: WiFiConfigContext }): Promise<any> => {
    const wifiPortConfigurationService: AMT.Models.WiFiPortConfigurationService =
      input.message.Envelope.Body.AMT_WiFiPortConfigurationService
    wifiPortConfigurationService.localProfileSynchronizationEnabled = 3
    input.xmlMessage = input.amt?.WiFiPortConfigurationService.Put(wifiPortConfigurationService)
    return await invokeWsmanCall(input, 2)
  }

  generateKeyPair = async ({ input }: { input: WiFiConfigContext }): Promise<any> => {
    input.xmlMessage = input.amt?.PublicKeyManagementService.GenerateKeyPair({ KeyAlgorithm: 0, KeyLength: 2048 })
    return await invokeWsmanCall(input)
  }

  enumeratePublicPrivateKeyPair = async ({ input }: { input: WiFiConfigContext }): Promise<any> => {
    input.keyPairHandle =
      input.message.Envelope.Body?.GenerateKeyPair_OUTPUT?.KeyPair?.ReferenceParameters?.SelectorSet?.Selector?._
    input.xmlMessage = input.amt?.PublicPrivateKeyPair.Enumerate()
    return await invokeWsmanCall(input, 2)
  }

  pullPublicPrivateKeyPair = async ({ input }: { input: WiFiConfigContext }): Promise<any> => {
    input.xmlMessage = input.amt?.PublicPrivateKeyPair.Pull(
      input.message.Envelope.Body?.EnumerateResponse?.EnumerationContext
    )
    return await invokeWsmanCall(input)
  }

  signCSR = async ({ input }): Promise<any> => {
    input.xmlMessage = input.amt?.PublicKeyManagementService.GeneratePKCS10RequestEx({
      KeyPair:
        '<a:Address>http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</a:Address><a:ReferenceParameters><w:ResourceURI>http://intel.com/wbem/wscim/1/amt-schema/1/AMT_PublicPrivateKeyPair</w:ResourceURI><w:SelectorSet><w:Selector Name="InstanceID">' +
        (input.message.response.keyInstanceId as string) +
        '</w:Selector></w:SelectorSet></a:ReferenceParameters>',
      SigningAlgorithm: 1,
      NullSignedCertificateRequest: input.message.response.csr
    })
    return await invokeWsmanCall(input)
  }

  addCertificate = async ({
    input
  }: {
    input: { context: WiFiConfigContext; event: WiFiConfigEvent }
  }): Promise<any> => {
    input.context.eaResponse = input.event.output.response
    const cert = input.event.output.response.certificate
    input.context.xmlMessage = input.context.amt?.PublicKeyManagementService.AddCertificate({ CertificateBlob: cert })
    return await invokeWsmanCall(input.context)
  }

  addRadiusServerRootCertificate = async ({ input }: { input: WiFiConfigContext }): Promise<any> => {
    // To Do: Needs to replace the logic with how we will pull the radius server root certificate
    const cert = input.eaResponse.rootcert
    input.xmlMessage = input.amt?.PublicKeyManagementService.AddTrustedRootCertificate({ CertificateBlob: cert })
    return await invokeWsmanCall(input)
  }

  machine = setup({
    types: {} as {
      context: WiFiConfigContext
      events: WiFiConfigEvent
      actions: any
      input: WiFiConfigContext
    },
    actors: {
      getWifiPortConfigurationService: fromPromise(this.getWifiPortConfigurationService),
      putWifiPortConfigurationService: fromPromise(this.putWifiPortConfigurationService),
      updateWifiPort: fromPromise(this.updateWifiPort),
      getWifiProfile: fromPromise(this.getWifiProfile),
      addWifiConfigs: fromPromise(this.addWifiConfigs),
      generateKeyPair: fromPromise(this.generateKeyPair),
      enumeratePublicPrivateKeyPair: fromPromise(this.enumeratePublicPrivateKeyPair),
      pullPublicPrivateKeyPair: fromPromise(this.pullPublicPrivateKeyPair),
      signCSR: fromPromise(this.signCSR),
      addCertificate: fromPromise(this.addCertificate),
      addRadiusServerRootCertificate: fromPromise(this.addRadiusServerRootCertificate),
      errorMachine: this.error.machine,
      initiateCertRequest: fromPromise(initiateCertRequest),
      getCertFromEnterpriseAssistant: fromPromise(getCertFromEnterpriseAssistant),
      sendEnterpriseAssistantKeyPairResponse: fromPromise(sendEnterpriseAssistantKeyPairResponse)
    },
    guards: {
      is8021xProfileAssociated: ({ context }) =>
        context.wifiProfile?.ieee8021xProfileName != null &&
        context.eaResponse == null &&
        context.addCertResponse == null,
      isMoreWiFiProfiles: ({ context }) =>
        context.amtProfile?.wifiConfigs != null
          ? context.wifiProfileCount < context.amtProfile.wifiConfigs.length
          : false,
      isWiFiProfilesExist: ({ context }) =>
        context.amtProfile?.wifiConfigs != null ? context.amtProfile.wifiConfigs.length > 0 : false,
      isLocalProfileSynchronizationNotEnabled: ({ context }) =>
        context.message.Envelope.Body.AMT_WiFiPortConfigurationService.localProfileSynchronizationEnabled === 0,
      isTrustedRootCertifcateExists: ({ context }) => {
        const res = devices[context.clientId].trustedRootCertificateResponse
        const cert = devices[context.clientId].trustedRootCertificate
        if (res != null && cert === context.eaResponse.rootcert) {
          return true
        }
        return false
      },
      isMSCHAPv2: ({ context }) => context.wifiProfile?.ieee8021xProfileObject?.authenticationProtocol === 2,
      shouldRetry: ({ context, event }) =>
        context.retryCount != null ? context.retryCount < 3 && event.output instanceof UNEXPECTED_PARSE_ERROR : false
    },
    actions: {
      'Reset Unauth Count': ({ context }) => {
        devices[context.clientId].unauthCount = 0
      },
      'Update Configuration Status': ({ context }) => {
        const { clientId, profilesAdded, profilesFailed, statusMessage, errorMessage } = context
        const device = devices[clientId]
        const networkStatus = device.status.Network
        let message
        if (errorMessage) {
          message = errorMessage
        } else if (profilesFailed) {
          message =
            profilesAdded != null
              ? `Added ${profilesAdded} WiFi Profiles. Failed to add ${profilesFailed}`
              : `Failed to add ${profilesFailed}`
        } else {
          message = statusMessage
        }
        device.status.Network = networkStatus ? `${networkStatus}. ${message}` : message
      },
      'Reset Retry Count': assign({ retryCount: () => 0 }),
      'Increment Retry Count': assign({ retryCount: ({ context, event }) => context.retryCount + 1 }),
      'Check Return Value': assign({
        profilesAdded: ({ context, event }) => {
          if (event.output.Envelope?.Body?.AddWiFiSettings_OUTPUT?.ReturnValue === 0) {
            if (context.profilesAdded == null) {
              return `${context.wifiProfileName}`
            } else {
              return `${context.profilesAdded}, ${context.wifiProfileName}`
            }
          } else {
            return context.profilesAdded
          }
        },
        profilesFailed: ({ context, event }) => {
          if (event.output.Envelope?.Body?.AddWiFiSettings_OUTPUT?.ReturnValue !== 0) {
            if (context.profilesFailed == null) {
              return `${context.wifiProfileName}`
            } else {
              return `${context.profilesFailed}, ${context.wifiProfileName}`
            }
          } else {
            return context.profilesFailed
          }
        }
      })
    }
  }).createMachine({
    context: ({ input }) => ({
      clientId: input.clientId,
      amtProfile: input.amtProfile,
      httpHandler: input.httpHandler,
      message: input.message,
      wifiSettings: input.wifiSettings,
      wifiProfileName: input.wifiProfileName,
      wifiProfileCount: input.wifiProfileCount,
      retryCount: input.retryCount,
      amt: input.amt,
      cim: input.cim
    }),
    id: 'wifi-network-configuration-machine',
    initial: 'ACTIVATION',
    states: {
      ACTIVATION: {
        on: {
          WIFICONFIG: {
            actions: [
              assign({ wifiProfileCount: () => 0 }),
              'Reset Unauth Count',
              'Reset Retry Count'
            ],
            target: 'GET_WIFI_PORT_CONFIGURATION_SERVICE'
          }
        }
      },
      GET_WIFI_PORT_CONFIGURATION_SERVICE: {
        invoke: {
          src: 'getWifiPortConfigurationService',
          input: ({ context }) => context,
          id: 'get-wifi-port-configuration-service',
          onDone: {
            actions: assign({ message: ({ event }) => event.output }),
            target: 'CHECK_WIFI_PORT_CONFIGURATION_SERVICE'
          },
          onError: {
            actions: assign({ errorMessage: () => 'Failed to get WiFi Port Configuration Service' }),
            target: 'FAILED'
          }
        }
      },
      CHECK_WIFI_PORT_CONFIGURATION_SERVICE: {
        always: [
          {
            guard: 'isLocalProfileSynchronizationNotEnabled',
            target: 'PUT_WIFI_PORT_CONFIGURATION_SERVICE'
          },
          {
            target: 'REQUEST_STATE_CHANGE_FOR_WIFI_PORT'
          }
        ]
      },
      PUT_WIFI_PORT_CONFIGURATION_SERVICE: {
        invoke: {
          src: 'putWifiPortConfigurationService',
          input: ({ context }) => context,
          id: 'put-wifi-port-configuration-service',
          onDone: {
            actions: assign({ message: ({ event }) => event.output }),
            target: 'REQUEST_STATE_CHANGE_FOR_WIFI_PORT'
          },
          onError: {
            actions: assign({ errorMessage: () => 'Failed to put WiFi Port Configuration Service' }),
            target: 'FAILED'
          }
        }
      },
      REQUEST_STATE_CHANGE_FOR_WIFI_PORT: {
        invoke: {
          src: 'updateWifiPort',
          input: ({ context }) => context,
          id: 'request-state-change-for-wifi-port',
          onDone: {
            actions: assign({ message: ({ event }) => event.output }),
            target: 'CHECK_FOR_WIFI_PROFILES'
          },
          onError: {
            actions: assign({ errorMessage: () => 'Failed to update state change for wifi port' }),
            target: 'FAILED'
          }
        }
      },
      CHECK_FOR_WIFI_PROFILES: {
        always: [
          {
            guard: 'isWiFiProfilesExist',
            target: 'GET_WIFI_PROFILE'
          },
          {
            target: 'SUCCESS_SYNC_ONLY'
          }
        ]
      },
      GET_WIFI_PROFILE: {
        invoke: {
          src: 'getWifiProfile',
          input: ({ context }) => context,
          id: 'get-wifi-profile',
          onDone: {
            target: 'CHECK_TO_ADD_WIFI_SETTINGS'
          },
          onError: {
            actions: assign({ errorMessage: 'Failed to get wifi profile from DB' }),
            target: 'FAILED'
          }
        }
      },
      CHECK_TO_ADD_WIFI_SETTINGS: {
        always: [
          {
            guard: 'is8021xProfileAssociated',
            target: 'ENTERPRISE_ASSISTANT_REQUEST'
          },
          {
            target: 'ADD_WIFI_SETTINGS'
          }
        ]
      },
      ENTERPRISE_ASSISTANT_REQUEST: {
        invoke: {
          src: 'initiateCertRequest',
          input: ({ context }) => context,
          id: 'enterprise-assistant-request',
          onDone: [
            {
              guard: 'isMSCHAPv2',
              actions: assign({ eaResponse: ({ event }) => (event.output as any).response }),
              target: 'CHECK_RADIUS_SERVER_ROOT_CERTIFICATE'
            },
            {
              actions: assign({ message: ({ event }) => event.output }),
              target: 'GENERATE_KEY_PAIR'
            }
          ],
          onError: {
            actions: assign({ errorMessage: 'Failed to initiate cert request with enterprise assistant in 802.1x' }),
            target: 'FAILED'
          }
        }
      },
      GENERATE_KEY_PAIR: {
        invoke: {
          src: 'generateKeyPair',
          input: ({ context }) => context,
          id: 'generate-key-pair',
          onDone: {
            actions: assign({ message: ({ event }) => event.output }),
            target: 'ENUMERATE_PUBLIC_PRIVATE_KEY_PAIR'
          },
          onError: {
            actions: assign({ errorMessage: 'Failed to generate key pair in 802.1x' }),
            target: 'FAILED'
          }
        }
      },
      ENUMERATE_PUBLIC_PRIVATE_KEY_PAIR: {
        invoke: {
          src: 'enumeratePublicPrivateKeyPair',
          input: ({ context }) => context,
          id: 'enumerate-public-private-key-pair',
          onDone: {
            actions: assign({ message: ({ event }) => event.output }),
            target: 'PULL_PUBLIC_PRIVATE_KEY_PAIR'
          },
          onError: {
            actions: assign({ errorMessage: 'Failed to enumerate public private key pair in 802.1x' }),
            target: 'FAILED'
          }
        }
      },
      PULL_PUBLIC_PRIVATE_KEY_PAIR: {
        invoke: {
          src: 'pullPublicPrivateKeyPair',
          input: ({ context }) => context,
          id: 'pull-public-private-key-pair',
          onDone: {
            actions: [assign({ message: ({ event }) => event.output }), 'Reset Retry Count'],
            target: 'ENTERPRISE_ASSISTANT_RESPONSE'
          },
          onError: [
            {
              guard: 'shouldRetry',
              actions: 'Increment Retry Count',
              target: 'ENUMERATE_PUBLIC_PRIVATE_KEY_PAIR'
            },
            {
              actions: assign({ errorMessage: 'Failed to pull public private key pair in 802.1x' }),
              target: 'FAILED'
            }
          ]
        }
      },
      ENTERPRISE_ASSISTANT_RESPONSE: {
        invoke: {
          src: 'sendEnterpriseAssistantKeyPairResponse',
          input: ({ context }) => context,
          id: 'enterprise-assistant-response',
          onDone: {
            actions: assign({ message: ({ event }) => event.output }),
            target: 'SIGN_CSR'
          },
          onError: {
            actions: assign({ errorMessage: 'Failed to send key pair to enterprise assistant in 802.1x' }),
            target: 'FAILED'
          }
        }
      },
      SIGN_CSR: {
        invoke: {
          src: 'signCSR',
          input: ({ context }) => context,
          id: 'sign-csr',
          onDone: {
            actions: assign({ message: ({ event }) => event.output }),
            target: 'GET_CERT_FROM_ENTERPRISE_ASSISTANT'
          },
          onError: {
            actions: assign({ errorMessage: 'Failed to have AMT sign CSR in 802.1x' }),
            target: 'FAILED'
          }
        }
      },
      GET_CERT_FROM_ENTERPRISE_ASSISTANT: {
        invoke: {
          src: 'getCertFromEnterpriseAssistant',
          input: ({ context }) => context,
          id: 'get-cert-from-enterprise-assistant',
          onDone: {
            actions: assign({ message: ({ event }) => event.output }),
            target: 'ADD_CERTIFICATE'
          },
          onError: {
            actions: assign({ errorMessage: 'Failed to get cert from Microsoft CA in 802.1x' }),
            target: 'FAILED'
          }
        }
      },
      ADD_CERTIFICATE: {
        invoke: {
          src: 'addCertificate',
          input: ({ context, event }) => ({ context, event }),
          id: 'add-certificate',
          onDone: {
            actions: assign({ addCertResponse: ({ event }) => event.output.Envelope?.Body }),
            target: 'CHECK_RADIUS_SERVER_ROOT_CERTIFICATE'
          },
          onError: {
            actions: assign({ errorMessage: 'Failed to add certificate in 802.1x' }),
            target: 'FAILED'
          }
        }
      },
      CHECK_RADIUS_SERVER_ROOT_CERTIFICATE: {
        always: [
          {
            guard: 'isTrustedRootCertifcateExists',
            target: 'ADD_WIFI_SETTINGS'
          },
          {
            target: 'ADD_RADIUS_SERVER_ROOT_CERTIFICATE'
          }
        ]
      },
      ADD_RADIUS_SERVER_ROOT_CERTIFICATE: {
        invoke: {
          src: 'addRadiusServerRootCertificate',
          input: ({ context }) => context,
          id: 'add-radius-server-root-certificate',
          onDone: {
            actions: assign({ addTrustedRootCertResponse: ({ event }) => event.output.Envelope.Body }),
            target: 'ADD_WIFI_SETTINGS'
          },
          onError: {
            actions: assign({ errorMessage: 'Failed to add radius server root certificate in 802.1x' }),
            target: 'FAILED'
          }
        }
      },
      ADD_WIFI_SETTINGS: {
        invoke: {
          src: 'addWifiConfigs',
          input: ({ context }) => context,
          id: 'add-wifi-settings',
          onDone: {
            actions: 'Check Return Value',
            target: 'CHECK_ADD_WIFI_SETTINGS_RESPONSE'
          },
          onError: {
            actions: assign({
              profilesFailed: ({ context }) =>
                context.profilesFailed == null
                  ? `${context.wifiProfileName}`
                  : `${context.profilesFailed}, ${context.wifiProfileName}`
            }),
            target: 'CHECK_ADD_WIFI_SETTINGS_RESPONSE'
          }
        }
      },
      CHECK_ADD_WIFI_SETTINGS_RESPONSE: {
        always: [
          {
            guard: 'isMoreWiFiProfiles',
            target: 'GET_WIFI_PROFILE'
          },
          {
            target: 'SUCCESS'
          }
        ]
      },
      ERROR: {
        entry: sendTo('error-machine', { type: 'PARSE' }),
        invoke: {
          src: 'errorMachine',
          id: 'error-machine',
          input: ({ context, event }) => ({
            message: event.output,
            clientId: context.clientId
          })
        },
        on: {
          ONFAILED: 'FAILED'
        }
      },
      FAILED: {
        entry: ['Update Configuration Status'],
        type: 'final'
      },
      SUCCESS: {
        entry: [assign({ statusMessage: () => 'Wireless Configured' }), 'Update Configuration Status'],
        type: 'final'
      },
      SUCCESS_SYNC_ONLY: {
        entry: [
          assign({ statusMessage: () => 'Wireless Only Local Profile Sync Configured' }),
          'Update Configuration Status'
        ],
        type: 'final'
      }
    }
  })

  constructor() {
    this.configurator = new Configurator()
    this.dbFactory = new DbCreatorFactory()
    this.logger = new Logger('Network_Configuration_State_Machine')
  }
}
