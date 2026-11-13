/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { vi } from 'vitest'
import { type MachineImplementationsSimplified, createActor, fromPromise } from 'xstate'
import { HttpHandler } from '../HttpHandler.js'
import { devices } from '../devices.js'
import { GATEWAY_TIMEOUT_ERROR } from '../utils/constants.js'

import { type TimeSyncContext, type TimeSyncEvent, type TimeSync as TimeSyncType } from './timeMachine.js'
const invokeWsmanCallSpy = vi.hoisted(() => vi.fn<any>())
vi.mock('./common.js', async () => {
  const actual = await vi.importActual<typeof import('./common.js')>('./common.js')
  return {
    ...actual,
    invokeWsmanCall: invokeWsmanCallSpy
  }
})
const { TimeSync } = await import('./timeMachine.js')

describe('TLS State Machine', () => {
  let timeMachine: TimeSyncType
  let config: MachineImplementationsSimplified<TimeSyncContext, TimeSyncEvent>
  let context
  let currentStateIndex = 0

  const clientId = '4c4c4544-004b-4210-8033-b6c04f504633'
  beforeEach(() => {
    currentStateIndex = 0
    invokeWsmanCallSpy.mockReset()
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
        enableLocalTimeSync: fromPromise(async ({ input }) => await timeMachine.enableLocalTimeSync({ input })),
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
  it('should keep legacy time sync when LMS is not installed', () =>
    new Promise<void>((resolve, reject) => {
      const timeMachineStateMachine = timeMachine.machine.provide(config)
      const flowStates = [
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
    }))

  it('should enable local time sync when LMS is installed', async () => {
    invokeWsmanCallSpy.mockResolvedValue({
      Envelope: { Body: { EnableLocalTimeSync_OUTPUT: { ReturnValue: 0 } } }
    })
    const actor = createActor(timeMachine.machine.provide(config), {
      input: { ...context, lmsInstalled: true }
    })
    const completed = new Promise<void>((resolve, reject) => {
      actor.subscribe({
        next: (state) => {
          if (state.matches('SUCCESS')) resolve()
        },
        error: reject
      })
    })
    actor.start()
    await completed

    expect(invokeWsmanCallSpy).toHaveBeenCalledOnce()
    const request = invokeWsmanCallSpy.mock.calls[0][0] as { xmlMessage: string }
    expect(request.xmlMessage).toContain('<h:Enable>true</h:Enable>')
    actor.stop()
  })

  it('should retry local time sync after an AMT digest challenge', async () => {
    invokeWsmanCallSpy
      .mockRejectedValueOnce({
        statusCode: 401,
        headers: [{ name: 'Www-Authenticate', value: 'Digest realm="Digest:test", nonce="nonce", qop="auth"' }]
      })
      .mockResolvedValueOnce({ Envelope: { Body: { EnableLocalTimeSync_OUTPUT: { ReturnValue: 0 } } } })
    const actor = createActor(timeMachine.machine.provide(config), {
      input: { ...context, lmsInstalled: true }
    })
    const completed = new Promise<void>((resolve, reject) => {
      actor.subscribe({
        next: (state) => {
          if (state.matches('SUCCESS')) resolve()
        },
        error: reject
      })
    })
    actor.start()
    await completed

    expect(invokeWsmanCallSpy).toHaveBeenCalledTimes(2)
    actor.stop()
  })

  it('should expose a failed result when AMT rejects local time sync', async () => {
    invokeWsmanCallSpy.mockResolvedValue({
      Envelope: { Body: { EnableLocalTimeSync_OUTPUT: { ReturnValue: 1 } } }
    })
    const actor = createActor(timeMachine.machine.provide(config), {
      input: { ...context, lmsInstalled: true }
    })
    const completed = new Promise<{ status: string; errorMessage: string; failure: any }>((resolve, reject) => {
      actor.subscribe({
        next: (state) => {
          if (state.status === 'done') {
            resolve(state.output as { status: string; errorMessage: string; failure: any })
          }
        },
        error: reject
      })
    })

    actor.start()
    const output = await completed

    expect(output.status).toBe('error')
    expect(output.errorMessage).toContain('Failed to ENABLE_LOCAL_TIME_SYNC')
    expect(output.failure).toMatchObject({
      Code: 'AMT_PT_INTERNAL_ERROR',
      Component: 'TimeSync',
      Step: 'ENABLE_LOCAL_TIME_SYNC_RESPONSE',
      AmtReturnValue: 1
    })
    actor.stop()
  })

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

  const runToCompletion = async (input: any): Promise<any> => {
    const actor = createActor(timeMachine.machine.provide(config), { input })
    const completed = new Promise<any>((resolve, reject) => {
      actor.subscribe({
        next: (state) => {
          if (state.status === 'done') {
            resolve(state.output)
          }
        },
        error: reject
      })
    })
    actor.start()
    const output = await completed
    actor.stop()
    return output
  }

  it('maps a non-zero AMT ReturnValue to its PT_STATUS code in the output failure', async () => {
    config.actors!.setHighAccuracyTimeSync = fromPromise(
      async () =>
        await Promise.resolve({ Envelope: { Body: { SetHighAccuracyTimeSynch_OUTPUT: { ReturnValue: 34 } } } })
    )
    const output = await runToCompletion({ ...context, lmsInstalled: false })
    expect(output.status).toBe('error')
    // Legacy text unchanged ...
    expect(output.errorMessage).toBe('Failed to SET_HIGH_ACCURACY_TIME_SYNCH')
    // ... with the AMT code captured instead of dropped.
    expect(output.failure).toEqual({
      Code: 'AMT_PT_INVALID_TIME',
      Component: 'TimeSync',
      Step: 'SET_HIGH_ACCURACY_TIME_SYNCH_RESPONSE',
      Reason: 'Time value is invalid',
      AmtReturnValue: 34
    })
  })

  it('maps a rejected WSMAN call to a transport code', async () => {
    config.actors!.setHighAccuracyTimeSync = fromPromise(async () => await Promise.reject(new GATEWAY_TIMEOUT_ERROR()))
    const output = await runToCompletion({ ...context, lmsInstalled: false })
    expect(output.status).toBe('error')
    expect(output.errorMessage).toBe('Failed to SET_HIGH_ACCURACY_TIME_SYNCH')
    expect(output.failure).toMatchObject({
      Code: 'WSMAN_TIMEOUT',
      Component: 'TimeSync',
      Step: 'SET_HIGH_ACCURACY_TIME_SYNCH'
    })
  })

  it('always carries a failure in a failed output', async () => {
    invokeWsmanCallSpy.mockResolvedValue({
      Envelope: { Body: { EnableLocalTimeSync_OUTPUT: { ReturnValue: 1 } } }
    })
    const output = await runToCompletion({ ...context, lmsInstalled: true })
    expect(output.status).toBe('error')
    expect(output.failure).toBeDefined()
    expect(output.failure.Component).toBe('TimeSync')
    expect(typeof output.failure.Code).toBe('string')
  })
})
