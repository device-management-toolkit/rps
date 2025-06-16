/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { Environment } from '../utils/Environment.js'
import { HttpHandler } from '../HttpHandler.js'
import Logger from '../Logger.js'
import ClientResponseMsg from '../utils/ClientResponseMsg.js'
import { devices } from '../devices.js'
import { GATEWAY_TIMEOUT_ERROR, UNEXPECTED_PARSE_ERROR, EA_TIMEOUT_ERROR } from '../utils/constants.js'
import { randomUUID } from 'node:crypto'
import { WSEnterpriseAssistantListener, enterpriseAssistantSocket, promises } from '../WSEnterpriseAssistantListener.js'
import { config } from '../test/helper/Config.js'
import { jest } from '@jest/globals'
import { spyOn } from 'jest-mock'
import {
  invokeEnterpriseAssistantCall,
  invokeEnterpriseAssistantCallInternal,
  invokeWsmanCall,
  coalesceMessage
} from './common.js'

Environment.Config = config
describe('Common', () => {
  const clientId = randomUUID()
  let sendSpy
  let responseMessageSpy: jest.Spied<any>
  let wrapItSpy: jest.Spied<any>
  let enterpriseAssistantSocketSendSpy: jest.Spied<any>
  const context = {
    message: '',
    clientId,
    xmlMessage: '<?xml version="1.0" encoding="UTF-8"?><a:Envelope>Test Content</a:Envelope>',
    httpHandler: new HttpHandler()
  }
  beforeEach(() => {
    jest.useFakeTimers()
    devices[clientId] = {
      ClientSocket: {
        send: jest.fn()
      },
      connectionParams: {
        guid: clientId,
        port: 16992,
        digestChallenge: null
      }
    } as any

    wrapItSpy = spyOn(context.httpHandler, 'wrapIt')
    responseMessageSpy = spyOn(ClientResponseMsg, 'get')
    sendSpy = spyOn(devices[clientId].ClientSocket, 'send').mockReturnValue()
    const x = new WSEnterpriseAssistantListener(new Logger('test'))
    x.onClientConnected({
      send: jest.fn(),
      on: jest.fn()
    } as any)
    enterpriseAssistantSocketSendSpy = spyOn(enterpriseAssistantSocket, 'send').mockImplementation(() => ({}) as any)
  })

  afterEach(() => {
    jest.runAllTicks()
    jest.useRealTimers()
  })

  it('should send a WSMan message once with successful reply', async () => {
    const expected = '123'
    const wsmanPromise = invokeWsmanCall(context, 2)
    expect(wrapItSpy).toHaveBeenCalled()
    expect(responseMessageSpy).toHaveBeenCalled()
    expect(sendSpy).toHaveBeenCalledTimes(1)
    expect(devices[clientId].pendingPromise).toBeDefined()
    devices[clientId].resolve(expected)
    await expect(wsmanPromise).resolves.toEqual(expected)
  })
  it('should successfully resolve after one UNEXPECTED_PARSE_ERROR', async () => {
    const expected = '123'
    let invokeWsmanCallInternalCallCount = 0
    sendSpy = spyOn(devices[clientId].ClientSocket, 'send')
    sendSpy.mockImplementation(async (context) => {
      invokeWsmanCallInternalCallCount++
      if (invokeWsmanCallInternalCallCount === 1) {
        devices[clientId].reject(new UNEXPECTED_PARSE_ERROR())
      } else {
        devices[clientId].resolve(expected)
      }
    })
    const wsmanPromise = invokeWsmanCall(context, 2)
    await expect(wsmanPromise).resolves.toEqual(expected)
    expect(sendSpy).toHaveBeenCalledTimes(2)
  })
  it('should successfully resolve after two UNEXPECTED_PARSE_ERROR', async () => {
    const expected = '123'
    let invokeWsmanCallInternalCallCount = 0

    sendSpy = spyOn(devices[clientId].ClientSocket, 'send')
    sendSpy.mockImplementation(async (context) => {
      invokeWsmanCallInternalCallCount++
      if (invokeWsmanCallInternalCallCount <= 2) {
        devices[clientId].reject(new UNEXPECTED_PARSE_ERROR())
      } else {
        devices[clientId].resolve(expected)
      }
    })
    const wsmanPromise = invokeWsmanCall(context, 2)
    await expect(wsmanPromise).resolves.toEqual(expected)
    expect(sendSpy).toHaveBeenCalledTimes(3)
  })

  it('should try three times on UNEXPECTED_PARSE_ERROR', async () => {
    const expected = '123'
    let invokeWsmanCallInternalCallCount = 0
    sendSpy = spyOn(devices[clientId].ClientSocket, 'send')
    sendSpy.mockImplementation(async (context) => {
      invokeWsmanCallInternalCallCount++
      if (invokeWsmanCallInternalCallCount <= 3) {
        devices[clientId].reject(new UNEXPECTED_PARSE_ERROR())
      } else {
        devices[clientId].resolve(expected)
      }
    })
    const wsmanPromise = invokeWsmanCall(context, 2)
    await expect(wsmanPromise).rejects.toBeInstanceOf(UNEXPECTED_PARSE_ERROR)
    expect(sendSpy).toHaveBeenCalledTimes(3)
  })

  it('should not retry by default on UNEXPECTED_PARSE_ERROR', async () => {
    const wsmanPromise = invokeWsmanCall(context)
    expect(sendSpy).toHaveBeenCalledTimes(1)
    devices[clientId].reject(new UNEXPECTED_PARSE_ERROR())
    expect(sendSpy).toHaveBeenCalledTimes(1)
    await expect(wsmanPromise).rejects.toBeInstanceOf(UNEXPECTED_PARSE_ERROR)
  })
  it('should not retry when error is not UNEXPECTED_PARSE_ERROR', async () => {
    const expected = {
      statusCode: 401,
      statusMessage: 'Unauthorized'
    }
    let invokeWsmanCallInternalCallCount = 0
    sendSpy = spyOn(devices[clientId].ClientSocket, 'send')
    sendSpy.mockImplementation(async (context) => {
      invokeWsmanCallInternalCallCount++
      if (invokeWsmanCallInternalCallCount <= 1) {
        devices[clientId].reject(new UNEXPECTED_PARSE_ERROR())
      } else {
        devices[clientId].reject(expected)
      }
    })
    const wsmanPromise = invokeWsmanCall(context, 2)
    await expect(wsmanPromise).rejects.toEqual(expected)
    expect(sendSpy).toHaveBeenCalledTimes(2)
  })
  it('should send an enterprise-assistant message', async () => {
    void invokeEnterpriseAssistantCallInternal(context)

    expect(enterpriseAssistantSocketSendSpy).toHaveBeenCalled()
    expect(promises[clientId].pendingPromise).toBeDefined()
    expect(promises[clientId].resolve).toBeDefined()
    expect(promises[clientId].reject).toBeDefined()
  })

  it('should timeout on no response from AMT', async () => {
    try {
      const x = invokeWsmanCall(context)
      jest.advanceTimersByTime(Environment.Config.delay_timer * 1000)
      await x
    } catch (err) {
      expect(err).toBeInstanceOf(GATEWAY_TIMEOUT_ERROR)
    }
  })

  it('should timeout on no response from EA', async () => {
    try {
      const x = invokeEnterpriseAssistantCall(context)
      jest.advanceTimersByTime(Environment.Config.delay_timer * 1000)
      await x
    } catch (err) {
      expect(err).toBeInstanceOf(EA_TIMEOUT_ERROR)
    }
  })
  it('should return coalesced error message', () => {
    const prefix = 'test error'
    const anyErr = {
      statusCode: 400,
      statusMessage: 'Bad Request'
    }
    const msg = coalesceMessage(prefix, anyErr)
    expect(msg).toBeTruthy()
    expect(msg).toContain(prefix)
    expect(msg).toContain('Bad Request')
    expect(msg).toContain('400')
  })
})
