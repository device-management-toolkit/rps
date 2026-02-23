/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { type Ieee8021xConfig } from '../../../models/RCS.Config.js'
import {
  API_UNEXPECTED_EXCEPTION,
  DEFAULT_SKIP,
  DEFAULT_TOP,
  CONCURRENCY_EXCEPTION,
  CONCURRENCY_MESSAGE,
  IEEE8021X_DELETION_FAILED_CONSTRAINT_AMT_PROFILE,
  IEEE8021X_DELETION_FAILED_CONSTRAINT_WIRELESS,
  IEEE8021X_INSERTION_FAILED_DUPLICATE,
  IEEE8021X_INSERTION_FAILED
} from '../../../utils/constants.js'
import Logger from '../../../Logger.js'
import { RPSError } from '../../../utils/RPSError.js'
import type PostgresDb from '../index.js'
import { type IIEEE8021xProfileTable } from '../../../interfaces/database/IIEEE8021xProfilesDB.js'
import { PostgresErr } from '../errors.js'

export class IEEE8021xProfilesTable implements IIEEE8021xProfileTable {
  db: PostgresDb
  log: Logger

  constructor(db: PostgresDb) {
    this.db = db
    this.log = new Logger('IEEE8021xProfilesTable')
  }

  public async getCount(tenantId = ''): Promise<number> {
    const result = await this.db.query<{ total_count: number }>(
      `
      SELECT COUNT(*) OVER () AS total_count
      FROM ieee8021xconfigs
      WHERE tenant_id = $1`,
      [tenantId]
    )
    let count = 0
    if (result != null && result.rows?.length > 0) {
      count = Number(result.rows[0].total_count)
    }
    return count
  }

  // Get a paginated list of items from the table
  public async get(
    limit: number = DEFAULT_TOP,
    offset: number = DEFAULT_SKIP,
    tenantId = ''
  ): Promise<Ieee8021xConfig[]> {
    const results = await this.db.query<Ieee8021xConfig>(
      `
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
      OFFSET $2`,
      [
        limit,
        offset,
        tenantId
      ]
    )
    return results.rows
  }

  public async getByName(profileName: string, tenantId = ''): Promise<Ieee8021xConfig | null> {
    const results = await this.db.query<Ieee8021xConfig>(
      `
      SELECT 
        profile_name as "profileName",
        auth_Protocol as "authenticationProtocol",
        pxe_timeout as "pxeTimeout",
        wired_interface as "wiredInterface",
        tenant_id as "tenantId",
        xmin as "version"
      FROM ieee8021xconfigs
      WHERE profile_name = $1
        AND tenant_id = $2`,
      [profileName, tenantId]
    )
    return results?.rows?.length > 0 ? results.rows[0] : null
  }

  async checkProfileExits(profileName: string, tenantId = ''): Promise<boolean> {
    const results = await this.db.query(
      `
      SELECT 1
      FROM ieee8021xconfigs
      WHERE profile_name = $1
        AND tenant_id = $2`,
      [profileName, tenantId]
    )

    if (results?.rowCount) {
      if (results.rowCount > 0) {
        return true
      }
    }
    return false
  }

  // Delete an item from the table by its name
  public async delete(profileName: string, tenantId = ''): Promise<boolean> {
    try {
      const result = await this.db.query(
        `
        DELETE
        FROM ieee8021xconfigs
        WHERE profile_name = $1
          AND tenant_id = $2`,
        [profileName, tenantId]
      )

      if (result?.rowCount) {
        if (result.rowCount > 0) {
          return true
        }
      }
      return false
    } catch (error) {
      this.log.error(`Failed to delete 802.1x configuration : ${profileName} `, error)
      if (error.code === PostgresErr.C23_FOREIGN_KEY_VIOLATION) {
        if (error.table === 'profiles') {
          throw new RPSError(IEEE8021X_DELETION_FAILED_CONSTRAINT_AMT_PROFILE(profileName))
        } else if (error.table === 'wirelessconfigs') {
          throw new RPSError(IEEE8021X_DELETION_FAILED_CONSTRAINT_WIRELESS(profileName))
        }
      }
      throw new RPSError(API_UNEXPECTED_EXCEPTION(`Delete 802.1x configuration : ${profileName}`))
    }
  }

  public async insert(item: Ieee8021xConfig): Promise<Ieee8021xConfig | null> {
    try {
      const results = await this.db.query(
        `
        INSERT
        INTO ieee8021xconfigs(profile_name, auth_protocol, pxe_timeout, wired_interface, tenant_id)
        VALUES ($1, $2, $3, $4, $5)
      `,
        [
          item.profileName,
          item.authenticationProtocol,
          item.pxeTimeout,
          item.wiredInterface,
          item.tenantId
        ]
      )

      if (results.rowCount === 0) {
        return null
      }
      return await this.getByName(item.profileName, item.tenantId)
    } catch (error) {
      this.log.error(
        `Failed to insert 802.1x configuration : ${item.profileName}`,
        error.message || JSON.stringify(error)
      )
      if (error.code === PostgresErr.C23_UNIQUE_VIOLATION) {
        throw new RPSError(IEEE8021X_INSERTION_FAILED_DUPLICATE(item.profileName), 'Unique key violation')
      }
      throw new RPSError(IEEE8021X_INSERTION_FAILED(item.profileName))
    }
  }

  async update(item: Ieee8021xConfig): Promise<Ieee8021xConfig | null> {
    let latestItem: Ieee8021xConfig | null
    try {
      const results = await this.db.query(
        `
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
        ]
      )
      if (results?.rowCount) {
        if (results.rowCount > 0) {
          return await this.getByName(item.profileName, item.tenantId)
        }
      }
      // if rowcount is 0, we assume update failed and grab the current reflection of the record in the DB to be
      // returned in the Concurrency Error
      latestItem = await this.getByName(item.profileName, item.tenantId)
    } catch (error) {
      this.log.error(`Failed to update 802.1x configuration : ${item.profileName}`, error)
      throw new RPSError(API_UNEXPECTED_EXCEPTION(item.profileName))
    }
    // making assumption that if no records are updated, that it is due to concurrency. We've already checked for if it
    // doesn't exist before calling update.
    throw new RPSError(CONCURRENCY_MESSAGE, CONCURRENCY_EXCEPTION, latestItem)
  }
}
