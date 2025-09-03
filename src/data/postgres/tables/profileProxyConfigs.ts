/*********************************************************************
 * Copyright (c) Intel Corporation 2025
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { type IProfileProxyConfigsTable } from '../../../interfaces/database/IProfileProxyConfigsDb.js'
import { type ProfileProxyConfigs } from '../../../models/RCS.Config.js'
import { API_UNEXPECTED_EXCEPTION } from '../../../utils/constants.js'
import { RPSError } from '../../../utils/RPSError.js'
import format from 'pg-format'
import type PostgresDb from '../index.js'
import { PostgresErr } from '../errors.js'

export class ProfileProxyConfigsTable implements IProfileProxyConfigsTable {
  db: PostgresDb
  constructor(db: PostgresDb) {
    this.db = db
  }

  /**
   * @description Get AMT Profile associated proxy configs
   * @param {string} profileName
   * @returns {ProfileProxyConfigs[]} Return an array of proxy configs
   */
  async getProfileProxyConfigs(profileName: string, tenantId = ''): Promise<ProfileProxyConfigs[]> {
    const results = await this.db.query<ProfileProxyConfigs>(
      `
    SELECT 
      priority as "priority",
      proxy_config_name as "profileName"
    FROM profiles_proxyconfigs
    WHERE profile_name = $1 and tenant_id = $2
    ORDER BY priority`,
      [profileName, tenantId]
    )
    return results.rows
  }

  /**
   * @description Insert proxy configs associated with AMT profile
   * @param {ProfileProxyConfigs[]} proxyConfigs
   * @param {string} profileName
   * @returns {ProfileProxyConfigs[]} Return an array of proxy configs
   */
  async createProfileProxyConfigs(
    proxyConfigs: ProfileProxyConfigs[],
    profileName: string,
    tenantId = ''
  ): Promise<boolean> {
    try {
      if (proxyConfigs.length < 1) {
        throw new RPSError('No proxyConfigs provided to insert')
      }
      // Preparing data for inserting multiple rows
      const configs = proxyConfigs.map((config) => [
        config.profileName,
        profileName,
        config.priority,
        tenantId
      ])
      const proxyProfilesQueryResults = await this.db.query(
        format(
          `
      INSERT INTO
      profiles_proxyconfigs (proxy_config_name, profile_name, priority, tenant_id)
      VALUES %L`,
          configs
        )
      )

      if ((proxyProfilesQueryResults?.rowCount ?? 0) > 0) {
        return true
      }
    } catch (error) {
      if (error.code === PostgresErr.C23_FOREIGN_KEY_VIOLATION) {
        throw new RPSError(error.detail, 'Foreign key constraint violation')
      }
      throw new RPSError(API_UNEXPECTED_EXCEPTION(profileName))
    }
    return false
  }

  /**
   * @description Delete proxy configs of an AMT Profile from DB by profile name
   * @param {string} configName
   * @returns {boolean} Return true on successful deletion
   */
  async deleteProfileProxyConfigs(configName: string, tenantId = ''): Promise<boolean> {
    const deleteProfileWifiResults = await this.db.query(
      `
    DELETE
    FROM profiles_proxyconfigs
    WHERE profile_name = $1 and tenant_id = $2`,
      [configName, tenantId]
    )

    if ((deleteProfileWifiResults?.rowCount ?? 0) > 0) {
      return true
    }

    return false
  }
}
