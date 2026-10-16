/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { HTTPError } from 'got'
import ConsoleDb, { TENANT_HEADER } from './index.js'
import { config } from '../../test/helper/Config.js'
import { Environment } from '../../utils/Environment.js'

// Replaces ConsoleDb.client after construction so tests never make a real HTTP call.
function fakeClient(handler: (path: string, options: { headers: Record<string, string> }) => any): any {
  return {
    get: (path: string, options: { headers: Record<string, string> }) => ({
      json: async <T>(): Promise<T> => await handler(path, options)
    })
  }
}

function notFoundError(): HTTPError {
  const error = Object.create(HTTPError.prototype) as HTTPError
  Object.assign(error, { response: { statusCode: 404 } })
  return error
}

describe('ConsoleDb', () => {
  beforeEach(() => {
    Environment.Config = { ...config, mps_server: 'http://console:8181/' }
  })

  it('throws when mps_server is not configured', () => {
    Environment.Config = { ...config, mps_server: '' }
    expect(() => new ConsoleDb()).toThrow('console mode requires mps_server to point at Console')
  })

  it('returns the parsed body on a 200 response', async () => {
    const db = new ConsoleDb()
    db.client = fakeClient(async () => ({ name: 'profile1' }))
    const result = await db.get<{ name: string }>('api/v1/admin/profiles/profile1')
    expect(result).toEqual({ name: 'profile1' })
  })

  it('returns null on a 404 response', async () => {
    const db = new ConsoleDb()
    db.client = fakeClient(() => {
      throw notFoundError()
    })
    const result = await db.get('api/v1/admin/profiles/missing')
    expect(result).toBeNull()
  })

  it('rethrows non-404 errors', async () => {
    const db = new ConsoleDb()
    db.client = fakeClient(() => {
      throw new Error('console is unreachable')
    })
    await expect(db.get('api/v1/admin/profiles/profile1')).rejects.toThrow('console is unreachable')
  })

  it('only sends the tenant header when a tenant is given', async () => {
    const db = new ConsoleDb()
    let seenHeaders: Record<string, string> = {}
    db.client = fakeClient(async (_path, options) => {
      seenHeaders = options.headers
      return null
    })
    await db.get('api/v1/admin/profiles/profile1')
    expect(seenHeaders[TENANT_HEADER]).toBeUndefined()
    await db.get('api/v1/admin/profiles/profile1', 'tenant1')
    expect(seenHeaders[TENANT_HEADER]).toEqual('tenant1')
  })

  describe('ConsoleTable', () => {
    it('reads profiles and throws on writes', async () => {
      const db = new ConsoleDb()
      db.client = fakeClient(async () => [{ profileName: 'profile1' }])
      const profiles = await db.profiles.get()
      expect(profiles).toEqual([{ profileName: 'profile1' }])

      await expect(db.profiles.insert({} as any)).rejects.toThrow('cannot be changed')
      await expect(db.profiles.update({} as any)).rejects.toThrow('cannot be changed')
      await expect(db.profiles.delete('profile1')).rejects.toThrow('cannot be changed')
    })
  })

  describe('DomainsTable.getDomainByDomainSuffix', () => {
    it('finds a match on the first page', async () => {
      const db = new ConsoleDb()
      db.client = fakeClient(async () => [{ domainSuffix: 'example.com' }])
      const domain = await db.domains.getDomainByDomainSuffix('example.com')
      expect(domain).toEqual({ domainSuffix: 'example.com' })
    })

    it('returns null when no page contains a match', async () => {
      const db = new ConsoleDb()
      db.client = fakeClient(async () => [{ domainSuffix: 'other.com' }])
      const domain = await db.domains.getDomainByDomainSuffix('example.com')
      expect(domain).toBeNull()
    })

    it('scans a second page when the first page is full', async () => {
      const db = new ConsoleDb()
      const firstPage = Array.from({ length: 500 }, (_, i) => ({ domainSuffix: `d${i}.com` }))
      let calls = 0
      db.client = fakeClient(async () => {
        calls += 1
        return calls === 1 ? firstPage : [{ domainSuffix: 'example.com' }]
      })
      const domain = await db.domains.getDomainByDomainSuffix('example.com')
      expect(domain).toEqual({ domainSuffix: 'example.com' })
      expect(calls).toEqual(2)
    })
  })
})
