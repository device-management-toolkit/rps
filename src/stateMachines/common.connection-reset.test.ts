/*********************************************************************
 * Copyright (c) Intel Corporation 2024
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { randomUUID } from 'node:crypto'
import { devices } from '../devices.js'
import { HttpHandler } from '../HttpHandler.js'
import { Environment } from '../utils/Environment.js'
import { config } from '../test/helper/Config.js'
import { jest } from '@jest/globals'
import { CONNECTION_RESET_ERROR } from '../utils/constants.js'

Environment.Config = config

// Mock TLSTunnelManager so retry path can create a new tunnel
const mockConnect = jest.fn<any>().mockResolvedValue(undefined)
const mockOnData = jest.fn()
const mockClose = jest.fn()
let mockSend = jest.fn<any>().mockResolvedValue(undefined)

jest.unstable_mockModule('../TLSTunnelManager.js', () => ({
  TLSTunnelManager: jest.fn().mockImplementation(() => ({
    connect: mockConnect,
    send: (data: any) => mockSend(data),
    onData: mockOnData,
    close: mockClose,
    getSessionId: () => 'mock-session'
  }))
}))

const { invokeWsmanCall } = await import('./common.js')

describe('invokeWsmanCall CONNECTION_RESET_ERROR retry', () => {
  const clientId = randomUUID()
  let context: any
  let originalDelayTlsTimer: number

  beforeEach(() => {
    originalDelayTlsTimer = Environment.Config.delay_tls_timer
    // Use minimal delays for real-timer tests
    Environment.Config.delay_tls_timer = 0.01 // 10ms

    mockConnect.mockClear()
    mockOnData.mockClear()
    mockClose.mockClear()

    const initialTunnelManager = {
      close: jest.fn(),
      connect: jest.fn<any>().mockResolvedValue(undefined),
      send: jest.fn<any>().mockResolvedValue(undefined),
      onData: jest.fn(),
      getSessionId: () => 'initial-session'
    }

    devices[clientId] = {
      ClientSocket: { send: jest.fn() } as any,
      connectionParams: { guid: clientId, port: 16992, digestChallenge: null },
      tlsEnforced: true,
      tlsTunnelManager: initialTunnelManager as any,
      tlsTunnelSessionId: 'initial-session',
      tlsTunnelNeedsReset: false
    } as any

    context = {
      clientId,
      xmlMessage: '<test/>',
      httpHandler: new HttpHandler()
    }
  })

  afterEach(() => {
    Environment.Config.delay_tls_timer = originalDelayTlsTimer
    delete devices[clientId]
  })

  it('should retry once on CONNECTION_RESET_ERROR and succeed', async () => {
    // First call: initial tunnel's send triggers CONNECTION_RESET_ERROR
    const initialTunnel = devices[clientId].tlsTunnelManager!
    ;(initialTunnel.send as jest.Mock).mockImplementation(async () => {
      queueMicrotask(() => {
        devices[clientId].reject(new CONNECTION_RESET_ERROR())
      })
    })

    // Retry call: mocked TLSTunnelManager's send triggers success
    mockSend = jest.fn<any>().mockImplementation(async () => {
      queueMicrotask(() => {
        devices[clientId].resolve({ retried: true })
      })
    })

    const result = await invokeWsmanCall(context)
    expect(result).toEqual({ retried: true })
    expect(devices[clientId].amtReconfiguring).toBe(false)
  })

  it('should throw CONNECTION_RESET_ERROR on second consecutive reset', async () => {
    // Both calls trigger CONNECTION_RESET_ERROR
    const initialTunnel = devices[clientId].tlsTunnelManager!
    ;(initialTunnel.send as jest.Mock).mockImplementation(async () => {
      queueMicrotask(() => {
        devices[clientId].reject(new CONNECTION_RESET_ERROR())
      })
    })

    mockSend = jest.fn<any>().mockImplementation(async () => {
      queueMicrotask(() => {
        devices[clientId].reject(new CONNECTION_RESET_ERROR())
      })
    })

    await expect(invokeWsmanCall(context)).rejects.toBeInstanceOf(CONNECTION_RESET_ERROR)
  })

  it('should clean up TLS tunnel before retrying on CONNECTION_RESET_ERROR', async () => {
    const initialTunnel = devices[clientId].tlsTunnelManager!
    const initialCloseSpy = initialTunnel.close as jest.Mock
    ;(initialTunnel.send as jest.Mock).mockImplementation(async () => {
      queueMicrotask(() => {
        devices[clientId].reject(new CONNECTION_RESET_ERROR())
      })
    })

    // Retry succeeds
    mockSend = jest.fn<any>().mockImplementation(async () => {
      queueMicrotask(() => {
        devices[clientId].resolve({ success: true })
      })
    })

    await invokeWsmanCall(context)

    // Original tunnel was closed during cleanup
    expect(initialCloseSpy).toHaveBeenCalled()
    // New tunnel was created on retry
    expect(mockConnect).toHaveBeenCalled()
  })
})
