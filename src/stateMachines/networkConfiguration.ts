/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { type AMT, type CIM, type IPS } from '@device-management-toolkit/wsman-messages'
import { assign, fromPromise, sendTo, setup } from 'xstate'
import Logger from '../Logger.js'
import { type AMTConfiguration } from '../models/index.js'
import { devices } from '../devices.js'
import { Error } from './error.js'
import { Configurator } from '../Configurator.js'
import { DbCreatorFactory } from '../factories/DbCreatorFactory.js'
import { type CommonContext, invokeWsmanCall } from './common.js'
import { UNEXPECTED_PARSE_ERROR } from '../utils/constants.js'
import { WiredConfiguration } from './wiredNetworkConfiguration.js'
import { WiFiConfiguration } from './wifiNetworkConfiguration.js'

export interface NetworkConfigContext extends CommonContext {
  amtProfile: AMTConfiguration | null
  retryCount: number
  generalSettings: AMT.Models.GeneralSettings
  wiredSettings?: any
  wifiSettings?: any
  amt: AMT.Messages
  ips?: IPS.Messages
  cim?: CIM.Messages
}

export interface NetworkConfigEvent {
  type: 'NETWORKCONFIGURATION' | 'ONFAILED'
  clientId: string
  output?: any
}
export class NetworkConfiguration {
  configurator: Configurator
  logger: Logger
  dbFactory: DbCreatorFactory
  db: any
  error: Error = new Error()
  wiredConfiguration: WiredConfiguration = new WiredConfiguration()
  wifiConfiguration: WiFiConfiguration = new WiFiConfiguration()

  putGeneralSettings = async ({ input }: { input: NetworkConfigContext }): Promise<any> => {
    input.xmlMessage = input.amt.GeneralSettings.Put(input.generalSettings)
    return await invokeWsmanCall(input)
  }

  isNotAMTNetworkEnabled = ({ context }: { context: NetworkConfigContext }): boolean => {
    // AMTNetworkEnabled - When set to Disabled, the AMT OOB network interfaces (LAN and WLAN) are disabled including AMT user initiated applications, Environment Detection and RMCPPing.
    // 0 : Disabled, 1 - Enabled
    // SharedFQDN -Defines Whether the FQDN (HostName.DomainName) is shared with the Host or dedicated to ME. (The default value for this property is shared - TRUE).
    // RmcpPingResponseEnabled - Indicates whether Intel(R) AMT should respond to RMCP ping Echo Request messages.
    const settings: AMT.Models.GeneralSettings | null = context.generalSettings
    if (settings != null) {
      if (!settings.SharedFQDN || settings.AMTNetworkEnabled !== 1 || !settings.RmcpPingResponseEnabled) {
        settings.SharedFQDN = true
        settings.AMTNetworkEnabled = 1
        settings.RmcpPingResponseEnabled = true
        context.generalSettings = settings
        return true
      }
    }
    return false
  }

  enumerateEthernetPortSettings = async ({ input }: { input: NetworkConfigContext }): Promise<any> => {
    input.xmlMessage = input.amt.EthernetPortSettings.Enumerate()
    return await invokeWsmanCall(input, 2)
  }

  async pullEthernetPortSettings({ input }: { input: NetworkConfigContext }): Promise<any> {
    input.xmlMessage = input.amt.EthernetPortSettings.Pull(
      input.message.Envelope.Body?.EnumerateResponse?.EnumerationContext
    )
    return await invokeWsmanCall(input)
  }

  readEthernetPortSettings = ({ context }: { context: NetworkConfigContext }): void => {
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

  machine = setup({
    types: {} as {
      context: NetworkConfigContext
      events: NetworkConfigEvent
      actions: any
      input: NetworkConfigContext
    },
    actors: {
      wiredConfiguration: this.wiredConfiguration.machine,
      wifiConfiguration: this.wifiConfiguration.machine,
      errorMachine: this.error.machine,
      putGeneralSettings: fromPromise(this.putGeneralSettings),
      enumerateEthernetPortSettings: fromPromise(this.enumerateEthernetPortSettings),
      pullEthernetPortSettings: fromPromise(this.pullEthernetPortSettings)
    },
    guards: {
      isNotAMTNetworkEnabled: this.isNotAMTNetworkEnabled,
      isWifiOnlyDevice: ({ context }) => context.wifiSettings != null && context.wiredSettings?.MACAddress == null,
      isWiredSupportedOnDevice: ({ context }) => context.wiredSettings?.MACAddress != null,
      isWifiSupportedOnDevice: ({ context }) => {
        const profile = context.amtProfile
        if (profile?.wifiConfigs != null) {
          if (
            context.wifiSettings?.MACAddress != null &&
            (profile.wifiConfigs.length > 0 || profile.localWifiSyncEnabled)
          ) {
            return true
          }
        }
        return false
      },
      isLocalProfileSynchronizationNotEnabled: ({ context }) =>
        context.message.Envelope.Body.AMT_WiFiPortConfigurationService.localProfileSynchronizationEnabled === 0,
      shouldRetry: ({ context, event }) =>
        context.retryCount != null && context.retryCount < 3 && event.output instanceof UNEXPECTED_PARSE_ERROR
    },
    actions: {
      'Reset Unauth Count': ({ context }) => {
        devices[context.clientId].unauthCount = 0
      },
      'Read Ethernet Port Settings': this.readEthernetPortSettings,
      'Reset Retry Count': assign({ retryCount: () => 0 }),
      'Increment Retry Count': assign({ retryCount: ({ context }) => context.retryCount + 1 }),
      'Update Configuration Status': ({ context }) => {
        devices[context.clientId].status.Network = context.errorMessage
      }
    }
  }).createMachine({
    // todo: the actual context comes in from the parent and clobbers this one
    // xstate version 5 should fix this.
    context: ({ input }) => ({
      clientId: input.clientId,
      amtProfile: input.amtProfile,
      httpHandler: input.httpHandler,
      message: input.message,
      retryCount: input.retryCount,
      generalSettings: input.generalSettings,
      wiredSettings: input.wiredSettings,
      amt: input.amt,
      ips: input.ips,
      cim: input.cim
    }),
    id: 'network-configuration-machine',
    initial: 'ACTIVATION',
    states: {
      ACTIVATION: {
        on: {
          NETWORKCONFIGURATION: {
            actions: [
              assign({ errorMessage: () => '' }),
              'Reset Unauth Count',
              'Reset Retry Count'
            ],
            target: 'CHECK_GENERAL_SETTINGS'
          }
        }
      },
      CHECK_GENERAL_SETTINGS: {
        always: [
          {
            guard: 'isNotAMTNetworkEnabled',
            target: 'PUT_GENERAL_SETTINGS'
          },
          {
            target: 'ENUMERATE_ETHERNET_PORT_SETTINGS'
          }
        ]
      },
      PUT_GENERAL_SETTINGS: {
        invoke: {
          src: 'putGeneralSettings',
          input: ({ context }) => context,
          id: 'put-general-settings',
          onDone: {
            actions: assign({ message: ({ event }) => event.output }),
            target: 'ENUMERATE_ETHERNET_PORT_SETTINGS'
          },
          onError: {
            actions: assign({ errorMessage: () => 'Failed to update amt general settings on device' }),
            target: 'FAILED'
          }
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
            actions: assign({ errorMessage: () => 'Failed to get enumeration number to ethernet port settings' }),
            target: 'FAILED'
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
              target: 'FAILED'
            }
          ]
        }
      },
      CHECK_ETHERNET_PORT_SETTINGS_PULL_RESPONSE: {
        entry: 'Read Ethernet Port Settings',
        always: [
          {
            guard: 'isWiredSupportedOnDevice',
            target: 'WIRED_CONFIGURATION'
          },
          {
            guard: 'isWifiOnlyDevice',
            target: 'WIFI_CONFIGURATION'
          },
          {
            target: 'SUCCESS'
          }
        ]
      },
      WIRED_CONFIGURATION: {
        entry: sendTo('wired-network-configuration-machine', { type: 'WIREDCONFIG' }),
        invoke: {
          src: 'wiredConfiguration',
          id: 'wired-network-configuration-machine',
          input: ({ context }) => ({
            clientId: context.clientId,
            amtProfile: context.amtProfile,
            wiredSettings: context.wiredSettings,
            httpHandler: context.httpHandler,
            message: '',
            retryCount: 0,
            amt: context.amt,
            ips: context.ips,
            cim: context.cim
          }),
          onDone: [
            {
              guard: 'isWifiSupportedOnDevice',
              target: 'WIFI_CONFIGURATION'
            },
            { target: 'SUCCESS' }
          ]
        }
      },
      WIFI_CONFIGURATION: {
        entry: sendTo('wifi-network-configuration-machine', { type: 'WIFICONFIG' }),
        invoke: {
          src: 'wifiConfiguration',
          id: 'wifi-network-configuration-machine',
          input: ({ context }) => ({
            clientId: context.clientId,
            amtProfile: context.amtProfile,
            httpHandler: context.httpHandler,
            message: '',
            wifiSettings: context.wifiSettings,
            wifiProfileCount: 0,
            retryCount: 0,
            amt: context.amt,
            cim: context.cim
          }),
          onDone: 'SUCCESS'
        }
      },
      ERROR: {
        entry: sendTo('error-machine', { type: 'PARSE' }),
        invoke: {
          src: 'errorMachine',
          id: 'error-machine',
          input: ({ context, event }) => ({
            message: event.output,
            clientId: context.clientId
          }),
          onDone: 'CHECK_GENERAL_SETTINGS' // To do: Need to test as it might not require anymore.
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
