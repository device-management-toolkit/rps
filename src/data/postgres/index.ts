/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { type IDB } from '../../interfaces/database/IDb.js'
import { createHash } from 'node:crypto'
import { Client, Pool, type QueryResultRow, type QueryResult, type PoolConfig } from 'pg'
import Logger from '../../Logger.js'
import { CiraConfigTable } from './tables/ciraConfigs.js'
import { ProfilesTable } from './tables/profiles.js'
import { DomainsTable } from './tables/domains.js'
import { ProfilesWifiConfigsTable } from './tables/profileWifiConfigs.js'
import { WirelessProfilesTable } from './tables/wirelessProfiles.js'
import { IEEE8021xProfilesTable } from './tables/ieee8021xProfiles.js'
import { readFileSync } from 'fs'
import { Environment } from '../../utils/Environment.js'
import { ProxyConfigsTable } from './tables/proxyConfigs.js'
import { ProfileProxyConfigsTable } from './tables/profileProxyConfigs.js'

export default class Db implements IDB {
  pool: InstanceType<typeof Pool>
  ciraConfigs: CiraConfigTable
  domains: DomainsTable
  profiles: ProfilesTable
  wirelessProfiles: WirelessProfilesTable
  profileWirelessConfigs: ProfilesWifiConfigsTable
  ieee8021xProfiles: IEEE8021xProfilesTable
  proxyConfigs: ProxyConfigsTable
  profileProxyConfigs: ProfileProxyConfigsTable

  log: Logger = new Logger('PostgresDb')

  constructor(connectionString: string) {
    const poolConfig: PoolConfig = {
      connectionString
    }

    // Helper function to check if env var is valid (not null, undefined, or empty)
    const isValidEnvVar = (value: string | undefined | null): value is string => {
      return value != null && value.trim() !== ''
    }

    // Configure SSL if certificate paths are provided
    if (
      isValidEnvVar(Environment.Config.postgres_ssl_ca) ||
      isValidEnvVar(Environment.Config.postgres_ssl_cert) ||
      isValidEnvVar(Environment.Config.postgres_ssl_key)
    ) {
      poolConfig.ssl = {}

      try {
        if (isValidEnvVar(Environment.Config.postgres_ssl_ca)) {
          poolConfig.ssl.ca = readFileSync(Environment.Config.postgres_ssl_ca, 'utf8')
          this.log.info(`Loaded PostgreSQL SSL CA certificate from: ${Environment.Config.postgres_ssl_ca}`)
        }

        if (isValidEnvVar(Environment.Config.postgres_ssl_cert)) {
          poolConfig.ssl.cert = readFileSync(Environment.Config.postgres_ssl_cert, 'utf8')
          this.log.info(`Loaded PostgreSQL SSL client certificate from: ${Environment.Config.postgres_ssl_cert}`)
        }

        if (isValidEnvVar(Environment.Config.postgres_ssl_key)) {
          poolConfig.ssl.key = readFileSync(Environment.Config.postgres_ssl_key, 'utf8')
          this.log.info(`Loaded PostgreSQL SSL client key from: ${Environment.Config.postgres_ssl_key}`)
        }

        // Set reject unauthorized flag (defaults to true for security)
        poolConfig.ssl.rejectUnauthorized = Environment.Config.postgres_ssl_reject_unauthorized !== false

        this.log.info('PostgreSQL SSL configuration enabled')
      } catch (error) {
        this.log.error(`Failed to load PostgreSQL SSL certificates: ${error}`)
        throw new Error(`Failed to load PostgreSQL SSL certificates: ${error}`, { cause: error })
      }
    } else {
      this.log.info('PostgreSQL SSL configuration not provided, using non-SSL connection')
    }

    this.pool = new Pool(poolConfig)
    this.ciraConfigs = new CiraConfigTable(this)
    this.profiles = new ProfilesTable(this)
    this.domains = new DomainsTable(this)
    this.wirelessProfiles = new WirelessProfilesTable(this)
    this.profileWirelessConfigs = new ProfilesWifiConfigsTable(this)
    this.ieee8021xProfiles = new IEEE8021xProfilesTable(this)
    this.proxyConfigs = new ProxyConfigsTable(this)
    this.profileProxyConfigs = new ProfileProxyConfigsTable(this)
  }

  private provisioningClient(): Client {
    return new Client(this.pool.options)
  }

  // A dedicated session owns the lock through provisioning and reconciliation.
  // Closing the session releases it on completion, disconnection or process exit.
  async acquireProvisioningLock(uuid: string, onLost: () => void): Promise<(() => void) | null> {
    const client = this.provisioningClient()
    const key = createHash('sha256')
      .update(`rps-provisioning:${uuid.toLowerCase()}`)
      .digest()
      .readBigInt64BE()
      .toString()
    let released = false
    const release = (): void => {
      if (released) return
      released = true
      void client.end().catch((error) => this.log.warn(`Failed to close provisioning lock session: ${error}`))
    }
    const lost = (): void => {
      if (released) return
      onLost()
      release()
    }
    client.on('error', lost)
    client.on('end', lost)
    try {
      await client.connect()
      const result = await client.query('SELECT pg_try_advisory_lock($1::bigint) AS acquired', [key])
      if (!result.rows[0]?.acquired || released) {
        release()
        return null
      }
      return release
    } catch (error) {
      release()
      throw error
    }
  }

  async query<T extends QueryResultRow>(text: string, params?: any): Promise<QueryResult<T>> {
    const start = Date.now()
    const res = await this.pool.query<T>(text, params)
    const duration = Date.now() - start
    this.log.verbose(`executed query: ${JSON.stringify({ text, duration, rows: res.rowCount })}`)
    return res
  }
}
