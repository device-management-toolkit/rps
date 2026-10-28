/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import got, { HTTPError, type Got } from 'got'
import { type IDB } from '../../interfaces/database/IDb.js'
import { type ICiraConfigTable } from '../../interfaces/database/ICiraConfigDb.js'
import { type IDomainsTable } from '../../interfaces/database/IDomainsDb.js'
import { type IIEEE8021xProfileTable } from '../../interfaces/database/IIEEE8021xProfilesDB.js'
import { type IProfilesTable } from '../../interfaces/database/IProfilesDb.js'
import { type IProfilesWifiConfigsTable } from '../../interfaces/database/IProfileWifiConfigsDb.js'
import { type IWirelessProfilesTable } from '../../interfaces/database/IWirelessProfilesDB.js'
import { type IProfileProxyConfigsTable } from '../../interfaces/database/IProfileProxyConfigsDb.js'
import { type IProxyConfigsTable } from '../../interfaces/database/IProxyConfigsDB.js'
import { type AMTConfiguration, type AMTDomain } from '../../models/index.js'
import {
  type CIRAConfig,
  type Ieee8021xConfig,
  type ProfileProxyConfigs,
  type ProfileWifiConfigs,
  type ProxyConfig,
  type WirelessConfig
} from '../../models/RCS.Config.js'
import { CONSOLE_READ_ONLY, DEFAULT_SKIP, DEFAULT_TOP } from '../../utils/constants.js'
import { Environment } from '../../utils/Environment.js'
import { RPSError } from '../../utils/RPSError.js'
import Logger from '../../Logger.js'

/** Console resolves the request tenant from this header; absent means the empty tenant. */
export const TENANT_HEADER = 'x-tenant-id'

/** Authenticates RPS to Console's service-only routes (e.g. profile secrets). See AUTH_SERVICE_TOKEN. */
export const SERVICE_TOKEN_HEADER = 'x-service-token'

/** Console caps `$top` at 500 (MaxPageSize), which bounds the domain suffix scan below. */
const CONSOLE_MAX_TOP = 500

/** Read-only ITable over one Console admin collection (OData `$top`/`$skip`/`$count`); writes throw. */
abstract class ConsoleTable<T> {
  db: ConsoleDb
  log: Logger

  /** Console admin collection path, no leading slash (got's prefixUrl joins it). */
  protected abstract readonly path: string
  /** What the object is called in the read-only error. */
  protected abstract readonly objectName: string

  constructor(db: ConsoleDb) {
    this.db = db
    this.log = new Logger(this.constructor.name)
  }

  async getCount(tenantId = ''): Promise<number> {
    const result = await this.db.get<{ totalCount: number }>(`${this.path}?$top=1&$count=true`, tenantId)
    return result?.totalCount ?? 0
  }

  async get(top: number = DEFAULT_TOP, skip: number = DEFAULT_SKIP, tenantId = ''): Promise<T[]> {
    return (await this.db.get<T[]>(`${this.path}?$top=${top}&$skip=${skip}`, tenantId)) ?? []
  }

  async getByName(name: string, tenantId = ''): Promise<T | null> {
    return await this.db.get<T>(`${this.path}/${encodeURIComponent(name)}`, tenantId)
  }

  async delete(name: string, tenantId?: string): Promise<boolean> {
    throw new RPSError(CONSOLE_READ_ONLY(this.objectName), 'ConsoleReadOnly')
  }

  async insert(item: T): Promise<T | null> {
    throw new RPSError(CONSOLE_READ_ONLY(this.objectName), 'ConsoleReadOnly')
  }

  async update(item: T): Promise<T | null> {
    throw new RPSError(CONSOLE_READ_ONLY(this.objectName), 'ConsoleReadOnly')
  }
}

/** MPS password is omitted from the response; ciraConfiguration reads it from Vault instead. */
class CiraConfigTable extends ConsoleTable<CIRAConfig> implements ICiraConfigTable {
  protected readonly path = 'api/v1/admin/ciraconfigs'
  protected readonly objectName = 'CIRA config'
}

/** `amtPassword`/`mebxPassword` are omitted from the response; ProfileManager reads them via getSecretsByName. */
class ProfilesTable extends ConsoleTable<AMTConfiguration> implements IProfilesTable {
  protected readonly path = 'api/v1/admin/profiles'
  protected readonly objectName = 'AMT profile'

  async getCiraConfigForProfile(configName: string, tenantId = ''): Promise<CIRAConfig | null> {
    return await this.db.ciraConfigs.getByName(configName, tenantId)
  }

  async get8021XConfigForProfile(profileName: string, tenantId = ''): Promise<Ieee8021xConfig | null> {
    return await this.db.ieee8021xProfiles.getByName(profileName, tenantId)
  }

  /** Service-token-gated route; the only place Console returns amtPassword/mebxPassword. */
  async getSecretsByName(
    profileName: string,
    tenantId = ''
  ): Promise<{ profileName: string; amtPassword?: string; mebxPassword?: string } | null> {
    return await this.db.get(`${this.path}/${encodeURIComponent(profileName)}/secrets`, tenantId)
  }
}

class DomainsTable extends ConsoleTable<AMTDomain> implements IDomainsTable {
  protected readonly path = 'api/v1/admin/domains'
  protected readonly objectName = 'domain'

  /** Console has no suffix-lookup route, so the domain collection is paged and scanned. */
  async getDomainByDomainSuffix(domainSuffix: string, tenantId = ''): Promise<AMTDomain | null> {
    for (let skip = 0; ; skip += CONSOLE_MAX_TOP) {
      const page = await this.get(CONSOLE_MAX_TOP, skip, tenantId)
      const match = page.find((domain) => domain.domainSuffix === domainSuffix)
      if (match) {
        return match
      }
      if (page.length < CONSOLE_MAX_TOP) {
        return null
      }
    }
  }
}

/** PSK passphrase is omitted from the response; wifiNetworkConfiguration reads it from Vault. */
class WirelessProfilesTable extends ConsoleTable<WirelessConfig> implements IWirelessProfilesTable {
  protected readonly path = 'api/v1/admin/wirelessconfigs'
  protected readonly objectName = 'wireless config'

  async checkProfileExits(configName: string, tenantId = ''): Promise<boolean> {
    return (await this.getByName(configName, tenantId)) != null
  }
}

class IEEE8021xProfilesTable extends ConsoleTable<Ieee8021xConfig> implements IIEEE8021xProfileTable {
  protected readonly path = 'api/v1/admin/ieee8021xconfigs'
  protected readonly objectName = '802.1x config'

  async checkProfileExits(profileName: string, tenantId = ''): Promise<boolean> {
    return (await this.getByName(profileName, tenantId)) != null
  }
}

/** No separate route for the profile-wireless link; Console returns `wifiConfigs` on the profile. */
class ProfilesWifiConfigsTable implements IProfilesWifiConfigsTable {
  db: ConsoleDb

  constructor(db: ConsoleDb) {
    this.db = db
  }

  async getProfileWifiConfigs(profileName: string, tenantId = ''): Promise<ProfileWifiConfigs[]> {
    const profile = await this.db.profiles.getByName(profileName, tenantId)
    return profile?.wifiConfigs ?? []
  }

  async deleteProfileWifiConfigs(profileName: string, tenantId: string): Promise<boolean> {
    throw new RPSError(CONSOLE_READ_ONLY('wireless config association'), 'ConsoleReadOnly')
  }

  async createProfileWifiConfigs(
    wifiConfigs: ProfileWifiConfigs[],
    profileName: string,
    tenantId?: string
  ): Promise<boolean> {
    throw new RPSError(CONSOLE_READ_ONLY('wireless config association'), 'ConsoleReadOnly')
  }
}

/** Console has no proxy config entity; empty is the correct read, not an error. */
class ProxyConfigsTable implements IProxyConfigsTable {
  async getCount(tenantId?: string): Promise<number> {
    return 0
  }

  async get(limit: number, offset: number, tenantId?: string): Promise<ProxyConfig[]> {
    return []
  }

  async getByName(name: string, tenantId?: string): Promise<ProxyConfig | null> {
    return null
  }

  async checkProfileExits(configName: string, tenantId?: string): Promise<boolean> {
    return false
  }

  async delete(name: string, tenantId?: string): Promise<boolean> {
    throw new RPSError(CONSOLE_READ_ONLY('proxy config'), 'ConsoleReadOnly')
  }

  async insert(item: ProxyConfig): Promise<ProxyConfig | null> {
    throw new RPSError(CONSOLE_READ_ONLY('proxy config'), 'ConsoleReadOnly')
  }

  async update(item: ProxyConfig): Promise<ProxyConfig | null> {
    throw new RPSError(CONSOLE_READ_ONLY('proxy config'), 'ConsoleReadOnly')
  }
}

/** No proxy configs, so no associations either. See ProxyConfigsTable. */
class ProfileProxyConfigsTable implements IProfileProxyConfigsTable {
  async getProfileProxyConfigs(profileName: string): Promise<ProfileProxyConfigs[]> {
    return []
  }

  async deleteProfileProxyConfigs(profileName: string, tenantId: string): Promise<boolean> {
    throw new RPSError(CONSOLE_READ_ONLY('proxy config association'), 'ConsoleReadOnly')
  }

  async createProfileProxyConfigs(
    proxyConfigs: ProfileProxyConfigs[],
    profileName: string,
    tenantId?: string
  ): Promise<boolean> {
    throw new RPSError(CONSOLE_READ_ONLY('proxy config association'), 'ConsoleReadOnly')
  }
}

/**
 * Configuration provider for RPS_MODE=console: reads profiles, CIRA, wireless, 802.1x and
 * domain configuration from Console's admin API instead of a database. Read-only; writes throw.
 * Secrets never travel on this API — RPS reads those from the shared Vault.
 */
export default class ConsoleDb implements IDB {
  client: Got
  ciraConfigs: CiraConfigTable
  domains: DomainsTable
  profiles: ProfilesTable
  wirelessProfiles: WirelessProfilesTable
  profileWirelessConfigs: ProfilesWifiConfigsTable
  ieee8021xProfiles: IEEE8021xProfilesTable
  proxyConfigs: ProxyConfigsTable
  profileProxyConfigs: ProfileProxyConfigsTable

  log: Logger = new Logger('ConsoleDb')

  /** @param connectionString ignored; there is no database in this mode. */
  constructor(connectionString?: string) {
    // Trailing slashes break got's prefixUrl + path join.
    const baseUrl = (Environment.Config.mps_server ?? '').replace(/\/+$/, '')
    if (!baseUrl) {
      throw new Error('console mode requires mps_server to point at Console')
    }
    this.log.info(`console mode: reading configuration from ${baseUrl}`)
    this.client = got.extend({ prefixUrl: baseUrl })

    this.ciraConfigs = new CiraConfigTable(this)
    this.profiles = new ProfilesTable(this)
    this.domains = new DomainsTable(this)
    this.wirelessProfiles = new WirelessProfilesTable(this)
    this.profileWirelessConfigs = new ProfilesWifiConfigsTable(this)
    this.ieee8021xProfiles = new IEEE8021xProfilesTable(this)
    this.proxyConfigs = new ProxyConfigsTable()
    this.profileProxyConfigs = new ProfileProxyConfigsTable()
  }

  /** GET a Console admin object; returns null on 404. */
  async get<T>(path: string, tenantId = ''): Promise<T | null> {
    const headers: Record<string, string> = {}
    // Only send the tenant header when there is a tenant.
    if (tenantId) {
      headers[TENANT_HEADER] = tenantId
    }
    // Harmless on routes that ignore it; required on the service-token-gated ones (e.g. secrets).
    if (Environment.Config.console_service_token) {
      headers[SERVICE_TOKEN_HEADER] = Environment.Config.console_service_token
    }
    try {
      return await this.client.get(path, { headers }).json<T>()
    } catch (error) {
      if (error instanceof HTTPError && error.response?.statusCode === 404) {
        this.log.debug(`not found in console: ${path}`)
        return null
      }
      // Rethrown: a Console outage must not read as "the object does not exist".
      this.log.error(`failed to GET ${path} from console`, error)
      throw error
    }
  }

  /** Startup probe for waitForDB; text/params are ignored. */
  async query(text: string, params?: any): Promise<{ rows: any[]; rowCount: number }> {
    await this.client.get('healthz')
    return { rows: [], rowCount: 0 }
  }
}
