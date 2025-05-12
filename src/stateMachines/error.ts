/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { sendParent, setup } from 'xstate'
import { HttpHandler } from '../HttpHandler.js'
import { devices } from '../devices.js'
import Logger from '../Logger.js'

const httpHandler = new HttpHandler()
export interface ErrorContext {
  message: any | null
  clientId: string
}

interface ErrorEvent {
  type: 'PARSE'
  clientId: string
}

export class Error {
  logger: Logger

  addAuthorizationHeader = ({ context }: { context: ErrorContext }): void => {
    const { message, clientId } = context
    const clientObj = devices[clientId]
    if (clientObj.unauthCount == null) {
      clientObj.unauthCount = 0
    }
    clientObj.unauthCount++
    const found = message?.headers?.find((item) => item.name === 'Www-Authenticate')
    if (found?.value != null) {
      if (clientObj.connectionParams) {
        clientObj.connectionParams.digestChallenge = httpHandler.parseAuthenticateResponseHeader(found.value)
      }
    }
  }

  resetAuthCount = ({ context }: { context: ErrorContext }): void => {
    if (devices[context.clientId] != null) {
      devices[context.clientId].unauthCount = 0
      this.logger.silly(`Reset unauthCount of ${context.clientId} to 0`)
    }
  }

  machine = setup({
    types: {} as {
      context: ErrorContext
      events: ErrorEvent
      actions: any
      input: ErrorContext
    },
    guards: {
      isMaxRetries: ({ context }) => devices[context.clientId].unauthCount < 3,
      isBadRequest: ({ context }) => context.message?.statusCode === 400,
      isUnauthorized: ({ context }) => context.message?.statusCode === 401
    },
    actions: {
      respondUnauthorized: sendParent(() => ({
        type: 'ONFAILED',
        output: 'Unable to authenticate with AMT'
      })),
      respondBadRequest: sendParent(({ context }) => ({
        type: 'ONFAILED',
        output: context.message?.statusMessage
      })),
      respondUnknown: sendParent(() => ({
        type: 'ONFAILED',
        output: 'Unknown error has occured'
      })),
      addAuthorizationHeader: this.addAuthorizationHeader,
      resetAuthCount: this.resetAuthCount
    }
  }).createMachine({
    context: ({ input }) => {
      this.logger.silly(`${JSON.stringify(input.message)}`)
      return { message: input.message, clientId: input.clientId }
    },
    id: 'error-machine',
    initial: 'ERRORED',
    states: {
      ERRORED: {
        on: {
          PARSE: [
            {
              guard: 'isUnauthorized',
              target: 'UNAUTHORIZED'
            },
            {
              guard: 'isBadRequest',
              target: 'BADREQUEST'
            },
            {
              target: 'UNKNOWN'
            }
          ]
        }
      },
      UNAUTHORIZED: {
        entry: 'addAuthorizationHeader',
        always: [
          {
            guard: 'isMaxRetries',
            target: 'AUTHORIZED'
          },
          {
            target: 'FAILEDAUTHORIZED'
          }
        ]
      },
      AUTHORIZED: {
        type: 'final'
      },
      FAILEDAUTHORIZED: {
        entry: ['resetAuthCount', 'respondUnauthorized']
      },
      BADREQUEST: {
        entry: ['resetAuthCount', 'respondBadRequest']
      },
      UNKNOWN: {
        entry: ['resetAuthCount', 'respondUnknown']
      }
    }
  })

  constructor() {
    this.logger = new Logger('Error_State_Machine')
  }
}
