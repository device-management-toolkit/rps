/*********************************************************************
 * Copyright (c) Intel Corporation 2026
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { Environment } from '../utils/Environment.js'
import { migrateTenantSecrets } from './tenantMigration.js'

interface Row {
  name: string
  tenantId: string
  owners: number
}

describe('tenant secret migration', () => {
  let store: Record<string, any>
  let tables: Record<string, Row[]>
  let db: any
  let secrets: any
  let logger: any

  beforeEach(() => {
    Environment.Config = { secrets_tenant_partition: true, db_provider: 'postgres' } as any
    store = {}
    tables = { profiles: [], domains: [], ciraconfigs: [], wirelessconfigs: [] }
    db = {
      query: vi.fn(async (text: string) => {
        const table = Object.keys(tables).find((t) => text.includes(`FROM ${t} t1`))
        return { rows: table ? tables[table] : [] }
      })
    }
    secrets = {
      getSecretAtPath: vi.fn(async (path: string) => store[path] ?? null),
      writeSecretWithObject: vi.fn(async (path: string, data: any) => {
        store[path] = data
        return { data }
      }),
      deleteSecretAtPath: vi.fn(async (path: string) => {
        delete store[path]
        return true
      })
    }
    logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), verbose: vi.fn(), silly: vi.fn() }
  })

  it('does nothing when partitioning is off', async () => {
    Environment.Config = { secrets_tenant_partition: false, db_provider: 'postgres' } as any
    const result = await migrateTenantSecrets(db, secrets, logger)
    expect(result).toEqual({ migrated: 0, ambiguous: 0, skipped: 0, errors: 0 })
    expect(db.query).not.toHaveBeenCalled()
  })

  it('does nothing for an unsupported db provider', async () => {
    Environment.Config = { secrets_tenant_partition: true, db_provider: 'mongo' } as any
    const result = await migrateTenantSecrets(db, secrets, logger)
    expect(result).toEqual({ migrated: 0, ambiguous: 0, skipped: 0, errors: 0 })
    expect(db.query).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalled()
  })

  it('moves a legacy secret with a single owner to the tenant path and strips the vault version', async () => {
    tables.profiles = [{ name: 'p1', tenantId: 'tenant-a', owners: 1 }]
    store['profiles/p1'] = { AMT_PASSWORD: 'amt', MEBX_PASSWORD: 'mebx', version: 3 }
    store['TLS/p1'] = { ROOT_CERTIFICATE: 'root', ISSUED_CERTIFICATE: 'issued', version: 1 }

    const result = await migrateTenantSecrets(db, secrets, logger)

    expect(result).toEqual({ migrated: 2, ambiguous: 0, skipped: 0, errors: 0 })
    expect(store['tenants/tenant-a/profiles/p1']).toEqual({ AMT_PASSWORD: 'amt', MEBX_PASSWORD: 'mebx' })
    expect(store['tenants/tenant-a/TLS/p1']).toEqual({ ROOT_CERTIFICATE: 'root', ISSUED_CERTIFICATE: 'issued' })
    expect(store['profiles/p1']).toBeUndefined()
    expect(store['TLS/p1']).toBeUndefined()
  })

  it('migrates every resource type', async () => {
    tables.domains = [{ name: 'd1', tenantId: 'tenant-a', owners: 1 }]
    tables.ciraconfigs = [{ name: 'c1', tenantId: 'tenant-b', owners: 1 }]
    tables.wirelessconfigs = [{ name: 'w1', tenantId: 'tenant-a', owners: 1 }]
    store['certs/d1'] = { CERT: 'cert', CERT_PASSWORD: 'pw' }
    store['CIRAConfigs/c1'] = { MPS_PASSWORD: 'mps' }
    store['Wireless/w1'] = { PSK_PASSPHRASE: 'psk' }

    const result = await migrateTenantSecrets(db, secrets, logger)

    expect(result.migrated).toBe(3)
    expect(store['tenants/tenant-a/certs/d1']).toEqual({ CERT: 'cert', CERT_PASSWORD: 'pw' })
    expect(store['tenants/tenant-b/CIRAConfigs/c1']).toEqual({ MPS_PASSWORD: 'mps' })
    expect(store['tenants/tenant-a/Wireless/w1']).toEqual({ PSK_PASSPHRASE: 'psk' })
    expect(Object.keys(store)).toHaveLength(3)
  })

  it('leaves a legacy secret claimed by several tenants in place and reports it', async () => {
    tables.ciraconfigs = [
      { name: 'c1', tenantId: 'tenant-a', owners: 2 },
      { name: 'c1', tenantId: 'tenant-b', owners: 2 }
    ]
    store['CIRAConfigs/c1'] = { MPS_PASSWORD: 'whose?' }

    const result = await migrateTenantSecrets(db, secrets, logger)

    expect(result).toEqual({ migrated: 0, ambiguous: 2, skipped: 0, errors: 0 })
    expect(secrets.writeSecretWithObject).not.toHaveBeenCalled()
    expect(secrets.deleteSecretAtPath).not.toHaveBeenCalled()
    expect(store['CIRAConfigs/c1']).toEqual({ MPS_PASSWORD: 'whose?' })
    expect(logger.warn).toHaveBeenCalledTimes(2)
  })

  it('treats the empty tenant as an owner of the legacy path', async () => {
    // owners counts rows across every tenant, including '', so a name shared with the
    // empty tenant is ambiguous even though only one non-empty tenant row is listed.
    tables.domains = [{ name: 'd1', tenantId: 'tenant-a', owners: 2 }]
    store['certs/d1'] = { CERT: 'cert', CERT_PASSWORD: 'pw' }

    const result = await migrateTenantSecrets(db, secrets, logger)

    expect(result.ambiguous).toBe(1)
    expect(store['certs/d1']).toBeDefined()
    expect(store['tenants/tenant-a/certs/d1']).toBeUndefined()
  })

  it('skips a secret that already exists at the tenant path', async () => {
    tables.wirelessconfigs = [{ name: 'w1', tenantId: 'tenant-a', owners: 1 }]
    store['tenants/tenant-a/Wireless/w1'] = { PSK_PASSPHRASE: 'new' }
    store['Wireless/w1'] = { PSK_PASSPHRASE: 'old' }

    const result = await migrateTenantSecrets(db, secrets, logger)

    expect(result).toEqual({ migrated: 0, ambiguous: 0, skipped: 1, errors: 0 })
    expect(secrets.writeSecretWithObject).not.toHaveBeenCalled()
    expect(store['tenants/tenant-a/Wireless/w1']).toEqual({ PSK_PASSPHRASE: 'new' })
    expect(store['Wireless/w1']).toEqual({ PSK_PASSPHRASE: 'old' })
  })

  it('skips a row with no legacy secret', async () => {
    tables.domains = [{ name: 'd1', tenantId: 'tenant-a', owners: 1 }]

    const result = await migrateTenantSecrets(db, secrets, logger)

    expect(result).toEqual({ migrated: 0, ambiguous: 0, skipped: 1, errors: 0 })
    expect(secrets.writeSecretWithObject).not.toHaveBeenCalled()
  })

  it('is idempotent', async () => {
    tables.profiles = [{ name: 'p1', tenantId: 'tenant-a', owners: 1 }]
    store['profiles/p1'] = { AMT_PASSWORD: 'amt' }

    const first = await migrateTenantSecrets(db, secrets, logger)
    const second = await migrateTenantSecrets(db, secrets, logger)

    expect(first.migrated).toBe(1)
    expect(second).toEqual({ migrated: 0, ambiguous: 0, skipped: 2, errors: 0 })
    expect(store['tenants/tenant-a/profiles/p1']).toEqual({ AMT_PASSWORD: 'amt' })
  })

  it('keeps the legacy secret when the tenant write fails', async () => {
    tables.domains = [{ name: 'd1', tenantId: 'tenant-a', owners: 1 }]
    store['certs/d1'] = { CERT: 'cert', CERT_PASSWORD: 'pw' }
    secrets.writeSecretWithObject.mockResolvedValue(null)

    const result = await migrateTenantSecrets(db, secrets, logger)

    expect(result).toEqual({ migrated: 0, ambiguous: 0, skipped: 0, errors: 1 })
    expect(secrets.deleteSecretAtPath).not.toHaveBeenCalled()
    expect(store['certs/d1']).toBeDefined()
  })

  it('counts the move when the legacy delete fails and warns', async () => {
    tables.domains = [{ name: 'd1', tenantId: 'tenant-a', owners: 1 }]
    store['certs/d1'] = { CERT: 'cert', CERT_PASSWORD: 'pw' }
    secrets.deleteSecretAtPath.mockResolvedValue(false)

    const result = await migrateTenantSecrets(db, secrets, logger)

    expect(result.migrated).toBe(1)
    expect(store['tenants/tenant-a/certs/d1']).toBeDefined()
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('could not delete'))
  })

  it('counts a secret store error and continues with the next secret', async () => {
    tables.domains = [
      { name: 'd1', tenantId: 'tenant-a', owners: 1 },
      { name: 'd2', tenantId: 'tenant-a', owners: 1 }
    ]
    store['certs/d2'] = { CERT: 'cert', CERT_PASSWORD: 'pw' }
    secrets.getSecretAtPath.mockImplementation(async (path: string) => {
      if (path.endsWith('/d1')) throw new Error('vault sealed')
      return store[path] ?? null
    })

    const result = await migrateTenantSecrets(db, secrets, logger)

    expect(result).toEqual({ migrated: 1, ambiguous: 0, skipped: 0, errors: 1 })
    expect(store['tenants/tenant-a/certs/d2']).toBeDefined()
  })

  it('counts a database error for one table and continues with the others', async () => {
    tables.domains = [{ name: 'd1', tenantId: 'tenant-a', owners: 1 }]
    store['certs/d1'] = { CERT: 'cert', CERT_PASSWORD: 'pw' }
    db.query.mockImplementation(async (text: string) => {
      if (text.includes('FROM profiles t1')) throw new Error('relation missing')
      return { rows: text.includes('FROM domains t1') ? tables.domains : [] }
    })

    const result = await migrateTenantSecrets(db, secrets, logger)

    expect(result).toEqual({ migrated: 1, ambiguous: 0, skipped: 0, errors: 1 })
  })

  it('never throws', async () => {
    db.query.mockRejectedValue(new Error('down'))
    await expect(migrateTenantSecrets(db, secrets, logger)).resolves.toEqual({
      migrated: 0,
      ambiguous: 0,
      skipped: 0,
      errors: 4
    })
  })
})
