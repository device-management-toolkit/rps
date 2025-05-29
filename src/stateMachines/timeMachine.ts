/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { AMT } from '@device-management-toolkit/wsman-messages'
import { assign, fromPromise, setup } from 'xstate'
import { type CommonContext, invokeWsmanCall } from './common.js'

export interface TimeSyncContext extends CommonContext {
  status: string
}

export interface TimeSyncEvent {
  type: 'TIMETRAVEL' | 'ONFAILED'
  clientId: string
  data: any
}

export class TimeSync {
  setHighAccuracyTimeSync = async ({ input }: { input: TimeSyncContext }): Promise<any> => {
    const Tm1 = Math.round(new Date().getTime() / 1000)
    const Ta0: number = input.message.Envelope.Body.GetLowAccuracyTimeSynch_OUTPUT.Ta0
    const amt = new AMT.Messages()
    input.xmlMessage = amt.TimeSynchronizationService.SetHighAccuracyTimeSynch(Ta0, Tm1, Tm1)
    return await invokeWsmanCall(input)
  }

  getLowAccuracyTimeSync = async ({ input }: { input: TimeSyncContext }): Promise<any> => {
    const amt = new AMT.Messages()
    input.xmlMessage = amt.TimeSynchronizationService.GetLowAccuracyTimeSynch()
    return await invokeWsmanCall(input)
  }

  machine = setup({
    types: {} as {
      context: TimeSyncContext
      events: TimeSyncEvent
      actions: any
      input: TimeSyncContext
    },
    actors: {
      getLowAccuracyTimeSync: fromPromise(this.getLowAccuracyTimeSync),
      setHighAccuracyTimeSync: fromPromise(this.setHighAccuracyTimeSync)
    },
    guards: {
      isGetLowAccuracyTimeSynchSuccessful: ({ context }) =>
        context.message.Envelope.Body?.GetLowAccuracyTimeSynch_OUTPUT?.ReturnValue === 0,
      isSetHighAccuracyTimeSynchSuccessful: ({ context }) =>
        context.message.Envelope.Body?.SetHighAccuracyTimeSynch_OUTPUT?.ReturnValue === 0
    }
  }).createMachine({
    context: ({ input }) => ({
      message: input.message,
      xmlMessage: input.xmlMessage,
      clientId: input.clientId,
      status: input.status,
      statusMessage: input.statusMessage,
      errorMessage: input.errorMessage,
      httpHandler: input.httpHandler
    }),
    id: 'time-machine',
    initial: 'THE_PAST',
    states: {
      THE_PAST: {
        on: {
          TIMETRAVEL: {
            target: 'GET_LOW_ACCURACY_TIME_SYNCH'
          }
        }
      },
      GET_LOW_ACCURACY_TIME_SYNCH: {
        invoke: {
          id: 'get-low-accuracy-time-synch',
          src: 'getLowAccuracyTimeSync',
          input: ({ context }) => context,
          onDone: [
            {
              actions: assign({ message: ({ event }) => event.output }),
              target: 'GET_LOW_ACCURACY_TIME_SYNCH_RESPONSE'
            }
          ],
          onError: {
            actions: assign({
              message: ({ event }) => event.error
            }),
            target: 'FAILED'
          }
        }
      },
      GET_LOW_ACCURACY_TIME_SYNCH_RESPONSE: {
        always: [
          {
            guard: 'isGetLowAccuracyTimeSynchSuccessful',
            target: 'SET_HIGH_ACCURACY_TIME_SYNCH'
          },
          {
            actions: assign({
              errorMessage: 'Failed to GET_LOW_ACCURACY_TIME_SYNC'
            }),
            target: 'FAILED'
          }
        ]
      },
      SET_HIGH_ACCURACY_TIME_SYNCH: {
        invoke: {
          id: 'set-high-accuracy-time-sync',
          src: 'setHighAccuracyTimeSync',
          input: ({ context }) => context,
          onDone: [
            {
              actions: assign({ message: ({ event }) => event.output }),
              target: 'SET_HIGH_ACCURACY_TIME_SYNCH_RESPONSE'
            }
          ],
          onError: {
            actions: assign({
              errorMessage: 'Failed to SET_HIGH_ACCURACY_TIME_SYNCH'
            }),
            target: 'FAILED'
          }
        }
      },
      SET_HIGH_ACCURACY_TIME_SYNCH_RESPONSE: {
        always: [
          {
            guard: 'isSetHighAccuracyTimeSynchSuccessful',
            target: 'SUCCESS'
          },
          {
            actions: assign({
              errorMessage: 'Failed to SET_HIGH_ACCURACY_TIME_SYNCH'
            }),
            target: 'FAILED'
          }
        ]
      },
      FAILED: {
        type: 'final'
      },
      SUCCESS: {
        type: 'final'
      }
    }
  })
}
