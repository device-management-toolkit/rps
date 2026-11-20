/*********************************************************************
 * Copyright (c) Intel Corporation 2026
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/
import { EventEmitter } from 'node:events'
import Db from './index.js'

describe('Provisioning advisory locks', () => {
  it('serializes the same UUID across sessions and releases on session close', async () => {
    const held = new Set<string>()
    const sessions: any[] = []
    const provisioningClient = vi.fn(() => {
      const session = new EventEmitter() as any
      let heldKey: string | undefined
      session.query = vi.fn(async (sql, [key]) => {
        expect(sql).toBe('SELECT pg_try_advisory_lock($1::bigint) AS acquired')
        if (held.has(key)) return { rows: [{ acquired: false }] }
        held.add(key)
        heldKey = key
        return { rows: [{ acquired: true }] }
      })
      session.connect = vi.fn(async () => {})
      session.end = vi.fn(async () => {
        if (heldKey) held.delete(heldKey)
      })
      sessions.push(session)
      return session
    })
    const first = Object.assign(Object.create(Db.prototype), { provisioningClient }) as Db
    const second = Object.assign(Object.create(Db.prototype), { provisioningClient }) as Db
    const lost = vi.fn()
    const release = await first.acquireProvisioningLock('DEVICE', lost)
    expect(release).not.toBeNull()
    expect(await second.acquireProvisioningLock('device', vi.fn())).toBeNull()
    const other = await second.acquireProvisioningLock('other', vi.fn())
    expect(other).not.toBeNull()
    sessions[0].emit('error', new Error('connection lost'))
    expect(lost).toHaveBeenCalledOnce()
    expect(sessions[0].end).toHaveBeenCalledOnce()
    const recovered = await second.acquireProvisioningLock('device', vi.fn())
    expect(recovered).not.toBeNull()
    release!()
    expect(sessions[0].end).toHaveBeenCalledOnce()
    recovered!()
    other!()
    expect(held.size).toBe(0)
  })

  it('destroys its session when acquisition fails', async () => {
    const session = new EventEmitter() as any
    session.query = vi.fn().mockRejectedValue(new Error('database unavailable'))
    session.connect = vi.fn(async () => {})
    session.end = vi.fn(async () => {})
    const db = Object.assign(Object.create(Db.prototype), { provisioningClient: () => session }) as Db
    await expect(db.acquireProvisioningLock('device', vi.fn())).rejects.toThrow('database unavailable')
    expect(session.end).toHaveBeenCalledOnce()
  })
})
