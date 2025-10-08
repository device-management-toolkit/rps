/*********************************************************************
 * Copyright (c) Intel Corporation 2025
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

// import { type AMT, type CIM, type IPS } from '@device-management-toolkit/wsman-messages'
import { type IPS } from '@device-management-toolkit/wsman-messages'
import { assign, fromPromise, setup } from 'xstate'
import { type ProxyConfig } from '../models/RCS.Config.js'
import Logger from '../Logger.js'
import { type AMTConfiguration } from '../models/index.js'
import { devices } from '../devices.js'
import { Error } from './error.js'
import { Configurator } from '../Configurator.js'
import { DbCreatorFactory } from '../factories/DbCreatorFactory.js'
import { type CommonContext, invokeWsmanCall } from './common.js'
import { UNEXPECTED_PARSE_ERROR } from '../utils/constants.js'

export interface ProxyConfigContext extends CommonContext {
  amtProfile: AMTConfiguration | null
  proxyConfig?: ProxyConfig
  proxyConfigsCount: number
  retryCount: number
  proxyConfigName?: string | null
  proxyConfigAdded?: string
  proxyConfigFailed?: string
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
      input.proxyConfig = await this.db.proxyConfigs.getByName(
        input.amtProfile.proxyConfigs[input.proxyConfigsCount].name,
        input.amtProfile.tenantId
      )
      return
    }
    this.logger.error('Null object in getProxyConfig()')
  }

  addProxyConfigs = async ({ input }: { input: ProxyConfigContext }): Promise<any> => {
    // Add proxy config information to HTTP Proxy Service object
    const proxyAccessPointParameters: IPS.Models.AddProxyAccessPointParameters = {
      AccessInfo: input.proxyConfig?.address ?? '',
      InfoFormat: input.proxyConfig?.infoFormat ?? 3,
      Port: input.proxyConfig?.port ?? 0,
      NetworkDnsSuffix: input.proxyConfig?.networkDnsSuffix ?? ''
    }

    input.xmlMessage = input.ips?.HTTPProxyService.AddProxyAccessPoint(proxyAccessPointParameters)

    input.proxyConfigName = input.proxyConfig?.address ?? null
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
        const {
          clientId,
          proxyConfigAdded: proxyConfigsAdded,
          proxyConfigFailed: proxyConfigsFailed,
          statusMessage,
          errorMessage
        } = context
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
        proxyConfigAdded: ({ context, event }) => {
          if (event.output.Envelope?.Body?.AddProxyAccessPoint_OUTPUT?.ReturnValue === 0) {
            if (context.proxyConfigAdded == null) {
              return `${context.proxyConfigName}`
            } else {
              return `${context.proxyConfigAdded}, ${context.proxyConfigName}`
            }
          } else {
            return context.proxyConfigAdded
          }
        },
        proxyConfigFailed: ({ context, event }) => {
          if (event.output.Envelope?.Body?.AddProxyAccessPoint_OUTPUT?.ReturnValue !== 0) {
            if (context.proxyConfigFailed == null) {
              return `${context.proxyConfigName}`
            } else {
              return `${context.proxyConfigFailed}, ${context.proxyConfigName}`
            }
          } else {
            return context.proxyConfigFailed
          }
        }
      })
    }
  }).createMachine({
    /** @xstate-layout N4IgpgJg5mDOIC5QAcBOB7AHgTwLQGN0A7AMwEsoBXVAQwBczjcBbG-ACzKLADoBBAMIAVAJIA1PqIDyAOQDEABQBKUgBoBNAbIBiIgOIBtAAwBdRCnSwyDYuZCZEAFgBMARh4BOIwDZnAZkcADi9nUIBWMIAaEGxEQPcwoyNXIwB2ZyNQj0cw1IBfPOi0LDxCUgpqekYiFjZObh4BAAkAUQEAaQB9bSklTuU1dU6tGV09AGU5YzMkEGRLa2q7BwQU13dA50CjD2zvR1S-V29o2NXXDx5Uoz9-Vz9vLw8-MOcCoowcAmJyKlobGqsDhcXjNNpdHp9AYaYY6fSTAyuGYWKwA5aIIynDHvOafUo-Cr-aq1YENPQtIT9FQwkZjOQQYi8LgAN3QAGteDA6Lhil8yr9pnZ5qilrMVmtAld4hcPIlUtlUicYohnKkwjxvGFvA9HF5goEDWEcbz8eU-lUmED6rxyZToUNafo5GBUBhUDxkAAbegkdCoZg8Lk8vHfM2C2bCxa2MWIVy5VI8HJHC7+baOIxRZUIZyvTzODzbHP7VyBVLHY0h-mEi2Auog-gAEQbVMGsNG8PpjJ4LPZvBoEAgwZKod+sHDKKjRHRCBc7i8vgCwUy4UzZyCCcCYWyN1CLlSavyhVxw6r5oBJOtjeb9rbY0mLrdHu9dF9-p4-cHJpHFDHpiFCzRGMZzcTwfH8IIQhXLEED8bJQO1B51jVRJvArE8CTPYkrXrMEOk6PgmxbGk4QmTolBacYFFkcYWimP8IwA0VQHFZINi2HY9gOI4lTXC4eDcXxXFVe5HBLRw0L5DDKnPbCGlwroCOvakHRI8YyIoqiZBoqYkX-EVo2Y2NWJ4TZtl2Rx9kOY5oIs9UBIuW5ZTSTUjRxIh0AgOAhUrKSiUtOtuD0ydp1wIJoNwUseGObxvFSQJROOWC-Ak01fmkrCAt4QRRAkaQZCCwDDOzbwEjjbwdlCG4XjCPxoKQzwavuJJci1DJXI+dCzXS-zSVBVo8MhIiVPbCYCqY+xEG8A0otLGq3F2NxHDq1wE1lI4-GatVfAzFLv0wnrL1tIbb30MaDIm1Z-GceCc2alaImgnN3DK9b9RyMJAl209utrXqr2Ox1RoY-SpyAlxHrLfj4luRIjG2Hd2uPSSur837L3k-DCJvQG1PIyjqJaM7QaK-ZvB4AI-EVOGvBeJasxcPwTM2DxXEcDbNnzRGv2+1GL3rbQ+BEAAZFoGyJ6cVq8fiKdLLxdUpjw6os+CAkeCyPEeGqvt8ms+YacYAFUBAECjxnFoChNuG7YbCe7VycHMrmODIpvuUIHgKAogA */
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
              proxyConfigFailed: ({ context }) =>
                context.proxyConfigFailed == null
                  ? `${context.proxyConfigName}`
                  : `${context.proxyConfigFailed}, ${context.proxyConfigName}`
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
