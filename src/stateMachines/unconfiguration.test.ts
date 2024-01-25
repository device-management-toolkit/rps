/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

// import { type Unconfiguration as UnconfigurationType, type UnconfigContext as UnconfigContextType } from './unconfiguration.js'
import { randomUUID } from 'node:crypto'
import { devices } from '../devices.js'
import { Environment } from '../utils/Environment.js'
import { type Unconfiguration as UnconfigurationType, type UnconfigContext as UnconfigContextType } from './unconfiguration.js'
import { config } from '../test/helper/Config.js'
import { HttpHandler } from '../HttpHandler.js'
import { interpret } from 'xstate'
import { AMT, CIM, IPS } from '@open-amt-cloud-toolkit/wsman-messages'
import { jest } from '@jest/globals'
import { type SpyInstance, spyOn } from 'jest-mock'

const invokeWsmanCallSpy = jest.fn()
const invokeEnterpriseAssistantCallSpy = jest.fn()
jest.unstable_mockModule('./common.js', () => ({
  invokeWsmanCall: invokeWsmanCallSpy,
  invokeEnterpriseAssistantCall: invokeEnterpriseAssistantCallSpy
}))
const { Unconfiguration } = await import('./unconfiguration.js')
const { MPSType } = await import('./ciraConfiguration.js')

const clientId = randomUUID()
Environment.Config = config

describe('Unconfiguration State Machine', () => {
  let unconfiguration: UnconfigurationType
  let currentStateIndex: number
  let remoteAccessPolicyRuleSpy: SpyInstance<any>
  let unconfigContext: UnconfigContextType
  let configuration
  beforeEach(() => {
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
      tlsSettingData: [],
      publicKeyCertificates: [],
      amt: new AMT.Messages(),
      ips: new IPS.Messages(),
      cim: new CIM.Messages(),
      wiredSettings: null,
      wifiSettings: null
    }
    remoteAccessPolicyRuleSpy = spyOn(unconfigContext.amt.RemoteAccessPolicyRule, 'Delete').mockReturnValue('abcdef')
    devices[clientId] = {
      unauthCount: 0,
      ClientId: clientId,
      ClientSocket: { send: jest.fn() } as any,
      ciraconfig: { TLSSettingData: { Enabled: true, AcceptNonSecureConnections: true, MutualAuthentication: true, TrustedCN: null } },
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
    }
    currentStateIndex = 0
    configuration = {
      services: {
        'error-machine': Promise.resolve({ clientId }),
        'enumerate-ethernet-port-settings': Promise.resolve({
          Envelope: {
            Body: { EnumerateResponse: { EnumerationContext: '09000000-0000-0000-0000-000000000000' } }
          }
        }),
        'pull-ethernet-port-settings': Promise.resolve({
          Envelope: {
            Body: {
              PullResponse: {
                Items: {
                  AMT_EthernetPortSettings: [
                    { DHCPEnabled: true, ElementName: 'Intel(r) AMT Ethernet Port Settings', InstanceID: 'Intel(r) AMT Ethernet Port Settings 0', IpSyncEnabled: false, MACAddress: '00-00-00-02-00-05' },
                    { ElementName: 'Intel(r) AMT Ethernet Port Settings', InstanceID: 'Intel(r) AMT Ethernet Port Settings 1', MACAddress: '00-00-00-02-00-05' }
                  ]
                }
              }
            }
          }
        }),
        'get-8021x-profile': Promise.resolve({ clientId }),
        'disable-Wired-8021x-Configuration': Promise.resolve({ clientId }),
        'enumerate-wifi-endpoint-settings': async (_, event) => await Promise.resolve({ clientId: event.clientId }),
        'pull-wifi-endpoint-settings': Promise.resolve({ Envelope: { Body: { PullResponse: { Items: { CIM_WiFiEndpointSettings: null } } } } }),
        'delete-wifi-endpoint-settings': Promise.resolve({ clientId }),
        'remove-remote-access-policy-rule-user-initiated': Promise.resolve({ clientId }),
        'remove-remote-access-policy-rule-rule-alert': Promise.resolve({ clientId }),
        'remove-remote-access-policy-rule-periodic': Promise.resolve({ clientId }),
        'enumerate-management-presence-remote-sap': Promise.resolve({ clientId }),
        'pull-management-presence-remote-sap': Promise.resolve({ clientId }),
        'delete-management-presence-remote-sap': Promise.resolve({ clientId }),
        'enumerate-tls-setting-data': Promise.resolve({ clientId }),
        'pull-tls-setting-data': Promise.resolve({ clientId }),
        'disable-tls-setting-data': Promise.resolve({ clientId }),
        'disable-tls-setting-data-2': Promise.resolve({ clientId }),
        'setup-and-configuration-service-commit-changes': Promise.resolve({ clientId }),
        'enumerate-tls-credential-context': Promise.resolve({ clientId }),
        'pull-tls-credential-context': Promise.resolve({ clientId }),
        'delete-tls-credential-context': Promise.resolve({ clientId }),
        'enumerate-public-private-key-pair': Promise.resolve({ clientId }),
        'pull-public-private-key-pair': Promise.resolve({ clientId }),
        'delete-public-private-key-pair': Promise.resolve({ clientId }),
        'get-environment-detection-settings': Promise.resolve({ clientId }),
        'clear-environment-detection-settings': Promise.resolve({ clientId }),
        'enumerate-public-key-certificate': Promise.resolve({ clientId }),
        'put-environment-detection-settings': Promise.resolve({ clientId }),
        'pull-public-key-certificate': Promise.resolve({ Envelope: { Body: { PullResponse: { Items: { AMT_PublicKeyCertificate: [{}] } } } } })
      },
      actions: {
        'Reset Unauth Count': () => { }
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
      }
    }
  })

  it('should eventually reach "FAILURE" after "ENUMERATE_WIFI_ENDPOINT_SETTINGS"', (done) => {
    configuration.services['pull-ethernet-port-settings'] = Promise.resolve({ Envelope: { Body: { PullResponse: { Items: { AMT_EthernetPortSettings: [{ ElementName: 'Ethernet Settings', InstanceID: 'Settings 0' }, { ElementName: 'Ethernet Settings', InstanceID: 'Settings 1', MACAddress: '00-00-00-02-00-05' }] } } } } })
    configuration.services['enumerate-wifi-endpoint-settings'] = Promise.reject(new Error())
    const mockUnconfigurationMachine = unconfiguration.machine.withConfig(configuration).withContext(unconfigContext)
    const flowStates = [
      'UNCONFIGURED',
      'ENUMERATE_ETHERNET_PORT_SETTINGS',
      'PULL_ETHERNET_PORT_SETTINGS',
      'ENUMERATE_WIFI_ENDPOINT_SETTINGS',
      'FAILURE']
    const service = interpret(mockUnconfigurationMachine).onTransition((state) => {
      expect(state.matches(flowStates[currentStateIndex++])).toBe(true)
      if (state.matches('FAILURE') && currentStateIndex === flowStates.length) {
        done()
      }
    })
    service.start()
    service.send({ type: 'REMOVECONFIG', clientId })
  })

  it('should eventually reach "FAILURE" after "ENUMERATE_MANAGEMENT_PRESENCE_REMOTE_SAP"', (done) => {
    configuration.services['enumerate-management-presence-remote-sap'] = Promise.reject(new Error())
    const mockUnconfigurationMachine = unconfiguration.machine.withConfig(configuration).withContext(unconfigContext)
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
      'FAILURE']
    const service = interpret(mockUnconfigurationMachine).onTransition((state) => {
      expect(state.matches(flowStates[currentStateIndex++])).toBe(true)
      if (state.matches('FAILURE') && currentStateIndex === flowStates.length) {
        done()
      }
    })
    service.start()
    service.send({ type: 'REMOVECONFIG', clientId })
  })

  it('should eventually reach "FAILURE" after "PULL_MANAGEMENT_PRESENCE_REMOTE_SAP"', (done) => {
    configuration.guards.is8021xProfileEnabled = () => true
    configuration.services['pull-management-presence-remote-sap'] = Promise.reject(new Error())
    const mockUnconfigurationMachine = unconfiguration.machine.withConfig(configuration).withContext(unconfigContext)
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
      'FAILURE']
    const service = interpret(mockUnconfigurationMachine).onTransition((state) => {
      expect(state.matches(flowStates[currentStateIndex++])).toBe(true)
      if (state.matches('FAILURE') && currentStateIndex === flowStates.length) {
        done()
      }
    })
    service.start()
    service.send({ type: 'REMOVECONFIG', clientId })
  })

  it('should eventually reach "FAILURE" after "ENUMERATE_TLS_SETTING_DATA"', (done) => {
    configuration.services['enumerate-tls-setting-data'] = Promise.reject(new Error())
    const mockUnconfigurationMachine = unconfiguration.machine.withConfig(configuration).withContext(unconfigContext)
    const flowStates = ['UNCONFIGURED',
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
      'FAILURE']
    const service = interpret(mockUnconfigurationMachine).onTransition((state) => {
      expect(state.matches(flowStates[currentStateIndex++])).toBe(true)
      if (state.matches('FAILURE') && currentStateIndex === flowStates.length) {
        done()
      }
    })
    service.start()
    service.send({ type: 'REMOVECONFIG', clientId })
  })

  it('should eventually reach "FAILURE" after "PULL_TLS_SETTING_DATA"', (done) => {
    configuration.services['pull-tls-setting-data'] = Promise.reject(new Error())
    const mockUnconfigurationMachine = unconfiguration.machine.withConfig(configuration).withContext(unconfigContext)
    const flowStates = ['UNCONFIGURED',
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
      'FAILURE']
    const service = interpret(mockUnconfigurationMachine).onTransition((state) => {
      expect(state.matches(flowStates[currentStateIndex++])).toBe(true)
      if (state.matches('FAILURE') && currentStateIndex === flowStates.length) {
        done()
      }
    })
    service.start()
    service.send({ type: 'REMOVECONFIG', clientId })
  })

  it('should eventually reach "FAILURE" after "ENUMERATE_PUBLIC_KEY_CERTIFICATE"', (done) => {
    configuration.services['enumerate-public-key-certificate'] = Promise.reject(new Error())
    const mockUnconfigurationMachine = unconfiguration.machine.withConfig(configuration).withContext(unconfigContext)
    const flowStates = ['UNCONFIGURED',
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
      'FAILURE']
    const service = interpret(mockUnconfigurationMachine).onTransition((state) => {
      expect(state.matches(flowStates[currentStateIndex++])).toBe(true)
      if (state.matches('FAILURE') && currentStateIndex === flowStates.length) {
        done()
      }
    })
    service.start()
    service.send({ type: 'REMOVECONFIG', clientId })
  })

  it('should eventually reach "FAILURE" after "PULL_PUBLIC_KEY_CERTIFICATE"', (done) => {
    configuration.services['pull-public-key-certificate'] = Promise.reject(new Error())
    const mockUnconfigurationMachine = unconfiguration.machine.withConfig(configuration).withContext(unconfigContext)
    const flowStates = ['UNCONFIGURED',
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
      'FAILURE']
    const service = interpret(mockUnconfigurationMachine).onTransition((state) => {
      expect(state.matches(flowStates[currentStateIndex++])).toBe(true)
      if (state.matches('FAILURE') && currentStateIndex === flowStates.length) {
        done()
      }
    })
    service.start()
    service.send({ type: 'REMOVECONFIG', clientId })
  })

  it('should eventually reach "FAILURE" after "GET_ENVIRONMENT_DETECTION_SETTINGS"', (done) => {
    configuration.services['get-environment-detection-settings'] = Promise.reject(new Error())
    const mockUnconfigurationMachine = unconfiguration.machine.withConfig(configuration).withContext(unconfigContext)
    const flowStates = ['UNCONFIGURED',
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
      'FAILURE']
    const service = interpret(mockUnconfigurationMachine).onTransition((state) => {
      expect(state.matches(flowStates[currentStateIndex++])).toBe(true)
      if (state.matches('FAILURE') && currentStateIndex === flowStates.length) {
        done()
      }
    })
    service.start()
    service.send({ type: 'REMOVECONFIG', clientId })
  })

  it('should eventually reach "SUCCESS"', (done) => {
    configuration.guards = {
      is8021xProfileEnabled: () => false
    }
    const fault = { statusCode: 400 }
    configuration.services['remove-remote-access-policy-rule-user-initiated'] = Promise.reject(fault)
    configuration.services['remove-remote-access-policy-rule-rule-alert'] = Promise.reject(fault)
    configuration.services['remove-remote-access-policy-rule-periodic'] = Promise.reject(fault)
    configuration.services['pull-management-presence-remote-sap'] = Promise.resolve({ Envelope: { Body: { PullResponse: { Items: { AMT_ManagementPresenceRemoteSAP: { Name: 'mps server name' } } } } } })
    configuration.services['pull-tls-setting-data'] = Promise.resolve({ Envelope: { Body: { PullResponse: { Items: { AMT_TLSSettingData: [{ Enabled: false }, { Enabled: false }] } } } } })
    configuration.services['pull-public-key-certificate'] = Promise.resolve({ Envelope: { Body: { PullResponse: { Items: { AMT_PublicKeyCertificate: { InstanceID: 'abcd' } } } } } })
    configuration.services['get-environment-detection-settings'] = Promise.resolve({ Envelope: { Body: { AMT_EnvironmentDetectionSettingData: { DetectionStrings: 'abcde' } } } })
    const mockUnconfigurationMachine = unconfiguration.machine.withConfig(configuration).withContext(unconfigContext)
    const flowStates = ['UNCONFIGURED',
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
      'DELETE_MANAGEMENT_PRESENCE_REMOTE_SAP',
      'ENUMERATE_TLS_SETTING_DATA',
      'PULL_TLS_SETTING_DATA',
      'ENUMERATE_PUBLIC_KEY_CERTIFICATE',
      'PULL_PUBLIC_KEY_CERTIFICATE',
      'DELETE_PUBLIC_KEY_CERTIFICATE',
      'GET_ENVIRONMENT_DETECTION_SETTINGS',
      'CLEAR_ENVIRONMENT_DETECTION_SETTINGS',
      'SUCCESS']
    const service = interpret(mockUnconfigurationMachine).onTransition((state) => {
      expect(state.matches(flowStates[currentStateIndex++])).toBe(true)
      if (state.matches('SUCCESS') && currentStateIndex === flowStates.length) {
        const status = devices[clientId].status.CIRAConnection
        expect(status).toEqual('unconfigured')
        done()
      }
    })
    service.start()
    service.send({ type: 'REMOVECONFIG', clientId })
  })
  it('should eventually reach "FAILURE" after "SETUP_AND_CONFIGURATION_SERVICE_COMMIT_CHANGES"', (done) => {
    unconfigContext.tlsSettingData = [{ Enabled: false }, { Enabled: true }]
    configuration.guards = {
      isExpectedBadRequest: () => false,
      tlsSettingDataEnabled: () => true,
      hasMPSEntries: () => false,
      hasPublicKeyCertificate: () => false,
      hasEnvSettings: () => false,
      is8021xProfileEnabled: () => false
    }
    configuration.services['disable-tls-setting-data-2'] = Promise.resolve({ Envelope: { Body: { AMT_TLSSettingData: { ElementName: 'Intel(r) AMT LMS TLS Settings' } } } })
    configuration.services['disable-tls-setting-data'] = Promise.resolve({ Envelope: { Body: { AMT_TLSSettingData: { ElementName: 'Intel(r) AMT 802.3 TLS Settings' } } } })
    configuration.services['pull-tls-credential-context'] = Promise.resolve({ Envelope: { Body: { PullResponse: { Items: { AMT_TLSCredentialContext: null } } } } })
    configuration.services['setup-and-configuration-service-commit-changes'] = Promise.reject(new Error())
    const mockUnconfigurationMachine = unconfiguration.machine.withConfig(configuration).withContext(unconfigContext)
    const flowStates = ['UNCONFIGURED',
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
      'DISABLE_TLS_SETTING_DATA',
      'DISABLE_TLS_SETTING_DATA_2',
      'SETUP_AND_CONFIGURATION_SERVICE_COMMIT_CHANGES',
      'FAILURE']
    const service = interpret(mockUnconfigurationMachine).onTransition((state) => {
      expect(state.matches(flowStates[currentStateIndex++])).toBe(true)
      if (state.matches('FAILURE') && currentStateIndex === flowStates.length) {
        done()
      }
    })
    service.start()
    service.send({ type: 'REMOVECONFIG', clientId })
  })

  it('should eventually reach "FAILURE" after "DELETE_MANAGEMENT_PRESENCE_REMOTE_SAP"', (done) => {
    configuration.guards = {
      is8021xProfileEnabled: () => false
    }
    const fault = { statusCode: 400 }
    configuration.services['remove-remote-access-policy-rule-user-initiated'] = Promise.reject(fault)
    configuration.services['remove-remote-access-policy-rule-rule-alert'] = Promise.reject(fault)
    configuration.services['remove-remote-access-policy-rule-periodic'] = Promise.reject(fault)
    configuration.services['pull-management-presence-remote-sap'] = Promise.resolve({ Envelope: { Body: { PullResponse: { Items: { AMT_ManagementPresenceRemoteSAP: { Name: 'abcd' } } } } } })
    configuration.services['delete-management-presence-remote-sap'] = Promise.reject(new Error())
    const mockUnconfigurationMachine = unconfiguration.machine.withConfig(configuration).withContext(unconfigContext)
    const flowStates = ['UNCONFIGURED',
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
      'DELETE_MANAGEMENT_PRESENCE_REMOTE_SAP',
      'FAILURE']
    const service = interpret(mockUnconfigurationMachine).onTransition((state) => {
      expect(state.matches(flowStates[currentStateIndex++])).toBe(true)
      if (state.matches('FAILURE') && currentStateIndex === flowStates.length) {
        done()
      }
    })
    service.start()
    service.send({ type: 'REMOVECONFIG', clientId })
  })

  describe('Ethernet Port Settings', () => {
    it('should enumerate ethernet port settings', async () => {
      const ethernetPortSettingsSpy = spyOn(unconfigContext.amt.EthernetPortSettings, 'Enumerate').mockImplementation(() => 'abcdef')
      await unconfiguration.enumerateEthernetPortSettings(unconfigContext)
      expect(ethernetPortSettingsSpy).toHaveBeenCalled()
      expect(invokeWsmanCallSpy).toHaveBeenCalled()
    })
    it('should pull ethernet port settings', async () => {
      unconfigContext.message = {
        Envelope: {
          Header: {},
          Body: {
            EnumerateResponse: {
              EnumerationContext: '09000000-0000-0000-0000-000000000000'
            }
          }
        }
      }
      const ethernetPortSettingsSpy = spyOn(unconfigContext.amt.EthernetPortSettings, 'Pull').mockImplementation(() => 'abcdef')
      await unconfiguration.pullEthernetPortSettings(unconfigContext)
      expect(ethernetPortSettingsSpy).toHaveBeenCalled()
      expect(invokeWsmanCallSpy).toHaveBeenCalled()
    })
    it('should read ethernet port settings pull response', () => {
      unconfigContext.message = {
        Envelope: {
          Header: {},
          Body: {
            PullResponse: {
              Items: {
                AMT_EthernetPortSettings: [
                  {
                    DHCPEnabled: true,
                    ElementName: 'Intel(r) AMT Ethernet Port Settings',
                    InstanceID: 'Intel(r) AMT Ethernet Port Settings 0',
                    IpSyncEnabled: false
                  },
                  {
                    ElementName: 'Intel(r) AMT Ethernet Port Settings',
                    InstanceID: 'Intel(r) AMT Ethernet Port Settings 1',
                    MACAddress: '00-00-00-00-00-00'
                  }
                ]
              },
              EndOfSequence: ''
            }
          }
        }
      }
      unconfiguration.readEthernetPortSettings(unconfigContext, null)
      expect(unconfigContext.wiredSettings).toBeDefined()
      expect(unconfigContext.wifiSettings).toBeDefined()
    })
    it('should read ethernet port settings pull response', () => {
      unconfigContext.message = {
        Envelope: {
          Header: {},
          Body: {
            PullResponse: {
              Items: {
                AMT_EthernetPortSettings: [
                  {
                    ElementName: 'Intel(r) AMT Ethernet Port Settings',
                    InstanceID: 'Intel(r) AMT Ethernet Port Settings 1'
                  },
                  {
                    DHCPEnabled: true,
                    ElementName: 'Intel(r) AMT Ethernet Port Settings',
                    InstanceID: 'Intel(r) AMT Ethernet Port Settings 0',
                    IpSyncEnabled: false
                  }
                ]
              }
            }
          }
        }
      }
      unconfiguration.readEthernetPortSettings(unconfigContext, null)
      expect(unconfigContext.wiredSettings).toBeDefined()
      expect(unconfigContext.wifiSettings).toBeDefined()
    })
    it('should read ethernet port settings pull response for wireless only device', () => {
      unconfigContext.wiredSettings = null
      unconfigContext.message = {
        Envelope: {
          Header: {},
          Body: {
            PullResponse: {
              Items: {
                AMT_EthernetPortSettings: {
                  ElementName: 'Intel(r) AMT Ethernet Port Settings',
                  InstanceID: 'Intel(r) AMT Ethernet Port Settings 1'
                }
              }
            }
          }
        }
      }
      unconfiguration.readEthernetPortSettings(unconfigContext, null)
      expect(unconfigContext.wiredSettings).toBeNull()
      expect(unconfigContext.wifiSettings).toBeDefined()
    })
    it('should read ethernet port settings pull response for wired only device', () => {
      unconfigContext.message = {
        Envelope: {
          Header: {},
          Body: {
            PullResponse: {
              Items: {
                AMT_EthernetPortSettings: {
                  ElementName: 'Intel(r) AMT Ethernet Port Settings',
                  InstanceID: 'Intel(r) AMT Ethernet Port Settings 0'
                }
              }
            }
          }
        }
      }
      unconfiguration.readEthernetPortSettings(unconfigContext, null)
      expect(unconfigContext.wifiSettings).toBeNull()
      expect(unconfigContext.wiredSettings).toBeDefined()
    })
  })

  describe('unconfiguration of Wired 802.1x configuration ', () => {
    it('should send a WSMan call to get 802.1x Profile', async () => {
      await unconfiguration.get8021xProfile(unconfigContext, null)
      expect(invokeWsmanCallSpy).toHaveBeenCalled()
    })
    it('should disable wired 802.1x configuration', async () => {
      unconfigContext.message = {
        Envelope: {
          Body: {
            IPS_IEEE8021xSettings: {
              Username: 'abc',
              AuthenticationProtocol: 0,
              Enabled: true
            }
          }
        }
      }
      await unconfiguration.disableWired8021xConfiguration(unconfigContext, null)
      expect(invokeWsmanCallSpy).toHaveBeenCalled()
    })
  })

  describe('send wsman message with Remote Access Policy Rule', () => {
    it('should send to wsman message remove Remote Access Policy Rule User Initiated call', async () => {
      await unconfiguration.removeRemoteAccessPolicyRuleUserInitiated(unconfigContext, null)
      expect(invokeWsmanCallSpy).toHaveBeenCalled()
      expect(remoteAccessPolicyRuleSpy).toHaveBeenCalled()
    })

    it('should send to wsman message remove Remote Access Policy Rule Alert', async () => {
      await unconfiguration.removeRemoteAccessPolicyRuleAlert(unconfigContext, null)
      expect(invokeWsmanCallSpy).toHaveBeenCalled()
    })

    it('should send to wsman message remove Remote Access Policy Rule Periodic', async () => {
      await unconfiguration.removeRemoteAccessPolicyRulePeriodic(unconfigContext, null)
      expect(invokeWsmanCallSpy).toHaveBeenCalled()
      expect(remoteAccessPolicyRuleSpy).toHaveBeenCalled()
    })
  })

  describe('send wsman message with Management Presence Remote SAP', () => {
    it('should send wsman message to enumerate ManagementPresenceRemoteSAP', async () => {
      await unconfiguration.enumerateManagementPresenceRemoteSAP(unconfigContext, null)
      expect(invokeWsmanCallSpy).toHaveBeenCalled()
    })

    it('should send wsman message to pull ManagementPresenceRemoteSAP', async () => {
      unconfigContext.message = {
        Envelope: { Body: { EnumerateResponse: { EnumerationContext: 'abcd' } } }
      }
      await unconfiguration.pullManagementPresenceRemoteSAP(unconfigContext, null)
      expect(invokeWsmanCallSpy).toHaveBeenCalled()
    })

    it('should send to delete RemoteAccessService', async () => {
      unconfigContext.message = {
        Envelope: { Body: { PullResponse: { Items: { AMT_ManagementPresenceRemoteSAP: { Name: 'abcd' } } } } }
      }
      await unconfiguration.deleteRemoteAccessService(unconfigContext, null)
      expect(invokeWsmanCallSpy).toHaveBeenCalled()
    })
  })

  describe('send wsman message for Public Private Key Certificate', () => {
    it('should send wsman message to enumerate Public Private Key Pair', async () => {
      await unconfiguration.enumeratePublicPrivateKeyPair(unconfigContext, null)
      expect(invokeWsmanCallSpy).toHaveBeenCalled()
    })

    it('should send wsman message to pull Public Private Key Pair', async () => {
      unconfigContext.message = {
        Envelope: { Body: { EnumerateResponse: { EnumerationContext: 'abcde' } } }
      }
      await unconfiguration.pullPublicPrivateKeyPair(unconfigContext, null)
      expect(invokeWsmanCallSpy).toHaveBeenCalled()
    })

    it('should send wsman message to delete Public Private Key Pair', async () => {
      unconfigContext.privateCerts = [{ InstanceID: 1234 }]
      await unconfiguration.deletePublicPrivateKeyPair(unconfigContext, null)
      expect(invokeWsmanCallSpy).toHaveBeenCalled()
    })
    it('should send wsman message to delete Public Private Key Pair when there is more than one certificate', async () => {
      unconfigContext.privateCerts = [{ InstanceID: 1234 }, { InstanceID: 5678 }]
      await unconfiguration.deletePublicPrivateKeyPair(unconfigContext, null)
      expect(invokeWsmanCallSpy).toHaveBeenCalled()
    })
  })

  describe('send wsman message for Public Key Certificate', () => {
    it('should send wsman message to enumerate Public Key Certificate', async () => {
      await unconfiguration.enumeratePublicKeyCertificate(unconfigContext, null)
      expect(invokeWsmanCallSpy).toHaveBeenCalled()
    })

    it('should send wsman message to pull PublicKey Certificate', async () => {
      unconfigContext.message = {
        Envelope: { Body: { EnumerateResponse: { EnumerationContext: 'abcd' } } }
      }
      await unconfiguration.pullPublicKeyCertificate(unconfigContext, null)
      expect(invokeWsmanCallSpy).toHaveBeenCalled()
    })

    it('should send to delete PublicKeyCertificate', async () => {
      unconfigContext.publicKeyCertificates = ['abcd']
      await unconfiguration.deletePublicKeyCertificate(unconfigContext, null)
      expect(invokeWsmanCallSpy).toHaveBeenCalled()
    })
    it('should send to delete PublicKeyCertificate when more than one certificate', async () => {
      unconfigContext.publicKeyCertificates = ['abcd', 'cdefg']
      await unconfiguration.deletePublicKeyCertificate(unconfigContext, null)
      expect(invokeWsmanCallSpy).toHaveBeenCalled()
    })
  })

  describe('send wsman message for Environment Detection Settings', () => {
    it('should send wsman message to get Environment Detection Settings', async () => {
      await unconfiguration.getEnvironmentDetectionSettings(unconfigContext, null)
      expect(invokeWsmanCallSpy).toHaveBeenCalled()
    })

    it('should send to clear Environment Detection Settings', async () => {
      unconfigContext.message = {
        Envelope: { Body: { AMT_EnvironmentDetectionSettingData: { DetectionStrings: 'abcde' } } }
      }
      await unconfiguration.clearEnvironmentDetectionSettings(unconfigContext, null)
      expect(invokeWsmanCallSpy).toHaveBeenCalled()
    })
  })

  describe('send wsman message for TLS Credential Context', () => {
    it('should send wsman message to enumerate TLS Credential Context', async () => {
      await unconfiguration.enumerateTLSCredentialContext(unconfigContext, null)
      expect(invokeWsmanCallSpy).toHaveBeenCalled()
    })
    it('should send wsman message to pull TLS Credential Context', async () => {
      unconfigContext.message = {
        Envelope: { Body: { EnumerateResponse: { EnumerationContext: 'abcde' } } }
      }
      await unconfiguration.pullTLSCredentialContext(unconfigContext, null)
      expect(invokeWsmanCallSpy).toHaveBeenCalled()
    })

    it('should send wsman message to put Remote TLS Credential Context', async () => {
      unconfigContext.message = {
        Envelope: { Body: { PullResponse: { Items: { AMT_TLSCredentialContext: MPSType.Both } } } }
      }
      await unconfiguration.deleteTLSCredentialContext(unconfigContext, null)
      expect(invokeWsmanCallSpy).toHaveBeenCalled()
    })
  })

  describe('send wsman message for  TLS Setting Data', () => {
    it('should send wsman message to enumerate TLS Setting Data', async () => {
      await unconfiguration.enumerateTLSSettingData(unconfigContext, null)
      expect(invokeWsmanCallSpy).toHaveBeenCalled()
    })
    it('should send wsman message to pull TLS Setting Data', async () => {
      unconfigContext.message = {
        Envelope: { Body: { EnumerateResponse: { EnumerationContext: 'abcde' } } }
      }
      await unconfiguration.pullTLSSettingData(unconfigContext, null)
      expect(invokeWsmanCallSpy).toHaveBeenCalled()
    })

    it('should send wsman message to disableRemoteTLSSettingData', async () => {
      unconfigContext.message = {
        Envelope: {
          Body: {
            PullResponse: {
              Items: {
                AMT_TLSSettingData: [
                  { AcceptNonSecureConnections: false, NonSecureConnectionsSupported: true, ElementName: 'Intel(r) AMT 802.3 TLS Settings', Enabled: true, InstanceID: 'Intel(r) AMT 802.3 TLS Settings', MutualAuthentication: false },
                  { AcceptNonSecureConnections: true, NonSecureConnectionsSupported: true, ElementName: 'Intel(r) AMT LMS TLS Settings', Enabled: true, InstanceID: 'Intel(r) AMT LMS TLS Settings', MutualAuthentication: false }
                ]
              }
            }
          }
        }
      }
      await unconfiguration.disableRemoteTLSSettingData(unconfigContext, null)
      expect(unconfigContext.message.Envelope.Body.PullResponse.Items.AMT_TLSSettingData[0]['h:AcceptNonSecureConnections']).toBe(true)
      expect(invokeWsmanCallSpy).toHaveBeenCalled()
    })

    it('should send wsman message to disableLocalTLSSettingData', async () => {
      unconfigContext.tlsSettingData = [
        { AcceptNonSecureConnections: true, NonSecureConnectionsSupported: true, ElementName: 'Intel(r) AMT 802.3 TLS Settings', Enabled: true, InstanceID: 'Intel(r) AMT 802.3 TLS Settings', MutualAuthentication: false },
        { AcceptNonSecureConnections: true, NonSecureConnectionsSupported: true, ElementName: 'Intel(r) AMT LMS TLS Settings', Enabled: true, InstanceID: 'Intel(r) AMT LMS TLS Settings', MutualAuthentication: false }
      ]
      await unconfiguration.disableLocalTLSSettingData(unconfigContext, null)
      expect(invokeWsmanCallSpy).toHaveBeenCalled()
    })
    it('should send wsman message to commit Setup And Configuration Service', async () => {
      await unconfiguration.commitSetupAndConfigurationService(unconfigContext, null)
      expect(invokeWsmanCallSpy).toHaveBeenCalled()
    })
  })

  describe('WiFi Endpoint Settings', () => {
    it('should get enumeration number for WiFi end point settings', async () => {
      const WiFiEndpointSettingsSpy = spyOn(unconfigContext.cim.WiFiEndpointSettings, 'Enumerate').mockReturnValue('done')
      await unconfiguration.enumerateWiFiEndpointSettings(unconfigContext)
      expect(invokeWsmanCallSpy).toHaveBeenCalled()
      expect(WiFiEndpointSettingsSpy).toHaveBeenCalled()
    })
    it('should pull WiFi end point settings', async () => {
      unconfigContext.message = {
        Envelope: {
          Header: {
            Action: { _: 'http://schemas.xmlsoap.org/ws/2004/09/enumeration/EnumerateResponse' },
            ResourceURI: 'http://schemas.dmtf.org/wbem/wscim/1/cim-schema/2/CIM_WiFiEndpointSettings'
          },
          Body: { EnumerateResponse: { EnumerationContext: '92340000-0000-0000-0000-000000000000' } }
        }
      }
      const WiFiEndpointSettingsSpy = spyOn(unconfigContext.cim.WiFiEndpointSettings, 'Pull').mockReturnValue('done')
      await unconfiguration.pullWiFiEndpointSettings(unconfigContext)
      expect(WiFiEndpointSettingsSpy).toHaveBeenCalled()
      expect(invokeWsmanCallSpy).toHaveBeenCalled()
    })
    it('Should read WiFi end point settings, if CIM_WiFiEndpointSettings is an array', () => {
      unconfigContext.message = {
        Envelope: {
          Header: {},
          Body: { PullResponse: { Items: { CIM_WiFiEndpointSettings: [{ InstanceID: 'home', Priority: 1 }, { InstanceID: 'office', Priority: 2 }] } } }
        }
      }
      unconfiguration.readWiFiEndpointSettingsPullResponse(unconfigContext, null)
      expect(unconfigContext.wifiEndPointSettings.length).toBe(2)
    })
    it('Should read WiFi end point settings', () => {
      unconfigContext.message = {
        Envelope: {
          Header: {},
          Body: { PullResponse: { Items: { CIM_WiFiEndpointSettings: { InstanceID: 'home', Priority: 1 } } } }
        }
      }
      unconfiguration.readWiFiEndpointSettingsPullResponse(unconfigContext, null)
      expect(unconfigContext.wifiEndPointSettings.length).toBe(1)
    })
    it('Should delete profile from WiFi end point settings', async () => {
      unconfigContext.wifiEndPointSettings = [{ InstanceID: 'home', Priority: 1 }]
      const WiFiEndpointSettingsSpy = spyOn(unconfigContext.cim.WiFiEndpointSettings, 'Delete').mockReturnValue('done')
      await unconfiguration.deleteWiFiProfileOnAMTDevice(unconfigContext, null)
      expect(unconfigContext.wifiEndPointSettings.length).toBe(0)
      expect(invokeWsmanCallSpy).toHaveBeenCalled()
      expect(WiFiEndpointSettingsSpy).toHaveBeenCalled()
    })
  })
})
