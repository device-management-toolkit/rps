/*********************************************************************
 * Copyright (c) Intel Corporation 2025
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import PostgresDb from '../index.js'
import { API_UNEXPECTED_EXCEPTION } from '../../../utils/constants.js'
import { type ProfileProxyConfigs } from '../../../models/RCS.Config.js'
import { ProfileProxyConfigsTable } from './profileProxyConfigs.js'
import { jest } from '@jest/globals'
import { type SpyInstance, spyOn } from 'jest-mock'

describe('profileproxyconfig tests', () => {
  let db: PostgresDb
  let profilesProxyConfigsTable: ProfileProxyConfigsTable
  let querySpy: SpyInstance<any>
  const proxyConfigs: ProfileProxyConfigs[] = [
    { profileName: 'proxyConfig', priority: 1 } as any
  ]
  const profileName = 'profileName'
  const tenantId = 'tenantId'

  beforeEach(() => {
    db = new PostgresDb('')
    profilesProxyConfigsTable = new ProfileProxyConfigsTable(db)
    querySpy = spyOn(profilesProxyConfigsTable.db, 'query')
  })
  afterEach(() => {
    jest.clearAllMocks()
  })
  describe('Get', () => {
    test('should Get', async () => {
      querySpy.mockResolvedValueOnce({ rows: [{}], rowCount: 1 })
      const result = await profilesProxyConfigsTable.getProfileProxyConfigs(profileName)
      expect(result).toStrictEqual([{}])
      expect(querySpy).toBeCalledTimes(1)
      expect(querySpy).toBeCalledWith(
        `
    SELECT 
      priority as "priority",
      proxy_config_name as "profileName"
    FROM profiles_proxyconfigs
    WHERE profile_name = $1 and tenant_id = $2
    ORDER BY priority`,
        [profileName, '']
      )
    })
  })
  describe('Delete', () => {
    test('should Delete', async () => {
      querySpy.mockResolvedValueOnce({ rows: [{}], rowCount: 1 })
      const result = await profilesProxyConfigsTable.deleteProfileProxyConfigs(profileName)
      expect(result).toBe(true)
      expect(querySpy).toBeCalledTimes(1)
      expect(querySpy).toBeCalledWith(
        `
    DELETE
    FROM profiles_proxyconfigs
    WHERE profile_name = $1 and tenant_id = $2`,
        [profileName, '']
      )
    })
    test('should Delete with tenandId', async () => {
      querySpy.mockResolvedValueOnce({ rows: [{}], rowCount: 1 })
      const result = await profilesProxyConfigsTable.deleteProfileProxyConfigs(profileName, tenantId)
      expect(result).toBe(true)
      expect(querySpy).toBeCalledTimes(1)
      expect(querySpy).toBeCalledWith(
        `
    DELETE
    FROM profiles_proxyconfigs
    WHERE profile_name = $1 and tenant_id = $2`,
        [profileName, tenantId]
      )
    })
  })
  describe('Insert', () => {
    test('should Insert', async () => {
      querySpy.mockResolvedValueOnce({ rows: [{}], rowCount: 1 })
      const result = await profilesProxyConfigsTable.createProfileProxyConfigs(proxyConfigs, profileName)
      expect(result).toBe(true)
      expect(querySpy).toBeCalledTimes(1)
      expect(querySpy).toBeCalledWith(`
      INSERT INTO
      profiles_proxyconfigs (proxy_config_name, profile_name, priority, tenant_id)
      VALUES ('proxyConfig', 'profileName', '1', '')`)
    })
    test('should NOT insert when no proxyconfigs', async () => {
      await expect(profilesProxyConfigsTable.createProfileProxyConfigs([], profileName)).rejects.toThrow(
        'Operation failed: profileName'
      )
    })
    test('should NOT insert when constraint violation', async () => {
      querySpy.mockRejectedValueOnce({ code: '23503', detail: 'error' })
      await expect(profilesProxyConfigsTable.createProfileProxyConfigs(proxyConfigs, profileName)).rejects.toThrow(
        'error'
      )
    })
    test('should NOT insert when unknown error', async () => {
      querySpy.mockRejectedValueOnce('unknown')
      await expect(profilesProxyConfigsTable.createProfileProxyConfigs(proxyConfigs, profileName)).rejects.toThrow(
        API_UNEXPECTED_EXCEPTION(profileName)
      )
    })
  })
})
