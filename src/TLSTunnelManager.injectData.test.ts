/*********************************************************************
 * Copyright (c) Intel Corporation 2026
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { TLSTunnelManager } from './TLSTunnelManager.js'

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
})
