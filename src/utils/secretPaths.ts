/*********************************************************************
 * Copyright (c) Intel Corporation 2026
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { Environment } from './Environment.js'

/**
 * Builds the secret-store paths used by RPS, scoped to a tenant.
 *
 * Partitioning is opt-in through the `secrets_tenant_partition` setting. When
 * it is off (the default), or for the empty tenant, the historical paths are
 * used unchanged, so single-tenant deployments need no migration. When it is
 * on, a non-empty tenant is placed under a `tenants/<tenant>/` prefix so two
 * tenants that reuse the same resource name never share a secret.
 *
 * Paths are plain strings so any `ISecretManagerService` implementation,
 * including out-of-tree providers, keeps working without an interface change.
 * MPS builds device paths with the same rule, so the two settings must match.
 */

export type TenantId = string | null | undefined

/** Resource name. Optional only to mirror the template literals it replaces; callers already guarantee a value. */
type ResourceName = string | undefined

/** True when secrets are partitioned by tenant (see `secrets_tenant_partition`). */
export function isTenantPartitionEnabled(): boolean {
  return Environment.Config?.secrets_tenant_partition === true
}

/**
 * Encodes a tenant id as a single, reversible path segment made only of
 * `[A-Za-z0-9-_.!~*'()]`, so a tenant id containing `/`, `%` or whitespace
 * cannot produce extra path segments or collide with another tenant.
 * UUID-style tenant ids, and any id made of letters, digits, `_` and `-`, are
 * returned unchanged; `.` is the escape character.
 */
export function tenantSegment(tenantId: string): string {
  return encodeURIComponent(tenantId).replace(/\./g, '%2E').replace(/%/g, '.')
}

function tenantPrefix(tenantId: TenantId): string {
  const tenant = tenantId ?? ''
  if (tenant === '' || !isTenantPartitionEnabled()) {
    return ''
  }
  return `tenants/${tenantSegment(tenant)}/`
}

/** AMT and MEBx passwords for a profile that does not generate random passwords. */
export function profileSecretPath(profileName: ResourceName, tenantId: TenantId): string {
  return `${tenantPrefix(tenantId)}profiles/${profileName}`
}

/** Self-signed TLS root and issued certificates for a profile. */
export function profileTlsSecretPath(profileName: ResourceName, tenantId: TenantId): string {
  return `${tenantPrefix(tenantId)}TLS/${profileName}`
}

/** Provisioning certificate and password for a domain. */
export function domainCertSecretPath(profileName: ResourceName, tenantId: TenantId): string {
  return `${tenantPrefix(tenantId)}certs/${profileName}`
}

/** MPS password for a CIRA configuration. */
export function ciraConfigSecretPath(configName: ResourceName, tenantId: TenantId): string {
  return `${tenantPrefix(tenantId)}CIRAConfigs/${configName}`
}

/** PSK passphrase for a wireless configuration. */
export function wirelessSecretPath(profileName: ResourceName, tenantId: TenantId): string {
  return `${tenantPrefix(tenantId)}Wireless/${profileName}`
}

/** Per-device AMT, MEBx and MPS credentials plus the TLS leaf certificate. */
export function deviceSecretPath(guid: ResourceName, tenantId: TenantId): string {
  return `${tenantPrefix(tenantId)}devices/${guid}`
}
