/*********************************************************************
 * Copyright (c) Intel Corporation 2024
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { randomUUID } from 'node:crypto'
import { devices } from '../devices.js'
import { HttpHandler } from '../HttpHandler.js'
import { Environment } from '../utils/Environment.js'
import { config } from '../test/helper/Config.js'

import { vi, type Mock } from 'vitest'
import { GATEWAY_TIMEOUT_ERROR, UNEXPECTED_PARSE_ERROR } from '../utils/constants.js'
import { processTLSTunnelResponse, invokeWsmanCall } from './common.js'

Environment.Config = config

describe('processTLSTunnelResponse', () => {
  const clientId = randomUUID()
  let httpHandler: HttpHandler
  let resolveSpy: Mock
  let rejectSpy: Mock

  beforeEach(() => {
    httpHandler = new HttpHandler()
    resolveSpy = vi.fn()
    rejectSpy = vi.fn()
    devices[clientId] = {
      ClientSocket: { send: vi.fn() } as any,
      pendingPromise: Promise.resolve(),
      resolve: resolveSpy,
      reject: rejectSpy,
      connectionParams: { guid: clientId, port: 16992 }
    } as any
  })

  afterEach(() => {
    delete devices[clientId]
  })

  it('should return early when client object does not exist', () => {
    const unknownId = randomUUID()
    processTLSTunnelResponse(unknownId, Buffer.from('test'), httpHandler)
    expect(resolveSpy).not.toHaveBeenCalled()
    expect(rejectSpy).not.toHaveBeenCalled()
  })

  it('should return early when no pending promise', () => {
    devices[clientId].pendingPromise = undefined as any
    processTLSTunnelResponse(clientId, Buffer.from('test'), httpHandler)
    expect(resolveSpy).not.toHaveBeenCalled()
    expect(rejectSpy).not.toHaveBeenCalled()
  })

  it('should buffer data when response is incomplete (Content-Length not met)', () => {
    // Content-Length says 999 but body is much shorter — response is incomplete
    // Use a value not ending in 0 to avoid false chunked detection of "0\r\n\r\n"
    const partialData = Buffer.from('HTTP/1.1 200 OK\r\nContent-Length: 999\r\n\r\npartial body')
    processTLSTunnelResponse(clientId, partialData, httpHandler)
    expect(resolveSpy).not.toHaveBeenCalled()
    expect(rejectSpy).not.toHaveBeenCalled()
    expect(devices[clientId].tlsResponseBuffer).toBeDefined()
    expect(devices[clientId].tlsResponseBuffer!.length).toBe(partialData.length)
  })

  it('should accumulate multiple chunks before complete response', () => {
    const chunk1 = Buffer.from('HTTP/1.1 200 OK\r\nContent-Length: 999\r\n\r\n')
    const chunk2 = Buffer.from('partial data here')
    processTLSTunnelResponse(clientId, chunk1, httpHandler)
    processTLSTunnelResponse(clientId, chunk2, httpHandler)
    expect(resolveSpy).not.toHaveBeenCalled()
    expect(rejectSpy).not.toHaveBeenCalled()
    expect(devices[clientId].tlsResponseBuffer!.length).toBe(chunk1.length + chunk2.length)
  })

  it('should resolve on complete Content-Length response with valid XML', () => {
    const xmlBody =
      '<?xml version="1.0" encoding="UTF-8"?><a:Envelope xmlns:a="http://www.w3.org/2003/05/soap-envelope"><a:Header><a:Action>http://schemas.xmlsoap.org/ws/2004/09/transfer/GetResponse</a:Action></a:Header><a:Body><AMT_GeneralSettings><DigestRealm>Digest:realm</DigestRealm></AMT_GeneralSettings></a:Body></a:Envelope>'
    const httpResponse = `HTTP/1.1 200 OK\r\nContent-Type: application/soap+xml; charset=UTF-8\r\nContent-Length: ${xmlBody.length}\r\n\r\n${xmlBody}`
    const parseXMLSpy = vi.spyOn(httpHandler, 'parseXML').mockReturnValue({ parsed: true } as any)

    processTLSTunnelResponse(clientId, Buffer.from(httpResponse), httpHandler)
    expect(parseXMLSpy).toHaveBeenCalled()
    expect(resolveSpy).toHaveBeenCalledWith({ parsed: true })
    expect(devices[clientId].tlsResponseBuffer).toBeUndefined()
  })

  it('should resolve on complete chunked response', () => {
    const xmlBody =
      '<?xml version="1.0" encoding="UTF-8"?><a:Envelope xmlns:a="http://www.w3.org/2003/05/soap-envelope"><a:Header><a:Action>http://schemas.xmlsoap.org/ws/2004/09/transfer/GetResponse</a:Action></a:Header><a:Body><Test>data</Test></a:Body></a:Envelope>'
    const chunkSize = Buffer.byteLength(xmlBody)
    const chunkedBody = `${chunkSize.toString(16)}\r\n${xmlBody}\r\n0\r\n\r\n`
    const httpResponse = `HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n${chunkedBody}`
    const parseXMLSpy = vi.spyOn(httpHandler, 'parseXML').mockReturnValue({ parsed: true } as any)

    processTLSTunnelResponse(clientId, Buffer.from(httpResponse), httpHandler)
    expect(parseXMLSpy).toHaveBeenCalled()
    expect(resolveSpy).toHaveBeenCalled()
  })

  it('should reject on non-200 status code', () => {
    const httpResponse =
      'HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nWww-Authenticate: Digest realm="Digest:realm"\r\n\r\n'
    processTLSTunnelResponse(clientId, Buffer.from(httpResponse), httpHandler)
    expect(rejectSpy).toHaveBeenCalled()
    const rejectedValue = rejectSpy.mock.calls[0][0] as any
    expect(rejectedValue.statusCode).toBe(401)
  })

  it('should reject with UNEXPECTED_PARSE_ERROR when XML parse returns null', () => {
    const xmlBody = 'not valid xml at all'
    const httpResponse = `HTTP/1.1 200 OK\r\nContent-Length: ${xmlBody.length}\r\n\r\n${xmlBody}`
    vi.spyOn(httpHandler, 'parseXML').mockReturnValue(null as any)

    processTLSTunnelResponse(clientId, Buffer.from(httpResponse), httpHandler)
    expect(rejectSpy).toHaveBeenCalled()
    expect(rejectSpy.mock.calls[0][0]).toBeInstanceOf(UNEXPECTED_PARSE_ERROR)
  })

  it('should reject with UNEXPECTED_PARSE_ERROR on malformed HTTP response', () => {
    const malformedResponse = 'this is not an HTTP response\r\nContent-Length: 0\r\n\r\n'
    processTLSTunnelResponse(clientId, Buffer.from(malformedResponse), httpHandler)
    expect(rejectSpy).toHaveBeenCalled()
    expect(rejectSpy.mock.calls[0][0]).toBeInstanceOf(UNEXPECTED_PARSE_ERROR)
  })
})

describe('invokeWsmanCall TLS error cleanup', () => {
  const clientId = randomUUID()
  let context: any

  beforeEach(() => {
    vi.useFakeTimers()
    const mockTunnelManager = {
      close: vi.fn(),
      connect: vi.fn(),
      send: vi.fn(),
      onData: vi.fn(),
      getSessionId: () => 'test-session'
    }
    devices[clientId] = {
      ClientSocket: { send: vi.fn() } as any,
      connectionParams: { guid: clientId, port: 16992, digestChallenge: null },
      tlsEnforced: true,
      tlsTunnelManager: mockTunnelManager as any,
      tlsTunnelSessionId: 'test-session',
      tlsTunnelNeedsReset: false
    } as any
    context = {
      clientId,
      xmlMessage: '<test/>',
      httpHandler: new HttpHandler()
    }
  })

  afterEach(() => {
    vi.runAllTicks()
    vi.useRealTimers()
    delete devices[clientId]
  })

  it('should clean up TLS tunnel on timeout for TLS-enforced device', async () => {
    const tunnelManager = devices[clientId].tlsTunnelManager!
    const closeSpy = vi.spyOn(tunnelManager, 'close')

    // The invokeWsmanCall will timeout because nothing resolves the pending promise
    const promise = invokeWsmanCall(context)
    vi.advanceTimersByTime(Environment.Config.delay_timer * 1000 + 100)
    try {
      await promise
    } catch (err) {
      expect(err).toBeInstanceOf(GATEWAY_TIMEOUT_ERROR)
    }

    expect(closeSpy).toHaveBeenCalled()
    expect(devices[clientId].tlsTunnelManager).toBeUndefined()
    expect(devices[clientId].tlsTunnelSessionId).toBeUndefined()
    expect(devices[clientId].tlsTunnelNeedsReset).toBe(true)
    expect(devices[clientId].tlsResponseBuffer).toBeUndefined()
    expect(devices[clientId].amtReconfiguring).toBe(true)
  })

  it('should NOT clean up TLS tunnel on timeout for non-TLS device', async () => {
    devices[clientId].tlsEnforced = false
    const tunnelManager = devices[clientId].tlsTunnelManager!
    const closeSpy = vi.spyOn(tunnelManager, 'close')

    const promise = invokeWsmanCall(context)
    vi.advanceTimersByTime(Environment.Config.delay_timer * 1000 + 100)
    try {
      await promise
    } catch (err) {
      expect(err).toBeInstanceOf(GATEWAY_TIMEOUT_ERROR)
    }

    expect(closeSpy).not.toHaveBeenCalled()
    expect(devices[clientId].tlsTunnelManager).toBeDefined()
  })
})
