/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import PostgresDb from '../index.js'
import { API_UNEXPECTED_EXCEPTION } from '../../../utils/constants.js'
import { type ProfileWifiConfigs } from '../../../models/RCS.Config.js'
import { ProfilesWifiConfigsTable } from './profileWifiConfigs.js'
import { jest } from '@jest/globals'
import { spyOn } from 'jest-mock'

describe('profilewificonfig tests', () => {
  let db: PostgresDb
  let profilesWifiConfigsTable: ProfilesWifiConfigsTable
  let querySpy: jest.Spied<any>
  const wifiConfigs: ProfileWifiConfigs[] = [{ profileName: 'wirelessConfig', priority: 1 } as any]
  const profileName = 'profileName'
  const tenantId = 'tenantId'

  beforeEach(() => {
    db = new PostgresDb('')
    profilesWifiConfigsTable = new ProfilesWifiConfigsTable(db)
    querySpy = spyOn(profilesWifiConfigsTable.db, 'query')
  })
  afterEach(() => {
    jest.clearAllMocks()
  })
  describe('Get', () => {
    test('should Get', async () => {
      querySpy.mockResolvedValueOnce({ rows: [{}], rowCount: 1 })
      const result = await profilesWifiConfigsTable.getProfileWifiConfigs(profileName)
      expect(result).toStrictEqual([{}])
      expect(querySpy).toHaveBeenCalledTimes(1)
      expect(querySpy).toHaveBeenCalledWith(
        `
    SELECT 
      priority as "priority",
      wireless_profile_name as "profileName"
    FROM profiles_wirelessconfigs
    WHERE profile_name = $1 and tenant_id = $2
    ORDER BY priority`,
        [profileName, '']
      )
    })
  })
  describe('Delete', () => {
    test('should Delete', async () => {
      querySpy.mockResolvedValueOnce({ rows: [{}], rowCount: 1 })
      const result = await profilesWifiConfigsTable.deleteProfileWifiConfigs(profileName)
      expect(result).toBe(true)
      expect(querySpy).toHaveBeenCalledTimes(1)
      expect(querySpy).toHaveBeenCalledWith(
        `
    DELETE
    FROM profiles_wirelessconfigs
    WHERE profile_name = $1 and tenant_id = $2`,
        [profileName, '']
      )
    })
    test('should Delete with tenandId', async () => {
      querySpy.mockResolvedValueOnce({ rows: [{}], rowCount: 1 })
      const result = await profilesWifiConfigsTable.deleteProfileWifiConfigs(profileName, tenantId)
      expect(result).toBe(true)
      expect(querySpy).toHaveBeenCalledTimes(1)
      expect(querySpy).toHaveBeenCalledWith(
        `
    DELETE
    FROM profiles_wirelessconfigs
    WHERE profile_name = $1 and tenant_id = $2`,
        [profileName, tenantId]
      )
    })
  })
  describe('Insert', () => {
    test('should Insert', async () => {
      querySpy.mockResolvedValueOnce({ rows: [{}], rowCount: 1 })
      const result = await profilesWifiConfigsTable.createProfileWifiConfigs(wifiConfigs, profileName)
      expect(result).toBe(true)
      expect(querySpy).toHaveBeenCalledTimes(1)
      expect(querySpy).toHaveBeenCalledWith(`
      INSERT INTO
      profiles_wirelessconfigs (wireless_profile_name, profile_name, priority, tenant_id)
      VALUES ('wirelessConfig', 'profileName', '1', '')`)
    })
    test('should NOT insert when no wificonfigs', async () => {
      await expect(profilesWifiConfigsTable.createProfileWifiConfigs([], profileName)).rejects.toThrow(
        'Operation failed: profileName'
      )
    })
    test('should NOT insert when constraint violation', async () => {
      querySpy.mockRejectedValueOnce({ code: '23503', detail: 'error' })
      await expect(profilesWifiConfigsTable.createProfileWifiConfigs(wifiConfigs, profileName)).rejects.toThrow('error')
    })
    test('should NOT insert when unknown error', async () => {
      querySpy.mockRejectedValueOnce('unknown')
      await expect(profilesWifiConfigsTable.createProfileWifiConfigs(wifiConfigs, profileName)).rejects.toThrow(
        API_UNEXPECTED_EXCEPTION(profileName)
      )
    })
  })
})
