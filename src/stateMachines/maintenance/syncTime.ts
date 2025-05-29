/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { AMT } from '@device-management-toolkit/wsman-messages'
import { assign, fromPromise, sendTo, setup } from 'xstate'
import { coalesceMessage, type CommonMaintenanceContext } from '../common.js'
import Logger from '../../Logger.js'
import { doneFail, doneSuccess } from './doneResponse.js'
import { getPTStatusName, PTStatus } from '../../utils/PTStatus.js'
import { invokeWsmanCall } from '../common.js'
import { Error as ErrorStateMachine } from './../error.js'

export interface GetLowAccuracyTimeSynchResponse {
  Envelope: {
    Body: {
      GetLowAccuracyTimeSynch_OUTPUT: {
        ReturnValue: number
        Ta0: number
      }
    }
  }
}

export interface SetHighAccuracyTimeSynchResponse {
  Envelope: {
    Body: {
      SetHighAccuracyTimeSynch_OUTPUT: {
        ReturnValue: number
      }
    }
  }
}

export const SyncTimeEventType = 'SYNC_TIME'
export interface SyncTimeEvent {
  type: typeof SyncTimeEventType | 'ONFAILED'
  clientId: string
  output?: any
}

export interface SyncTimeContext extends CommonMaintenanceContext {
  lowAccuracyData: LowAccuracyData
}
class LowAccuracyData {
  Ta0: number
  Tm1: number
}

const amt = new AMT.Messages()
const logger = new Logger('syncTime')

export class SyncTime {
  getLowAccuracyTimeSync = async ({ input }: { input: SyncTimeContext }): Promise<LowAccuracyData> => {
    input.xmlMessage = amt.TimeSynchronizationService.GetLowAccuracyTimeSynch()
    const rsp = await invokeWsmanCall<GetLowAccuracyTimeSynchResponse>(input)
    const output = rsp.Envelope.Body.GetLowAccuracyTimeSynch_OUTPUT
    if (output?.ReturnValue !== PTStatus.SUCCESS.value) {
      const msg = `ReturnValue ${getPTStatusName(output?.ReturnValue)}`
      throw new Error(msg)
    }
    const data: LowAccuracyData = {
      Ta0: output.Ta0,
      Tm1: Math.round(new Date().getTime() / 1000)
    }
    logger.debug(`LowAccuracyData: ${JSON.stringify(data)}`)
    return data
  }

  setHighAccuracyTimeSynch = async ({ input }: { input: SyncTimeContext }): Promise<void> => {
    const Ta0 = input.lowAccuracyData.Ta0
    const Tm1 = input.lowAccuracyData.Tm1
    const Tm2 = Math.round(new Date().getTime() / 1000)
    input.xmlMessage = amt.TimeSynchronizationService.SetHighAccuracyTimeSynch(Ta0, Tm1, Tm2)
    logger.debug(`sending SetHighAccuracyTimeSynch: Ta0: ${Ta0} Tm1: ${Tm1} Tm2: ${Tm2}`)
    const wsmanRsp = await invokeWsmanCall<SetHighAccuracyTimeSynchResponse>(input)
    const output = wsmanRsp.Envelope.Body.SetHighAccuracyTimeSynch_OUTPUT
    if (output?.ReturnValue !== PTStatus.SUCCESS.value) {
      const msg = `ReturnValue ${getPTStatusName(output?.ReturnValue)}`
      throw new Error(msg)
    }
  }

  error: ErrorStateMachine = new ErrorStateMachine()
  machine = setup({
    types: {} as {
      context: SyncTimeContext
      events: SyncTimeEvent
      actions: any
      input: SyncTimeContext
    },
    actors: {
      getLowAccuracyTimeSync: fromPromise(this.getLowAccuracyTimeSync.bind(this)),
      setHighAccuracyTimeSynch: fromPromise(this.setHighAccuracyTimeSynch.bind(this)),
      error: this.error.machine
    },
    guards: {
      isLowAccuracy: ({ context, event }) => context.targetAfterError === 'GET_LOW_ACCURACY_TIME_SYNCH'
    }
  }).createMachine({
    /** @xstate-layout N4IgpgJg5mDOIC5SwJ4DsDGBaALgSwFswA6ASQDlSAVUgQQBkBiAZQE1yBhAfRoFkBRANoAGALqJQABwD2sPPmloJIAB6IsARgBsAZmIAmHVoAsATmMBWLQHZzwrQBoQKRKeLHj16wA59w75a2FhbeAL6hTqiYuIQkAOL8VFz0APIA6ly0HBwAqgBKWaw8pAJcbJwAEowQiiR4aABu0gDWJDA4WAA20gDuWACGGBgArgBOgygxRFhRGAAWIuJIIDJyCkrLagg6tsQ6xjveGho6wgcWlk4uCJqnxBreWqbe+7be9qbhkejY+ETECSSqQyWVyBQ4RT4-DK7A4VTAo1G0lGxEknX6OAAZsiCMR2l1egMhmMJlMwDMfgsxMpVvI8IplFsdm59odjqdzpdnIh9N49mdPKYTtYNPprIYviBZmTiMxElwKqQ4hVMtl8oViqVynDqrViPUmq1iLAwB05ngoHMiSNxhhJn9ybMqUspLI6QzNogNPY+fZRRofBYNMYNBZrFd1KG3P4dDp9LynpZjGEIlKfjK5UlFcrVWCNVCYZVGAikSi0RjsaNcSazRarYMbaSHRTMM6aW71oyvT7iH79AHvEGQ2GIzdjvpiL5rFp3s8tCYbCnU2hpBA4MppQ722t6RtQFssLHhMQrDszFoLKZ-F5HNybvozPded4r8JTDoTtprJLN7EyJQaAYbd3T3VR1F5CdT2sc9L2vadRw-SdY10b1kyOXRHh-dMHQBeVgVzdUIU1aFtQqYDO09MctGILR+yFC9gwDUVTFHTRe2EYQw2EEUAx0UwH1jLDohwzMFSVFVQUIyEShI2EyOWWkKP3RAbAnN9gj8PwZzfVjgwnE4xVOF5ggMrQhN+P8ADFaFIeh+AAEXI3cuwQE4TEnfjbDfTibFMCxR2MY9eVFWDgg5UwzNTX9-mYHJsn4ZhmCcj1lNcoxjA8sUryvKwgl0rQNGIcxrGEHZ-HjZNwnCIA */
    id: 'sync-time',
    context: ({ input }) => ({
      taskName: input.taskName,
      clientId: input.clientId,
      message: input.message,
      errorMessage: input.errorMessage,
      statusMessage: input.statusMessage,
      parseErrorCount: input.parseErrorCount,
      httpHandler: input.httpHandler,
      lowAccuracyData: input.lowAccuracyData
    }),
    initial: 'INITIAL',
    states: {
      INITIAL: {
        on: {
          SYNC_TIME: {
            actions: assign({ clientId: ({ event }) => event.clientId }),
            target: 'GET_LOW_ACCURACY_TIME_SYNCH'
          }
        }
      },
      GET_LOW_ACCURACY_TIME_SYNCH: {
        entry: assign({
          message: () => '',
          errorMessage: () => ''
        }),
        invoke: {
          id: 'get-low-accuracy-time-synch',
          src: 'getLowAccuracyTimeSync',
          input: ({ context }) => context,
          onDone: {
            actions: assign({
              lowAccuracyData: ({ event }) => (event as any).output
            }),
            target: 'SET_HIGH_ACCURACY_TIME_SYNCH'
          },
          onError: {
            actions: assign({
              message: ({ event }) => event.error,
              errorMessage: ({ event }) => coalesceMessage('at GET_LOW_ACCURACY_TIME_SYNCH', event.error),
              targetAfterError: () => 'GET_LOW_ACCURACY_TIME_SYNCH'
            }),
            target: 'ERROR'
          }
        }
      },
      SET_HIGH_ACCURACY_TIME_SYNCH: {
        entry: assign({
          message: () => '',
          errorMessage: () => ''
        }),
        invoke: {
          id: 'set-high-accuracy-time-synch',
          src: 'setHighAccuracyTimeSynch',
          input: ({ context }) => context,
          onDone: {
            target: 'SUCCESS'
          },
          onError: {
            actions: assign({
              errorMessage: ({ event }) => coalesceMessage('at SET_HIGH_ACCURACY_TIME_SYNCH', event.error)
            }),
            target: 'FAILED'
          }
        }
      },
      ERROR: {
        entry: sendTo('error-machine', { type: 'PARSE' }),
        invoke: {
          src: 'error',
          id: 'error-machine',
          input: ({ context }) => ({
            message: context.message,
            clientId: context.clientId
          }),
          onError: {
            actions: assign({ message: ({ event }) => event.error }),
            target: 'FAILED'
          },
          onDone: 'NEXT_STATE'
        },
        on: {
          ONFAILED: {
            actions: assign({ errorMessage: ({ context, event }) => coalesceMessage(context.message, event.output) }),
            target: 'FAILED'
          }
        }
      },
      NEXT_STATE: {
        always: [
          {
            guard: 'isLowAccuracy',
            target: 'GET_LOW_ACCURACY_TIME_SYNCH'
          }
        ]
      },
      FAILED: {
        entry: assign({ statusMessage: () => 'FAILED' }),
        type: 'final'
      },
      SUCCESS: {
        entry: assign({ statusMessage: () => 'SUCCESS' }),
        type: 'final'
      }
    },
    output: ({ context }) => {
      if (context.statusMessage === 'SUCCESS') {
        return doneSuccess(context.taskName)
      } else {
        return doneFail(context.taskName, context.errorMessage)
      }
    }
  })
}
