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
import { ProxyConfiguration } from './proxyConfiguration.js'

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
  proxyConfiguration: ProxyConfiguration = new ProxyConfiguration()

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
      proxyConfiguration: this.proxyConfiguration.machine,
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
      isProxyGiven: ({ context }) => {
        const profile = context.amtProfile
        if (profile?.proxyConfigs != null) {
          return profile.proxyConfigs.length > 0
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
    /** @xstate-layout N4IgpgJg5mDOIC5QDswBcDuB7ATgawFoBjLZAMwEsoBXHAQzQtIIFs6iALC1AOgEEAwgBUAkgDU+ogPIA5AMQyAokIDqUgEoBpAbIBiIgOIBVdZJGyA2gAYAuolAAHLLAqNS9kAA9EAZgAsAEw8AKx+AIwAbBEA7AAcPgHRYWHRADQgAJ6IflYAnDzRVvE+PrkRfsGx0YkAvjXpqJi4hCTkVLQMTMis7Fy8AgASigKaAPoGikqmADKjAMrKojIGc3LWdkggTi5uyB7eCLE5Ibk+0cE+Vn65yT7B6VkIl8E8edUBAUc5RbF1DejYfDEUiUGj0XY9TjcMA8QbDMYTKZ8WYLIRLFZrMIbRzOVxdfaII5WE5nC5XG5hO4PbIRMIhYr+MLxKIVHx-ECNQEtEHtcFdSF9GEABSMQnGk0UM3mixEy1WEFIMO4ADcsHgYQ5qGgCDBUPQADYEWDoRjIKCwdYebZ49ybA5hYJXAqlSqxKqJHJhakIAK5F6OqyBqyVJllcrsznNYFtMGdZhsKG8EVixGS5HStGyjFgHA4XA8Bz6hhkXAsAtanVgPV0Q3GtCm82WzbW3YEhAOp3RF1u93RT3egJWOk3KJRXJ5PwRXJuiMAqOtUEdCEJwU8SZGACyaaEilGyiG6iUYqFGjFqPR8sVPBVaphVeoLBzDDABHQHBzjQIThw2rrDYtthWrirZ2ogDrxCEwSDrEuSDlYPgpN6lTEkUJT+AEoQJP4s5NECC68nG3QrtCa4yJu267vukpHqMJ7qGeMpynIOZ5jgBZFmgJY4GW96PuCL5vh+6Bfrgv4mtwjaAc2wH4qBPoIbEPDTn6NzTlOiQ+EhESKaOUTnH4fg+BERQ4Vy0aLny8a9CRIrTLMVGHsotGnhmF5yAqvA3uq5b6oagk4J+35ifWEkAdiWwybaoD2o6fjOn6PbVH2Q7esksTDpEURVAkwZ+KZ848rGy7WUmRh2XuQgHjRdEMZmTEsfmhbFqWPl+Wg74BcJQVGuJZphUBOyydFYGxfFrq9v2mSIDEPg8LpMSwTEjoBPleGFUu-LEaV5UOdVLnnlmqwNWxTWcS1mq+a+7VCdq3V-qFFhYgNNp7HJHZxV2CVuklk2PNEMQ8BhQYOrkNz-bkq3cjGG1WYmMJwiMFVVU5NWuYdtFlbM6iKHMJ4yAsaxSTig1RV4iABApSkwcEqmxOpXapVY5xzUDViDqUFMRMEkPmQRxVw7CQyI7tKP7YxKwY+V2O47IBOPeFLZDWT8lMlTKlhGpsEM1N7YBMchTFME5SXLEAQRDz+FFZtJXw0LYwi8eYt1RLtlYzjeNywECuRa9w0q4pyk0xrdNa5pOvjvkoSZUcdylPBFvrZZRE2zwKgiNjAAiow6DI+jGKY0jyB5SrIKq3kYBQOCQAQkZrdDScCtCTbEy9baXBhrwRBhtw00k5yM2UIRTgZXOFF2FQJ-XhGN7waeZ9neiGCYZiyO5V5eTCFdVxANdznXFnT1tYDy89IF++3LxWF3wQ97kff3DrYTkp3uQj4ECkfJPB-86uaf6Avucl4F3MEXdepdbw8ArpQXeuEobf2tnDZuEUSa+2VqUY48Ewhm2uOcKIXpH4BBSDwQywZgjRHIYOSIvx6gcj3nAvmCDVxCnUFIAAGgATQAXnZehc16eXAd5BweZPAZF5lbWGgokGK1JgcdBKEELYLvkbWk3o+yzQNiUPwpsjhm2of8WBYiYbJwFpKFh6g+ElzLneXMuAZ7HyJsg1ucl0IhHCHpeIiRkhpB1kZII0E0LpUKP4PRtCDGWyMXYtc6gzFyD0HwEQ0xFAZykT7NugRXGZTiAkJIiEdbpR4JlUcptX40wwnUGhyAsAQDgB4Wu9DxHGMFKfJWBwCARG9AQF4oNQbuhjoEcIX8GESJIoIUQEhC7NJkeTeCxCr5AxiEUKcVRvSTmJPNc4TNyg00GQ0yJCMEQSilAdOUkzUEHBpl0yoJRQhaPIXkFZFxiGFL7LEN4yidkRKPjwZM4okQonFnMU5bZkgzLNl2LmkQNZ+G1o8T4KFKRulflcfwTMPkNy+euLcBdKKVWoqLeiaMTnSRQcCmCEQChhAqOOIycy-RITITwKoAZUKbIdGiw+KdXZIzxY7AlxyVhAreqhMa2U8inAdKlB0QQrnXMSN9c47Kf4kX2dyxyvLaoXklm7GW+NFCCr9qGWa1MiT+GhWQsOjxkivx4Gha5BlTY30VYwkic8klcKASvGQ+rlZm19J3IGd8yjjmWY-NmikrjR0dMZa4TrhmzxEP-HO3DgGyG9bIm5rwFEREZJ8KCARJWFBOO8fpULtKxsaTZFhHD3X509Wm3wGbMFmxzbEPN3opzkqZYGLB047jRHLZE0xGh60IECN6S45L-DvD1kkFkKQB1fN0PExJGcR2+vyHMx0gapxFG8Y8YIRtGUyrcVCpIC6U5zCMAIAQONAXEqcX7QIXcCjRoSPEU20LGbpMIa-Sc6CcnlJqEAA */
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
            {
              guard: 'isProxyGiven',
              target: 'PROXY_CONFIGURATION'
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
          onDone: [
            {
              guard: 'isProxyGiven',
              target: 'PROXY_CONFIGURATION'
            },
            { target: 'SUCCESS' }
          ]
        }
      },
      PROXY_CONFIGURATION: {
        entry: sendTo('proxy-configuration-machine', { type: 'PROXYCONFIG' }),
        invoke: {
          src: 'proxyConfiguration',
          id: 'proxy-configuration-machine',
          input: ({ context }) => ({
            clientId: context.clientId,
            amtProfile: context.amtProfile,
            httpHandler: context.httpHandler,
            message: '',
            proxyConfigsCount: 0,
            retryCount: 0,
            ips: context.ips
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
