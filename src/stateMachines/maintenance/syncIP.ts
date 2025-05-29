/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { assign, setup, sendTo, fromPromise } from 'xstate'
import { coalesceMessage, type CommonMaintenanceContext, type EnumerationContext } from '../common.js'
import { AMT } from '@device-management-toolkit/wsman-messages'
import { doneFail, doneSuccess } from './doneResponse.js'
import Logger from '../../Logger.js'
import { UNEXPECTED_PARSE_ERROR } from '../../utils/constants.js'
import { invokeWsmanCall } from '../common.js'
import { Error as ErrorStateMachine } from './../error.js'

export interface EthernetPortSettingsPullResponse {
  Envelope: {
    Body: {
      PullResponse: {
        Items: {
          AMT_EthernetPortSettings: AMT.Models.EthernetPortSettings | AMT.Models.EthernetPortSettings[]
        }
      }
    }
  }
}
export interface EthernetPortSettingsEnumerateResponse {
  Envelope: {
    Body: {
      EnumerateResponse: {
        EnumerationContext
      }
    }
  }
}

export const MessageNoWiredSettingsOnDevice = 'Device has no wired configuration settings'
export const MessageWirelessOnly = 'Not applicable for wireless only device'
export const MessageAlreadySynchronized = 'IPAddress already synchronized'

export interface IPConfiguration {
  ipAddress: string
  netmask: string
  gateway: string
  primaryDns: string
  secondaryDns: string
}

export const SyncIPEventType = 'SYNC_IP'
export interface SyncIPEvent {
  type: typeof SyncIPEventType | 'ONFAILED'
  clientId: string
  targetIPConfig?: IPConfiguration
  output?: any
}

export interface SyncIPContext extends CommonMaintenanceContext {
  targetIPConfig?: IPConfiguration
  enumerationContext: EnumerationContext
  parseErrorCount: number
  wiredSettings: AMT.Models.EthernetPortSettings
  wirelessSettings?: AMT.Models.EthernetPortSettings
}

class PullData {
  wiredSettings?: AMT.Models.EthernetPortSettings
  wirelessSettings?: AMT.Models.EthernetPortSettings
}

export const amt = new AMT.Messages()
const logger = new Logger('syncIP')

export class SyncIP {
  enumerateEthernetPortSettings = async ({ input }: { input: SyncIPContext }): Promise<EnumerationContext> => {
    input.xmlMessage = amt.EthernetPortSettings.Enumerate()
    const rsp = await invokeWsmanCall<EthernetPortSettingsEnumerateResponse>(input, 2)
    const enumCtx = rsp.Envelope.Body.EnumerateResponse.EnumerationContext
    if (!enumCtx) {
      throw new Error(`invalid response: ${JSON.stringify(rsp)}`)
    }
    logger.debug(`EnumerationContext: ${enumCtx}`)
    return enumCtx
  }

  pullEthernetPortSettings = async ({ input }: { input: SyncIPContext }): Promise<PullData> => {
    input.xmlMessage = amt.EthernetPortSettings.Pull(input.enumerationContext)
    const rsp = await invokeWsmanCall<EthernetPortSettingsPullResponse>(input)
    const settings = rsp.Envelope.Body.PullResponse.Items.AMT_EthernetPortSettings
    if (!settings) {
      throw new Error(`invalid response: ${JSON.stringify(rsp)}`)
    }
    const pullData: PullData = {}
    // settings might be a single entry or an array
    // set it up for processing as an array
    let settingsArray: any[]
    if (!Array.isArray(settings)) {
      settingsArray = [settings]
    } else {
      settingsArray = settings
    }
    // In Intel AMT Release 6.0 and later releases InstanceId value is
    // 'Intel(r) AMT Ethernet Port Settings 0' for wired instance
    // 'Intel(r) AMT Ethernet Port Settings 1' for wireless instance
    settingsArray.forEach((e) => {
      if (e.InstanceID.includes('Settings 0')) {
        pullData.wiredSettings = e
      }
      if (e.InstanceID.includes('Settings 1')) {
        pullData.wirelessSettings = e
      }
    })
    logger.debug(`EthernetPortSettings: ${JSON.stringify(pullData)}`)
    return pullData
  }

  putEthernetPortSettings = async ({ input }: { input: SyncIPContext }): Promise<string> => {
    let statusMessage = ''
    if (!input.wiredSettings) {
      statusMessage = MessageNoWiredSettingsOnDevice
    } else if (input.wirelessSettings != null && input.wiredSettings.MACAddress == null) {
      statusMessage = MessageWirelessOnly
    } else if (input.wiredSettings.IPAddress === input.targetIPConfig?.ipAddress) {
      statusMessage = MessageAlreadySynchronized
    }
    if (statusMessage !== '') {
      const err = new Error(statusMessage)
      return await new Promise<string>((resolve, reject) => {
        reject(err)
      })
    }

    // preserve what is in the input
    const settingsToPut = {
      ...input.wiredSettings
    }
    if (input.wiredSettings?.DHCPEnabled) {
      settingsToPut.IpSyncEnabled = true
      settingsToPut.SharedStaticIp = false
      delete settingsToPut.IPAddress
      delete settingsToPut.SubnetMask
      delete settingsToPut.DefaultGateway
      delete settingsToPut.PrimaryDNS
      delete settingsToPut.SecondaryDNS
    } else {
      settingsToPut.IpSyncEnabled = false
      settingsToPut.SharedStaticIp = false
      settingsToPut.IPAddress = input.targetIPConfig?.ipAddress
      settingsToPut.SubnetMask = input.targetIPConfig?.netmask ?? settingsToPut.SubnetMask
      settingsToPut.DefaultGateway = input.targetIPConfig?.gateway ?? settingsToPut.DefaultGateway
      settingsToPut.PrimaryDNS = input.targetIPConfig?.primaryDns ?? settingsToPut.PrimaryDNS
      settingsToPut.SecondaryDNS = input.targetIPConfig?.secondaryDns ?? settingsToPut.SecondaryDNS
    }

    logger.debug(`putting wired settings: ${JSON.stringify(settingsToPut)}`)
    input.xmlMessage = amt.EthernetPortSettings.Put(settingsToPut)
    const rsp = await invokeWsmanCall<AMT.Models.EthernetPortSettings>(input)
    if (!rsp) {
      throw new Error(`invalid response: ${JSON.stringify(rsp)}`)
    }
    // interestingly, the ipAddress that was put is not in the response
    return input.targetIPConfig!.ipAddress
  }

  error: ErrorStateMachine = new ErrorStateMachine()
  machine = setup({
    types: {} as {
      context: SyncIPContext
      events: SyncIPEvent
      actions: any
      input: SyncIPContext
    },
    actors: {
      enumerateEthernetPortSettings: fromPromise(this.enumerateEthernetPortSettings),
      pullEthernetPortSettings: fromPromise(this.pullEthernetPortSettings),
      putEthernetPortSettings: fromPromise(this.putEthernetPortSettings),
      error: this.error.machine
    },
    actions: {
      incrementParseErrorCount: assign({ parseErrorCount: ({ context }) => context.parseErrorCount + 1 }),
      resetParseErrorCount: assign({ parseErrorCount: 0 })
    },
    guards: {
      checkIPAddress: ({ context, event }) =>
        event.targetIPConfig?.ipAddress != null && event.targetIPConfig?.ipAddress !== '',
      shouldRetryOnParseError: ({ context, event }) =>
        context.parseErrorCount < 3 && event.output instanceof UNEXPECTED_PARSE_ERROR,
      isEnumEthernetPort: ({ context, event }) => context.targetAfterError === 'ENUMERATE_ETHERNET_PORT_SETTINGS'
    }
  }).createMachine({
    /** @xstate-layout N4IgpgJg5mDOIC5SwJ4DsDGBaAlgBwDoBJAOSIBUiBBAGQGIBlATRIGEB9IgBQG0AGALqJQeAPawcAFxyi0wkAA9EARj7KCADgCsWgEwAWAGwBmPQHZl+gDQgUKw+uMBOXU7Onjhvid0BfXzaomLiEpBTU9MxsnLzKQkggYhLSsvJKCKrq2npGproW1raIWFp8BPpa+rq6Jk5OhoYuyv6B6Nj4BACiJACqALKdAEpU5J3sneQAEkMkE+xcAPKD5OwME5QkAOIMdBCyYAQ4aABuogDWB2BoAK4AtmAATgCGkmBYYJIAFo9oH1hiD0kWFgH2kaCgsH48RE4ikMjkCXSui0TgIyi0ZjMhmRGg8FhsdgQWF0xl0BCcGnyFL4Zn0TksLRAQXahG6-SGIzGE2mg1mK0Wy1W61I2zojweogeBDwABsXgAzSW3AhXO6PF5vD7fB6-IEAoEgyRgiFQ+RJOGpRGINz6Ai6bRmbQaDRmPgkwwE4rKZx25TaZTVYxmVzojSM5khAhcHo0GjjKYzOYClZrcgbUV7X6HE7nA54a4ymXvL4-P764Ggo4mwRm2EpBGgdKZTQ6AwmcyWT1E0m2gyu3H05GeIPhtqR6Ox+M8vnzJYp4VbHbiyXSuWSRUPZX5wvF7W6-6Sg2V8GQmsJc31tIqNQtnLt-KdopEyzqCz+wPB+laMMBJljjoTnG3KJvyc5CmmIpLg8EpSrKCpKtKBZFlqpZ6oeFZGlWkJxLWyTwleGQ3tkbZ5AUXb6MYmh8PoGiGI6xhOn6o7BABPQrMBvJJmBqbpjsmYHEcpwXIhQIoTqZboYaxqntCiR1vhVoIDadoOk6Lpup4XZYMY+jqF4hj6HwTgVHwGj6JihjMSyUZsVOIGzoKPGQWK0ErnB64IfmokluJaGAhh0mmue8mWo21q0ipGJqa67paciZQ6boAaeN61SVP4v5oKIEBwPIEb4LhFoNooxRBmYaKqEY9SlN+ThaFpVQaAQjq4nROk0hYZhWZGYSULQhWXopJRkuZuhumYTimcGGhunFelaEGdSNFVFHaN1HRsgMwyjHZnGgY5C7bANClhQgUUEKSfDeBSuLBrNT5YOi6jKAZOkosYOmWDo62EIBu0zsm4G8cdoUld2rgVdRjSGDVGh1Vpxh8JRxleHUtLeCSxk-TZ7EJntDnzhBi4g8V6TnZd13OkGY26Ajnhoi49JYqZMNY7++WEAAYlQRA0J0AAiJMEd6bpom6DguHwKLKPUWnKJY5ITe9X6eCSxjYwwPSsKwnQMAwQuKSLZKqDUMtjdLssPaS6jVRNwaOt69IZb4QA */
    id: 'sync-ip',
    context: ({ input }) => ({
      taskName: input.taskName,
      clientId: input.clientId,
      message: input.message,
      errorMessage: input.errorMessage,
      statusMessage: input.statusMessage,
      httpHandler: input.httpHandler,
      parseErrorCount: input.parseErrorCount,
      enumerationContext: input.enumerationContext,
      wiredSettings: input.wiredSettings
    }),
    initial: 'INITIAL',
    states: {
      INITIAL: {
        on: {
          SYNC_IP: [
            {
              guard: 'checkIPAddress',
              actions: assign({
                clientId: ({ event }) => event.clientId,
                targetIPConfig: ({ event }) => event.targetIPConfig
              }),
              target: 'ENUMERATE_ETHERNET_PORT_SETTINGS'
            },
            {
              actions: assign({
                message: 'at INITIAL - invalid ip configuration'
              }),
              target: 'FAILED'
            }
          ]
        }
      },
      ENUMERATE_ETHERNET_PORT_SETTINGS: {
        entry: assign({
          message: () => '',
          errorMessage: () => ''
        }),
        invoke: {
          id: 'enumerate-ethernet-port-settings',
          src: 'enumerateEthernetPortSettings',
          input: ({ context }) => context,
          onDone: {
            actions: assign({ enumerationContext: ({ event }) => event.output }),
            target: 'PULL_ETHERNET_PORT_SETTINGS'
          },
          onError: {
            actions: assign({
              message: ({ event }) => event.error,
              errorMessage: ({ event }) => coalesceMessage('at ENUMERATE_ETHERNET_PORT_SETTINGS', event.error),
              targetAfterError: () => 'ENUMERATE_ETHERNET_PORT_SETTINGS'
            }),
            target: 'ERROR'
          }
        }
      },
      PULL_ETHERNET_PORT_SETTINGS: {
        entry: assign({
          message: () => '',
          errorMessage: () => ''
        }),
        invoke: {
          id: 'pull-ethernet-port-settings',
          src: 'pullEthernetPortSettings',
          input: ({ context }) => context,
          onDone: {
            actions: assign(({ event }) => ({
              wiredSettings: (event.output as any).wiredSettings,
              wirelessSettings: (event.output as any).wirelessSettings
            })),
            target: 'PUT_ETHERNET_PORT_SETTINGS'
          },
          onError: [
            {
              guard: 'shouldRetryOnParseError',
              actions: 'incrementParseErrorCount',
              target: 'ENUMERATE_ETHERNET_PORT_SETTINGS'
            },
            {
              actions: [
                'resetParseErrorCount',
                assign({
                  errorMessage: ({ event }) => coalesceMessage('at PULL_ETHERNET_PORT_SETTINGS', event.error)
                })
              ],
              target: 'FAILED'
            }
          ]
        }
      },
      PUT_ETHERNET_PORT_SETTINGS: {
        entry: assign({
          message: () => '',
          errorMessage: () => ''
        }),
        invoke: {
          id: 'put-ethernet-port-settings',
          src: 'putEthernetPortSettings',
          input: ({ context }) => context,
          onDone: {
            actions: assign({ statusMessage: ({ event }) => event.output }),
            target: 'SUCCESS'
          },
          onError: {
            actions: assign({
              errorMessage: ({ event }) => coalesceMessage('at PUT_ETHERNET_PORT_SETTINGS', event.error)
            }),
            target: 'FAILED'
          }
        }
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
          onError: {
            actions: assign({ message: ({ event }) => event.error }),
            target: 'FAILED'
          },
          onDone: 'NEXT_STATE'
        },
        on: {
          ONFAILED: {
            actions: assign({
              errorMessage: ({ context, event }) => coalesceMessage(context.errorMessage, event.output)
            }),
            target: 'FAILED'
          }
        }
      },
      NEXT_STATE: {
        always: [
          {
            guard: 'isEnumEthernetPort',
            target: 'ENUMERATE_ETHERNET_PORT_SETTINGS'
          }
        ]
      },
      FAILED: {
        entry: assign({ statusMessage: () => 'FAILED' }),
        type: 'final'
      },
      SUCCESS: {
        entry: assign({ statusMessage: () => 'SUCCESS' }),
        type: 'final'
      }
    },
    output: ({ context }) => {
      if (context.statusMessage === 'SUCCESS') {
        return doneSuccess(context.taskName)
      } else {
        return doneFail(context.taskName, context.errorMessage)
      }
    }
  })
}
