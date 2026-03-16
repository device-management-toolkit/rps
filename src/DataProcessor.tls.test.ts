/*********************************************************************
 * Copyright (c) Intel Corporation 2024
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { randomUUID } from 'node:crypto'
import { devices } from './devices.js'
import { DataProcessor } from './DataProcessor.js'
import { type ClientMsg } from './models/RCS.Config.js'
import { CONNECTION_RESET_ERROR } from './utils/constants.js'
import { jest } from '@jest/globals'
import { spyOn } from 'jest-mock'

describe('DataProcessor TLS methods', () => {
  const clientId = randomUUID()
  let dataProcessor: DataProcessor

  beforeEach(() => {
    dataProcessor = new DataProcessor(
      { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), verbose: jest.fn(), silly: jest.fn() } as any,
      {} as any
    )
  })

  afterEach(() => {
    delete devices[clientId]
  })

  describe('handleTLSData', () => {
    it('should return early when tunnel needs reset', async () => {
      const injectDataSpy = jest.fn()
      devices[clientId] = {
        tlsTunnelNeedsReset: true,
        tlsTunnelManager: { injectData: injectDataSpy } as any
      } as any

      const clientMsg: ClientMsg = { method: 'tls_data', payload: 'dGVzdA==', apiKey: '', appVersion: '', protocolVersion: '', status: '', message: '', tenantId: '' }
      await dataProcessor.handleTLSData(clientMsg, clientId)
      expect(injectDataSpy).not.toHaveBeenCalled()
    })

    it('should inject base64-decoded data into tunnel manager', async () => {
      const injectDataSpy = jest.fn()
      devices[clientId] = {
        tlsTunnelNeedsReset: false,
        tlsTunnelManager: { injectData: injectDataSpy } as any
      } as any

      const testData = Buffer.from('hello TLS data')
      const clientMsg: ClientMsg = { method: 'tls_data', payload: testData.toString('base64'), apiKey: '', appVersion: '', protocolVersion: '', status: '', message: '', tenantId: '' }
      await dataProcessor.handleTLSData(clientMsg, clientId)
      expect(injectDataSpy).toHaveBeenCalledTimes(1)
      expect(Buffer.compare(injectDataSpy.mock.calls[0][0] as Buffer, testData)).toBe(0)
    })

    it('should do nothing when no tunnel manager exists', async () => {
      devices[clientId] = {
        tlsTunnelNeedsReset: false,
        tlsTunnelManager: undefined
      } as any

      const clientMsg: ClientMsg = { method: 'tls_data', payload: 'dGVzdA==', apiKey: '', appVersion: '', protocolVersion: '', status: '', message: '', tenantId: '' }
      await dataProcessor.handleTLSData(clientMsg, clientId)
      // Should not throw
    })

    it('should do nothing when payload is null', async () => {
      const injectDataSpy = jest.fn()
      devices[clientId] = {
        tlsTunnelNeedsReset: false,
        tlsTunnelManager: { injectData: injectDataSpy } as any
      } as any

      const clientMsg: ClientMsg = { method: 'tls_data', payload: null as any, apiKey: '', appVersion: '', protocolVersion: '', status: '', message: '', tenantId: '' }
      await dataProcessor.handleTLSData(clientMsg, clientId)
      expect(injectDataSpy).not.toHaveBeenCalled()
    })
  })

  describe('handleConnectionReset', () => {
    it('should close tunnel manager and set reset flags', async () => {
      const closeSpy = jest.fn()
      devices[clientId] = {
        tlsTunnelManager: { close: closeSpy } as any,
        tlsTunnelSessionId: 'session-123',
        tlsResponseBuffer: Buffer.from('stale'),
        pendingPromise: null,
        reject: null
      } as any

      const clientMsg: ClientMsg = { method: 'connection_reset', payload: '', apiKey: '', appVersion: '', protocolVersion: '', status: '', message: '', tenantId: '' }
      await dataProcessor.handleConnectionReset(clientMsg, clientId)

      expect(closeSpy).toHaveBeenCalled()
      expect(devices[clientId].tlsTunnelManager).toBeUndefined()
      expect(devices[clientId].tlsTunnelSessionId).toBeUndefined()
      expect(devices[clientId].tlsResponseBuffer).toBeUndefined()
      expect(devices[clientId].tlsTunnelNeedsReset).toBe(true)
      expect(devices[clientId].amtReconfiguring).toBe(true)
    })

    it('should reject pending promise with CONNECTION_RESET_ERROR', async () => {
      const rejectSpy = jest.fn()
      devices[clientId] = {
        tlsTunnelManager: undefined,
        pendingPromise: Promise.resolve(),
        reject: rejectSpy
      } as any

      const clientMsg: ClientMsg = { method: 'connection_reset', payload: '', apiKey: '', appVersion: '', protocolVersion: '', status: '', message: '', tenantId: '' }
      await dataProcessor.handleConnectionReset(clientMsg, clientId)

      expect(rejectSpy).toHaveBeenCalledTimes(1)
      expect(rejectSpy.mock.calls[0][0]).toBeInstanceOf(CONNECTION_RESET_ERROR)
    })

    it('should return early when client object does not exist', async () => {
      // clientId not in devices
      const clientMsg: ClientMsg = { method: 'connection_reset', payload: '', apiKey: '', appVersion: '', protocolVersion: '', status: '', message: '', tenantId: '' }
      await dataProcessor.handleConnectionReset(clientMsg, clientId)
      // Should not throw
    })

    it('should handle missing tunnel manager gracefully', async () => {
      devices[clientId] = {
        tlsTunnelManager: undefined,
        pendingPromise: null,
        reject: null
      } as any

      const clientMsg: ClientMsg = { method: 'connection_reset', payload: '', apiKey: '', appVersion: '', protocolVersion: '', status: '', message: '', tenantId: '' }
      await dataProcessor.handleConnectionReset(clientMsg, clientId)

      expect(devices[clientId].tlsTunnelNeedsReset).toBe(true)
      expect(devices[clientId].amtReconfiguring).toBe(true)
    })
  })
})
