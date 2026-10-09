/*********************************************************************
 * Copyright (c) Intel Corporation 2026
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { SecretManagerServiceClient } from '@google-cloud/secret-manager'
import { backOff } from 'exponential-backoff'
import {
  type CertCredentials,
  type CiraConfigSecrets,
  type DeviceCredentials,
  type ISecretManagerService,
  type TLSCredentials,
  type WifiCredentials
} from '../../interfaces/ISecretManagerService.js'
import { type ILogger } from '../../interfaces/ILogger.js'
import { Environment } from '../../utils/Environment.js'

type SecretData = DeviceCredentials | WifiCredentials | TLSCredentials | CertCredentials | CiraConfigSecrets

// gRPC status codes (https://grpc.io/docs/guides/status-codes/), indexed by code.
const STATUS_NAMES = [
  'OK',
  'CANCELLED',
  'UNKNOWN',
  'INVALID_ARGUMENT',
  'DEADLINE_EXCEEDED',
  'NOT_FOUND',
  'ALREADY_EXISTS',
  'PERMISSION_DENIED',
  'RESOURCE_EXHAUSTED',
  'FAILED_PRECONDITION',
  'ABORTED',
  'OUT_OF_RANGE',
  'UNIMPLEMENTED',
  'INTERNAL',
  'UNAVAILABLE',
  'DATA_LOSS',
  'UNAUTHENTICATED'
] as const
const Status = Object.fromEntries(STATUS_NAMES.map((name, code) => [name, code])) as Record<
  (typeof STATUS_NAMES)[number],
  number
>

// Codes worth retrying. Anything else (PERMISSION_DENIED, INVALID_ARGUMENT, an invalid path, ...)
// fails the same way on every attempt.
const TRANSIENT_CODES = new Set<number>([
  Status.DEADLINE_EXCEEDED,
  Status.RESOURCE_EXHAUSTED,
  Status.ABORTED,
  Status.INTERNAL,
  Status.UNAVAILABLE
])

// parseEnvValue turns an empty env value into NaN, so NaN counts as unset like "".
const isUnset = (value: unknown): boolean => value == null || value === '' || Number.isNaN(value)

// "projects/p/secrets/s/versions/3" -> 3
const versionNumber = (name: string): number => Number(name.split('/').pop())

// Every secret RPS owns starts with this prefix, so operators can restrict the service account
// to RPS's secrets with an IAM condition on resource.name. Configurable with gcpsm_secret_prefix,
// so several RPS deployments can share a project; their prefixes must not start with one another.
export const DEFAULT_SECRET_ID_PREFIX = 'rps-store-'
const WRITE_ATTEMPTS = 3

// Maps an RPS secret path (e.g. "devices/<uuid>", "profiles/acm-r1") to a Secret Manager
// secret ID, which only allows [A-Za-z0-9_-]. Path segments are joined with "__"; "_" and any
// other character outside [A-Za-z0-9-] are escaped byte by byte as "_<2 hex digits>" of its
// UTF-8 encoding. The fixed width keeps the mapping unique. Empty segments ("a//b", "/a", "a/")
// are rejected rather than dropped, so they cannot alias another path.
export function toSecretId(path: string, prefix: string = DEFAULT_SECRET_ID_PREFIX): string {
  const segments = path.split('/')
  const escaped = segments.map((s) =>
    s.replace(/[^A-Za-z0-9-]/gu, (c) =>
      Array.from(Buffer.from(c, 'utf8'), (b) => `_${b.toString(16).padStart(2, '0')}`).join('')
    )
  )
  const id = prefix + escaped.join('__')
  // A lone surrogate has no UTF-8 encoding: Buffer would replace it, so two paths could collide.
  if (segments.includes('') || id.length > 255 || /\p{Surrogate}/u.test(path)) {
    throw new Error(`invalid secret path: ${path}`)
  }
  return id
}

export class GcpSecretManagerService implements ISecretManagerService {
  client: SecretManagerServiceClient
  logger: ILogger
  project: string
  // Region new secrets are replicated to. Unset means automatic replication, which may store
  // the data in any region.
  location: string
  prefix: string

  constructor(logger: ILogger, client?: SecretManagerServiceClient) {
    this.logger = logger
    const { gcpsm_project: project, gcpsm_location: location, gcpsm_secret_prefix: prefix } = Environment.Config
    // parseEnvValue turns numeric env values into numbers, so "007" arrives as 7, and "true" or
    // "false" into booleans. The original string cannot be recovered, and using "7" would
    // silently point at other secrets.
    if (!isUnset(prefix) && typeof prefix !== 'string') {
      throw new Error('gcpsm_secret_prefix (RPS_GCPSM_SECRET_PREFIX) must not be purely numeric or a boolean')
    }
    // A numeric project number also arrives as a number.
    this.project = isUnset(project) ? '' : String(project)
    this.location = isUnset(location) ? '' : String(location)
    this.prefix = isUnset(prefix) ? DEFAULT_SECRET_ID_PREFIX : (prefix as string)
    if (!this.project) {
      throw new Error('gcpsm_project (RPS_GCPSM_PROJECT) is not set')
    }
    if (!/^[A-Za-z0-9_-]+$/u.test(this.prefix)) {
      throw new Error('gcpsm_secret_prefix (RPS_GCPSM_SECRET_PREFIX) may only contain [A-Za-z0-9_-]')
    }
    // Authenticates with Application Default Credentials (e.g. Workload Identity on GKE).
    this.client = client ?? new SecretManagerServiceClient()
  }

  secretName(path: string): string {
    return `projects/${this.project}/secrets/${toSecretId(path, this.prefix)}`
  }

  // Payload of a version (a full version name, or ".../versions/latest") and its version number.
  async readVersion(name: string): Promise<{ payload: string; version: number } | null> {
    const [rsp] = await this.client.accessSecretVersion({ name })
    const data = rsp.payload?.data
    if (data == null) {
      return null
    }
    const payload = typeof data === 'string' ? data : Buffer.from(data).toString('utf8')
    return { payload, version: versionNumber(rsp.name ?? name) }
  }

  // Latest version as a string, or null if the secret does not exist. Other errors throw.
  async readLatest(path: string): Promise<{ payload: string; version: number } | null> {
    try {
      return await this.readVersion(`${this.secretName(path)}/versions/latest`)
    } catch (error) {
      if (error?.code === Status.NOT_FOUND) {
        return null
      }
      throw error
    }
  }

  // Like Vault, empty values count as missing.
  async getSecretFromKey(path: string, key: string): Promise<string | null> {
    try {
      this.logger.verbose(`getting secret from key: ${path}, ${key}`)
      const secret: any = await this.getSecretAtPath(path)
      return secret?.[key] || null
    } catch (error) {
      this.logger.error(`getSecretFromKey error for ${path}: ${error?.message}`)
      return null
    }
  }

  // Same contract as the Vault provider: null only when the secret is absent, otherwise throws,
  // so a Secret Manager outage is never mistaken for "no secret". version is a number, as in
  // Vault's metadata.
  async getSecretAtPath(path: string): Promise<SecretData | null> {
    this.logger.verbose(`getting secrets from ${path}`)
    try {
      const latest = await this.readLatest(path)
      if (latest == null) {
        this.logger.debug(`secret not found at path: ${path}`)
        return null
      }
      const data = JSON.parse(latest.payload)
      if (data === null || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('secret payload is not a JSON object')
      }
      data.version = latest.version
      return data
    } catch (error) {
      this.logger.error(`getSecretAtPath error for ${path}: ${error?.message}`)
      throw error
    }
  }

  // Adds a new version, then destroys the older ones. Transient errors are retried with backoff;
  // permanent ones (PERMISSION_DENIED, an invalid path, ...) fail at once. Like Vault, a failed
  // write returns null; callers must check it.
  async writeSecretWithObject(path: string, data: SecretData): Promise<any> {
    const { version: _version, ...content } = data as any
    const payload = JSON.stringify(content)
    try {
      // A retry after a lost response may add a second version; it is older than the one
      // returned here, so destroyOlderVersions removes it.
      const name = await backOff(async () => await this.addVersion(path, payload), {
        numOfAttempts: WRITE_ATTEMPTS,
        startingDelay: 500,
        jitter: 'full',
        retry: (error: any, attempt: number) => {
          if (!TRANSIENT_CODES.has(error?.code)) {
            return false
          }
          this.logger.warn(`writing secret ${path} failed (attempt ${attempt}/${WRITE_ATTEMPTS}): ${error?.message}`)
          return true
        }
      })
      await this.destroyOlderVersions(path, name)
      const version = versionNumber(name)
      this.logger.debug(`secret written at path: ${path}, version ${version}`)
      return { version }
    } catch (error) {
      this.logger.error(`writing secret ${path} failed: ${error?.message}`)
      return null
    }
  }

  // Adds a version and returns its name. The secret is created only when it does not exist yet,
  // which saves a createSecret call on every write to an existing path.
  async addVersion(path: string, payload: string): Promise<string> {
    const add = async (): Promise<string> => {
      const [rsp] = await this.client.addSecretVersion({
        parent: this.secretName(path),
        payload: { data: Buffer.from(payload, 'utf8') }
      })
      if (rsp.name == null) {
        throw new Error('Secret Manager returned no version name')
      }
      return rsp.name
    }
    try {
      return await add()
    } catch (error) {
      if (error?.code !== Status.NOT_FOUND) {
        throw error
      }
    }
    await this.ensureSecret(path)
    return await add()
  }

  async ensureSecret(path: string): Promise<void> {
    try {
      await this.client.createSecret({
        parent: `projects/${this.project}`,
        secretId: toSecretId(path, this.prefix),
        secret: {
          replication: this.location ? { userManaged: { replicas: [{ location: this.location }] } } : { automatic: {} },
          labels: { 'managed-by': 'rps' }
        }
      })
    } catch (error) {
      if (error?.code !== Status.ALREADY_EXISTS) {
        throw error
      }
    }
  }

  // Old versions hold superseded passwords and certificates: destroy them once the new one is
  // written. Only versions older than the confirmed one are destroyed. A newer version comes
  // from a concurrent write, and destroying it would leave "latest" pointing at a destroyed
  // version, so the secret could no longer be read. Best effort, a leftover version is not
  // worth failing the write for.
  async destroyOlderVersions(path: string, writtenVersionName: string): Promise<void> {
    const written = versionNumber(writtenVersionName)
    try {
      const [versions] = await this.client.listSecretVersions({
        parent: this.secretName(path),
        filter: 'state:ENABLED OR state:DISABLED'
      })
      await Promise.all(
        versions
          .filter((v) => v.name != null && versionNumber(v.name) < written)
          .map(async (v) => await this.client.destroySecretVersion({ name: v.name }))
      )
    } catch (error) {
      this.logger.warn(`could not destroy old versions of ${path}: ${error?.message}`)
    }
  }

  // Like Vault's metadata delete, deleting a secret that does not exist succeeds.
  async deleteSecretAtPath(path: string): Promise<boolean> {
    try {
      this.logger.verbose(`deleting secret: ${path}`)
      await this.client.deleteSecret({ name: this.secretName(path) })
      return true
    } catch (error) {
      if (error?.code === Status.NOT_FOUND) {
        this.logger.debug(`secret to delete not found: ${path}`)
        return true
      }
      this.logger.error(`failed to delete secret ${path}: ${error?.message}`)
      return false
    }
  }

  // The health route expects Vault's health shape (initialized, sealed). Reads the metadata of a
  // fixed secret inside the prefix: listing would need project-wide access, which a prefix IAM
  // condition denies. NOT_FOUND still proves Secret Manager answered and access is allowed.
  // Any other failure throws, like Vault, so startup keeps waiting. The error carries the gRPC
  // status name (e.g. "PERMISSION_DENIED") as healthStatus, which the health route reports.
  async health(): Promise<any> {
    try {
      await this.client.getSecret({ name: this.secretName('health') })
    } catch (error) {
      if (error?.code !== Status.NOT_FOUND) {
        this.logger.error(`Secret Manager health check failed: ${error?.message}`)
        throw Object.assign(new Error(`Secret Manager health check failed: ${error?.message}`), {
          healthStatus: STATUS_NAMES[error?.code] ?? 'unknown error'
        })
      }
    }
    return { initialized: true, sealed: false, provider: 'gcpsm' }
  }
}

export default GcpSecretManagerService
