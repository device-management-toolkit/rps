/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import PostgresDb from '../index.js'
import { type AMTConfiguration, AMTUserConsent } from '../../../models/index.js'
import {
  PROFILE_INSERTION_FAILED_DUPLICATE,
  PROFILE_INSERTION_CIRA_CONSTRAINT,
  API_UNEXPECTED_EXCEPTION,
  DEFAULT_SKIP,
  DEFAULT_TOP,
  PROFILE_INSERTION_GENERIC_CONSTRAINT,
  CONCURRENCY_MESSAGE
} from '../../../utils/constants.js'
import { RPSError } from '../../../utils/RPSError.js'
import { ProfilesTable } from './profiles.js'
import { jest } from '@jest/globals'
import { type SpyInstance, spyOn } from 'jest-mock'

describe('profiles tests', () => {
  let db: PostgresDb
  let profilesTable: ProfilesTable
  let querySpy: SpyInstance<any>
  let amtConfig: AMTConfiguration
  const profileName = 'profileName'
  const tenantId = 'tenantId'
  beforeEach(() => {
    amtConfig = {
      profileName: 'profileName',
      activation: 'activation',
      amtPassword: 'amtPassword',
      generateRandomPassword: false,
      ciraConfigName: 'ciraConfigName',
      mebxPassword: 'mebxPassword',
      generateRandomMEBxPassword: false,
      tags: ['tags'],
      dhcpEnabled: true,
      ipSyncEnabled: true,
      localWifiSyncEnabled: true,
      tlsMode: null,
      tenantId: '',
      userConsent: AMTUserConsent.ALL,
      iderEnabled: true,
      kvmEnabled: true,
      solEnabled: true,
      tlsSigningAuthority: null,
      ieee8021xProfileName: null
    } as any
    db = new PostgresDb('')
    profilesTable = new ProfilesTable(db)
    querySpy = spyOn(profilesTable.db, 'query')
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
      const count: number = await profilesTable.getCount()
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
      const count: number = await profilesTable.getCount()
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
      const count: number = await profilesTable.getCount()
      expect(count).toBe(expected)
    })
    test('should get count of 0 on no rows returned', async () => {
      querySpy.mockResolvedValueOnce({})
      const count: number = await profilesTable.getCount()
      expect(count).toBe(0)
    })
    test('should get count of 0 on null results', async () => {
      querySpy.mockResolvedValueOnce(null)
      const count: number = await profilesTable.getCount()
      expect(count).toBe(0)
    })

    test('should get profiles', async () => {
      const rows = [{}, {}]
      querySpy.mockResolvedValueOnce({ rows, rowCount: rows.length })
      const result = await profilesTable.get()
      expect(result).toStrictEqual(rows)
      expect(querySpy).toBeCalledTimes(1)
      expect(querySpy).toBeCalledWith(
        `
    SELECT 
      p.profile_name as "profileName", 
      activation as "activation", 
      cira_config_name as "ciraConfigName",
      generate_random_password as "generateRandomPassword",
      generate_random_mebx_password as "generateRandomMEBxPassword",
      tags as "tags", 
      dhcp_enabled as "dhcpEnabled",
      tls_mode as "tlsMode",
      user_consent as "userConsent",
      ider_enabled as "iderEnabled",
      kvm_enabled as "kvmEnabled",
      sol_enabled as "solEnabled",
      p.tenant_id as "tenantId",
      tls_signing_authority as "tlsSigningAuthority",
      p.xmin as "version",
      ieee8021x_profile_name as "ieee8021xProfileName",
      COALESCE(json_agg(json_build_object('profileName',wc.wireless_profile_name, 'priority', wc.priority)) FILTER (WHERE wc.wireless_profile_name IS NOT NULL), '[]') AS "wifiConfigs",
      ip_sync_enabled as "ipSyncEnabled",
      local_wifi_sync_enabled as "localWifiSyncEnabled",
      COALESCE(json_agg(json_build_object('configName',pc.access_info, 'priority', pc.priority)) FILTER (WHERE pc.access_info IS NOT NULL), '[]') AS "proxyConfigs"
    FROM profiles p
    LEFT JOIN profiles_wirelessconfigs wc ON wc.profile_name = p.profile_name AND wc.tenant_id = p.tenant_id
    LEFT JOIN profiles_proxyconfigs pc ON pc.profile_name = p.profile_name AND pc.tenant_id = p.tenant_id
    WHERE p.tenant_id = $3
    GROUP BY
      p.profile_name,
      activation,
      cira_config_name,
      generate_random_password,
      generate_random_mebx_password,
      tags,
      dhcp_enabled,
      tls_mode,
      user_consent,
      ider_enabled,
      kvm_enabled,
      sol_enabled,
      tls_signing_authority,
      p.tenant_id,
      ieee8021x_profile_name,
      ip_sync_enabled,
      local_wifi_sync_enabled
    ORDER BY p.profile_name 
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
      const result = await profilesTable.getByName(profileName)
      expect(result).toStrictEqual(rows[0])
      expect(querySpy).toBeCalledTimes(1)
      expect(querySpy).toBeCalledWith(
        `
    SELECT 
      p.profile_name as "profileName",
      activation as "activation",
      cira_config_name as "ciraConfigName",
      generate_random_password as "generateRandomPassword",
      generate_random_mebx_password as "generateRandomMEBxPassword",
      tags as "tags",
      dhcp_enabled as "dhcpEnabled",
      tls_mode as "tlsMode",
      user_consent as "userConsent",
      ider_enabled as "iderEnabled",
      kvm_enabled as "kvmEnabled",
      sol_enabled as "solEnabled",
      p.tenant_id as "tenantId",
      tls_signing_authority as "tlsSigningAuthority",
      p.xmin as "version",
      ieee8021x_profile_name as "ieee8021xProfileName",
      COALESCE(json_agg(json_build_object('profileName',wc.wireless_profile_name, 'priority', wc.priority)) FILTER (WHERE wc.wireless_profile_name IS NOT NULL), '[]') AS "wifiConfigs",
      ip_sync_enabled as "ipSyncEnabled",
      local_wifi_sync_enabled as "localWifiSyncEnabled",
      COALESCE(json_agg(json_build_object('configName',pc.access_info, 'priority', pc.priority)) FILTER (WHERE pc.access_info IS NOT NULL), '[]') AS "proxyConfigs"
    FROM profiles p
    LEFT JOIN profiles_wirelessconfigs wc ON wc.profile_name = p.profile_name AND wc.tenant_id = p.tenant_id
    LEFT JOIN profiles_proxyconfigs pc ON pc.profile_name = p.profile_name AND pc.tenant_id = p.tenant_id
    WHERE p.profile_name = $1 and p.tenant_id = $2
    GROUP BY
      p.profile_name,
      activation,
      cira_config_name,
      generate_random_password,
      generate_random_mebx_password,
      tags,
      dhcp_enabled,
      tls_mode,
      user_consent,
      ider_enabled,
      kvm_enabled,
      sol_enabled,
      tls_signing_authority,
      p.tenant_id,
      ieee8021x_profile_name,
      ip_sync_enabled,
      local_wifi_sync_enabled
    `,
        [profileName, '']
      )
    })
    test('should NOT get by name when no profiles exists', async () => {
      querySpy.mockResolvedValueOnce({ rows: [], rowCount: 0 })
      const result = await profilesTable.getByName(profileName)
      expect(result).toBeNull()
    })
    test('should get ciraconfig for profile', async () => {
      const ciraConfigSpy = spyOn(db.ciraConfigs, 'getByName')
      ciraConfigSpy.mockResolvedValue({} as any)
      const result = await profilesTable.getCiraConfigForProfile(profileName, '')
      expect(result).toStrictEqual({})
      expect(ciraConfigSpy).toHaveBeenCalledWith(profileName, '')
    })
    test('should get 8021X config for profile', async () => {
      const ciraConfigSpy = spyOn(db.ieee8021xProfiles, 'getByName')
      ciraConfigSpy.mockResolvedValue({} as any)
      const result = await profilesTable.get8021XConfigForProfile(profileName, '')
      expect(result).toStrictEqual({})
      expect(ciraConfigSpy).toHaveBeenCalledWith(profileName, '')
    })
  })
  describe('Delete', () => {
    test('should delete', async () => {
      querySpy.mockResolvedValueOnce({ rows: [], rowCount: 1 })
      const wirelessConfigSpy = spyOn(db.profileWirelessConfigs, 'deleteProfileWifiConfigs')
      wirelessConfigSpy.mockResolvedValue(true)
      const profileProxyConfigsSpy = spyOn(db.profileProxyConfigs, 'deleteProfileProxyConfigs')
      profileProxyConfigsSpy.mockResolvedValue(true)
      const result = await profilesTable.delete(profileName, tenantId)
      expect(result).toBeTruthy()
      expect(wirelessConfigSpy).toHaveBeenLastCalledWith(profileName, tenantId)
      expect(profileProxyConfigsSpy).toHaveBeenLastCalledWith(profileName, tenantId)
      expect(querySpy).toBeCalledTimes(1)
      expect(querySpy).toBeCalledWith(
        `
      DELETE 
      FROM profiles 
      WHERE profile_name = $1 and tenant_id = $2`,
        [profileName, tenantId]
      )
    })
    test('should NOT delete', async () => {
      querySpy.mockResolvedValueOnce({ rows: [], rowCount: 0 })
      const wirelessConfigSpy = spyOn(db.profileWirelessConfigs, 'deleteProfileWifiConfigs')
      wirelessConfigSpy.mockResolvedValue(false)
      const profileProxyConfigsSpy = spyOn(db.profileProxyConfigs, 'deleteProfileProxyConfigs')
      profileProxyConfigsSpy.mockResolvedValue(true)
      const result = await profilesTable.delete(profileName)
      expect(result).toBe(false)
    })
    test('should NOT delete when cannot delete proxy configs', async () => {
      querySpy.mockResolvedValueOnce({ rows: [], rowCount: 0 })
      const wirelessConfigSpy = spyOn(db.profileWirelessConfigs, 'deleteProfileWifiConfigs')
      wirelessConfigSpy.mockResolvedValue(true)
      const profileProxyConfigsSpy = spyOn(db.profileProxyConfigs, 'deleteProfileProxyConfigs')
      profileProxyConfigsSpy.mockResolvedValue(false)
      const result = await profilesTable.delete(profileName)
      expect(result).toBe(false)
    })
  })
  describe('Insert', () => {
    test('should NOT insert when no rowcount', async () => {
      querySpy.mockResolvedValueOnce({ rows: [], rowCount: 0 })
      const result = await profilesTable.insert(amtConfig)
      expect(result).toBeNull()
    })
    test('should insert with wifi configs', async () => {
      querySpy.mockResolvedValueOnce({ rows: [], rowCount: 1 })
      const profileWirelessConfigsSpy = spyOn(db.profileWirelessConfigs, 'createProfileWifiConfigs')
      profileWirelessConfigsSpy.mockResolvedValue(true)

      const getByNameSpy = spyOn(profilesTable, 'getByName')
      amtConfig.wifiConfigs = [{} as any]
      getByNameSpy.mockResolvedValue(amtConfig)
      const result = await profilesTable.insert(amtConfig)

      expect(result).toBe(amtConfig)
      expect(profileWirelessConfigsSpy).toHaveBeenCalledWith(
        amtConfig.wifiConfigs,
        amtConfig.profileName,
        amtConfig.tenantId
      )

      expect(getByNameSpy).toHaveBeenCalledWith(amtConfig.profileName, amtConfig.tenantId)
      expect(querySpy).toBeCalledTimes(1)
      expect(querySpy).toBeCalledWith(
        `
        INSERT INTO profiles(
          profile_name, activation,
          amt_password, generate_random_password,
          cira_config_name,
          mebx_password, generate_random_mebx_password,
          tags, dhcp_enabled, tls_mode,
          user_consent, ider_enabled, kvm_enabled, sol_enabled,
          tenant_id, tls_signing_authority, ieee8021x_profile_name, ip_sync_enabled, local_wifi_sync_enabled)
        values($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
        [
          amtConfig.profileName,
          amtConfig.activation,
          amtConfig.amtPassword,
          amtConfig.generateRandomPassword,
          amtConfig.ciraConfigName,
          amtConfig.mebxPassword,
          amtConfig.generateRandomMEBxPassword,
          amtConfig.tags,
          amtConfig.dhcpEnabled,
          amtConfig.tlsMode,
          amtConfig.userConsent,
          amtConfig.iderEnabled,
          amtConfig.kvmEnabled,
          amtConfig.solEnabled,
          amtConfig.tenantId,
          amtConfig.tlsSigningAuthority,
          amtConfig.ieee8021xProfileName,
          amtConfig.ipSyncEnabled,
          amtConfig.localWifiSyncEnabled
        ]
      )
    })
    test('should insert without wificonfigs', async () => {
      querySpy.mockResolvedValueOnce({ rows: [], rowCount: 1 })
      const profileWirelessConfigsSpy = spyOn(db.profileWirelessConfigs, 'createProfileWifiConfigs')
      profileWirelessConfigsSpy.mockResolvedValue(true)
      const getByNameSpy = spyOn(profilesTable, 'getByName')
      getByNameSpy.mockResolvedValue(amtConfig)
      const result = await profilesTable.insert(amtConfig)

      expect(result).toBe(amtConfig)
      expect(profileWirelessConfigsSpy).not.toHaveBeenCalledWith(
        amtConfig.wifiConfigs,
        amtConfig.profileName,
        amtConfig.tenantId
      )
      expect(getByNameSpy).toHaveBeenCalledWith(amtConfig.profileName, amtConfig.tenantId)
      expect(querySpy).toBeCalledTimes(1)
      expect(querySpy).toBeCalledWith(
        `
        INSERT INTO profiles(
          profile_name, activation,
          amt_password, generate_random_password,
          cira_config_name,
          mebx_password, generate_random_mebx_password,
          tags, dhcp_enabled, tls_mode,
          user_consent, ider_enabled, kvm_enabled, sol_enabled,
          tenant_id, tls_signing_authority, ieee8021x_profile_name, ip_sync_enabled, local_wifi_sync_enabled)
        values($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
        [
          amtConfig.profileName,
          amtConfig.activation,
          amtConfig.amtPassword,
          amtConfig.generateRandomPassword,
          amtConfig.ciraConfigName,
          amtConfig.mebxPassword,
          amtConfig.generateRandomMEBxPassword,
          amtConfig.tags,
          amtConfig.dhcpEnabled,
          amtConfig.tlsMode,
          amtConfig.userConsent,
          amtConfig.iderEnabled,
          amtConfig.kvmEnabled,
          amtConfig.solEnabled,
          amtConfig.tenantId,
          amtConfig.tlsSigningAuthority,
          amtConfig.ieee8021xProfileName,
          amtConfig.ipSyncEnabled,
          amtConfig.localWifiSyncEnabled
        ]
      )
    })
    test('should NOT insert when duplicate name', async () => {
      querySpy.mockRejectedValueOnce({ code: '23505' })
      await expect(profilesTable.insert(amtConfig)).rejects.toThrow(
        PROFILE_INSERTION_FAILED_DUPLICATE(amtConfig.profileName)
      )
    })
    test('should NOT insert when constraint violation', async () => {
      querySpy.mockRejectedValueOnce({ code: '23503' })
      await expect(profilesTable.insert(amtConfig)).rejects.toThrow(
        PROFILE_INSERTION_GENERIC_CONSTRAINT(amtConfig.ciraConfigName)
      )
    })
    test('should NOT insert when unexpected exception', async () => {
      querySpy.mockRejectedValueOnce(new Error('unknown'))
      await expect(profilesTable.insert(amtConfig)).rejects.toThrow(API_UNEXPECTED_EXCEPTION(amtConfig.profileName))
    })
    test('should NOT insert when RPS error', async () => {
      querySpy.mockRejectedValueOnce(new RPSError('known RPS error'))
      await expect(profilesTable.insert(amtConfig)).rejects.toThrow('known RPS error')
    })
  })
  describe('Update', () => {
    test('should update', async () => {
      querySpy.mockResolvedValueOnce({ rows: [], rowCount: 1 })
      const getByNameSpy = spyOn(profilesTable, 'getByName')
      getByNameSpy.mockResolvedValue(amtConfig)

      const result = await profilesTable.update(amtConfig)
      expect(result).toBe(amtConfig)
      expect(querySpy).toBeCalledTimes(1)
      expect(querySpy).toBeCalledWith(
        `
      UPDATE profiles 
      SET activation=$2, amt_password=$3, generate_random_password=$4, cira_config_name=$5,
          mebx_password=$6, generate_random_mebx_password=$7,
          tags=$8, dhcp_enabled=$9, tls_mode=$10, user_consent=$13,
          ider_enabled=$14, kvm_enabled=$15, sol_enabled=$16,
          tls_signing_authority=$17, ieee8021x_profile_name=$18,
          ip_sync_enabled=$19, local_wifi_sync_enabled=$20
      WHERE profile_name=$1 and tenant_id = $11 and xmin = $12`,
        [
          amtConfig.profileName,
          amtConfig.activation,
          amtConfig.amtPassword,
          amtConfig.generateRandomPassword,
          amtConfig.ciraConfigName,
          amtConfig.mebxPassword,
          amtConfig.generateRandomMEBxPassword,
          amtConfig.tags,
          amtConfig.dhcpEnabled,
          amtConfig.tlsMode,
          amtConfig.tenantId,
          amtConfig.version,
          amtConfig.userConsent,
          amtConfig.iderEnabled,
          amtConfig.kvmEnabled,
          amtConfig.solEnabled,
          amtConfig.tlsSigningAuthority,
          amtConfig.ieee8021xProfileName,
          amtConfig.ipSyncEnabled,
          amtConfig.localWifiSyncEnabled
        ]
      )
    })
    test('should update with wificonfigs', async () => {
      querySpy.mockResolvedValueOnce({ rows: [], rowCount: 1 })
      const profileWirelessConfigsSpy = spyOn(db.profileWirelessConfigs, 'createProfileWifiConfigs')
      profileWirelessConfigsSpy.mockResolvedValue(true)
      const getByNameSpy = spyOn(profilesTable, 'getByName')
      amtConfig.wifiConfigs = [{} as any]
      getByNameSpy.mockResolvedValue(amtConfig)

      const result = await profilesTable.update(amtConfig)
      expect(result).toBe(amtConfig)
      expect(querySpy).toBeCalledTimes(1)
      expect(querySpy).toBeCalledWith(
        `
      UPDATE profiles 
      SET activation=$2, amt_password=$3, generate_random_password=$4, cira_config_name=$5,
          mebx_password=$6, generate_random_mebx_password=$7,
          tags=$8, dhcp_enabled=$9, tls_mode=$10, user_consent=$13,
          ider_enabled=$14, kvm_enabled=$15, sol_enabled=$16,
          tls_signing_authority=$17, ieee8021x_profile_name=$18,
          ip_sync_enabled=$19, local_wifi_sync_enabled=$20
      WHERE profile_name=$1 and tenant_id = $11 and xmin = $12`,
        [
          amtConfig.profileName,
          amtConfig.activation,
          amtConfig.amtPassword,
          amtConfig.generateRandomPassword,
          amtConfig.ciraConfigName,
          amtConfig.mebxPassword,
          amtConfig.generateRandomMEBxPassword,
          amtConfig.tags,
          amtConfig.dhcpEnabled,
          amtConfig.tlsMode,
          amtConfig.tenantId,
          amtConfig.version,
          amtConfig.userConsent,
          amtConfig.iderEnabled,
          amtConfig.kvmEnabled,
          amtConfig.solEnabled,
          amtConfig.tlsSigningAuthority,
          amtConfig.ieee8021xProfileName,
          amtConfig.ipSyncEnabled,
          amtConfig.localWifiSyncEnabled
        ]
      )
    })

    test('should NOT update when constraint violation', async () => {
      querySpy.mockRejectedValueOnce({
        code: '23503',
        message: 'profiles_cira_config_name_fkey'
      })
      await expect(profilesTable.update(amtConfig)).rejects.toThrow(
        PROFILE_INSERTION_CIRA_CONSTRAINT(amtConfig.ciraConfigName)
      )
    })
    test('should NOT update when unexpected error', async () => {
      querySpy.mockRejectedValueOnce('unknown')
      await expect(profilesTable.update(amtConfig)).rejects.toThrow(API_UNEXPECTED_EXCEPTION(amtConfig.profileName))
    })
    test('should NOT update when concurrency error', async () => {
      querySpy.mockResolvedValueOnce({ rows: [], rowCount: 0 })
      const getByNameSpy = spyOn(profilesTable, 'getByName')
      getByNameSpy.mockResolvedValue(amtConfig)
      await expect(profilesTable.update(amtConfig)).rejects.toThrow(CONCURRENCY_MESSAGE)
    })
    test('should insert with proxy configs', async () => {
      querySpy.mockResolvedValueOnce({ rows: [], rowCount: 1 })

      const profileProxyConfigsSpy = spyOn(db.profileProxyConfigs, 'createProfileProxyConfigs')
      profileProxyConfigsSpy.mockResolvedValue(true)

      const getByNameSpy = spyOn(profilesTable, 'getByName')
      amtConfig.proxyConfigs = [{} as any]
      getByNameSpy.mockResolvedValue(amtConfig)
      const result = await profilesTable.insert(amtConfig)

      expect(result).toBe(amtConfig)

      expect(profileProxyConfigsSpy).toHaveBeenCalledWith(
        amtConfig.proxyConfigs,
        amtConfig.profileName,
        amtConfig.tenantId
      )

      expect(getByNameSpy).toHaveBeenCalledWith(amtConfig.profileName, amtConfig.tenantId)
      expect(querySpy).toBeCalledTimes(1)
      expect(querySpy).toBeCalledWith(
        `
        INSERT INTO profiles(
          profile_name, activation,
          amt_password, generate_random_password,
          cira_config_name,
          mebx_password, generate_random_mebx_password,
          tags, dhcp_enabled, tls_mode,
          user_consent, ider_enabled, kvm_enabled, sol_enabled,
          tenant_id, tls_signing_authority, ieee8021x_profile_name, ip_sync_enabled, local_wifi_sync_enabled)
        values($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
        [
          amtConfig.profileName,
          amtConfig.activation,
          amtConfig.amtPassword,
          amtConfig.generateRandomPassword,
          amtConfig.ciraConfigName,
          amtConfig.mebxPassword,
          amtConfig.generateRandomMEBxPassword,
          amtConfig.tags,
          amtConfig.dhcpEnabled,
          amtConfig.tlsMode,
          amtConfig.userConsent,
          amtConfig.iderEnabled,
          amtConfig.kvmEnabled,
          amtConfig.solEnabled,
          amtConfig.tenantId,
          amtConfig.tlsSigningAuthority,
          amtConfig.ieee8021xProfileName,
          amtConfig.ipSyncEnabled,
          amtConfig.localWifiSyncEnabled
        ]
      )
    })
    test('should insert without proxy configs', async () => {
      querySpy.mockResolvedValueOnce({ rows: [], rowCount: 1 })
      const profileProxyConfigsSpy = spyOn(db.profileProxyConfigs, 'createProfileProxyConfigs')
      profileProxyConfigsSpy.mockResolvedValue(true)
      const getByNameSpy = spyOn(profilesTable, 'getByName')
      getByNameSpy.mockResolvedValue(amtConfig)
      const result = await profilesTable.insert(amtConfig)

      expect(result).toBe(amtConfig)
      expect(profileProxyConfigsSpy).not.toHaveBeenCalledWith(
        amtConfig.proxyConfigs,
        amtConfig.profileName,
        amtConfig.tenantId
      )
      expect(getByNameSpy).toHaveBeenCalledWith(amtConfig.profileName, amtConfig.tenantId)
      expect(querySpy).toBeCalledTimes(1)
      expect(querySpy).toBeCalledWith(
        `
        INSERT INTO profiles(
          profile_name, activation,
          amt_password, generate_random_password,
          cira_config_name,
          mebx_password, generate_random_mebx_password,
          tags, dhcp_enabled, tls_mode,
          user_consent, ider_enabled, kvm_enabled, sol_enabled,
          tenant_id, tls_signing_authority, ieee8021x_profile_name, ip_sync_enabled, local_wifi_sync_enabled)
        values($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
        [
          amtConfig.profileName,
          amtConfig.activation,
          amtConfig.amtPassword,
          amtConfig.generateRandomPassword,
          amtConfig.ciraConfigName,
          amtConfig.mebxPassword,
          amtConfig.generateRandomMEBxPassword,
          amtConfig.tags,
          amtConfig.dhcpEnabled,
          amtConfig.tlsMode,
          amtConfig.userConsent,
          amtConfig.iderEnabled,
          amtConfig.kvmEnabled,
          amtConfig.solEnabled,
          amtConfig.tenantId,
          amtConfig.tlsSigningAuthority,
          amtConfig.ieee8021xProfileName,
          amtConfig.ipSyncEnabled,
          amtConfig.localWifiSyncEnabled
        ]
      )
    })
    test('should update with proxy configs', async () => {
      querySpy.mockResolvedValueOnce({ rows: [], rowCount: 1 })
      const profileProxyConfigsSpy = spyOn(db.profileProxyConfigs, 'createProfileProxyConfigs')
      profileProxyConfigsSpy.mockResolvedValue(true)
      const getByNameSpy = spyOn(profilesTable, 'getByName')
      amtConfig.proxyConfigs = [{} as any]
      getByNameSpy.mockResolvedValue(amtConfig)

      const result = await profilesTable.update(amtConfig)
      expect(result).toBe(amtConfig)
      expect(querySpy).toBeCalledTimes(1)
      expect(querySpy).toBeCalledWith(
        `
      UPDATE profiles 
      SET activation=$2, amt_password=$3, generate_random_password=$4, cira_config_name=$5,
          mebx_password=$6, generate_random_mebx_password=$7,
          tags=$8, dhcp_enabled=$9, tls_mode=$10, user_consent=$13,
          ider_enabled=$14, kvm_enabled=$15, sol_enabled=$16,
          tls_signing_authority=$17, ieee8021x_profile_name=$18,
          ip_sync_enabled=$19, local_wifi_sync_enabled=$20
      WHERE profile_name=$1 and tenant_id = $11 and xmin = $12`,
        [
          amtConfig.profileName,
          amtConfig.activation,
          amtConfig.amtPassword,
          amtConfig.generateRandomPassword,
          amtConfig.ciraConfigName,
          amtConfig.mebxPassword,
          amtConfig.generateRandomMEBxPassword,
          amtConfig.tags,
          amtConfig.dhcpEnabled,
          amtConfig.tlsMode,
          amtConfig.tenantId,
          amtConfig.version,
          amtConfig.userConsent,
          amtConfig.iderEnabled,
          amtConfig.kvmEnabled,
          amtConfig.solEnabled,
          amtConfig.tlsSigningAuthority,
          amtConfig.ieee8021xProfileName,
          amtConfig.ipSyncEnabled,
          amtConfig.localWifiSyncEnabled
        ]
      )
    })
  })
})
