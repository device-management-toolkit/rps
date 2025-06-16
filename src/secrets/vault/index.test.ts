/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { VaultService } from './index.js'
import Logger from '../../Logger.js'
import { type ILogger } from '../../interfaces/ILogger.js'
import { config } from '../../test/helper/Config.js'
import { Environment } from '../../utils/Environment.js'
import { type DeviceCredentials } from '../../interfaces/ISecretManagerService.js'
import { jest } from '@jest/globals'
import { spyOn } from 'jest-mock'

let secretManagerService: VaultService = null as any
Environment.Config = config
let gotSpy: jest.Spied<any>
let gotFailSpy: jest.Spied<any>
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
  gotSpy = spyOn(secretManagerService.gotClient, 'get').mockImplementation(
    () =>
      ({
        json: jest.fn(() => ({ data: { data: secretCreds, metadata: { version: 1 } } }))
      }) as any
  )
})

afterEach(() => {
  jest.clearAllMocks()
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
  gotFailSpy = spyOn(secretManagerService.gotClient, 'get')
  gotFailSpy.mockResolvedValue({
    json: jest.fn(async () => await Promise.reject(new Error('Not Found')))
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

it('should throw an exception and return null if given path does not exist', async () => {
  gotFailSpy = spyOn(secretManagerService.gotClient, 'get')
  gotFailSpy.mockResolvedValue({
    json: jest.fn(async () => await Promise.reject(new Error('Not Found')))
  })
  const result = await secretManagerService.getSecretAtPath('does/not/exist')
  expect(result).toEqual(null)
  expect(gotFailSpy).toHaveBeenCalledWith('does/not/exist')
})

it('should create a secret', async () => {
  const gotPostSpy = spyOn(secretManagerService.gotClient, 'post').mockImplementation(
    () => ({ json: jest.fn(async () => await Promise.resolve(secretCert)) }) as any
  )
  const result = await secretManagerService.writeSecretWithObject('test', secretCert)
  expect(result).toEqual(secretCert)
  expect(gotPostSpy).toHaveBeenCalledWith('test', { json: { data: secretCert } })
})

it('should return false if the path does not exist', async () => {
  const badPath = 'does/not/exist'
  gotFailSpy = spyOn(secretManagerService.gotClient, 'post')
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
  const gotHealthSpy = spyOn(secretManagerService.gotClient, 'get').mockImplementation(
    () =>
      ({
        json: jest.fn(() => data)
      }) as any
  )
  const result = await secretManagerService.health()
  expect(result).toEqual(data)
  expect(gotHealthSpy).toHaveBeenCalledWith('sys/health?standbyok=true', {
    prefixUrl: `${Environment.Config.vault_address}/v1/`
  })
})
