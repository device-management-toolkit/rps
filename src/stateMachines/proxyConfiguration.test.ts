/*********************************************************************
 * Copyright (c) Intel Corporation 2025
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { vi } from 'vitest'
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
import * as common from './common.js'

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
    it('should reach FAILED state if getProxyConfig throws', () =>
      new Promise<void>((resolve, reject) => {
        config.actors!.getProxyConfig = fromPromise(async ({ input }) => await Promise.reject(new Error()))
        const machine = proxyConfiguration.machine.provide(config)
        const flowStates = [
          'ACTIVATION',
          'GET_PROXY_CONFIG',
          'FAILED'
        ]
        const service = createActor(machine, { input: context })

        service.subscribe({
          next: (state) => {
            try {
              const expectedState: any = flowStates[currentStateIndex++]
              expect(state.matches(expectedState)).toBe(true)
              if (state.matches('FAILED') && currentStateIndex === flowStates.length) {
                const status = devices[clientId].status.Network
                expect(status).toContain('Failed to get proxy config from DB')
                expect(devices[clientId].status.Components?.CIRAProxy?.Result).toEqual('Failure')
                expect(devices[clientId].status.Components?.CIRAProxy).toMatchObject({
                  Code: 'RPS_DB_PROXY_CONFIG_NOT_FOUND',
                  Step: 'GET_PROXY_CONFIG'
                })
                expect(state.context.failure).toMatchObject({
                  Code: 'RPS_DB_PROXY_CONFIG_NOT_FOUND',
                  Component: 'CIRAProxy',
                  Step: 'GET_PROXY_CONFIG',
                  Reason: 'Proxy configuration could not be read from the database'
                })
                service.stop()
                resolve()
              }
            } catch (err) {
              reject(err)
            }
          },
          error: (err) => {
            reject(err)
          }
        })
        service.start()
        service.send({ type: 'PROXYCONFIG', clientId })
      }))

    it('should add a Proxy config to AMT.', () =>
      new Promise<void>((resolve, reject) => {
        const progressSpy = vi.spyOn(common, 'sendProgressToDevice').mockImplementation(() => {})
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
        service.subscribe({
          next: (state) => {
            try {
              const expectedState: any = flowStates[currentStateIndex++]
              expect(state.matches(expectedState)).toBe(true)
              if (state.matches('SUCCESS') && currentStateIndex === flowStates.length) {
                const status = devices[clientId].status.Network
                expect(status).toEqual('Initial. Proxy Configured')
                // Phase start + completion progress lines (issue #2665)
                expect(progressSpy).toHaveBeenCalledWith(clientId, 'Configuring proxies')
                expect(progressSpy).toHaveBeenCalledWith(clientId, 'Proxies configuration completed')
                expect(devices[clientId].status.Components?.CIRAProxy).toEqual({
                  Result: 'Success',
                  Details: 'Proxy Configured'
                })
                progressSpy.mockRestore()
                service.stop()
                resolve()
              }
            } catch (err) {
              reject(err)
            }
          },
          error: (err) => {
            reject(err)
          }
        })
        service.start()
        service.send({ type: 'PROXYCONFIG', clientId })
      }))

    it('emits a per-proxy "Failed to add" progress line with the AMT ReturnValue', () =>
      new Promise<void>((resolve, reject) => {
        const progressSpy = vi.spyOn(common, 'sendProgressToDevice').mockImplementation(() => {})
        context.proxyConfig = {
          proxyName: 'proxy1',
          address: 'www.vprodemo.com',
          infoFormat: 201,
          port: 900,
          networkDnsSuffix: 'intel.com'
        }
        // AMT accepts the call but rejects the proxy (non-zero ReturnValue)
        config.actors!.addProxyConfigs = fromPromise(
          async () => await Promise.resolve({ Envelope: { Body: { AddProxyAccessPoint_OUTPUT: { ReturnValue: 1 } } } })
        )
        context.proxyConfigName = 'proxy1'
        context.proxyConfigsCount = 1
        config.guards = { isMoreProxyConfigs: () => false, isProxyConfigsExist: () => true }

        const machine = proxyConfiguration.machine.provide(config)
        const flowStates = [
          'ACTIVATION',
          'GET_PROXY_CONFIG',
          'ADD_PROXY_CONFIGS',
          'SUCCESS'
        ]
        const service = createActor(machine, { input: context })
        service.subscribe({
          next: (state) => {
            try {
              const expectedState: any = flowStates[currentStateIndex++]
              expect(state.matches(expectedState)).toBe(true)
              if (state.matches('SUCCESS') && currentStateIndex === flowStates.length) {
                expect(progressSpy).toHaveBeenCalledWith(
                  clientId,
                  'Failed to add proxy configuration proxy1 (PT_STATUS_INTERNAL_ERROR, ReturnValue 1)'
                )
                progressSpy.mockRestore()
                service.stop()
                resolve()
              }
            } catch (err) {
              reject(err)
            }
          },
          error: (err) => {
            reject(err)
          }
        })
        service.start()
        service.send({ type: 'PROXYCONFIG', clientId })
      }))

    it('maps a non-zero AddProxyAccessPoint ReturnValue to a structured AMT failure', () =>
      new Promise<void>((resolve, reject) => {
        const progressSpy = vi.spyOn(common, 'sendProgressToDevice').mockImplementation(() => {})
        context.proxyConfig = {
          proxyName: 'proxy1',
          address: 'www.vprodemo.com',
          infoFormat: 201,
          port: 900,
          networkDnsSuffix: 'intel.com'
        }
        config.actors!.addProxyConfigs = fromPromise(
          async () =>
            await Promise.resolve({ Envelope: { Body: { AddProxyAccessPoint_OUTPUT: { ReturnValue: 2066 } } } })
        )
        context.proxyConfigName = 'proxy1'
        context.proxyConfigsCount = 1
        config.guards = { isMoreProxyConfigs: () => false, isProxyConfigsExist: () => true }

        const service = createActor(proxyConfiguration.machine.provide(config), { input: context })
        service.subscribe({
          next: (state) => {
            try {
              if (state.matches('SUCCESS')) {
                expect(state.context.failure).toEqual({
                  Code: 'AMT_PT_UNSUPPORTED',
                  Component: 'CIRAProxy',
                  Step: 'ADD_PROXY_CONFIGS',
                  Reason: 'Operation or value is not supported by this AMT firmware',
                  AmtReturnValue: 2066
                })
                expect(devices[clientId].status.Components?.CIRAProxy).toEqual({
                  Result: 'Failure',
                  Details: 'Failed to add proxy1',
                  Code: 'AMT_PT_UNSUPPORTED',
                  Step: 'ADD_PROXY_CONFIGS',
                  AmtReturnValue: 2066
                })
                expect(progressSpy).toHaveBeenCalledWith(
                  clientId,
                  'Failed to add proxy configuration proxy1 (PT_STATUS_UNSUPPORTED, ReturnValue 2066)'
                )
                progressSpy.mockRestore()
                service.stop()
                resolve()
              }
            } catch (err) {
              reject(err)
            }
          },
          error: (err) => {
            reject(err)
          }
        })
        service.start()
        service.send({ type: 'PROXYCONFIG', clientId })
      }))

    it('should fail and report the detail message with added and failed configs.', () =>
      new Promise<void>((resolve, reject) => {
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
        service.subscribe({
          next: (state) => {
            try {
              const expectedState: any = flowStates[currentStateIndex++]
              expect(state.matches(expectedState)).toBe(true)
              if (state.matches('SUCCESS') && currentStateIndex === flowStates.length) {
                const status = devices[clientId].status.Network
                expect(status).toEqual('Initial. Failed to add proxy1')
                // Partial failure (some configs failed) is reported as a CIRAProxy Failure.
                // AddProxyAccessPoint threw: the structured failure names the step and the error class.
                expect(devices[clientId].status.Components?.CIRAProxy).toEqual({
                  Result: 'Failure',
                  Details: 'Failed to add proxy1',
                  Code: 'RPS_UNEXPECTED_ERROR',
                  Step: 'ADD_PROXY_CONFIGS'
                })
                resolve()
              }
            } catch (err) {
              reject(err)
            }
          },
          error: (err) => {
            reject(err)
          }
        })
        service.start()
        service.send({ type: 'PROXYCONFIG', clientId })
      }))

    it('should fail and report the detail message with added and return value 1.', () =>
      new Promise<void>((resolve, reject) => {
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
        service.subscribe({
          next: (state) => {
            try {
              const expectedState: any = flowStates[currentStateIndex++]
              expect(state.matches(expectedState)).toBe(true)
              if (state.matches('SUCCESS') && currentStateIndex === flowStates.length) {
                const status = devices[clientId].status.Network
                expect(status).toEqual('Initial. Failed to add proxy1')
                // Partial failure (some configs failed) is reported as a CIRAProxy Failure.
                // AMT rejected the proxy: the structured failure carries the mapped PT_STATUS code.
                expect(devices[clientId].status.Components?.CIRAProxy).toEqual({
                  Result: 'Failure',
                  Details: 'Failed to add proxy1',
                  Code: 'AMT_PT_INTERNAL_ERROR',
                  Step: 'ADD_PROXY_CONFIGS',
                  AmtReturnValue: 1
                })
                resolve()
              }
            } catch (err) {
              reject(err)
            }
          },
          error: (err) => {
            reject(err)
          }
        })
        service.start()
        service.send({ type: 'PROXYCONFIG', clientId })
      }))

    it('should fail and report the detail message with added', () =>
      new Promise<void>((resolve, reject) => {
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
        service.subscribe({
          next: (state) => {
            try {
              const expectedState: any = flowStates[currentStateIndex++]
              expect(state.matches(expectedState)).toBe(true)
              if (state.matches('SUCCESS') && currentStateIndex === flowStates.length) {
                const status = devices[clientId].status.Network
                expect(status).toEqual('Initial. Proxy Configured')
                resolve()
              }
            } catch (err) {
              reject(err)
            }
          },
          error: (err) => {
            reject(err)
          }
        })
        service.start()
        service.send({ type: 'PROXYCONFIG', clientId })
      }))
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
          getByName: vi.fn()
        }
      }

      proxyConfiguration.dbFactory = {
        getDb: async () => mockDb
      } as any
      const getByNameSpy = vi.spyOn(mockDb.proxyConfigs, 'getByName').mockReturnValue(expectedConfig)

      await proxyConfiguration.getProxyConfig({ input: context })
      expect(context.proxyConfig).toBe(expectedConfig)
      expect(getByNameSpy).toHaveBeenCalled()
    })
  })
})
