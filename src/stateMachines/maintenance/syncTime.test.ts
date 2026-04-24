/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { vi } from 'vitest'
import { type DoneResponse, StatusFailed } from './doneResponse.js'
import { setupTestClient } from '../../test/helper/Config.js'
import { PTStatus } from '../../utils/PTStatus.js'
import { runTilDone } from '../../test/helper/xstate.js'
import { type MachineImplementationsSimplified } from 'xstate'

import { HttpResponseError, coalesceMessage } from '../common.js'

import {
  type GetLowAccuracyTimeSynchResponse,
  type SetHighAccuracyTimeSynchResponse,
  type SyncTimeEvent,
  type SyncTimeContext,
  type SyncTime as SyncTimeType
} from './syncTime.js'

const invokeWsmanCallSpy = vi.hoisted(() => vi.fn<any>())
vi.mock('../common.js', async () => {
  const actual = await vi.importActual<typeof import('../common.js')>('../common.js')
  const { HttpResponseError, coalesceMessage } = actual
  return {
    invokeWsmanCall: invokeWsmanCallSpy,
    HttpResponseError,
    coalesceMessage
  }
})

const { SyncTime, SyncTimeEventType } = await import('./syncTime.js')

describe('SyncTime State Machine', () => {
  let clientId: string
  let doneResponse: DoneResponse
  let context: SyncTimeContext
  let implementation: SyncTimeType
  let implementationConfig: MachineImplementationsSimplified<SyncTimeContext, SyncTimeEvent>
  let event: SyncTimeEvent
  let lowAccuracyRsp: GetLowAccuracyTimeSynchResponse
  let highAccuracyRsp: SetHighAccuracyTimeSynchResponse

  beforeEach(() => {
    vi.resetAllMocks()
    clientId = setupTestClient()
    implementation = new SyncTime()
    doneResponse = {
      taskName: 'synctime',
      status: 'SUCCESS',
      message: expect.any(String)
    }
    lowAccuracyRsp = {
      Envelope: {
        Body: {
          GetLowAccuracyTimeSynch_OUTPUT: {
            ReturnValue: 0,
            Ta0: 0
          }
        }
      }
    }
    highAccuracyRsp = {
      Envelope: {
        Body: {
          SetHighAccuracyTimeSynch_OUTPUT: {
            ReturnValue: 0
          }
        }
      }
    }
    context = {
      taskName: 'synctime',
      clientId
    } as any
    implementationConfig = {
      actors: {
        // getLowAccuracyTimeSync: fromPromise(async ({ input }) => await Promise.resolve({})),
        // setHighAccuracyTimeSynch: fromPromise(async ({ input }) => await Promise.resolve({}))
      },
      actions: {},
      guards: {},
      delays: {}
    }

    event = { type: SyncTimeEventType, clientId }
  })

  const runTheTest = async function (): Promise<void> {
    invokeWsmanCallSpy.mockResolvedValueOnce(lowAccuracyRsp).mockResolvedValueOnce(highAccuracyRsp)
    await runTilDone(implementation.machine.provide(implementationConfig), event, doneResponse, context)
  }
  it('should succeed synchronizing time', async () => {
    await runTheTest()
  })
  it('should fail getting low accuracy time sync on bad return value', async () => {
    doneResponse.status = StatusFailed
    lowAccuracyRsp.Envelope.Body.GetLowAccuracyTimeSynch_OUTPUT.ReturnValue = PTStatus.INTERNAL_ERROR.value
    await runTheTest()
  })
  it('should fail setting high accuracy time sync on bad return value', async () => {
    doneResponse.status = StatusFailed
    highAccuracyRsp.Envelope.Body.SetHighAccuracyTimeSynch_OUTPUT.ReturnValue = PTStatus.INTERNAL_ERROR.value
    await runTheTest()
  })
})
