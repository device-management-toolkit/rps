/*********************************************************************
 * Copyright (c) Intel Corporation 2025
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { randomUUID } from 'node:crypto'
import { devices } from '../devices.js'
import { Environment } from '../utils/Environment.js'
import { config } from '../test/helper/Config.js'
import { ClientAction } from '../models/RCS.Config.js'
import {
  type ProxyConfigContext,
  type ProxyConfigEvent,
  type ProxyConfiguration as ProxyConfigurationType
} from './proxyConfiguration.js'
import { type MachineImplementationsSimplified, createActor, fromPromise } from 'xstate'
import { HttpHandler } from '../HttpHandler.js'
import { IPS } from '@device-management-toolkit/wsman-messages'
import { jest } from '@jest/globals'

const { ProxyConfiguration } = await import('./proxyConfiguration.js')
const clientId = randomUUID()
Environment.Config = config

describe('Proxy Configuration State Machine', () => {
  let config: MachineImplementationsSimplified<ProxyConfigContext, ProxyConfigEvent>
  let proxyConfiguration: ProxyConfigurationType
  let context
  let currentStateIndex: number

  beforeEach(() => {
    proxyConfiguration = new ProxyConfiguration()
    context = {
      amtProfile: {
        profileName: 'acm',
        generateRandomPassword: false,
        activation: ClientAction.ADMINCTLMODE,
        ciraConfigName: 'config1',
        generateRandomMEBxPassword: false,
        tags: ['acm'],
        dhcpEnabled: true,
        ipSyncEnabled: true,
        localWifiSyncEnabled: true,
        tenantId: 'tenant1',
        proxyConfigs: [
          {
            priority: 1,
            name: 'proxy1'
          }
        ]
      },
      proxyConfigsCount: 0,
      retryCount: 0,
      clientId,
      httpHandler: new HttpHandler(),
      ips: new IPS.Messages()
    }
    devices[clientId] = {
      status: { Network: 'Initial' }
    } as any

    currentStateIndex = 0
    config = {
      actors: {
        getProxyConfig: fromPromise(async ({ input }) => await Promise.resolve({ clientId })),
        addProxyConfigs: fromPromise(async () => ({
          Envelope: { Body: { AddProxyAccessPoint_OUTPUT: { ReturnValue: 0 } } }
        })),
        errorMachine: fromPromise(async ({ input }) => ({ clientId: input.clientId }))
      },
      guards: {
        isMoreProxyConfigs: () => false,
        isProxyConfigsExist: () => true,
        shouldRetry: () => false
      },
      actions: {},
      delays: {}
    }
  })

  describe('State machines', () => {
    it('should reach FAILED state if getProxyConfig throws', (done) => {
      config.actors!.getProxyConfig = fromPromise(async ({ input }) => await Promise.reject(new Error()))
      const machine = proxyConfiguration.machine.provide(config)
      const flowStates = [
        'ACTIVATION',
        'GET_PROXY_CONFIG',
        'FAILED'
      ]
      const service = createActor(machine, { input: context })

      service.subscribe((state) => {
        const expectedState: any = flowStates[currentStateIndex++]
        expect(state.matches(expectedState)).toBe(true)
        if (state.matches('FAILED') && currentStateIndex === flowStates.length) {
          const status = devices[clientId].status.Network
          expect(status).toContain('Failed to get proxy config from DB')
          service.stop()
          done()
        }
      })
      service.start()
      service.send({ type: 'PROXYCONFIG', clientId })
    })

    it('should add a Proxy config to AMT.', (done) => {
      context.proxyConfig = {
        proxyName: 'proxy1',
        address: 'www.vprodemo.com',
        infoFormat: 201,
        port: 900,
        networkDnsSuffix: 'intel.com'
      }
      context.proxyConfigName = 'proxy1'
      context.proxyConfigsCount = 1
      config.guards = {
        isMoreProxyConfigs: () => false,
        isProxyConfigsExist: () => true
      }

      const machine = proxyConfiguration.machine.provide(config)
      const flowStates = [
        'ACTIVATION',
        'GET_PROXY_CONFIG',
        'ADD_PROXY_CONFIGS',
        'SUCCESS'
      ]
      const service = createActor(machine, { input: context })
      service.subscribe((state) => {
        const expectedState: any = flowStates[currentStateIndex++]
        expect(state.matches(expectedState)).toBe(true)
        if (state.matches('SUCCESS') && currentStateIndex === flowStates.length) {
          const status = devices[clientId].status.Network
          expect(status).toEqual('Initial. Proxy Configured')
          service.stop()
          done()
        }
      })
      service.start()
      service.send({ type: 'PROXYCONFIG', clientId })
    })

    it('should fail and report the detail message with added and failed configs.', (done) => {
      context.proxyConfig = {
        proxyName: 'proxy1',
        address: 'www.vprodemo.com',
        infoFormat: 201,
        port: 900,
        networkDnsSuffix: 'intel.com'
      }
      config.actors!.addProxyConfigs = fromPromise(async ({ input }) => await Promise.reject(new Error()))
      context.proxyConfigName = 'proxy1'
      context.proxyConfigsCount = 1
      config.guards = {
        isMoreProxyConfigs: () => false,
        isProxyConfigsExist: () => true
      }

      const mockNetworkConfigurationMachine = proxyConfiguration.machine.provide(config)
      const flowStates = [
        'ACTIVATION',
        'GET_PROXY_CONFIG',
        'ADD_PROXY_CONFIGS',
        'SUCCESS'
      ]
      const service = createActor(mockNetworkConfigurationMachine, { input: context })
      service.subscribe((state) => {
        const expectedState: any = flowStates[currentStateIndex++]
        expect(state.matches(expectedState)).toBe(true)
        if (state.matches('SUCCESS') && currentStateIndex === flowStates.length) {
          const status = devices[clientId].status.Network
          expect(status).toEqual('Initial. Failed to add proxy1')
          done()
        }
      })
      service.start()
      service.send({ type: 'PROXYCONFIG', clientId })
    })

    it('should fail and report the detail message with added and return value 1.', (done) => {
      config.actors!.addProxyConfigs = fromPromise(
        async ({ input }) =>
          await Promise.resolve({ Envelope: { Body: { AddProxyAccessPoint_OUTPUT: { ReturnValue: 1 } } } })
      )
      context.proxyConfigName = 'proxy1'
      context.proxyConfigsCount = 1
      config.guards = {
        isMoreProxyConfigs: () => false,
        isProxyConfigsExist: () => true
      }

      const mockNetworkConfigurationMachine = proxyConfiguration.machine.provide(config)
      const flowStates = [
        'ACTIVATION',
        'GET_PROXY_CONFIG',
        'ADD_PROXY_CONFIGS',
        'SUCCESS'
      ]
      const service = createActor(mockNetworkConfigurationMachine, { input: context })
      service.subscribe((state) => {
        const expectedState: any = flowStates[currentStateIndex++]
        expect(state.matches(expectedState)).toBe(true)
        if (state.matches('SUCCESS') && currentStateIndex === flowStates.length) {
          const status = devices[clientId].status.Network
          expect(status).toEqual('Initial. Failed to add proxy1')
          done()
        }
      })
      service.start()
      service.send({ type: 'PROXYCONFIG', clientId })
    })

    it('should fail and report the detail message with added', (done) => {
      config.actors!.addProxyConfigs = fromPromise(
        async ({ input }) =>
          await Promise.resolve({ Envelope: { Body: { AddProxyAccessPoint_OUTPUT: { ReturnValue: 0 } } } })
      )
      context.proxyConfigsAdded = 'proxy1'
      context.proxyConfigName = 'proxy2'
      context.proxyConfigsCount = 1
      config.guards = {
        isMoreProxyConfigs: () => false,
        isProxyConfigsExist: () => true
      }

      const mockNetworkConfigurationMachine = proxyConfiguration.machine.provide(config)
      const flowStates = [
        'ACTIVATION',
        'GET_PROXY_CONFIG',
        'ADD_PROXY_CONFIGS',
        'SUCCESS'
      ]
      const service = createActor(mockNetworkConfigurationMachine, { input: context })
      service.subscribe((state) => {
        const expectedState: any = flowStates[currentStateIndex++]
        expect(state.matches(expectedState)).toBe(true)
        if (state.matches('SUCCESS') && currentStateIndex === flowStates.length) {
          const status = devices[clientId].status.Network
          expect(status).toEqual('Initial. Proxy Configured')
          done()
        }
      })
      service.start()
      service.send({ type: 'PROXYCONFIG', clientId })
    })
  })

  describe('Get configs', () => {
    test('should get Proxy Config', async () => {
      const expectedConfig = {
        proxyName: 'proxy1',
        address: 'www.vprodemo.com',
        infoFormat: 201,
        port: 900,
        networkDnsSuffix: 'intel.com'
      }
      const mockDb = {
        proxyConfigs: {
          getByName: jest.fn()
        }
      }

      proxyConfiguration.dbFactory = {
        getDb: async () => mockDb
      } as any
      const getByNameSpy = jest.spyOn(mockDb.proxyConfigs, 'getByName').mockReturnValue(expectedConfig)

      await proxyConfiguration.getProxyConfig({ input: context })
      expect(context.proxyConfig).toBe(expectedConfig)
      expect(getByNameSpy).toHaveBeenCalled()
    })
  })
})
