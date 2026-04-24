/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { HttpResponseError } from '../common.js'
import { createActor, waitFor } from 'xstate'

import { Environment } from '../../utils/Environment.js'
import { config, setupTestClient } from '../../test/helper/Config.js'
import Logger from '../../Logger.js'
import { type SyncTimeEvent, SyncTimeEventType } from './syncTime.js'
import { type HostNameInfo } from './syncHostName.js'
import { type DeviceInfo } from './syncDeviceInfo.js'

import { vi } from 'vitest'
import { HttpHandler } from '../../HttpHandler.js'
import { type MachineImplementationsSimplified, fromPromise } from 'xstate'
import { type DoneResponse, StatusFailed } from './doneResponse.js'
import { type Maintenance as MaintenanceType, type MaintenanceContext, type MaintenanceEvent } from './maintenance.js'

const invokeWsmanCallSpy = vi.hoisted(() => vi.fn<any>())
vi.mock('../common.js', async () => {
  const actual = await vi.importActual<typeof import('../common.js')>('../common.js')
  const { HttpResponseError } = actual
  return {
    invokeWsmanCall: invokeWsmanCallSpy,
    coalesceMessage: vi.fn(),
    isDigestRealmValid: vi.fn(),
    HttpResponseError: vi.fn()
  }
})
const { Maintenance } = await import('./maintenance.js')

Environment.Config = config
describe('Maintenance State Machine', () => {
  const HttpBadRequestError = new HttpResponseError('Bad Request', 400)
  const clientId = setupTestClient()
  let currentStateIndex: number
  let implementation: MaintenanceType
  let implementationConfig: MachineImplementationsSimplified<MaintenanceContext, MaintenanceEvent>
  let context: MaintenanceContext
  let hostNameInfo: HostNameInfo
  let deviceInfo: DeviceInfo

  beforeEach(() => {
    currentStateIndex = 0
    implementation = new Maintenance()
    hostNameInfo = { dnsSuffixOS: '' }
    deviceInfo = {
      ver: '16.1.1',
      build: '1111',
      sku: '16xxx',
      currentMode: '0',
      features: 'AMT Pro Corprate',
      ipConfiguration: { ipAddress: '1.1.1.1' }
    }
    context = {
      clientId: '',
      doneData: {},
      httpHandler: new HttpHandler()
    }
    implementationConfig = {
      actors: {
        changePassword: fromPromise(async ({ input }) => await Promise.resolve({ status: 'SUCCESS' })),
        syncIP: fromPromise(async ({ input }) => await Promise.resolve({ status: 'SUCCESS' })),
        syncTime: fromPromise(async ({ input }) => await Promise.resolve({ taskName: 'synctime', status: 'SUCCESS' })),
        syncHostName: fromPromise(async ({ input }) => await Promise.resolve({ status: 'SUCCESS' })),
        syncDeviceInfo: fromPromise(async ({ input }) => await Promise.resolve({ status: 'SUCCESS' }))
      },
      actions: {},
      guards: {},
      delays: {}
    }
  })
  afterEach(() => {
    vi.resetAllMocks()
    vi.clearAllMocks()
  })
  it('ChangePassword should eventually reach Done state', () =>
    new Promise<void>((resolve, reject) => {
      const mockNetworkConfigurationMachine = implementation.machine.provide(implementationConfig)
      const flowStates = [
        'INITIAL',
        'CHANGE_PASSWORD',
        'DONE'
      ]
      const service = createActor(mockNetworkConfigurationMachine, { input: context })
      service.subscribe({
        next: (state) => {
          try {
            const expectedState: any = flowStates[currentStateIndex++]
            expect(state.matches(expectedState)).toBe(true)
            if (state.matches('DONE') && currentStateIndex === flowStates.length) {
              const status = state.output.context.doneData.status
              expect(status).toEqual('SUCCESS')
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
      service.send({ type: 'CHANGE_PASSWORD', clientId, newStaticPassword: 'newPassword' })
    }))
  it('SyncHostName should eventually reach Done state', () =>
    new Promise<void>((resolve, reject) => {
      const mockNetworkConfigurationMachine = implementation.machine.provide(implementationConfig)
      const flowStates = [
        'INITIAL',
        'SYNC_HOST_NAME',
        'DONE'
      ]
      const service = createActor(mockNetworkConfigurationMachine, { input: context })
      service.subscribe({
        next: (state) => {
          try {
            const expectedState: any = flowStates[currentStateIndex++]
            expect(state.matches(expectedState)).toBe(true)
            if (state.matches('DONE') && currentStateIndex === flowStates.length) {
              const status = state.output.context.doneData.status
              expect(status).toEqual('SUCCESS')
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
      service.send({ type: 'SYNC_HOST_NAME', clientId, hostNameInfo })
    }))
  it('SyncIP should eventually reach Done state', () =>
    new Promise<void>((resolve, reject) => {
      const mockNetworkConfigurationMachine = implementation.machine.provide(implementationConfig)
      const flowStates = [
        'INITIAL',
        'SYNC_IP',
        'DONE'
      ]
      const service = createActor(mockNetworkConfigurationMachine, { input: context })
      service.subscribe({
        next: (state) => {
          try {
            const expectedState: any = flowStates[currentStateIndex++]
            expect(state.matches(expectedState)).toBe(true)
            if (state.matches('DONE') && currentStateIndex === flowStates.length) {
              const status = state.output.context.doneData.status
              expect(status).toEqual('SUCCESS')
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
      service.send({ type: 'SYNC_IP', clientId })
    }))
  it('SyncTime should eventually reach Done state', () =>
    new Promise<void>((resolve, reject) => {
      const mockNetworkConfigurationMachine = implementation.machine.provide(implementationConfig)
      const flowStates = [
        'INITIAL',
        'SYNC_TIME',
        'DONE'
      ]
      const service = createActor(mockNetworkConfigurationMachine, { input: context })
      service.subscribe({
        next: (state) => {
          try {
            const expectedState: any = flowStates[currentStateIndex++]
            expect(state.matches(expectedState)).toBe(true)
            if (state.matches('DONE') && currentStateIndex === flowStates.length) {
              const status = state.output.context.doneData.status
              expect(status).toEqual('SUCCESS')
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
      service.send({ type: 'SYNC_TIME', clientId })
    }))
  it('SyncDeviceInfo should eventually reach Done state', () =>
    new Promise<void>((resolve, reject) => {
      const mockNetworkConfigurationMachine = implementation.machine.provide(implementationConfig)
      const flowStates = [
        'INITIAL',
        'SYNC_DEVICE_INFO',
        'DONE'
      ]
      const service = createActor(mockNetworkConfigurationMachine, { input: context })
      service.subscribe({
        next: (state) => {
          try {
            const expectedState: any = flowStates[currentStateIndex++]
            expect(state.matches(expectedState)).toBe(true)
            if (state.matches('DONE') && currentStateIndex === flowStates.length) {
              const status = state.output.context.doneData.status
              expect(status).toEqual('SUCCESS')
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
      service.send({ type: 'SYNC_DEVICE_INFO', clientId, deviceInfo })
    }))
  it('should fail', async () => {
    context.clientId = 'testClient'
    const rsp: DoneResponse = {
      taskName: 'unitTest',
      status: StatusFailed,
      message: ''
    }
    const logInfoSpy = vi.spyOn(Logger.prototype, 'info').mockReturnValue(null as any)
    await implementation.respondAfterDone(context.clientId, rsp)
    expect(logInfoSpy).toHaveBeenCalledWith(`${context.clientId} ${rsp.taskName} failed`)
  })
  describe('service logging', () => {
    it('should include child state machine', async () => {
      const event: SyncTimeEvent = { type: SyncTimeEventType, clientId }
      const logInfoSpy = vi.spyOn(Logger.prototype, 'info').mockReturnValue(null as any)
      invokeWsmanCallSpy.mockRejectedValueOnce(HttpBadRequestError)
      const implementation = new Maintenance()
      const actor = createActor(implementation.machine.provide(implementationConfig), { input: context })

      actor.start()
      actor.send(event)
      await waitFor(actor, (state) => state.matches('DONE'))
      expect(logInfoSpy).toHaveBeenCalledWith(expect.stringContaining('synctime completed succesfully'))
    })
  })
})
