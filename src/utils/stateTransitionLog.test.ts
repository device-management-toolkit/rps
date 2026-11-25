/*********************************************************************
 * Copyright (c) Intel Corporation 2026
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { createActor, createMachine } from 'xstate'
import Logger from '../Logger.js'
import { traceStateTransitions } from './stateTransitionLog.js'

const machine = createMachine({
  id: 'trace-test',
  initial: 'A',
  states: {
    A: { on: { GO: 'B', STAY: 'A' } },
    B: { always: 'FINAL' },
    FINAL: { type: 'final' }
  }
})

const flush = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 5))
}

describe('traceStateTransitions', () => {
  let lines: string[]

  beforeEach(() => {
    lines = []
    vi.spyOn(Logger.prototype, 'debug').mockImplementation((message: string) => {
      lines.push(message)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('logs the terminal state of the root actor', async () => {
    const actor = createActor(machine)
    traceStateTransitions(actor, 'client-1')
    actor.start()
    actor.send({ type: 'GO' })
    await flush()
    expect(lines.at(-1)).toContain('state=FINAL status=done')
  })

  it('names the root actor instead of the generated x:<counter> id', async () => {
    const actor = createActor(machine)
    traceStateTransitions(actor, 'client-1', 'deactivation')
    actor.start()
    await flush()
    expect(lines[0]).toContain('client=client-1 actor=deactivation state=A status=active')
    expect(lines.join('\n')).not.toMatch(/actor=x:/)
  })

  it('defaults the root actor name to activation', async () => {
    const actor = createActor(machine)
    traceStateTransitions(actor, 'client-1')
    actor.start()
    await flush()
    expect(lines[0]).toContain('actor=activation')
  })

  it('suppresses repeated identical snapshots', async () => {
    const actor = createActor(machine)
    traceStateTransitions(actor, 'client-1')
    actor.start()
    actor.send({ type: 'STAY' })
    actor.send({ type: 'STAY' })
    await flush()
    expect(lines).toHaveLength(1)
  })

  it('stops logging after the actor completes', async () => {
    const actor = createActor(machine)
    traceStateTransitions(actor, 'client-1')
    actor.start()
    actor.send({ type: 'GO' })
    await flush()
    const count = lines.length
    await flush()
    expect(lines).toHaveLength(count)
  })
})
