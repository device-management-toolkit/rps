/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { type ClientMsg } from './models/RCS.Config.js'
import Logger from './Logger.js'
import { type ILogger } from './interfaces/ILogger.js'
import { Environment } from './utils/Environment.js'
import { config } from './test/helper/Config.js'

import { vi } from 'vitest'
import { devices } from './devices.js'
type Data = string | ArrayBuffer | Buffer | Buffer[]
const onSpy = vi.hoisted(() => vi.fn<any>())
let itshouldthrowerror = false
vi.mock('ws', () => ({
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
  let clientid: string
  beforeEach(() => {
    itshouldthrowerror = false
    Environment.Config = config
    clientid = 'abcd'
    devices[clientid] = {} as any
    const mockWebSocket: any = {
      on: vi.fn(),
      close: vi.fn()
    }
    devices[clientid].ClientSocket = mockWebSocket
    const stub = {
      processData: vi.fn()
    } as any
    // const serverStub = {
    //   on: vi.fn<any>()
    // } as any
    // onSpy = vi.spyOn(serverStub, 'on')
    // vi.spyOn(WebSocket, 'WebSocketServer').mockReturnValue(serverStub)
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
      on: vi.fn()
    }
    const webSocketMock = vi.spyOn(mockWebSocket, 'on')
    server.onClientConnected(mockWebSocket as any)
    expect(webSocketMock).toHaveBeenCalledTimes(3)
    expect(Object.keys(devices).length).toBe(2)
  })

  it('Should log on error', () => {
    const error: Error = {
      name: 'abc',
      message: 'abcd'
    }
    const loggerSpy = vi.spyOn(server.logger, 'error')
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
    const sendMessage = vi.spyOn(server, 'sendMessage')
    const processMessageSpy = vi.spyOn(server.dataProcessor, 'processData').mockResolvedValue(clientMsg)
    const message: Data = 'abcd'
    await server.onMessageReceived(message, clientid)
    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(processMessageSpy).toHaveBeenCalled()
  })
  it('Should generate error when maximum message length exceeded', async () => {
    const loggerSpy = vi.spyOn(server.logger, 'error')
    const message: Data = 'X'.repeat(1024 * 10 * 10 + 1)
    await server.onMessageReceived(message as any, clientid)
    expect(loggerSpy).toHaveBeenCalled()
    expect(loggerSpy).toHaveBeenCalledWith('Incoming message exceeds allowed length (102401 > 102400)')
  })

  it('Should generate error when not a string', async () => {
    const loggerSpy = vi.spyOn(server.logger, 'error')
    const message: Data = Buffer.from('break the code')
    await server.onMessageReceived(message, clientid)
    expect(loggerSpy).toHaveBeenCalled()
    expect(loggerSpy).toHaveBeenCalledWith('Incoming message exceeds allowed length (102401 > 102400)')
  })
  it('Should process client message and not respond when no response to send', async () => {
    const sendMessage = vi.spyOn(server, 'sendMessage')
    const processMessageSpy = vi.spyOn(server.dataProcessor, 'processData').mockResolvedValue(null)
    const message: Data = 'abcd'
    await server.onMessageReceived(message, clientid)
    expect(processMessageSpy).toHaveBeenCalled()
    expect(sendMessage).not.toHaveBeenCalled()
  })
  it('Should send message if client is defined in devices list', () => {
    clientid = 'test'
    devices[clientid] = {
      ClientSocket: {
        send: vi.fn()
      }
    } as any
    const spy = vi.spyOn(devices[clientid].ClientSocket, 'send')
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
