/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { AMT, type Common } from '@device-management-toolkit/wsman-messages'
import { assign, fromPromise, sendTo, setup } from 'xstate'
import { coalesceMessage, type CommonMaintenanceContext, HttpResponseError } from '../common.js'
import Logger from '../../Logger.js'
import { doneFail, doneSuccess } from './doneResponse.js'
import got from 'got'
import { Environment } from '../../utils/Environment.js'
import { devices } from '../../devices.js'
import { invokeWsmanCall } from '../common.js'
import { Error as ErrorStateMachine } from './../error.js'

export interface HostNameInfo {
  dnsSuffixOS: string
  hostname?: string
}

export const MessageMissingHostName = 'host name was not provided'
export const MessageAlreadySynchronized = 'host name already synchronized'

export const SyncHostNameEventType = 'SYNC_HOST_NAME'
export interface SyncHostNameEvent {
  type: typeof SyncHostNameEventType | 'ONFAILED'
  clientId: string
  hostNameInfo: HostNameInfo
  output?: any
}

export interface SyncHostNameContext extends CommonMaintenanceContext {
  generalSettings: Common.Models.Response<AMT.Models.GeneralSettingsResponse> | null
  hostNameInfo: HostNameInfo
}

const amt = new AMT.Messages()
const logger = new Logger('syncHostName')

export class SyncHostName {
  getGeneralSettings = async ({ input }: { input: SyncHostNameContext }): Promise<any> => {
    input.xmlMessage = amt.GeneralSettings.Get()
    return await invokeWsmanCall(input, 2)
  }

  putGeneralSettings = async ({ input }: { input: SyncHostNameContext }): Promise<AMT.Models.GeneralSettings> => {
    let errMsg: string | null = null
    if (!input.hostNameInfo.hostname) {
      errMsg = MessageMissingHostName
    } else if (input.hostNameInfo.hostname === input.generalSettings?.Envelope.Body.AMT_GeneralSettings?.HostName) {
      errMsg = MessageAlreadySynchronized
    }
    if (errMsg != null) {
      throw new Error(`at put AMT_GeneralSettings ${errMsg}`)
    }
    const settingsToPut = {
      ...input.generalSettings?.Envelope.Body.AMT_GeneralSettings,
      HostName: input.hostNameInfo.hostname
    }
    input.xmlMessage = amt.GeneralSettings.Put(settingsToPut)
    const rsp = await invokeWsmanCall<Common.Models.Response<AMT.Models.GeneralSettingsResponse>>(input, 2)
    if (!rsp.Envelope.Body.AMT_GeneralSettings) {
      throw new Error(`invalid response: ${JSON.stringify(rsp)}`)
    }
    logger.debug(`AMT_GeneralSettings: ${JSON.stringify(rsp.Envelope.Body.AMT_GeneralSettings)}`)
    return rsp.Envelope.Body.AMT_GeneralSettings
  }

  saveToMPS = async ({ input }: { input: SyncHostNameContext }): Promise<string> => {
    const clientObj = devices[input.clientId]
    const url = `${Environment.Config.mps_server}/api/v1/devices`
    const jsonData = {
      guid: clientObj.uuid,
      hostname: input.hostNameInfo.hostname,
      dnsSuffix: input.hostNameInfo.dnsSuffixOS
    }
    const rsp = await got.patch(url, { json: jsonData })
    if (rsp.statusCode !== 200) {
      throw new HttpResponseError(rsp.statusMessage != null ? rsp.statusMessage : '', rsp.statusCode)
    }
    if (input.hostNameInfo.hostname == null) {
      throw new Error('Hostname can not be null/undefined')
    }
    logger.debug(`savedToMPS ${JSON.stringify(jsonData)}`)
    return input.hostNameInfo.hostname
  }

  error: ErrorStateMachine = new ErrorStateMachine()
  machine = setup({
    types: {} as {
      context: SyncHostNameContext
      events: SyncHostNameEvent
      input: SyncHostNameContext
      actions: any
    },
    actors: {
      getGeneralSettings: fromPromise(this.getGeneralSettings),
      putGeneralSettings: fromPromise(this.putGeneralSettings),
      saveToMPS: fromPromise(this.saveToMPS),
      error: this.error.machine
    },
    guards: {
      isGeneralSettings: ({ context, event }) => context.targetAfterError === 'GET_GENERAL_SETTINGS'
    }
  }).createMachine({
    id: 'sync-host-name',
    context: ({ input }) => ({
      taskName: input.taskName,
      clientId: input.clientId,
      message: input.message,
      errorMessage: input.errorMessage,
      statusMessage: input.statusMessage,
      parseErrorCount: 0,
      httpHandler: input.httpHandler,
      hostNameInfo: input.hostNameInfo,
      generalSettings: input.generalSettings
    }),
    initial: 'INITIAL',
    states: {
      INITIAL: {
        on: {
          SYNC_HOST_NAME: {
            actions: assign({
              clientId: ({ event }) => event.clientId,
              hostNameInfo: ({ event }) => event.hostNameInfo
            }),
            target: 'GET_GENERAL_SETTINGS'
          }
        }
      },
      GET_GENERAL_SETTINGS: {
        entry: assign({
          message: () => '',
          errorMessage: () => ''
        }),
        invoke: {
          src: 'getGeneralSettings',
          input: ({ context }) => context,
          id: 'get-general-settings',
          onDone: {
            actions: assign({ generalSettings: ({ event }) => event.output }),
            target: 'PUT_GENERAL_SETTINGS'
          },
          onError: {
            actions: assign({
              message: ({ event }) => event.error,
              errorMessage: ({ event }) => coalesceMessage('at GET_GENERAL_SETTINGS', event.error),
              targetAfterError: () => 'GET_GENERAL_SETTINGS'
            }),
            target: 'ERROR'
          }
        }
      },
      PUT_GENERAL_SETTINGS: {
        entry: assign({
          message: () => '',
          errorMessage: () => ''
        }),
        invoke: {
          src: 'putGeneralSettings',
          input: ({ context }) => context,
          id: 'put-host-name-info',
          onDone: {
            actions: assign({ statusMessage: ({ event }) => event.output as string }),
            target: 'SAVE_TO_MPS'
          },
          onError: {
            actions: assign({
              errorMessage: ({ event }) => coalesceMessage('at PUT_GENERAL_SETTINGS', event.error)
            }),
            target: 'FAILED'
          }
        }
      },
      SAVE_TO_MPS: {
        entry: assign({
          message: () => '',
          errorMessage: () => ''
        }),
        invoke: {
          src: 'saveToMPS',
          input: ({ context }) => context,
          id: 'save-to-mps',
          onDone: {
            actions: assign({ statusMessage: ({ event }) => event.output }),
            target: 'SUCCESS'
          },
          onError: {
            actions: assign({
              errorMessage: ({ event }) => coalesceMessage('at SAVE_TO_MPS', event.error)
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
            actions: assign({ errorMessage: ({ event }) => event.output }),
            target: 'FAILED'
          }
        }
      },
      NEXT_STATE: {
        always: [
          {
            guard: 'isGeneralSettings',
            target: 'GET_GENERAL_SETTINGS'
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
