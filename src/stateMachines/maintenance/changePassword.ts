/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { assign, fromPromise, sendTo, setup } from 'xstate'
import {
  type CommonMaintenanceContext,
  isDigestRealmValid,
  coalesceMessage,
  HttpResponseError,
  invokeWsmanCall
} from '../common.js'
import { AMT, type Common } from '@device-management-toolkit/wsman-messages'
import { PasswordHelper } from '../../utils/PasswordHelper.js'
import { SignatureHelper } from '../../utils/SignatureHelper.js'
import { AMTUserName } from '../../utils/constants.js'
import { devices } from '../../devices.js'
import { type DeviceCredentials } from '../../interfaces/ISecretManagerService.js'
import Logger from '../../Logger.js'
import { doneSuccess, doneFail } from './doneResponse.js'
import { SecretManagerCreatorFactory } from '../../factories/SecretManagerCreatorFactory.js'
import { getPTStatusName, PTStatus } from '../../utils/PTStatus.js'
import got from 'got'
import { Environment } from '../../utils/Environment.js'
import { Error as ErrorStateMachine } from './../error.js'
export interface SetAdminACLEntryExResponse {
  Envelope: {
    Body: {
      SetAdminAclEntryEx_OUTPUT: {
        ReturnValue: number
      }
    }
  }
}

export const ChangePasswordEventType = 'CHANGE_PASSWORD'
export interface ChangePasswordEvent {
  type: typeof ChangePasswordEventType | 'ONFAILED'
  clientId: string
  newStaticPassword: string
  output?: any
}

export interface ChangePasswordContext extends CommonMaintenanceContext {
  generalSettings?: Common.Models.Response<AMT.Models.GeneralSettingsResponse>
  newStaticPassword?: string
  updatedPassword?: string
}

const amt = new AMT.Messages()
const logger = new Logger('changePassword')

export class ChangePassword {
  error: ErrorStateMachine = new ErrorStateMachine()

  getGeneralSettings = async ({
    input
  }: {
    input: ChangePasswordContext
  }): Promise<Common.Models.Response<AMT.Models.GeneralSettingsResponse>> => {
    input.xmlMessage = amt.GeneralSettings.Get()
    const rsp = await invokeWsmanCall<Common.Models.Response<AMT.Models.GeneralSettingsResponse>>(input, 2)
    const settings = rsp.Envelope?.Body.AMT_GeneralSettings
    if (!settings) {
      throw new Error(`invalid response: ${JSON.stringify(rsp)}`)
    }
    if (settings.DigestRealm == null || !isDigestRealmValid(settings.DigestRealm)) {
      throw new Error(`invalid DigestRealm ${rsp.Envelope.Body.AMT_GeneralSettings?.DigestRealm}`)
    }
    logger.debug(`AMT_GeneralSettings: ${JSON.stringify(settings)}`)
    return rsp
  }

  setAdminACLEntry = async ({ input }: { input: ChangePasswordContext }): Promise<string> => {
    const password = input.newStaticPassword ? input.newStaticPassword : PasswordHelper.generateRandomPassword()
    const data = `${AMTUserName}:${input.generalSettings?.Envelope.Body.AMT_GeneralSettings.DigestRealm}:${password}`
    const signPassword = SignatureHelper.createMd5Hash(data)
    // Convert MD5 hash to raw string which utf16
    const signPasswordMatch = signPassword.match(/../g) ?? []
    const result = signPasswordMatch.map((v) => String.fromCharCode(parseInt(v, 16))).join('')
    // Encode to base64
    const encodedPassword = Buffer.from(result, 'binary').toString('base64')
    logger.debug('sending updated password to device')
    input.xmlMessage = amt.AuthorizationService.SetAdminACLEntryEx(AMTUserName, encodedPassword)
    const wsmanRsp = await invokeWsmanCall<SetAdminACLEntryExResponse>(input)
    const output = wsmanRsp.Envelope.Body.SetAdminAclEntryEx_OUTPUT
    if (output?.ReturnValue !== PTStatus.SUCCESS.value) {
      const msg = `ReturnValue ${getPTStatusName(output?.ReturnValue)}`
      throw new Error(msg)
    }
    return password
  }

  saveToSecretProvider = async ({ input }: { input: ChangePasswordContext }): Promise<boolean> => {
    const smcf = new SecretManagerCreatorFactory()
    const secretMgr = await smcf.getSecretManager(new Logger('SecretManagerService'))
    const clientObj = devices[input.clientId]
    let credentials = (await secretMgr.getSecretAtPath(`devices/${clientObj.uuid}`)) as DeviceCredentials
    if (!credentials) {
      logger.debug(`creating new DeviceCredentials for ${clientObj.uuid}`)
      credentials = { AMT_PASSWORD: '', MEBX_PASSWORD: '' }
    }
    if (input.updatedPassword != null) {
      credentials.AMT_PASSWORD = clientObj.amtPassword = input.updatedPassword
      logger.debug(`saving DeviceCredentials for ${clientObj.uuid}`)
      const writtenCredentials = await secretMgr.writeSecretWithObject(`devices/${clientObj.uuid}`, credentials)
      if (!writtenCredentials) {
        throw new Error('saved credentials were not returned as expected')
      }
      return true
    }
    return false
  }

  refreshMPS = async ({ input }: { input: ChangePasswordContext }): Promise<boolean> => {
    const clientObj = devices[input.clientId]
    const url = `${Environment.Config.mps_server}/api/v1/devices/refresh/${clientObj.uuid}`
    let rsp: any
    let rsperr: any
    try {
      rsp = await got.delete(url)
    } catch (error) {
      rsperr = error
    }
    if (rsp === undefined && rsperr.response.statusCode !== 404) {
      throw new HttpResponseError(rsp.message, rsp.statusCode)
    }
    logger.debug(`refreshMPS ${url}`)
    return true
  }

  machine = setup({
    types: {} as {
      context: ChangePasswordContext
      events: ChangePasswordEvent
      input: ChangePasswordContext
      actions: any
    },
    actors: {
      getGeneralSettings: fromPromise(this.getGeneralSettings),
      setAdminACLEntry: fromPromise(this.setAdminACLEntry),
      saveToSecretProvider: fromPromise(this.saveToSecretProvider),
      refreshMPS: fromPromise(this.refreshMPS),
      error: this.error.machine
    },
    guards: {
      isGeneralSettings: ({ context }) => context.targetAfterError === 'GET_GENERAL_SETTINGS'
    }
  }).createMachine({
    id: 'change-password',
    context: ({ input }) => ({
      clientId: input.clientId,
      message: input.message,
      errorMessage: input.errorMessage,
      httpHandler: input.httpHandler,
      taskName: input.taskName
    }),
    initial: 'INITIAL',
    states: {
      INITIAL: {
        on: {
          CHANGE_PASSWORD: {
            actions: assign({
              clientId: ({ event }) => event.clientId,
              newStaticPassword: ({ event }) => event.newStaticPassword
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
            actions: assign({
              generalSettings: ({ event }) => event.output as any
            }),
            target: 'SET_ADMIN_ACL_ENTRY'
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
      SET_ADMIN_ACL_ENTRY: {
        entry: assign({
          message: () => '',
          errorMessage: () => ''
        }),
        invoke: {
          src: 'setAdminACLEntry',
          input: ({ context }) => context,
          id: 'set-on-device',
          onDone: {
            actions: assign({ updatedPassword: ({ event }) => event.output }),
            target: 'SAVE_TO_SECRET_PROVIDER'
          },
          onError: {
            actions: assign({
              errorMessage: ({ event }) => coalesceMessage('at SET_ADMIN_ACL_ENTRY', event.error)
            }),
            target: 'FAILED'
          }
        }
      },
      SAVE_TO_SECRET_PROVIDER: {
        entry: assign({
          message: () => '',
          errorMessage: () => ''
        }),
        invoke: {
          src: 'saveToSecretProvider',
          input: ({ context }) => context,
          id: 'save-to-secret-provider',
          onDone: {
            target: 'REFRESH_MPS'
          },
          onError: {
            actions: assign({
              errorMessage: ({ event }) => coalesceMessage('at SAVE_TO_SECRET_PROVIDER', event.error)
            }),
            target: 'FAILED'
          }
        }
      },
      REFRESH_MPS: {
        entry: assign({
          message: () => '',
          errorMessage: () => ''
        }),
        invoke: {
          src: 'refreshMPS',
          input: ({ context }) => context,
          id: 'refresh-mps',
          onDone: {
            target: 'SUCCESS'
          },
          onError: {
            actions: assign({
              errorMessage: ({ event }) => coalesceMessage('at REFRESH_MPS', event.error)
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
            actions: assign({
              errorMessage: ({ context, event }) => coalesceMessage(context.errorMessage, event.output)
            }),
            target: 'FAILED'
          }
        }
      },
      NEXT_STATE: {
        always: [
          {
            guard: 'isGeneralSettings',
            target: 'GET_GENERAL_SETTINGS'
          },
          {
            actions: assign({ errorMessage: ({ context }) => 'No valid next state' }),
            target: 'FAILED'
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
