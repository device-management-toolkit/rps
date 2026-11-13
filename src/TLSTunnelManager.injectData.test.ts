/*********************************************************************
 * Copyright (c) Intel Corporation 2026
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { TLSTunnelManager } from './TLSTunnelManager.js'
import { EventEmitter } from 'node:events'

// rpc-go streams tunnel bytes as they arrive, so a TLS 1.3 server handshake reaches RPS as a
// ServerHello record (0x16) followed by separate encrypted records (0x17) before the session
// is connected. Only application data that precedes any handshake record is stale.
const record = (contentType: number, body = 'xxxxx'): Buffer =>
  Buffer.concat([
    Buffer.from([
      contentType,
      0x03,
      0x03,
      0x00,
      body.length
    ]),
    Buffer.from(body)
  ])

function manager(): any {
  return new TLSTunnelManager({ send: vi.fn() } as any, 'inject-test', false, true, undefined, {})
}

describe('TLSTunnelManager.injectData before the handshake completes', () => {
  it('tags outgoing bytes with their tunnel session', () => {
    const m = manager()
    m.writeBuffer = [Buffer.from('outgoing')]
    m.flushWriteBuffer()
    const message = JSON.parse(m.clientSocket.send.mock.calls[0][0])
    expect(message.tlsSessionId).toBe(m.getSessionId())
  })

  it('notifies input completion after decrypted data and only once', () => {
    const m = manager()
    const socket = new EventEmitter()
    m.tlsSocket = socket
    const events: string[] = []
    m.onData(() => events.push('data'))
    const push = vi.spyOn(m.duplexStream, 'push').mockReturnValue(true)
    m.endInput(() => events.push('end'))
    expect(push).toHaveBeenCalledWith(null)
    expect(events).toEqual([])
    socket.emit('data', Buffer.from('final bytes'))
    socket.emit('end')
    socket.emit('close')
    expect(events).toEqual(['data', 'end'])
    m.writeBuffer = [Buffer.from('late output')]
    m.flushWriteBuffer()
    expect(m.clientSocket.send).not.toHaveBeenCalled()
  })
  it('drops application data that arrives before any handshake record', () => {
    const m = manager()
    m.injectData(record(0x17))
    expect(m.pendingData).toHaveLength(0)
  })

  it('keeps encrypted records that follow the ServerHello (TLS 1.3 streamed handshake)', () => {
    const m = manager()
    m.injectData(record(0x16, 'hello'))
    m.injectData(record(0x17, 'encrypted-ext'))
    m.injectData(record(0x17, 'finished'))
    expect(m.pendingData).toHaveLength(3)
  })

  it.each([
    1,
    2,
    3,
    4,
    5
  ])('keeps every byte when the initial handshake header is split at byte %i', (split) => {
    const m = manager()
    const hello = record(0x16, 'hello')
    const encrypted = record(0x17, 'finished')
    m.injectData(hello.subarray(0, split))
    m.injectData(hello.subarray(split))
    m.injectData(encrypted)
    expect(Buffer.concat(m.pendingData)).toEqual(Buffer.concat([hello, encrypted]))
  })

  it('drops a complete stale record before accepting a fragmented handshake', () => {
    const m = manager()
    const hello = record(0x16, 'hello')
    const encrypted = record(0x17, 'finished')
    m.injectData(record(0x17, 'stale'))
    m.injectData(hello.subarray(0, 1))
    m.injectData(hello.subarray(1))
    m.injectData(encrypted)
    expect(Buffer.concat(m.pendingData)).toEqual(Buffer.concat([hello, encrypted]))
  })

  it('keeps a chunk that begins in the middle of a record once the handshake has started', () => {
    const m = manager()
    m.injectData(record(0x16, 'hello'))
    m.injectData(
      Buffer.from([
        0x17,
        0x9a,
        0xbc,
        0xde,
        0xf0,
        0x12
      ])
    )
    expect(m.pendingData).toHaveLength(2)
  })

  it.each([
    1,
    2,
    3,
    4,
    5,
    6,
    8
  ])('discards the entire stale record split at byte %i', (split) => {
    const m = manager()
    const stale = record(0x17, '\x16stale-data')
    const hello = record(0x16, 'hello')
    const encrypted = record(0x17, 'finished')
    m.injectData(stale.subarray(0, split))
    m.injectData(
      Buffer.concat([
        stale.subarray(split),
        hello,
        encrypted
      ])
    )
    expect(Buffer.concat(m.pendingData)).toEqual(Buffer.concat([hello, encrypted]))
  })

  it('discards multiple stale records and preserves the coalesced server handshake', () => {
    const m = manager()
    const hello = record(0x16, 'hello')
    const encrypted = record(0x17, 'finished')
    m.injectData(
      Buffer.concat([
        record(0x17, 'stale'),
        record(0x17, 'older'),
        hello,
        encrypted
      ])
    )
    expect(Buffer.concat(m.pendingData)).toEqual(Buffer.concat([hello, encrypted]))
  })

  it('preserves a fragmented TLS alert before any server handshake', () => {
    const m = manager()
    const alert = record(0x15, 'alert')
    m.injectData(alert.subarray(0, 1))
    m.injectData(alert.subarray(1))
    expect(Buffer.concat(m.pendingData)).toEqual(alert)
  })

  it('streams only current handshake bytes when stale records arrive after connect starts', () => {
    const m = manager()
    m.handshakeStarted = true
    const push = vi.spyOn(m.duplexStream, 'push').mockReturnValue(true)
    const stale = record(0x17, '\x16stale-data')
    const hello = record(0x16, 'hello')
    const encrypted = record(0x17, 'finished')
    m.injectData(stale.subarray(0, 5))
    m.injectData(Buffer.concat([stale.subarray(5), hello.subarray(0, 1)]))
    expect(push).not.toHaveBeenCalled()
    m.injectData(Buffer.concat([hello.subarray(1), encrypted.subarray(0, 2)]))
    m.injectData(encrypted.subarray(2))
    expect(Buffer.concat(push.mock.calls.map(([chunk]) => chunk as Buffer))).toEqual(Buffer.concat([hello, encrypted]))
    expect(m.pendingData).toHaveLength(0)
  })
})
