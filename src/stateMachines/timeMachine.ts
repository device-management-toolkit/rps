/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { AMT } from '@device-management-toolkit/wsman-messages'
import { assign, fromPromise, sendTo, setup } from 'xstate'
import { coalesceMessage, type CommonContext, invokeWsmanCall } from './common.js'
import { Error as ErrorStateMachine } from './error.js'
import Logger from '../Logger.js'

export interface TimeSyncContext extends CommonContext {
  status: string
  lmsInstalled?: boolean
}

export interface TimeSyncEvent {
  type: 'ONFAILED'
  output?: any
}

export class TimeSync {
  logger = new Logger('ActivationTimeSync')
  error: ErrorStateMachine = new ErrorStateMachine()

  enableLocalTimeSync = async ({ input }: { input: TimeSyncContext }): Promise<any> => {
    this.logger.debug('Activation time sync: sending EnableLocalTimeSync(true)')
    const amt = new AMT.Messages()
    input.xmlMessage = amt.TimeSynchronizationService.EnableLocalTimeSync(true)
    const response = await invokeWsmanCall<{
      Envelope: { Body: { EnableLocalTimeSync_OUTPUT: { ReturnValue: number } } }
    }>(input)
    if (response.Envelope.Body?.EnableLocalTimeSync_OUTPUT?.ReturnValue !== 0) {
      throw new Error('Failed to ENABLE_LOCAL_TIME_SYNC')
    }
    return response
  }

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
      enableLocalTimeSync: fromPromise(this.enableLocalTimeSync),
      getLowAccuracyTimeSync: fromPromise(this.getLowAccuracyTimeSync),
      setHighAccuracyTimeSync: fromPromise(this.setHighAccuracyTimeSync),
      error: this.error.machine
    },
    guards: {
      isLmsInstalled: ({ context }) => context.lmsInstalled === true,
      isEnableLocalTimeSyncSuccessful: ({ context }) =>
        context.message.Envelope.Body?.EnableLocalTimeSync_OUTPUT?.ReturnValue === 0,
      isGetLowAccuracyTimeSynchSuccessful: ({ context }) =>
        context.message.Envelope.Body?.GetLowAccuracyTimeSynch_OUTPUT?.ReturnValue === 0,
      isSetHighAccuracyTimeSynchSuccessful: ({ context }) =>
        context.message.Envelope.Body?.SetHighAccuracyTimeSynch_OUTPUT?.ReturnValue === 0,
      isEnableLocalTimeSync: ({ context }) => context.targetAfterError === 'ENABLE_LOCAL_TIME_SYNC',
      isGetLowAccuracyTimeSync: ({ context }) => context.targetAfterError === 'GET_LOW_ACCURACY_TIME_SYNCH'
    }
  }).createMachine({
    context: ({ input }) => ({
      message: input.message,
      xmlMessage: input.xmlMessage,
      clientId: input.clientId,
      status: input.status,
      statusMessage: input.statusMessage,
      errorMessage: input.errorMessage,
      httpHandler: input.httpHandler,
      lmsInstalled: input.lmsInstalled,
      targetAfterError: input.targetAfterError
    }),
    output: ({ context }) => ({ status: context.status, errorMessage: context.errorMessage }),
    id: 'time-machine',
    initial: 'THE_PAST',
    states: {
      THE_PAST: {
        always: [
          {
            guard: 'isLmsInstalled',
            target: 'ENABLE_LOCAL_TIME_SYNC'
          },
          {
            target: 'GET_LOW_ACCURACY_TIME_SYNCH'
          }
        ]
      },
      ENABLE_LOCAL_TIME_SYNC: {
        entry: assign({ message: () => '', errorMessage: () => '' }),
        invoke: {
          id: 'enable-local-time-sync',
          src: 'enableLocalTimeSync',
          input: ({ context }) => context,
          onDone: {
            actions: assign({ message: ({ event }) => event.output }),
            target: 'ENABLE_LOCAL_TIME_SYNC_RESPONSE'
          },
          onError: {
            actions: assign({
              message: ({ event }) => event.error,
              errorMessage: ({ event }) => coalesceMessage('at ENABLE_LOCAL_TIME_SYNC', event.error),
              targetAfterError: () => 'ENABLE_LOCAL_TIME_SYNC'
            }),
            target: 'ERROR'
          }
        }
      },
      ENABLE_LOCAL_TIME_SYNC_RESPONSE: {
        always: [
          { guard: 'isEnableLocalTimeSyncSuccessful', target: 'SUCCESS' },
          { actions: assign({ errorMessage: 'Failed to ENABLE_LOCAL_TIME_SYNC' }), target: 'FAILED' }
        ]
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
              message: ({ event }) => event.error,
              errorMessage: ({ event }) => coalesceMessage('at GET_LOW_ACCURACY_TIME_SYNCH', event.error),
              targetAfterError: () => 'GET_LOW_ACCURACY_TIME_SYNCH'
            }),
            target: 'ERROR'
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
      ERROR: {
        entry: sendTo('error-machine', { type: 'PARSE' }),
        invoke: {
          src: 'error',
          id: 'error-machine',
          input: ({ context }) => ({ message: context.message, clientId: context.clientId }),
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
          { guard: 'isEnableLocalTimeSync', target: 'ENABLE_LOCAL_TIME_SYNC' },
          { guard: 'isGetLowAccuracyTimeSync', target: 'GET_LOW_ACCURACY_TIME_SYNCH' },
          { target: 'SET_HIGH_ACCURACY_TIME_SYNCH' }
        ]
      },
      FAILED: {
        entry: assign({
          status: () => 'error',
          errorMessage: ({ context }) => context.errorMessage || 'Time synchronization failed'
        }),
        type: 'final'
      },
      SUCCESS: {
        entry: assign({ status: () => 'success' }),
        type: 'final'
      }
    }
  })
}
