/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { sendParent, setup } from 'xstate'
import { HttpHandler } from '../HttpHandler.js'
import { devices } from '../devices.js'
import { type HttpZResponseModel } from 'http-z'
import Logger from '../Logger.js'
import { type ProvisioningFailure } from '../models/RCS.Config.js'
import { type ErrorCode } from '../utils/errorCatalog.js'
import { resolveFailure } from '../utils/resolveFailure.js'

const errorLogger = new Logger('ErrorHandler')

const httpHandler = new HttpHandler()
export interface ErrorContext {
  message: HttpZResponseModel | null
  clientId: string
}

interface ErrorEvent {
  type: 'PARSE'
  clientId: string
}

/**
 * Event sent to the parent machine when the HTTP-level error cannot be recovered. `output` is the
 * legacy text parents already assign to errorMessage; `failure` is the structured description
 * (code, step, reason, HTTP status) built from the response. The error machine does not know which
 * component or step invoked it, so Step is its own state and Component defaults to 'Activation';
 * parents prefer the failure they recorded on the way in (see failureAfterErrorMachine).
 */
export interface ErrorFailedEvent {
  type: 'ONFAILED'
  output: string
  failure: ProvisioningFailure
}

const buildFailure = (step: string, code: ErrorCode, message: HttpZResponseModel | null): ProvisioningFailure =>
  resolveFailure(step, 'Activation', { code, error: message ?? undefined })

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

    // Check for Connection: close header - indicates TCP connection will close after response
    // For TLS enforced mode, we need to close the old tunnel so a new one is created for the retry
    const connectionHeader = message?.headers?.find((item) => item.name.toLowerCase() === 'connection')
    if (connectionHeader?.value?.toLowerCase() === 'close' && clientObj.tlsEnforced === true) {
      this.logger.debug(`Connection: close detected for ${clientId}, closing TLS tunnel for re-establishment`)
      // Close the existing TLS tunnel - a new one will be created when the retry happens
      if (clientObj.tlsTunnelManager != null) {
        clientObj.tlsTunnelManager.close()
        clientObj.tlsTunnelManager = undefined
      }
      clientObj.tlsTunnelNeedsReset = true
    }
  }

  resetAuthCount = ({ context }: { context: ErrorContext }): void => {
    if (devices[context.clientId] != null) {
      devices[context.clientId].unauthCount = 0
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
      respondUnauthorized: sendParent(
        ({ context }): ErrorFailedEvent => ({
          type: 'ONFAILED',
          output: 'Unable to authenticate with AMT',
          failure: buildFailure('UNAUTHORIZED', 'WSMAN_AUTH_FAILED', context.message)
        })
      ),
      respondBadRequest: sendParent(
        ({ context }): ErrorFailedEvent => ({
          type: 'ONFAILED',
          output: context.message?.statusMessage as string,
          failure: buildFailure('BADREQUEST', 'WSMAN_BAD_REQUEST', context.message)
        })
      ),
      respondUnknown: sendParent(
        ({ context }): ErrorFailedEvent => ({
          type: 'ONFAILED',
          output: 'Unknown error has occured',
          failure: buildFailure('UNKNOWN', 'WSMAN_REQUEST_FAILED', context.message)
        })
      ),
      addAuthorizationHeader: this.addAuthorizationHeader,
      resetAuthCount: this.resetAuthCount
    }
  }).createMachine({
    context: ({ input }) => ({ message: input.message, clientId: input.clientId }),
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
