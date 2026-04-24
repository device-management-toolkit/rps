/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { createActor, waitFor } from 'xstate'
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
