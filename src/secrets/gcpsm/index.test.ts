/*********************************************************************
 * Copyright (c) Intel Corporation 2026
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { GcpSecretManagerService, toSecretId } from './index.js'
import Logger from '../../Logger.js'
import { config } from '../../test/helper/Config.js'
import { Environment } from '../../utils/Environment.js'
import { type DeviceCredentials } from '../../interfaces/ISecretManagerService.js'

import { vi } from 'vitest'

const grpcError = (code: number): Error => Object.assign(new Error(`grpc ${code}`), { code })

// Minimal in-memory fake of the Secret Manager client: secrets hold an ordered list of versions.
// Like the real service, "latest" is the newest version in any state, so accessing it fails with
// FAILED_PRECONDITION when that version is destroyed.
class FakeClient {
  secrets = new Map<string, { versions: { name: string; data: Buffer; state: string }[] }>()
  failAdd = 0

  async createSecret({ parent, secretId }: any): Promise<any> {
    const name = `${parent}/secrets/${secretId}`
    if (this.secrets.has(name)) throw grpcError(6)
    this.secrets.set(name, { versions: [] })
    return [{ name }]
  }

  async addSecretVersion({ parent, payload }: any): Promise<any> {
    if (this.failAdd > 0) {
      this.failAdd--
      throw grpcError(14)
    }
    const secret = this.secrets.get(parent)
    if (secret == null) throw grpcError(5)
    const name = `${parent}/versions/${secret.versions.length + 1}`
    secret.versions.push({ name, data: Buffer.from(payload.data), state: 'ENABLED' })
    return [{ name }]
  }

  async accessSecretVersion({ name }: any): Promise<any> {
    const parent = name.replace(/\/versions\/[^/]+$/, '')
    const versions = this.secrets.get(parent)?.versions ?? []
    const v = name.endsWith('/versions/latest') ? versions[versions.length - 1] : versions.find((x) => x.name === name)
    if (v == null) throw grpcError(5)
    if (v.state !== 'ENABLED') throw grpcError(9)
    return [{ name: v.name, payload: { data: v.data } }]
  }

  async listSecretVersions({ parent }: any): Promise<any> {
    return [(this.secrets.get(parent)?.versions ?? []).filter((v) => v.state !== 'DESTROYED')]
  }

  async destroySecretVersion({ name }: any): Promise<any> {
    for (const s of this.secrets.values()) {
      for (const v of s.versions) if (v.name === name) v.state = 'DESTROYED'
    }
    return [{}]
  }

  async deleteSecret({ name }: any): Promise<any> {
    if (!this.secrets.delete(name)) throw grpcError(5)
    return [{}]
  }

  async getSecret({ name }: any): Promise<any> {
    if (!this.secrets.has(name)) throw grpcError(5)
    return [{ name }]
  }
}

const creds: DeviceCredentials = { AMT_PASSWORD: 'P@ssw0rd', MEBX_PASSWORD: 'Intel@123' }
const uuid = '4c4c4544-004b-4210-8033-b6c04f504633'
let fake: FakeClient
let service: GcpSecretManagerService

beforeEach(() => {
  vi.useFakeTimers()
  Environment.Config = { ...config, gcpsm_project: 'test-project' }
  fake = new FakeClient()
  service = new GcpSecretManagerService(new Logger('GcpsmTests'), fake as any)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('toSecretId', () => {
  it('maps paths to valid, readable secret IDs', () => {
    expect(toSecretId(`devices/${uuid}`)).toBe(`rps-store-devices__${uuid}`)
    expect(toSecretId('profiles/acm-r1')).toBe('rps-store-profiles__acm-r1')
  })

  it('escapes characters Secret Manager does not allow, and keeps the mapping unique', () => {
    expect(toSecretId('profiles/my_profile.v2')).toBe('rps-store-profiles__my_5fprofile_2ev2')
    expect(toSecretId('a/b')).not.toBe(toSecretId('a__b'))
    expect(toSecretId('a_/b')).not.toBe(toSecretId('a/_b'))
  })

  it('escapes non-ASCII characters as fixed-width UTF-8 bytes, so they cannot collide', () => {
    expect(toSecretId('profiles/é')).toBe('rps-store-profiles___c3_a9')
    expect(toSecretId('ሴ')).not.toBe(toSecretId('\u001234'))
    expect(toSecretId('\u{1F600}')).toBe('rps-store-_f0_9f_98_80')
  })

  it('rejects empty, oversized and malformed paths', () => {
    expect(() => toSecretId('')).toThrow()
    expect(() => toSecretId('/')).toThrow()
    expect(() => toSecretId('x'.repeat(300))).toThrow()
    expect(() => toSecretId('a\uD800')).toThrow()
  })

  it('rejects empty segments instead of dropping them, so they cannot alias another path', () => {
    expect(() => toSecretId('a//b')).toThrow()
    expect(() => toSecretId('/profiles/x')).toThrow()
    expect(() => toSecretId('profiles/x/')).toThrow()
  })

  it('uses the given prefix', () => {
    expect(toSecretId('profiles/x', 'rps-staging-')).toBe('rps-staging-profiles__x')
  })
})

describe('GcpSecretManagerService', () => {
  it('requires the project', () => {
    Environment.Config = { ...config }
    expect(() => new GcpSecretManagerService(new Logger('GcpsmTests'), fake as any)).toThrow('RPS_GCPSM_PROJECT')
  })

  it('rejects a secret prefix Secret Manager does not allow', () => {
    Environment.Config = { ...config, gcpsm_project: 'test-project', gcpsm_secret_prefix: 'rps/store' }
    expect(() => new GcpSecretManagerService(new Logger('GcpsmTests'), fake as any)).toThrow('RPS_GCPSM_SECRET_PREFIX')
  })

  it('rejects a numeric secret prefix, whose leading zeros env parsing has already dropped', () => {
    Environment.Config = { ...config, gcpsm_project: 'test-project', gcpsm_secret_prefix: 7 as any }
    expect(() => new GcpSecretManagerService(new Logger('GcpsmTests'), fake as any)).toThrow('purely numeric')
  })

  it('treats empty env values, which env parsing turns into NaN, as unset', () => {
    Environment.Config = { ...config, gcpsm_project: Number.NaN as any }
    expect(() => new GcpSecretManagerService(new Logger('GcpsmTests'), fake as any)).toThrow('RPS_GCPSM_PROJECT')
    Environment.Config = {
      ...config,
      gcpsm_project: 'test-project',
      gcpsm_location: Number.NaN as any,
      gcpsm_secret_prefix: Number.NaN as any
    }
    service = new GcpSecretManagerService(new Logger('GcpsmTests'), fake as any)
    expect(service.location).toBe('')
    expect(service.prefix).toBe('rps-store-')
  })

  it('rejects a boolean secret prefix', () => {
    Environment.Config = { ...config, gcpsm_project: 'test-project', gcpsm_secret_prefix: true as any }
    expect(() => new GcpSecretManagerService(new Logger('GcpsmTests'), fake as any)).toThrow('RPS_GCPSM_SECRET_PREFIX')
  })

  it('accepts a numeric project number', async () => {
    Environment.Config = { ...config, gcpsm_project: 123456789012 as any }
    service = new GcpSecretManagerService(new Logger('GcpsmTests'), fake as any)
    expect(service.project).toBe('123456789012')
    await service.writeSecretWithObject(`devices/${uuid}`, creds)
    expect([...fake.secrets.keys()]).toEqual([`projects/123456789012/secrets/rps-store-devices__${uuid}`])
  })

  it('stores secrets under the configured prefix', async () => {
    Environment.Config = { ...config, gcpsm_project: 'test-project', gcpsm_secret_prefix: 'rps-staging-' }
    service = new GcpSecretManagerService(new Logger('GcpsmTests'), fake as any)
    await service.writeSecretWithObject(`devices/${uuid}`, creds)
    expect([...fake.secrets.keys()]).toEqual([`projects/test-project/secrets/rps-staging-devices__${uuid}`])
    expect(await service.getSecretFromKey(`devices/${uuid}`, 'AMT_PASSWORD')).toBe('P@ssw0rd')
  })

  it('writes and returns the version', async () => {
    const result = await service.writeSecretWithObject(`devices/${uuid}`, creds)
    expect(result).toEqual({ version: 1 })
    expect(await service.getSecretAtPath(`devices/${uuid}`)).toEqual({ ...creds, version: 1 })
    expect(await service.getSecretFromKey(`devices/${uuid}`, 'AMT_PASSWORD')).toBe('P@ssw0rd')
  })

  it('creates secrets in the configured region only, labelled as managed by RPS', async () => {
    Environment.Config = { ...config, gcpsm_project: 'test-project', gcpsm_location: 'europe-west4' }
    service = new GcpSecretManagerService(new Logger('GcpsmTests'), fake as any)
    const create = vi.spyOn(fake, 'createSecret')
    await service.writeSecretWithObject(`devices/${uuid}`, creds)
    expect(create.mock.calls[0][0].secret).toEqual({
      replication: { userManaged: { replicas: [{ location: 'europe-west4' }] } },
      labels: { 'managed-by': 'rps' }
    })
  })

  it('does not store the version field of a previously read secret', async () => {
    await service.writeSecretWithObject(`devices/${uuid}`, { ...creds, version: '7' })
    const secret = fake.secrets.get(`projects/test-project/secrets/rps-store-devices__${uuid}`)
    expect(JSON.parse(secret!.versions[0].data.toString())).toEqual(creds)
  })

  it('destroys superseded versions after a write', async () => {
    await service.writeSecretWithObject(`devices/${uuid}`, creds)
    await service.writeSecretWithObject(`devices/${uuid}`, { ...creds, AMT_PASSWORD: 'n3w' })
    const versions = fake.secrets.get(`projects/test-project/secrets/rps-store-devices__${uuid}`)!.versions
    expect(versions.map((v) => v.state)).toEqual(['DESTROYED', 'ENABLED'])
    expect(await service.getSecretFromKey(`devices/${uuid}`, 'AMT_PASSWORD')).toBe('n3w')
  })

  it('keeps the newest version readable when two writes to the same path run at once', async () => {
    await Promise.all([
      service.writeSecretWithObject(`devices/${uuid}`, creds),
      service.writeSecretWithObject(`devices/${uuid}`, { ...creds, AMT_PASSWORD: 'n3w' })
    ])
    const versions = fake.secrets.get(`projects/test-project/secrets/rps-store-devices__${uuid}`)!.versions
    expect(versions.map((v) => v.state)).toEqual(['DESTROYED', 'ENABLED'])
    expect(await service.getSecretFromKey(`devices/${uuid}`, 'AMT_PASSWORD')).toBe('n3w')
  })

  it('reports success for a write whose version a concurrent write already destroyed', async () => {
    const add = fake.addSecretVersion.bind(fake)
    let first = true
    vi.spyOn(fake, 'addSecretVersion').mockImplementation(async (req: any) => {
      const rsp = await add(req)
      if (first) {
        first = false
        // The second write runs to completion, destroying version 1, before the first continues.
        expect(await service.writeSecretWithObject(`devices/${uuid}`, { ...creds, AMT_PASSWORD: 'n3w' })).toEqual({
          version: 2
        })
      }
      return rsp
    })
    expect(await service.writeSecretWithObject(`devices/${uuid}`, creds)).toEqual({ version: 1 })
    const versions = fake.secrets.get(`projects/test-project/secrets/rps-store-devices__${uuid}`)!.versions
    expect(versions.map((v) => v.state)).toEqual(['DESTROYED', 'ENABLED'])
    expect(await service.getSecretFromKey(`devices/${uuid}`, 'AMT_PASSWORD')).toBe('n3w')
  })

  it('never destroys a version newer than the one it wrote', async () => {
    await service.writeSecretWithObject(`devices/${uuid}`, creds)
    await service.writeSecretWithObject(`devices/${uuid}`, creds)
    const parent = `projects/test-project/secrets/rps-store-devices__${uuid}`
    fake.secrets.get(parent)!.versions[0].state = 'ENABLED'
    await service.destroyOlderVersions(`devices/${uuid}`, `${parent}/versions/1`)
    expect(fake.secrets.get(parent)!.versions.map((v) => v.state)).toEqual(['ENABLED', 'ENABLED'])
  })

  it('retries a failed write', async () => {
    fake.failAdd = 2
    const result = service.writeSecretWithObject(`devices/${uuid}`, creds)
    await vi.runAllTimersAsync()
    expect(await result).toEqual({ version: 1 })
  })

  it('does not retry permanent errors', async () => {
    const add = vi.spyOn(fake, 'addSecretVersion').mockRejectedValue(grpcError(7))
    const warn = vi.spyOn(service.logger, 'warn')
    expect(await service.writeSecretWithObject('profiles/acm-r1', creds)).toBeNull()
    expect(add).toHaveBeenCalledTimes(1)
    expect(warn).not.toHaveBeenCalled()
  })

  it('creates the secret only when it does not exist yet', async () => {
    const create = vi.spyOn(fake, 'createSecret')
    await service.writeSecretWithObject(`devices/${uuid}`, creds)
    await service.writeSecretWithObject(`devices/${uuid}`, creds)
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('returns null when every attempt fails, like Vault', async () => {
    for (const path of [`devices/${uuid}`, 'profiles/acm-r1']) {
      fake.failAdd = 3
      const result = service.writeSecretWithObject(path, creds)
      await vi.runAllTimersAsync()
      expect(await result).toBeNull()
    }
  })

  it('throws on a payload that is not a JSON object', async () => {
    for (const payload of [
      'null',
      '42',
      '"x"',
      '[]'
    ]) {
      vi.spyOn(fake, 'accessSecretVersion').mockResolvedValueOnce([
        {
          name: 'projects/test-project/secrets/rps-store-profiles__x/versions/1',
          payload: { data: Buffer.from(payload) }
        }
      ])
      await expect(service.getSecretAtPath('profiles/x')).rejects.toThrow('not a JSON object')
    }
  })

  it('returns null for an absent secret and throws on other errors', async () => {
    expect(await service.getSecretAtPath('devices/unknown')).toBeNull()
    vi.spyOn(fake, 'accessSecretVersion').mockRejectedValueOnce(grpcError(14))
    await expect(service.getSecretAtPath('devices/unknown')).rejects.toThrow()
  })

  it('getSecretFromKey returns null on errors, missing keys and empty values, like Vault', async () => {
    await service.writeSecretWithObject(`devices/${uuid}`, { ...creds, MEBX_PASSWORD: '' })
    expect(await service.getSecretFromKey(`devices/${uuid}`, 'MPS_PASSWORD')).toBeNull()
    expect(await service.getSecretFromKey(`devices/${uuid}`, 'MEBX_PASSWORD')).toBeNull()
    vi.spyOn(fake, 'accessSecretVersion').mockRejectedValueOnce(grpcError(7))
    expect(await service.getSecretFromKey(`devices/${uuid}`, 'AMT_PASSWORD')).toBeNull()
  })

  it('deletes secrets and treats missing ones as deleted', async () => {
    await service.writeSecretWithObject(`devices/${uuid}`, creds)
    expect(await service.deleteSecretAtPath(`devices/${uuid}`)).toBe(true)
    expect(await service.deleteSecretAtPath(`devices/${uuid}`)).toBe(true)
    expect(await service.getSecretAtPath(`devices/${uuid}`)).toBeNull()
  })

  it('reports a failed delete as false', async () => {
    vi.spyOn(fake, 'deleteSecret').mockRejectedValueOnce(grpcError(7))
    expect(await service.deleteSecretAtPath(`devices/${uuid}`)).toBe(false)
  })

  it('health reports the Vault-shaped status and treats an absent health secret as healthy', async () => {
    expect(await service.health()).toEqual({ initialized: true, sealed: false, provider: 'gcpsm' })
  })

  it('health throws with the gRPC status name when Secret Manager fails', async () => {
    vi.spyOn(fake, 'getSecret').mockRejectedValueOnce(grpcError(7))
    await expect(service.health()).rejects.toMatchObject({ healthStatus: 'PERMISSION_DENIED' })
    vi.spyOn(fake, 'getSecret').mockRejectedValueOnce(new Error('no credentials'))
    await expect(service.health()).rejects.toMatchObject({ healthStatus: 'unknown error' })
  })
})
