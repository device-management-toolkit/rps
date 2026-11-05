/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { createActor, createMachine, waitFor, type AnyStateMachine, type SnapshotFrom } from 'xstate'
import { type DoneResponse } from '../../stateMachines/maintenance/doneResponse.js'

export const runTilDone = async function (
  machine: any,
  inputEvent: any,
  doneResponse: DoneResponse,
  context: any
): Promise<any> {
  const actor = createActor(machine, { input: context })
  actor.start()
  actor.send(inputEvent)
  const state = await waitFor(actor, (state) => state.status === 'done')
  // Assert the final output matches the expected shape. This runs in the test's
  // own awaited promise context (not inside an xstate subscribe callback), so a
  // failing expect() rejects the awaiting test cleanly instead of being caught
  // by xstate's Actor._error and re-raised as an uncaughtException (which
  // Vitest treats as a run-level failure, unlike Jest).
  expect(state.output).toEqual(expect.objectContaining(doneResponse))
  return state.context
}

/** Run real transitions between selected states, stopping at the supplied terminal states. */
export async function runMachineSegment(
  machine: AnyStateMachine,
  initial: string,
  context: Record<string, unknown>,
  terminals: string[]
): Promise<SnapshotFrom<AnyStateMachine>> {
  const states = { ...machine.config.states }
  for (const terminal of terminals) states[terminal] = { type: 'final' }
  const segment = createMachine({ ...machine.config, initial, context, states }, machine.implementations)
  const actor = createActor(segment)
  try {
    actor.start()
    return await waitFor(actor, (snapshot) => snapshot.status === 'done', { timeout: 1000 })
  } finally {
    actor.stop()
  }
}
