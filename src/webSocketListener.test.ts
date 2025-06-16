/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { type ClientMsg } from './models/RCS.Config.js'
import Logger from './Logger.js'
import { type ILogger } from './interfaces/ILogger.js'
import { Environment } from './utils/Environment.js'
import { config } from './test/helper/Config.js'
import { jest } from '@jest/globals'
import { spyOn } from 'jest-mock'
import { devices } from './devices.js'
type Data = string | ArrayBuffer | Buffer | Buffer[]
const onSpy = jest.fn<any>()
let itshouldthrowerror = false
jest.unstable_mockModule('ws', () => ({
  WebSocketServer: class {
    constructor() {
      if (itshouldthrowerror) {
        throw new Error('fake')
      }
      // do nothing
      console.log('fake')
    }

    on = onSpy
  }
}))

const wslistener = await import('./WebSocketListener.js')

describe('Websocket Listener', () => {
  const log: ILogger = new Logger('WebSocketListener')
  let server
  let isConnected: boolean
  // let onSpy: jest.Spied<any>
  let clientid: string
  beforeEach(() => {
    itshouldthrowerror = false
    Environment.Config = config
    clientid = 'abcd'
    devices[clientid] = {} as any
    const mockWebSocket: any = {
      on: jest.fn(),
      close: jest.fn()
    }
    devices[clientid].ClientSocket = mockWebSocket
    const stub = {
      processData: jest.fn()
    } as any
    // const serverStub = {
    //   on: jest.fn<any>()
    // } as any
    // onSpy = spyOn(serverStub, 'on')
    // spyOn(WebSocket, 'WebSocketServer').mockReturnValue(serverStub)
    server = new wslistener.WebSocketListener(log, stub)
    onSpy.mockReset()
  })
  it('should start WebSocket server', () => {
    isConnected = server.connect()
    expect(isConnected).toEqual(true)
  })

  it('should NOT start WebSocket server when exception ', () => {
    itshouldthrowerror = true
    const ret = server.connect()
    expect(onSpy).toHaveBeenCalledTimes(0)
    expect(ret).toEqual(false)
  })

  it('Should remove client from devices on disconnect', () => {
    server.onClientDisconnected(clientid)
    expect(devices[clientid]).toBeUndefined()
  })

  it('Should initialize device on connect', () => {
    const mockWebSocket = {
      on: jest.fn()
    }
    const webSocketMock = spyOn(mockWebSocket, 'on')
    server.onClientConnected(mockWebSocket as any)
    expect(webSocketMock).toHaveBeenCalledTimes(3)
    expect(Object.keys(devices).length).toBe(2)
  })

  it('Should log on error', () => {
    const error: Error = {
      name: 'abc',
      message: 'abcd'
    }
    const loggerSpy = spyOn(server.logger, 'error')
    server.onError(error, clientid)
    expect(loggerSpy).toHaveBeenCalled()
  })

  it('Should process client message and send response', async () => {
    const clientMsg: ClientMsg = {
      method: 'myMethod',
      apiKey: 'abcd',
      appVersion: '1.0',
      protocolVersion: '2.0',
      status: '200',
      message: 'success',
      payload: null,
      tenantId: ''
    }
    const sendMessage = spyOn(server, 'sendMessage')
    const processMessageSpy = spyOn(server.dataProcessor, 'processData').mockResolvedValue(clientMsg)
    const message: Data = 'abcd'
    await server.onMessageReceived(message, clientid)
    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(processMessageSpy).toHaveBeenCalled()
  })
  it('Should generate error when maximum message length exceeded', async () => {
    const loggerSpy = spyOn(server.logger, 'error')
    const message: Data = 'X'.repeat(1024 * 10 * 10 + 1)
    await server.onMessageReceived(message as any, clientid)
    expect(loggerSpy).toHaveBeenCalled()
    expect(loggerSpy).toHaveBeenCalledWith('Incoming message exceeds allowed length')
  })

  it('Should generate error when not a string', async () => {
    const loggerSpy = spyOn(server.logger, 'error')
    const message: Data = Buffer.from('break the code')
    await server.onMessageReceived(message, clientid)
    expect(loggerSpy).toHaveBeenCalled()
    expect(loggerSpy).toHaveBeenCalledWith('Incoming message exceeds allowed length')
  })
  it('Should process client message and not respond when no response to send', async () => {
    const sendMessage = spyOn(server, 'sendMessage')
    const processMessageSpy = spyOn(server.dataProcessor, 'processData').mockResolvedValue(null)
    const message: Data = 'abcd'
    await server.onMessageReceived(message, clientid)
    expect(processMessageSpy).toHaveBeenCalled()
    expect(sendMessage).not.toHaveBeenCalled()
  })
  it('Should send message if client is defined in devices list', () => {
    clientid = 'test'
    devices[clientid] = {
      ClientSocket: {
        send: jest.fn()
      }
    } as any
    const spy = spyOn(devices[clientid].ClientSocket, 'send')
    const message: ClientMsg = {} as any
    server.sendMessage(message, clientid)
    expect(spy).toHaveBeenCalled()
  })

  it('Should NOT send message if client is not defined in devices list', () => {
    clientid = 'test'
    const message: ClientMsg = {} as any
    server.sendMessage(message, clientid)
  })
})
