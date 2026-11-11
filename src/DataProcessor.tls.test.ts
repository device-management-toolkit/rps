/*********************************************************************
 * Copyright (c) Intel Corporation 2024
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { randomUUID } from 'node:crypto'
import { devices } from './devices.js'
import { DataProcessor } from './DataProcessor.js'
import { type ClientMsg } from './models/RCS.Config.js'
import { CONNECTION_RESET_ERROR } from './utils/constants.js'

import { vi } from 'vitest'
describe('DataProcessor TLS methods', () => {
  const clientId = randomUUID()
  let dataProcessor: DataProcessor

  beforeEach(() => {
    dataProcessor = new DataProcessor(
      {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        verbose: vi.fn(),
        silly: vi.fn()
      } as any,
      {} as any
    )
  })

  afterEach(() => {
    delete devices[clientId]
  })

  describe('handleTLSData', () => {
    it('should return early when tunnel needs reset', async () => {
      const injectDataSpy = vi.fn()
      devices[clientId] = {
        tlsTunnelNeedsReset: true,
        tlsTunnelManager: { injectData: injectDataSpy } as any
      } as any

      const clientMsg: ClientMsg = {
        method: 'tls_data',
        payload: 'dGVzdA==',
        apiKey: '',
        appVersion: '',
        protocolVersion: '',
        status: '',
        message: '',
        tenantId: ''
      }
      await dataProcessor.handleTLSData(clientMsg, clientId)
      expect(injectDataSpy).not.toHaveBeenCalled()
    })

    it('should inject base64-decoded data into tunnel manager', async () => {
      const injectDataSpy = vi.fn()
      devices[clientId] = {
        tlsTunnelNeedsReset: false,
        tlsTunnelManager: { injectData: injectDataSpy } as any
      } as any

      const testData = Buffer.from('hello TLS data')
      const clientMsg: ClientMsg = {
        method: 'tls_data',
        payload: testData.toString('base64'),
        apiKey: '',
        appVersion: '',
        protocolVersion: '',
        status: '',
        message: '',
        tenantId: ''
      }
      await dataProcessor.handleTLSData(clientMsg, clientId)
      expect(injectDataSpy).toHaveBeenCalledTimes(1)
      expect(Buffer.compare(injectDataSpy.mock.calls[0][0] as Buffer, testData)).toBe(0)
    })

    it('should do nothing when no tunnel manager exists', async () => {
      devices[clientId] = {
        tlsTunnelNeedsReset: false,
        tlsTunnelManager: undefined
      } as any

      const clientMsg: ClientMsg = {
        method: 'tls_data',
        payload: 'dGVzdA==',
        apiKey: '',
        appVersion: '',
        protocolVersion: '',
        status: '',
        message: '',
        tenantId: ''
      }
      await dataProcessor.handleTLSData(clientMsg, clientId)
      // Should not throw
    })

    it('should do nothing when payload is null', async () => {
      const injectDataSpy = vi.fn()
      devices[clientId] = {
        tlsTunnelNeedsReset: false,
        tlsTunnelManager: { injectData: injectDataSpy } as any
      } as any

      const clientMsg: ClientMsg = {
        method: 'tls_data',
        payload: null as any,
        apiKey: '',
        appVersion: '',
        protocolVersion: '',
        status: '',
        message: '',
        tenantId: ''
      }
      await dataProcessor.handleTLSData(clientMsg, clientId)
      expect(injectDataSpy).not.toHaveBeenCalled()
    })
  })

  describe('handleConnectionReset', () => {
    const streamMessage = (overrides: Partial<ClientMsg> = {}): ClientMsg => ({
      method: 'connection_reset',
      payload: '',
      apiKey: '',
      appVersion: '',
      status: '',
      message: '',
      tenantId: '',
      tlsSessionId: 'current-session',
      streamClosed: true,
      ...overrides
    })

    it.each(['tls_data', 'connection_reset'])('ignores obsolete session %s events', async (method) => {
      const manager = { injectData: vi.fn(), close: vi.fn(), endInput: vi.fn() }
      const reject = vi.fn()
      devices[clientId] = {
        tlsTunnelManager: manager,
        tlsTunnelSessionId: 'current-session',
        reject,
        pendingPromise: Promise.resolve()
      } as any
      const msg = streamMessage({ method, tlsSessionId: 'old-session', payload: 'dGVzdA==' })
      if (method === 'tls_data') await dataProcessor.handleTLSData(msg, clientId)
      else await dataProcessor.handleConnectionReset(msg, clientId)
      expect(manager.injectData).not.toHaveBeenCalled()
      expect(manager.endInput).not.toHaveBeenCalled()
      expect(manager.close).not.toHaveBeenCalled()
      expect(reject).not.toHaveBeenCalled()
      expect(devices[clientId].tlsTunnelManager).toBe(manager)
    })

    it.each([true, false])('decides EOF after TLS input drains, complete response=%s', async (complete) => {
      let finish: () => void = () => {}
      const manager = {
        close: vi.fn(),
        endInput: vi.fn((callback: () => void) => {
          finish = callback
        })
      }
      const reject = vi.fn()
      devices[clientId] = {
        tlsTunnelManager: manager,
        tlsTunnelSessionId: 'current-session',
        pendingPromise: Promise.resolve(),
        tlsResponseBuffer: Buffer.from('partial'),
        reject
      } as any
      await dataProcessor.handleConnectionReset(streamMessage(), clientId)
      expect(reject).not.toHaveBeenCalled()
      expect(manager.close).not.toHaveBeenCalled()
      if (complete) devices[clientId].pendingPromise = undefined
      finish()
      expect(manager.close).toHaveBeenCalledTimes(1)
      expect(devices[clientId].tlsTunnelNeedsReset).toBe(true)
      expect(devices[clientId].amtReconfiguring).toBe(!complete)
      expect(devices[clientId].tlsResponseBuffer).toBeUndefined()
      if (complete) expect(reject).not.toHaveBeenCalled()
      else expect(reject).toHaveBeenCalledWith(expect.any(CONNECTION_RESET_ERROR))
    })

    it('does not close a replacement tunnel when an old EOF finishes draining', async () => {
      let finish: () => void = () => {}
      const old = {
        close: vi.fn(),
        endInput: vi.fn((callback: () => void) => {
          finish = callback
        })
      }
      devices[clientId] = {
        tlsTunnelManager: old,
        tlsTunnelSessionId: 'current-session',
        pendingPromise: Promise.resolve(),
        reject: vi.fn()
      } as any
      await dataProcessor.handleConnectionReset(streamMessage(), clientId)
      const replacement = { close: vi.fn() }
      devices[clientId].tlsTunnelManager = replacement as any
      devices[clientId].tlsTunnelSessionId = 'replacement-session'
      finish()
      expect(old.close).not.toHaveBeenCalled()
      expect(replacement.close).not.toHaveBeenCalled()
      expect(devices[clientId].tlsTunnelSessionId).toBe('replacement-session')
      expect(devices[clientId].reject).not.toHaveBeenCalled()
    })

    it('should close tunnel manager and set reset flags', async () => {
      const closeSpy = vi.fn()
      devices[clientId] = {
        tlsTunnelManager: { close: closeSpy } as any,
        tlsTunnelSessionId: 'session-123',
        tlsResponseBuffer: Buffer.from('stale'),
        pendingPromise: null,
        reject: null
      } as any

      const clientMsg: ClientMsg = {
        method: 'connection_reset',
        payload: '',
        apiKey: '',
        appVersion: '',
        protocolVersion: '',
        status: '',
        message: '',
        tenantId: ''
      }
      await dataProcessor.handleConnectionReset(clientMsg, clientId)

      expect(closeSpy).toHaveBeenCalled()
      expect(devices[clientId].tlsTunnelManager).toBeUndefined()
      expect(devices[clientId].tlsTunnelSessionId).toBeUndefined()
      expect(devices[clientId].tlsResponseBuffer).toBeUndefined()
      expect(devices[clientId].tlsTunnelNeedsReset).toBe(true)
      expect(devices[clientId].amtReconfiguring).toBe(true)
    })

    it('should reject pending promise with CONNECTION_RESET_ERROR', async () => {
      const rejectSpy = vi.fn()
      devices[clientId] = {
        tlsTunnelManager: undefined,
        pendingPromise: Promise.resolve(),
        reject: rejectSpy
      } as any

      const clientMsg: ClientMsg = {
        method: 'connection_reset',
        payload: '',
        apiKey: '',
        appVersion: '',
        protocolVersion: '',
        status: '',
        message: '',
        tenantId: ''
      }
      await dataProcessor.handleConnectionReset(clientMsg, clientId)

      expect(rejectSpy).toHaveBeenCalledTimes(1)
      expect(rejectSpy.mock.calls[0][0]).toBeInstanceOf(CONNECTION_RESET_ERROR)
    })

    it('should return early when client object does not exist', async () => {
      // clientId not in devices
      const clientMsg: ClientMsg = {
        method: 'connection_reset',
        payload: '',
        apiKey: '',
        appVersion: '',
        protocolVersion: '',
        status: '',
        message: '',
        tenantId: ''
      }
      await dataProcessor.handleConnectionReset(clientMsg, clientId)
      // Should not throw
    })

    it('should handle missing tunnel manager gracefully', async () => {
      devices[clientId] = {
        tlsTunnelManager: undefined,
        pendingPromise: null,
        reject: null
      } as any

      const clientMsg: ClientMsg = {
        method: 'connection_reset',
        payload: '',
        apiKey: '',
        appVersion: '',
        protocolVersion: '',
        status: '',
        message: '',
        tenantId: ''
      }
      await dataProcessor.handleConnectionReset(clientMsg, clientId)

      expect(devices[clientId].tlsTunnelNeedsReset).toBe(true)
      expect(devices[clientId].amtReconfiguring).toBe(true)
    })
  })
})
