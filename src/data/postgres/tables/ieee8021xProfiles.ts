/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { type Ieee8021xConfig, type Ieee8021xCountByInterface } from '../../../models/RCS.Config'
import {
  NETWORK_CONFIG_INSERTION_FAILED_DUPLICATE,
  NETWORK_CONFIG_ERROR,
  API_UNEXPECTED_EXCEPTION,
  DEFAULT_SKIP,
  DEFAULT_TOP,
  CONCURRENCY_EXCEPTION,
  CONCURRENCY_MESSAGE, NETWORK_CONFIG_DELETION_FAILED_CONSTRAINT
} from '../../../utils/constants'
import Logger from '../../../Logger'
import { RPSError } from '../../../utils/RPSError'
import type PostgresDb from '..'
import { type IIEEE8021xProfileTable } from '../../../interfaces/database/IIEEE8021xProfilesDB'

export class IEEE8021xProfilesTable implements IIEEE8021xProfileTable {
  db: PostgresDb
  log: Logger

  constructor (db: PostgresDb) {
    this.db = db
    this.log = new Logger('IEEE8021xProfilesTable')
  }

  public async getCount (tenantId: string = ''): Promise<number> {
    const result = await this.db.query<{ total_count: number }>(`
      SELECT COUNT(*) OVER () AS total_count
      FROM ieee8021xconfigs
      WHERE tenant_id = $1`
    , [tenantId])
    let count = 0
    if (result != null && result.rows?.length > 0) {
      count = Number(result.rows[0].total_count)
    }
    return count
  }

  // Get a paginated list of items from the table
  public async get (limit: number = DEFAULT_TOP, offset: number = DEFAULT_SKIP, tenantId: string = ''): Promise<Ieee8021xConfig[]> {
    const results = await this.db.query<Ieee8021xConfig>(`
      SELECT 
        profile_name as "profileName",
        auth_Protocol as "authenticationProtocol",
        pxe_timeout as "pxeTimeout",
        wired_interface as "wiredInterface",
        tenant_id as "tenantId",
        xmin as "version"
      FROM ieee8021xconfigs
      WHERE tenant_id = $3
      LIMIT $1
      OFFSET $2`
    , [limit, offset, tenantId])
    return results.rows
  }

  public async getByName (profileName: string, tenantId: string = ''): Promise<Ieee8021xConfig> {
    const results = await this.db.query<Ieee8021xConfig>(`
      SELECT 
        profile_name as "profileName",
        auth_Protocol as "authenticationProtocol",
        pxe_timeout as "pxeTimeout",
        wired_interface as "wiredInterface",
        tenant_id as "tenantId",
        xmin as "version"
      FROM ieee8021xconfigs
      WHERE profile_name = $1
        AND tenant_id = $2`
    , [profileName, tenantId]
    )

    if (results.rowCount > 0) {
      return results.rows[0]
    }
    return null
  }

  public async getCountByInterface (tenantId: string = ''): Promise<Ieee8021xCountByInterface> {
    const counts: Ieee8021xCountByInterface = {
      wired: 0,
      wireless: 0
    }
    const result = await this.db.query<{ wired_interface: boolean, total_count: number }>(`
      SELECT
        wired_interface AS "wired_interface",
        COUNT(*) AS total_count
      FROM ieee8021xconfigs
      WHERE tenant_id = $1
      GROUP BY wired_interface`
    , [tenantId])

    if (!result?.rows) { return counts }
    for (const row of result.rows) {
      if (row.wired_interface) {
        counts.wired = row.total_count
      } else {
        counts.wireless = row.total_count
      }
    }
    return counts
  }

  async checkProfileExits (profileName: string, tenantId: string = ''): Promise<boolean> {
    const results = await this.db.query(`
      SELECT 1
      FROM ieee8021xconfigs
      WHERE profile_name = $1
        AND tenant_id = $2`
    , [profileName, tenantId])

    return results.rowCount > 0
  }

  async checkWiredInterfaceProfileExists (tenantId: string = ''): Promise<boolean> {
    const results = await this.db.query(`
      SELECT 1
      FROM ieee8021xconfigs
      WHERE wired_interface = true
        AND tenant_id = $1`
    , [tenantId]
    )
    return results.rowCount > 0
  }

  // Delete an item from the table by its name
  public async delete (profileName: string, tenantId: string = ''): Promise<boolean> {
    try {
      const result = await this.db.query(`
        DELETE
        FROM ieee8021xconfigs
        WHERE profile_name = $1
          AND tenant_id = $2`
      , [profileName, tenantId])

      return result.rowCount > 0
    } catch (error) {
      this.log.error(`Failed to delete 802.1x configuration : ${profileName}`, error)
      if (error.code === '23503') { // foreign key violation
        throw new RPSError(NETWORK_CONFIG_DELETION_FAILED_CONSTRAINT('802.1x', profileName))
      }
      throw new RPSError(API_UNEXPECTED_EXCEPTION(`Delete 802.1x configuration : ${profileName}`))
    }
  }

  public async insert (item: Ieee8021xConfig): Promise<Ieee8021xConfig> {
    try {
      const results = await this.db.query(`
        INSERT
        INTO ieee8021xconfigs(profile_name, auth_protocol, pxe_timeout, wired_interface, tenant_id)
        VALUES ($1, $2, $3, $4, $5)
      `, [
        item.profileName,
        item.authenticationProtocol,
        item.pxeTimeout,
        item.wiredInterface,
        item.tenantId
      ])

      if (results.rowCount === 0) {
        return null
      }

      return await this.getByName(item.profileName)
    } catch (error) {
      this.log.error(`Failed to insert 802.1x configuration : ${item.profileName}`, error.message || JSON.stringify(error))
      if (error.code === '23505') { // Unique key violation
        throw new RPSError(NETWORK_CONFIG_INSERTION_FAILED_DUPLICATE('802.1x', item.profileName), 'Unique key violation')
      }
      throw new RPSError(NETWORK_CONFIG_ERROR('802.1x', item.profileName))
    }
  }

  async update (item: Ieee8021xConfig): Promise<Ieee8021xConfig> {
    let latestItem: Ieee8021xConfig
    try {
      const results = await this.db.query(`
        UPDATE ieee8021xconfigs
        SET auth_protocol=$2,
            servername=$3,
            domain=$4,
            username=$5,
            password=$6,
            roaming_identity=$7,
            active_in_s0=$8,
            pxe_timeout=$9,
            wired_interface=$10
        WHERE profile_name = $1
          AND tenant_id = $11
          AND xmin = $12`,
      [
        item.profileName,
        item.authenticationProtocol,
        item.serverName,
        item.domain,
        item.username,
        item.password,
        item.roamingIdentity,
        item.activeInS0,
        item.pxeTimeout,
        item.wiredInterface,
        item.tenantId,
        item.version
      ])
      if (results.rowCount > 0) {
        latestItem = await this.getByName(item.profileName)
        return latestItem
      }
      // if rowcount is 0, we assume update failed and grab the current reflection of the record in the DB to be
      // returned in the Concurrency Error
      latestItem = await this.getByName(item.profileName)
    } catch (error) {
      this.log.error(`Failed to update 802.1x configuration : ${item.profileName}`, error)
      throw new RPSError(API_UNEXPECTED_EXCEPTION(item.profileName))
    }
    // making assumption that if no records are updated, that it is due to concurrency. We've already checked for if it
    // doesn't exist before calling update.
    throw new RPSError(CONCURRENCY_MESSAGE, CONCURRENCY_EXCEPTION, latestItem)
  }
}
