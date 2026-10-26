/*********************************************************************
 * Copyright (c) Intel Corporation 2026
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { type IDB } from '../interfaces/database/IDb.js'
import { type ILogger } from '../interfaces/ILogger.js'
import { type ISecretManagerService } from '../interfaces/ISecretManagerService.js'
import { Environment } from '../utils/Environment.js'
import {
  ciraConfigSecretPath,
  domainCertSecretPath,
  isTenantPartitionEnabled,
  profileSecretPath,
  profileTlsSecretPath,
  wirelessSecretPath,
  type TenantId
} from '../utils/secretPaths.js'

/**
 * One-time, idempotent move of tenant-owned secrets from the legacy unprefixed
 * paths to their tenant partition. Runs at startup when
 * `secrets_tenant_partition` is on and does nothing otherwise.
 *
 * The database decides ownership. A legacy secret is moved only when exactly
 * one row, across every tenant including the empty one, carries that resource
 * name. When several tenants share a name the legacy secret could belong to any
 * of them, so it is left in place and reported for an operator to resolve.
 *
 * Device credentials (`devices/{guid}`) are migrated by MPS, which owns the
 * devices table.
 */

type PathBuilder = (name: string, tenantId: TenantId) => string

interface Resource {
  table: string
  column: string
  paths: PathBuilder[]
}

interface ResourceRow {
  name: string
  tenantId: string
  owners: number | string
}

export interface TenantSecretMigrationResult {
  migrated: number
  ambiguous: number
  skipped: number
  errors: number
}

const RESOURCES: Resource[] = [
  { table: 'profiles', column: 'profile_name', paths: [profileSecretPath, profileTlsSecretPath] },
  { table: 'domains', column: 'name', paths: [domainCertSecretPath] },
  { table: 'ciraconfigs', column: 'cira_config_name', paths: [ciraConfigSecretPath] },
  { table: 'wirelessconfigs', column: 'wireless_profile_name', paths: [wirelessSecretPath] }
]

function tenantRowsQuery(resource: Resource): string {
  return `SELECT t1.${resource.column} AS name, t1.tenant_id AS "tenantId",
    (SELECT count(*) FROM ${resource.table} t2 WHERE t2.${resource.column} = t1.${resource.column}) AS owners
    FROM ${resource.table} t1
    WHERE t1.tenant_id <> ''`
}

export async function migrateTenantSecrets(
  db: IDB,
  secrets: ISecretManagerService,
  logger: ILogger
): Promise<TenantSecretMigrationResult> {
  const result: TenantSecretMigrationResult = { migrated: 0, ambiguous: 0, skipped: 0, errors: 0 }
  if (!isTenantPartitionEnabled()) {
    logger.debug('tenant secret partitioning is off; no secret migration needed')
    return result
  }
  if (Environment.Config.db_provider !== 'postgres') {
    logger.warn(
      `tenant secret migration supports the postgres db_provider only (configured: ${Environment.Config.db_provider}); migrate secrets manually`
    )
    return result
  }

  for (const resource of RESOURCES) {
    let rows: ResourceRow[]
    try {
      rows = (await db.query(tenantRowsQuery(resource))).rows ?? []
    } catch (error) {
      logger.error(`tenant secret migration: failed to list ${resource.table}: ${error}`)
      result.errors++
      continue
    }
    for (const row of rows) {
      for (const build of resource.paths) {
        await migrateOne(secrets, logger, resource, row, build, result)
      }
    }
  }

  logger.info(
    `tenant secret migration: migrated=${result.migrated} ambiguous=${result.ambiguous} skipped=${result.skipped} errors=${result.errors}`
  )
  return result
}

async function migrateOne(
  secrets: ISecretManagerService,
  logger: ILogger,
  resource: Resource,
  row: ResourceRow,
  build: PathBuilder,
  result: TenantSecretMigrationResult
): Promise<void> {
  const tenantPath = build(row.name, row.tenantId)
  const legacyPath = build(row.name, '')
  try {
    if ((await secrets.getSecretAtPath(tenantPath)) != null) {
      result.skipped++
      return
    }
    const legacy: any = await secrets.getSecretAtPath(legacyPath)
    if (legacy == null) {
      result.skipped++
      return
    }
    if (Number(row.owners) > 1) {
      logger.warn(
        `tenant secret migration: ${legacyPath} is claimed by ${row.owners} ${resource.table} rows; leaving it in place for tenant ${row.tenantId}. Resolve manually.`
      )
      result.ambiguous++
      return
    }
    const { version, ...data } = legacy
    const written = await secrets.writeSecretWithObject(tenantPath, data)
    if (written == null) {
      logger.error(`tenant secret migration: failed to write ${tenantPath}; legacy secret left in place`)
      result.errors++
      return
    }
    const deleted = await secrets.deleteSecretAtPath(legacyPath)
    if (!deleted) {
      logger.warn(
        `tenant secret migration: copied ${legacyPath} to ${tenantPath} but could not delete the legacy secret`
      )
    }
    logger.info(`tenant secret migration: moved ${legacyPath} to ${tenantPath}`)
    result.migrated++
  } catch (error) {
    logger.error(`tenant secret migration: ${legacyPath} -> ${tenantPath} failed: ${error}`)
    result.errors++
  }
}
