/*********************************************************************
 * Copyright (c) Intel Corporation 2025
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { type ProxyConfig } from '../../../models/RCS.Config.js'
import { type IProxyConfigsTable } from '../../../interfaces/database/IProxyConfigsDB.js'
import {
  API_UNEXPECTED_EXCEPTION,
  CONCURRENCY_EXCEPTION,
  CONCURRENCY_MESSAGE,
  DEFAULT_SKIP,
  DEFAULT_TOP,
  NETWORK_CONFIG_DELETION_FAILED_CONSTRAINT,
  NETWORK_CONFIG_ERROR,
  NETWORK_CONFIG_INSERTION_FAILED_DUPLICATE
} from '../../../utils/constants.js'
import { RPSError } from '../../../utils/RPSError.js'
import Logger from '../../../Logger.js'
import type PostgresDb from '../index.js'
import { PostgresErr } from '../errors.js'

export class ProxyConfigsTable implements IProxyConfigsTable {
  db: PostgresDb
  log: Logger
  constructor(db: PostgresDb) {
    this.db = db
    this.log = new Logger('ProxyConfigsDb')
  }

  /**
   * @description Get count of all proxies from DB
   * @returns {number}
   */
  async getCount(tenantId = ''): Promise<number> {
    const result = await this.db.query<{ total_count: number }>(
      `
    SELECT count(*) OVER() AS total_count 
    FROM proxyconfigs 
    WHERE tenant_id = $1`,
      [tenantId]
    )
    let count = 0
    if (result?.rows?.length > 0) {
      count = Number(result.rows[0].total_count)
    }
    return count
  }

  /**
   * @description Get all proxies profiles from DB
   * @param {number} top
   * @param {number} skip
   * @returns {ProxyConfig []} returns an array of ProxyConfig objects
   */
  async get(top: number = DEFAULT_TOP, skip: number = DEFAULT_SKIP, tenantId = ''): Promise<ProxyConfig[]> {
    const results = await this.db.query<ProxyConfig>(
      `
    SELECT
      access_info as "accessInfo",
      info_format as "infoFormat",
      port as "port",
      network_dns_suffix as "networkDnsSuffix",
      tenant_id as "tenantId"
    FROM proxyconfigs 
    WHERE tenant_id = $3
    ORDER BY access_info 
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
   * @description Get proxy profile from DB by name
   * @param {string} accessInfo
   * @returns {ProxyConfig} ProxyConfig object
   */
  async getByName(accessInfo: string, tenantId = ''): Promise<ProxyConfig | null> {
    const results = await this.db.query<ProxyConfig>(
      `
    SELECT
      access_info as "accessInfo",
      info_format as "infoFormat",
      port as "port",
      network_dns_suffix as "networkDnsSuffix",
      tenant_id as "tenantId"
    FROM proxyconfigs 
    WHERE access_info = $1 and tenant_id = $2`,
      [accessInfo, tenantId]
    )

    if ((results?.rowCount ?? 0) > 0) {
      return results.rows[0]
    }

    return null
  }

  /**
   * @description Check proxy profile exists in DB by name
   * @param {string} accessInfo
   * @returns {string[]}
   */
  async checkProfileExits(accessInfo: string, tenantId = ''): Promise<boolean> {
    const results = await this.db.query(
      `
    SELECT 1
    FROM proxyconfigs 
    WHERE access_info = $1 and tenant_id = $2`,
      [accessInfo, tenantId]
    )

    if ((results?.rowCount ?? 0) > 0) {
      return true
    }

    return false
  }

  /**
   * @description Delete proxy profile from DB by name
   * @param {string} accessInfo
   * @returns {boolean} Return true on successful deletion
   */
  async delete(accessInfo: string, tenantId = ''): Promise<boolean> {
    const profiles = await this.db.query(
      `
    SELECT 1
    FROM profiles_proxyconfigs
    WHERE access_info = $1 and tenant_id = $2`,
      [accessInfo, tenantId]
    )
    if ((profiles?.rowCount ?? 0) > 0) {
      throw new RPSError(NETWORK_CONFIG_DELETION_FAILED_CONSTRAINT('Proxy', accessInfo), 'Foreign key violation')
    }
    try {
      const results = await this.db.query(
        `
      DELETE
      FROM proxyconfigs
      WHERE access_info = $1 and tenant_id = $2`,
        [accessInfo, tenantId]
      )
      if (results?.rowCount) {
        return results.rowCount > 0
      }
    } catch (error) {
      this.log.error(`Failed to delete proxy configuration : ${accessInfo}`, error)
      if (error.code === PostgresErr.C23_FOREIGN_KEY_VIOLATION) {
        throw new RPSError(NETWORK_CONFIG_DELETION_FAILED_CONSTRAINT('Proxy', accessInfo))
      }
      throw new RPSError(API_UNEXPECTED_EXCEPTION(`Delete proxy configuration : ${accessInfo}`))
    }
    return false
  }

  /**
   * @description Insert proxy profile into DB
   * @param {ProxyConfig} proxyConfig
   * @returns {ProxyConfig} Returns ProxyConfig object
   */
  async insert(proxyConfig: ProxyConfig): Promise<ProxyConfig | null> {
    try {
      const date = new Date().toISOString().replace(/T/, ' ').replace(/\..+/, '')
      const results = await this.db.query(
        `
        INSERT INTO proxyconfigs
        (access_info, info_format, port, network_dns_suffix, creation_date, tenant_id)
        values($1, $2, $3, $4, $5, $6)`,
        [
          proxyConfig.accessInfo,
          proxyConfig.infoFormat,
          proxyConfig.port,
          proxyConfig.networkDnsSuffix,
          date,
          proxyConfig.tenantId
        ]
      )

      if ((results?.rowCount ?? 0) > 0) {
        const config = await this.getByName(proxyConfig.accessInfo, proxyConfig.tenantId)
        return config
      }
    } catch (error) {
      if (error.code === PostgresErr.C23_UNIQUE_VIOLATION) {
        throw new RPSError(
          NETWORK_CONFIG_INSERTION_FAILED_DUPLICATE('Proxy', proxyConfig.accessInfo),
          'Unique key violation'
        )
      }
      throw new RPSError(NETWORK_CONFIG_ERROR('Proxy', proxyConfig.accessInfo))
    }
    return null
  }

  /**
   * @description Update proxy profile into DB
   * @param {ProxyConfig} proxyConfig
   * @returns {boolean} Returns ProxyConfig object
   */
  async update(proxyConfig: ProxyConfig): Promise<ProxyConfig | null> {
    let latestItem: ProxyConfig | null

    try {
      const results = await this.db.query(
        `
      UPDATE proxyconfigs 
      SET info_format=$2, port=$3, network_dns_suffix=$4
      WHERE access_info=$1 and tenant_id = $5`,
        [
          proxyConfig.accessInfo,
          proxyConfig.infoFormat,
          proxyConfig.port,
          proxyConfig.networkDnsSuffix,
          proxyConfig.tenantId
        ]
      )

      latestItem = await this.getByName(proxyConfig.accessInfo, proxyConfig.tenantId)
      if ((results?.rowCount ?? 0) > 0) {
        return latestItem
      }
    } catch (error) {
      throw new RPSError(NETWORK_CONFIG_ERROR('Proxy', proxyConfig.accessInfo))
    }
    // making assumption that if no records are updated, that it is due to concurrency. We've already checked for if it doesn't exist before calling update.
    throw new RPSError(CONCURRENCY_MESSAGE, CONCURRENCY_EXCEPTION, latestItem)
  }
}
