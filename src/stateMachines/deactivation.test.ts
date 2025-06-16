/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { type MachineImplementationsSimplified, createActor, fromPromise, type StateValue } from 'xstate'
import { randomUUID } from 'node:crypto'
import { devices } from '../devices.js'
import { config } from '../test/helper/Config.js'
import { Environment } from '../utils/Environment.js'
import ClientResponseMsg from '../utils/ClientResponseMsg.js'
import { HttpHandler } from '../HttpHandler.js'
import { jest } from '@jest/globals'
import { spyOn } from 'jest-mock'
import {
  type Deactivation as DeactivationType,
  type DeactivationContext,
  type DeactivationEvent
} from './deactivation.js'
import { HttpResponseError, coalesceMessage, isDigestRealmValid } from './common.js'

const clientId = randomUUID()
const tenantId = ''
Environment.Config = config

const invokeWsmanCallSpy = jest.fn()
jest.unstable_mockModule('./common.js', () => ({
  invokeWsmanCall: invokeWsmanCallSpy,
  invokeEnterpriseAssistantCall: jest.fn(),
  HttpResponseError,
  isDigestRealmValid,
  coalesceMessage
}))
const { Deactivation } = await import('./deactivation.js')

describe('Deactivation State Machine', () => {
  let deactivation: DeactivationType
  let deactivationContext: DeactivationContext
  let config: MachineImplementationsSimplified<DeactivationContext, DeactivationEvent>
  let currentStateIndex: number
  let setupAndConfigurationServiceSpy: jest.Spied<any>
  let sendSpy: jest.Spied<any>
  let responseMessageSpy: jest.Spied<any>

  beforeEach(() => {
    deactivation = new Deactivation()
    setupAndConfigurationServiceSpy = spyOn(
      deactivation.amt.SetupAndConfigurationService,
      'Unprovision'
    ).mockImplementation(() => 'abcdef')
    responseMessageSpy = spyOn(ClientResponseMsg, 'get').mockReturnValue({} as any)
    devices[clientId] = {
      unauthCount: 0,
      ClientId: clientId,
      ClientSocket: { send: jest.fn() } as any,
      ClientData: '',
      ciraconfig: {},
      network: {},
      status: {},
      activationStatus: false,
      connectionParams: {
        guid: clientId,
        port: 16992,
        digestChallenge: null as any,
        username: 'admin',
        password: 'P@ssw0rd'
      },
      uuid: clientId,
      messageId: 1
    } as any
    deactivationContext = {
      message: '',
      clientId,
      status: 'success',
      unauthCount: 0,
      xmlMessage: '',
      errorMessage: '',
      statusMessage: '',
      tenantId,
      httpHandler: new HttpHandler()
    } as any
    sendSpy = jest.spyOn(devices[clientId].ClientSocket, 'send').mockImplementation(() => {})
    currentStateIndex = 0
    config = {
      actors: {
        invokeUnprovision: fromPromise(async ({ input }) => clientId),
        removeDeviceFromSecretProvider: fromPromise(async ({ input }) => true),
        removeDeviceFromMPS: fromPromise(async ({ input }) => true),
        errorMachine: fromPromise(async ({ input }) => clientId)
      },
      actions: {
        'Send Message to Device': () => {}
      },
      guards: {},
      delays: {}
    }
  })

  it('should eventually reach UNPROVISIONED', (done) => {
    const mockDeactivationMachine = deactivation.machine.provide(config)
    const flowStates: StateValue[] = [
      'PROVISIONED',
      'UNPROVISIONING',
      'REMOVE_DEVICE_FROM_SECRET_PROVIDER',
      'REMOVE_DEVICE_FROM_MPS',
      'UNPROVISIONED'
    ]
    const deactivationService = createActor(mockDeactivationMachine, { input: deactivationContext })
    deactivationService.subscribe((state) => {
      const currentExpectedState: any = flowStates[currentStateIndex++]
      expect(state.matches(currentExpectedState)).toBe(true)
      if (state.matches('UNPROVISIONED') && currentStateIndex === flowStates.length) {
        done()
      }
    })
    deactivationService.start()
    deactivationService.send({ type: 'UNPROVISION', clientId, tenantId, output: null, error: null })
  })
  it('should eventually reach "UNPROVISIONED" when service provider gives not found error', (done) => {
    config.actors!.removeDeviceFromSecretPprovider = fromPromise(
      async ({ input }) => await Promise.reject(new Error('HTTPError: Response code 404 (Not Found)'))
    )
    config.actors!.removeDeviceFromMPS = fromPromise(async ({ input }) => await Promise.resolve(true))
    const mockDeactivationMachine = deactivation.machine.provide(config)
    const flowStates = [
      'PROVISIONED',
      'UNPROVISIONING',
      'REMOVE_DEVICE_FROM_SECRET_PROVIDER',
      'REMOVE_DEVICE_FROM_MPS',
      'UNPROVISIONED'
    ]
    const deactivationService = createActor(mockDeactivationMachine, { input: deactivationContext })
    deactivationService.subscribe((state) => {
      const currentExpectedState: any = flowStates[currentStateIndex++]
      expect(state.matches(currentExpectedState)).toBe(true)
      if (state.matches('UNPROVISIONED') && currentStateIndex === flowStates.length) {
        done()
      }
    })

    deactivationService.start()
    deactivationService.send({ type: 'UNPROVISION', clientId, tenantId, output: null, error: null })
  })
  it('should eventually reach "UNPROVISIONED" when mps not running', (done) => {
    config.actors!.removeDeviceFromMPS = fromPromise(
      async ({ input }) => await Promise.reject(new Error('RequestError: getaddrinfo EAI_AGAIN mps'))
    )
    const mockDeactivationMachine = deactivation.machine.provide(config)
    const flowStates = [
      'PROVISIONED',
      'UNPROVISIONING',
      'REMOVE_DEVICE_FROM_SECRET_PROVIDER',
      'REMOVE_DEVICE_FROM_MPS',
      'UNPROVISIONED'
    ]
    const deactivationService = createActor(mockDeactivationMachine, { input: deactivationContext })
    deactivationService.subscribe((state) => {
      expect(state.matches(flowStates[currentStateIndex++] as any)).toBe(true)
      if (state.matches('UNPROVISIONED') && currentStateIndex === flowStates.length) {
        done()
      }
    })

    deactivationService.start()
    deactivationService.send({ type: 'UNPROVISION', clientId, tenantId, output: null, error: null })
  })
  it('should eventually reach "Unprovisioned" when mps running and device is not found', (done) => {
    config.actors!.removeDeviceFromMPS = fromPromise(
      async ({ input }) => await Promise.reject(new Error('HTTPError: Response code 404 (Not Found)'))
    )
    const mockDeactivationMachine = deactivation.machine.provide(config)
    const flowStates = [
      'PROVISIONED',
      'UNPROVISIONING',
      'REMOVE_DEVICE_FROM_SECRET_PROVIDER',
      'REMOVE_DEVICE_FROM_MPS',
      'UNPROVISIONED'
    ]
    const deactivationService = createActor(mockDeactivationMachine, { input: deactivationContext })
    deactivationService.subscribe((state) => {
      expect(state.matches(flowStates[currentStateIndex++] as any)).toBe(true)
      if (state.matches('UNPROVISIONED') && currentStateIndex === flowStates.length) {
        done()
      }
    })

    deactivationService.start()
    deactivationService.send({ type: 'UNPROVISION', clientId, tenantId, output: null, error: null })
  })
  it('should eventually reach "Failed"', (done) => {
    config.actors!.invokeUnprovision = fromPromise(async ({ input }) => await Promise.reject(new Error()))
    config.actors!.errorMachine = fromPromise(
      async ({ input }) =>
        await new Promise((resolve, reject) => {
          setTimeout(() => {
            deactivationService.send({ type: 'ONFAILED', clientId, tenantId, output: null, error: null })
            reject(new Error())
          }, 50)
        })
    )
    const mockDeactivationMachine = deactivation.machine.provide(config)
    const flowStates = [
      'PROVISIONED',
      'UNPROVISIONING',
      'ERROR',
      'FAILED'
    ]
    const deactivationService = createActor(mockDeactivationMachine, { input: deactivationContext })
    deactivationService.subscribe((state) => {
      // assert that effects were executed
      expect(state.matches(flowStates[currentStateIndex++] as any)).toBe(true)
      if (state.matches('FAILED') && currentStateIndex === flowStates.length) {
        done()
      }
    })

    deactivationService.start()
    deactivationService.send({ type: 'UNPROVISION', clientId, tenantId, output: null, error: null })
  })

  it('should invoke unprovision and return promise', async () => {
    await deactivation.invokeUnprovision({ input: deactivationContext })
    expect(setupAndConfigurationServiceSpy).toHaveBeenCalled()
    expect(deactivationContext.xmlMessage).toBe('abcdef')
    expect(invokeWsmanCallSpy).toHaveBeenCalledWith(deactivationContext)
  })

  it('should send success message to device', () => {
    deactivation.sendMessageToDevice({ context: deactivationContext })
    expect(responseMessageSpy).toHaveBeenCalledWith(
      deactivationContext.clientId,
      null,
      deactivationContext.status,
      'success',
      JSON.stringify(devices[clientId].status)
    )
    expect(sendSpy).toHaveBeenCalled()
  })

  it('should send error message to device', () => {
    deactivationContext.status = 'error'
    deactivation.sendMessageToDevice({ context: deactivationContext })
    expect(responseMessageSpy).toHaveBeenCalledWith(
      deactivationContext.clientId,
      null,
      deactivationContext.status,
      'failed',
      JSON.stringify(devices[clientId].status)
    )
    expect(sendSpy).toHaveBeenCalled()
  })

  it('should eventually reach "PROVISIONED"', (done) => {
    const service = createActor(deactivation.machine, { input: deactivationContext })
    service.subscribe((state) => {
      if (state.matches('PROVISIONED')) {
        expect(state.matches('PROVISIONED')).toBe(true)
        done()
      }
    })
    service.start()
    service.send({ type: 'UNPROVISION', clientId, tenantId, output: null, error: null })
  })
})
