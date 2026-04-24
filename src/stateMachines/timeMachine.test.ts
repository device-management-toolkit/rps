/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { vi } from 'vitest'
import { type MachineImplementationsSimplified, createActor, fromPromise } from 'xstate'
import { HttpHandler } from '../HttpHandler.js'
import { devices } from '../devices.js'

import { type TimeSyncContext, type TimeSyncEvent, type TimeSync as TimeSyncType } from './timeMachine.js'
const invokeWsmanCallSpy = vi.hoisted(() => vi.fn<any>())
vi.mock('./common.js', () => ({
  invokeWsmanCall: invokeWsmanCallSpy
}))
const { TimeSync } = await import('./timeMachine.js')

describe('TLS State Machine', () => {
  let timeMachine: TimeSyncType
  let config: MachineImplementationsSimplified<TimeSyncContext, TimeSyncEvent>
  let context
  let currentStateIndex = 0

  const clientId = '4c4c4544-004b-4210-8033-b6c04f504633'
  beforeEach(() => {
    currentStateIndex = 0
    devices[clientId] = {
      status: {},
      ClientSocket: { send: vi.fn() },
      tls: {}
    } as any
    context = {
      clientId,
      httpHandler: new HttpHandler(),
      message: null,
      xmlMessage: '',
      errorMessage: '',
      statusMessage: '',
      status: 'success'
    }
    timeMachine = new TimeSync()
    config = {
      actors: {
        getLowAccuracyTimeSync: fromPromise(
          async ({ input }) =>
            await Promise.resolve({
              Envelope: { Body: { GetLowAccuracyTimeSynch_OUTPUT: { ReturnValue: 0 } } }
            })
        ),
        setHighAccuracyTimeSync: fromPromise(
          async ({ input }) =>
            await Promise.resolve({
              Envelope: { Body: { SetHighAccuracyTimeSynch_OUTPUT: { ReturnValue: 0 } } }
            })
        )
      },
      actions: {},
      guards: {},
      delays: {}
    }
  })
  it('should sync the time', () =>
    new Promise<void>((resolve, reject) => {
      const timeMachineStateMachine = timeMachine.machine.provide(config)
      const flowStates = [
        'THE_PAST',
        'GET_LOW_ACCURACY_TIME_SYNCH',
        'SET_HIGH_ACCURACY_TIME_SYNCH',
        'SUCCESS'
      ]

      const timeMachineService = createActor(timeMachineStateMachine, { input: context })
      timeMachineService.subscribe({
        next: (state) => {
          try {
            const expectedState: any = flowStates[currentStateIndex++]
            expect(state.matches(expectedState)).toBe(true)
            if (state.matches('SUCCESS') && currentStateIndex === flowStates.length) {
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

      timeMachineService.start()
      timeMachineService.send({ type: 'TIMETRAVEL', clientId, data: null })
    }))

  it('should setHighAccuracyTimeSync', async () => {
    context.message = {
      Envelope: { Body: { GetLowAccuracyTimeSynch_OUTPUT: { Ta0: 123456 } } }
    }
    await timeMachine.setHighAccuracyTimeSync({ input: context })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })

  it('should getLowAccuracyTimeSync', async () => {
    await timeMachine.getLowAccuracyTimeSync({ input: context })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })
})
