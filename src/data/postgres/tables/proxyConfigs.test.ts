/*********************************************************************
 * Copyright (c) Intel Corporation 2025
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import PostgresDb from '../index.js'
import { type ProxyConfig } from '../../../models/RCS.Config.js'
import {
  API_UNEXPECTED_EXCEPTION,
  CONCURRENCY_MESSAGE,
  DEFAULT_SKIP,
  DEFAULT_TOP,
  NETWORK_CONFIG_DELETION_FAILED_CONSTRAINT,
  NETWORK_CONFIG_ERROR,
  NETWORK_CONFIG_INSERTION_FAILED_DUPLICATE
} from '../../../utils/constants.js'
import { ProxyConfigsTable } from './proxyConfigs.js'
import { RPSError } from '../../../utils/RPSError.js'
import { jest } from '@jest/globals'
import { type SpyInstance, spyOn } from 'jest-mock'

describe('proxy configs tests', () => {
  let db: PostgresDb
  let proxyConfigsTable: ProxyConfigsTable
  let querySpy: SpyInstance<any>
  let proxyConfig: ProxyConfig
  const profileName = 'proxyName'
  beforeEach(() => {
    proxyConfig = {
      proxyName: 'proxy profile',
      accessInfo: 'proxy.com',
      infoFormat: 201, // FQDN (201)
      port: 1000,
      networkDnsSuffix: 'suffix',
      tenantId: ''
    }
    db = new PostgresDb('')
    proxyConfigsTable = new ProxyConfigsTable(db)
    querySpy = spyOn(proxyConfigsTable.db, 'query')
  })
  afterEach(() => {
    jest.clearAllMocks()
  })
  describe('Get', () => {
    test('should get expected count', async () => {
      const expected = 10
      querySpy.mockResolvedValueOnce({
        rows: [{ total_count: expected }],
        command: '',
        fields: null,
        rowCount: expected,
        oid: 0
      })
      const count: number = await proxyConfigsTable.getCount()
      expect(count).toBe(expected)
    })
    test('should get count of 0 on no counts made', async () => {
      const expected = 0
      querySpy.mockResolvedValueOnce({
        rows: [{ total_count: expected }],
        command: '',
        fields: null,
        rowCount: expected,
        oid: 0
      })
      const count: number = await proxyConfigsTable.getCount()
      expect(count).toBe(0)
    })
    test('should get count of 0 on empty rows array', async () => {
      const expected = 0
      querySpy.mockResolvedValueOnce({
        rows: [],
        command: '',
        fields: null,
        rowCount: expected,
        oid: 0
      })
      const count: number = await proxyConfigsTable.getCount()
      expect(count).toBe(expected)
    })
    test('should get count of 0 on no rows returned', async () => {
      querySpy.mockResolvedValueOnce({})
      const count: number = await proxyConfigsTable.getCount()
      expect(count).toBe(0)
    })
    test('should get count of 0 on null results', async () => {
      querySpy.mockResolvedValueOnce(null)
      const count: number = await proxyConfigsTable.getCount()
      expect(count).toBe(0)
    })

    test('should Get', async () => {
      querySpy.mockResolvedValueOnce({ rows: [{}], rowCount: 1 })
      const result = await proxyConfigsTable.get()
      expect(result).toStrictEqual([{}])
      expect(querySpy).toBeCalledTimes(1)
      expect(querySpy).toBeCalledWith(
        `
    SELECT
      proxy_config_name as "proxyName",
      access_info as "accessInfo",
      info_format as "infoFormat",
      port as "port",
      network_dns_suffix as "networkDnsSuffix",
      tenant_id as "tenantId"
    FROM proxyconfigs 
    WHERE tenant_id = $3
    ORDER BY proxy_config_name 
    LIMIT $1 OFFSET $2`,
        [
          DEFAULT_TOP,
          DEFAULT_SKIP,
          ''
        ]
      )
    })
    test('should get by name', async () => {
      const rows = [{}]
      querySpy.mockResolvedValueOnce({ rows: [{}], rowCount: rows.length })
      const result = await proxyConfigsTable.getByName(profileName)
      expect(result).toStrictEqual(rows[0])
      expect(querySpy).toBeCalledTimes(1)
      expect(querySpy).toBeCalledWith(
        `
    SELECT
      proxy_config_name as "proxyName",
      access_info as "accessInfo",
      info_format as "infoFormat",
      port as "port",
      network_dns_suffix as "networkDnsSuffix",
      tenant_id as "tenantId"
    FROM proxyconfigs 
    WHERE proxy_config_name = $1 and tenant_id = $2`,
        [profileName, '']
      )
    })
    test('should NOT get by name when no profiles exists', async () => {
      querySpy.mockResolvedValueOnce({ rows: [], rowCount: 0 })
      const result = await proxyConfigsTable.getByName(profileName)
      expect(result).toBeNull()
    })
    test('should check profile exist', async () => {
      querySpy.mockResolvedValueOnce({ rows: [], rowCount: 0 })
      const result = await proxyConfigsTable.checkProfileExits(profileName)
      expect(querySpy).toBeCalledTimes(1)
      expect(querySpy).toBeCalledWith(
        `
    SELECT 1
    FROM proxyconfigs 
    WHERE proxy_config_name = $1 and tenant_id = $2`,
        [profileName, '']
      )
      expect(result).toBe(false)
    })
  })
  describe('Delete', () => {
    test('should delete', async () => {
      let count = 0
      querySpy.mockImplementation(() => ({ rows: [], rowCount: count++ }))
      const result = await proxyConfigsTable.delete(profileName)
      expect(result).toBeTruthy()
      expect(querySpy).toBeCalledTimes(2)
      expect(querySpy).toHaveBeenNthCalledWith(
        1,
        `
    SELECT 1
    FROM profiles_proxyconfigs
    WHERE proxy_config_name = $1 and tenant_id = $2`,
        [profileName, '']
      )
      expect(querySpy).toHaveBeenNthCalledWith(
        2,
        `
      DELETE
      FROM proxyconfigs
      WHERE proxy_config_name = $1 and tenant_id = $2`,
        [profileName, '']
      )
    })
    test('should NOT delete when relationship still exists to profile', async () => {
      querySpy.mockResolvedValueOnce({ rows: [], rowCount: 1 })
      await expect(proxyConfigsTable.delete(profileName)).rejects.toThrow(
        NETWORK_CONFIG_DELETION_FAILED_CONSTRAINT('Proxy', profileName)
      )
      expect(querySpy).toBeCalledTimes(1)
      expect(querySpy).toBeCalledWith(
        `
    SELECT 1
    FROM profiles_proxyconfigs
    WHERE proxy_config_name = $1 and tenant_id = $2`,
        [profileName, '']
      )
    })
    test('should NOT delete when constraint violation', async () => {
      let count = 0
      querySpy.mockImplementation(() => {
        if (count === 0) {
          return { rows: [], rowCount: count++ }
        }
        const err = new Error('foreign key violation')
        ;(err as any).code = '23503'
        throw err
      })
      await expect(proxyConfigsTable.delete(profileName)).rejects.toThrow(
        NETWORK_CONFIG_DELETION_FAILED_CONSTRAINT('Proxy', profileName)
      )
    })
    test('should NOT delete when unknown error', async () => {
      let count = 0
      querySpy.mockImplementation(() => {
        if (count === 0) {
          return { rows: [], rowCount: count++ }
        }
        throw new Error('unknown')
      })
      await expect(proxyConfigsTable.delete(profileName)).rejects.toThrow(
        API_UNEXPECTED_EXCEPTION(`Delete proxy configuration : ${profileName}`)
      )
    })
  })
  describe('Insert', () => {
    test('should insert', async () => {
      querySpy.mockResolvedValueOnce({ rows: [], rowCount: 1 })
      const getByNameSpy = spyOn(proxyConfigsTable, 'getByName')
      getByNameSpy.mockResolvedValue(proxyConfig)
      const result = await proxyConfigsTable.insert(proxyConfig)

      expect(result).toBe(proxyConfig)
      expect(getByNameSpy).toHaveBeenCalledWith(proxyConfig.proxyName, proxyConfig.tenantId)
      expect(querySpy).toBeCalledTimes(1)
      expect(querySpy).toBeCalledWith(
        `
        INSERT INTO proxyconfigs
        (proxy_config_name, access_info, info_format, port, network_dns_suffix, creation_date, tenant_id)
        values($1, $2, $3, $4, $5, $6, $7)`,
        [
          proxyConfig.proxyName,
          proxyConfig.accessInfo,
          proxyConfig.infoFormat,
          proxyConfig.port,
          proxyConfig.networkDnsSuffix,
          new Date().toISOString().replace(/T/, ' ').replace(/\..+/, ''),
          proxyConfig.tenantId
        ]
      )
    })
    test('should return null if insert does not return any rows (should throw an error though)', async () => {
      querySpy.mockResolvedValueOnce({ rows: [], rowCount: 0 })
      let result = await proxyConfigsTable.insert(proxyConfig)
      expect(result).toBeNull()

      querySpy.mockResolvedValueOnce(null)
      result = await proxyConfigsTable.insert(proxyConfig)
      expect(result).toBeNull()
    })
    test('should NOT insert when duplicate name', async () => {
      querySpy.mockRejectedValueOnce({ code: '23505' })
      await expect(proxyConfigsTable.insert(proxyConfig)).rejects.toThrow(
        NETWORK_CONFIG_INSERTION_FAILED_DUPLICATE('Proxy', proxyConfig.proxyName)
      )
    })
    test('should NOT insert when unexpected exception', async () => {
      querySpy.mockRejectedValueOnce(new Error('unknown'))
      await expect(proxyConfigsTable.insert(proxyConfig)).rejects.toThrow(
        NETWORK_CONFIG_ERROR('Proxy', proxyConfig.proxyName)
      )
    })
  })
  describe('Update', () => {
    test('should Update', async () => {
      querySpy.mockResolvedValueOnce({ rows: [{}], rowCount: 1 })
      const getByNameSpy = spyOn(proxyConfigsTable, 'getByName')
      getByNameSpy.mockResolvedValue(proxyConfig)
      const result = await proxyConfigsTable.update(proxyConfig)
      expect(result).toBe(proxyConfig)
      expect(getByNameSpy).toHaveBeenCalledWith(proxyConfig.proxyName, proxyConfig.tenantId)
      expect(querySpy).toBeCalledTimes(1)
      expect(querySpy).toBeCalledWith(
        `
      UPDATE proxyconfigs 
      SET access_info=$2, info_format=$3, port=$4, network_dns_suffix=$5 
      WHERE proxy_config_name=$1 and tenant_id = $6`,
        [
          proxyConfig.proxyName,
          proxyConfig.accessInfo,
          proxyConfig.infoFormat,
          proxyConfig.port,
          proxyConfig.networkDnsSuffix,
          proxyConfig.tenantId
        ]
      )
    })
    test('should throw RPSError with no results from update query', async () => {
      querySpy.mockResolvedValueOnce({ rows: [], rowCount: 0 })
      const getByNameSpy = spyOn(proxyConfigsTable, 'getByName')
      getByNameSpy.mockResolvedValue(proxyConfig)
      await expect(proxyConfigsTable.update(proxyConfig)).rejects.toBeInstanceOf(RPSError)
    })
    test('should throw RPSError with return from update query', async () => {
      querySpy.mockResolvedValueOnce(null)
      const getByNameSpy = spyOn(proxyConfigsTable, 'getByName')
      getByNameSpy.mockResolvedValue(proxyConfig)
      await expect(proxyConfigsTable.update(proxyConfig)).rejects.toBeInstanceOf(RPSError)
    })
    test('should NOT update when unexpected error', async () => {
      querySpy.mockRejectedValueOnce('unknown')
      const getByNameSpy = spyOn(proxyConfigsTable, 'getByName')
      getByNameSpy.mockResolvedValue(proxyConfig)
      await expect(proxyConfigsTable.update(proxyConfig)).rejects.toThrow(
        NETWORK_CONFIG_ERROR('Proxy', proxyConfig.proxyName)
      )
    })

    test('should NOT update when concurrency issue', async () => {
      querySpy.mockResolvedValueOnce({ rows: [], rowCount: 0 })
      const getByNameSpy = spyOn(proxyConfigsTable, 'getByName')
      getByNameSpy.mockResolvedValue(proxyConfig)
      await expect(proxyConfigsTable.update(proxyConfig)).rejects.toThrow(CONCURRENCY_MESSAGE)
      expect(getByNameSpy).toHaveBeenCalledWith(proxyConfig.proxyName, proxyConfig.tenantId)
      expect(querySpy).toBeCalledTimes(1)
      expect(querySpy).toBeCalledWith(
        `
      UPDATE proxyconfigs 
      SET access_info=$2, info_format=$3, port=$4, network_dns_suffix=$5 
      WHERE proxy_config_name=$1 and tenant_id = $6`,
        [
          proxyConfig.proxyName,
          proxyConfig.accessInfo,
          proxyConfig.infoFormat,
          proxyConfig.port,
          proxyConfig.networkDnsSuffix,
          proxyConfig.tenantId
        ]
      )
    })
  })
})
