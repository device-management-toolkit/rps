/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { vi } from 'vitest'
import { randomUUID, X509Certificate } from 'node:crypto'
import forge from 'node-forge'
import { recordCertificate } from './tlsProvisioningJournal.js'
import { devices } from '../devices.js'
import { Environment } from '../utils/Environment.js'
import {
  type Unconfiguration as UnconfigurationType,
  type UnconfigContext as UnconfigContextType,
  type UnconfigEvent
} from './unconfiguration.js'
import { config } from '../test/helper/Config.js'
import { HttpHandler } from '../HttpHandler.js'
import { type MachineImplementationsSimplified, createActor, fromPromise, toPromise } from 'xstate'
import { AMT, CIM, IPS } from '@device-management-toolkit/wsman-messages'

import { HttpResponseError, coalesceMessage, isDigestRealmValid } from './common.js'

const invokeWsmanCallSpy = vi.hoisted(() => vi.fn<any>().mockResolvedValue({}))
const invokeEnterpriseAssistantCallSpy = vi.hoisted(() => vi.fn())
vi.mock('./common.js', async () => {
  const actual = await vi.importActual<typeof import('./common.js')>('./common.js')
  const { HttpResponseError, coalesceMessage, isDigestRealmValid } = actual
  return {
    ...actual,
    sendProgressToDevice: vi.fn(),
    recordComponentResult: vi.fn(),
    invokeWsmanCall: invokeWsmanCallSpy,
    invokeEnterpriseAssistantCall: invokeEnterpriseAssistantCallSpy,
    processTLSTunnelResponse: vi.fn(),
    HttpResponseError,
    isDigestRealmValid,
    coalesceMessage
  }
})
const { Unconfiguration, TLSCleanup } = await import('./unconfiguration.js')
const { TLS } = await import('./tls.js')

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
const uuid = 'cleanup-device'
const keys = Array.from({ length: 5 }, () => forge.pki.rsa.generateKeyPair(1024))
function issue(index: number, serial: string, root = false): string {
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys[index].publicKey
  cert.serialNumber = serial
  cert.validity.notBefore = new Date(Date.now() - 86400000)
  cert.validity.notAfter = new Date(Date.now() + 86400000)
  cert.setSubject([{ name: 'commonName', value: root ? 'root' : `leaf-${serial}` }])
  cert.setIssuer([{ name: 'commonName', value: 'root' }])
  cert.setExtensions([{ name: 'basicConstraints', cA: root }])
  cert.sign(keys[0].privateKey, forge.md.sha256.create())
  return forge.pki.certificateToPem(cert)
}
const root = issue(0, '01', true)
const abandoned = issue(1, '02')
const replacement = issue(2, '03')
const unknown = issue(3, '04')
const shared = issue(1, '05')
const certObject = (pem: string, id: string, trusted = false, readOnly = false): any => ({
  InstanceID: id,
  X509Certificate: pem,
  TrustedRootCertficate: trusted,
  ReadOnlyCertificate: readOnly
})
const keyObject = (pem: string, id: string): any => ({
  InstanceID: id,
  DERKey: new X509Certificate(pem).publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
})
const reference = (id: string): any => ({
  ReferenceParameters: { SelectorSet: { Selector: { _: id, $: { Name: 'InstanceID' } } } }
})
const association = (id: string): any => ({
  ElementInContext: reference(id),
  ElementProvidingContext: reference('endpoint')
})

describe('Interrupted TLS provisioning reconciliation', () => {
  let inventory: Record<string, any[]>
  let stored: Record<string, any>
  let secrets: any
  let operations: string[]
  let fail: string | undefined
  let loseResponse: boolean
  let pages: boolean
  beforeEach(() => {
    Environment.Config = { ...config, delay_tls_put_data_sync: 60000 }
    devices[uuid] = { uuid, hostname: uuid, status: {}, tls: {}, ClientSocket: { send: vi.fn() } } as any
    inventory = {
      AMT_PublicKeyCertificate: [
        certObject(root, 'root', true),
        certObject(abandoned, 'abandoned'),
        certObject(replacement, 'active'),
        certObject(unknown, 'unknown')
      ],
      AMT_PublicPrivateKeyPair: [
        keyObject(abandoned, 'old-key'),
        keyObject(replacement, 'active-key'),
        keyObject(unknown, 'unknown-key')
      ],
      AMT_TLSCredentialContext: [association('active')],
      AMT_TLSSettingData: [{ Enabled: true }],
      AMT_8021xCredentialContext: [],
      IPS_8021xCredentialContext: [],
      CIM_CredentialContext: [],
      AMT_RemoteAccessCredentialContext: []
    }
    stored = { [`devices/${uuid}`]: { TLS_ISSUED_CERTIFICATE: replacement } }
    secrets = {
      getSecretAtPath: vi.fn(async (path) => (stored[path] ? structuredClone(stored[path]) : null)),
      writeSecretWithObject: vi.fn(async (path, data, cas) => {
        if (cas != null && cas !== Number(stored[path]?.version ?? 0)) return null
        stored[path] = { ...structuredClone(data), version: Number(stored[path]?.version ?? 0) + 1 }
        return { data: { version: stored[path].version } }
      })
    }
    secrets.writeSecretWithObjectIfVersion = vi.fn(
      async (path, data, cas) => await secrets.writeSecretWithObject(path, data, cas)
    )
    operations = []
    fail = undefined
    loseResponse = false
    pages = false
    invokeWsmanCallSpy.mockImplementation(async (input) => {
      const xml = input.xmlMessage
      const resource = xml.match(/<w:ResourceURI>[^<]*\/([^<]+)<\/w:ResourceURI>/)?.[1]
      const operation = xml.match(/<a:Action>[^<]*\/([^<]+)<\/a:Action>/)?.[1]
      operations.push(`${operation}:${resource}`)
      if (fail === `${operation}:${resource}` && !loseResponse) throw new Error('injected failure')
      if (operation === 'Enumerate')
        return { Envelope: { Body: { EnumerateResponse: { EnumerationContext: resource } } } }
      if (operation === 'Pull') {
        const next = xml.includes(`${resource}:next`)
        const entries = inventory[resource] ?? []
        const paged = pages && resource === 'AMT_PublicKeyCertificate' && !next
        return {
          Envelope: {
            Body: {
              PullResponse: {
                ...(paged ? { EnumerationContext: `${resource}:next` } : { EndOfSequence: '' }),
                Items: { [resource]: paged ? entries.slice(0, 1) : pages && next ? entries.slice(1) : entries }
              }
            }
          }
        }
      }
      if (operation === 'Delete') {
        const id = xml.match(/<w:Selector Name="InstanceID">([^<]+)<\/w:Selector>/)?.[1]
        inventory[resource] = inventory[resource].filter((item) => item.InstanceID !== id)
        if (fail === `${operation}:${resource}`) throw new Error('lost delete response')
      }
      return { Envelope: { Body: null } }
    })
  })
  const input = (): any => ({ clientId: uuid, amt: new AMT.Messages(), secretsManager: secrets, httpHandler: {} })
  const recover = async (): Promise<any> => {
    const actor = createActor(new TLSCleanup().machine, { input: input() })
    actor.start()
    return await toPromise(actor)
  }
  const deletes = (): string[] => operations.filter((op) => op.startsWith('Delete'))
  const ids = (name: string): string[] => inventory[name].map((item) => item.InstanceID)

  it.each([true, false])(
    'recovers ownership across UUID casing changes (uppercase interruption: %s)',
    async (uppercase) => {
      const upper = 'AABBCCDD-1234-5678-ABCD-0123456789AB'
      const lower = upper.toLowerCase()
      await recordCertificate(secrets, uppercase ? upper : lower, abandoned)
      const recoveryUuid = uppercase ? lower : upper
      devices[uuid].uuid = recoveryUuid
      stored[`devices/${recoveryUuid}`] = { TLS_ISSUED_CERTIFICATE: replacement }
      expect(await recover()).toEqual({ errorMessage: '' })
      expect(ids('AMT_PublicKeyCertificate')).not.toContain('abandoned')
      expect(ids('AMT_PublicPrivateKeyPair')).not.toContain('old-key')
      expect(stored[`tls-provisioning/${lower}`].certificates).toEqual([])
      expect(stored[`tls-provisioning/${upper}`]).toBeUndefined()
    }
  )

  const challenge = {
    statusCode: 401,
    headers: [
      { name: 'Www-Authenticate', value: 'Digest realm="AMT", nonce="refreshed", stale="true", qop="auth"' },
      { name: 'Connection', value: 'close' }
    ]
  }
  const matchesOperation = (xml: string, operation: string): boolean => {
    const [
      action,
      resource,
      next
    ] = operation.split(':')
    return (
      xml.includes(`/${action}</a:Action>`) &&
      xml.includes(`/${resource}</w:ResourceURI>`) &&
      (!next || xml.includes(`${resource}:next`))
    )
  }
  const requestWithoutMessageId = (xml: string): string => xml.replace(/<a:MessageID>[^<]*<\/a:MessageID>/, '')

  it.each([
    'Enumerate:AMT_PublicKeyCertificate',
    'Pull:AMT_PublicKeyCertificate',
    'Pull:AMT_PublicKeyCertificate:next',
    'Delete:AMT_PublicKeyCertificate',
    'Delete:AMT_PublicPrivateKeyPair'
  ])('refreshes digest authentication and resumes %s', async (operation) => {
    await recordCertificate(secrets, uuid, abandoned)
    pages = true
    const close = vi.fn()
    Object.assign(devices[uuid], {
      connectionParams: { digestChallenge: { nonce: 'expired' } },
      tlsEnforced: true,
      tlsTunnelManager: { close }
    })
    const perform = invokeWsmanCallSpy.getMockImplementation()!
    const attempts: { xml: string; nonce: string }[] = []
    invokeWsmanCallSpy.mockImplementation(async (input) => {
      if (matchesOperation(input.xmlMessage, operation)) {
        attempts.push({
          xml: requestWithoutMessageId(input.xmlMessage),
          nonce: devices[uuid].connectionParams!.digestChallenge!.nonce
        })
        if (attempts.length === 1) throw challenge
      }
      return await perform(input)
    })
    expect(await recover()).toEqual({ errorMessage: '' })
    expect(attempts.length).toBeGreaterThanOrEqual(2)
    expect(attempts[1]).toEqual({ xml: attempts[0].xml, nonce: 'refreshed' })
    expect(close).toHaveBeenCalledOnce()
    expect(devices[uuid].tlsTunnelNeedsReset).toBe(true)
    expect(ids('AMT_PublicKeyCertificate')).toEqual([
      'root',
      'active',
      'unknown'
    ])
    expect(ids('AMT_PublicPrivateKeyPair')).toEqual(['active-key', 'unknown-key'])
    expect(stored[`tls-provisioning/${uuid}`].certificates).toEqual([])
  })

  it.each([
    'Enumerate:AMT_PublicKeyCertificate',
    'Pull:AMT_PublicKeyCertificate',
    'Delete:AMT_PublicKeyCertificate',
    'Delete:AMT_PublicPrivateKeyPair'
  ])('bounds repeated 401 challenges during %s and preserves pending ownership', async (operation) => {
    await recordCertificate(secrets, uuid, abandoned)
    devices[uuid].connectionParams = {} as any
    const perform = invokeWsmanCallSpy.getMockImplementation()!
    let attempts = 0
    invokeWsmanCallSpy.mockImplementation(async (input) => {
      if (matchesOperation(input.xmlMessage, operation)) {
        attempts++
        throw challenge
      }
      return await perform(input)
    })
    expect((await recover()).errorMessage).toContain('Unable to authenticate with AMT')
    expect(attempts).toBe(3)
    expect(stored[`tls-provisioning/${uuid}`].certificates).toEqual([abandoned])
    expect(ids('AMT_PublicPrivateKeyPair')).toContain('old-key')
    expect(ids('AMT_PublicKeyCertificate')).toEqual(
      operation.endsWith('PublicPrivateKeyPair') ? [
            'root',
            'active',
            'unknown'
          ] : [
            'root',
            'abandoned',
            'active',
            'unknown'
          ]
    )
    invokeWsmanCallSpy.mockImplementation(perform)
    expect(await recover()).toEqual({ errorMessage: '' })
    expect(stored[`tls-provisioning/${uuid}`].certificates).toEqual([])
  })

  it('resets the authentication retry budget after successful operations', async () => {
    await recordCertificate(secrets, uuid, abandoned)
    devices[uuid].connectionParams = {} as any
    const perform = invokeWsmanCallSpy.getMockImplementation()!
    const challenged = new Set<string>()
    invokeWsmanCallSpy.mockImplementation(async (input) => {
      const request = requestWithoutMessageId(input.xmlMessage)
      if (!challenged.has(request)) {
        challenged.add(request)
        throw challenge
      }
      return await perform(input)
    })
    expect(await recover()).toEqual({ errorMessage: '' })
    expect(challenged.size).toBeGreaterThan(3)
    expect(stored[`tls-provisioning/${uuid}`].certificates).toEqual([])
  })

  it('does not treat a Vault 401 as an AMT digest challenge', async () => {
    secrets.getSecretAtPath.mockRejectedValue(challenge)
    expect((await recover()).errorMessage).not.toBe('')
    expect(operations).toEqual([])
    expect(devices[uuid].unauthCount).toBe(0)
  })

  it('records an interrupted TLS installation, then recovers and removes only its leaf and key', async () => {
    let issued = abandoned
    inventory.AMT_PublicKeyCertificate = [certObject(root, 'root', true), certObject(unknown, 'unknown')]
    inventory.AMT_PublicPrivateKeyPair = [keyObject(unknown, 'unknown-key')]
    inventory.AMT_TLSCredentialContext = []
    delete stored[`devices/${uuid}`]
    const tls = new TLS()
    const machine = tls.machine.provide({
      actors: {
        enumeratePublicKeyCertificate: fromPromise(async () => ({})),
        pullPublicKeyCertificate: fromPromise(async () => ({})),
        addTrustedRootCertificate: fromPromise(async () => ({})),
        generateKeyPair: fromPromise(async () => ({})),
        enumeratePublicPrivateKeyPair: fromPromise(async () => ({})),
        pullPublicPrivateKeyPair: fromPromise(async () => ({
          Envelope: { Body: { PullResponse: { Items: { AMT_PublicPrivateKeyPair: {} } } } }
        })),
        prepareCertificate: fromPromise(async () => issued),
        addCertificate: fromPromise(async () => {
          expect(stored[`tls-provisioning/${uuid}`].certificates).toContain(issued)
          const old = issued === abandoned
          inventory.AMT_PublicKeyCertificate.push(certObject(issued, old ? 'abandoned' : 'active'))
          inventory.AMT_PublicPrivateKeyPair.push(keyObject(issued, old ? 'old-key' : 'active-key'))
          return {}
        }),
        enumerateTLSCredentialContext: fromPromise(async () => ({})),
        pullTLSCredentialContext: fromPromise(async () => ({ Envelope: { Body: { PullResponse: { Items: {} } } } })),
        createTLSCredentialContext: fromPromise(async () => {
          inventory.AMT_TLSCredentialContext = [association(issued === abandoned ? 'abandoned' : 'active')]
          return {}
        }),
        timeSync: fromPromise(async () => ({})),
        enumerateTLSData: fromPromise(async () => ({})),
        pullTLSData: fromPromise(async () => ({
          Envelope: { Body: { PullResponse: { Items: { AMT_TLSSettingData: [{}, {}] } } } }
        })),
        putRemoteTLSData: fromPromise(async () => ({})),
        putLocalTLSData: fromPromise(async () => ({})),
        commitChanges: fromPromise(async () => ({}))
      }
    })
    const actor = createActor(machine, {
      input: { ...input(), amtProfile: null, retryCount: 0, tlsSettingData: [], status: '', message: null }
    })
    const interrupted = new Promise<void>((resolve) =>
      actor.subscribe((snapshot) => {
        if (snapshot.matches('WAIT_A_BIT')) {
          actor.stop()
          resolve()
        }
      })
    )
    actor.start()
    actor.send({ type: 'CONFIGURE_TLS', clientId: uuid })
    await interrupted
    expect(actor.getSnapshot().value).toBe('WAIT_A_BIT')
    // A new process/request completes TLS provisioning and persists its leaf.
    issued = replacement
    Environment.Config.delay_tls_put_data_sync = 1
    const retry = createActor(machine, {
      input: { ...input(), amtProfile: null, retryCount: 0, tlsSettingData: [], status: '', message: null }
    })
    retry.start()
    retry.send({ type: 'CONFIGURE_TLS', clientId: uuid })
    expect((await toPromise(retry)).status).toBe('success')
    await secrets.writeSecretWithObject(`devices/${uuid}`, { TLS_ISSUED_CERTIFICATE: replacement })
    expect(await recover()).toEqual({ errorMessage: '' })
    expect(ids('AMT_PublicKeyCertificate').sort()).toEqual([
      'active',
      'root',
      'unknown'
    ])
    expect(ids('AMT_PublicPrivateKeyPair').sort()).toEqual(['active-key', 'unknown-key'])
    expect(deletes()).toEqual(['Delete:AMT_PublicKeyCertificate', 'Delete:AMT_PublicPrivateKeyPair'])
    const certificateDelete = operations.indexOf('Delete:AMT_PublicKeyCertificate')
    const keyDelete = operations.indexOf('Delete:AMT_PublicPrivateKeyPair')
    expect(operations.slice(certificateDelete + 1, keyDelete)).toEqual(
      expect.arrayContaining(Object.keys(inventory).map((name) => `Pull:${name}`))
    )
    expect(stored[`tls-provisioning/${uuid}`].certificates).toEqual([])
  })

  it.each([
    'AMT_TLSCredentialContext',
    'AMT_8021xCredentialContext',
    'IPS_8021xCredentialContext',
    'CIM_CredentialContext',
    'AMT_RemoteAccessCredentialContext'
  ])('preserves leaves used by %s', async (resource) => {
    await recordCertificate(secrets, uuid, abandoned)
    inventory[resource].push(association('abandoned'))
    expect(await recover()).toEqual({ errorMessage: '' })
    expect(deletes()).toEqual([])
  })

  it.each(['TrustedRootCertficate', 'ReadOnlyCertificate'])(
    'preserves %s certificates even if recorded',
    async (flag) => {
      await recordCertificate(secrets, uuid, abandoned)
      inventory.AMT_PublicKeyCertificate[1][flag] = 'true'
      expect(await recover()).toEqual({ errorMessage: '' })
      expect(deletes()).toEqual([])
    }
  )

  it('preserves shared keys and keys referenced directly by another association', async () => {
    await recordCertificate(secrets, uuid, abandoned)
    inventory.AMT_PublicKeyCertificate.push(certObject(shared, 'shared'))
    expect(await recover()).toEqual({ errorMessage: '' })
    expect(ids('AMT_PublicPrivateKeyPair')).toContain('old-key')
    expect(deletes()).toEqual(['Delete:AMT_PublicKeyCertificate'])
  })

  it('preserves a directly referenced key after deleting its abandoned certificate', async () => {
    await recordCertificate(secrets, uuid, abandoned)
    inventory.CIM_CredentialContext.push(association('old-key'))
    expect(await recover()).toEqual({ errorMessage: '' })
    expect(deletes()).toEqual(['Delete:AMT_PublicKeyCertificate'])
  })

  it('preserves every untracked object, including a matching but unowned leaf', async () => {
    expect(await recover()).toEqual({ errorMessage: '' })
    expect(operations).toEqual([])
  })

  it.each([
    'Enumerate:AMT_RemoteAccessCredentialContext',
    'Pull:CIM_CredentialContext',
    'Delete:AMT_PublicKeyCertificate',
    'Delete:AMT_PublicPrivateKeyPair'
  ])('reports %s failures and safely retries recovery', async (operation) => {
    await recordCertificate(secrets, uuid, abandoned)
    fail = operation
    expect((await recover()).errorMessage).not.toBe('')
    if (!operation.startsWith('Delete')) expect(deletes()).toEqual([])
    expect(stored[`tls-provisioning/${uuid}`].certificates).toContain(abandoned)
    fail = undefined
    expect(await recover()).toEqual({ errorMessage: '' })
    expect(ids('AMT_PublicKeyCertificate')).not.toContain('abandoned')
    expect(ids('AMT_PublicPrivateKeyPair')).not.toContain('old-key')
  })

  it.each(['Delete:AMT_PublicKeyCertificate', 'Delete:AMT_PublicPrivateKeyPair'])(
    'handles interruption after %s and an already absent object',
    async (operation) => {
      await recordCertificate(secrets, uuid, abandoned)
      fail = operation
      loseResponse = true
      expect((await recover()).errorMessage).not.toBe('')
      fail = undefined
      expect(await recover()).toEqual({ errorMessage: '' })
      expect(stored[`tls-provisioning/${uuid}`].certificates).toEqual([])
    }
  )

  it('reads all inventory pages before selecting a candidate', async () => {
    await recordCertificate(secrets, uuid, abandoned)
    pages = true
    expect(await recover()).toEqual({ errorMessage: '' })
    expect(ids('AMT_PublicKeyCertificate')).toEqual([
      'root',
      'active',
      'unknown'
    ])
  })

  it('rejects incomplete association evidence and leaves objects untouched', async () => {
    await recordCertificate(secrets, uuid, abandoned)
    inventory.CIM_CredentialContext.push({ ElementInContext: {} })
    expect((await recover()).errorMessage).not.toBe('')
    expect(deletes()).toEqual([])
  })

  it('does not delete before the replacement is persisted and associated with TLS', async () => {
    await recordCertificate(secrets, uuid, abandoned)
    stored[`devices/${uuid}`].TLS_ISSUED_CERTIFICATE = unknown
    expect((await recover()).errorMessage).not.toBe('')
    expect(deletes()).toEqual([])
  })

  it('does not install an identity if durable ownership persistence fails', async () => {
    secrets.writeSecretWithObject.mockResolvedValue(null)
    await expect(recordCertificate(secrets, uuid, abandoned)).rejects.toThrow('persist')
    expect(operations).toEqual([])
  })

  it('does not write ownership after cancellation during the journal read', async () => {
    const controller = new AbortController()
    const handler = new HttpHandler()
    handler.provisioning = { signal: controller.signal, pendingWrites: new Set() }
    let finishRead!: (value: any) => void
    secrets.getSecretAtPath.mockImplementationOnce(
      async () =>
        await new Promise((resolve) => {
          finishRead = resolve
        })
    )
    const recording = recordCertificate(secrets, uuid, abandoned, handler)
    const rejected = expect(recording).rejects.toThrow('Provisioning session ended')
    controller.abort()
    finishRead(null)
    await rejected
    expect(secrets.writeSecretWithObjectIfVersion).not.toHaveBeenCalled()
    expect(stored[`tls-provisioning/${uuid}`]).toBeUndefined()
  })

  it('does not overwrite concurrent journal updates', async () => {
    await recordCertificate(secrets, uuid, abandoned)
    secrets.writeSecretWithObject.mockResolvedValue(null)
    await expect(recordCertificate(secrets, uuid, replacement)).rejects.toThrow('persist')
    expect(stored[`tls-provisioning/${uuid}`].certificates).toEqual([abandoned])
  })

  it('reconciles repeated interruptions without increasing retained object counts', async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      await recordCertificate(secrets, uuid, abandoned)
      await recordCertificate(secrets, uuid, replacement)
      const before = {
        certificates: ids('AMT_PublicKeyCertificate'),
        keys: ids('AMT_PublicPrivateKeyPair'),
        tls: inventory.AMT_TLSCredentialContext
      }
      expect(await recover()).toEqual({ errorMessage: '' })
      const after = {
        certificates: ids('AMT_PublicKeyCertificate'),
        keys: ids('AMT_PublicPrivateKeyPair'),
        tls: inventory.AMT_TLSCredentialContext
      }
      expect(after).toEqual({ certificates: [
          'root',
          'active',
          'unknown'
        ], keys: ['active-key', 'unknown-key'], tls: before.tls })
      inventory.AMT_PublicKeyCertificate.splice(1, 0, certObject(abandoned, 'abandoned'))
      inventory.AMT_PublicPrivateKeyPair.unshift(keyObject(abandoned, 'old-key'))
    }
  })
  it('preserves keys when a new consumer appears between certificate and key deletion', async () => {
    await recordCertificate(secrets, uuid, abandoned)
    const original = invokeWsmanCallSpy.getMockImplementation()!
    invokeWsmanCallSpy.mockImplementation(async (input) => {
      const result = await original(input)
      if (input.xmlMessage.includes('/Delete') && input.xmlMessage.includes('AMT_PublicKeyCertificate')) {
        inventory.AMT_RemoteAccessCredentialContext.push(association('old-key'))
      }
      return result
    })
    expect(await recover()).toEqual({ errorMessage: '' })
    expect(deletes()).toEqual(['Delete:AMT_PublicKeyCertificate'])
  })

  it('does not delete if TLS is disabled despite a persisted leaf and credential context', async () => {
    await recordCertificate(secrets, uuid, abandoned)
    inventory.AMT_TLSSettingData = [{ Enabled: false }]
    expect((await recover()).errorMessage).not.toBe('')
    expect(deletes()).toEqual([])
  })

  it('matches AMT PKCS1 key encoding to the same stable public key', async () => {
    await recordCertificate(secrets, uuid, abandoned)
    inventory.AMT_PublicPrivateKeyPair[0].DERKey = new X509Certificate(abandoned).publicKey
      .export({ type: 'pkcs1', format: 'der' })
      .toString('base64')
    expect(await recover()).toEqual({ errorMessage: '' })
    expect(ids('AMT_PublicPrivateKeyPair')).not.toContain('old-key')
  })
  it('preserves objects when an association omits selector values', async () => {
    await recordCertificate(secrets, uuid, abandoned)
    inventory.CIM_CredentialContext.push({
      ElementInContext: { ReferenceParameters: { SelectorSet: {} } },
      ElementProvidingContext: reference('endpoint')
    })
    expect((await recover()).errorMessage).not.toBe('')
    expect(deletes()).toEqual([])
  })
  it('accepts the single-line issued PEM persisted by RPS during normal activation', async () => {
    const flattened = replacement.replace(/\r?\n/g, '')
    stored[`devices/${uuid}`].TLS_ISSUED_CERTIFICATE = flattened
    await recordCertificate(secrets, uuid, flattened)
    expect(await recover()).toEqual({ errorMessage: '' })
    expect(deletes()).toEqual([])
    expect(stored[`tls-provisioning/${uuid}`].certificates).toEqual([])
  })

  it('reconciles an interrupted identity when the persisted replacement is single-line PEM', async () => {
    stored[`devices/${uuid}`].TLS_ISSUED_CERTIFICATE = replacement.replace(/\r?\n/g, '')
    await recordCertificate(secrets, uuid, abandoned.replace(/\r?\n/g, ''))
    expect(await recover()).toEqual({ errorMessage: '' })
    expect(deletes()).toEqual(['Delete:AMT_PublicKeyCertificate', 'Delete:AMT_PublicPrivateKeyPair'])
    expect(ids('AMT_PublicKeyCertificate')).toEqual([
      'root',
      'active',
      'unknown'
    ])
  })
  it('uses a configured Microsoft CA root without requiring it on AMT', async () => {
    devices[uuid].ClientData = { payload: { profile: { profileName: 'microsoft' } } }
    stored['TLS/microsoft'] = { ROOT_CERTIFICATE: { pem: root } }
    inventory.AMT_PublicKeyCertificate = inventory.AMT_PublicKeyCertificate.filter((cert) => cert.InstanceID !== 'root')
    await recordCertificate(secrets, uuid, abandoned)
    expect(await recover()).toEqual({ errorMessage: '' })
    expect(deletes()).toEqual(['Delete:AMT_PublicKeyCertificate', 'Delete:AMT_PublicPrivateKeyPair'])
  })

  it('preserves pending objects if no trusted issuance chain is available', async () => {
    inventory.AMT_PublicKeyCertificate = inventory.AMT_PublicKeyCertificate.filter((cert) => cert.InstanceID !== 'root')
    await recordCertificate(secrets, uuid, abandoned)
    await recordCertificate(secrets, uuid, replacement)
    expect(await recover()).toEqual({ errorMessage: '' })
    expect(deletes()).toEqual([])
    expect(stored[`tls-provisioning/${uuid}`].certificates).toEqual([abandoned])
  })

  it('verifies an intermediate-issued replacement against its configured chain', async () => {
    const intermediate = forge.pki.certificateFromPem(issue(3, '06', true))
    intermediate.setSubject([{ name: 'commonName', value: 'intermediate' }])
    intermediate.sign(keys[0].privateKey, forge.md.sha256.create())
    const leaf = forge.pki.certificateFromPem(replacement)
    leaf.setIssuer(intermediate.subject.attributes)
    leaf.sign(keys[3].privateKey, forge.md.sha256.create())
    const pem = forge.pki.certificateToPem(leaf)
    devices[uuid].ClientData = { payload: { profile: { profileName: 'microsoft' } } }
    stored['TLS/microsoft'] = { ROOT_CERTIFICATE: { pem: forge.pki.certificateToPem(intermediate) + root } }
    stored[`devices/${uuid}`].TLS_ISSUED_CERTIFICATE = pem
    inventory.AMT_PublicKeyCertificate[2] = certObject(pem, 'active')
    inventory.AMT_PublicKeyCertificate = inventory.AMT_PublicKeyCertificate.filter((cert) => cert.InstanceID !== 'root')
    await recordCertificate(secrets, uuid, abandoned)
    expect(await recover()).toEqual({ errorMessage: '' })
    expect(deletes()).toEqual(['Delete:AMT_PublicKeyCertificate', 'Delete:AMT_PublicPrivateKeyPair'])
  })

  it('rejects an invalid replacement signature despite a configured root', async () => {
    const leaf = forge.pki.certificateFromPem(replacement)
    leaf.sign(keys[3].privateKey, forge.md.sha256.create())
    const pem = forge.pki.certificateToPem(leaf)
    stored[`devices/${uuid}`].TLS_ISSUED_CERTIFICATE = pem
    inventory.AMT_PublicKeyCertificate[2] = certObject(pem, 'active')
    await recordCertificate(secrets, uuid, abandoned)
    expect((await recover()).errorMessage).toContain('cannot be verified')
    expect(deletes()).toEqual([])
    expect(stored[`tls-provisioning/${uuid}`].certificates).toEqual([abandoned])
  })

  it.each([false, true])('preserves the journal after deactivation (TLS expected: %s)', async (tlsExpected) => {
    await recordCertificate(secrets, uuid, abandoned)
    delete stored[`devices/${uuid}`]
    const actor = createActor(new TLSCleanup().machine, { input: { ...input(), tlsExpected } })
    actor.start()
    const result = await toPromise(actor)
    if (tlsExpected) expect(result.errorMessage).toContain('No persisted TLS identity for cleanup')
    else expect(result).toEqual({ errorMessage: '' })
    expect(operations).toEqual([])
    expect(stored[`tls-provisioning/${uuid}`].certificates).toEqual([abandoned])
  })

  it('preserves journaled objects when provisioning is not serialized by the provider', async () => {
    await recordCertificate(secrets, uuid, abandoned)
    devices[uuid].cleanupAllowed = false
    expect(await recover()).toEqual({ errorMessage: '' })
    expect(operations).toEqual([])
    expect(stored[`tls-provisioning/${uuid}`].certificates).toEqual([abandoned])
  })

  it.each([false, true])('preserves objects without conditional writes (existing journal: %s)', async (existing) => {
    if (existing) await recordCertificate(secrets, uuid, abandoned)
    delete secrets.writeSecretWithObjectIfVersion
    secrets.writeSecretWithObject.mockClear()
    await recordCertificate(secrets, uuid, replacement)
    expect(secrets.writeSecretWithObject).not.toHaveBeenCalled()
    expect(await recover()).toEqual({ errorMessage: '' })
    expect(operations).toEqual([])
    if (existing) expect(stored[`tls-provisioning/${uuid}`].certificates).toEqual([abandoned])
  })
})
