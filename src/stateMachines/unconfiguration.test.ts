/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { vi, beforeEach } from 'vitest'
import { generateKeyPairSync, randomUUID } from 'node:crypto'
import { CertManager } from '../certManager.js'
import Logger from '../Logger.js'
import { NodeForge } from '../NodeForge.js'
import { devices } from '../devices.js'
import { Environment } from '../utils/Environment.js'
import {
  type Unconfiguration as UnconfigurationType,
  type UnconfigContext as UnconfigContextType,
  type UnconfigEvent
} from './unconfiguration.js'
import { config } from '../test/helper/Config.js'
import { HttpHandler } from '../HttpHandler.js'
import { type MachineImplementationsSimplified, createActor, fromPromise, waitFor } from 'xstate'
import { runMachineSegment } from '../test/helper/xstate.js'
import { AMT, CIM, IPS } from '@device-management-toolkit/wsman-messages'

import { HttpResponseError, coalesceMessage, isDigestRealmValid } from './common.js'

// Keep every Unconfiguration from starting asynchronous database initialization that can outlive the
// test environment.
vi.mock('../Configurator.js', () => ({
  Configurator: function () {
    return { ready: Promise.resolve() }
  }
}))

const invokeWsmanCallSpy = vi.hoisted(() => vi.fn<any>().mockResolvedValue({}))
const invokeEnterpriseAssistantCallSpy = vi.hoisted(() => vi.fn())
vi.mock('./common.js', async () => {
  const actual = await vi.importActual<typeof import('./common.js')>('./common.js')
  const { HttpResponseError, coalesceMessage, isDigestRealmValid } = actual
  return {
    invokeWsmanCall: invokeWsmanCallSpy,
    invokeEnterpriseAssistantCall: invokeEnterpriseAssistantCallSpy,
    processTLSTunnelResponse: vi.fn(),
    HttpResponseError,
    isDigestRealmValid,
    coalesceMessage
  }
})
const { Unconfiguration } = await import('./unconfiguration.js')

const clientId = randomUUID()
Environment.Config = config

describe('Unconfiguration State Machine', () => {
  let unconfiguration: UnconfigurationType
  let currentStateIndex: number
  let unconfigContext: UnconfigContextType
  let configuration: MachineImplementationsSimplified<UnconfigContextType, UnconfigEvent>
  let loggerSpy

  beforeEach(() => {
    vi.clearAllMocks()
    unconfiguration = new Unconfiguration()
    unconfigContext = {
      clientId,
      httpHandler: new HttpHandler(),
      status: 'success',
      errorMessage: '',
      xmlMessage: '',
      statusMessage: '',
      message: { Envelope: { Body: { PullResponse: { Items: { AMT_ManagementPresenceRemoteSAP: 'abc' } } } } },
      ciraConfig: null,
      profile: null,
      privateCerts: [],
      tlsSettingData: [{ TrustedCN: 'xxx' }, { TrustedCN: 'zzz' }],
      publicKeyCertificates: [],
      amt: new AMT.Messages(),
      ips: new IPS.Messages(),
      cim: new CIM.Messages(),
      wiredSettings: null,
      wifiSettings: null
    } as any
    devices[clientId] = {
      unauthCount: 0,
      ClientId: clientId,
      ClientSocket: { send: vi.fn() } as any,
      ciraconfig: {
        TLSSettingData: { Enabled: true, AcceptNonSecureConnections: true, MutualAuthentication: true, TrustedCN: null }
      },
      network: {},
      status: {},
      activationStatus: false,
      connectionParams: {
        guid: '4c4c4544-004b-4210-8033-b6c04f504633',
        port: 16992,
        digestChallenge: {},
        username: 'admin',
        password: 'P@ssw0rd'
      },
      uuid: '4c4c4544-004b-4210-8033-b6c04f504633',
      messageId: 1
    } as any
    currentStateIndex = 0
    configuration = {
      actors: {
        errorMachine: fromPromise(async ({ input }) => await Promise.resolve({ clientId })),
        enumerateEthernetPortSettings: fromPromise(
          async ({ input }) =>
            await Promise.resolve({
              Envelope: {
                Body: { EnumerateResponse: { EnumerationContext: '09000000-0000-0000-0000-000000000000' } }
              }
            })
        ),
        pullEthernetPortSettings: fromPromise(
          async ({ input }) =>
            await Promise.resolve({
              Envelope: {
                Body: {
                  PullResponse: {
                    Items: {
                      AMT_EthernetPortSettings: [
                        {
                          DHCPEnabled: true,
                          ElementName: 'Intel(r) AMT Ethernet Port Settings',
                          InstanceID: 'Intel(r) AMT Ethernet Port Settings 0',
                          IpSyncEnabled: false,
                          MACAddress: '00-00-00-02-00-05'
                        },
                        {
                          ElementName: 'Intel(r) AMT Ethernet Port Settings',
                          InstanceID: 'Intel(r) AMT Ethernet Port Settings 1',
                          MACAddress: '00-00-00-02-00-05'
                        }
                      ]
                    }
                  }
                }
              }
            })
        ),
        get8021xProfile: fromPromise(async ({ input }) => await Promise.resolve({ clientId })),
        disableWired8021xConfiguration: fromPromise(async ({ input }) => await Promise.resolve({ clientId })),
        enumerateWifiEndpointSettings: fromPromise(
          async ({ input }) => await Promise.resolve({ clientId: input.clientId })
        ),
        pullWifiEndpointSettings: fromPromise(
          async ({ input }) =>
            await Promise.resolve({
              Envelope: { Body: { PullResponse: { Items: { CIM_WiFiEndpointSettings: null } } } }
            })
        ),
        deleteWifiProfileOnAMTDevice: fromPromise(async ({ input }) => await Promise.resolve({ clientId })),
        enumerateHTTPProxyAccessPoint: fromPromise(
          async ({ input }) => await Promise.resolve({ clientId: input.clientId })
        ),
        pullHTTPProxyAccessPoint: fromPromise(
          async ({ input }) =>
            await Promise.resolve({
              Envelope: { Body: { PullResponse: { Items: { IPS_HTTPProxyAccessPoint: null } } } }
            })
        ),
        deleteHTTPProxyAccessPoint: fromPromise(async ({ input }) => await Promise.resolve({ clientId })),
        removeRemoteAccessPolicyRuleUserInitiated: fromPromise(
          async ({ input }) => await Promise.resolve({ clientId })
        ),
        removeRemoteAccessPolicyRuleRuleAlert: fromPromise(async ({ input }) => await Promise.resolve({ clientId })),
        removeRemoteAccessPolicyRulePeriodic: fromPromise(async ({ input }) => await Promise.resolve({ clientId })),
        enumerateManagementPresenceRemoteSAP: fromPromise(async ({ input }) => await Promise.resolve({ clientId })),
        pullManagementPresenceRemoteSAP: fromPromise(async ({ input }) => await Promise.resolve({ clientId })),
        deleteRemoteAccessService: fromPromise(async ({ input }) => await Promise.resolve({ clientId })),
        enumerateTLSSettingData: fromPromise(async ({ input }) => await Promise.resolve({ clientId })),
        pullTLSSettingData: fromPromise(async ({ input }) => await Promise.resolve({ clientId })),
        disableRemoteTLSSettingData: fromPromise(async ({ input }) => await Promise.resolve({ clientId })),
        disableLocalTLSSettingData: fromPromise(async ({ input }) => await Promise.resolve({ clientId })),
        commitSetupAndConfigurationService: fromPromise(async ({ input }) => await Promise.resolve({ clientId })),
        enumerateTLSCredentialContext: fromPromise(async ({ input }) => await Promise.resolve({ clientId })),
        pullTLSCredentialContext: fromPromise(async ({ input }) => await Promise.resolve({ clientId })),
        deleteTLSCredentialContext: fromPromise(async ({ input }) => await Promise.resolve({ clientId })),
        enumeratePublicPrivateKeyPair: fromPromise(async ({ input }) => await Promise.resolve({ clientId })),
        pullPublicPrivateKeyPair: fromPromise(async ({ input }) => await Promise.resolve({ clientId })),
        deletePublicPrivateKeyPair: fromPromise(async ({ input }) => await Promise.resolve({ clientId })),
        enumeratePublicKeyCertificate: fromPromise(async ({ input }) => await Promise.resolve({ clientId })),
        pullPublicKeyCertificate: fromPromise(
          async ({ input }) =>
            await Promise.resolve({
              Envelope: { Body: { PullResponse: { Items: { AMT_PublicKeyCertificate: [{}] } } } }
            })
        ),
        deletePublicKeyCertificate: fromPromise(async ({ input }) => await Promise.resolve({ clientId })),
        getEnvironmentDetectionSettings: fromPromise(async ({ input }) => await Promise.resolve({ clientId })),
        clearEnvironmentDetectionSettings: fromPromise(async ({ input }) => await Promise.resolve({ clientId }))
      },
      actions: {
        'Reset Unauth Count': () => {}
      },
      guards: {
        isExpectedBadRequest: () => false,
        hasPrivateCerts: () => false,
        isLMSTLSSettings: () => false,
        is8023TLS: () => false,
        tlsSettingDataEnabled: () => false,
        hasMPSEntries: () => false,
        hasPublicKeyCertificate: () => false,
        hasEnvSettings: () => false,
        hasTLSCredentialContext: () => false,
        hasHTTPProxyAccessPoints: () => false,
        hasMoreHTTPProxyData: () => false,
        is8021xProfileEnabled: () => false
      },
      delays: {}
    }
    loggerSpy = vi.spyOn(unconfiguration.logger, 'error')
  })

  it('should eventually reach FAILURE after ENUMERATE_WIFI_ENDPOINT_SETTINGS', () =>
    new Promise<void>((resolve, reject) => {
      if (configuration.actors != null) {
        configuration.actors.pullEthernetPortSettings = fromPromise(
          async ({ input }) =>
            await Promise.resolve({
              Envelope: {
                Body: {
                  PullResponse: {
                    Items: {
                      AMT_EthernetPortSettings: [
                        { ElementName: 'Ethernet Settings', InstanceID: 'Settings 0' },
                        { ElementName: 'Ethernet Settings', InstanceID: 'Settings 1', MACAddress: '00-00-00-02-00-05' }
                      ]
                    }
                  }
                }
              }
            })
        )
        configuration.actors.enumerateWifiEndpointSettings = fromPromise(
          async ({ input }) => await Promise.reject(new Error())
        )
      }

      const mockUnconfigurationMachine = unconfiguration.machine.provide(configuration)
      const flowStates = [
        'UNCONFIGURED',
        'ENUMERATE_ETHERNET_PORT_SETTINGS',
        'PULL_ETHERNET_PORT_SETTINGS',
        'ENUMERATE_WIFI_ENDPOINT_SETTINGS',
        'FAILURE'
      ]
      const service = createActor(mockUnconfigurationMachine, { input: unconfigContext })
      service.subscribe({
        next: (state) => {
          try {
            const expectedState: any = flowStates[currentStateIndex++]
            expect(state.matches(expectedState)).toBe(true)
            if (state.matches('FAILURE') && currentStateIndex === flowStates.length) {
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
      service.send({ type: 'REMOVECONFIG', clientId })
    }))

  it('should eventually reach FAILURE after ENUMERATE_HTTP_PROXY_ACCESS_POINT', () =>
    new Promise<void>((resolve, reject) => {
      configuration.actors!.enumerateHTTPProxyAccessPoint = fromPromise(
        async ({ input }) => await Promise.reject(new Error())
      )
      const mockUnconfigurationMachine = unconfiguration.machine.provide(configuration)
      const flowStates = [
        'UNCONFIGURED',
        'ENUMERATE_ETHERNET_PORT_SETTINGS',
        'PULL_ETHERNET_PORT_SETTINGS',
        'GET_8021X_PROFILE',
        'ENUMERATE_WIFI_ENDPOINT_SETTINGS',
        'PULL_WIFI_ENDPOINT_SETTINGS',
        'ENUMERATE_HTTP_PROXY_ACCESS_POINT',
        'FAILURE'
      ]
      const service = createActor(mockUnconfigurationMachine, { input: unconfigContext })
      service.subscribe({
        next: (state) => {
          try {
            const expectedState: any = flowStates[currentStateIndex++]
            expect(state.matches(expectedState)).toBe(true)
            if (state.matches('FAILURE') && currentStateIndex === flowStates.length) {
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
      service.send({ type: 'REMOVECONFIG', clientId })
    }))

  it('should eventually reach FAILURE after PULL_HTTP_PROXY_ACCESS_POINT', () =>
    new Promise<void>((resolve, reject) => {
      configuration.actors!.pullHTTPProxyAccessPoint = fromPromise(
        async ({ input }) => await Promise.reject(new Error())
      )
      const mockUnconfigurationMachine = unconfiguration.machine.provide(configuration)
      const flowStates = [
        'UNCONFIGURED',
        'ENUMERATE_ETHERNET_PORT_SETTINGS',
        'PULL_ETHERNET_PORT_SETTINGS',
        'GET_8021X_PROFILE',
        'ENUMERATE_WIFI_ENDPOINT_SETTINGS',
        'PULL_WIFI_ENDPOINT_SETTINGS',
        'ENUMERATE_HTTP_PROXY_ACCESS_POINT',
        'PULL_HTTP_PROXY_ACCESS_POINT',
        'FAILURE'
      ]
      const service = createActor(mockUnconfigurationMachine, { input: unconfigContext })
      service.subscribe({
        next: (state) => {
          try {
            const expectedState: any = flowStates[currentStateIndex++]
            expect(state.matches(expectedState)).toBe(true)
            if (state.matches('FAILURE') && currentStateIndex === flowStates.length) {
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
      service.send({ type: 'REMOVECONFIG', clientId })
    }))

  it('should eventually reach FAILURE after DELETE_HTTP_PROXY_ACCESS_POINT', () =>
    new Promise<void>((resolve, reject) => {
      configuration.guards!.hasHTTPProxyAccessPoints = () => true
      configuration.actors!.pullHTTPProxyAccessPoint = fromPromise(
        async ({ input }) =>
          await Promise.resolve({
            Envelope: {
              Body: {
                PullResponse: {
                  Items: {
                    IPS_HTTPProxyAccessPoint: [
                      { Name: 'Intel(r) ME:HTTP Proxy Access Point 0' },
                      { Name: 'Intel(r) ME:HTTP Proxy Access Point 1' }
                    ]
                  },
                  EndOfSequence: ''
                }
              }
            }
          })
      )
      configuration.actors!.deleteHTTPProxyAccessPoint = fromPromise(
        async ({ input }) => await Promise.reject(new Error())
      )
      const mockUnconfigurationMachine = unconfiguration.machine.provide(configuration)
      const flowStates = [
        'UNCONFIGURED',
        'ENUMERATE_ETHERNET_PORT_SETTINGS',
        'PULL_ETHERNET_PORT_SETTINGS',
        'GET_8021X_PROFILE',
        'ENUMERATE_WIFI_ENDPOINT_SETTINGS',
        'PULL_WIFI_ENDPOINT_SETTINGS',
        'ENUMERATE_HTTP_PROXY_ACCESS_POINT',
        'PULL_HTTP_PROXY_ACCESS_POINT',
        'DELETE_HTTP_PROXY_ACCESS_POINT',
        'FAILURE'
      ]
      const service = createActor(mockUnconfigurationMachine, { input: unconfigContext })
      service.subscribe({
        next: (state) => {
          try {
            const expectedState: any = flowStates[currentStateIndex++]
            expect(state.matches(expectedState)).toBe(true)
            if (state.matches('FAILURE') && currentStateIndex === flowStates.length) {
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
      service.send({ type: 'REMOVECONFIG', clientId })
    }))

  it('should handle multiple HTTP Proxy pull operations with EnumerationContext', () =>
    new Promise<void>((resolve, reject) => {
      let pullCount = 0
      configuration.guards!.hasMoreHTTPProxyData = ({ context }) => {
        // Check if we have EnumerationContext and no EndOfSequence
        return (
          context.message.Envelope.Body.PullResponse?.EnumerationContext != null &&
          context.message.Envelope.Body.PullResponse?.EndOfSequence == null
        )
      }
      configuration.guards!.hasHTTPProxyAccessPoints = () => true
      configuration.actors!.pullHTTPProxyAccessPoint = fromPromise(async ({ input }) => {
        pullCount++
        if (pullCount === 1) {
          // First pull response with EnumerationContext
          return await Promise.resolve({
            Envelope: {
              Body: {
                PullResponse: {
                  EnumerationContext: '50270200-0000-0000-0000-000000000000',
                  Items: {
                    IPS_HTTPProxyAccessPoint: { Name: 'Intel(r) ME:HTTP Proxy Access Point 0' }
                  }
                }
              }
            }
          })
        } else {
          // Second pull response with EndOfSequence
          return await Promise.resolve({
            Envelope: {
              Body: {
                PullResponse: {
                  Items: {
                    IPS_HTTPProxyAccessPoint: { Name: 'Intel(r) ME:HTTP Proxy Access Point 1' }
                  },
                  EndOfSequence: ''
                }
              }
            }
          })
        }
      })
      configuration.actors!.deleteHTTPProxyAccessPoint = fromPromise(
        async ({ input }) => await Promise.reject(new Error())
      )
      const mockUnconfigurationMachine = unconfiguration.machine.provide(configuration)
      const flowStates = [
        'UNCONFIGURED',
        'ENUMERATE_ETHERNET_PORT_SETTINGS',
        'PULL_ETHERNET_PORT_SETTINGS',
        'GET_8021X_PROFILE',
        'ENUMERATE_WIFI_ENDPOINT_SETTINGS',
        'PULL_WIFI_ENDPOINT_SETTINGS',
        'ENUMERATE_HTTP_PROXY_ACCESS_POINT',
        'PULL_HTTP_PROXY_ACCESS_POINT',
        'PULL_HTTP_PROXY_ACCESS_POINT', // Second pull after EnumerationContext check
        'DELETE_HTTP_PROXY_ACCESS_POINT',
        'FAILURE'
      ]
      const service = createActor(mockUnconfigurationMachine, { input: unconfigContext })
      service.subscribe({
        next: (state) => {
          try {
            const expectedState: any = flowStates[currentStateIndex++]
            expect(state.matches(expectedState)).toBe(true)
            if (state.matches('FAILURE') && currentStateIndex === flowStates.length) {
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
      service.send({ type: 'REMOVECONFIG', clientId })
    }))

  it('should eventually reach FAILURE after ENUMERATE_MANAGEMENT_PRESENCE_REMOTE_SAP', () =>
    new Promise<void>((resolve, reject) => {
      configuration.actors!.enumerateManagementPresenceRemoteSAP = fromPromise(
        async ({ input }) => await Promise.reject(new Error())
      )
      const mockUnconfigurationMachine = unconfiguration.machine.provide(configuration)
      const flowStates = [
        'UNCONFIGURED',
        'ENUMERATE_ETHERNET_PORT_SETTINGS',
        'PULL_ETHERNET_PORT_SETTINGS',
        'GET_8021X_PROFILE',
        'ENUMERATE_WIFI_ENDPOINT_SETTINGS',
        'PULL_WIFI_ENDPOINT_SETTINGS',
        'ENUMERATE_HTTP_PROXY_ACCESS_POINT',
        'PULL_HTTP_PROXY_ACCESS_POINT',
        'REMOVE_REMOTE_ACCESS_POLICY_RULE_USER_INITIATED',
        'REMOVE_REMOTE_ACCESS_POLICY_RULE_ALERT',
        'REMOVE_REMOTE_ACCESS_POLICY_RULE_PERIODIC',
        'ENUMERATE_MANAGEMENT_PRESENCE_REMOTE_SAP',
        'FAILURE'
      ]
      const service = createActor(mockUnconfigurationMachine, { input: unconfigContext })
      service.subscribe({
        next: (state) => {
          try {
            const expectedState: any = flowStates[currentStateIndex++]
            expect(state.matches(expectedState)).toBe(true)
            if (state.matches('FAILURE') && currentStateIndex === flowStates.length) {
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
      service.send({ type: 'REMOVECONFIG', clientId })
    }))

  it('should eventually reach FAILURE after DELETE_WIFI_ENDPOINT_SETTINGS', () =>
    new Promise<void>((resolve, reject) => {
      configuration.guards!.is8021xProfileEnabled = () => true
      configuration.actors!.pullWifiEndpointSettings = fromPromise(
        async ({ input }) =>
          await Promise.resolve({
            Envelope: {
              Body: {
                PullResponse: {
                  Items: {
                    CIM_WiFiEndpointSettings: [
                      { InstanceID: 'testID', Priority: 1 },
                      { InstanceID: 'testID2', Priority: 2 }
                    ]
                  }
                }
              }
            }
          })
      )
      configuration.actors!.deleteWiFiProfileOnAMTDevice = fromPromise(
        async ({ input }) => await Promise.reject(new Error())
      )
      const mockUnconfigurationMachine = unconfiguration.machine.provide(configuration)
      const flowStates = [
        'UNCONFIGURED',
        'ENUMERATE_ETHERNET_PORT_SETTINGS',
        'PULL_ETHERNET_PORT_SETTINGS',
        'GET_8021X_PROFILE',
        'DISABLE_IEEE8021X_WIRED',
        'ENUMERATE_WIFI_ENDPOINT_SETTINGS',
        'PULL_WIFI_ENDPOINT_SETTINGS',
        'DELETE_WIFI_ENDPOINT_SETTINGS',
        'FAILURE'
      ]
      const service = createActor(mockUnconfigurationMachine, { input: unconfigContext })
      service.subscribe({
        next: (state) => {
          try {
            const expectedState: any = flowStates[currentStateIndex++]
            expect(state.matches(expectedState)).toBe(true)
            if (state.matches('FAILURE') && currentStateIndex === flowStates.length) {
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
      service.send({ type: 'REMOVECONFIG', clientId })
    }))
  it('should eventually reach FAILURE after PULL_MANAGEMENT_PRESENCE_REMOTE_SAP', () =>
    new Promise<void>((resolve, reject) => {
      configuration.guards!.is8021xProfileEnabled = () => true
      configuration.actors!.pullManagementPresenceRemoteSAP = fromPromise(
        async ({ input }) => await Promise.reject(new Error())
      )
      const mockUnconfigurationMachine = unconfiguration.machine.provide(configuration)
      const flowStates = [
        'UNCONFIGURED',
        'ENUMERATE_ETHERNET_PORT_SETTINGS',
        'PULL_ETHERNET_PORT_SETTINGS',
        'GET_8021X_PROFILE',
        'DISABLE_IEEE8021X_WIRED',
        'ENUMERATE_WIFI_ENDPOINT_SETTINGS',
        'PULL_WIFI_ENDPOINT_SETTINGS',
        'ENUMERATE_HTTP_PROXY_ACCESS_POINT',
        'PULL_HTTP_PROXY_ACCESS_POINT',
        'REMOVE_REMOTE_ACCESS_POLICY_RULE_USER_INITIATED',
        'REMOVE_REMOTE_ACCESS_POLICY_RULE_ALERT',
        'REMOVE_REMOTE_ACCESS_POLICY_RULE_PERIODIC',
        'ENUMERATE_MANAGEMENT_PRESENCE_REMOTE_SAP',
        'PULL_MANAGEMENT_PRESENCE_REMOTE_SAP',
        'FAILURE'
      ]
      const service = createActor(mockUnconfigurationMachine, { input: unconfigContext })
      service.subscribe({
        next: (state) => {
          try {
            const expectedState: any = flowStates[currentStateIndex++]
            expect(state.matches(expectedState)).toBe(true)
            if (state.matches('FAILURE') && currentStateIndex === flowStates.length) {
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
      service.send({ type: 'REMOVECONFIG', clientId })
    }))

  it('should eventually reach FAILURE after ENUMERATE_TLS_SETTING_DATA', () =>
    new Promise<void>((resolve, reject) => {
      configuration.actors!.enumerateTLSSettingData = fromPromise(
        async ({ input }) => await Promise.reject(new Error())
      )
      const mockUnconfigurationMachine = unconfiguration.machine.provide(configuration)
      const flowStates = [
        'UNCONFIGURED',
        'ENUMERATE_ETHERNET_PORT_SETTINGS',
        'PULL_ETHERNET_PORT_SETTINGS',
        'GET_8021X_PROFILE',
        'ENUMERATE_WIFI_ENDPOINT_SETTINGS',
        'PULL_WIFI_ENDPOINT_SETTINGS',
        'ENUMERATE_HTTP_PROXY_ACCESS_POINT',
        'PULL_HTTP_PROXY_ACCESS_POINT',
        'REMOVE_REMOTE_ACCESS_POLICY_RULE_USER_INITIATED',
        'REMOVE_REMOTE_ACCESS_POLICY_RULE_ALERT',
        'REMOVE_REMOTE_ACCESS_POLICY_RULE_PERIODIC',
        'ENUMERATE_MANAGEMENT_PRESENCE_REMOTE_SAP',
        'PULL_MANAGEMENT_PRESENCE_REMOTE_SAP',
        'ENUMERATE_TLS_SETTING_DATA',
        'FAILURE'
      ]
      const service = createActor(mockUnconfigurationMachine, { input: unconfigContext })
      service.subscribe({
        next: (state) => {
          try {
            const expectedState: any = flowStates[currentStateIndex++]
            expect(state.matches(expectedState)).toBe(true)
            if (state.matches('FAILURE') && currentStateIndex === flowStates.length) {
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
      service.send({ type: 'REMOVECONFIG', clientId })
    }))

  it('should eventually reach FAILURE after PULL_TLS_SETTING_DATA', () =>
    new Promise<void>((resolve, reject) => {
      configuration.actors!.pullTLSSettingData = fromPromise(async ({ input }) => await Promise.reject(new Error()))
      const mockUnconfigurationMachine = unconfiguration.machine.provide(configuration)
      const flowStates = [
        'UNCONFIGURED',
        'ENUMERATE_ETHERNET_PORT_SETTINGS',
        'PULL_ETHERNET_PORT_SETTINGS',
        'GET_8021X_PROFILE',
        'ENUMERATE_WIFI_ENDPOINT_SETTINGS',
        'PULL_WIFI_ENDPOINT_SETTINGS',
        'ENUMERATE_HTTP_PROXY_ACCESS_POINT',
        'PULL_HTTP_PROXY_ACCESS_POINT',
        'REMOVE_REMOTE_ACCESS_POLICY_RULE_USER_INITIATED',
        'REMOVE_REMOTE_ACCESS_POLICY_RULE_ALERT',
        'REMOVE_REMOTE_ACCESS_POLICY_RULE_PERIODIC',
        'ENUMERATE_MANAGEMENT_PRESENCE_REMOTE_SAP',
        'PULL_MANAGEMENT_PRESENCE_REMOTE_SAP',
        'ENUMERATE_TLS_SETTING_DATA',
        'PULL_TLS_SETTING_DATA',
        'FAILURE'
      ]
      const service = createActor(mockUnconfigurationMachine, { input: unconfigContext })
      service.subscribe({
        next: (state) => {
          try {
            const expectedState: any = flowStates[currentStateIndex++]
            expect(state.matches(expectedState)).toBe(true)
            if (state.matches('FAILURE') && currentStateIndex === flowStates.length) {
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
      service.send({ type: 'REMOVECONFIG', clientId })
    }))

  it('should eventually reach FAILURE after ENUMERATE_PUBLIC_KEY_CERTIFICATE', () =>
    new Promise<void>((resolve, reject) => {
      configuration.actors!.enumeratePublicKeyCertificate = fromPromise(
        async ({ input }) => await Promise.reject(new Error())
      )
      const mockUnconfigurationMachine = unconfiguration.machine.provide(configuration)
      const flowStates = [
        'UNCONFIGURED',
        'ENUMERATE_ETHERNET_PORT_SETTINGS',
        'PULL_ETHERNET_PORT_SETTINGS',
        'GET_8021X_PROFILE',
        'ENUMERATE_WIFI_ENDPOINT_SETTINGS',
        'PULL_WIFI_ENDPOINT_SETTINGS',
        'ENUMERATE_HTTP_PROXY_ACCESS_POINT',
        'PULL_HTTP_PROXY_ACCESS_POINT',
        'REMOVE_REMOTE_ACCESS_POLICY_RULE_USER_INITIATED',
        'REMOVE_REMOTE_ACCESS_POLICY_RULE_ALERT',
        'REMOVE_REMOTE_ACCESS_POLICY_RULE_PERIODIC',
        'ENUMERATE_MANAGEMENT_PRESENCE_REMOTE_SAP',
        'PULL_MANAGEMENT_PRESENCE_REMOTE_SAP',
        'ENUMERATE_TLS_SETTING_DATA',
        'PULL_TLS_SETTING_DATA',
        'ENUMERATE_PUBLIC_KEY_CERTIFICATE',
        'FAILURE'
      ]
      const service = createActor(mockUnconfigurationMachine, { input: unconfigContext })
      service.subscribe({
        next: (state) => {
          try {
            const expectedState: any = flowStates[currentStateIndex++]
            expect(state.matches(expectedState)).toBe(true)
            if (state.matches('FAILURE') && currentStateIndex === flowStates.length) {
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
      service.send({ type: 'REMOVECONFIG', clientId })
    }))

  it('should eventually reach FAILURE after PULL_PUBLIC_KEY_CERTIFICATE', () =>
    new Promise<void>((resolve, reject) => {
      configuration.actors!.pullPublicKeyCertificate = fromPromise(
        async ({ input }) => await Promise.reject(new Error())
      )
      const mockUnconfigurationMachine = unconfiguration.machine.provide(configuration)
      const flowStates = [
        'UNCONFIGURED',
        'ENUMERATE_ETHERNET_PORT_SETTINGS',
        'PULL_ETHERNET_PORT_SETTINGS',
        'GET_8021X_PROFILE',
        'ENUMERATE_WIFI_ENDPOINT_SETTINGS',
        'PULL_WIFI_ENDPOINT_SETTINGS',
        'ENUMERATE_HTTP_PROXY_ACCESS_POINT',
        'PULL_HTTP_PROXY_ACCESS_POINT',
        'REMOVE_REMOTE_ACCESS_POLICY_RULE_USER_INITIATED',
        'REMOVE_REMOTE_ACCESS_POLICY_RULE_ALERT',
        'REMOVE_REMOTE_ACCESS_POLICY_RULE_PERIODIC',
        'ENUMERATE_MANAGEMENT_PRESENCE_REMOTE_SAP',
        'PULL_MANAGEMENT_PRESENCE_REMOTE_SAP',
        'ENUMERATE_TLS_SETTING_DATA',
        'PULL_TLS_SETTING_DATA',
        'ENUMERATE_PUBLIC_KEY_CERTIFICATE',
        'PULL_PUBLIC_KEY_CERTIFICATE',
        'FAILURE'
      ]
      const service = createActor(mockUnconfigurationMachine, { input: unconfigContext })
      service.subscribe({
        next: (state) => {
          try {
            const expectedState: any = flowStates[currentStateIndex++]
            expect(state.matches(expectedState)).toBe(true)
            if (state.matches('FAILURE') && currentStateIndex === flowStates.length) {
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
      service.send({ type: 'REMOVECONFIG', clientId })
    }))

  it('should eventually reach FAILURE after ENUMERATE_PUBLIC_KEY_CERTIFICATE with 8021x updated', () =>
    new Promise<void>((resolve, reject) => {
      unconfigContext.is8021xProfileUpdated = true
      configuration.actors!.pullPublicPrivateKeyPair = fromPromise(
        async ({ input }) => await Promise.resolve({ Envelope: { Body: { PullResponse: { Items: {} } } } })
      )
      configuration.actors!.enumeratePublicKeyCertificate = fromPromise(
        async ({ input }) => await Promise.reject(new Error())
      )
      const mockUnconfigurationMachine = unconfiguration.machine.provide(configuration)
      const flowStates = [
        'UNCONFIGURED',
        'ENUMERATE_ETHERNET_PORT_SETTINGS',
        'PULL_ETHERNET_PORT_SETTINGS',
        'GET_8021X_PROFILE',
        'ENUMERATE_WIFI_ENDPOINT_SETTINGS',
        'PULL_WIFI_ENDPOINT_SETTINGS',
        'ENUMERATE_HTTP_PROXY_ACCESS_POINT',
        'PULL_HTTP_PROXY_ACCESS_POINT',
        'REMOVE_REMOTE_ACCESS_POLICY_RULE_USER_INITIATED',
        'REMOVE_REMOTE_ACCESS_POLICY_RULE_ALERT',
        'REMOVE_REMOTE_ACCESS_POLICY_RULE_PERIODIC',
        'ENUMERATE_MANAGEMENT_PRESENCE_REMOTE_SAP',
        'PULL_MANAGEMENT_PRESENCE_REMOTE_SAP',
        'ENUMERATE_TLS_SETTING_DATA',
        'PULL_TLS_SETTING_DATA',
        'ENUMERATE_PUBLIC_PRIVATE_KEY_PAIR',
        'PULL_PUBLIC_PRIVATE_KEY_PAIR',
        'ENUMERATE_PUBLIC_KEY_CERTIFICATE',
        'FAILURE'
      ]
      const service = createActor(mockUnconfigurationMachine, { input: unconfigContext })
      service.subscribe({
        next: (state) => {
          try {
            const expectedState: any = flowStates[currentStateIndex++]
            expect(state.matches(expectedState)).toBe(true)
            if (state.matches('FAILURE') && currentStateIndex === flowStates.length) {
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
      service.send({ type: 'REMOVECONFIG', clientId })
    }))

  it('should eventually reach FAILURE after GET_ENVIRONMENT_DETECTION_SETTINGS', () =>
    new Promise<void>((resolve, reject) => {
      configuration.actors!.getEnvironmentDetectionSettings = fromPromise(
        async ({ input }) => await Promise.reject(new Error())
      )
      const mockUnconfigurationMachine = unconfiguration.machine.provide(configuration)
      const flowStates = [
        'UNCONFIGURED',
        'ENUMERATE_ETHERNET_PORT_SETTINGS',
        'PULL_ETHERNET_PORT_SETTINGS',
        'GET_8021X_PROFILE',
        'ENUMERATE_WIFI_ENDPOINT_SETTINGS',
        'PULL_WIFI_ENDPOINT_SETTINGS',
        'ENUMERATE_HTTP_PROXY_ACCESS_POINT',
        'PULL_HTTP_PROXY_ACCESS_POINT',
        'REMOVE_REMOTE_ACCESS_POLICY_RULE_USER_INITIATED',
        'REMOVE_REMOTE_ACCESS_POLICY_RULE_ALERT',
        'REMOVE_REMOTE_ACCESS_POLICY_RULE_PERIODIC',
        'ENUMERATE_MANAGEMENT_PRESENCE_REMOTE_SAP',
        'PULL_MANAGEMENT_PRESENCE_REMOTE_SAP',
        'ENUMERATE_TLS_SETTING_DATA',
        'PULL_TLS_SETTING_DATA',
        'ENUMERATE_PUBLIC_KEY_CERTIFICATE',
        'PULL_PUBLIC_KEY_CERTIFICATE',
        'GET_ENVIRONMENT_DETECTION_SETTINGS',
        'FAILURE'
      ]
      const service = createActor(mockUnconfigurationMachine, { input: unconfigContext })
      service.subscribe({
        next: (state) => {
          try {
            const expectedState: any = flowStates[currentStateIndex++]
            expect(state.matches(expectedState)).toBe(true)
            if (state.matches('FAILURE') && currentStateIndex === flowStates.length) {
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
      service.send({ type: 'REMOVECONFIG', clientId })
    }))
  it('should enum Ethernet Port Settiings', async () => {
    await unconfiguration.enumerateEthernetPortSettings({ input: unconfigContext })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })
  it('should pull Ethernet Port Setting', async () => {
    await unconfiguration.pullEthernetPortSettings({ input: unconfigContext })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })
  it('should get 8021x Profile', async () => {
    await unconfiguration.get8021xProfile({ input: unconfigContext })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })
  it('should fail get 8021x Profile', async () => {
    unconfigContext.ips = undefined
    await unconfiguration.get8021xProfile({ input: unconfigContext })
    expect(loggerSpy).toHaveBeenCalled()
  })
  it('should disable Wired 8021x Config', async () => {
    unconfigContext.message = {
      Envelope: {
        Body: { IPS_IEEE8021xSettings: { Username: 'testName', Password: 'testPw', AuthenticationProtocol: 'x' } }
      }
    }
    await unconfiguration.disableWired8021xConfiguration({ input: unconfigContext })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })
  it('should fail disable Wired 8021x Config', async () => {
    unconfigContext.ips = undefined
    await unconfiguration.disableWired8021xConfiguration({ input: unconfigContext })
    expect(loggerSpy).toHaveBeenCalled()
  })
  it('should enum Wifi Endpoint Settings', async () => {
    await unconfiguration.enumerateWifiEndpointSettings({ input: unconfigContext })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })
  it('should pull Wifi Endpoint Settings', async () => {
    await unconfiguration.pullWifiEndpointSettings({ input: unconfigContext })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })
  it('should delete Wifi Profile on AMT device', async () => {
    unconfigContext.wifiEndPointSettings = [{ test: 'junk' }]
    await unconfiguration.deleteWiFiProfileOnAMTDevice({ input: unconfigContext })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })
  it('should fail delete Wifi Profile on AMT device', async () => {
    unconfigContext.amt = undefined
    await unconfiguration.deleteWiFiProfileOnAMTDevice({ input: unconfigContext })
    expect(loggerSpy).toHaveBeenCalled()
  })
  it('should remove Remote Access Policy Rule User Initiated', async () => {
    await unconfiguration.removeRemoteAccessPolicyRuleUserInitiated({ input: unconfigContext })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })
  it('should fail remove Remote Access Policy Rule User Initiated', async () => {
    unconfigContext.amt = undefined
    await unconfiguration.removeRemoteAccessPolicyRuleUserInitiated({ input: unconfigContext })
    expect(loggerSpy).toHaveBeenCalled()
  })
  it('should remove Remote Access Policy Rule Alert', async () => {
    await unconfiguration.removeRemoteAccessPolicyRuleAlert({ input: unconfigContext })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })
  it('should fail remove Remote Access Policy Rule Alert', async () => {
    unconfigContext.amt = undefined
    await unconfiguration.removeRemoteAccessPolicyRuleAlert({ input: unconfigContext })
    expect(loggerSpy).toHaveBeenCalled()
  })
  it('should remove Remote Access Policy Rule Periodic', async () => {
    await unconfiguration.removeRemoteAccessPolicyRulePeriodic({ input: unconfigContext })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })
  it('should fail remove Remote Access Policy Rule Periodic', async () => {
    unconfigContext.amt = undefined
    await unconfiguration.removeRemoteAccessPolicyRulePeriodic({ input: unconfigContext })
    expect(loggerSpy).toHaveBeenCalled()
  })
  it('should enum Management Presence Remote SAP', async () => {
    await unconfiguration.enumerateManagementPresenceRemoteSAP({ input: unconfigContext })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })
  it('should fail enum Management Presence Remote SAP', async () => {
    unconfigContext.amt = undefined
    await unconfiguration.enumerateManagementPresenceRemoteSAP({ input: unconfigContext })
    expect(loggerSpy).toHaveBeenCalled()
  })
  it('should pull Management Presence Remote SAP', async () => {
    unconfigContext.message = { Envelope: { Body: { EnumerateResponse: { EnumerationContext: 'xxx-xx-xxx' } } } }
    await unconfiguration.pullManagementPresenceRemoteSAP({ input: unconfigContext })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })
  it('should fail pull Management Presence Remote SAP', async () => {
    unconfigContext.amt = undefined
    await unconfiguration.pullManagementPresenceRemoteSAP({ input: unconfigContext })
    expect(loggerSpy).toHaveBeenCalled()
  })
  it('should delete Remote Access Service', async () => {
    await unconfiguration.deleteRemoteAccessService({ input: unconfigContext })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })
  it('should fail delete Remote Access Service', async () => {
    unconfigContext.amt = undefined
    await unconfiguration.deleteRemoteAccessService({ input: unconfigContext })
    expect(loggerSpy).toHaveBeenCalled()
  })
  it('should enum public key cert', async () => {
    await unconfiguration.enumeratePublicKeyCertificate({ input: unconfigContext })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })
  it('should fail enum public key cert', async () => {
    unconfigContext.amt = undefined
    await unconfiguration.enumeratePublicKeyCertificate({ input: unconfigContext })
    expect(loggerSpy).toHaveBeenCalled()
  })
  it('should pull public key cert', async () => {
    unconfigContext.message = { Envelope: { Body: { EnumerateResponse: { EnumerationContext: 'xxx-xx-xxx' } } } }
    await unconfiguration.pullPublicKeyCertificate({ input: unconfigContext })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })
  it('should fail pull public key cert', async () => {
    unconfigContext.amt = undefined
    await unconfiguration.pullPublicKeyCertificate({ input: unconfigContext })
    expect(loggerSpy).toHaveBeenCalled()
  })
  it('should delete public key cert', async () => {
    unconfigContext.publicKeyCertificates[0] = 'xxxxxx'
    await unconfiguration.deletePublicKeyCertificate({ input: unconfigContext })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })
  it('should fail delete public key cert', async () => {
    unconfigContext.amt = undefined
    await unconfiguration.deletePublicKeyCertificate({ input: unconfigContext })
    expect(loggerSpy).toHaveBeenCalled()
  })
  it('should get Environment Detection Settings', async () => {
    await unconfiguration.getEnvironmentDetectionSettings({ input: unconfigContext })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })
  it('should fail get Environment Detection Settings', async () => {
    unconfigContext.amt = undefined
    await unconfiguration.getEnvironmentDetectionSettings({ input: unconfigContext })
    expect(loggerSpy).toHaveBeenCalled()
  })
  it('should clear Environment Detection Settings', async () => {
    unconfigContext.message = { Envelope: { Body: { AMT_EnvironmentDetectionSettingData: {} } } }
    await unconfiguration.clearEnvironmentDetectionSettings({ input: unconfigContext })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })
  it('should fail clear Environment Detection Settings', async () => {
    unconfigContext.amt = undefined
    await unconfiguration.clearEnvironmentDetectionSettings({ input: unconfigContext })
    expect(loggerSpy).toHaveBeenCalled()
  })
  it('should enum TLS Setting Data', async () => {
    await unconfiguration.enumerateTLSSettingData({ input: unconfigContext })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })
  it('should fail enum TLS Setting Data', async () => {
    unconfigContext.amt = undefined
    await unconfiguration.enumerateTLSSettingData({ input: unconfigContext })
    expect(loggerSpy).toHaveBeenCalled()
  })
  it('should pull TLS Setting Data', async () => {
    unconfigContext.message = { Envelope: { Body: { EnumerateResponse: { EnumerationContext: 'xxx-xx-xxx' } } } }
    await unconfiguration.pullTLSSettingData({ input: unconfigContext })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })
  it('should fail pull TLS Setting Data', async () => {
    unconfigContext.amt = undefined
    await unconfiguration.pullTLSSettingData({ input: unconfigContext })
    expect(loggerSpy).toHaveBeenCalled()
  })
  it('should disable remote TLS Setting Data', async () => {
    unconfigContext.message = {
      Envelope: { Body: { PullResponse: { Items: { AMT_TLSSettingData: unconfigContext.tlsSettingData } } } }
    }
    await unconfiguration.disableRemoteTLSSettingData({ input: unconfigContext })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })
  it('should fail disable remote TLS Setting Data', async () => {
    unconfigContext.amt = undefined
    await unconfiguration.disableRemoteTLSSettingData({ input: unconfigContext })
    expect(loggerSpy).toHaveBeenCalled()
  })
  it('should commit Setup and Config Service', async () => {
    await unconfiguration.commitSetupAndConfigurationService({ input: unconfigContext })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })
  it('should fail commit Setup and Config Service', async () => {
    unconfigContext.amt = undefined
    await unconfiguration.commitSetupAndConfigurationService({ input: unconfigContext })
    expect(loggerSpy).toHaveBeenCalled()
  })
  it('should disable local TLS Setting Data', async () => {
    await unconfiguration.disableLocalTLSSettingData({ input: unconfigContext })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })
  it('should fail disable local TLS Setting Data', async () => {
    unconfigContext.amt = undefined
    await unconfiguration.disableLocalTLSSettingData({ input: unconfigContext })
    expect(loggerSpy).toHaveBeenCalled()
  })
  it('should enum TLS Cred Context', async () => {
    await unconfiguration.enumerateTLSCredentialContext({ input: unconfigContext })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })
  it('should fail enum TLS Cred Context', async () => {
    unconfigContext.amt = undefined
    await unconfiguration.enumerateTLSCredentialContext({ input: unconfigContext })
    expect(loggerSpy).toHaveBeenCalled()
  })
  it('should pull TLS Cred Context', async () => {
    unconfigContext.message = { Envelope: { Body: { EnumerateResponse: { EnumerationContext: 'xxx-xx-xxx' } } } }
    await unconfiguration.pullTLSCredentialContext({ input: unconfigContext })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })
  it('should fail pull TLS Cred Context', async () => {
    unconfigContext.amt = undefined
    await unconfiguration.pullTLSCredentialContext({ input: unconfigContext })
    expect(loggerSpy).toHaveBeenCalled()
  })
  it('should delete TLS Cred Context', async () => {
    await unconfiguration.deleteTLSCredentialContext({ input: unconfigContext })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })
  it('should fail delete TLS Cred Context', async () => {
    unconfigContext.amt = undefined
    await unconfiguration.deleteTLSCredentialContext({ input: unconfigContext })
    expect(loggerSpy).toHaveBeenCalled()
  })
  it('should enum public private key pair', async () => {
    await unconfiguration.enumeratePublicPrivateKeyPair({ input: unconfigContext })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })
  it('should fail enum public private key pair', async () => {
    unconfigContext.amt = undefined
    await unconfiguration.enumeratePublicPrivateKeyPair({ input: unconfigContext })
    expect(loggerSpy).toHaveBeenCalled()
  })
  it('should pull public private key pair', async () => {
    unconfigContext.message = { Envelope: { Body: { EnumerateResponse: { EnumerationContext: 'xxx-xx-xxx' } } } }
    await unconfiguration.pullPublicPrivateKeyPair({ input: unconfigContext })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })
  it('should fail pull public private key pair', async () => {
    unconfigContext.amt = undefined
    await unconfiguration.pullPublicPrivateKeyPair({ input: unconfigContext })
    expect(loggerSpy).toHaveBeenCalled()
  })
  it('should delete public private key pair', async () => {
    unconfigContext.privateCerts[0] = 'xxxxxx'
    await unconfiguration.deletePublicPrivateKeyPair({ input: unconfigContext })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })
  it('should fail delete public private key pair', async () => {
    unconfigContext.amt = undefined
    await unconfiguration.deletePublicPrivateKeyPair({ input: unconfigContext })
    expect(loggerSpy).toHaveBeenCalled()
  })
  it('should enum HTTP Proxy Access Point', async () => {
    await unconfiguration.enumerateHTTPProxyAccessPoint({ input: unconfigContext })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })
  it('should fail enum HTTP Proxy Access Point', async () => {
    unconfigContext.ips = undefined
    await unconfiguration.enumerateHTTPProxyAccessPoint({ input: unconfigContext })
    expect(loggerSpy).toHaveBeenCalled()
  })
  it('should pull HTTP Proxy Access Point', async () => {
    unconfigContext.message = { Envelope: { Body: { EnumerateResponse: { EnumerationContext: 'xxx-xx-xxx' } } } }
    await unconfiguration.pullHTTPProxyAccessPoint({ input: unconfigContext })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })
  it('should fail pull HTTP Proxy Access Point', async () => {
    unconfigContext.ips = undefined
    await unconfiguration.pullHTTPProxyAccessPoint({ input: unconfigContext })
    expect(loggerSpy).toHaveBeenCalled()
  })
  it('should delete HTTP Proxy Access Point', async () => {
    unconfigContext.httpProxyAccessPoints = [{ Name: 'Intel(r) ME:HTTP Proxy Access Point 0' }]
    await unconfiguration.deleteHTTPProxyAccessPoint({ input: unconfigContext })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })
  it('should fail delete HTTP Proxy Access Point', async () => {
    unconfigContext.ips = undefined
    await unconfiguration.deleteHTTPProxyAccessPoint({ input: unconfigContext })
    expect(loggerSpy).toHaveBeenCalled()
  })
})

const noTlsInventory = fromPromise(async () => ({ certificates: [], keys: [], contexts: [] }))

describe('TLS cleanup read optimization', () => {
  afterEach(() => {
    delete devices[clientId]
  })

  it.each([
    { enforced: true, mps: false },
    { enforced: true, mps: true },
    { enforced: false, mps: false },
    { enforced: false, mps: true }
  ])('retains cleanup routing for $enforced/$mps', async ({ enforced, mps }) => {
    devices[clientId] = { tlsEnforced: enforced, status: {} } as any
    const enumerate = vi.fn(async () => ({}))
    const pull = vi.fn(async () => ({
      Envelope: { Body: { PullResponse: { Items: { AMT_TLSSettingData: [{ Enabled: true }] } } } }
    }))
    const removeMps = vi.fn(async () => ({}))
    const getEnvironment = vi.fn(async () => ({
      Envelope: { Body: { AMT_EnvironmentDetectionSettingData: { DetectionStrings: ['example'] } } }
    }))
    const clearEnvironment = vi.fn(async () => ({}))
    const machine = new Unconfiguration().machine.provide({
      actors: {
        readTlsInventory: noTlsInventory,
        enumerateTLSSettingData: fromPromise(enumerate),
        pullTLSSettingData: fromPromise(pull),
        deleteRemoteAccessService: fromPromise(removeMps),
        getEnvironmentDetectionSettings: fromPromise(getEnvironment),
        clearEnvironmentDetectionSettings: fromPromise(clearEnvironment)
      }
    })
    const snapshot = await runMachineSegment(
      machine,
      'PULL_MANAGEMENT_PRESENCE_REMOTE_SAP_RESPONSE',
      {
        clientId,
        message: {
          Envelope: { Body: { PullResponse: { Items: mps ? { AMT_ManagementPresenceRemoteSAP: {} } : {} } } }
        }
      },
      ['DISABLE_TLS_SETTING_DATA']
    )
    expect(snapshot.value).toBe(enforced ? 'SUCCESS' : 'DISABLE_TLS_SETTING_DATA')
    expect(enumerate).toHaveBeenCalledTimes(enforced ? 0 : 1)
    expect(pull).toHaveBeenCalledTimes(enforced ? 0 : 1)
    expect(removeMps).toHaveBeenCalledTimes(mps ? 1 : 0)
    expect(getEnvironment).toHaveBeenCalledTimes(enforced ? 1 : 0)
    expect(clearEnvironment).toHaveBeenCalledTimes(enforced ? 1 : 0)
  })

  it.each([
    'deleteRemoteAccessService',
    'getEnvironmentDetectionSettings',
    'clearEnvironmentDetectionSettings'
  ])('retains failure from %s', async (failedActor) => {
    devices[clientId] = { tlsEnforced: true, status: {} } as any
    const actors: any = {
      readTlsInventory: noTlsInventory,
      deleteRemoteAccessService: fromPromise(async () => ({})),
      getEnvironmentDetectionSettings: fromPromise(async () => ({
        Envelope: { Body: { AMT_EnvironmentDetectionSettingData: { DetectionStrings: ['example'] } } }
      })),
      clearEnvironmentDetectionSettings: fromPromise(async () => ({}))
    }
    actors[failedActor] = fromPromise(async () => {
      throw new Error('simulated cleanup failure')
    })
    const machine = new Unconfiguration().machine.provide({ actors })
    const snapshot = await runMachineSegment(machine, 'DELETE_MANAGEMENT_PRESENCE_REMOTE_SAP', { clientId }, [])
    expect(snapshot.value).toBe('FAILURE')
  })
})

describe('Broad unconfiguration deletion failures', () => {
  it.each([
    [
      'DELETE_PUBLIC_PRIVATE_KEY_PAIR',
      'privateCerts',
      'ENUMERATE_PUBLIC_KEY_CERTIFICATE'
    ],
    [
      'DELETE_PUBLIC_KEY_CERTIFICATE',
      'publicKeyCertificates',
      'GET_ENVIRONMENT_DETECTION_SETTINGS'
    ]
  ])('advances past persistently rejected objects in %s', async (state, queue, terminal) => {
    const entries = [{ InstanceID: 'first' }, { InstanceID: 'second' }]
    const attempted: string[] = []
    invokeWsmanCallSpy.mockImplementation(async (input: any) => {
      attempted.push(input[queue][0].InstanceID)
      throw { statusCode: 400 }
    })
    try {
      const snapshot = await runMachineSegment(
        new Unconfiguration().machine,
        state,
        {
          clientId,
          amt: new AMT.Messages(),
          [queue]: entries
        },
        [terminal]
      )
      expect(snapshot.value).toBe(terminal)
      expect(snapshot.context[queue]).toEqual([])
      expect(attempted).toEqual(['first', 'second'])
    } finally {
      invokeWsmanCallSpy.mockReset().mockResolvedValue({})
    }
  })
})

describe('Abandoned TLS object cleanup on TLS-enforced devices', () => {
  const certManager = new CertManager(new Logger('test'), new NodeForge())
  const issuer = { CN: 'MPSRoot' }
  const root = certManager.createCertificate(issuer)
  const leaf = (handle: number): { entry: any; key: any } => {
    const DERKey = generateKeyPairSync('rsa', { modulusLength: 2048 })
      .publicKey.export({ type: 'spki', format: 'der' })
      .toString('base64')
    const { pem } = certManager.amtCertSignWithCAKey(
      DERKey,
      root.key,
      { CN: 'AMT-device' },
      issuer,
      { name: 'extKeyUsage', serverAuth: true, clientAuth: false } as any,
      root.pem
    )
    return {
      entry: {
        InstanceID: `Cert ${handle}`,
        X509Certificate: pem,
        TrustedRootCertficate: false,
        ReadOnlyCertificate: false
      },
      key: { InstanceID: `Key ${handle}`, DERKey }
    }
  }
  const unconfiguration = new Unconfiguration()
  const active = leaf(0)
  const orphan = leaf(1)
  const inUse = {
    ElementInContext: { Selector: { _: 'Cert 0' } },
    ElementProvidingContext: { Selector: { _: 'test endpoint' } }
  }

  const run = async (
    inventory: any,
    failing?: string,
    tlsEnforced = true,
    afterDelete?: () => void
  ): Promise<{ deleted: string[]; value: any; status: string | undefined; kept: unknown[] }> => {
    devices[clientId] = {
      tlsEnforced,
      uuid: 'uuid-1',
      status: { CIRAConnection: 'connected', TLSConfiguration: 'configured' }
    } as any
    const deleted: string[] = []
    const remove = (name: string, list: 'privateCerts' | 'publicKeyCertificates'): any =>
      fromPromise(async ({ input }: any) => {
        if (failing === name) throw new Error('simulated delete failure')
        deleted.push(input[list][0].InstanceID)
        input[list] = input[list].slice(1)
        afterDelete?.()
      })
    const machine = unconfiguration.machine.provide({
      actors: {
        readTlsInventory: fromPromise(async () => {
          if (failing === 'read') throw new Error('simulated read failure')
          return inventory
        }),
        deletePublicPrivateKeyPair: remove('key', 'privateCerts'),
        deletePublicKeyCertificate: remove('certificate', 'publicKeyCertificates')
      }
    })
    const snapshot = await runMachineSegment(
      machine,
      'REMOVE_ABANDONED_TLS_OBJECTS',
      { clientId, privateCerts: [], publicKeyCertificates: [], tlsSettingData: [] },
      []
    )
    const { Status, CIRAConnection, TLSConfiguration } = devices[clientId].status as any
    return { deleted, value: snapshot.value, status: Status, kept: [CIRAConnection, TLSConfiguration] }
  }
  // readTlsInventory loads the signing key from Vault, so it arrives with the inventory on every route.
  const full = {
    certificates: [active.entry, orphan.entry],
    keys: [active.key, orphan.key],
    tlsContexts: [inUse],
    otherContexts: [] as any[],
    persistedLeafPem: active.entry.X509Certificate,
    signingKey: root.key
  }

  afterEach(() => {
    delete devices[clientId]
  })

  it('deletes the abandoned key, then its certificate, and keeps the active identity', async () => {
    expect(await run(full)).toMatchObject({ deleted: ['Key 1', 'Cert 1'], value: 'SUCCESS' })
  })

  it('finishes the job on retry when only the certificate is left', async () => {
    const retry = { ...full, keys: [active.key] }
    expect(await run(retry)).toMatchObject({ deleted: ['Cert 1'], value: 'SUCCESS' })
  })

  it('does not delete an object that any association still uses', async () => {
    const used = { ...full, otherContexts: [{ ...inUse, ElementInContext: { Selector: { _: 'Cert 1' } } }] }
    expect((await run(used)).deleted).toEqual([])
  })

  it('does nothing on other devices', async () => {
    expect(await run(full, undefined, false)).toMatchObject({ deleted: [], value: 'SUCCESS' })
  })

  it('deletes nothing while another request is activating the same device', async () => {
    devices['other-request'] = { uuid: 'uuid-1' } as any
    try {
      expect((await run(full)).deleted).toEqual([])
    } finally {
      delete devices['other-request']
    }
  })

  it('deletes nothing when Vault has no signing key', async () => {
    expect(await run({ ...full, signingKey: undefined })).toMatchObject({ deleted: [], value: 'SUCCESS' })
  })

  it('can run on its own, without the broad Stage 6 pass', async () => {
    devices[clientId] = { tlsEnforced: true, uuid: 'uuid-1', status: {} } as any
    const enumerateEthernet = vi.fn(async () => ({}))
    const machine = unconfiguration.machine.provide({
      actors: { enumerateEthernetPortSettings: fromPromise(enumerateEthernet), readTlsInventory: noTlsInventory }
    })
    const actor = createActor(machine, {
      input: { clientId, privateCerts: [], publicKeyCertificates: [], tlsSettingData: [] } as any
    })
    actor.start()
    actor.send({ type: 'REMOVE_ABANDONED_TLS', clientId })
    const snapshot = await waitFor(actor, (state) => state.status === 'done', { timeout: 1000 })
    actor.stop()
    expect(snapshot.value).toBe('SUCCESS')
    expect(enumerateEthernet).not.toHaveBeenCalled()
  })

  it.each([
    'read',
    'key',
    'certificate'
  ])('retries a digest challenge during %s without losing a queued object', async (step) => {
    devices[clientId] = { tlsEnforced: true, uuid: 'uuid-1', status: { Status: 'ACM' }, connectionParams: {} } as any
    const challenge = {
      statusCode: 401,
      headers: [{ name: 'Www-Authenticate', value: 'Digest realm="AMT", nonce="new-nonce", qop="auth"' }]
    }
    let challenged = false
    const deleted: string[] = []
    const read = vi.fn(async () => {
      if (step === 'read' && !challenged) {
        challenged = true
        throw challenge
      }
      return full
    })
    invokeWsmanCallSpy.mockImplementation(async (input: any) => {
      const kind = input.xmlMessage.includes('AMT_PublicPrivateKeyPair') ? 'key' : 'certificate'
      const list = kind === 'key' ? input.privateCerts : input.publicKeyCertificates
      if (step === kind && !challenged) {
        challenged = true
        throw challenge
      }
      deleted.push(list[0].InstanceID)
      return {}
    })
    try {
      const machine = unconfiguration.machine.provide({ actors: { readTlsInventory: fromPromise(read) } })
      const snapshot = await runMachineSegment(
        machine,
        'REMOVE_ABANDONED_TLS_OBJECTS',
        {
          clientId,
          retryCount: 0,
          privateCerts: [],
          publicKeyCertificates: [],
          amt: new AMT.Messages()
        },
        []
      )
      expect(snapshot.value).toBe('SUCCESS')
      expect(deleted).toEqual(['Key 1', 'Cert 1'])
      expect(devices[clientId].connectionParams.digestChallenge.nonce).toBe('new-nonce')
      expect(devices[clientId].status.Status).toBe('ACM')
      expect(challenged).toBe(true)
    } finally {
      invokeWsmanCallSpy.mockReset().mockResolvedValue({})
    }
  })

  it.each([
    'read',
    'key',
    'certificate'
  ])('stops after three rejected authentication attempts during %s', async (step) => {
    devices[clientId] = { tlsEnforced: true, uuid: 'uuid-1', status: { Status: 'ACM' }, connectionParams: {} } as any
    const challenge = { statusCode: 401, headers: [] }
    const read = vi.fn(async () => {
      if (step === 'read') throw challenge
      return full
    })
    const attempts = vi.fn(async (input: any) => {
      const kind = input.xmlMessage.includes('AMT_PublicPrivateKeyPair') ? 'key' : 'certificate'
      if (step === kind) throw challenge
      return {}
    })
    invokeWsmanCallSpy.mockImplementation(attempts)
    try {
      const machine = unconfiguration.machine.provide({ actors: { readTlsInventory: fromPromise(read) } })
      const snapshot = await runMachineSegment(
        machine,
        'REMOVE_ABANDONED_TLS_OBJECTS',
        {
          clientId,
          retryCount: 0,
          privateCerts: [],
          publicKeyCertificates: [],
          amt: new AMT.Messages()
        },
        []
      )
      expect(snapshot.value).toBe('CLEANUP_FAILURE')
      expect(step === 'read' ? read.mock.calls.length : attempts.mock.calls.length).toBe(step === 'certificate' ? 4 : 3)
      if (step === 'key') expect(snapshot.context.privateCerts).toEqual([orphan.key])
      if (step === 'certificate') expect(snapshot.context.publicKeyCertificates).toEqual([orphan.entry])
      expect(devices[clientId].status.Status).toBe('ACM')
    } finally {
      invokeWsmanCallSpy.mockReset().mockResolvedValue({})
    }
  })

  it('compares device UUIDs case-insensitively', async () => {
    devices['other-request'] = { uuid: 'UUID-1' } as any
    try {
      expect((await run(full)).deleted).toEqual([])
    } finally {
      delete devices['other-request']
    }
  })

  it('stops when another request for the device appears during cleanup', async () => {
    try {
      const result = await run(full, undefined, true, () => {
        devices['late-request'] = { uuid: 'uuid-1' } as any
      })
      expect(result).toMatchObject({ deleted: ['Key 1'], value: 'SUCCESS' })
    } finally {
      delete devices['late-request']
    }
  })

  it.each([
    [
      'read',
      'Failed to read TLS inventory; abandoned objects were kept',
      []
    ],
    [
      'key',
      'Failed to delete abandoned TLS key pair',
      []
    ],
    [
      'certificate',
      'Failed to delete abandoned TLS certificate',
      ['Key 1']
    ]
  ])(
    'logs a %s failure, stops, and leaves activation, TLS and CIRA status alone',
    async (failing, message, deleted) => {
      const warning = vi.spyOn(unconfiguration.logger, 'warn')
      expect(await run(full, failing)).toEqual({
        deleted,
        value: 'CLEANUP_FAILURE',
        status: undefined,
        kept: ['connected', 'configured']
      })
      expect(warning).toHaveBeenCalledWith(`Abandoned TLS object cleanup incomplete: ${message}`)
      warning.mockRestore()
    }
  )
})

describe('readTlsInventory', () => {
  const page = (items: any, paging: Record<string, string>): any => ({
    Envelope: { Body: { PullResponse: { Items: items, ...paging } } }
  })
  const input = (): any => ({ clientId, amt: new AMT.Messages(), message: null })
  const className = (xml: string): string => /ResourceURI>[^<]*\/([^</]+)</.exec(xml)?.[1] ?? ''
  const serve = (pages: Record<string, any[]>): void => {
    const served: Record<string, number> = {}
    invokeWsmanCallSpy.mockImplementation(async (context: any) => {
      const name = className(context.xmlMessage)
      if (context.xmlMessage.includes('/Enumerate')) {
        return { Envelope: { Body: { EnumerateResponse: { EnumerationContext: 'ctx' } } } }
      }
      served[name] = (served[name] ?? 0) + 1
      return (pages[name] ?? [page('', { EndOfSequence: '' })])[served[name] - 1]
    })
  }

  const nodeForge = new NodeForge()
  const signingKey = new CertManager(new Logger('test'), nodeForge).createCertificate({ CN: 'MPSRoot' }).key
  const secrets: Record<string, unknown> = {
    MPSCerts: { root_key: nodeForge.privateKeyToPem(signingKey) }
  }
  const getSecretAtPath = vi.fn(
    async (path: string) =>
      secrets[path] ?? (path.startsWith('devices/') ? { TLS_ISSUED_CERTIFICATE: 'saved-leaf' } : null)
  )
  const unconfiguration = new Unconfiguration()
  const readyConfigurator: any = { ready: Promise.resolve(), secretsManager: { getSecretAtPath } }

  beforeEach(() => {
    unconfiguration.configurator = readyConfigurator
    devices[clientId] = { uuid: 'uuid-1', status: {} } as any
  })

  afterEach(() => {
    delete devices[clientId]
    invokeWsmanCallSpy.mockReset().mockResolvedValue({})
  })

  it('combines every page of certificates, keys and each kind of association', async () => {
    serve({
      AMT_PublicKeyCertificate: [
        page({ AMT_PublicKeyCertificate: [{ InstanceID: 'Cert 0' }] }, { EnumerationContext: 'more' }),
        page({ AMT_PublicKeyCertificate: { InstanceID: 'Cert 1' } }, { EndOfSequence: '' })
      ],
      AMT_TLSCredentialContext: [page({ AMT_TLSCredentialContext: { id: 'tls' } }, { EndOfSequence: '' })],
      AMT_RemoteAccessCredentialContext: [
        page({ AMT_RemoteAccessCredentialContext: { id: 'remote' } }, { EndOfSequence: '' })
      ],
      CIM_CredentialContext: [page({ CIM_CredentialContext: { id: 'wifi' } }, { EndOfSequence: '' })]
    })
    const inventory = await unconfiguration.readTlsInventory({ input: input() })
    expect(inventory.certificates).toEqual([{ InstanceID: 'Cert 0' }, { InstanceID: 'Cert 1' }])
    expect(inventory.tlsContexts).toEqual([{ id: 'tls' }])
    expect(inventory.otherContexts).toEqual([{ id: 'wifi' }, { id: 'remote' }])
    expect(inventory.persistedLeafPem).toBe('saved-leaf')
    expect(getSecretAtPath).toHaveBeenCalledWith('devices/uuid-1')
  })

  it('loads the signing key from Vault, whichever provisioning route ran', async () => {
    // No rootCertKey is set on the device, as on the TLS-reuse route where fetchMPSRootKey is skipped.
    serve({})
    const inventory = await unconfiguration.readTlsInventory({ input: input() })
    expect(inventory.signingKey.n.toString(16)).toBe(signingKey.n.toString(16))
    expect(getSecretAtPath).toHaveBeenCalledWith('MPSCerts')
  })

  it('has no signing key when Vault has none, so nothing can be selected', async () => {
    getSecretAtPath.mockImplementationOnce(async () => ({ TLS_ISSUED_CERTIFICATE: 'saved-leaf' }))
    getSecretAtPath.mockImplementationOnce(async () => null as any)
    serve({})
    expect((await unconfiguration.readTlsInventory({ input: input() })).signingKey).toBeUndefined()
  })

  it('waits for the Configurator to finish initializing before reading the saved leaf', async () => {
    const late: any = {}
    // Initialization finishes on a later timer, after the mocked WS-Man reads have all completed.
    late.ready = new Promise<void>((resolve) =>
      setTimeout(() => {
        late.secretsManager = { getSecretAtPath }
        resolve()
      }, 20)
    )
    unconfiguration.configurator = late
    serve({})
    expect((await unconfiguration.readTlsInventory({ input: input() })).persistedLeafPem).toBe('saved-leaf')
  })

  it('fails the read when the Configurator could not initialize', async () => {
    // A getter, so the rejection is created only when it is awaited.
    unconfiguration.configurator = {
      get ready() {
        return Promise.reject(new Error('initialization failed'))
      }
    } as any
    serve({})
    await expect(unconfiguration.readTlsInventory({ input: input() })).rejects.toThrow('initialization failed')
  })

  it.each([
    ['a page that neither ends nor continues', page({ AMT_PublicKeyCertificate: {} }, {})],
    ['a page without items', page(undefined, { EndOfSequence: '' })]
  ])('fails on %s so cleanup never uses a partial inventory', async (_name, bad) => {
    serve({ AMT_PublicKeyCertificate: [bad] })
    await expect(unconfiguration.readTlsInventory({ input: input() })).rejects.toThrow('Incomplete')
  })
})
