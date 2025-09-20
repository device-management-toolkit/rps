/*********************************************************************
 * Copyright (c) Intel Corporation 2025
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

// import { type AMT, type CIM, type IPS } from '@device-management-toolkit/wsman-messages'
import { type IPS } from '@device-management-toolkit/wsman-messages'
import { assign, sendTo, fromPromise, setup } from 'xstate'
import { type ProxyConfig } from '../models/RCS.Config.js'
import Logger from '../Logger.js'
import { type AMTConfiguration } from '../models/index.js'
import { devices } from '../devices.js'
import { Error } from './error.js'
import { Configurator } from '../Configurator.js'
import { DbCreatorFactory } from '../factories/DbCreatorFactory.js'
import { type CommonContext, invokeWsmanCall } from './common.js'
import { UNEXPECTED_PARSE_ERROR } from '../utils/constants.js'

interface ProxyConfigContext extends CommonContext {
  amtProfile: AMTConfiguration | null
  proxyConfigs?: ProxyConfig
  proxyConfigsCount: number
  retryCount: number
  proxyConfigName?: string | null
  proxyConfigsAdded?: string
  proxyConfigsFailed?: string
  ips?: IPS.Messages
}

export interface ProxyConfigEvent {
  type: 'PROXYCONFIG' | 'ONFAILED'
  clientId: string
  output?: any
}

export class ProxyConfiguration {
  configurator: Configurator
  logger: Logger
  dbFactory: DbCreatorFactory
  db: any
  error: Error = new Error()

  getProxyConfig = async ({ input }: { input: ProxyConfigContext }): Promise<void> => {
    if (input.amtProfile?.proxyConfigs != null) {
      // Get Proxy profile information based on the profile name from db.
      this.db = await this.dbFactory.getDb()
      input.proxyConfigs = await this.db.proxyConfigs.getByName(
        input.amtProfile.proxyConfigs[input.proxyConfigsCount].profileName,
        input.amtProfile.tenantId
      )
      return
    }
    this.logger.error('Null object in getProxyConfig()')
  }

  addProxyConfigs = async ({ input }: { input: ProxyConfigContext }): Promise<any> => {
    // Add proxy config information to HTTP Proxy Service object
    const proxyAccessPointParameters: IPS.Models.AddProxyAccessPointParameters = {
      AccessInfo: input.proxyConfigs?.address ?? '',
      InfoFormat: input.proxyConfigs?.infoFormat ?? 3,
      Port: input.proxyConfigs?.port ?? 0,
      NetworkDnsSuffix: input.proxyConfigs?.networkDnsSuffix ?? ''
    }

    input.xmlMessage = input.ips?.HTTPProxyService.AddProxyAccessPoint(proxyAccessPointParameters)

    input.proxyConfigName = input.proxyConfigs?.address ?? null
    // Increment the count to keep track of proxies added to AMT
    ++input.proxyConfigsCount
    return await invokeWsmanCall(input)
  }

  machine = setup({
    types: {} as {
      context: ProxyConfigContext
      events: ProxyConfigEvent
      actions: any
      input: ProxyConfigContext
    },
    actors: {
      getProxyConfig: fromPromise(this.getProxyConfig),
      addProxyConfigs: fromPromise(this.addProxyConfigs),
      errorMachine: this.error.machine
    },
    guards: {
      isMoreProxyConfigs: ({ context }) =>
        context.amtProfile?.proxyConfigs != null
          ? context.proxyConfigsCount < context.amtProfile.proxyConfigs.length
          : false,
      isProxyConfigsExist: ({ context }) =>
        context.amtProfile?.proxyConfigs != null ? context.amtProfile.proxyConfigs.length > 0 : false,
      shouldRetry: ({ context, event }) =>
        context.retryCount != null ? context.retryCount < 3 && event.output instanceof UNEXPECTED_PARSE_ERROR : false
    },
    actions: {
      'Update Configuration Status': ({ context }) => {
        const { clientId, proxyConfigsAdded, proxyConfigsFailed, statusMessage, errorMessage } = context
        const device = devices[clientId]
        const networkStatus = device.status.Network
        let message
        if (errorMessage) {
          message = errorMessage
        } else if (proxyConfigsFailed) {
          message =
            proxyConfigsAdded != null
              ? `Added ${proxyConfigsAdded} Proxy Configurations. Failed to add ${proxyConfigsFailed}`
              : `Failed to add ${proxyConfigsFailed}`
        } else {
          message = statusMessage
        }
        device.status.Network = networkStatus ? `${networkStatus}. ${message}` : message
      },
      'Reset Retry Count': assign({ retryCount: () => 0 }),
      'Increment Retry Count': assign({ retryCount: ({ context }) => context.retryCount + 1 }),
      'Check Return Value': assign({
        proxyConfigsAdded: ({ context, event }) => {
          if (event.output.Envelope?.Body?.AddProxyAccessPoint_OUTPUT?.ReturnValue === 0) {
            if (context.proxyConfigsAdded == null) {
              return `${context.proxyConfigName}`
            } else {
              return `${context.proxyConfigsAdded}, ${context.proxyConfigName}`
            }
          } else {
            return context.proxyConfigsAdded
          }
        },
        proxyConfigsFailed: ({ context, event }) => {
          if (event.output.Envelope?.Body?.AddProxyAccessPoint_OUTPUT?.ReturnValue !== 0) {
            if (context.proxyConfigsFailed == null) {
              return `${context.proxyConfigName}`
            } else {
              return `${context.proxyConfigsFailed}, ${context.proxyConfigName}`
            }
          } else {
            return context.proxyConfigsFailed
          }
        }
      })
    }
  }).createMachine({
    /** @xstate-layout N4IgpgJg5mDOIC5QAcBOB7AHgTwLQGN0A7AMwEsoBXVAQwBczjcBbG-ACzKLADoBBAMIAVAJIA1PqIDyAOQDEABQBKUgBoBNAbIBiIgOIBtAAwBdRCnSwyDYuZCZEAFgBMARh4BOIwDZnAZkcADi9nUIBWMIAaEGxEQPcwoyNXIwB2ZyNQj0cw1IBfPOi0LDxCUgpqekYiFjZObh4BAAkAUQEAaQB9bSklTuU1dU6tGV09AGU5YzMkEGRLa2q7BwQU13dA50CjD2zvR1S-V29o2NXXDx5Uoz9-Vz9vLw8-MOcCoowcAmJyKlobGqsDhcXh6FpCfoqDTDHT6OQQYi8LgAN3QAGteDA6Lhil8yr9pnZ5lYActEGtAld4hcPIlUtlUicYohnKkwjxvGFvA9HF5goEBWF3nNPqUfhV-tVasCGmCIQNoSMxnIwKgMKgeMgADb0EjoVDMHhYnGi77lKCE2bExa2WYrVy5VI8HJHC7+baOIxRZkIZyvTzODzbP37VyBVLHYW4sXmyoA6X1Xh8AAiychgxho30kwRDRR6N4NAgEBNJTNv1glosJKWdqcbk8Pn8QRC4W9ZyCTsCYWyN1CLlSbPyhRFZfxEqqTCBif4qfTithExVav1mp1dD1Bp4RZL0fLFErpiJC1JdYQLncXl8AWCmTbp0Qfmyje5D3WbMS3ijpvHf0ngLqEFGlaDpOhTNMFSGJVs06JQWnGBRZHGFopiPK0T1rUB7WSDYth2PYDiOJkOwuHg3F8VxWXuRww0cb8x3FP942nIDmjaLpwPnKDF3GWD4MQmRkKmVwZmrG0iDJVYcJ4TZtl2Rx9kOY4H3PTkyOOC5blpNJOSFEc91-OMpRYhoWiUFQlDkHQ+BEAAZFpkyrOYMNtLDyUdZ0wldDx3SMT123c9lOW5INrkcF5vECAoRyIdAIDgIkf0Yoyp0A7hjxrVz7EQXBiJy9ldkKorir8ei8WSyVUplJNhHESQRFkDLxMk5xvASB1vB2UIbheLyVPfTwvPuJJci5DI9I+BjY0qgDquA9jul6LjMzGcYmtPNyEEiykwzZW4aTcRx+tcJ1aSOPwRrZXwvTKmNfhS2aZzlZboL0dbMOy1Z-GcF8-RGk6IhUv13A687+RyMIov0pLpv-BMgM4yCVuzd6spWFwgYjMj4luRIjG2PsJtHcrYeYtLeDY0DEahbiswmPiEKQlpUYks99m8HgAj8Rl8a8F4jp9Fw-BkzYPFccL8ayImDIquGTN4MyLJZyTKP2MiudDMIFI647LmCxJ4i5fYtdu-cmOM8meG0Gz7OTZWzxOrx1fC8MvF5bmPH6hSXwCR4FI8R4vNNwyZvhhpxgAVQEAR4LW9DMtZzbKNuX68bCAGAvPP0rmODJIvuUIHmivIgA */
    context: ({ input }) => ({
      clientId: input.clientId,
      amtProfile: input.amtProfile,
      httpHandler: input.httpHandler,
      message: input.message,
      proxyConfigName: input.proxyConfigName,
      proxyConfigsCount: input.proxyConfigsCount,
      retryCount: input.retryCount,
      ips: input.ips
    }),
    id: 'proxy-configuration-machine',
    initial: 'ACTIVATION',
    states: {
      ACTIVATION: {
        on: {
          PROXYCONFIG: {
            actions: [
              assign({ proxyConfigsCount: () => 0 }),
              'Reset Retry Count'
            ],
            target: 'CHECK_FOR_PROXY_CONFIGS'
          }
        }
      },
      CHECK_FOR_PROXY_CONFIGS: {
        always: [
          {
            guard: 'isProxyConfigsExist',
            target: 'GET_PROXY_CONFIG'
          },
          {
            target: 'SUCCESS'
          }
        ]
      },
      GET_PROXY_CONFIG: {
        invoke: {
          src: 'getProxyConfig',
          input: ({ context }) => context,
          id: 'get-proxy-config',
          onDone: {
            target: 'ADD_PROXY_CONFIGS'
          },
          onError: {
            actions: assign({ errorMessage: 'Failed to get proxy config from DB' }),
            target: 'FAILED'
          }
        }
      },
      ADD_PROXY_CONFIGS: {
        invoke: {
          src: 'addProxyConfigs',
          input: ({ context }) => context,
          id: 'add-proxy-configs',
          onDone: {
            actions: 'Check Return Value',
            target: 'CHECK_ADD_PROXY_CONFIGS_RESPONSE'
          },
          onError: {
            actions: assign({
              proxyConfigsFailed: ({ context }) =>
                context.proxyConfigsFailed == null
                  ? `${context.proxyConfigName}`
                  : `${context.proxyConfigsFailed}, ${context.proxyConfigName}`
            }),
            target: 'CHECK_ADD_PROXY_CONFIGS_RESPONSE'
          }
        }
      },
      CHECK_ADD_PROXY_CONFIGS_RESPONSE: {
        always: [
          {
            guard: 'isMoreProxyConfigs',
            target: 'GET_PROXY_CONFIG'
          },
          {
            target: 'SUCCESS'
          }
        ]
      },
      FAILED: {
        entry: ['Update Configuration Status'],
        type: 'final'
      },
      SUCCESS: {
        entry: [
          assign({ statusMessage: () => 'Proxy Configured' }),
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
