/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { type IProfilesTable } from '../../../interfaces/database/IProfilesDb.js'
import { type Ieee8021xConfig, type CIRAConfig } from '../../../models/RCS.Config.js'
import { type AMTConfiguration } from '../../../models/index.js'
import {
  PROFILE_INSERTION_FAILED_DUPLICATE,
  PROFILE_INSERTION_CIRA_CONSTRAINT,
  API_UNEXPECTED_EXCEPTION,
  DEFAULT_SKIP,
  DEFAULT_TOP,
  PROFILE_INSERTION_GENERIC_CONSTRAINT,
  CONCURRENCY_EXCEPTION,
  CONCURRENCY_MESSAGE
} from '../../../utils/constants.js'
import Logger from '../../../Logger.js'
import { RPSError } from '../../../utils/RPSError.js'
import type PostgresDb from '../index.js'
import { PostgresErr } from '../errors.js'

export class ProfilesTable implements IProfilesTable {
  db: PostgresDb
  log: Logger
  constructor(db: PostgresDb) {
    this.db = db
    this.log = new Logger('ProfilesDb')
  }

  /**
   * @description Get count of all profiles from DB
   * @param {string} tenantId
   * @returns {number}
   */
  async getCount(tenantId = ''): Promise<number> {
    const result = await this.db.query<{ total_count: number }>(
      `
    SELECT count(*) OVER() AS total_count 
    FROM profiles
    WHERE tenant_id = $1`,
      [tenantId]
    )
    let count = 0
    if (result != null && result.rows?.length > 0) {
      count = Number(result.rows[0].total_count)
    }
    return count
  }

  /**
   * @description Get all AMT Profiles from DB
   * @param {number} top
   * @param {number} skip
   * @param {string} tenantId
   * @returns {Pagination} returns an array of AMT profiles from DB
   */
  async get(top: number = DEFAULT_TOP, skip: number = DEFAULT_SKIP, tenantId = ''): Promise<AMTConfiguration[]> {
    const results = await this.db.query<AMTConfiguration>(
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
        top,
        skip,
        tenantId
      ]
    )

    return results.rows
  }

  /**
   * @description Get AMT Profile from DB by name
   * @param {string} profileName
   * @param {string} tenantId
   * @returns {AMTConfiguration} AMT Profile object
   */
  async getByName(profileName: string, tenantId = ''): Promise<AMTConfiguration | null> {
    const results = await this.db.query<AMTConfiguration>(
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
      [profileName, tenantId]
    )

    return results.rows.length > 0 ? results.rows[0] : null
  }

  /**
   * @description Get CIRA config from DB by name
   * @param {string} configName
   * @param {string} tenantId
   * @returns {CIRAConfig} CIRA config object
   */
  async getCiraConfigForProfile(configName: string, tenantId: string): Promise<CIRAConfig | null> {
    return await this.db.ciraConfigs.getByName(configName, tenantId)
  }

  async get8021XConfigForProfile(profileName: string, tenantId?: string): Promise<Ieee8021xConfig | null> {
    return await this.db.ieee8021xProfiles.getByName(profileName, tenantId)
  }

  /**
   * @description Delete AMT Profile from DB by name
   * @param {string} profileName
   * @param {string} tenantId
   * @returns {boolean} Return true on successful deletion
   */
  async delete(profileName: string, tenantId = ''): Promise<boolean> {
    // delete any associations with wificonfigs
    await this.db.profileWirelessConfigs.deleteProfileWifiConfigs(profileName, tenantId)

    // delete any associations with proxyconfigs
    await this.db.profileProxyConfigs.deleteProfileProxyConfigs(profileName, tenantId)

    const results = await this.db.query(
      `
      DELETE 
      FROM profiles 
      WHERE profile_name = $1 and tenant_id = $2`,
      [profileName, tenantId]
    )
    if (results?.rowCount) {
      if (results.rowCount > 0) {
        return true
      }
    }
    return false
  }

  /**
   * @description Insert AMT profile into DB
   * @param {AMTConfiguration} amtConfig
   * @returns {boolean} Returns amtConfig object
   */
  async insert(amtConfig: AMTConfiguration): Promise<AMTConfiguration | null> {
    try {
      const results = await this.db.query(
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

      if (results.rowCount === 0) {
        return null
      }

      if (amtConfig.wifiConfigs) {
        if (amtConfig.wifiConfigs?.length > 0) {
          await this.db.profileWirelessConfigs.createProfileWifiConfigs(
            amtConfig.wifiConfigs,
            amtConfig.profileName,
            amtConfig.tenantId
          )
        }
      }

      const proxyConfigs = amtConfig?.proxyConfigs ?? []
      if (proxyConfigs.length > 0) {
        await this.db.profileProxyConfigs.createProfileProxyConfigs(
          proxyConfigs,
          amtConfig.profileName,
          amtConfig.tenantId
        )
      }

      return await this.getByName(amtConfig.profileName, amtConfig.tenantId)
    } catch (error) {
      this.log.error(`Failed to insert AMT profile: ${amtConfig.profileName}`, error)
      if (error instanceof RPSError) {
        throw error
      }
      if (error.code === PostgresErr.C23_UNIQUE_VIOLATION) {
        throw new RPSError(PROFILE_INSERTION_FAILED_DUPLICATE(amtConfig.profileName), 'Unique key violation')
      }
      if (error.code === PostgresErr.C23_FOREIGN_KEY_VIOLATION) {
        throw new RPSError(
          PROFILE_INSERTION_GENERIC_CONSTRAINT(amtConfig.ciraConfigName ?? ''),
          `Foreign key constraint violation: ${error.message}`
        )
      }
      throw new RPSError(API_UNEXPECTED_EXCEPTION(amtConfig.profileName))
    }
  }

  /**
   * @description Update AMT profile into DB
   * @param {AMTConfiguration} amtConfig
   * @returns {AMTConfiguration} Returns amtConfig object
   */
  async update(amtConfig: AMTConfiguration): Promise<AMTConfiguration | null> {
    let latestItem: AMTConfiguration | null = null
    try {
      const results = await this.db.query(
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
      if (results.rowCount && results.rowCount > 0) {
        if (amtConfig.wifiConfigs && amtConfig.wifiConfigs?.length > 0) {
          await this.db.profileWirelessConfigs.createProfileWifiConfigs(
            amtConfig.wifiConfigs,
            amtConfig.profileName,
            amtConfig.tenantId
          )
        }
        const proxyConfigs = amtConfig?.proxyConfigs ?? []
        if (proxyConfigs.length > 0) {
          await this.db.profileProxyConfigs.createProfileProxyConfigs(
            proxyConfigs,
            amtConfig.profileName,
            amtConfig.tenantId
          )
        }

        latestItem = await this.getByName(amtConfig.profileName, amtConfig.tenantId)
        return latestItem
      }
      // if rowcount is 0, we assume update failed and grab the current reflection of the record in the DB to be returned in the Concurrency Error
      latestItem = await this.getByName(amtConfig.profileName, amtConfig.tenantId)
    } catch (error) {
      this.log.error(`Failed to update AMT profile: ${amtConfig.profileName}`, error)
      if (error.code === PostgresErr.C23_FOREIGN_KEY_VIOLATION) {
        if (error.message.includes('profiles_cira_config_name_fkey')) {
          throw new RPSError(
            PROFILE_INSERTION_CIRA_CONSTRAINT(amtConfig.ciraConfigName ?? ''),
            'Foreign key constraint violation'
          )
        }
      }
      throw new RPSError(API_UNEXPECTED_EXCEPTION(amtConfig.profileName))
    }
    // making assumption that if no records are updated, that it is due to concurrency. We've already checked for if it doesn't exist before calling update.
    throw new RPSError(CONCURRENCY_MESSAGE, CONCURRENCY_EXCEPTION, latestItem)
  }
}
