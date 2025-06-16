/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import Logger from './Logger.js'
import { type ILogger } from './interfaces/ILogger.js'
import { promises, enterpriseAssistantSocket, WSEnterpriseAssistantListener } from './WSEnterpriseAssistantListener.js'
import { jest } from '@jest/globals'
import { spyOn } from 'jest-mock'

describe('Websocket Listener', () => {
  const log: ILogger = new Logger('WebSocketListener')
  let server: WSEnterpriseAssistantListener
  let isConnected: boolean
  let onSpy: jest.Spied<any>
  let serverStub
  beforeEach(() => {
    serverStub = {
      on: jest.fn()
    } as any
    onSpy = spyOn(serverStub, 'on')
    server = new WSEnterpriseAssistantListener(log)
  })
  it('should start WebSocket server', () => {
    isConnected = server.connect(serverStub)
    expect(onSpy).toHaveBeenCalledTimes(1)
    expect(isConnected).toEqual(true)
  })

  it('should NOT start WebSocket server when exception ', () => {
    const ret = server.connect(null as any)
    expect(onSpy).toHaveBeenCalledTimes(0)
    expect(ret).toEqual(false)
  })

  it('Should initialize enterprise assistant socket on connect', async () => {
    const mockWebSocket = {
      on: jest.fn()
    }
    const webSocketMock = spyOn(mockWebSocket, 'on')
    server.onClientConnected(mockWebSocket as any)
    expect(webSocketMock).toHaveBeenCalledTimes(3)
    expect(enterpriseAssistantSocket).toBeDefined()
  })

  it('Should log on error', async () => {
    const error: Error = {
      name: 'abc',
      message: 'abcd'
    }
    const loggerSpy = spyOn(server.logger, 'error')
    server.onError(error)
    expect(loggerSpy).toHaveBeenCalled()
  })

  it('Should process enterprise assistant message and send response', async () => {
    promises['4c4c4544-004d-4d10-8050-b2c04f325133'] = {} as any
    promises['4c4c4544-004d-4d10-8050-b2c04f325133'].pendingPromise = new Promise((resolve, reject) => {
      promises['4c4c4544-004d-4d10-8050-b2c04f325133'].resolve = resolve
      promises['4c4c4544-004d-4d10-8050-b2c04f325133'].reject = reject
    })
    const promiseSpy = spyOn(promises['4c4c4544-004d-4d10-8050-b2c04f325133'], 'resolve')

    const message: any = JSON.stringify({
      action: 'satellite',
      subaction: '802.1x-ProFile-Request',
      satelliteFlags: 2,
      nodeid: '4c4c4544-004d-4d10-8050-b2c04f325133',
      domain: 'domain.com',
      reqid: '1238u43573459843598',
      authProtocol: 0,
      osname: 'win11',
      devname: 'WinDev2211Eval',
      icon: 1,
      cert: null,
      certid: null,
      ver: ''
    })

    await server.onMessageReceived(message)
    expect(promiseSpy).toHaveBeenCalled()
  })

  it('Should generate error when not parse-able', async () => {
    const loggerSpy = spyOn(server.logger, 'error')
    const message: any = 'break the code'
    await server.onMessageReceived(message)
    expect(loggerSpy).toHaveBeenCalled()
  })
  // it('Should process client message and not respond when no response to send', async () => {
  //   const processMessageSpy = spyOn(server.dataProcessor, 'processData').mockResolvedValue(null)
  //   const message: WebSocket.Data = 'abcd'
  //   await server.onMessageReceived(message)
  //   expect(processMessageSpy).toHaveBeenCalled()
  // })
})
