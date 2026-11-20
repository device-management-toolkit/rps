/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { type MachineImplementationsSimplified, createActor, fromPromise, type StateValue, waitFor } from 'xstate'
import { randomUUID } from 'node:crypto'
import { devices } from '../devices.js'
import { config } from '../test/helper/Config.js'
import { Environment } from '../utils/Environment.js'
import ClientResponseMsg from '../utils/ClientResponseMsg.js'
import { HttpHandler } from '../HttpHandler.js'

import { vi, type MockInstance } from 'vitest'
import {
  type Deactivation as DeactivationType,
  type DeactivationContext,
  type DeactivationEvent
} from './deactivation.js'
import { HttpResponseError, coalesceMessage, isDigestRealmValid } from './common.js'

const clientId = randomUUID()
const tenantId = ''
Environment.Config = config

const invokeWsmanCallSpy = vi.hoisted(() => vi.fn())
vi.mock('./common.js', async () => {
  const actual = await vi.importActual<typeof import('./common.js')>('./common.js')
  const { HttpResponseError, coalesceMessage, isDigestRealmValid } = actual
  return {
    invokeWsmanCall: invokeWsmanCallSpy,
    invokeEnterpriseAssistantCall: vi.fn(),
    processTLSTunnelResponse: vi.fn(),
    resolveStatusError: actual.resolveStatusError,
    reportProvisioningFailure: actual.reportProvisioningFailure,
    failAt: actual.failAt,
    returnValueOf: actual.returnValueOf,
    buildFailure: actual.buildFailure,

    stepFailure: actual.stepFailure,

    failureAfterErrorMachine: actual.failureAfterErrorMachine,
    HttpResponseError,
    isDigestRealmValid,
    coalesceMessage
  }
})
const { Deactivation } = await import('./deactivation.js')

describe('Deactivation State Machine', () => {
  let deactivation: DeactivationType
  let deactivationContext: DeactivationContext
  let config: MachineImplementationsSimplified<DeactivationContext, DeactivationEvent>
  let currentStateIndex: number
  let setupAndConfigurationServiceSpy: MockInstance
  let sendSpy: MockInstance
  let responseMessageSpy: MockInstance

  beforeEach(() => {
    deactivation = new Deactivation()
    setupAndConfigurationServiceSpy = vi
      .spyOn(deactivation.amt.SetupAndConfigurationService, 'Unprovision')
      .mockImplementation(() => 'abcdef')
    responseMessageSpy = vi.spyOn(ClientResponseMsg, 'get').mockReturnValue({} as any)
    devices[clientId] = {
      unauthCount: 0,
      ClientId: clientId,
      ClientSocket: { send: vi.fn() } as any,
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
    sendSpy = vi.spyOn(devices[clientId].ClientSocket, 'send').mockImplementation(() => {})
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

  it('should eventually reach UNPROVISIONED', () =>
    new Promise<void>((resolve, reject) => {
      const mockDeactivationMachine = deactivation.machine.provide(config)
      const flowStates: StateValue[] = [
        'PROVISIONED',
        'UNPROVISIONING',
        'REMOVE_DEVICE_FROM_SECRET_PROVIDER',
        'REMOVE_DEVICE_FROM_MPS',
        'UNPROVISIONED'
      ]
      const deactivationService = createActor(mockDeactivationMachine, { input: deactivationContext })
      deactivationService.subscribe({
        next: (state) => {
          try {
            const currentExpectedState: any = flowStates[currentStateIndex++]
            expect(state.matches(currentExpectedState)).toBe(true)
            if (state.matches('UNPROVISIONED') && currentStateIndex === flowStates.length) {
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
      deactivationService.start()
      deactivationService.send({ type: 'UNPROVISION', clientId, tenantId, output: null, error: null })
    }))
  it('should eventually reach "UNPROVISIONED" when service provider gives not found error', () =>
    new Promise<void>((resolve, reject) => {
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
      deactivationService.subscribe({
        next: (state) => {
          try {
            const currentExpectedState: any = flowStates[currentStateIndex++]
            expect(state.matches(currentExpectedState)).toBe(true)
            if (state.matches('UNPROVISIONED') && currentStateIndex === flowStates.length) {
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

      deactivationService.start()
      deactivationService.send({ type: 'UNPROVISION', clientId, tenantId, output: null, error: null })
    }))
  it('should eventually reach "UNPROVISIONED" when mps not running', () =>
    new Promise<void>((resolve, reject) => {
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
      deactivationService.subscribe({
        next: (state) => {
          try {
            expect(state.matches(flowStates[currentStateIndex++] as any)).toBe(true)
            if (state.matches('UNPROVISIONED') && currentStateIndex === flowStates.length) {
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

      deactivationService.start()
      deactivationService.send({ type: 'UNPROVISION', clientId, tenantId, output: null, error: null })
    }))
  it('should eventually reach "Unprovisioned" when mps running and device is not found', () =>
    new Promise<void>((resolve, reject) => {
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
      deactivationService.subscribe({
        next: (state) => {
          try {
            expect(state.matches(flowStates[currentStateIndex++] as any)).toBe(true)
            if (state.matches('UNPROVISIONED') && currentStateIndex === flowStates.length) {
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

      deactivationService.start()
      deactivationService.send({ type: 'UNPROVISION', clientId, tenantId, output: null, error: null })
    }))
  it('should eventually reach "Failed"', () =>
    new Promise<void>((resolve, reject) => {
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
      deactivationService.subscribe({
        next: (state) => {
          try {
            // assert that effects were executed
            expect(state.matches(flowStates[currentStateIndex++] as any)).toBe(true)
            if (state.matches('FAILED') && currentStateIndex === flowStates.length) {
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

      deactivationService.start()
      deactivationService.send({ type: 'UNPROVISION', clientId, tenantId, output: null, error: null })
    }))

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

  it('sends a structured Error block carrying the failing step and code on error', () => {
    deactivationContext.status = 'error'
    deactivationContext.errorMessage = 'Failed to remove device from secret provider'
    deactivationContext.failure = {
      Code: 'RPS_SECRETS_DELETE_FAILED',
      Component: 'Deactivation',
      Step: 'REMOVE_DEVICE_FROM_SECRET_PROVIDER',
      Reason: 'Secret could not be deleted from the secret provider',
      Detail: 'vault down'
    }
    const errorLogSpy = vi.spyOn(deactivation.logger, 'error')
    deactivation.sendMessageToDevice({ context: deactivationContext })

    const sentPayload = JSON.parse(responseMessageSpy.mock.calls[0][4])
    // Legacy flat text is unchanged; the structured block rides alongside it.
    expect(sentPayload.Status).toEqual('Failed to remove device from secret provider')
    // Detail is dropped from the wire for RPS_* codes; it stays in the log line.
    expect(sentPayload.Error).toEqual({
      Code: 'RPS_SECRETS_DELETE_FAILED',
      Component: 'Deactivation',
      Step: 'REMOVE_DEVICE_FROM_SECRET_PROVIDER',
      Reason: 'Secret could not be deleted from the secret provider'
    })
    const failureLine = errorLogSpy.mock.calls
      .map((c) => c[0] as string)
      .find((l) => l.startsWith('Provisioning failure: '))
    expect(failureLine).toBeDefined()
    expect(JSON.parse(failureLine!.replace('Provisioning failure: ', ''))).toMatchObject({
      flow: 'deactivation',
      clientId,
      ...deactivationContext.failure
    })
    expect(sendSpy).toHaveBeenCalled()
  })

  it('falls back to RPS_DEACTIVATION_FAILED when the context has no structured failure', () => {
    deactivationContext.status = 'error'
    deactivationContext.errorMessage = 'Failed'
    deactivationContext.failure = undefined
    deactivation.sendMessageToDevice({ context: deactivationContext })

    const sentPayload = JSON.parse(responseMessageSpy.mock.calls[0][4])
    expect(sentPayload.Error).toMatchObject({
      Code: 'RPS_DEACTIVATION_FAILED',
      Component: 'Deactivation',
      Step: 'UNKNOWN'
    })
  })

  it('does not resend the Error block of an earlier failed attempt on success', () => {
    deactivationContext.status = 'success'
    devices[clientId].status = {
      Status: 'Failed',
      Error: {
        Code: 'RPS_SECRETS_DELETE_FAILED',
        Component: 'Deactivation',
        Step: 'REMOVE_DEVICE_FROM_SECRET_PROVIDER',
        Reason: 'Secret could not be deleted from the secret provider'
      }
    }
    deactivation.sendMessageToDevice({ context: deactivationContext })

    const sentPayload = JSON.parse(responseMessageSpy.mock.calls[0][4])
    expect(sentPayload.Status).toEqual('Deactivated')
    expect(sentPayload.Error).toBeUndefined()
  })

  it('should eventually reach "PROVISIONED"', () =>
    new Promise<void>((resolve, reject) => {
      const service = createActor(deactivation.machine, { input: deactivationContext })
      service.subscribe({
        next: (state) => {
          try {
            if (state.matches('PROVISIONED')) {
              expect(state.matches('PROVISIONED')).toBe(true)
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
      service.send({ type: 'UNPROVISION', clientId, tenantId, output: null, error: null })
    }))
  it('records a structured failure when the secret provider delete fails', async () => {
    config.actors!.removeDeviceFromSecretProvider = fromPromise(
      async () => await Promise.reject(new Error('vault down'))
    )
    config.guards = { ...config.guards, isNotFound: () => false }
    const service = createActor(deactivation.machine.provide(config), { input: deactivationContext })
    service.start()
    service.send({ type: 'UNPROVISION', clientId, tenantId, output: null, error: null })
    const snapshot = await waitFor(service, (s) => s.status === 'done')
    expect(snapshot.value).toBe('FAILED')
    expect(snapshot.context.errorMessage).toBe('Failed to remove device from secret provider')
    expect(snapshot.context.failure).toEqual({
      Code: 'RPS_SECRETS_DELETE_FAILED',
      Component: 'Deactivation',
      Step: 'REMOVE_DEVICE_FROM_SECRET_PROVIDER',
      Reason: 'Secret could not be deleted from the secret provider',
      Detail: 'vault down'
    })
  })
})
