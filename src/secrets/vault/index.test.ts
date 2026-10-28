/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { VaultService, kvMetadataPath, kvMetadataPathCandidates } from './index.js'
import Logger from '../../Logger.js'
import { type ILogger } from '../../interfaces/ILogger.js'
import { config } from '../../test/helper/Config.js'
import { Environment } from '../../utils/Environment.js'
import { type DeviceCredentials } from '../../interfaces/ISecretManagerService.js'
import { HTTPError } from 'got'

import { vi, type MockInstance } from 'vitest'

const makeHttpError = (statusCode: number): HTTPError => {
  const err = Object.create(HTTPError.prototype) as HTTPError & { response: any; message: string }
  err.response = { statusCode }
  err.message = `Response code ${statusCode}`
  return err
}
let secretManagerService: VaultService = null as any
Environment.Config = config
let gotSpy: MockInstance
let gotFailSpy: MockInstance
const logger: ILogger = new Logger('SecretManagerTests')
const secretPath = '4c4c4544-004b-4210-8033-b6c04f504633'
const secretCreds: DeviceCredentials = {
  AMT_PASSWORD: 'P@ssw0rd',
  MEBX_PASSWORD: 'Intel@123',
  MPS_PASSWORD: 'lLJPJNtU2$8FZTUy'
}

const secretCert: DeviceCredentials = {
  AMT_PASSWORD: 'password',
  MPS_PASSWORD: 'password',
  MEBX_PASSWORD: 'password'
}

beforeEach(() => {
  secretManagerService = new VaultService(logger)
  gotSpy = vi.spyOn(secretManagerService.gotClient, 'get').mockImplementation(
    () =>
      ({
        json: vi.fn(() => ({ data: { data: secretCreds, metadata: { version: 1 } } }))
      }) as any
  )
})

afterEach(() => {
  vi.clearAllMocks()
})

it('should get a secret for specific given key of a path', async () => {
  const result = await secretManagerService.getSecretFromKey(secretPath, 'AMT_PASSWORD')
  expect(gotSpy).toHaveBeenCalledWith(secretPath)
  expect(result).toBe('P@ssw0rd')
})

it('should get null, if the key does not exist in the path', async () => {
  const result = await secretManagerService.getSecretFromKey(secretPath, 'AMT_PASSWORD1')
  expect(result).toBe(null)
  expect(gotSpy).toHaveBeenCalledWith(secretPath)
})

it('should get null, if path does not exist', async () => {
  gotFailSpy = vi.spyOn(secretManagerService.gotClient, 'get')
  gotFailSpy.mockResolvedValue({
    json: vi.fn(async () => await Promise.reject(new Error('Not Found')))
  })
  const result = await secretManagerService.getSecretFromKey(secretPath, 'AMT_PASSWORD')
  expect(result).toBe(null)
  expect(gotFailSpy).toHaveBeenCalledWith(secretPath)
})

it('should get a secret from a specific given path', async () => {
  const result = await secretManagerService.getSecretAtPath(secretPath)
  expect(result).toEqual(secretCreds)
  expect(gotSpy).toHaveBeenCalledWith(secretPath)
})

it('should return null when Vault responds 404 (secret genuinely absent)', async () => {
  gotFailSpy = vi.spyOn(secretManagerService.gotClient, 'get').mockImplementation(
    () =>
      ({
        json: vi.fn(async () => await Promise.reject(makeHttpError(404)))
      }) as any
  )
  const result = await secretManagerService.getSecretAtPath('does/not/exist')
  expect(result).toEqual(null)
  expect(gotFailSpy).toHaveBeenCalledWith('does/not/exist')
})

it('should throw when Vault responds with a server error (5xx)', async () => {
  gotFailSpy = vi.spyOn(secretManagerService.gotClient, 'get').mockImplementation(
    () =>
      ({
        json: vi.fn(async () => await Promise.reject(makeHttpError(503)))
      }) as any
  )
  await expect(secretManagerService.getSecretAtPath('transient/failure')).rejects.toMatchObject({
    response: { statusCode: 503 }
  })
})

it('should throw on network/transport errors', async () => {
  gotFailSpy = vi.spyOn(secretManagerService.gotClient, 'get').mockImplementation(
    () =>
      ({
        json: vi.fn(async () => await Promise.reject(new Error('ECONNRESET')))
      }) as any
  )
  await expect(secretManagerService.getSecretAtPath('any/path')).rejects.toThrow('ECONNRESET')
})

it('should create a secret', async () => {
  const gotPostSpy = vi
    .spyOn(secretManagerService.gotClient, 'post')
    .mockImplementation(() => ({ json: vi.fn(async () => await Promise.resolve(secretCert)) }) as any)
  const result = await secretManagerService.writeSecretWithObject('test', secretCert)
  expect(result).toEqual(secretCert)
  expect(gotPostSpy).toHaveBeenCalledWith('test', { json: { data: secretCert } })
})

it('should return false if the path does not exist', async () => {
  const badPath = 'does/not/exist'
  gotFailSpy = vi.spyOn(secretManagerService.gotClient, 'post')
  gotFailSpy.mockResolvedValue(null)
  const result = await secretManagerService.writeSecretWithObject(badPath, secretCert)
  expect(result).toBe(null)
  expect(gotFailSpy).toHaveBeenCalledWith(badPath, { json: { data: secretCert } })
})

describe('secret metadata', () => {
  const metadataArgs = (path: string, hostname: string): [string, object] => [
    path,
    {
      prefixUrl: `${Environment.Config.vault_address}/v1/secret/metadata/`,
      headers: { 'Content-Type': 'application/merge-patch+json' },
      json: { custom_metadata: { hostname } }
    }
  ]
  let postSpy: MockInstance
  let patchSpy: MockInstance
  let warnSpy: MockInstance

  beforeEach(() => {
    Environment.Config = { ...config, secrets_path: 'secret/data/' }
    postSpy = vi
      .spyOn(secretManagerService.gotClient, 'post')
      .mockImplementation(() => ({ json: vi.fn(async () => await Promise.resolve(secretCert)) }) as any)
    patchSpy = vi
      .spyOn(secretManagerService.gotClient, 'patch')
      .mockImplementation(() => ({ json: vi.fn(async () => await Promise.resolve({})) }) as any)
    warnSpy = vi.spyOn(secretManagerService.logger, 'warn').mockImplementation(() => undefined as any)
  })

  afterEach(() => {
    Environment.Config = config
  })

  it('should patch custom_metadata after the data write and return the data response', async () => {
    const result = await secretManagerService.writeSecretWithObject('devices/x', secretCert, { hostname: 'h1' })
    expect(result).toEqual(secretCert)
    expect(postSpy).toHaveBeenCalledWith('devices/x', { json: { data: secretCert } })
    expect(patchSpy).toHaveBeenCalledWith(...metadataArgs('devices/x', 'h1'))
    expect(postSpy.mock.invocationCallOrder[0]).toBeLessThan(patchSpy.mock.invocationCallOrder[0])
  })

  it.each([
    [undefined],
    [{}],
    [{ hostname: '' }]
  ])('should not patch for metadata %j', async (metadata) => {
    const result = await secretManagerService.writeSecretWithObject('devices/x', secretCert, metadata)
    expect(result).toEqual(secretCert)
    expect(patchSpy).not.toHaveBeenCalled()
  })

  it('should return the data response and warn when the metadata patch fails', async () => {
    patchSpy.mockImplementation(
      () => ({ json: vi.fn(async () => await Promise.reject(new Error('metadata boom'))) }) as any
    )
    const result = await secretManagerService.writeSecretWithObject('devices/x', secretCert, { hostname: 'h1' })
    expect(result).toEqual(secretCert)
    expect(patchSpy).toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalled()
  })

  it('should keep a rejecting metadata write out of the data write', async () => {
    const errorSpy = vi.spyOn(secretManagerService.logger, 'error').mockImplementation(() => undefined as any)
    vi.spyOn(secretManagerService, 'writeSecretMetadata').mockRejectedValue(new Error('metadata boom'))
    const result = await secretManagerService.writeSecretWithObject('devices/x', secretCert, { hostname: 'h1' })
    expect(result).toEqual(secretCert)
    expect(errorSpy).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })

  it('should skip the patch when secrets_path has no /data/ segment', async () => {
    Environment.Config = { ...config, secrets_path: 'kv/' }
    const result = await secretManagerService.writeSecretWithObject('devices/x', secretCert, { hostname: 'h1' })
    expect(result).toEqual(secretCert)
    expect(postSpy).toHaveBeenCalled()
    expect(patchSpy).not.toHaveBeenCalled()
  })

  it('should return null and not patch when the data write fails', async () => {
    postSpy.mockImplementation(() => ({ json: vi.fn(async () => await Promise.reject(new Error('data boom'))) }) as any)
    const result = await secretManagerService.writeSecretWithObject('devices/x', secretCert, { hostname: 'h1' })
    expect(result).toBeNull()
    expect(patchSpy).not.toHaveBeenCalled()
  })

  it('should send the metadata patch when called directly', async () => {
    await secretManagerService.writeSecretMetadata('devices/x', { hostname: 'h1' })
    expect(patchSpy).toHaveBeenCalledWith(...metadataArgs('devices/x', 'h1'))
  })

  it('should not patch when called directly with an empty hostname', async () => {
    await secretManagerService.writeSecretMetadata('devices/x', { hostname: '' })
    expect(patchSpy).not.toHaveBeenCalled()
  })

  it.each([
    ['localhost'],
    ['LocalHost'],
    [123],
    [{}]
  ])('should not patch when called directly with hostname %j', async (hostname) => {
    await expect(
      secretManagerService.writeSecretMetadata('devices/x', { hostname: hostname as any })
    ).resolves.toBeUndefined()
    expect(patchSpy).not.toHaveBeenCalled()
  })

  it('should write the data but not patch for a localhost hostname', async () => {
    const result = await secretManagerService.writeSecretWithObject('devices/x', secretCert, { hostname: 'localhost' })
    expect(result).toEqual(secretCert)
    expect(postSpy).toHaveBeenCalledWith('devices/x', { json: { data: secretCert } })
    expect(patchSpy).not.toHaveBeenCalled()
  })

  it('should resolve without patching when secrets_path is undefined', async () => {
    Environment.Config = { ...config, secrets_path: undefined as any }
    await expect(secretManagerService.writeSecretMetadata('devices/x', { hostname: 'h1' })).resolves.toBeUndefined()
    expect(patchSpy).not.toHaveBeenCalled()
  })

  it('should include a non-Error rejection in the warning', async () => {
    patchSpy.mockImplementation(() => ({ json: vi.fn(async () => await Promise.reject('boom')) }) as any)
    await secretManagerService.writeSecretMetadata('devices/x', { hostname: 'h1' })
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('boom'))
  })

  it('should resolve and warn when called directly and the patch rejects', async () => {
    patchSpy.mockImplementation(
      () => ({ json: vi.fn(async () => await Promise.reject(new Error('metadata boom'))) }) as any
    )
    await expect(secretManagerService.writeSecretMetadata('devices/x', { hostname: 'h1' })).resolves.toBeUndefined()
    expect(warnSpy).toHaveBeenCalled()
  })
})

describe('kvMetadataPath', () => {
  it.each([
    ['secret/data/', 'secret/metadata/'],
    ['team/data/data/', 'team/data/metadata/'],
    ['secret/data/rps/', 'secret/metadata/rps/']
  ])('should map %j to %j', (secretsPath, expected) => {
    expect(kvMetadataPath(secretsPath)).toBe(expected)
  })

  it.each([
    ['kv/'],
    ['data/'],
    [''],
    [undefined]
  ])('should return null for %j', (secretsPath) => {
    expect(kvMetadataPath(secretsPath)).toBeNull()
  })
})

describe('kvMetadataPathCandidates', () => {
  it.each([
    ['secret/data/', ['secret/metadata/']],
    ['secret/data', ['secret/metadata/']],
    ['kv/', ['kv/']],
    [undefined, ['']],
    ['', ['']]
  ])('should map %j to %j', (secretsPath, expected) => {
    expect(kvMetadataPathCandidates(secretsPath)).toEqual(expected)
  })

  it.each([
    ['secret/data/rps/data/', ['secret/metadata/rps/data/', 'secret/data/rps/metadata/']],
    [
      'a/data/b/data/c/data/',
      [
        'a/metadata/b/data/c/data/',
        'a/data/b/metadata/c/data/',
        'a/data/b/data/c/metadata/'
      ]
    ],
    ['team/data/data/', ['team/metadata/data/', 'team/data/metadata/']]
  ])('should return one candidate per data segment of %j', (secretsPath, expected) => {
    const candidates = kvMetadataPathCandidates(secretsPath)
    expect(candidates).toHaveLength(expected.length)
    expect(new Set(candidates)).toEqual(new Set(expected))
  })
})

describe('delete with an ambiguous secrets_path', () => {
  const prefix = (path: string): string => `${Environment.Config.vault_address}/v1/${path}`
  let deleteSpy: MockInstance
  let getSpy: MockInstance
  let errorSpy: MockInstance
  let deleteOutcomes: Record<string, number>
  // status of each successive verification read; undefined means the secret is still readable
  let getOutcomes: (number | undefined)[]

  beforeEach(() => {
    Environment.Config = { ...config, secrets_path: 'secret/data/rps/data/' }
    deleteOutcomes = {}
    getOutcomes = [404]
    deleteSpy = vi.spyOn(secretManagerService.gotClient, 'delete').mockImplementation(
      (_path: any, options: any) =>
        ({
          json: vi.fn(async () => {
            const status = deleteOutcomes[options.prefixUrl as string]
            return status == null ? await Promise.resolve({}) : await Promise.reject(makeHttpError(status))
          })
        }) as any
    )
    getSpy = vi.spyOn(secretManagerService.gotClient, 'get').mockImplementation(
      () =>
        ({
          json: vi.fn(async () => {
            const outcome = getOutcomes.length > 1 ? getOutcomes.shift() : getOutcomes[0]
            return outcome == null
              ? await Promise.resolve({ data: { data: secretCreds, metadata: { version: 1 } } })
              : await Promise.reject(makeHttpError(outcome))
          })
        }) as any
    )
    errorSpy = vi.spyOn(secretManagerService.logger, 'error').mockImplementation(() => undefined as any)
    vi.spyOn(secretManagerService.logger, 'debug').mockImplementation(() => undefined as any)
  })

  afterEach(() => {
    Environment.Config = config
  })

  it('should send one delete at the last data segment and stop once the secret is gone', async () => {
    Environment.Config = { ...config, secrets_path: 'team/data/data/' }
    await expect(secretManagerService.deleteSecretAtPath('devices/x')).resolves.toBe(true)
    expect(deleteSpy).toHaveBeenCalledTimes(1)
    expect(deleteSpy).toHaveBeenCalledWith('devices/x', { prefixUrl: prefix('team/data/metadata/') })
    expect(getSpy).toHaveBeenCalledTimes(1)
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('should try the remaining candidates in order after the last one did not remove the secret', async () => {
    getOutcomes = [undefined, 404]
    await expect(secretManagerService.deleteSecretAtPath('devices/x')).resolves.toBe(true)
    expect(deleteSpy.mock.calls).toEqual([
      ['devices/x', { prefixUrl: prefix('secret/data/rps/metadata/') }],
      ['devices/x', { prefixUrl: prefix('secret/metadata/rps/data/') }]
    ])
    expect(getSpy).toHaveBeenCalledTimes(2)
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it.each([
    [403],
    [404],
    [500]
  ])('should continue after a candidate answering %i', async (status) => {
    getOutcomes = [undefined, 404]
    deleteOutcomes[prefix('secret/data/rps/metadata/')] = status
    await expect(secretManagerService.deleteSecretAtPath('devices/x')).resolves.toBe(true)
    expect(deleteSpy).toHaveBeenCalledTimes(2)
    expect(deleteSpy).toHaveBeenLastCalledWith('devices/x', { prefixUrl: prefix('secret/metadata/rps/data/') })
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('should return false and log one error when the secret is still readable after every candidate', async () => {
    getOutcomes = [undefined]
    await expect(secretManagerService.deleteSecretAtPath('devices/x')).resolves.toBe(false)
    expect(deleteSpy).toHaveBeenCalledTimes(2)
    expect(getSpy).toHaveBeenCalledTimes(2)
    expect(errorSpy).toHaveBeenCalledTimes(1)
  })

  it.each([[503], [403]])('should stop after one delete when the read fails with %i', async (status) => {
    getOutcomes = [status]
    await expect(secretManagerService.deleteSecretAtPath('devices/x')).resolves.toBe(false)
    expect(deleteSpy.mock.calls).toEqual([['devices/x', { prefixUrl: prefix('secret/data/rps/metadata/') }]])
    expect(getSpy).toHaveBeenCalledTimes(1)
    expect(errorSpy).toHaveBeenCalledTimes(1)
  })

  it('should send one delete and one read for an unambiguous secrets_path', async () => {
    Environment.Config = { ...config, secrets_path: 'secret/data/' }
    await expect(secretManagerService.deleteSecretAtPath('devices/x')).resolves.toBe(true)
    expect(deleteSpy.mock.calls).toEqual([['devices/x', { prefixUrl: prefix('secret/metadata/') }]])
    expect(getSpy).toHaveBeenCalledTimes(1)
    expect(errorSpy).not.toHaveBeenCalled()
  })
})

describe('secrets_path with more than one data segment', () => {
  afterEach(() => {
    Environment.Config = config
  })

  it('should warn once with the derived metadata path', () => {
    Environment.Config = { ...config, secrets_path: 'secret/data/rps/data/' }
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as any)
    new VaultService(logger)
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('secret/data/rps/metadata/'))
  })

  it.each([
    ['secret/data/'],
    ['secret/data'],
    ['kv/']
  ])('should not warn for secrets_path %j', (secretsPath) => {
    Environment.Config = { ...config, secrets_path: secretsPath }
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as any)
    new VaultService(logger)
    expect(warnSpy).not.toHaveBeenCalled()
  })
})

describe('secret metadata path', () => {
  let patchSpy: MockInstance
  let deleteSpy: MockInstance

  beforeEach(() => {
    vi.spyOn(secretManagerService.gotClient, 'post').mockImplementation(
      () => ({ json: vi.fn(async () => await Promise.resolve(secretCert)) }) as any
    )
    patchSpy = vi
      .spyOn(secretManagerService.gotClient, 'patch')
      .mockImplementation(() => ({ json: vi.fn(async () => await Promise.resolve({})) }) as any)
    deleteSpy = vi
      .spyOn(secretManagerService.gotClient, 'delete')
      .mockImplementation(() => ({ json: vi.fn(async () => await Promise.resolve({})) }) as any)
    vi.spyOn(secretManagerService.gotClient, 'get').mockImplementation(
      () => ({ json: vi.fn(async () => await Promise.reject(makeHttpError(404))) }) as any
    )
    vi.spyOn(secretManagerService.logger, 'warn').mockImplementation(() => undefined as any)
  })

  afterEach(() => {
    Environment.Config = config
  })

  it('should patch and delete under the metadata mapped from the last data segment', async () => {
    Environment.Config = { ...config, secrets_path: 'team/data/data/' }
    const prefixUrl = `${Environment.Config.vault_address}/v1/team/data/metadata/`
    await secretManagerService.writeSecretWithObject('devices/x', secretCert, { hostname: 'h1' })
    expect(patchSpy).toHaveBeenCalledWith('devices/x', expect.objectContaining({ prefixUrl }))
    await expect(secretManagerService.deleteSecretAtPath('devices/x')).resolves.toBe(true)
    expect(deleteSpy).toHaveBeenCalledWith('devices/x', { prefixUrl })
  })

  it('should delete at secrets_path and not patch for a KV v1 path', async () => {
    Environment.Config = { ...config, secrets_path: 'kv/' }
    await secretManagerService.writeSecretWithObject('devices/x', secretCert, { hostname: 'h1' })
    expect(patchSpy).not.toHaveBeenCalled()
    await expect(secretManagerService.deleteSecretAtPath('devices/x')).resolves.toBe(true)
    expect(deleteSpy).toHaveBeenCalledWith('devices/x', { prefixUrl: `${Environment.Config.vault_address}/v1/kv/` })
  })

  it('should delete under the metadata path for the default KV v2 path', async () => {
    Environment.Config = { ...config, secrets_path: 'secret/data/' }
    await secretManagerService.deleteSecretAtPath('devices/x')
    expect(deleteSpy).toHaveBeenCalledWith('devices/x', {
      prefixUrl: `${Environment.Config.vault_address}/v1/secret/metadata/`
    })
  })
})

it('should get health of vault', async () => {
  const data = {
    initialized: true,
    sealed: false,
    standby: false,
    performance_standby: false,
    replication_performance_mode: 'disabled',
    replication_dr_mode: 'disabled',
    server_time_utc: 1638201913,
    version: '1.8.5',
    cluster_name: 'vault-cluster-426a5cd4',
    cluster_id: '3f02d0f2-4048-cdcd-7e4d-7d2905c52995'
  }
  const gotHealthSpy = vi.spyOn(secretManagerService.gotClient, 'get').mockImplementation(
    () =>
      ({
        json: vi.fn(() => data)
      }) as any
  )
  const result = await secretManagerService.health()
  expect(result).toEqual(data)
  expect(gotHealthSpy).toHaveBeenCalledWith('sys/health?standbyok=true', {
    prefixUrl: `${Environment.Config.vault_address}/v1/`
  })
})
