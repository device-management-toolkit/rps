/*********************************************************************
 * Copyright (c) Intel Corporation 2026
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/
import { createActor, createMachine, fromPromise } from 'xstate'
import Logger from '../Logger.js'
import { traceStateTransitions } from './stateTransitionLog.js'

const machine = createMachine({
  initial: 'ACTIVE',
  states: {
    ACTIVE: { on: { COMPLETE: 'SUCCESS', FAIL: 'FAILED', STAY: 'ACTIVE' } },
    SUCCESS: { type: 'final' },
    FAILED: { type: 'final' }
  }
})

describe('traceStateTransitions', () => {
  let lines: string[]

  beforeEach(() => {
    vi.useFakeTimers()
    lines = []
    vi.spyOn(Logger.prototype, 'debug').mockImplementation((message: string) => {
      lines.push(message)
    })
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it.each(['COMPLETE', 'FAIL'])('logs the terminal root state before cleanup for %s', (event) => {
    const actor = createActor(machine)
    const inspect = vi.spyOn(actor.system, 'inspect')
    traceStateTransitions(actor, 'client-1')
    const unsubscribe = vi.spyOn(inspect.mock.results[0].value, 'unsubscribe')
    actor.start()
    actor.send({ type: event })
    expect(lines.at(-1)).toContain(`actor=activation state=${event === 'COMPLETE' ? 'SUCCESS' : 'FAILED'} status=done`)
    expect(unsubscribe).not.toHaveBeenCalled()
    vi.runAllTimers()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it.each([
    'activation',
    'deactivation',
    'maintenance'
  ])('labels the root as %s across separate runs', (name) => {
    for (let run = 0; run < 2; run++) {
      const actor = createActor(machine)
      traceStateTransitions(actor, 'client-1', name)
      actor.start()
      actor.send({ type: 'COMPLETE' })
    }
    expect(lines).toHaveLength(4)
    expect(lines.every((line) => line.includes(`client=client-1 actor=${name}`))).toBe(true)
    expect(lines.join('\n')).not.toMatch(/actor=x:/)
    vi.runAllTimers()
  })

  it('suppresses repeated identical snapshots', () => {
    const actor = createActor(machine)
    traceStateTransitions(actor, 'client-1')
    actor.start()
    actor.send({ type: 'STAY' })
    actor.send({ type: 'STAY' })
    expect(lines).toHaveLength(1)
    actor.send({ type: 'COMPLETE' })
    vi.runAllTimers()
  })

  it('preserves child names and logs both root and child completion', async () => {
    const child = createMachine({
      initial: 'WORK',
      states: { WORK: { on: { FINISH: 'DONE' } }, DONE: { type: 'final' } }
    })
    const parent = createMachine({
      initial: 'RUN',
      states: {
        RUN: { invoke: { id: 'named-child', src: child, onDone: 'SUCCESS' } },
        SUCCESS: { type: 'final' }
      }
    })
    const actor = createActor(parent)
    traceStateTransitions(actor, 'client-1')
    actor.start()
    actor.getSnapshot().children['named-child']?.send({ type: 'FINISH' })
    expect(lines.some((line) => line.includes('actor=activation state=SUCCESS status=done'))).toBe(true)
    expect(lines.some((line) => line.includes('actor=named-child state=DONE status=done'))).toBe(true)
    await vi.runAllTimersAsync()
  })

  it('releases inspection after an actor error', async () => {
    const actor = createActor(
      createMachine({
        initial: 'RUN',
        states: {
          RUN: {
            invoke: {
              src: fromPromise(async () => {
                throw new Error('test failure')
              })
            }
          }
        }
      })
    )
    // Handle the expected actor error so XState does not report an unhandled error.
    actor.subscribe({ error: () => {} })
    const inspect = vi.spyOn(actor.system, 'inspect')
    traceStateTransitions(actor, 'client-1')
    const unsubscribe = vi.spyOn(inspect.mock.results[0].value, 'unsubscribe')
    actor.start()
    await vi.runAllTimersAsync()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})
