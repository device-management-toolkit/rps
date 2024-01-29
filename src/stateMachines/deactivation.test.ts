/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { interpret } from 'xstate'
import { randomUUID } from 'node:crypto'
import { devices } from '../devices.js'
import { config } from '../test/helper/Config.js'
import { Environment } from '../utils/Environment.js'
import ClientResponseMsg from '../utils/ClientResponseMsg.js'
import { HttpHandler } from '../HttpHandler.js'
import { jest } from '@jest/globals'
import { type SpyInstance, spyOn } from 'jest-mock'
import { type Deactivation as DeactivationType, type DeactivationContext } from './deactivation.js'

const clientId = randomUUID()
const tenantId = ''
Environment.Config = config

const invokeWsmanCallSpy = jest.fn()
jest.unstable_mockModule('./common.js', () => ({
  invokeWsmanCall: invokeWsmanCallSpy,
  invokeEnterpriseAssistantCall: jest.fn(),
  invokeUnprovision: jest.fn()
}))

const { Deactivation } = await import('./deactivation.js')

describe('Deactivation State Machine', () => {
  let deactivation: DeactivationType
  let deactivationContext: DeactivationContext
  let config
  let currentStateIndex: number
  let setupAndConfigurationServiceSpy: SpyInstance<any>
  let sendSpy: SpyInstance<any>
  let responseMessageSpy: SpyInstance<any>
  beforeEach(() => {
    deactivation = new Deactivation()
    setupAndConfigurationServiceSpy = spyOn(deactivation.amt.SetupAndConfigurationService, 'Unprovision').mockImplementation(() => 'abcdef')
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
    }
    sendSpy = jest.spyOn(devices[clientId].ClientSocket, 'send').mockImplementation(() => {})
    currentStateIndex = 0
    config = {
      services: {
        'send-unprovision-message': Promise.resolve(clientId),
        'remove-device-from-secret-provider': Promise.resolve(true),
        'remove-device-from-mps': Promise.resolve(true),
        'error-machine': Promise.resolve(clientId)
      },
      actions: {
        'Send Message to Device': () => {}
      }
    }
  })

  it('should eventually reach "UNPROVISIONED"', (done) => {
    const mockDeactivationMachine = deactivation.machine.withConfig(config).withContext(deactivationContext)
    const flowStates = [
      'PROVISIONED',
      'UNPROVISIONING',
      'REMOVE_DEVICE_FROM_SECRET_PROVIDER',
      'REMOVE_DEVICE_FROM_MPS',
      'UNPROVISIONED'
    ]
    const deactivationService = interpret(mockDeactivationMachine).onTransition((state) => {
      expect(state.matches(flowStates[currentStateIndex++])).toBe(true)
      if (state.matches('UNPROVISIONED') && currentStateIndex === flowStates.length) {
        done()
      }
    })

    deactivationService.start()
    deactivationService.send({ type: 'UNPROVISION', clientId, tenantId, data: null })
  })
  it('should eventually reach "UNPROVISIONED" when service provider gives not found error', (done) => {
    config.services['remove-device-from-secret-provider'] = Promise.reject(new Error('HTTPError: Response code 404 (Not Found)'))
    config.services['remove-device-from-mps'] = Promise.resolve(true)
    const mockDeactivationMachine = deactivation.machine.withConfig(config).withContext(deactivationContext)
    const flowStates = [
      'PROVISIONED',
      'UNPROVISIONING',
      'REMOVE_DEVICE_FROM_SECRET_PROVIDER',
      'REMOVE_DEVICE_FROM_MPS',
      'UNPROVISIONED'
    ]
    const deactivationService = interpret(mockDeactivationMachine).onTransition((state) => {
      expect(state.matches(flowStates[currentStateIndex++])).toBe(true)
      if (state.matches('UNPROVISIONED') && currentStateIndex === flowStates.length) {
        done()
      }
    })

    deactivationService.start()
    deactivationService.send({ type: 'UNPROVISION', clientId, tenantId, data: null })
  })
  it('should eventually reach "UNPROVISIONED" when mps not running', (done) => {
    config.services['remove-device-from-mps'] = Promise.reject(new Error('RequestError: getaddrinfo EAI_AGAIN mps'))
    const mockDeactivationMachine = deactivation.machine.withConfig(config).withContext(deactivationContext)
    const flowStates = [
      'PROVISIONED',
      'UNPROVISIONING',
      'REMOVE_DEVICE_FROM_SECRET_PROVIDER',
      'REMOVE_DEVICE_FROM_MPS',
      'UNPROVISIONED'
    ]
    const deactivationService = interpret(mockDeactivationMachine).onTransition((state) => {
      expect(state.matches(flowStates[currentStateIndex++])).toBe(true)
      if (state.matches('UNPROVISIONED') && currentStateIndex === flowStates.length) {
        done()
      }
    })

    deactivationService.start()
    deactivationService.send({ type: 'UNPROVISION', clientId, tenantId, data: null })
  })
  it('should eventually reach "Unprovisioned" when mps running and device is not found', (done) => {
    config.services['remove-device-from-mps'] = Promise.reject(new Error('HTTPError: Response code 404 (Not Found)'))
    const mockDeactivationMachine = deactivation.machine.withConfig(config).withContext(deactivationContext)
    const flowStates = [
      'PROVISIONED',
      'UNPROVISIONING',
      'REMOVE_DEVICE_FROM_SECRET_PROVIDER',
      'REMOVE_DEVICE_FROM_MPS',
      'UNPROVISIONED'
    ]
    const deactivationService = interpret(mockDeactivationMachine).onTransition((state) => {
      console.log(state.value)
      expect(state.matches(flowStates[currentStateIndex++])).toBe(true)
      if (state.matches('UNPROVISIONED') && currentStateIndex === flowStates.length) {
        done()
      }
    })

    deactivationService.start()
    deactivationService.send({ type: 'UNPROVISION', clientId, tenantId, data: null })
  })
  it('should eventually reach "Failed"', (done) => {
    config.services['send-unprovision-message'] = Promise.reject(new Error())
    config.services['error-machine'] = async (_, event) => await new Promise((resolve, reject) => {
      setTimeout(() => {
        deactivationService.send({ type: 'ONFAILED', clientId, tenantId, data: null })
        reject(new Error())
      }, 50)
    })
    const mockDeactivationMachine = deactivation.machine.withConfig(config)
    const flowStates = ['PROVISIONED', 'UNPROVISIONING', 'ERROR', 'FAILED']
    const deactivationService = interpret(mockDeactivationMachine).onTransition((state) => {
    // assert that effects were executed
      expect(state.matches(flowStates[currentStateIndex++])).toBe(true)
      if (state.matches('FAILED') && currentStateIndex === flowStates.length) {
        done()
      }
    })

    deactivationService.start()
    deactivationService.send({ type: 'UNPROVISION', clientId, tenantId, data: null })
  })

  it('should invoke unprovision and return promise', async () => {
    await deactivation.invokeUnprovision(deactivationContext)
    expect(setupAndConfigurationServiceSpy).toHaveBeenCalled()
    expect(deactivationContext.xmlMessage).toBe('abcdef')
    expect(invokeWsmanCallSpy).toHaveBeenCalledWith(deactivationContext)
  })

  it('should send success message to device', () => {
    deactivation.sendMessageToDevice(deactivationContext, null as any)
    expect(responseMessageSpy).toHaveBeenCalledWith(deactivationContext.clientId, null, deactivationContext.status, 'success', JSON.stringify(devices[clientId].status))
    expect(sendSpy).toHaveBeenCalled()
  })

  it('should send error message to device', () => {
    deactivationContext.status = 'error'
    deactivation.sendMessageToDevice(deactivationContext, null as any)
    expect(responseMessageSpy).toHaveBeenCalledWith(deactivationContext.clientId, null, deactivationContext.status, 'failed', JSON.stringify(devices[clientId].status))
    expect(sendSpy).toHaveBeenCalled()
  })

  it('should eventually reach "PROVISIONED"', (done) => {
    const service = interpret(deactivation.machine).onTransition((state) => {
      if (state.matches('PROVISIONED')) {
        expect(state.matches('PROVISIONED')).toBe(true)
        done()
      }
    })
    service.start()
    service.send({ type: 'UNPROVISION', clientId, tenantId, data: null })
  })
})
