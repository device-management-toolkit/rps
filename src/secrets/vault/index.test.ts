/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { VaultService, assertSafeSecretPath } from './index.js'
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

describe('assertSafeSecretPath', () => {
  it.each([
    'devices/../profiles/default',
    'devices/../certs/acm-domain',
    'devices/..%2fprofiles%2fdefault',
    'devices\\abc',
    '/v1/secret/data/profiles/default'
  ])('should reject %s', (path) => {
    expect(() => assertSafeSecretPath(path)).toThrow(`invalid secret path: ${path}`)
  })

  // the REST validators accept these characters in profile names, so existing secrets must resolve
  it.each([
    'devices/4bac9510-04a6-4321-bae2-d45ddf07b684',
    'profiles/corp-fleet-ccm',
    'profiles/corp#fleet',
    'profiles/corp?fleet',
    'profiles/100%',
    'profiles/corp%20fleet',
    'certs/acm-domain',
    'sys/health'
  ])('should allow %s', (path) => {
    expect(() => assertSafeSecretPath(path)).not.toThrow()
  })

  it('should reject a malformed path passed to the secret provider', async () => {
    await expect(secretManagerService.getSecretAtPath('devices/../profiles/default')).rejects.toThrow(
      'invalid secret path'
    )
    await expect(secretManagerService.deleteSecretAtPath('devices/../certs/acm-domain')).rejects.toThrow(
      'invalid secret path'
    )
  })
})
