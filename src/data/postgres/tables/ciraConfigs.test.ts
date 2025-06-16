/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { CiraConfigTable } from './ciraConfigs.js'
import { type CIRAConfig } from '../../../models/RCS.Config.js'
import PostgresDb from '../index.js'
import { API_UNEXPECTED_EXCEPTION, CONCURRENCY_MESSAGE, DEFAULT_SKIP, DEFAULT_TOP } from '../../../utils/constants.js'
import { jest } from '@jest/globals'
import { spyOn } from 'jest-mock'

describe('ciraconfig tests', () => {
  let db: PostgresDb
  let ciraConfigTable: CiraConfigTable
  let querySpy: jest.Spied<any>
  let ciraConfig: CIRAConfig
  const configName = 'configName'

  beforeEach(() => {
    ciraConfig = {
      configName: 'test config',
      mpsServerAddress: '192.168.1.111',
      mpsPort: 1234,
      username: 'admin',
      password: 'qwerty',
      commonName: 'The Test Config',
      serverAddressFormat: 3,
      authMethod: 2,
      mpsRootCertificate: 'enabled',
      proxyDetails: 'details',
      tenantId: null as any
    }
    db = new PostgresDb('')
    ciraConfigTable = new CiraConfigTable(db)
    querySpy = spyOn(ciraConfigTable.db, 'query')
  })
  afterEach(() => {
    jest.clearAllMocks()
  })
  describe('Get', () => {
    test('should get an empty array when no CIRAConfigs', async () => {
      querySpy.mockResolvedValueOnce({ rows: [], command: '', fields: null, rowCount: 0, oid: 0 })
      const ciraConfig: CIRAConfig[] = await ciraConfigTable.get()
      expect(ciraConfig.length).toBe(0)
      expect(querySpy).toHaveBeenCalledTimes(1)
      expect(querySpy).toHaveBeenCalledWith(
        `SELECT 
      cira_config_name as "configName", 
      mps_server_address as "mpsServerAddress", 
      mps_port as "mpsPort", 
      user_name as "username", 
      password as "password", 
      common_name as "commonName", 
      server_address_format as "serverAddressFormat", 
      auth_method as "authMethod", 
      mps_root_certificate as "mpsRootCertificate", 
      proxydetails as "proxyDetails", 
      tenant_id  as "tenantId",
      xmin as "version"
    FROM ciraconfigs 
    WHERE tenant_id = $3
    ORDER BY cira_config_name 
    LIMIT $1 OFFSET $2`,
        [
          DEFAULT_TOP,
          DEFAULT_SKIP,
          ''
        ]
      )
    })

    test('should get null for non existant getByName', async () => {
      querySpy.mockResolvedValueOnce({ rows: [], command: '', fields: null, rowCount: 0, oid: 0 })
      const config: CIRAConfig = (await ciraConfigTable.getByName(configName)) as any
      expect(config).toBeNull()
    })

    test('should get expected count', async () => {
      const expected = 10
      querySpy.mockResolvedValueOnce({
        rows: [{ total_count: expected }],
        command: '',
        fields: null,
        rowCount: expected,
        oid: 0
      })
      const count: number = await ciraConfigTable.getCount()
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
      const count: number = await ciraConfigTable.getCount()
      expect(count).toBe(0)
    })
    test('should get count of 0 on empty rows array', async () => {
      const expected = 0
      querySpy.mockResolvedValueOnce({ rows: [], command: '', fields: null, rowCount: expected, oid: 0 })
      const count: number = await ciraConfigTable.getCount()
      expect(count).toBe(expected)
    })
    test('should get count of 0 on rows property missing', async () => {
      querySpy.mockResolvedValueOnce({})
      const count: number = await ciraConfigTable.getCount()
      expect(count).toBe(0)
    })
    test('should get count of 0 on null results', async () => {
      querySpy.mockResolvedValueOnce(null)
      const count: number = await ciraConfigTable.getCount()
      expect(count).toBe(0)
    })

    test('should get a ciraconfig by hostname when exist', async () => {
      querySpy.mockResolvedValueOnce({ rows: [ciraConfig], command: '', fields: null, rowCount: 1, oid: 0 })
      const result: CIRAConfig = (await ciraConfigTable.getByName(configName)) as any
      expect(result).toBe(ciraConfig)
      expect(querySpy).toHaveBeenCalledTimes(1)
      expect(querySpy).toHaveBeenCalledWith(
        `
    SELECT 
      cira_config_name as "configName", 
      mps_server_address as "mpsServerAddress", 
      mps_port as "mpsPort", 
      user_name as "username", 
      password as "password", 
      common_name as "commonName", 
      server_address_format as "serverAddressFormat", 
      auth_method as "authMethod", 
      mps_root_certificate as "mpsRootCertificate", 
      proxydetails as "proxyDetails", 
      tenant_id as "tenantId",
      xmin as "version"
    FROM ciraconfigs 
    WHERE cira_config_name = $1 and tenant_id = $2`,
        [configName, '']
      )
    })
  })
  describe('Insert', () => {
    test('should return ciraconfig when successfully inserted', async () => {
      const getByName = spyOn(ciraConfigTable, 'getByName')
      querySpy.mockResolvedValueOnce({ rows: [{ ciraConfig }], command: '', fields: null, rowCount: 1, oid: 0 })
      getByName.mockResolvedValueOnce(ciraConfig)
      const result = await ciraConfigTable.insert(ciraConfig)
      expect(querySpy).toHaveBeenCalledTimes(1)
      expect(querySpy).toHaveBeenCalledWith(
        `INSERT INTO ciraconfigs(cira_config_name, mps_server_address, mps_port, user_name, password, common_name, server_address_format, auth_method, mps_root_certificate, proxydetails, tenant_id)
        values($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          ciraConfig.configName,
          ciraConfig.mpsServerAddress,
          ciraConfig.mpsPort,
          ciraConfig.username,
          ciraConfig.password,
          ciraConfig.commonName,
          ciraConfig.serverAddressFormat,
          ciraConfig.authMethod,
          ciraConfig.mpsRootCertificate,
          ciraConfig.proxyDetails,
          ciraConfig.tenantId
        ]
      )
      expect(getByName).toHaveBeenCalledTimes(1)
      expect(result).toBe(ciraConfig)
    })

    test('should return null when insert failed', async () => {
      const getByName = spyOn(ciraConfigTable, 'getByName')
      querySpy.mockResolvedValueOnce({ rows: [{ ciraConfig }], command: '', fields: null, rowCount: 0, oid: 0 })
      getByName.mockResolvedValueOnce(ciraConfig)
      const result = await ciraConfigTable.insert(ciraConfig)
      expect(querySpy).toHaveBeenCalledTimes(1)
      expect(querySpy).toHaveBeenCalledWith(
        `INSERT INTO ciraconfigs(cira_config_name, mps_server_address, mps_port, user_name, password, common_name, server_address_format, auth_method, mps_root_certificate, proxydetails, tenant_id)
        values($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          ciraConfig.configName,
          ciraConfig.mpsServerAddress,
          ciraConfig.mpsPort,
          ciraConfig.username,
          ciraConfig.password,
          ciraConfig.commonName,
          ciraConfig.serverAddressFormat,
          ciraConfig.authMethod,
          ciraConfig.mpsRootCertificate,
          ciraConfig.proxyDetails,
          ciraConfig.tenantId
        ]
      )
      expect(getByName).toHaveBeenCalledTimes(0)
      expect(result).toBe(null)
    })

    test('should NOT insert when duplicate name', async () => {
      querySpy.mockRejectedValueOnce({ code: '23505' })
      await expect(ciraConfigTable.insert(ciraConfig)).rejects.toThrow('CIRA Config test config already exists.')
    })

    test('should NOT insert when unexpected exception', async () => {
      querySpy.mockRejectedValueOnce(new Error('unknown'))
      await expect(ciraConfigTable.insert(ciraConfig)).rejects.toThrow('Operation failed: test config')
    })
  })
  describe('Delete', () => {
    test('Should get false when ciraconfig deleted', async () => {
      querySpy.mockResolvedValueOnce({ rows: [], command: '', fields: null, rowCount: 0, oid: 0 })
      const isDeleted: boolean = await ciraConfigTable.delete(configName)
      expect(isDeleted).toBe(false)
      expect(querySpy).toHaveBeenCalledTimes(1)
      expect(querySpy).toHaveBeenCalledWith(
        `
      DELETE FROM ciraconfigs 
      WHERE cira_config_name = $1 AND tenant_id = $2`,
        [configName, '']
      )
    })
    test('should NOT delete when constraint violation', async () => {
      querySpy.mockRejectedValueOnce({ code: '23503' })
      await expect(ciraConfigTable.delete(ciraConfig.configName, '')).rejects.toThrow(
        'CIRA Config: test config is associated with an AMT profile'
      )
    })

    test('should NOT delete when unexpected exception', async () => {
      querySpy.mockRejectedValueOnce(new Error('unknown'))
      await expect(ciraConfigTable.delete(ciraConfig.configName, '')).rejects.toThrow(
        'Operation failed: Delete CIRA config : test config'
      )
    })
  })
  describe('Update', () => {
    test('should update ciraconfig', async () => {
      querySpy.mockResolvedValueOnce({ rows: [{ ciraConfig }], command: '', fields: null, rowCount: 1, oid: 0 })
      const getByName = spyOn(ciraConfigTable, 'getByName')
      getByName.mockResolvedValueOnce(ciraConfig)
      const result = await ciraConfigTable.update(ciraConfig)
      expect(querySpy).toHaveBeenCalledTimes(1)
      expect(querySpy).toHaveBeenCalledWith(
        `
      UPDATE ciraconfigs 
      SET mps_server_address=$2, mps_port=$3, user_name=$4, password=$5, common_name=$6, server_address_format=$7, auth_method=$8, mps_root_certificate=$9, proxydetails=$10 
      WHERE cira_config_name=$1 and tenant_id = $11 and xmin = $12`,
        [
          ciraConfig.configName,
          ciraConfig.mpsServerAddress,
          ciraConfig.mpsPort,
          ciraConfig.username,
          ciraConfig.password,
          ciraConfig.commonName,
          ciraConfig.serverAddressFormat,
          ciraConfig.authMethod,
          ciraConfig.mpsRootCertificate,
          ciraConfig.proxyDetails,
          ciraConfig.tenantId,
          ciraConfig.version
        ]
      )
      expect(getByName).toHaveBeenCalledTimes(1)
      expect(result).toBe(ciraConfig)
    })
    test('should NOT update when concurrency issue', async () => {
      querySpy.mockResolvedValueOnce({ rows: [], command: '', fields: null, rowCount: 0, oid: 0 })
      const getByName = spyOn(ciraConfigTable, 'getByName')
      getByName.mockResolvedValueOnce(ciraConfig)
      await expect(ciraConfigTable.update(ciraConfig)).rejects.toThrow(CONCURRENCY_MESSAGE)
    })

    test('should NOT update when unexpected exception', async () => {
      querySpy.mockRejectedValueOnce(new Error('unknown'))
      await expect(ciraConfigTable.update(ciraConfig)).rejects.toThrow(API_UNEXPECTED_EXCEPTION(ciraConfig.configName))
    })
  })
})
