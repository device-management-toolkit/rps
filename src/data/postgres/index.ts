/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { type IDB } from '../../interfaces/database/IDb.js'
import { Pool, type QueryResultRow, type QueryResult } from 'pg'
import Logger from '../../Logger.js'
import { CiraConfigTable } from './tables/ciraConfigs.js'
import { ProfilesTable } from './tables/profiles.js'
import { DomainsTable } from './tables/domains.js'
import { ProfilesWifiConfigsTable } from './tables/profileWifiConfigs.js'
import { WirelessProfilesTable } from './tables/wirelessProfiles.js'
import { IEEE8021xProfilesTable } from './tables/ieee8021xProfiles.js'

export default class Db implements IDB {
  pool: InstanceType<typeof Pool>
  ciraConfigs: CiraConfigTable
  domains: DomainsTable
  profiles: ProfilesTable
  wirelessProfiles: WirelessProfilesTable
  profileWirelessConfigs: ProfilesWifiConfigsTable
  ieee8021xProfiles: IEEE8021xProfilesTable

  log: Logger = new Logger('PostgresDb')

  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString
    })
    this.ciraConfigs = new CiraConfigTable(this)
    this.profiles = new ProfilesTable(this)
    this.domains = new DomainsTable(this)
    this.wirelessProfiles = new WirelessProfilesTable(this)
    this.profileWirelessConfigs = new ProfilesWifiConfigsTable(this)
    this.ieee8021xProfiles = new IEEE8021xProfilesTable(this)
  }

  async query<T extends QueryResultRow>(text: string, params?: any): Promise<QueryResult<T>> {
    const start = Date.now()
    const res = await this.pool.query<T>(text, params)
    const duration = Date.now() - start
    this.log.verbose(`executed query: ${JSON.stringify({ text, duration, rows: res.rowCount })}`)
    return res
  }
}
