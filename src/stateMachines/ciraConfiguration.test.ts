/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { AMT } from '@device-management-toolkit/wsman-messages'
import {
  type CIRAConfigContext,
  type CIRAConfigEvent,
  type CIRAConfiguration as CIRAConfigurationType
} from './ciraConfiguration.js'
import { randomUUID } from 'node:crypto'
import { devices } from '../devices.js'
import { Environment } from '../utils/Environment.js'
import { config } from '../test/helper/Config.js'
import { type CIRAConfig } from '../models/RCS.Config.js'
import { HttpHandler } from '../HttpHandler.js'
import { type MachineImplementationsSimplified, createActor, fromPromise } from 'xstate'
import { HttpResponseError, coalesceMessage, isDigestRealmValid } from './common.js'
import { jest } from '@jest/globals'

Environment.Config = config

const invokeWsmanCallSpy = jest.fn<any>()
jest.unstable_mockModule('./common.js', () => ({
  invokeWsmanCall: invokeWsmanCallSpy,
  invokeEnterpriseAssistantCall: jest.fn(),
  HttpResponseError,
  isDigestRealmValid,
  coalesceMessage
}))

const { CIRAConfiguration, MPSType } = await import('./ciraConfiguration.js')

const pullRemoteAccessPolicyAppliesToMPSResponse = {
  Envelope: {
    Body: {
      PullResponse: {
        Items: {
          AMT_RemoteAccessPolicyAppliesToMPS: [
            {
              PolicySet: {
                ReferenceParameters: {
                  SelectorSet: { Selector: [{ $: { Name: 'PolicyRuleName' }, _: 'TestPolicy1' }] }
                }
              }
            }
          ]
        }
      }
    }
  }
}

describe('CIRA Configuration State Machine', () => {
  const clientId = randomUUID()
  const httpHandler = new HttpHandler()
  const initialEvent: CIRAConfigEvent = {
    type: 'CONFIGURE_CIRA',
    clientId,
    output: null,
    tenantId: ''
  }
  const wsmanEnumerationResponse = {
    Envelope: { Body: { EnumerateResponse: { EnumerationContext: 'abcd' } } }
  }
  let ciraStateMachineImpl: CIRAConfigurationType
  let machineConfig: MachineImplementationsSimplified<CIRAConfigContext, CIRAConfigEvent>
  let machineContext
  let ciraConfig: CIRAConfig
  beforeEach(() => {
    jest.clearAllMocks()
    ciraStateMachineImpl = new CIRAConfiguration()
    devices[clientId] = {
      ClientId: clientId,
      unauthCount: 0,
      status: {
        CIRAConnection: 'should not need this'
      }
    } as any
    ciraConfig = {
      proxyDetails: '',
      tenantId: '',
      configName: 'config1',
      mpsServerAddress: '192.168.1.38',
      mpsPort: 4433,
      username: 'admin',
      password: null as any,
      commonName: '192.168.1.38',
      serverAddressFormat: 3,
      authMethod: 2,
      mpsRootCertificate: 'NotReallyACert'
    }
    machineContext = {
      clientId,
      profile: null,
      httpHandler,
      amt: new AMT.Messages(),
      tenantId: '',
      status: 'success',
      errorMessage: '',
      xmlMessage: '',
      message: null,
      ciraConfig: null,
      statusMessage: '',
      privateCerts: [],
      remoteAccessPolicies: []
    }
    machineConfig = {
      actors: {
        getCIRAConfig: fromPromise(async ({ input }) => await Promise.resolve(ciraConfig)),
        getMPSPassword: fromPromise(async ({ input }) => await Promise.resolve({ whatever: false })),
        addTrustedRootCertificate: fromPromise(async ({ input }) => await Promise.resolve({})),
        saveMPSPasswordToSecretProvider: fromPromise(async ({ input }) => await Promise.resolve({})),
        saveDeviceToMPS: fromPromise(async ({ input }) => await Promise.resolve({})),
        addMPS: fromPromise(async ({ input }) => await Promise.resolve({})),
        enumerateManagementPresenceRemoteSAP: fromPromise(
          async ({ input }) => await Promise.resolve(wsmanEnumerationResponse)
        ),
        pullManagementPresenceRemoteSAP: fromPromise(async ({ input }) => await Promise.resolve({ clientId })),
        addRemoteAccessPolicyRule: fromPromise(async ({ input }) => await Promise.resolve({ clientId })),
        enumerateRemoteAccessPolicyAppliesToMPS: fromPromise(
          async ({ input }) => await Promise.resolve(wsmanEnumerationResponse)
        ),
        pullRemoteAccessPolicyAppliesToMPS: fromPromise(
          async ({ input }) => await Promise.resolve(pullRemoteAccessPolicyAppliesToMPSResponse)
        ),
        putRemoteAccessPolicyAppliesToMPS: fromPromise(async ({ input }) => await Promise.resolve({})),
        userInitiatedConnectionService: fromPromise(
          async ({ input }) =>
            await Promise.resolve({ Envelope: { Body: { RequestStateChange_OUTPUT: { ReturnValue: 0 } } } })
        ),
        getEnvironmentDetectionSettings: fromPromise(async ({ input }) => await Promise.resolve({})),
        putEnvironmentDetectionSettings: fromPromise(async ({ input }) => await Promise.resolve({}))
      },
      actions: {},
      guards: {},
      delays: {}
    }
  })

  it('should succeed for happy path', (done) => {
    const mockCiraConfigurationMachine = ciraStateMachineImpl.machine.provide(machineConfig)
    const flowStates = [
      'CIRACONFIGURED',
      'GET_CIRA_CONFIG',
      'SET_MPS_PASSWORD',
      'ADD_TRUSTED_ROOT_CERTIFICATE',
      'SAVE_MPS_PASSWORD_TO_SECRET_PROVIDER',
      'SAVE_DEVICE_TO_MPS',
      'ADD_MPS',
      'ENUMERATE_MANAGEMENT_PRESENCE_REMOTE_SAP',
      'PULL_MANAGEMENT_PRESENCE_REMOTE_SAP',
      'ADD_REMOTE_ACCESS_POLICY_RULE',
      'ADD_USER_INITIATED_REMOTE_ACCESS_POLICY_RULE',
      'ENUMERATE_REMOTE_ACCESS_POLICY_APPLIESTOMPS',
      'PULL_REMOTE_ACCESS_POLICY_APPLIESTOMPS',
      'PUT_REMOTE_ACCESS_POLICY_APPLIESTOMPS',
      'USER_INITIATED_CONNECTION_SERVICE',
      'GET_ENVIRONMENT_DETECTION_SETTINGS',
      'PUT_ENVIRONMENT_DETECTION_SETTINGS',
      'SUCCESS'
    ]
    let currentStateIndex = 0
    const machineContext = {
      message: null,
      clientId
    }
    const ciraConfigurationService = createActor(mockCiraConfigurationMachine, { input: machineContext })
    ciraConfigurationService.subscribe((state) => {
      if (state.value) {
        const expected = flowStates[currentStateIndex++]
        const actual = state.value as string
        expect(actual).toEqual(expected)
        if (state.matches('SUCCESS') || state.matches('FAILURE') || currentStateIndex === flowStates.length) {
          const status = devices[clientId].status.CIRAConnection
          expect(status).toEqual('Configured')
          done()
        }
      }
    })
    ciraConfigurationService.start()
    ciraConfigurationService.send(initialEvent)
  })

  it('should fail on error response for user-initiated-connection-service', (done) => {
    const failedResponse = { Envelope: { Body: { RequestStateChange_OUTPUT: { ReturnValue: 1 } } } }
    machineConfig.actors!.userInitiatedConnectionService = fromPromise(
      async ({ input }) => await Promise.resolve(failedResponse)
    )
    const mockCiraConfigurationMachine = ciraStateMachineImpl.machine.provide(machineConfig)

    const ciraConfigurationService = createActor(mockCiraConfigurationMachine, { input: machineContext })
    ciraConfigurationService.subscribe((state) => {
      if (state.matches('SUCCESS') || state.matches('FAILURE')) {
        expect(state.matches('FAILURE')).toBeTruthy()
        done()
      }
    })
    ciraConfigurationService.start()
    ciraConfigurationService.send(initialEvent)
  })

  describe('send wsman message with Management Presence Remote SAP', () => {
    it('should send wsman message to enumerate ManagementPresenceRemoteSAP', async () => {
      await ciraStateMachineImpl.enumerateManagementPresenceRemoteSAP({ input: machineContext })
      expect(invokeWsmanCallSpy).toHaveBeenCalled()
    })

    it('should send wsman message to pull ManagementPresenceRemoteSAP', async () => {
      machineContext.message = {
        Envelope: { Body: { EnumerateResponse: { EnumerationContext: 'abcd' } } }
      }
      await ciraStateMachineImpl.pullManagementPresenceRemoteSAP({ input: machineContext })
      expect(invokeWsmanCallSpy).toHaveBeenCalled()
    })
    it('should send to add RemoteAccessService', async () => {
      machineContext.message = {
        Envelope: { Body: { PullResponse: { Items: { AMT_ManagementPresenceRemoteSAP: { Name: 'abcd' } } } } }
      }
      await ciraStateMachineImpl.addRemoteAccessPolicyRule({ input: machineContext })
      expect(invokeWsmanCallSpy).toHaveBeenCalled()
    })
    it('should log error on call to enumerateManagementPresenceRemoteSAP', async () => {
      machineContext.amt = null as any
      const loggerSpy = jest.spyOn(ciraStateMachineImpl.logger, 'error')
      await ciraStateMachineImpl.enumerateManagementPresenceRemoteSAP({ input: machineContext })
      expect(loggerSpy).toHaveBeenCalled()
    })
    it('should log error on call to pullManagementPresenceRemoteSAP', async () => {
      machineContext.amt = null as any
      const loggerSpy = jest.spyOn(ciraStateMachineImpl.logger, 'error')
      await ciraStateMachineImpl.pullManagementPresenceRemoteSAP({ input: machineContext })
      expect(loggerSpy).toHaveBeenCalled()
    })
    it('should log error on call to addRemoteAccessPolicyRule', async () => {
      machineContext.amt = null as any
      const loggerSpy = jest.spyOn(ciraStateMachineImpl.logger, 'error')
      await ciraStateMachineImpl.addRemoteAccessPolicyRule({ input: machineContext })
      expect(loggerSpy).toHaveBeenCalled()
    })
  })

  describe('send wsman message for Environment Detection Settings', () => {
    it('should send wsman message to get Environment Detection Settings', async () => {
      await ciraStateMachineImpl.getEnvironmentDetectionSettings({ input: machineContext })
      expect(invokeWsmanCallSpy).toHaveBeenCalled()
    })

    it('should send wsman message to put Environment Detection Settings', async () => {
      expect(Environment.Config.disable_cira_domain_name).toBeFalsy()
      machineContext.message = {
        Envelope: { Body: { AMT_EnvironmentDetectionSettingData: { DetectionStrings: 'abcde' } } }
      }
      await ciraStateMachineImpl.putEnvironmentDetectionSettings({ input: machineContext })
      Environment.Config.disable_cira_domain_name = 'disablethis.com'
      await ciraStateMachineImpl.putEnvironmentDetectionSettings({ input: machineContext })
      expect(invokeWsmanCallSpy).toHaveBeenCalledTimes(2)
    })
    it('should log error on call to getEnvironmentDetectionSettings', async () => {
      machineContext.amt = null as any
      const loggerSpy = jest.spyOn(ciraStateMachineImpl.logger, 'error')
      await ciraStateMachineImpl.getEnvironmentDetectionSettings({ input: machineContext })
      expect(loggerSpy).toHaveBeenCalled()
    })
    it('should log error on call to putEnvironmentDetectionSettings', async () => {
      machineContext.amt = null as any
      const loggerSpy = jest.spyOn(ciraStateMachineImpl.logger, 'error')
      await ciraStateMachineImpl.putEnvironmentDetectionSettings({ input: machineContext })
      expect(loggerSpy).toHaveBeenCalled()
    })
  })

  describe('send wsman message for Remote Access Policy Applies To MPS', () => {
    it('should send wsman message to enumerate Remote Access Policy Applies To MPS', async () => {
      await ciraStateMachineImpl.enumerateRemoteAccessPolicyAppliesToMPS({ input: machineContext })
      expect(invokeWsmanCallSpy).toHaveBeenCalled()
    })
    it('should send wsman message to pull Remote Access Policy Applies To MPS', async () => {
      machineContext.message = {
        Envelope: { Body: { EnumerateResponse: { EnumerationContext: 'abcde' } } }
      }
      await ciraStateMachineImpl.pullRemoteAccessPolicyAppliesToMPS({ input: machineContext })
      expect(invokeWsmanCallSpy).toHaveBeenCalled()
    })
    it('should send wsman message to User Initiated Connection Service', async () => {
      await ciraStateMachineImpl.userInitiatedConnectionService({ input: machineContext })
      expect(invokeWsmanCallSpy).toHaveBeenCalled()
    })
    it('should log error on call to enumerateRemoteAccessPolicyAppliesToMPS', async () => {
      machineContext.amt = null as any
      const loggerSpy = jest.spyOn(ciraStateMachineImpl.logger, 'error')
      await ciraStateMachineImpl.enumerateRemoteAccessPolicyAppliesToMPS({ input: machineContext })
      expect(loggerSpy).toHaveBeenCalled()
    })
    it('should log error on call to pullRemoteAccessPolicyAppliesToMPS', async () => {
      machineContext.amt = null as any
      const loggerSpy = jest.spyOn(ciraStateMachineImpl.logger, 'error')
      await ciraStateMachineImpl.pullRemoteAccessPolicyAppliesToMPS({ input: machineContext })
      expect(loggerSpy).toHaveBeenCalled()
    })
    it('should send wsman on call to putRemoteAccessPolicyAppliesToMPS', async () => {
      machineContext.message = pullRemoteAccessPolicyAppliesToMPSResponse
      machineContext.remoteAccessPolicies =
        machineContext.message.Envelope.Body.PullResponse.Items.AMT_RemoteAccessPolicyAppliesToMPS
      await ciraStateMachineImpl.putRemoteAccessPolicyAppliesToMPS({ input: machineContext })
      expect(invokeWsmanCallSpy).toHaveBeenCalled()
    })
    it('should log error on call to putRemoteAccessPolicyAppliesToMPS', async () => {
      machineContext.amt = null as any
      const loggerSpy = jest.spyOn(ciraStateMachineImpl.logger, 'error')
      await ciraStateMachineImpl.putRemoteAccessPolicyAppliesToMPS({ input: machineContext })
      expect(loggerSpy).toHaveBeenCalled()
    })
    it('should log error on call to userInitiatedConnectionService', async () => {
      machineContext.amt = null as any
      const loggerSpy = jest.spyOn(ciraStateMachineImpl.logger, 'error')
      await ciraStateMachineImpl.userInitiatedConnectionService({ input: machineContext })
      expect(loggerSpy).toHaveBeenCalled()
    })
  })

  describe('send wsman message to add MPS server and certificate', () => {
    beforeEach(() => {
      machineContext.ciraConfig = ciraConfig
    })
    it('should send wsman message to add Trusted Root Certificate', async () => {
      await ciraStateMachineImpl.addTrustedRootCertificate({ input: machineContext })
      expect(invokeWsmanCallSpy).toHaveBeenCalled()
    })
    it('should send wsman message to add MPS server', async () => {
      await ciraStateMachineImpl.addMPS({ input: machineContext })
      expect(invokeWsmanCallSpy).toHaveBeenCalled()
    })
    it('should log error on call to addTrustedRootCertificate', async () => {
      machineContext.amt = null as any
      const loggerSpy = jest.spyOn(ciraStateMachineImpl.logger, 'error')
      await ciraStateMachineImpl.addTrustedRootCertificate({ input: machineContext })
      expect(loggerSpy).toHaveBeenCalled()
    })
    it('should log error on call to addMPS', async () => {
      machineContext.amt = null as any
      const loggerSpy = jest.spyOn(ciraStateMachineImpl.logger, 'error')
      await ciraStateMachineImpl.addMPS({ input: machineContext })
      expect(loggerSpy).toHaveBeenCalled()
    })
  })
})
