import PostgresDb from '..'
import { AMTConfiguration } from '../../../models'
import { PROFILE_INSERTION_FAILED_DUPLICATE, PROFILE_INSERTION_CIRA_CONSTRAINT, API_UNEXPECTED_EXCEPTION, DEFAULT_SKIP, DEFAULT_TOP, PROFILE_INSERTION_GENERIC_CONSTRAINT, CONCURRENCY_MESSAGE } from '../../../utils/constants'
import { RPSError } from '../../../utils/RPSError'
import { ProfilesTable } from './profiles'

describe('profiles tests', () => {
  let db: PostgresDb
  let profilesTable: ProfilesTable
  let querySpy: jest.SpyInstance
  let amtConfig: AMTConfiguration
  const profileName = 'profileName'
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
      tlsMode: null,
      tenantId: ''
    }
    db = new PostgresDb('')
    profilesTable = new ProfilesTable(db)
    querySpy = jest.spyOn(profilesTable.db, 'query')
  })
  afterEach(() => {
    jest.clearAllMocks()
  })
  describe('Get', () => {
    test('should get count', async () => {
      querySpy.mockResolvedValueOnce({ rows: [{ total_count: 1 }], rowCount: 0 })
      const count = await profilesTable.getCount()
      expect(count).toBe(1)
      expect(querySpy).toBeCalledTimes(1)
      expect(querySpy).toBeCalledWith(`
    SELECT count(*) OVER() AS total_count 
    FROM profiles
    WHERE tenant_id = $1`, [''])
    })
    test('should get profiles', async () => {
      const rows = [{}, {}]
      querySpy.mockResolvedValueOnce({ rows: rows, rowCount: rows.length })
      const result = await profilesTable.get()
      expect(result).toStrictEqual(rows)
      expect(querySpy).toBeCalledTimes(1)
      expect(querySpy).toBeCalledWith(`
    SELECT 
      p.profile_name as "profileName", 
      activation as "activation", 
      cira_config_name as "ciraConfigName",
      generate_random_password as "generateRandomPassword",
      generate_random_mebx_password as "generateRandomMEBxPassword",
      tags as "tags", 
      dhcp_enabled as "dhcpEnabled", 
      tls_mode as "tlsMode",
      p.tenant_id as "tenantId",
      p.xmin as "version",
      COALESCE(json_agg(json_build_object('profileName',wc.wireless_profile_name, 'priority', wc.priority)) FILTER (WHERE wc.wireless_profile_name IS NOT NULL), '[]') AS "wifiConfigs" 
    FROM profiles p
    LEFT JOIN profiles_wirelessconfigs wc ON wc.profile_name = p.profile_name AND wc.tenant_id = p.tenant_id
    WHERE p.tenant_id = $3
    GROUP BY p.profile_name
    ,activation
    ,cira_config_name
    ,tags
    ,dhcp_enabled
    ,tls_mode
    ,p.tenant_id
    ORDER BY p.profile_name 
    LIMIT $1 OFFSET $2`, [DEFAULT_TOP, DEFAULT_SKIP, ''])
    })
    test('should get by name', async () => {
      const rows = [{}]
      querySpy.mockResolvedValueOnce({ rows: [{}], rowCount: rows.length })
      const result = await profilesTable.getByName(profileName)
      expect(result).toStrictEqual(rows[0])
      expect(querySpy).toBeCalledTimes(1)
      expect(querySpy).toBeCalledWith(`
    SELECT 
      p.profile_name as "profileName",
      activation as "activation",
      cira_config_name as "ciraConfigName",
      generate_random_password as "generateRandomPassword",
      generate_random_mebx_password as "generateRandomMEBxPassword",
      tags as "tags",
      dhcp_enabled as "dhcpEnabled",
      tls_mode as "tlsMode",
      p.tenant_id as "tenantId",
      p.xmin as "version",
      COALESCE(json_agg(json_build_object('profileName',wc.wireless_profile_name, 'priority', wc.priority)) FILTER (WHERE wc.wireless_profile_name IS NOT NULL), '[]') AS "wifiConfigs"
    FROM profiles p
    LEFT JOIN profiles_wirelessconfigs wc ON wc.profile_name = p.profile_name AND wc.tenant_id = p.tenant_id
    WHERE p.profile_name = $1 and p.tenant_id = $2
    GROUP BY 
      p.profile_name,
      activation,
      cira_config_name,
      tags,
      dhcp_enabled,
      tls_mode,
      p.tenant_id
    `, [profileName, ''])
    })
    test('should NOT get by name when no profiles exists', async () => {
      querySpy.mockResolvedValueOnce({ rows: [], rowCount: 0 })
      const result = await profilesTable.getByName(profileName)
      expect(result).toBeNull()
    })
    test('should get ciraconfig for profile', async () => {
      const ciraConfigSpy = jest.spyOn(db.ciraConfigs, 'getByName')
      ciraConfigSpy.mockResolvedValue({} as any)
      const result = await profilesTable.getCiraConfigForProfile(profileName)
      expect(result).toStrictEqual({})
      expect(ciraConfigSpy).toHaveBeenCalledWith(profileName)
    })
  })
  describe('Delete', () => {
    test('should delete', async () => {
      querySpy.mockResolvedValueOnce({ rows: [], rowCount: 1 })
      const wirelessConfigSpy = jest.spyOn(db.profileWirelessConfigs, 'deleteProfileWifiConfigs')
      wirelessConfigSpy.mockResolvedValue(true)
      const result = await profilesTable.delete(profileName)
      expect(result).toBeTruthy()
      expect(wirelessConfigSpy).toHaveBeenLastCalledWith(profileName)
      expect(querySpy).toBeCalledTimes(1)
      expect(querySpy).toBeCalledWith(`
      DELETE 
      FROM profiles 
      WHERE profile_name = $1 and tenant_id = $2`, [profileName, ''])
    })
    test('should NOT delete', async () => {
      querySpy.mockResolvedValueOnce({ rows: [], rowCount: 0 })
      const wirelessConfigSpy = jest.spyOn(db.profileWirelessConfigs, 'deleteProfileWifiConfigs')
      wirelessConfigSpy.mockResolvedValue(false)
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
      const profileWirelessConfigsSpy = jest.spyOn(db.profileWirelessConfigs, 'createProfileWifiConfigs')
      profileWirelessConfigsSpy.mockResolvedValue(true)
      const getByNameSpy = jest.spyOn(profilesTable, 'getByName')
      amtConfig.wifiConfigs = [{} as any]
      getByNameSpy.mockResolvedValue(amtConfig)
      const result = await profilesTable.insert(amtConfig)

      expect(result).toBe(amtConfig)
      expect(profileWirelessConfigsSpy).toHaveBeenCalledWith(amtConfig.wifiConfigs, amtConfig.profileName, amtConfig.tenantId)
      expect(getByNameSpy).toHaveBeenCalledWith(amtConfig.profileName)
      expect(querySpy).toBeCalledTimes(1)
      expect(querySpy).toBeCalledWith(`INSERT INTO profiles(profile_name, activation, amt_password, generate_random_password, cira_config_name, mebx_password, generate_random_mebx_password, tags, dhcp_enabled, tls_mode, tenant_id)
        values($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`, [
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
        amtConfig.tenantId
      ])
    })
    test('should insert without wificonfigs', async () => {
      querySpy.mockResolvedValueOnce({ rows: [], rowCount: 1 })
      const profileWirelessConfigsSpy = jest.spyOn(db.profileWirelessConfigs, 'createProfileWifiConfigs')
      profileWirelessConfigsSpy.mockResolvedValue(true)
      const getByNameSpy = jest.spyOn(profilesTable, 'getByName')
      getByNameSpy.mockResolvedValue(amtConfig)
      const result = await profilesTable.insert(amtConfig)

      expect(result).toBe(amtConfig)
      expect(profileWirelessConfigsSpy).not.toHaveBeenCalledWith(amtConfig.wifiConfigs, amtConfig.profileName, amtConfig.tenantId)
      expect(getByNameSpy).toHaveBeenCalledWith(amtConfig.profileName)
      expect(querySpy).toBeCalledTimes(1)
      expect(querySpy).toBeCalledWith(`INSERT INTO profiles(profile_name, activation, amt_password, generate_random_password, cira_config_name, mebx_password, generate_random_mebx_password, tags, dhcp_enabled, tls_mode, tenant_id)
        values($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`, [
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
        amtConfig.tenantId
      ])
    })
    test('should NOT insert when duplicate name', async () => {
      querySpy.mockRejectedValueOnce({ code: '23505' })
      await expect(profilesTable.insert(amtConfig)).rejects.toThrow(PROFILE_INSERTION_FAILED_DUPLICATE(amtConfig.profileName))
    })
    test('should NOT insert when constraint violation', async () => {
      querySpy.mockRejectedValueOnce({ code: '23503' })
      await expect(profilesTable.insert(amtConfig)).rejects.toThrow(PROFILE_INSERTION_GENERIC_CONSTRAINT(amtConfig.ciraConfigName))
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
      const getByNameSpy = jest.spyOn(profilesTable, 'getByName')
      getByNameSpy.mockResolvedValue(amtConfig)

      const result = await profilesTable.update(amtConfig)
      expect(result).toBe(amtConfig)
      expect(querySpy).toBeCalledTimes(1)
      expect(querySpy).toBeCalledWith(`
      UPDATE profiles 
      SET activation=$2, amt_password=$3, generate_random_password=$4, cira_config_name=$5, mebx_password=$6, generate_random_mebx_password=$7, tags=$8, dhcp_enabled=$9, tls_mode=$10
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
        amtConfig.version
      ])
    })
    test('should update with wificonfigs', async () => {
      querySpy.mockResolvedValueOnce({ rows: [], rowCount: 1 })
      const profileWirelessConfigsSpy = jest.spyOn(db.profileWirelessConfigs, 'createProfileWifiConfigs')
      profileWirelessConfigsSpy.mockResolvedValue(true)
      const getByNameSpy = jest.spyOn(profilesTable, 'getByName')
      amtConfig.wifiConfigs = [{} as any]
      getByNameSpy.mockResolvedValue(amtConfig)

      const result = await profilesTable.update(amtConfig)
      expect(result).toBe(amtConfig)
      expect(querySpy).toBeCalledTimes(1)
      expect(querySpy).toBeCalledWith(`
      UPDATE profiles 
      SET activation=$2, amt_password=$3, generate_random_password=$4, cira_config_name=$5, mebx_password=$6, generate_random_mebx_password=$7, tags=$8, dhcp_enabled=$9, tls_mode=$10
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
        amtConfig.version
      ])
    })

    test('should NOT update when constraint violation', async () => {
      querySpy.mockRejectedValueOnce({ code: '23503', message: 'profiles_cira_config_name_fkey' })
      await expect(profilesTable.update(amtConfig)).rejects.toThrow(PROFILE_INSERTION_CIRA_CONSTRAINT(amtConfig.ciraConfigName))
    })
    test('should NOT update when unexpected error', async () => {
      querySpy.mockRejectedValueOnce('unknown')
      await expect(profilesTable.update(amtConfig)).rejects.toThrow(API_UNEXPECTED_EXCEPTION(amtConfig.profileName))
    })
    test('should NOT update when concurrency error', async () => {
      querySpy.mockResolvedValueOnce({ rows: [], rowCount: 0 })
      const getByNameSpy = jest.spyOn(profilesTable, 'getByName')
      getByNameSpy.mockResolvedValue(amtConfig)
      await expect(profilesTable.update(amtConfig)).rejects.toThrow(CONCURRENCY_MESSAGE)
    })
  })
})
