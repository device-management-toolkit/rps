/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import {
  type FeatureContext,
  type FeaturesConfiguration as FeaturesConfigurationType,
  type FeatureEvent
} from './featuresConfiguration.js'
import { ClientAction } from '../models/RCS.Config.js'
import {
  type AMTConfiguration,
  AMTRedirectionServiceEnabledStates,
  AMTUserConsent,
  AMTUserConsentValues
} from '../models/index.js'
import { randomUUID } from 'node:crypto'
import { devices } from '../devices.js'
import { HttpHandler } from '../HttpHandler.js'
import { type MachineImplementationsSimplified, createActor, fromPromise } from 'xstate'
import { AMT, CIM, IPS } from '@device-management-toolkit/wsman-messages'
import { jest } from '@jest/globals'

const invokeWsmanCallSpy = jest.fn<any>()
jest.unstable_mockModule('./common.js', () => ({
  invokeWsmanCall: invokeWsmanCallSpy
}))

const { FeaturesConfiguration } = await import('./featuresConfiguration.js')

describe('Features State Machine', () => {
  let clientId: string
  let amtConfiguration: AMTConfiguration
  let featuresConfiguration: FeaturesConfigurationType
  let amtRedirectionSvcJson
  let ipsOptInsSvcJson
  let kvmRedirectionSvcJson
  let currentStateIndex = 0
  let machineConfig: MachineImplementationsSimplified<FeatureContext, FeatureEvent>
  let context: FeatureContext
  beforeEach(() => {
    clientId = randomUUID()
    devices[clientId] = {
      unauthCount: 0,
      ClientId: clientId,
      ClientSocket: { send: jest.fn() } as any,
      ClientData: {},
      status: {},
      uuid: '4bac9510-04a6-4321-bae2-d45ddf07b684',
      activationStatus: false,
      connectionParams: {
        guid: '4c4c4544-004b-4210-8033-b6c04f504633',
        port: 16992,
        digestChallenge: {
          realm: 'Digest:AF541D9BC94CFF7ADFA073F492F355E6',
          nonce: 'dxNzCQ9JBAAAAAAAd2N7c6tYmUl0FFzQ',
          stale: 'false',
          qop: 'auth'
        },
        username: 'admin',
        password: 'P@ssw0rd'
      },
      messageId: 1
    } as any
    const promise = new Promise((resolve, reject) => {
      devices[clientId].resolve = resolve
      devices[clientId].reject = reject
    })
    devices[clientId].pendingPromise = promise

    amtConfiguration = {
      profileName: 'test-',
      activation: ClientAction.ADMINCTLMODE,
      userConsent: AMTUserConsent.ALL,
      solEnabled: true,
      iderEnabled: true,
      kvmEnabled: true,
      generateRandomPassword: false,
      generateRandomMEBxPassword: false,
      ciraConfigName: 'config1',
      tenantId: ''
    }
    setDefaultResponses()
    context = {
      clientId,
      amtConfiguration,
      httpHandler: new HttpHandler(),
      statusMessage: '',
      xmlMessage: '',
      isOptInServiceChanged: false,
      isRedirectionChanged: false,
      amt: new AMT.Messages(),
      cim: new CIM.Messages(),
      ips: new IPS.Messages()
    }
    featuresConfiguration = new FeaturesConfiguration()
    currentStateIndex = 0
    machineConfig = {
      actors: {
        getAmtRedirectionService: fromPromise(
          async ({ input }) =>
            await Promise.resolve({ Envelope: { Body: { AMT_RedirectionService: amtRedirectionSvcJson } } })
        ),
        getIpsOptInService: fromPromise(
          async ({ input }) => await Promise.resolve({ Envelope: { Body: { IPS_OptInService: ipsOptInsSvcJson } } })
        ),
        getCimKvmRedirectionSAP: fromPromise(
          async ({ input }) =>
            await Promise.resolve({ Envelope: { Body: { CIM_KVMRedirectionSAP: kvmRedirectionSvcJson } } })
        ),
        setRedirectionService: fromPromise(async ({ input }) => await Promise.resolve({ clientId })),
        putRedirectionService: fromPromise(async ({ input }) => await Promise.resolve({ clientId })),
        putIpsOptInService: fromPromise(async ({ input }) => await Promise.resolve({ clientId }))
      },
      actions: {},
      guards: {},
      delays: {}
    }
  })

  it('Should configure AMT features when default', (done) => {
    const mockFeaturesMachine = featuresConfiguration.machine.provide(machineConfig)
    const flowStates = [
      'DEFAULT_FEATURES',
      'GET_AMT_REDIRECTION_SERVICE',
      'GET_IPS_OPT_IN_SERVICE',
      'GET_CIM_KVM_REDIRECTION_SAP',
      'SET_REDIRECTION_SERVICE',
      'SET_KVM_REDIRECTION_SAP',
      'PUT_REDIRECTION_SERVICE',
      'PUT_IPS_OPT_IN_SERVICE',
      'SUCCESS'
    ]
    const featuresService = createActor(mockFeaturesMachine, { input: context })
    featuresService.subscribe((state) => {
      const expectedState: any = flowStates[currentStateIndex++]
      expect(state.matches(expectedState)).toBe(true)
      if (state.matches('SUCCESS') && currentStateIndex === flowStates.length) {
        done()
      }
    })

    featuresService.start()
    featuresService.send({ type: 'CONFIGURE_FEATURES', clientId })
  })
  it('Should configure AMT features when ONLY_IDER', (done) => {
    amtRedirectionSvcJson.EnabledState = AMTRedirectionServiceEnabledStates.ONLY_IDER
    context.amtConfiguration.solEnabled = false

    const mockFeaturesMachine = featuresConfiguration.machine.provide(machineConfig)
    const flowStates = [
      'DEFAULT_FEATURES',
      'GET_AMT_REDIRECTION_SERVICE',
      'GET_IPS_OPT_IN_SERVICE',
      'GET_CIM_KVM_REDIRECTION_SAP',
      'SET_REDIRECTION_SERVICE',
      'SET_KVM_REDIRECTION_SAP',
      'PUT_REDIRECTION_SERVICE',
      'PUT_IPS_OPT_IN_SERVICE',
      'SUCCESS'
    ]
    const featuresService = createActor(mockFeaturesMachine, { input: context })
    featuresService.subscribe((state) => {
      const expectedState: any = flowStates[currentStateIndex++]
      expect(state.matches(expectedState)).toBe(true)
      if (state.matches('SUCCESS') && currentStateIndex === flowStates.length) {
        done()
      }
    })

    featuresService.start()
    featuresService.send({ type: 'CONFIGURE_FEATURES', clientId })
  })
  it('Should configure AMT features when ONLY_SOL', (done) => {
    amtRedirectionSvcJson.EnabledState = AMTRedirectionServiceEnabledStates.ONLY_SOL
    context.amtConfiguration.iderEnabled = false
    const mockFeaturesMachine = featuresConfiguration.machine.provide(machineConfig)
    const flowStates = [
      'DEFAULT_FEATURES',
      'GET_AMT_REDIRECTION_SERVICE',
      'GET_IPS_OPT_IN_SERVICE',
      'GET_CIM_KVM_REDIRECTION_SAP',
      'SET_REDIRECTION_SERVICE',
      'SET_KVM_REDIRECTION_SAP',
      'PUT_REDIRECTION_SERVICE',
      'PUT_IPS_OPT_IN_SERVICE',
      'SUCCESS'
    ]
    const featuresService = createActor(mockFeaturesMachine, { input: context })
    featuresService.subscribe((state) => {
      const expectedState: any = flowStates[currentStateIndex++]
      expect(state.matches(expectedState)).toBe(true)
      if (state.matches('SUCCESS') && currentStateIndex === flowStates.length) {
        done()
      }
    })

    featuresService.start()
    featuresService.send({ type: 'CONFIGURE_FEATURES', clientId })
  })

  it('Should NOT configure AMT features when failure', (done) => {
    machineConfig.actors!.getAmtRedirectionService = fromPromise(
      async ({ input }) => await Promise.reject(new Error('FAILURE'))
    )
    const mockFeaturesMachine = featuresConfiguration.machine.provide(machineConfig)
    const flowStates = [
      'DEFAULT_FEATURES',
      'GET_AMT_REDIRECTION_SERVICE',
      'FAILED'
    ]
    const featuresService = createActor(mockFeaturesMachine, { input: context })
    featuresService.subscribe((state) => {
      const expectedState: any = flowStates[currentStateIndex++]
      expect(state.matches(expectedState)).toBe(true)
      if (state.matches('FAILED') && currentStateIndex === flowStates.length) {
        done()
      }
    })

    featuresService.start()
    featuresService.send({ type: 'CONFIGURE_FEATURES', clientId })
  })
  it('getAmtRedirectionService', async () => {
    await featuresConfiguration.getAmtRedirectionService({ input: context })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })
  it('getIpsOptInService', async () => {
    await featuresConfiguration.getIpsOptInService({ input: context })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })
  it('getCimKvmRedirectionSAP', async () => {
    await featuresConfiguration.getCimKvmRedirectionSAP({ input: context })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })
  it('setRedirectionService', async () => {
    context.AMT_RedirectionService = amtRedirectionSvcJson
    await featuresConfiguration.setRedirectionService({ input: context })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })
  it('setKvmRedirectionSap', async () => {
    context.CIM_KVMRedirectionSAP = kvmRedirectionSvcJson
    await featuresConfiguration.setKvmRedirectionSap({ input: context })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })
  it('putRedirectionService', async () => {
    context.AMT_RedirectionService = amtRedirectionSvcJson
    await featuresConfiguration.putRedirectionService({ input: context })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })
  it('putIpsOptInService', async () => {
    context.IPS_OptInService = ipsOptInsSvcJson
    await featuresConfiguration.putIpsOptInService({ input: context })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })
  function setDefaultResponses(): void {
    amtRedirectionSvcJson = {
      CreationClassName: 'AMT_RedirectionService',
      ElementName: 'Intel(r) AMT Redirection Service',
      EnabledState: AMTRedirectionServiceEnabledStates.BOTH_IDER_SOL,
      ListenerEnabled: false,
      Name: 'Intel(r) AMT Redirection Service',
      SystemCreationClassName: 'CIM_ComputerSystem',
      SystemName: 'Intel(r) AMT'
    }
    ipsOptInsSvcJson = {
      CanModifyOptInPolicy: 1,
      CreationClassName: 'IPS_OptInService',
      ElementName: 'Intel(r) AMT OptIn Service',
      Name: 'Intel(r) AMT OptIn Service',
      OptInCodeTimeout: 120,
      OptInDisplayTimeout: 300,
      OptInRequired: AMTUserConsentValues.KVM,
      OptInState: 0,
      SystemCreationClassName: 'CIM_ComputerSystem',
      SystemName: 'Intel(r) AMT'
    }
    kvmRedirectionSvcJson = {
      CreationClassName: 'CIM_KVMRedirectionSAP',
      ElementName: 'KVM Redirection Service Access Point',
      EnabledState: 3,
      KVMProtocol: 4,
      Name: 'KVM Redirection Service Access Point',
      RequestedState: 5,
      SystemCreationClassName: 'CIM_ComputerSystem',
      SystemName: 'ManagedSystem'
    }
  }
})
