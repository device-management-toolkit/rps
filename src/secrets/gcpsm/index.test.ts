/*********************************************************************
 * Copyright (c) Intel Corporation 2026
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { errorStatus, GcpSecretManagerService, toSecretId } from './index.js'
import Logger from '../../Logger.js'
import { config } from '../../test/helper/Config.js'
import { Environment } from '../../utils/Environment.js'
import { type DeviceCredentials } from '../../interfaces/ISecretManagerService.js'

import got from 'got'
import { createServer, type Server } from 'node:http'
import { type AddressInfo } from 'node:net'
import { vi } from 'vitest'

const API_URL = 'https://secretmanager.googleapis.com/v1/'
const METADATA_TOKEN_URL = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token'
const HTTP_CODES: Record<string, number> = {
  NOT_FOUND: 404,
  ALREADY_EXISTS: 409,
  PERMISSION_DENIED: 403,
  FAILED_PRECONDITION: 400,
  UNAVAILABLE: 503
}

// Shaped like got's HTTPError for a Google API error response.
const apiError = (status: string): Error =>
  Object.assign(new Error(`api ${status}`), {
    response: {
      statusCode: HTTP_CODES[status],
      body: JSON.stringify({ error: { code: HTTP_CODES[status], message: status, status } })
    }
  })

// Minimal in-memory fake of the Secret Manager REST API and the metadata server, behind a
// got-like function: secrets hold an ordered list of versions. Like the real service, "latest"
// is the newest version in any state, so accessing it fails with FAILED_PRECONDITION when that
// version is destroyed. Version lists come one per page, so paging is always exercised.
class FakeApi {
  secrets = new Map<string, { versions: { name: string; data: Buffer; state: string }[] }>()
  failAdd = 0
  requests: { method: string; url: string; headers: any; timeout: any }[] = []

  http: any = Object.assign(
    (url: string, options: any) => ({ json: async () => await this.handle(options.method, url, options) }),
    { get: (url: string, options: any) => ({ json: async () => await this.handle('GET', url, options) }) }
  )

  async handle(method: string, url: string, options: any): Promise<any> {
    this.requests.push({ method, url, headers: options?.headers, timeout: options?.timeout })
    if (url === METADATA_TOKEN_URL) return await this.token()
    const [resource, query] = url.slice(API_URL.length).split('?')
    const params = new URLSearchParams(query)
    const [name, verb] = resource.split(':')
    if (method === 'POST' && verb == null) return await this.createSecret(name, params.get('secretId'), options.json)
    if (verb === 'addVersion') return await this.addVersion(name, options.json)
    if (verb === 'access') return await this.access(name)
    if (verb === 'destroy') return await this.destroy(name)
    if (name.endsWith('/versions')) return await this.listVersions(name.slice(0, -'/versions'.length), params)
    if (method === 'DELETE') return await this.deleteSecret(name)
    return await this.getSecret(name)
  }

  async token(): Promise<any> {
    return { access_token: 'token-1', expires_in: 3599, token_type: 'Bearer' }
  }

  async createSecret(parent: string, secretId: string | null, _body: any): Promise<any> {
    const name = `${parent}/${secretId}`
    if (this.secrets.has(name)) throw apiError('ALREADY_EXISTS')
    this.secrets.set(name, { versions: [] })
    return { name }
  }

  async addVersion(parent: string, body: any): Promise<any> {
    if (this.failAdd > 0) {
      this.failAdd--
      throw apiError('UNAVAILABLE')
    }
    const secret = this.secrets.get(parent)
    if (secret == null) throw apiError('NOT_FOUND')
    const name = `${parent}/versions/${secret.versions.length + 1}`
    secret.versions.push({ name, data: Buffer.from(body.payload.data, 'base64'), state: 'ENABLED' })
    return { name, state: 'ENABLED' }
  }

  async access(name: string): Promise<any> {
    const parent = name.replace(/\/versions\/[^/]+$/, '')
    const versions = this.secrets.get(parent)?.versions ?? []
    const v = name.endsWith('/versions/latest') ? versions[versions.length - 1] : versions.find((x) => x.name === name)
    if (v == null) throw apiError('NOT_FOUND')
    if (v.state !== 'ENABLED') throw apiError('FAILED_PRECONDITION')
    return { name: v.name, payload: { data: v.data.toString('base64') } }
  }

  async listVersions(parent: string, params: URLSearchParams): Promise<any> {
    expect(params.get('filter')).toBe('state:ENABLED OR state:DISABLED')
    const versions = (this.secrets.get(parent)?.versions ?? []).filter((v) => v.state !== 'DESTROYED')
    const index = Number(params.get('pageToken') ?? 0)
    const nextPageToken = index + 1 < versions.length ? String(index + 1) : undefined
    return { versions: versions.slice(index, index + 1).map(({ name, state }) => ({ name, state })), nextPageToken }
  }

  async destroy(name: string): Promise<any> {
    for (const s of this.secrets.values()) {
      for (const v of s.versions) if (v.name === name) v.state = 'DESTROYED'
    }
    return { name, state: 'DESTROYED' }
  }

  async deleteSecret(name: string): Promise<any> {
    if (!this.secrets.delete(name)) throw apiError('NOT_FOUND')
    return {}
  }

  async getSecret(name: string): Promise<any> {
    if (!this.secrets.has(name)) throw apiError('NOT_FOUND')
    return { name }
  }
}

const creds: DeviceCredentials = { AMT_PASSWORD: 'P@ssw0rd', MEBX_PASSWORD: 'Intel@123' }
const uuid = '4c4c4544-004b-4210-8033-b6c04f504633'
let fake: FakeApi
let service: GcpSecretManagerService

beforeEach(() => {
  vi.useFakeTimers()
  Environment.Config = { ...config, gcpsm_project: 'test-project' }
  fake = new FakeApi()
  service = new GcpSecretManagerService(new Logger('GcpsmTests'), fake.http)
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
    expect(() => new GcpSecretManagerService(new Logger('GcpsmTests'), fake.http)).toThrow('RPS_GCPSM_PROJECT')
  })

  it('rejects a secret prefix Secret Manager does not allow', () => {
    Environment.Config = { ...config, gcpsm_project: 'test-project', gcpsm_secret_prefix: 'rps/store' }
    expect(() => new GcpSecretManagerService(new Logger('GcpsmTests'), fake.http)).toThrow('RPS_GCPSM_SECRET_PREFIX')
  })

  it('rejects a numeric secret prefix, whose leading zeros env parsing has already dropped', () => {
    Environment.Config = { ...config, gcpsm_project: 'test-project', gcpsm_secret_prefix: 7 as any }
    expect(() => new GcpSecretManagerService(new Logger('GcpsmTests'), fake.http)).toThrow('purely numeric')
  })

  it('treats empty env values, which env parsing turns into NaN, as unset', () => {
    Environment.Config = { ...config, gcpsm_project: Number.NaN as any }
    expect(() => new GcpSecretManagerService(new Logger('GcpsmTests'), fake.http)).toThrow('RPS_GCPSM_PROJECT')
    Environment.Config = {
      ...config,
      gcpsm_project: 'test-project',
      gcpsm_location: Number.NaN as any,
      gcpsm_secret_prefix: Number.NaN as any
    }
    service = new GcpSecretManagerService(new Logger('GcpsmTests'), fake.http)
    expect(service.location).toBe('')
    expect(service.prefix).toBe('rps-store-')
  })

  it('rejects a boolean secret prefix', () => {
    Environment.Config = { ...config, gcpsm_project: 'test-project', gcpsm_secret_prefix: true as any }
    expect(() => new GcpSecretManagerService(new Logger('GcpsmTests'), fake.http)).toThrow('RPS_GCPSM_SECRET_PREFIX')
  })

  it('accepts a numeric project number', async () => {
    Environment.Config = { ...config, gcpsm_project: 123456789012 as any }
    service = new GcpSecretManagerService(new Logger('GcpsmTests'), fake.http)
    expect(service.project).toBe('123456789012')
    await service.writeSecretWithObject(`devices/${uuid}`, creds)
    expect([...fake.secrets.keys()]).toEqual([`projects/123456789012/secrets/rps-store-devices__${uuid}`])
  })

  it('stores secrets under the configured prefix', async () => {
    Environment.Config = { ...config, gcpsm_project: 'test-project', gcpsm_secret_prefix: 'rps-staging-' }
    service = new GcpSecretManagerService(new Logger('GcpsmTests'), fake.http)
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
    service = new GcpSecretManagerService(new Logger('GcpsmTests'), fake.http)
    const create = vi.spyOn(fake, 'createSecret')
    await service.writeSecretWithObject(`devices/${uuid}`, creds)
    expect(create.mock.calls[0][2]).toEqual({
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
    const add = fake.addVersion.bind(fake)
    let first = true
    vi.spyOn(fake, 'addVersion').mockImplementation(async (parent: string, body: any) => {
      const rsp = await add(parent, body)
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
    const add = vi.spyOn(fake, 'addVersion').mockRejectedValue(apiError('PERMISSION_DENIED'))
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
      vi.spyOn(fake, 'access').mockResolvedValueOnce({
        name: 'projects/test-project/secrets/rps-store-profiles__x/versions/1',
        payload: { data: Buffer.from(payload).toString('base64') }
      })
      await expect(service.getSecretAtPath('profiles/x')).rejects.toThrow('not a JSON object')
    }
  })

  it('returns null for an absent secret and throws on other errors', async () => {
    expect(await service.getSecretAtPath('devices/unknown')).toBeNull()
    vi.spyOn(fake, 'access').mockRejectedValueOnce(apiError('UNAVAILABLE'))
    await expect(service.getSecretAtPath('devices/unknown')).rejects.toThrow()
  })

  it('getSecretFromKey returns null on errors, missing keys and empty values, like Vault', async () => {
    await service.writeSecretWithObject(`devices/${uuid}`, { ...creds, MEBX_PASSWORD: '' })
    expect(await service.getSecretFromKey(`devices/${uuid}`, 'MPS_PASSWORD')).toBeNull()
    expect(await service.getSecretFromKey(`devices/${uuid}`, 'MEBX_PASSWORD')).toBeNull()
    vi.spyOn(fake, 'access').mockRejectedValueOnce(apiError('PERMISSION_DENIED'))
    expect(await service.getSecretFromKey(`devices/${uuid}`, 'AMT_PASSWORD')).toBeNull()
  })

  it('deletes secrets and treats missing ones as deleted', async () => {
    await service.writeSecretWithObject(`devices/${uuid}`, creds)
    expect(await service.deleteSecretAtPath(`devices/${uuid}`)).toBe(true)
    expect(await service.deleteSecretAtPath(`devices/${uuid}`)).toBe(true)
    expect(await service.getSecretAtPath(`devices/${uuid}`)).toBeNull()
  })

  it('reports a failed delete as false', async () => {
    vi.spyOn(fake, 'deleteSecret').mockRejectedValueOnce(apiError('PERMISSION_DENIED'))
    expect(await service.deleteSecretAtPath(`devices/${uuid}`)).toBe(false)
  })

  it('health reports the Vault-shaped status and treats an absent health secret as healthy', async () => {
    expect(await service.health()).toEqual({ initialized: true, sealed: false, provider: 'gcpsm' })
  })

  it('health throws with the status name when Secret Manager fails', async () => {
    vi.spyOn(fake, 'getSecret').mockRejectedValueOnce(apiError('PERMISSION_DENIED'))
    await expect(service.health()).rejects.toMatchObject({ healthStatus: 'PERMISSION_DENIED' })
    vi.spyOn(fake, 'getSecret').mockRejectedValueOnce(new Error('no credentials'))
    await expect(service.health()).rejects.toMatchObject({ healthStatus: 'unknown error' })
  })

  it('authenticates every API request with a token from the metadata server', async () => {
    await service.writeSecretWithObject(`devices/${uuid}`, creds)
    const [tokenRequest, ...apiRequests] = fake.requests
    expect(tokenRequest).toMatchObject({ url: METADATA_TOKEN_URL, headers: { 'Metadata-Flavor': 'Google' } })
    expect(apiRequests.length).toBeGreaterThan(0)
    for (const r of apiRequests) {
      expect(r.url.startsWith(API_URL)).toBe(true)
      expect(r.headers).toEqual({ authorization: 'Bearer token-1' })
    }
  })

  it('reuses the token until shortly before it expires', async () => {
    const token = vi.spyOn(fake, 'token')
    await Promise.all([service.getSecretAtPath('profiles/a'), service.getSecretAtPath('profiles/b')])
    vi.advanceTimersByTime(3500 * 1000)
    await service.getSecretAtPath('profiles/a')
    expect(token).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(60 * 1000)
    await service.getSecretAtPath('profiles/a')
    expect(token).toHaveBeenCalledTimes(2)
  })

  it('does not cache a failed token request, nor mistake it for an absent secret', async () => {
    // A 404 from the metadata server must not read as "secret not found".
    vi.spyOn(fake, 'token').mockRejectedValueOnce(apiError('NOT_FOUND'))
    await expect(service.getSecretAtPath('profiles/x')).rejects.toMatchObject({ status: 'UNAUTHENTICATED' })
    expect(await service.getSecretAtPath('profiles/x')).toBeNull()
  })

  it('reads every page of versions before destroying old ones', async () => {
    for (let i = 0; i < 3; i++) await service.writeSecretWithObject(`devices/${uuid}`, creds)
    const parent = `projects/test-project/secrets/rps-store-devices__${uuid}`
    for (const v of fake.secrets.get(parent)!.versions) v.state = 'ENABLED'
    await service.destroyOlderVersions(`devices/${uuid}`, `${parent}/versions/3`)
    expect(fake.secrets.get(parent)!.versions.map((v) => v.state)).toEqual([
      'DESTROYED',
      'DESTROYED',
      'ENABLED'
    ])
  })

  it('retries a write that got no response', async () => {
    const add = fake.addVersion.bind(fake)
    vi.spyOn(fake, 'addVersion').mockRejectedValueOnce(Object.assign(new Error('reset'), { code: 'ECONNRESET' }))
    vi.spyOn(fake, 'addVersion').mockImplementation(add)
    const result = service.writeSecretWithObject(`devices/${uuid}`, creds)
    await vi.runAllTimersAsync()
    expect(await result).toEqual({ version: 1 })
  })

  it('health reports UNAUTHENTICATED when no token can be fetched', async () => {
    vi.spyOn(fake, 'token').mockRejectedValueOnce(new Error('connect ECONNREFUSED'))
    await expect(service.health()).rejects.toMatchObject({ healthStatus: 'UNAUTHENTICATED' })
  })

  it('sets a timeout on every request', async () => {
    await service.writeSecretWithObject(`devices/${uuid}`, creds)
    const [tokenRequest, ...apiRequests] = fake.requests
    expect(tokenRequest.timeout).toEqual({ request: 10_000 })
    for (const r of apiRequests) {
      expect(r.timeout).toEqual({ request: 10_000 })
    }
  })

  it('rejects a token response without a valid expires_in, so it is not cached forever', async () => {
    for (const expiresIn of [undefined, 'soon']) {
      vi.spyOn(fake, 'token').mockResolvedValueOnce({ access_token: 'token-1', expires_in: expiresIn })
      await expect(service.getSecretAtPath('profiles/x')).rejects.toMatchObject({ status: 'UNAUTHENTICATED' })
    }
    expect(await service.getSecretAtPath('profiles/x')).toBeNull()
  })
})

// Runs the service with the real got client against a local server that serves FakeApi, so the
// wire format (URLs, JSON bodies, response parsing, timeouts) is covered, not just the fake.
describe('GcpSecretManagerService over HTTP', () => {
  let server: Server
  let hang: 'token' | 'api' | null

  beforeEach(async () => {
    vi.useRealTimers()
    hang = null
    server = createServer((req, res) => {
      let body = ''
      req.on('data', (chunk) => (body += chunk))
      req.on('end', () => {
        const isToken = req.url === '/token'
        if (hang === (isToken ? 'token' : 'api')) return
        const url = isToken ? METADATA_TOKEN_URL : API_URL + req.url!.slice('/v1/'.length)
        fake.handle(req.method!, url, { json: body ? JSON.parse(body) : undefined, headers: req.headers }).then(
          (rsp) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(rsp)),
          (error) => res.writeHead(error.response?.statusCode ?? 500).end(error.response?.body ?? '')
        )
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    // got's own retries of GET and DELETE (production relies on them for reads) back off for
    // seconds, so they are disabled here; each timeout test then covers a single attempt.
    service = new GcpSecretManagerService(new Logger('GcpsmTests'), got.extend({ retry: { limit: 0 } }), {
      apiUrl: `${base}/v1`,
      tokenUrl: `${base}/token`,
      timeouts: { metadata: 100, api: 100 }
    })
  })

  afterEach(async () => {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  })

  it('writes, reads, overwrites and deletes a secret', async () => {
    expect(await service.writeSecretWithObject(`devices/${uuid}`, creds)).toEqual({ version: 1 })
    expect(await service.writeSecretWithObject(`devices/${uuid}`, { ...creds, AMT_PASSWORD: 'n3w' })).toEqual({
      version: 2
    })
    expect(await service.getSecretAtPath(`devices/${uuid}`)).toEqual({ ...creds, AMT_PASSWORD: 'n3w', version: 2 })
    const versions = fake.secrets.get(`projects/test-project/secrets/rps-store-devices__${uuid}`)!.versions
    expect(versions.map((v) => v.state)).toEqual(['DESTROYED', 'ENABLED'])
    expect(await service.deleteSecretAtPath(`devices/${uuid}`)).toBe(true)
    expect(await service.getSecretAtPath(`devices/${uuid}`)).toBeNull()
    expect(await service.health()).toEqual({ initialized: true, sealed: false, provider: 'gcpsm' })
  })

  it('maps API error responses to their status', async () => {
    await expect(service.deleteSecretAtPath('profiles/x')).resolves.toBe(true)
    vi.spyOn(fake, 'getSecret').mockRejectedValueOnce(apiError('PERMISSION_DENIED'))
    await expect(service.health()).rejects.toMatchObject({ healthStatus: 'PERMISSION_DENIED' })
  })

  it('times out a hung token request without blocking later calls', async () => {
    hang = 'token'
    await expect(service.getSecretAtPath('profiles/x')).rejects.toMatchObject({ status: 'UNAUTHENTICATED' })
    hang = null
    expect(await service.getSecretAtPath('profiles/x')).toBeNull()
  })

  it('times out a hung API request', async () => {
    await service.accessToken()
    hang = 'api'
    const error = await service.getSecretAtPath('profiles/x').catch((e) => e)
    expect(errorStatus(error)).toBe('UNAVAILABLE')
  })
})

describe('errorStatus', () => {
  it('prefers error.status from the response body', () => {
    expect(errorStatus(apiError('ALREADY_EXISTS'))).toBe('ALREADY_EXISTS')
    expect(errorStatus({ response: { statusCode: 409, body: { error: { status: 'ABORTED' } } } })).toBe('ABORTED')
  })

  it('falls back to the HTTP status code', () => {
    expect(errorStatus({ response: { statusCode: 404, body: 'not json' } })).toBe('NOT_FOUND')
    expect(errorStatus({ response: { statusCode: 502, body: '' } })).toBe('INTERNAL')
    expect(errorStatus({ response: { statusCode: 418, body: '' } })).toBeUndefined()
  })

  it('treats a request without response as UNAVAILABLE, and anything else as unknown', () => {
    expect(errorStatus(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }))).toBe('UNAVAILABLE')
    expect(errorStatus(new Error('boom'))).toBeUndefined()
  })
})
