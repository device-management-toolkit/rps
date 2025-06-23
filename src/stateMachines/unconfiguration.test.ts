/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { randomUUID } from 'node:crypto'
import { devices } from '../devices.js'
import { Environment } from '../utils/Environment.js'
import {
  type Unconfiguration as UnconfigurationType,
  type UnconfigContext as UnconfigContextType,
  type UnconfigEvent
} from './unconfiguration.js'
import { config } from '../test/helper/Config.js'
import { HttpHandler } from '../HttpHandler.js'
import { type MachineImplementationsSimplified, createActor, fromPromise } from 'xstate'
import { AMT, CIM, IPS } from '@device-management-toolkit/wsman-messages'
import { jest } from '@jest/globals'
import { HttpResponseError, coalesceMessage, isDigestRealmValid } from './common.js'

const invokeWsmanCallSpy = jest.fn<any>().mockResolvedValue({})
const invokeEnterpriseAssistantCallSpy = jest.fn()
jest.unstable_mockModule('./common.js', () => ({
  invokeWsmanCall: invokeWsmanCallSpy,
  invokeEnterpriseAssistantCall: invokeEnterpriseAssistantCallSpy,
  HttpResponseError,
  isDigestRealmValid,
  coalesceMessage
}))
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
    jest.clearAllMocks()
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
      ClientSocket: { send: jest.fn() } as any,
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
        is8021xProfileEnabled: () => false
      },
      delays: {}
    }
    loggerSpy = jest.spyOn(unconfiguration.logger, 'error')
  })

  it('should eventually reach FAILURE after ENUMERATE_WIFI_ENDPOINT_SETTINGS', (done) => {
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
    service.subscribe((state) => {
      const expectedState: any = flowStates[currentStateIndex++]
      expect(state.matches(expectedState)).toBe(true)
      if (state.matches('FAILURE') && currentStateIndex === flowStates.length) {
        done()
      }
    })
    service.start()
    service.send({ type: 'REMOVECONFIG', clientId })
  })

  it('should eventually reach FAILURE after ENUMERATE_MANAGEMENT_PRESENCE_REMOTE_SAP', (done) => {
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
      'REMOVE_REMOTE_ACCESS_POLICY_RULE_USER_INITIATED',
      'REMOVE_REMOTE_ACCESS_POLICY_RULE_ALERT',
      'REMOVE_REMOTE_ACCESS_POLICY_RULE_PERIODIC',
      'ENUMERATE_MANAGEMENT_PRESENCE_REMOTE_SAP',
      'FAILURE'
    ]
    const service = createActor(mockUnconfigurationMachine, { input: unconfigContext })
    service.subscribe((state) => {
      const expectedState: any = flowStates[currentStateIndex++]
      expect(state.matches(expectedState)).toBe(true)
      if (state.matches('FAILURE') && currentStateIndex === flowStates.length) {
        done()
      }
    })
    service.start()
    service.send({ type: 'REMOVECONFIG', clientId })
  })

  it('should eventually reach FAILURE after REMOVE_REMOTE_ACCESS_POLICY_RULE_USER_INITIATED', (done) => {
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
    service.subscribe((state) => {
      const expectedState: any = flowStates[currentStateIndex++]
      expect(state.matches(expectedState)).toBe(true)
      if (state.matches('FAILURE') && currentStateIndex === flowStates.length) {
        done()
      }
    })
    service.start()
    service.send({ type: 'REMOVECONFIG', clientId })
  })
  it('should eventually reach FAILURE after PULL_MANAGEMENT_PRESENCE_REMOTE_SAP', (done) => {
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
      'REMOVE_REMOTE_ACCESS_POLICY_RULE_USER_INITIATED',
      'REMOVE_REMOTE_ACCESS_POLICY_RULE_ALERT',
      'REMOVE_REMOTE_ACCESS_POLICY_RULE_PERIODIC',
      'ENUMERATE_MANAGEMENT_PRESENCE_REMOTE_SAP',
      'PULL_MANAGEMENT_PRESENCE_REMOTE_SAP',
      'FAILURE'
    ]
    const service = createActor(mockUnconfigurationMachine, { input: unconfigContext })
    service.subscribe((state) => {
      const expectedState: any = flowStates[currentStateIndex++]
      expect(state.matches(expectedState)).toBe(true)
      if (state.matches('FAILURE') && currentStateIndex === flowStates.length) {
        done()
      }
    })
    service.start()
    service.send({ type: 'REMOVECONFIG', clientId })
  })

  it('should eventually reach FAILURE after ENUMERATE_TLS_SETTING_DATA', (done) => {
    configuration.actors!.enumerateTLSSettingData = fromPromise(async ({ input }) => await Promise.reject(new Error()))
    const mockUnconfigurationMachine = unconfiguration.machine.provide(configuration)
    const flowStates = [
      'UNCONFIGURED',
      'ENUMERATE_ETHERNET_PORT_SETTINGS',
      'PULL_ETHERNET_PORT_SETTINGS',
      'GET_8021X_PROFILE',
      'ENUMERATE_WIFI_ENDPOINT_SETTINGS',
      'PULL_WIFI_ENDPOINT_SETTINGS',
      'REMOVE_REMOTE_ACCESS_POLICY_RULE_USER_INITIATED',
      'REMOVE_REMOTE_ACCESS_POLICY_RULE_ALERT',
      'REMOVE_REMOTE_ACCESS_POLICY_RULE_PERIODIC',
      'ENUMERATE_MANAGEMENT_PRESENCE_REMOTE_SAP',
      'PULL_MANAGEMENT_PRESENCE_REMOTE_SAP',
      'ENUMERATE_TLS_SETTING_DATA',
      'FAILURE'
    ]
    const service = createActor(mockUnconfigurationMachine, { input: unconfigContext })
    service.subscribe((state) => {
      const expectedState: any = flowStates[currentStateIndex++]
      expect(state.matches(expectedState)).toBe(true)
      if (state.matches('FAILURE') && currentStateIndex === flowStates.length) {
        done()
      }
    })
    service.start()
    service.send({ type: 'REMOVECONFIG', clientId })
  })

  it('should eventually reach FAILURE after PULL_TLS_SETTING_DATA', (done) => {
    configuration.actors!.pullTLSSettingData = fromPromise(async ({ input }) => await Promise.reject(new Error()))
    const mockUnconfigurationMachine = unconfiguration.machine.provide(configuration)
    const flowStates = [
      'UNCONFIGURED',
      'ENUMERATE_ETHERNET_PORT_SETTINGS',
      'PULL_ETHERNET_PORT_SETTINGS',
      'GET_8021X_PROFILE',
      'ENUMERATE_WIFI_ENDPOINT_SETTINGS',
      'PULL_WIFI_ENDPOINT_SETTINGS',
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
    service.subscribe((state) => {
      const expectedState: any = flowStates[currentStateIndex++]
      expect(state.matches(expectedState)).toBe(true)
      if (state.matches('FAILURE') && currentStateIndex === flowStates.length) {
        done()
      }
    })
    service.start()
    service.send({ type: 'REMOVECONFIG', clientId })
  })

  it('should eventually reach FAILURE after ENUMERATE_PUBLIC_KEY_CERTIFICATE', (done) => {
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
    service.subscribe((state) => {
      const expectedState: any = flowStates[currentStateIndex++]
      expect(state.matches(expectedState)).toBe(true)
      if (state.matches('FAILURE') && currentStateIndex === flowStates.length) {
        done()
      }
    })
    service.start()
    service.send({ type: 'REMOVECONFIG', clientId })
  })

  it('should eventually reach FAILURE after PULL_PUBLIC_KEY_CERTIFICATE', (done) => {
    configuration.actors!.pullPublicKeyCertificate = fromPromise(async ({ input }) => await Promise.reject(new Error()))
    const mockUnconfigurationMachine = unconfiguration.machine.provide(configuration)
    const flowStates = [
      'UNCONFIGURED',
      'ENUMERATE_ETHERNET_PORT_SETTINGS',
      'PULL_ETHERNET_PORT_SETTINGS',
      'GET_8021X_PROFILE',
      'ENUMERATE_WIFI_ENDPOINT_SETTINGS',
      'PULL_WIFI_ENDPOINT_SETTINGS',
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
    service.subscribe((state) => {
      const expectedState: any = flowStates[currentStateIndex++]
      expect(state.matches(expectedState)).toBe(true)
      if (state.matches('FAILURE') && currentStateIndex === flowStates.length) {
        done()
      }
    })
    service.start()
    service.send({ type: 'REMOVECONFIG', clientId })
  })

  it('should eventually reach FAILURE after ENUMERATE_PUBLIC_KEY_CERTIFICATE', (done) => {
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
    service.subscribe((state) => {
      const expectedState: any = flowStates[currentStateIndex++]
      expect(state.matches(expectedState)).toBe(true)
      if (state.matches('FAILURE') && currentStateIndex === flowStates.length) {
        done()
      }
    })
    service.start()
    service.send({ type: 'REMOVECONFIG', clientId })
  })

  it('should eventually reach FAILURE after GET_ENVIRONMENT_DETECTION_SETTINGS', (done) => {
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
    service.subscribe((state) => {
      const expectedState: any = flowStates[currentStateIndex++]
      expect(state.matches(expectedState)).toBe(true)
      if (state.matches('FAILURE') && currentStateIndex === flowStates.length) {
        done()
      }
    })
    service.start()
    service.send({ type: 'REMOVECONFIG', clientId })
  })
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
})
