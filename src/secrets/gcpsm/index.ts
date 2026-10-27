/*********************************************************************
 * Copyright (c) Intel Corporation 2026
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { backOff } from 'exponential-backoff'
import got, { type Got } from 'got'
import {
  type CertCredentials,
  type CiraConfigSecrets,
  type DeviceCredentials,
  type ISecretManagerService,
  type SecretMetadata,
  type TLSCredentials,
  type WifiCredentials
} from '../../interfaces/ISecretManagerService.js'
import { type ILogger } from '../../interfaces/ILogger.js'
import { Environment } from '../../utils/Environment.js'

type SecretData = DeviceCredentials | WifiCredentials | TLSCredentials | CertCredentials | CiraConfigSecrets

const API_URL = 'https://secretmanager.googleapis.com/v1'
// Token of the service account attached to the workload, e.g. through Workload Identity on GKE.
const METADATA_TOKEN_URL = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token'
// A cached token is replaced this long before it expires, so it does not expire mid-request.
const TOKEN_EXPIRY_MARGIN_MS = 60_000
// got has no default timeout. Without one, a hung request blocks the caller forever and, for the
// token, every later caller too, since they share the pending request. The timeout applies per
// attempt: got retries GET and DELETE twice by default, with 1 s and 2 s backoff, so a hung
// endpoint fails after about 3 * 10 s + 3 s = 33 s.
const METADATA_TIMEOUT_MS = 10_000
const API_TIMEOUT_MS = 10_000

// Canonical status names for responses whose body carries no error.status.
const HTTP_STATUS_NAMES: Record<number, string> = {
  400: 'INVALID_ARGUMENT',
  401: 'UNAUTHENTICATED',
  403: 'PERMISSION_DENIED',
  404: 'NOT_FOUND',
  409: 'ALREADY_EXISTS',
  429: 'RESOURCE_EXHAUSTED',
  500: 'INTERNAL',
  503: 'UNAVAILABLE',
  504: 'DEADLINE_EXCEEDED'
}

// Status names worth retrying. Anything else (PERMISSION_DENIED, INVALID_ARGUMENT, an invalid
// path, ...) fails the same way on every attempt.
const TRANSIENT_STATUSES = new Set([
  'DEADLINE_EXCEEDED',
  'RESOURCE_EXHAUSTED',
  'ABORTED',
  'INTERNAL',
  'UNAVAILABLE'
])

// Canonical status name of a failed request: error.status from the Google API error body, else
// derived from the HTTP status code. Without a response, the status set by fetchToken, else
// UNAVAILABLE for a request that got none (got sets a string code such as ECONNRESET).
// Undefined for anything else.
export function errorStatus(error: any): string | undefined {
  const response = error?.response
  if (response == null) {
    if (typeof error?.status === 'string') {
      return error.status
    }
    return typeof error?.code === 'string' ? 'UNAVAILABLE' : undefined
  }
  let body = response.body
  if (typeof body === 'string' || Buffer.isBuffer(body)) {
    try {
      body = JSON.parse(body.toString())
    } catch {
      body = null
    }
  }
  return (
    body?.error?.status ??
    HTTP_STATUS_NAMES[response.statusCode] ??
    (response.statusCode >= 500 ? 'INTERNAL' : undefined)
  )
}

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

// Secret Manager label values hold at most 63 characters and 128 bytes of lowercase letters,
// digits, "_" and "-". The cap is applied to code points, so no surrogate pair is split.
export function toLabelValue(hostname: string): string {
  const chars = Array.from(hostname.toLowerCase(), (c) => (/[\p{Ll}\p{Lo}\p{N}_-]/u.test(c) ? c : '_')).slice(0, 63)
  while (Buffer.byteLength(chars.join(''), 'utf8') > 128) {
    chars.pop()
  }
  return chars.join('')
}

// Endpoints and per-attempt timeouts. Only tests override the defaults.
export interface GcpsmEndpoints {
  apiUrl: string
  tokenUrl: string
  timeouts: { metadata: number; api: number }
}

export class GcpSecretManagerService implements ISecretManagerService {
  http: Got
  logger: ILogger
  project: string
  // Region new secrets are replicated to. Unset means automatic replication, which may store
  // the data in any region.
  location: string
  prefix: string
  token: { value: Promise<string>; expiresAt: number } | null = null
  readonly apiUrl: string
  readonly tokenUrl: string
  readonly timeouts: { metadata: number; api: number }

  constructor(logger: ILogger, http: Got = got, endpoints: Partial<GcpsmEndpoints> = {}) {
    this.logger = logger
    this.apiUrl = endpoints.apiUrl ?? API_URL
    this.tokenUrl = endpoints.tokenUrl ?? METADATA_TOKEN_URL
    this.timeouts = endpoints.timeouts ?? { metadata: METADATA_TIMEOUT_MS, api: API_TIMEOUT_MS }
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
    this.http = http
  }

  // Access token from the GKE / GCE metadata server, cached until shortly before it expires.
  // Concurrent callers share one request; a failed request is not cached.
  async accessToken(): Promise<string> {
    if (this.token == null || Date.now() >= this.token.expiresAt) {
      const token = { value: Promise.resolve(''), expiresAt: Number.POSITIVE_INFINITY }
      token.value = this.fetchToken(token)
      this.token = token
      token.value.catch(() => {
        if (this.token === token) {
          this.token = null
        }
      })
    }
    return await this.token.value
  }

  // Failures are reported as UNAUTHENTICATED, so a metadata server response such as 404 is not
  // mistaken for a Secret Manager one.
  async fetchToken(token: { expiresAt: number }): Promise<string> {
    try {
      const rsp: any = await this.http
        .get(this.tokenUrl, {
          headers: { 'Metadata-Flavor': 'Google' },
          timeout: { request: this.timeouts.metadata }
        })
        .json()
      if (typeof rsp?.access_token !== 'string') {
        throw new Error('response has no access_token')
      }
      // A NaN expiry would never compare as expired, so the token would be cached forever.
      const expiresIn = Number(rsp.expires_in)
      if (rsp.expires_in == null || !Number.isFinite(expiresIn)) {
        throw new Error('response has no valid expires_in')
      }
      token.expiresAt = Date.now() + expiresIn * 1000 - TOKEN_EXPIRY_MARGIN_MS
      return rsp.access_token
    } catch (error) {
      throw Object.assign(new Error(`could not get an access token from the metadata server: ${error?.message}`), {
        status: 'UNAUTHENTICATED'
      })
    }
  }

  // Calls the Secret Manager REST API. resource is relative to apiUrl and may carry a custom
  // method (":access") or a query string.
  async call(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', resource: string, json?: object): Promise<any> {
    return await this.http(`${this.apiUrl}/${resource}`, {
      method,
      json,
      headers: { authorization: `Bearer ${await this.accessToken()}` },
      timeout: { request: this.timeouts.api }
    }).json()
  }

  secretName(path: string): string {
    return `projects/${this.project}/secrets/${toSecretId(path, this.prefix)}`
  }

  // Payload of a version (a full version name, or ".../versions/latest") and its version number.
  async readVersion(name: string): Promise<{ payload: string; version: number } | null> {
    const rsp = await this.call('GET', `${name}:access`)
    const data = rsp?.payload?.data
    if (data == null) {
      return null
    }
    return { payload: Buffer.from(data, 'base64').toString('utf8'), version: versionNumber(rsp.name ?? name) }
  }

  // Latest version as a string, or null if the secret does not exist. Other errors throw.
  async readLatest(path: string): Promise<{ payload: string; version: number } | null> {
    try {
      return await this.readVersion(`${this.secretName(path)}/versions/latest`)
    } catch (error) {
      if (errorStatus(error) === 'NOT_FOUND') {
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
  async writeSecretWithObject(path: string, data: SecretData, metadata?: SecretMetadata): Promise<any> {
    const { version: _version, ...content } = data as any
    const payload = JSON.stringify(content)
    let version: number
    try {
      // A retry after a lost response may add a second version; it is older than the one
      // returned here, so destroyOlderVersions removes it.
      const name = await backOff(async () => await this.addVersion(path, payload), {
        numOfAttempts: WRITE_ATTEMPTS,
        startingDelay: 500,
        jitter: 'full',
        retry: (error: any, attempt: number) => {
          if (!TRANSIENT_STATUSES.has(errorStatus(error) ?? '')) {
            return false
          }
          this.logger.warn(`writing secret ${path} failed (attempt ${attempt}/${WRITE_ATTEMPTS}): ${error?.message}`)
          return true
        }
      })
      await this.destroyOlderVersions(path, name)
      version = versionNumber(name)
      this.logger.debug(`secret written at path: ${path}, version ${version}`)
    } catch (error) {
      this.logger.error(`writing secret ${path} failed: ${error?.message}`)
      return null
    }
    if (metadata?.hostname) {
      try {
        await this.writeSecretMetadata(path, metadata)
      } catch (error) {
        this.logger.warn(`writing secret metadata for ${path} failed: ${error?.message}`)
      }
    }
    return { version }
  }

  // Stores the device hostname as the "hostname" label. Never throws: the label is informational
  // and must not fail the write of a secret. updateMask=labels replaces the whole label map, so
  // the existing labels are read first and merged; the etag makes a concurrent label change
  // fail instead of being overwritten.
  async writeSecretMetadata(path: string, metadata: SecretMetadata): Promise<void> {
    if (
      typeof metadata.hostname !== 'string' ||
      !metadata.hostname ||
      metadata.hostname.toLowerCase() === 'localhost'
    ) {
      this.logger.debug(`skipping secret metadata write for ${path}`)
      return
    }
    try {
      const secret = await this.call('GET', this.secretName(path))
      if (typeof secret?.etag !== 'string') {
        throw new Error('secret has no etag')
      }
      const value = toLabelValue(metadata.hostname)
      if (secret?.labels?.hostname === value) {
        return
      }
      await this.call('PATCH', `${this.secretName(path)}?updateMask=labels`, {
        labels: { ...(secret?.labels ?? {}), hostname: value },
        etag: secret.etag
      })
      this.logger.debug(`secret metadata written at path: ${path}`)
    } catch (error) {
      this.logger.warn(`writing secret metadata for ${path} failed: ${errorStatus(error) ?? ''} ${error?.message}`)
    }
  }

  // Adds a version and returns its name. The secret is created only when it does not exist yet,
  // which saves a create call on every write to an existing path.
  async addVersion(path: string, payload: string): Promise<string> {
    const add = async (): Promise<string> => {
      const rsp = await this.call('POST', `${this.secretName(path)}:addVersion`, {
        payload: { data: Buffer.from(payload, 'utf8').toString('base64') }
      })
      if (rsp?.name == null) {
        throw new Error('Secret Manager returned no version name')
      }
      return rsp.name
    }
    try {
      return await add()
    } catch (error) {
      if (errorStatus(error) !== 'NOT_FOUND') {
        throw error
      }
    }
    await this.ensureSecret(path)
    return await add()
  }

  async ensureSecret(path: string): Promise<void> {
    try {
      await this.call('POST', `projects/${this.project}/secrets?secretId=${toSecretId(path, this.prefix)}`, {
        replication: this.location ? { userManaged: { replicas: [{ location: this.location }] } } : { automatic: {} },
        labels: { 'managed-by': 'rps' }
      })
    } catch (error) {
      if (errorStatus(error) !== 'ALREADY_EXISTS') {
        throw error
      }
    }
  }

  // Names of the versions of a secret that are not destroyed yet, across all result pages.
  async listVersions(path: string): Promise<string[]> {
    const filter = encodeURIComponent('state:ENABLED OR state:DISABLED')
    const names: string[] = []
    let pageToken = ''
    do {
      const page = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''
      const rsp = await this.call('GET', `${this.secretName(path)}/versions?filter=${filter}${page}`)
      for (const v of rsp?.versions ?? []) {
        if (v.name != null) {
          names.push(v.name)
        }
      }
      pageToken = rsp?.nextPageToken ?? ''
    } while (pageToken)
    return names
  }

  // Old versions hold superseded passwords and certificates: destroy them once the new one is
  // written. Only versions older than the confirmed one are destroyed. A newer version comes
  // from a concurrent write, and destroying it would leave "latest" pointing at a destroyed
  // version, so the secret could no longer be read. Best effort, a leftover version is not
  // worth failing the write for.
  async destroyOlderVersions(path: string, writtenVersionName: string): Promise<void> {
    const written = versionNumber(writtenVersionName)
    try {
      const versions = await this.listVersions(path)
      await Promise.all(
        versions
          .filter((name) => versionNumber(name) < written)
          .map(async (name) => await this.call('POST', `${name}:destroy`, {}))
      )
    } catch (error) {
      this.logger.warn(`could not destroy old versions of ${path}: ${error?.message}`)
    }
  }

  // Like Vault's metadata delete, deleting a secret that does not exist succeeds.
  async deleteSecretAtPath(path: string): Promise<boolean> {
    try {
      this.logger.verbose(`deleting secret: ${path}`)
      await this.call('DELETE', this.secretName(path))
      return true
    } catch (error) {
      if (errorStatus(error) === 'NOT_FOUND') {
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
  // Any other failure throws, like Vault, so startup keeps waiting. The error carries the status
  // name (e.g. "PERMISSION_DENIED") as healthStatus, which the health route reports.
  async health(): Promise<any> {
    try {
      await this.call('GET', this.secretName('health'))
    } catch (error) {
      const status = errorStatus(error)
      if (status !== 'NOT_FOUND') {
        this.logger.error(`Secret Manager health check failed: ${error?.message}`)
        throw Object.assign(new Error(`Secret Manager health check failed: ${error?.message}`), {
          healthStatus: status ?? 'unknown error'
        })
      }
    }
    return { initialized: true, sealed: false, provider: 'gcpsm' }
  }
}

export default GcpSecretManagerService
