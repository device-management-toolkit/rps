/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { AMT } from '@device-management-toolkit/wsman-messages'
import { assign, fromPromise, sendTo, setup } from 'xstate'
import {
  buildFailure,
  coalesceMessage,
  type CommonContext,
  failAt,
  invokeWsmanCall,
  returnValueOf,
  failureAfterErrorMachine
} from './common.js'
import { Error as ErrorStateMachine } from './error.js'
import Logger from '../Logger.js'
import { type ProvisioningFailure } from '../models/RCS.Config.js'

export interface TimeSyncContext extends CommonContext {
  status: string
  lmsInstalled?: boolean
}

export interface TimeSyncEvent {
  type: 'ONFAILED'
  output?: any
  failure?: ProvisioningFailure
}

export class TimeSync {
  logger = new Logger('ActivationTimeSync')
  error: ErrorStateMachine = new ErrorStateMachine()

  enableLocalTimeSync = async ({ input }: { input: TimeSyncContext }): Promise<any> => {
    this.logger.debug('Activation time sync: sending EnableLocalTimeSync(true)')
    const amt = new AMT.Messages()
    input.xmlMessage = amt.TimeSynchronizationService.EnableLocalTimeSync(true)
    // A non-zero ReturnValue is not thrown here: ENABLE_LOCAL_TIME_SYNC_RESPONSE maps it to its AMT code.
    return await invokeWsmanCall<{
      Envelope: { Body: { EnableLocalTimeSync_OUTPUT: { ReturnValue: number } } }
    }>(input)
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
    output: ({ context }) => ({ status: context.status, errorMessage: context.errorMessage, failure: context.failure }),
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
            actions: assign(({ context, event }) => ({
              message: event.error,
              targetAfterError: 'ENABLE_LOCAL_TIME_SYNC',
              ...failAt('ENABLE_LOCAL_TIME_SYNC', 'TimeSync', {
                message: () => coalesceMessage('at ENABLE_LOCAL_TIME_SYNC', event.error),
                error: () => event.error
              })({ context, event })
            })),
            target: 'ERROR'
          }
        }
      },
      ENABLE_LOCAL_TIME_SYNC_RESPONSE: {
        always: [
          { guard: 'isEnableLocalTimeSyncSuccessful', target: 'SUCCESS' },
          {
            actions: assign(
              failAt('ENABLE_LOCAL_TIME_SYNC_RESPONSE', 'TimeSync', {
                message: 'Failed to ENABLE_LOCAL_TIME_SYNC',
                returnValue: ({ context }) => returnValueOf(context.message, 'EnableLocalTimeSync')
              })
            ),
            target: 'FAILED'
          }
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
            actions: assign(({ context, event }) => ({
              message: event.error,
              targetAfterError: 'GET_LOW_ACCURACY_TIME_SYNCH',
              ...failAt('GET_LOW_ACCURACY_TIME_SYNCH', 'TimeSync', {
                message: () => coalesceMessage('at GET_LOW_ACCURACY_TIME_SYNCH', event.error),
                error: () => event.error
              })({ context, event })
            })),
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
            actions: assign(
              failAt('GET_LOW_ACCURACY_TIME_SYNCH_RESPONSE', 'TimeSync', {
                message: 'Failed to GET_LOW_ACCURACY_TIME_SYNC',
                returnValue: ({ context }) => returnValueOf(context.message, 'GetLowAccuracyTimeSynch')
              })
            ),
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
            actions: assign(
              failAt('SET_HIGH_ACCURACY_TIME_SYNCH', 'TimeSync', {
                message: 'Failed to SET_HIGH_ACCURACY_TIME_SYNCH',
                error: ({ event }) => event.error
              })
            ),
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
            actions: assign(
              failAt('SET_HIGH_ACCURACY_TIME_SYNCH_RESPONSE', 'TimeSync', {
                message: 'Failed to SET_HIGH_ACCURACY_TIME_SYNCH',
                returnValue: ({ context }) => returnValueOf(context.message, 'SetHighAccuracyTimeSynch')
              })
            ),
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
            actions: assign(({ context, event }) => ({
              message: event.error,
              failure: buildFailure('ERROR', 'TimeSync', { error: () => event.error }, { context, event }).failure
            })),
            target: 'FAILED'
          },
          // The error machine recovered (e.g. digest retry): the recorded failure no longer applies.
          onDone: { actions: assign({ failure: undefined }), target: 'NEXT_STATE' }
        },
        on: {
          ONFAILED: {
            actions: assign({
              errorMessage: ({ context, event }) => coalesceMessage(context.message, event.output),
              failure: (args) => failureAfterErrorMachine('TimeSync', args)
            }),
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
          errorMessage: ({ context }) => context.errorMessage || 'Time synchronization failed',
          // Always leave a structured failure behind, even when a path reached FAILED without one.
          failure: ({ context, event }) =>
            context.failure ??
            buildFailure(
              'FAILED',
              'TimeSync',
              { code: 'RPS_UNEXPECTED_ERROR', message: context.errorMessage || 'Time synchronization failed' },
              { context, event }
            ).failure
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
