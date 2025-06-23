/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { randomUUID } from 'node:crypto'
import { devices } from '../devices.js'
import { Environment } from '../utils/Environment.js'
import { config } from '../test/helper/Config.js'
import { ClientAction } from '../models/RCS.Config.js'
import { type MachineImplementationsSimplified, createActor, fromPromise } from 'xstate'
import {
  type WiredConfigContext,
  type WiredConfigEvent,
  type WiredConfiguration as WiredConfigurationType
} from './wiredNetworkConfiguration.js'
import { HttpHandler } from '../HttpHandler.js'
import { AMT, CIM, IPS } from '@device-management-toolkit/wsman-messages'
import { jest } from '@jest/globals'
import { spyOn } from 'jest-mock'
import { HttpResponseError, coalesceMessage, isDigestRealmValid } from './common.js'

const invokeWsmanCallSpy = jest.fn<any>()
const invokeEnterpriseAssistantCallSpy = jest.fn()

jest.unstable_mockModule('./common.js', () => ({
  invokeWsmanCall: invokeWsmanCallSpy,
  invokeEnterpriseAssistantCall: invokeEnterpriseAssistantCallSpy,
  coalesceMessage,
  isDigestRealmValid,
  HttpResponseError
}))
const { WiredConfiguration } = await import('./wiredNetworkConfiguration.js')

const clientId = randomUUID()
Environment.Config = config

describe('Wired Network Configuration', () => {
  let config: MachineImplementationsSimplified<WiredConfigContext, WiredConfigEvent>
  let currentStateIndex: number
  let wiredConfig: WiredConfigurationType
  let wiredNetworkConfigContext
  let context
  let event

  beforeEach(() => {
    devices[clientId] = {
      unauthCount: 0,
      ClientId: clientId,
      ClientSocket: { send: jest.fn() } as any,
      ClientData: {
        method: 'activation',
        apiKey: 'key',
        appVersion: '1.2.0',
        protocolVersion: '4.0.0',
        status: 'ok',
        message: "all's good!",
        payload: {
          ver: '11.8.50',
          build: '3425',
          fqdn: 'vprodemo.com',
          password: 'KQGnH+N5qJ8YLqjEFJMnGSgcnFLMv0Tk',
          hostname: 'DESKTOP-9CC12U7',
          currentMode: 0,
          certHashes: [
            'e7685634efacf69ace939a6b255b7b4fabef42935b50a265acb5cb6027e44e70',
            'eb04cf5eb1f39afa762f2bb120f296cba520c1b97db1589565b81cb9a17b7244'
          ],
          sku: '16392',
          uuid: '4bac9510-04a6-4321-bae2-d45ddf07b684',
          username: '$$OsAdmin',
          client: 'PPC',
          profile: 'profile1',
          action: ClientAction.ADMINCTLMODE
        }
      },
      ciraconfig: {},
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
    event = {
      type: 'WIREDNETWORKCONFIGURATION',
      clientId,
      data: null
    }
    wiredConfig = new WiredConfiguration()
    context = {
      amtProfile: null,
      generalSettings: {
        AMTNetworkEnabled: 1,
        RmcpPingResponseEnabled: true,
        SharedFQDN: false
      },
      wiredSettings: {
        DHCPEnabled: true,
        ElementName: 'Intel(r) AMT Ethernet Port Settings',
        InstanceID: 'Intel(r) AMT Ethernet Port Settings 0',
        IpSyncEnabled: false,
        MACAddress: 'a4-bb-6d-89-52-e4'
      },
      wifiProfiles: [],
      wifiProfileCount: 0,
      message: '',
      clientId,
      xmlMessage: '',
      response: '',
      status: 'wsman',
      statusMessage: '',
      httpHandler: new HttpHandler(),
      amt: new AMT.Messages(),
      cim: new CIM.Messages()
    }
    context.amtProfile = {
      profileName: 'acm',
      generateRandomPassword: false,
      activation: ClientAction.ADMINCTLMODE,
      ciraConfigName: 'config1',
      generateRandomMEBxPassword: false,
      tags: ['acm'],
      dhcpEnabled: true,
      ipSyncEnabled: true,
      wifiConfigs: [
        {
          priority: 1,
          profileName: 'home'
        }
      ]
    }
    wiredNetworkConfigContext = {
      amtProfile: null,
      ieee8021xProfile: null,
      message: '',
      clientId,
      xmlMessage: '',
      statusMessage: '',
      errorMessage: '',
      generalSettings: {
        AMTNetworkEnabled: 1,
        RmcpPingResponseEnabled: true,
        SharedFQDN: false
      },
      wiredSettings: {
        DHCPEnabled: true,
        ElementName: 'Intel(r) AMT Ethernet Port Settings',
        InstanceID: 'Intel(r) AMT Ethernet Port Settings 0',
        IpSyncEnabled: false,
        MACAddress: 'a4-bb-6d-89-52-e4'
      },
      httpHandler: new HttpHandler(),
      amt: new AMT.Messages(),
      ips: new IPS.Messages(),
      cim: new CIM.Messages(),
      retryCount: null,
      eaResponse: '',
      addTrustedRootCertResponse: '',
      addCertResponse: null,
      keyPairHandle: '',
      targetAfterError: '',
      wirelessSettings: null
    }
    currentStateIndex = 0
    config = {
      actors: {
        putEthernetPortSettings: fromPromise(
          async ({ input }) =>
            await Promise.resolve({
              Envelope: {
                Body: {
                  AMT_EthernetPortSettings: {
                    DHCPEnabled: true,
                    IpSyncEnabled: true,
                    SharedStaticIp: false
                  }
                }
              }
            })
        ),
        get8021xProfile: fromPromise(
          async ({ input }) =>
            await Promise.resolve({
              Envelope: {
                Body: {}
              }
            })
        ),
        errorMachine: fromPromise(async ({ input }) => await Promise.resolve({ clientId: event.clientId })),
        generateKeyPair: fromPromise(async ({ input }) => await Promise.resolve({ clientId })),
        enumeratePublicPrivateKeyPair: fromPromise(async ({ input }) => await Promise.resolve({ clientId })),
        pullPublicPrivateKeyPair: fromPromise(async ({ input }) => await Promise.resolve({ clientId })),
        sendEnterpriseAssistantKeyPairResponse: fromPromise(async ({ input }) => await Promise.resolve({ clientId })),
        signCSR: fromPromise(async ({ input }) => await Promise.resolve({ clientId })),
        addCertificate: fromPromise(async ({ input }) => await Promise.resolve({ clientId })),
        addRadiusServerRootCertificate: fromPromise(async ({ input }) => await Promise.resolve({ clientId })),
        put8021xProfile: fromPromise(async ({ input }) => await Promise.resolve({ clientId })),
        setCertificates: fromPromise(async ({ input }) => await Promise.resolve({ clientId })),
        initiateCertRequest: fromPromise(async ({ input }) => await Promise.resolve({ clientId })),
        getCertFromEnterpriseAssistant: fromPromise(async ({ input }) => await Promise.resolve({ clientId }))
      },
      guards: {
        is8021xProfilesExists: () => true,
        isMSCHAPv2: () => false,
        shouldRetry: () => false
      },
      actions: {
        'Reset Unauth Count': () => {},
        'Read Ethernet Port Settings': () => {},
        'Read WiFi Endpoint Settings Pull Response': () => {}
      },
      delays: {}
    }
  })

  it('should send a message to pull public private key pairs', async () => {
    wiredNetworkConfigContext.amt = { PublicPrivateKeyPair: { Pull: jest.fn() } }
    wiredNetworkConfigContext.message = { Envelope: { Body: { EnumeratorResponse: { EnumeratorContext: 'abc' } } } }
    await wiredConfig.pullPublicPrivateKeyPair({ input: wiredNetworkConfigContext })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })

  it('should send a message to get enumerate public private key pairs', async () => {
    wiredNetworkConfigContext.message = {
      Envelope: {
        Body: {
          GenerateKeyPair_OUTPUT: { KeyPair: { ReferenceParameters: { SelectorSet: { Selector: { _: 'xyz' } } } } }
        }
      }
    }
    wiredNetworkConfigContext.amt = { PublicPrivateKeyPair: { Enumerate: jest.fn() } }
    await wiredConfig.enumeratePublicPrivateKeyPair({ input: wiredNetworkConfigContext })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })

  it('should addCertificate', async () => {
    context.message = { Envelope: { Body: { PullResponse: { Items: { AMT_PublicPrivateKeyPair: {} } } } } }
    event = { output: { response: { certificate: 'abcde' } } }
    await wiredConfig.addCertificate({ input: { context, event } })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })

  it('should send a WSMan call to add radius server root cert', async () => {
    wiredNetworkConfigContext.message = { Envelope: { Body: 'abcd' } }
    wiredNetworkConfigContext.eaResponse = { rootcert: '1234' }
    await wiredConfig.addRadiusServerRootCertificate({ input: wiredNetworkConfigContext })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })

  it('should send a message to sign CSR', async () => {
    wiredNetworkConfigContext.amt = { PublicKeyManagementService: { GeneratePKCS10RequestEx: jest.fn() } }
    wiredNetworkConfigContext.message = { response: { csr: 'abc' } }
    await wiredConfig.signCSR({ input: wiredNetworkConfigContext })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })

  it('should send a WSMan call to setCertificate', async () => {
    wiredNetworkConfigContext.addCertResponse = {
      AddCertificate_OUTPUT: { CreatedCertificate: { ReferenceParameters: { SelectorSet: { Selector: { _: '' } } } } }
    }
    wiredNetworkConfigContext.addTrustedRootCertificate = {
      AddCertificate_OUTPUT: { CreatedCertificate: { ReferenceParameters: { SelectorSet: { Selector: { _: '' } } } } }
    }
    await wiredConfig.setCertificates({ input: wiredNetworkConfigContext })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })

  it('should send a WSMan call to put 802.1x Profile protocol 0', async () => {
    wiredNetworkConfigContext.amtProfile = {
      profileName: 'acm',
      amtPassword: 'Intel123!',
      mebxPassword: 'Intel123!',
      activation: 'acmactivate',
      tags: ['acm'],
      dhcpEnabled: true,
      ipSyncEnabled: true,
      ieee8021xProfileName: 'p1',
      tenantId: ''
    }
    wiredNetworkConfigContext.ieee8021xProfile = {
      Enabled: 3,
      AuthenticationProtocol: 0,
      ElementName: '',
      PxeTimeout: 0,
      Username: ''
    }
    wiredNetworkConfigContext.message = { Envelope: { Body: 'abcd' } }
    wiredNetworkConfigContext.amtProfile.ieee8021xProfileObject = {
      profileName: 'p1',
      authenticationProtocol: 0,
      pxeTimeout: 120,
      tenantId: '',
      wiredInterface: true
    }
    await wiredConfig.put8021xProfile({ input: wiredNetworkConfigContext })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })

  it('should send a WSMan call to put 802.1x Profile protocol 2', async () => {
    wiredNetworkConfigContext.amtProfile = {
      profileName: 'acm',
      amtPassword: 'Intel123!',
      mebxPassword: 'Intel123!',
      activation: 'acmactivate',
      tags: ['acm'],
      dhcpEnabled: true,
      ipSyncEnabled: true,
      ieee8021xProfileName: 'p1',
      tenantId: ''
    }
    wiredNetworkConfigContext.ieee8021xProfile = {
      Enabled: 3,
      AuthenticationProtocol: 2,
      ElementName: '',
      PxeTimeout: 0,
      Username: ''
    }
    wiredNetworkConfigContext.message = { Envelope: { Body: 'abcd' } }
    wiredNetworkConfigContext.amtProfile.ieee8021xProfileObject = {
      profileName: 'p1',
      authenticationProtocol: 2,
      pxeTimeout: 120,
      tenantId: '',
      wiredInterface: true
    }
    await wiredConfig.put8021xProfile({ input: wiredNetworkConfigContext })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })

  it('should send a WSMan call to get 802.1x Profile', async () => {
    await wiredConfig.get8021xProfile({ input: wiredNetworkConfigContext })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })

  it('should generate a key pair', async () => {
    wiredNetworkConfigContext = {
      amt: { PublicKeyManagementService: { GenerateKeyPair: jest.fn() } },
      xmlMessage: ''
    }
    await wiredConfig.generateKeyPair({ input: wiredNetworkConfigContext })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })

  it('should put ethernet port settings, DHCPEnabled is set to true', async () => {
    context.wiredSettings = {
      DHCPEnabled: true,
      DefaultGateway: '192.168.1.1',
      ElementName: 'Intel(r) AMT Ethernet Port Settings',
      IPAddress: '192.168.1.139',
      InstanceID: 'Intel(r) AMT Ethernet Port Settings 0',
      IpSyncEnabled: false,
      LinkIsUp: true,
      LinkPolicy: [
        1,
        14
      ],
      MACAddress: 'a4-bb-6d-89-52-e4',
      PhysicalConnectionType: 0,
      PrimaryDNS: '192.168.1.1',
      SharedDynamicIP: true,
      SharedMAC: true,
      SharedStaticIp: false,
      SubnetMask: '255.255.255.0'
    }
    const ethernetPortSettingsSpy = spyOn(context.amt.EthernetPortSettings, 'Put').mockImplementation(() => 'abcdef')
    await wiredConfig.putEthernetPortSettings({ input: context })
    expect(ethernetPortSettingsSpy).toHaveBeenCalled()
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })
  it('should put ethernet port settings, DHCPEnabled is set to false', async () => {
    context.amtProfile.dhcpEnabled = false
    context.wiredSettings = {
      DHCPEnabled: true,
      DefaultGateway: '192.168.1.1',
      ElementName: 'Intel(r) AMT Ethernet Port Settings',
      IPAddress: '192.168.1.139',
      InstanceID: 'Intel(r) AMT Ethernet Port Settings 0',
      IpSyncEnabled: false,
      LinkIsUp: true,
      LinkPolicy: [
        1,
        14
      ],
      MACAddress: 'a4-bb-6d-89-52-e4',
      PhysicalConnectionType: 0,
      PrimaryDNS: '192.168.1.1',
      SharedDynamicIP: true,
      SharedMAC: true,
      SharedStaticIp: false,
      SubnetMask: '255.255.255.0'
    }
    const ethernetPortSettingsSpy = spyOn(context.amt.EthernetPortSettings, 'Put').mockImplementation(() => 'abcdef')
    await wiredConfig.putEthernetPortSettings({ input: context })
    expect(ethernetPortSettingsSpy).toHaveBeenCalled()
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })
  it('should fail putEthernetPortSettings if ipSyncEnabled is false and missing ip address or subnetmask', async () => {
    context.amtProfile.dhcpEnabled = false
    context.amtProfile.ipSyncEnabled = false
    context.wiredSettings = {
      DefaultGateway: '',
      IPAddress: '',
      SubnetMask: ''
    }
    await expect(wiredConfig.putEthernetPortSettings({ input: context })).rejects.toThrow()
    context.wiredSettings = {
      DefaultGateway: '',
      IPAddress: '192.168.1.100',
      SubnetMask: ''
    }
    await expect(wiredConfig.putEthernetPortSettings({ input: context })).rejects.toThrow()
  })
  describe('Wired Network State Machine Tests', () => {
    it('should eventually reach "SUCCESS" state', (done) => {
      const mockWiredNetworkConfigurationMachine = wiredConfig.machine.provide(config)
      const flowStates = [
        'ACTIVATION',
        'PUT_ETHERNET_PORT_SETTINGS',
        'GET_8021X_PROFILE',
        'ENTERPRISE_ASSISTANT_REQUEST',
        'GENERATE_KEY_PAIR',
        'ENUMERATE_PUBLIC_PRIVATE_KEY_PAIR',
        'PULL_PUBLIC_PRIVATE_KEY_PAIR',
        'ENTERPRISE_ASSISTANT_RESPONSE',
        'SIGN_CSR',
        'GET_CERT_FROM_ENTERPRISE_ASSISTANT',
        'ADD_CERTIFICATE',
        'ADD_RADIUS_SERVER_ROOT_CERTIFICATE',
        'PUT_8021X_PROFILE',
        'SET_CERTIFICATES',
        'SUCCESS'
      ]
      const service = createActor(mockWiredNetworkConfigurationMachine, { input: context })
      service.subscribe((state) => {
        const expectedState: any = flowStates[currentStateIndex++]
        expect(state.matches(expectedState)).toBe(true)
        if (state.matches('SUCCESS') && currentStateIndex === flowStates.length) {
          const status = devices[clientId].status.Network
          expect(status).toEqual('Wired Network Configured')
          done()
        }
      })
      service.start()
      service.send({ type: 'WIREDCONFIG', clientId })
    })
    it('should eventually reach "FAILED" state', (done) => {
      config.actors!.putEthernetPortSettings = fromPromise(async ({ input }) => await Promise.reject(new Error()))
      const mockWiredNetworkConfigurationMachine = wiredConfig.machine.provide(config)
      const flowStates = [
        'ACTIVATION',
        'PUT_ETHERNET_PORT_SETTINGS',
        'FAILED'
      ]
      const service = createActor(mockWiredNetworkConfigurationMachine, { input: context })
      service.subscribe((state) => {
        const expectedState: any = flowStates[currentStateIndex++]
        expect(state.matches(expectedState)).toBe(true)
        if (state.matches('FAILED') && currentStateIndex === flowStates.length) {
          done()
        }
      })
      service.start()
      service.send({ type: 'WIREDCONFIG', clientId })
    })
    it('should eventually reach "FAILED" state', (done) => {
      config.actors!.get8021xProfile = fromPromise(async ({ input }) => await Promise.reject(new Error()))
      const mockWiredNetworkConfigurationMachine = wiredConfig.machine.provide(config)
      const flowStates = [
        'ACTIVATION',
        'PUT_ETHERNET_PORT_SETTINGS',
        'GET_8021X_PROFILE',
        'FAILED'
      ]
      const service = createActor(mockWiredNetworkConfigurationMachine, { input: context })
      service.subscribe((state) => {
        const expectedState: any = flowStates[currentStateIndex++]
        expect(state.matches(expectedState)).toBe(true)
        if (state.matches('FAILED') && currentStateIndex === flowStates.length) {
          done()
        }
      })
      service.start()
      service.send({ type: 'WIREDCONFIG', clientId })
    })
    it('should eventually reach "FAILED" state', (done) => {
      config.actors!.initiateCertRequest = fromPromise(async ({ input }) => await Promise.reject(new Error()))
      const mockWiredNetworkConfigurationMachine = wiredConfig.machine.provide(config)
      const flowStates = [
        'ACTIVATION',
        'PUT_ETHERNET_PORT_SETTINGS',
        'GET_8021X_PROFILE',
        'ENTERPRISE_ASSISTANT_REQUEST',
        'FAILED'
      ]
      const service = createActor(mockWiredNetworkConfigurationMachine, { input: context })
      service.subscribe((state) => {
        const expectedState: any = flowStates[currentStateIndex++]
        expect(state.matches(expectedState)).toBe(true)
        if (state.matches('FAILED') && currentStateIndex === flowStates.length) {
          done()
        }
      })
      service.start()
      service.send({ type: 'WIREDCONFIG', clientId })
    })
    it('should eventually reach "FAILED" state', (done) => {
      config.actors!.generateKeyPair = fromPromise(async ({ input }) => await Promise.reject(new Error()))
      const mockWiredNetworkConfigurationMachine = wiredConfig.machine.provide(config)
      const flowStates = [
        'ACTIVATION',
        'PUT_ETHERNET_PORT_SETTINGS',
        'GET_8021X_PROFILE',
        'ENTERPRISE_ASSISTANT_REQUEST',
        'GENERATE_KEY_PAIR',
        'FAILED'
      ]
      const service = createActor(mockWiredNetworkConfigurationMachine, { input: context })
      service.subscribe((state) => {
        const expectedState: any = flowStates[currentStateIndex++]
        expect(state.matches(expectedState)).toBe(true)
        if (state.matches('FAILED') && currentStateIndex === flowStates.length) {
          done()
        }
      })
      service.start()
      service.send({ type: 'WIREDCONFIG', clientId })
    })
    it('should eventually reach "FAILED" state', (done) => {
      config.actors!.enumeratePublicPrivateKeyPair = fromPromise(async ({ input }) => await Promise.reject(new Error()))
      const mockWiredNetworkConfigurationMachine = wiredConfig.machine.provide(config)
      const flowStates = [
        'ACTIVATION',
        'PUT_ETHERNET_PORT_SETTINGS',
        'GET_8021X_PROFILE',
        'ENTERPRISE_ASSISTANT_REQUEST',
        'GENERATE_KEY_PAIR',
        'ENUMERATE_PUBLIC_PRIVATE_KEY_PAIR',
        'FAILED'
      ]
      const service = createActor(mockWiredNetworkConfigurationMachine, { input: context })
      service.subscribe((state) => {
        const expectedState: any = flowStates[currentStateIndex++]
        expect(state.matches(expectedState)).toBe(true)
        if (state.matches('FAILED') && currentStateIndex === flowStates.length) {
          done()
        }
      })
      service.start()
      service.send({ type: 'WIREDCONFIG', clientId })
    })
    it('should eventually reach "FAILED" state', (done) => {
      config.actors!.pullPublicPrivateKeyPair = fromPromise(async ({ input }) => await Promise.reject(new Error()))
      const mockWiredNetworkConfigurationMachine = wiredConfig.machine.provide(config)
      const flowStates = [
        'ACTIVATION',
        'PUT_ETHERNET_PORT_SETTINGS',
        'GET_8021X_PROFILE',
        'ENTERPRISE_ASSISTANT_REQUEST',
        'GENERATE_KEY_PAIR',
        'ENUMERATE_PUBLIC_PRIVATE_KEY_PAIR',
        'PULL_PUBLIC_PRIVATE_KEY_PAIR',
        'FAILED'
      ]
      const service = createActor(mockWiredNetworkConfigurationMachine, { input: context })
      service.subscribe((state) => {
        const expectedState: any = flowStates[currentStateIndex++]
        expect(state.matches(expectedState)).toBe(true)
        if (state.matches('FAILED') && currentStateIndex === flowStates.length) {
          done()
        }
      })
      service.start()
      service.send({ type: 'WIREDCONFIG', clientId })
    })
    it('should eventually reach "FAILED" state', (done) => {
      config.actors!.sendEnterpriseAssistantKeyPairResponse = fromPromise(
        async ({ input }) => await Promise.reject(new Error())
      )
      const mockWiredNetworkConfigurationMachine = wiredConfig.machine.provide(config)
      const flowStates = [
        'ACTIVATION',
        'PUT_ETHERNET_PORT_SETTINGS',
        'GET_8021X_PROFILE',
        'ENTERPRISE_ASSISTANT_REQUEST',
        'GENERATE_KEY_PAIR',
        'ENUMERATE_PUBLIC_PRIVATE_KEY_PAIR',
        'PULL_PUBLIC_PRIVATE_KEY_PAIR',
        'ENTERPRISE_ASSISTANT_RESPONSE',
        'FAILED'
      ]
      const service = createActor(mockWiredNetworkConfigurationMachine, { input: context })
      service.subscribe((state) => {
        const expectedState: any = flowStates[currentStateIndex++]
        expect(state.matches(expectedState)).toBe(true)
        if (state.matches('FAILED') && currentStateIndex === flowStates.length) {
          done()
        }
      })
      service.start()
      service.send({ type: 'WIREDCONFIG', clientId })
    })
    it('should eventually reach "FAILED" state', (done) => {
      config.actors!.signCSR = fromPromise(async ({ input }) => await Promise.reject(new Error()))
      const mockWiredNetworkConfigurationMachine = wiredConfig.machine.provide(config)
      const flowStates = [
        'ACTIVATION',
        'PUT_ETHERNET_PORT_SETTINGS',
        'GET_8021X_PROFILE',
        'ENTERPRISE_ASSISTANT_REQUEST',
        'GENERATE_KEY_PAIR',
        'ENUMERATE_PUBLIC_PRIVATE_KEY_PAIR',
        'PULL_PUBLIC_PRIVATE_KEY_PAIR',
        'ENTERPRISE_ASSISTANT_RESPONSE',
        'SIGN_CSR',
        'FAILED'
      ]
      const service = createActor(mockWiredNetworkConfigurationMachine, { input: context })
      service.subscribe((state) => {
        const expectedState: any = flowStates[currentStateIndex++]
        expect(state.matches(expectedState)).toBe(true)
        if (state.matches('FAILED') && currentStateIndex === flowStates.length) {
          done()
        }
      })
      service.start()
      service.send({ type: 'WIREDCONFIG', clientId })
    })
    it('should eventually reach "FAILED" state', (done) => {
      config.actors!.getCertFromEnterpriseAssistant = fromPromise(
        async ({ input }) => await Promise.reject(new Error())
      )
      const mockWiredNetworkConfigurationMachine = wiredConfig.machine.provide(config)
      const flowStates = [
        'ACTIVATION',
        'PUT_ETHERNET_PORT_SETTINGS',
        'GET_8021X_PROFILE',
        'ENTERPRISE_ASSISTANT_REQUEST',
        'GENERATE_KEY_PAIR',
        'ENUMERATE_PUBLIC_PRIVATE_KEY_PAIR',
        'PULL_PUBLIC_PRIVATE_KEY_PAIR',
        'ENTERPRISE_ASSISTANT_RESPONSE',
        'SIGN_CSR',
        'GET_CERT_FROM_ENTERPRISE_ASSISTANT',
        'FAILED'
      ]
      const service = createActor(mockWiredNetworkConfigurationMachine, { input: context })
      service.subscribe((state) => {
        const expectedState: any = flowStates[currentStateIndex++]
        expect(state.matches(expectedState)).toBe(true)
        if (state.matches('FAILED') && currentStateIndex === flowStates.length) {
          done()
        }
      })
      service.start()
      service.send({ type: 'WIREDCONFIG', clientId })
    })
    it('should eventually reach "FAILED" state', (done) => {
      config.actors!.addCertificate = fromPromise(async ({ input }) => await Promise.reject(new Error()))
      const mockWiredNetworkConfigurationMachine = wiredConfig.machine.provide(config)
      const flowStates = [
        'ACTIVATION',
        'PUT_ETHERNET_PORT_SETTINGS',
        'GET_8021X_PROFILE',
        'ENTERPRISE_ASSISTANT_REQUEST',
        'GENERATE_KEY_PAIR',
        'ENUMERATE_PUBLIC_PRIVATE_KEY_PAIR',
        'PULL_PUBLIC_PRIVATE_KEY_PAIR',
        'ENTERPRISE_ASSISTANT_RESPONSE',
        'SIGN_CSR',
        'GET_CERT_FROM_ENTERPRISE_ASSISTANT',
        'ADD_CERTIFICATE',
        'FAILED'
      ]
      const service = createActor(mockWiredNetworkConfigurationMachine, { input: context })
      service.subscribe((state) => {
        const expectedState: any = flowStates[currentStateIndex++]
        expect(state.matches(expectedState)).toBe(true)
        if (state.matches('FAILED') && currentStateIndex === flowStates.length) {
          done()
        }
      })
      service.start()
      service.send({ type: 'WIREDCONFIG', clientId })
    })
    it('should eventually reach "FAILED" state', (done) => {
      config.actors!.addRadiusServerRootCertificate = fromPromise(
        async ({ input }) => await Promise.reject(new Error())
      )
      const mockWiredNetworkConfigurationMachine = wiredConfig.machine.provide(config)
      const flowStates = [
        'ACTIVATION',
        'PUT_ETHERNET_PORT_SETTINGS',
        'GET_8021X_PROFILE',
        'ENTERPRISE_ASSISTANT_REQUEST',
        'GENERATE_KEY_PAIR',
        'ENUMERATE_PUBLIC_PRIVATE_KEY_PAIR',
        'PULL_PUBLIC_PRIVATE_KEY_PAIR',
        'ENTERPRISE_ASSISTANT_RESPONSE',
        'SIGN_CSR',
        'GET_CERT_FROM_ENTERPRISE_ASSISTANT',
        'ADD_CERTIFICATE',
        'ADD_RADIUS_SERVER_ROOT_CERTIFICATE',
        'FAILED'
      ]
      const service = createActor(mockWiredNetworkConfigurationMachine, { input: context })
      service.subscribe((state) => {
        const expectedState: any = flowStates[currentStateIndex++]
        expect(state.matches(expectedState)).toBe(true)
        if (state.matches('FAILED') && currentStateIndex === flowStates.length) {
          done()
        }
      })
      service.start()
      service.send({ type: 'WIREDCONFIG', clientId })
    })
    it('should eventually reach "FAILED" state', (done) => {
      config.actors!.put8021xProfile = fromPromise(async ({ input }) => await Promise.reject(new Error()))
      const mockWiredNetworkConfigurationMachine = wiredConfig.machine.provide(config)
      const flowStates = [
        'ACTIVATION',
        'PUT_ETHERNET_PORT_SETTINGS',
        'GET_8021X_PROFILE',
        'ENTERPRISE_ASSISTANT_REQUEST',
        'GENERATE_KEY_PAIR',
        'ENUMERATE_PUBLIC_PRIVATE_KEY_PAIR',
        'PULL_PUBLIC_PRIVATE_KEY_PAIR',
        'ENTERPRISE_ASSISTANT_RESPONSE',
        'SIGN_CSR',
        'GET_CERT_FROM_ENTERPRISE_ASSISTANT',
        'ADD_CERTIFICATE',
        'ADD_RADIUS_SERVER_ROOT_CERTIFICATE',
        'PUT_8021X_PROFILE',
        'FAILED'
      ]
      const service = createActor(mockWiredNetworkConfigurationMachine, { input: context })
      service.subscribe((state) => {
        const expectedState: any = flowStates[currentStateIndex++]
        expect(state.matches(expectedState)).toBe(true)
        if (state.matches('FAILED') && currentStateIndex === flowStates.length) {
          done()
        }
      })
      service.start()
      service.send({ type: 'WIREDCONFIG', clientId })
    })
    it('should eventually reach "FAILED" state', (done) => {
      config.actors!.setCertificates = fromPromise(async ({ input }) => await Promise.reject(new Error()))
      const mockWiredNetworkConfigurationMachine = wiredConfig.machine.provide(config)
      const flowStates = [
        'ACTIVATION',
        'PUT_ETHERNET_PORT_SETTINGS',
        'GET_8021X_PROFILE',
        'ENTERPRISE_ASSISTANT_REQUEST',
        'GENERATE_KEY_PAIR',
        'ENUMERATE_PUBLIC_PRIVATE_KEY_PAIR',
        'PULL_PUBLIC_PRIVATE_KEY_PAIR',
        'ENTERPRISE_ASSISTANT_RESPONSE',
        'SIGN_CSR',
        'GET_CERT_FROM_ENTERPRISE_ASSISTANT',
        'ADD_CERTIFICATE',
        'ADD_RADIUS_SERVER_ROOT_CERTIFICATE',
        'PUT_8021X_PROFILE',
        'SET_CERTIFICATES',
        'FAILED'
      ]
      const service = createActor(mockWiredNetworkConfigurationMachine, { input: context })
      service.subscribe((state) => {
        const expectedState: any = flowStates[currentStateIndex++]
        expect(state.matches(expectedState)).toBe(true)
        if (state.matches('FAILED') && currentStateIndex === flowStates.length) {
          done()
        }
      })
      service.start()
      service.send({ type: 'WIREDCONFIG', clientId })
    })
    it('should fail on isNotEthernetSettingsUpdated conditions', (done) => {
      const amtPutResponse = {
        Envelope: {
          Body: {
            AMT_EthernetPortSettings: {
              DHCPEnabled: false,
              IpSyncEnabled: true,
              SharedStaticIp: false
            }
          }
        }
      }
      config.actors!.putEthernetPortSettings = fromPromise(async ({ input }) => await Promise.resolve(amtPutResponse))
      const mockWiredNetworkConfigurationMachine = wiredConfig.machine.provide(config)
      const service = createActor(mockWiredNetworkConfigurationMachine, { input: context })
      service.subscribe((state) => {
        if (state.matches('FAILED')) {
          done()
        }
      })
      service.start()
      service.send({ type: 'WIREDCONFIG', clientId })
    })
    it('should fail on isNotEthernetSettingsUpdated conditions', (done) => {
      const amtPutResponse = {
        Envelope: {
          Body: {
            AMT_EthernetPortSettings: {
              DHCPEnabled: true,
              IpSyncEnabled: false,
              SharedStaticIp: false
            }
          }
        }
      }
      config.actors!.putEthernetPortSettings = fromPromise(async ({ input }) => await Promise.resolve(amtPutResponse))
      const mockWiredNetworkConfigurationMachine = wiredConfig.machine.provide(config)
      const service = createActor(mockWiredNetworkConfigurationMachine, { input: context })
      service.subscribe((state) => {
        if (state.matches('FAILED')) {
          done()
        }
      })
      service.start()
      service.send({ type: 'WIREDCONFIG', clientId })
    })
    it('should fail on isNotEthernetSettingsUpdated conditions', (done) => {
      const amtPutResponse = {
        Envelope: {
          Body: {
            AMT_EthernetPortSettings: {
              DHCPEnabled: true,
              IpSyncEnabled: true,
              SharedStaticIp: true
            }
          }
        }
      }
      config.actors!.putEthernetPortSettings = fromPromise(async ({ input }) => await Promise.resolve(amtPutResponse))
      const mockWiredNetworkConfigurationMachine = wiredConfig.machine.provide(config)
      const service = createActor(mockWiredNetworkConfigurationMachine, { input: context })
      service.subscribe((state) => {
        if (state.matches('FAILED')) {
          done()
        }
      })
      service.start()
      service.send({ type: 'WIREDCONFIG', clientId })
    })
    it('should fail on isNotEthernetSettingsUpdated conditions', (done) => {
      context.amtProfile.dhcpEnabled = false
      const amtPutResponse = {
        Envelope: {
          Body: {
            AMT_EthernetPortSettings: {
              DHCPEnabled: true,
              IpSyncEnabled: true,
              SharedStaticIp: false
            }
          }
        }
      }
      config.actors!.putEthernetPortSettings = fromPromise(async ({ input }) => await Promise.resolve(amtPutResponse))
      const mockWiredNetworkConfigurationMachine = wiredConfig.machine.provide(config)
      let prevState = null as any
      const service = createActor(mockWiredNetworkConfigurationMachine, { input: context })
      service.subscribe((state) => {
        if (state.matches('FAILED')) {
          done()
          expect(prevState.matches('PUT_ETHERNET_PORT_SETTINGS')).toBeTruthy()
        } else {
          prevState = state
        }
      })
      service.start()
      service.send({ type: 'WIREDCONFIG', clientId })
    })
  })
})
