/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import ClientResponseMsg from '../utils/ClientResponseMsg.js'
import { Environment } from '../utils/Environment.js'
import { devices } from '../devices.js'
import {
  type EnterpriseAssistantMessage,
  enterpriseAssistantSocket,
  promises
} from '../WSEnterpriseAssistantListener.js'
import { GATEWAY_TIMEOUT_ERROR, UNEXPECTED_PARSE_ERROR, EA_TIMEOUT_ERROR } from '../utils/constants.js'
import Logger from '../Logger.js'
import { type HttpHandler } from '../HttpHandler.js'

const invokeWsmanLogger = new Logger('invokeWsmanCall')

/**
 * If retries is more than 0, will resend the message
 * if the response cannot be parsed.
 *
 * @param context
 * @param retries <optional> ADDITIONAL times to send the message.
 * If you want to try a total of 3 times, retries should equal 2
 */
export class HttpResponseError extends Error {
  statusCode: number

  constructor(message: string, statusCode: number) {
    super(message)
    this.name = this.constructor.name
    this.statusCode = statusCode
    Error.captureStackTrace(this, this.constructor)
  }
}
const invokeWsmanCallInternal = async <T>(context: any): Promise<T> => {
  const { clientId, xmlMessage, httpHandler } = context
  const clientObj = devices[clientId]
  const message = httpHandler.wrapIt(xmlMessage, clientObj.connectionParams)
  const clientMsg = ClientResponseMsg.get(clientId, message, 'wsman', 'ok')
  const clientMsgStr = JSON.stringify(clientMsg)
  clientObj.pendingPromise = new Promise<T>((resolve, reject) => {
    clientObj.resolve = resolve
    clientObj.reject = reject
  })
  if (clientObj.ClientSocket) {
    clientObj.ClientSocket.send(clientMsgStr)
    return await clientObj.pendingPromise
  }
  invokeWsmanLogger.warn('No client socket')
  return clientObj.reject as any
}

const timeout = async (ms: number): Promise<void> => {
  await new Promise((_resolve, reject) => {
    setTimeout(() => {
      reject(new GATEWAY_TIMEOUT_ERROR())
    }, ms)
  })
}

const invokeWsmanCall = async <T>(context: any, maxRetries = 0): Promise<T> => {
  let retries = 0
  while (retries <= maxRetries) {
    try {
      const result = await Promise.race([
        invokeWsmanCallInternal<T>(context),
        timeout(Environment.Config.delay_timer * 1000)
      ])
      return result as any
    } catch (error) {
      if (error instanceof UNEXPECTED_PARSE_ERROR && retries < maxRetries) {
        retries++
        invokeWsmanLogger.warn(`Retrying... Attempt ${retries}`)
      } else {
        throw error
      }
    }
  }
  return await Promise.reject(new Error('Max retries reached'))
}
const invokeEnterpriseAssistantCallInternal = async (context: any): Promise<EnterpriseAssistantMessage> => {
  const { clientId, message } = context
  enterpriseAssistantSocket.send(JSON.stringify(message))
  if (promises[clientId] == null) {
    promises[clientId] = {} as any
  }
  promises[clientId].pendingPromise = new Promise<any>((resolve, reject) => {
    promises[clientId].resolve = resolve
    promises[clientId].reject = reject
  })
  return await promises[clientId].pendingPromise
}

const eaTimeout = (ms): any =>
  new Promise((resolve, reject) => {
    setTimeout(() => {
      reject(new EA_TIMEOUT_ERROR())
    }, ms)
  })

const invokeEnterpriseAssistantCall = async (context: any): Promise<EnterpriseAssistantMessage> => {
  const result = await Promise.race([
    invokeEnterpriseAssistantCallInternal(context),
    eaTimeout(Environment.Config.delay_timer * 1000)
  ])
  return result
}

export type EnumerationContext = string

export function coalesceMessage(prefixMsg: string, err: any): string {
  let msg = prefixMsg
  if (err?.statusCode) {
    msg = `${msg} ${err.statusCode}`
    if (err.statusMessage) {
      msg = `${msg} ${err.statusMessage}`
    }
  }
  if (err?.message) {
    msg = `${msg} ${err.message}`
  } else {
    if (err != null && typeof err === 'string') {
      msg = `${msg} ${err}`
    }
  }
  return msg
}

const isDigestRealmValid = (realm: string): boolean => {
  const regex = /[0-9A-Fa-f]{32}/g
  let isValidRealm = false
  let realmElements: any
  if (realm?.startsWith('Digest:')) {
    realmElements = realm.split('Digest:')
    if (realmElements[1].length === 32 && regex.test(realmElements[1])) {
      isValidRealm = true
    }
  }
  return isValidRealm
}
export interface CommonContext {
  clientId: string
  httpHandler: HttpHandler
  message?: any | null
  errorMessage?: string
  statusMessage?: string
  xmlMessage?: string | null
  parseErrorCount?: number
  targetAfterError?: string | null
}

export interface CommonMaintenanceContext extends CommonContext {
  taskName: string
  errorMessage: string
}
export {
  invokeWsmanCall,
  invokeEnterpriseAssistantCall,
  invokeEnterpriseAssistantCallInternal,
  invokeWsmanCallInternal,
  isDigestRealmValid
}
