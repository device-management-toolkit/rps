/*********************************************************************
 * Copyright (c) Intel Corporation 2026
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

/**
 * Catalog of provisioning failure codes.
 *
 * This module is pure data plus lookups. It owns the mapping from a failure code to a
 * human-readable description, and from the two raw failure sources RPS sees (AMT / CIM
 * method return values and thrown transport errors) to a code. Adding a new code is a table
 * row here; the state machines never change when a code is introduced.
 *
 * Code families:
 *   AMT_PT_*   AMT PT_STATUS method return values
 *   AMT_WIFI_* AMT_WiFiPortConfigurationService method return values
 *   CIM_RV_*   CIM method return values (RequestStateChange etc.)
 *   IPS_RV_*   IPS_HostBasedSetupService method return values (Setup, AdminSetup, UpgradeClientToAdmin)
 *   WSMAN_*    WSMAN transport layer (timeouts, TLS tunnel, HTTP status, parse)
 *   RPS_*      RPS-side failures (database, secrets, MPS, Enterprise Assistant, configuration)
 */

import {
  CONNECTION_RESET_ERROR,
  EA_TIMEOUT_ERROR,
  GATEWAY_TIMEOUT_ERROR,
  TLS_TUNNEL_ERROR,
  UNEXPECTED_PARSE_ERROR
} from './constants.js'
import { getPTStatus } from './PTStatus.js'
import { RPSError } from './RPSError.js'

/**
 * Which table decodes a method ReturnValue. The numbers overlap between tables, so the caller
 * must name the right one:
 *   AMT       PT_STATUS (most AMT_* services)
 *   CIM       DMTF method return codes (RequestStateChange etc.)
 *   IPS       IPS_HostBasedSetupService Setup / AdminSetup / UpgradeClientToAdmin (0-6), PT_STATUS otherwise
 *   WIFI      AMT_WiFiPortConfigurationService AddWiFiSettings / UpdateWiFiSettings (1-4), PT_STATUS otherwise
 *   UNMAPPED  no trusted table: the step code is kept and the raw number rides in AmtReturnValue
 */
export type ReturnValueNamespace = 'AMT' | 'CIM' | 'IPS' | 'WIFI' | 'UNMAPPED'

export interface ResolvedCode {
  code: string
  reason: string
}

export interface ResolvedReturnValue extends ResolvedCode {
  /** Firmware-side symbolic name, e.g. PT_STATUS_UNSUPPORTED or CIM_NOT_SUPPORTED */
  name: string
  value: number
}

export interface ResolvedError extends ResolvedCode {
  httpStatus?: number
  /** Underlying error text when it adds information beyond the catalog description */
  detail?: string
}

// ---------------------------------------------------------------------------------------------
// RPS-side and transport codes
// ---------------------------------------------------------------------------------------------

export const ErrorCodes = {
  // WSMAN transport
  WSMAN_TIMEOUT: 'WSMAN_TIMEOUT',
  WSMAN_PARSE_ERROR: 'WSMAN_PARSE_ERROR',
  WSMAN_CONNECTION_RESET: 'WSMAN_CONNECTION_RESET',
  WSMAN_TLS_TUNNEL_FAILED: 'WSMAN_TLS_TUNNEL_FAILED',
  WSMAN_AUTH_FAILED: 'WSMAN_AUTH_FAILED',
  WSMAN_BAD_REQUEST: 'WSMAN_BAD_REQUEST',
  WSMAN_SERVER_ERROR: 'WSMAN_SERVER_ERROR',
  WSMAN_HTTP_ERROR: 'WSMAN_HTTP_ERROR',
  WSMAN_REQUEST_FAILED: 'WSMAN_REQUEST_FAILED',
  // Database
  RPS_DB_PROFILE_NOT_FOUND: 'RPS_DB_PROFILE_NOT_FOUND',
  RPS_DB_DOMAIN_NOT_FOUND: 'RPS_DB_DOMAIN_NOT_FOUND',
  RPS_DB_WIFI_PROFILE_NOT_FOUND: 'RPS_DB_WIFI_PROFILE_NOT_FOUND',
  RPS_DB_IEEE8021X_PROFILE_NOT_FOUND: 'RPS_DB_IEEE8021X_PROFILE_NOT_FOUND',
  RPS_DB_CIRA_CONFIG_NOT_FOUND: 'RPS_DB_CIRA_CONFIG_NOT_FOUND',
  RPS_DB_PROXY_CONFIG_NOT_FOUND: 'RPS_DB_PROXY_CONFIG_NOT_FOUND',
  // Secrets
  RPS_SECRETS_READ_FAILED: 'RPS_SECRETS_READ_FAILED',
  RPS_SECRETS_WRITE_FAILED: 'RPS_SECRETS_WRITE_FAILED',
  RPS_SECRETS_DELETE_FAILED: 'RPS_SECRETS_DELETE_FAILED',
  RPS_SECRETS_MPS_ROOT_KEY: 'RPS_SECRETS_MPS_ROOT_KEY',
  // MPS
  RPS_MPS_SAVE_DEVICE_FAILED: 'RPS_MPS_SAVE_DEVICE_FAILED',
  RPS_MPS_TENANT_MISMATCH: 'RPS_MPS_TENANT_MISMATCH',
  // Enterprise Assistant
  RPS_EA_TIMEOUT: 'RPS_EA_TIMEOUT',
  RPS_EA_REQUEST_FAILED: 'RPS_EA_REQUEST_FAILED',
  // Certificates / TLS provisioning
  RPS_CERT_DOMAIN_SUFFIX_MISMATCH: 'RPS_CERT_DOMAIN_SUFFIX_MISMATCH',
  RPS_CERT_EXTRACT_FAILED: 'RPS_CERT_EXTRACT_FAILED',
  RPS_CERT_INVALID: 'RPS_CERT_INVALID',
  RPS_CERT_GENERATION_FAILED: 'RPS_CERT_GENERATION_FAILED',
  RPS_TLS_TUNNEL_INIT_FAILED: 'RPS_TLS_TUNNEL_INIT_FAILED',
  RPS_TLS_PORT_SWITCH_FAILED: 'RPS_TLS_PORT_SWITCH_FAILED',
  // Configuration / validation
  RPS_CONFIG_INVALID_DIGEST_REALM: 'RPS_CONFIG_INVALID_DIGEST_REALM',
  RPS_CONFIG_INVALID_PROFILE: 'RPS_CONFIG_INVALID_PROFILE',
  // Flow
  RPS_ACTIVATION_FAILED: 'RPS_ACTIVATION_FAILED',
  RPS_ACTIVATION_DEACTIVATED_AFTER_FAILURE: 'RPS_ACTIVATION_DEACTIVATED_AFTER_FAILURE',
  RPS_DEACTIVATION_FAILED: 'RPS_DEACTIVATION_FAILED',
  RPS_NO_VALID_NEXT_STATE: 'RPS_NO_VALID_NEXT_STATE',
  RPS_INTERNAL_ERROR: 'RPS_INTERNAL_ERROR',
  RPS_UNEXPECTED_ERROR: 'RPS_UNEXPECTED_ERROR'
} as const

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes]

const DESCRIPTIONS: Record<ErrorCode, string> = {
  WSMAN_TIMEOUT: 'Timed out waiting for a WSMAN response from AMT',
  WSMAN_PARSE_ERROR: 'AMT returned a WSMAN response that could not be parsed',
  WSMAN_CONNECTION_RESET: 'Connection to AMT was reset while waiting for a WSMAN response',
  WSMAN_TLS_TUNNEL_FAILED: 'TLS tunnel to AMT failed',
  WSMAN_AUTH_FAILED: 'AMT rejected the digest credentials (HTTP 401)',
  WSMAN_BAD_REQUEST: 'AMT rejected the WSMAN request as malformed (HTTP 400)',
  WSMAN_SERVER_ERROR: 'AMT returned an internal server error for the WSMAN request',
  WSMAN_HTTP_ERROR: 'AMT returned an unexpected HTTP status for the WSMAN request',
  WSMAN_REQUEST_FAILED: 'WSMAN request to AMT failed',
  RPS_DB_PROFILE_NOT_FOUND: 'AMT profile could not be read from the database',
  RPS_DB_DOMAIN_NOT_FOUND: 'AMT domain could not be read from the database',
  RPS_DB_WIFI_PROFILE_NOT_FOUND: 'Wireless profile could not be read from the database',
  RPS_DB_IEEE8021X_PROFILE_NOT_FOUND: '802.1x profile could not be read from the database',
  RPS_DB_CIRA_CONFIG_NOT_FOUND: 'CIRA configuration could not be read from the database',
  RPS_DB_PROXY_CONFIG_NOT_FOUND: 'Proxy configuration could not be read from the database',
  RPS_SECRETS_READ_FAILED: 'Secret could not be read from the secret provider',
  RPS_SECRETS_WRITE_FAILED: 'Secret could not be written to the secret provider',
  RPS_SECRETS_DELETE_FAILED: 'Secret could not be deleted from the secret provider',
  RPS_SECRETS_MPS_ROOT_KEY: 'MPS root certificate key could not be read from the secret provider',
  RPS_MPS_SAVE_DEVICE_FAILED: 'Device information could not be saved to MPS',
  RPS_MPS_TENANT_MISMATCH: 'Device belongs to another tenant',
  RPS_EA_TIMEOUT: 'Timed out waiting for Enterprise Assistant',
  RPS_EA_REQUEST_FAILED: 'Enterprise Assistant request failed',
  RPS_CERT_DOMAIN_SUFFIX_MISMATCH: 'Device DNS suffix does not match any configured AMT domain',
  RPS_CERT_EXTRACT_FAILED: 'Provisioning certificate could not be extracted',
  RPS_CERT_INVALID: 'Provisioning certificate is not valid for this device',
  RPS_CERT_GENERATION_FAILED: 'Certificate could not be generated',
  RPS_TLS_TUNNEL_INIT_FAILED: 'TLS tunnel to the device could not be established',
  RPS_TLS_PORT_SWITCH_FAILED: 'Device did not complete the switch to the TLS port',
  RPS_CONFIG_INVALID_DIGEST_REALM: 'AMT digest realm is not valid',
  RPS_CONFIG_INVALID_PROFILE: 'AMT profile configuration is invalid for this device',
  RPS_ACTIVATION_FAILED: 'Device activation failed',
  RPS_ACTIVATION_DEACTIVATED_AFTER_FAILURE: 'Device was deactivated after an activation failure',
  RPS_DEACTIVATION_FAILED: 'Device deactivation failed',
  RPS_NO_VALID_NEXT_STATE: 'Provisioning flow reached an unexpected state',
  RPS_INTERNAL_ERROR: 'RPS encountered an internal error',
  RPS_UNEXPECTED_ERROR: 'An unexpected error occurred'
}

// ---------------------------------------------------------------------------------------------
// AMT PT_STATUS return values
// ---------------------------------------------------------------------------------------------

/** Human-readable meaning for each PT_STATUS name known to PTStatus.ts. */
const PT_STATUS_DESCRIPTIONS: Record<string, string> = {
  PT_STATUS_SUCCESS: 'Operation completed successfully',
  PT_STATUS_INTERNAL_ERROR: 'AMT reported an internal error',
  PT_STATUS_NOT_READY: 'AMT is not ready to handle the request yet',
  PT_STATUS_INVALID_PT_MODE: 'Operation is not allowed in the current AMT provisioning mode',
  PT_STATUS_INVALID_MESSAGE_LENGTH: 'Request message length is invalid',
  PT_STATUS_INVALID_REGISTRATION_DATA: 'Registration data is invalid',
  PT_STATUS_APPLICATION_DOES_NOT_EXIST: 'Referenced application does not exist',
  PT_STATUS_NOT_ENOUGH_STORAGE: 'AMT does not have enough storage for the request',
  PT_STATUS_INVALID_NAME: 'Name is invalid',
  PT_STATUS_BLOCK_DOES_NOT_EXIST: 'Referenced storage block does not exist',
  PT_STATUS_INVALID_BYTE_OFFSET: 'Byte offset is invalid',
  PT_STATUS_INVALID_BYTE_COUNT: 'Byte count is invalid',
  PT_STATUS_NOT_PERMITTED: 'Operation is not permitted',
  PT_STATUS_NOT_OWNER: 'Caller is not the owner of the resource',
  PT_STATUS_BLOCK_LOCKED_BY_OTHER: 'Storage block is locked by another application',
  PT_STATUS_BLOCK_NOT_LOCKED: 'Storage block is not locked',
  PT_STATUS_INVALID_GROUP_PERMISSIONS: 'Group permissions are invalid',
  PT_STATUS_GROUP_DOES_NOT_EXIST: 'Referenced group does not exist',
  PT_STATUS_INVALID_MEMBER_COUNT: 'Member count is invalid',
  PT_STATUS_MAX_LIMIT_REACHED: 'AMT has reached the maximum number of entries for this resource',
  PT_STATUS_INVALID_AUTH_TYPE: 'Authentication type is invalid',
  PT_STATUS_INVALID_DHCP_MODE: 'DHCP mode is invalid',
  PT_STATUS_INVALID_IP_ADDRESS: 'IP address is invalid',
  PT_STATUS_INVALID_DOMAIN_NAME: 'Domain name is invalid',
  PT_STATUS_REQUEST_UNEXPECTED: 'Request was unexpected in the current AMT state',
  PT_STATUS_INVALID_PROVISIONING_STATE: 'Operation is not allowed in the current provisioning state',
  PT_STATUS_INVALID_TIME: 'Time value is invalid',
  PT_STATUS_INVALID_INDEX: 'Index is invalid',
  PT_STATUS_INVALID_PARAMETER: 'A request parameter is invalid',
  PT_STATUS_INVALID_NETMASK: 'Network mask is invalid',
  PT_STATUS_FLASH_WRITE_LIMIT_EXCEEDED: 'AMT flash write limit has been exceeded',
  PT_STATUS_RNG_GENERATION_IN_PROGRESS: 'AMT is still generating random numbers',
  PT_STATUS_RNG_NOT_READY: 'AMT random number generator is not ready',
  PT_STATUS_CERTIFICATE_NOT_READY: 'AMT certificate is not ready',
  PT_STATUS_UNSUPPORTED_OEM_NUMBER: 'OEM number is not supported',
  PT_STATUS_UNSUPPORTED_BOOT_OPTION: 'Boot option is not supported',
  PT_STATUS_INVALID_COMMAND: 'Command is invalid',
  PT_STATUS_INVALID_SPECIAL_COMMAND: 'Special command is invalid',
  PT_STATUS_INVALID_HANDLE: 'Handle is invalid',
  PT_STATUS_INVALID_PASSWORD: 'Password does not meet AMT requirements',
  PT_STATUS_INVALID_REALM: 'Realm is invalid',
  PT_STATUS_STORAGE_ACL_ENTRY_IN_USE: 'Storage ACL entry is in use',
  PT_STATUS_DATA_MISSING: 'Required data is missing from the request',
  PT_STATUS_DUPLICATE: 'An entry with the same name or value already exists',
  PT_STATUS_EVENTLOG_FROZEN: 'Event log is frozen',
  PT_STATUS_PKI_MISSING_KEYS: 'PKI keys are missing',
  PT_STATUS_PKI_GENERATING_KEYS: 'AMT is still generating PKI keys',
  PT_STATUS_INVALID_KEY: 'Key is invalid',
  PT_STATUS_INVALID_CERT: 'Certificate is invalid',
  PT_STATUS_CERT_KEY_NOT_MATCH: 'Certificate does not match the key',
  PT_STATUS_MAX_KERB_DOMAIN_REACHED: 'Maximum number of Kerberos domains has been reached',
  PT_STATUS_UNSUPPORTED: 'Operation or value is not supported by this AMT firmware',
  PT_STATUS_INVALID_PRIORITY: 'Priority is invalid',
  PT_STATUS_NOT_FOUND: 'Referenced item was not found',
  PT_STATUS_INVALID_CREDENTIALS: 'Credentials are invalid',
  PT_STATUS_INVALID_PASSPHRASE: 'Passphrase is invalid',
  PT_STATUS_NO_ASSOCIATION: 'No association exists for the request',
  PT_STATUS_AUDIT_FAIL: 'Audit log operation failed',
  PT_STATUS_BLOCKING_COMPONENT: 'A blocking component prevented the operation',
  PT_STATUS_USER_CONSENT_REQUIRED: 'User consent is required',
  PT_STATUS_OPERATION_IN_PROGRESS: 'Another operation is already in progress'
}

// ---------------------------------------------------------------------------------------------
// CIM method return values (DMTF)
// ---------------------------------------------------------------------------------------------

interface MethodReturnValue {
  name: string
  description: string
}

const CIM_RETURN_VALUES: Record<number, MethodReturnValue> = {
  0: { name: 'CIM_COMPLETED_NO_ERROR', description: 'Operation completed successfully' },
  1: { name: 'CIM_NOT_SUPPORTED', description: 'Operation is not supported by this device' },
  2: { name: 'CIM_UNKNOWN_ERROR', description: 'Device reported an unknown or unspecified error' },
  3: { name: 'CIM_TIMEOUT', description: 'Device could not complete the operation within the timeout period' },
  4: { name: 'CIM_FAILED', description: 'Device reported the operation failed' },
  5: { name: 'CIM_INVALID_PARAMETER', description: 'A request parameter is invalid' },
  6: { name: 'CIM_IN_USE', description: 'Resource is in use' },
  4096: { name: 'CIM_JOB_STARTED', description: 'Method parameters checked, job started' },
  4097: { name: 'CIM_INVALID_STATE_TRANSITION', description: 'Requested state transition is invalid' },
  4098: { name: 'CIM_TIMEOUT_NOT_SUPPORTED', description: 'Use of the timeout parameter is not supported' },
  4099: { name: 'CIM_BUSY', description: 'Device is busy' }
}

// ---------------------------------------------------------------------------------------------
// IPS_HostBasedSetupService return values (Setup, AdminSetup, UpgradeClientToAdmin)
// ---------------------------------------------------------------------------------------------

const IPS_HOST_BASED_SETUP_RETURN_VALUES: Record<number, MethodReturnValue> = {
  0: { name: 'IPS_SUCCESS', description: 'Operation completed successfully' },
  1: { name: 'IPS_INTERNAL_ERROR', description: 'AMT reported an internal error during host-based setup' },
  2: { name: 'IPS_INVALID_STATE', description: 'AMT is not in a state that allows host-based setup' },
  3: { name: 'IPS_INVALID_PARAMETER', description: 'A host-based setup parameter is invalid' },
  4: { name: 'IPS_METHOD_DISABLED', description: 'Host-based setup is disabled on this device' },
  5: { name: 'IPS_AUTHENTICATION_FAILED', description: 'AMT could not authenticate the host-based setup request' },
  6: { name: 'IPS_FLASH_WRITE_LIMIT_EXCEEDED', description: 'AMT flash write limit has been exceeded' }
}

// ---------------------------------------------------------------------------------------------
// AMT_WiFiPortConfigurationService return values (AddWiFiSettings, UpdateWiFiSettings)
// ---------------------------------------------------------------------------------------------

const WIFI_PORT_CONFIGURATION_RETURN_VALUES: Record<number, MethodReturnValue> = {
  1: { name: 'AMT_WIFI_NOT_SUPPORTED', description: 'Wireless settings are not supported by this device' },
  2: { name: 'AMT_WIFI_FAILED', description: 'AMT failed to apply the wireless settings' },
  3: { name: 'AMT_WIFI_INVALID_PARAMETER', description: 'A wireless setting parameter is invalid' },
  4: { name: 'AMT_WIFI_INVALID_REFERENCE', description: 'A wireless setting references an item AMT does not have' }
}

// ---------------------------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------------------------

/** Returns the catalog description for a code, or a generic description for an unknown one. */
export function describeCode(code: string): string {
  const known = (DESCRIPTIONS as Record<string, string>)[code]
  if (known != null) {
    return known
  }
  if (code.startsWith('AMT_PT_')) {
    const ptName = code.replace(/^AMT_PT_/, 'PT_STATUS_')
    return PT_STATUS_DESCRIPTIONS[ptName] ?? `AMT returned status ${ptName}`
  }
  return `Unrecognized failure code ${code}`
}

/** True when the code names a successful return value rather than a failure. */
export function isSuccessCode(code: string): boolean {
  return code === 'AMT_PT_SUCCESS' || code === 'CIM_RV_COMPLETED_NO_ERROR' || code === 'IPS_RV_SUCCESS'
}

/**
 * Maps an AMT (PT_STATUS) or CIM method ReturnValue to a code, symbolic name and description.
 * Unknown values still produce a stable code (`AMT_PT_UNKNOWN_<n>` / `CIM_RV_UNKNOWN_<n>`) so the
 * raw number is never dropped. `UNMAPPED` is not accepted: it means no table is trusted for the
 * method, so the caller keeps its own code and carries the raw number.
 */
export function fromReturnValue(
  namespace: Exclude<ReturnValueNamespace, 'UNMAPPED'>,
  value: number | undefined
): ResolvedReturnValue {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : -1
  if (namespace === 'CIM') {
    return (
      fromTable(CIM_RETURN_VALUES[numeric], /^CIM_/, 'CIM_RV_', numeric) ?? {
        code: `CIM_RV_UNKNOWN_${numeric}`,
        name: 'CIM_UNKNOWN',
        reason: `Device returned unrecognized CIM status code ${numeric}`,
        value: numeric
      }
    )
  }
  // IPS and WIFI: the values the service defines itself come first (they collide with low
  // PT_STATUS numbers); anything outside that range is decoded as a PT_STATUS code.
  const own =
    namespace === 'IPS'
      ? fromTable(IPS_HOST_BASED_SETUP_RETURN_VALUES[numeric], /^IPS_/, 'IPS_RV_', numeric)
      : namespace === 'WIFI'
        ? fromTable(WIFI_PORT_CONFIGURATION_RETURN_VALUES[numeric], /^$/, '', numeric)
        : undefined
  if (own != null) {
    return own
  }
  const pt = getPTStatus(numeric)
  if (pt != null) {
    return {
      code: pt.name.replace(/^PT_STATUS_/, 'AMT_PT_'),
      name: pt.name,
      reason: PT_STATUS_DESCRIPTIONS[pt.name] ?? `AMT returned status ${pt.name}`,
      value: numeric
    }
  }
  return {
    code: `AMT_PT_UNKNOWN_${numeric}`,
    name: 'PT_STATUS_UNKNOWN',
    reason: `AMT returned unrecognized status code ${numeric}`,
    value: numeric
  }
}

function fromTable(
  entry: MethodReturnValue | undefined,
  namePrefix: RegExp,
  codePrefix: string,
  value: number
): ResolvedReturnValue | undefined {
  if (entry == null) {
    return undefined
  }
  return { code: entry.name.replace(namePrefix, codePrefix), name: entry.name, reason: entry.description, value }
}

/**
 * True when the code describes something the device itself reported (a method return value or a
 * WSMAN / HTTP-level failure talking to AMT). The underlying error text of these is safe to show
 * at the edge; the text behind RPS-side codes (database, secrets, MPS) may name internal hosts and
 * paths and stays in the RPS logs.
 */
export function isDeviceOriginCode(code: string): boolean {
  return /^(WSMAN_|AMT_|CIM_RV_|IPS_RV_)/.test(code)
}

/**
 * True for what the WSMAN path rejects with: the parsed AMT response object itself. Anything that
 * is an Error is not one, including HttpResponseError, which the maintenance tasks build from MPS
 * responses.
 */
const isAmtHttpResponse = (err: unknown): boolean => !(err instanceof Error)

const fromHttpStatus = (statusCode: number): ErrorCode => {
  if (statusCode === 401) return ErrorCodes.WSMAN_AUTH_FAILED
  if (statusCode === 400) return ErrorCodes.WSMAN_BAD_REQUEST
  if (statusCode >= 500) return ErrorCodes.WSMAN_SERVER_ERROR
  return ErrorCodes.WSMAN_HTTP_ERROR
}

/**
 * Maps a thrown value (transport error, HTTP response, RPSError, plain Error or string) to a code.
 * The description comes from the catalog; the original error text is kept in `detail` so nothing
 * that was available at the failure site is lost.
 */
export function fromError(err: unknown): ResolvedError {
  if (err == null) {
    return { code: ErrorCodes.RPS_UNEXPECTED_ERROR, reason: DESCRIPTIONS.RPS_UNEXPECTED_ERROR }
  }
  if (typeof err === 'string') {
    return { code: ErrorCodes.RPS_UNEXPECTED_ERROR, reason: DESCRIPTIONS.RPS_UNEXPECTED_ERROR, detail: err }
  }
  if (err instanceof GATEWAY_TIMEOUT_ERROR) {
    return withDetail(ErrorCodes.WSMAN_TIMEOUT, err)
  }
  if (err instanceof UNEXPECTED_PARSE_ERROR) {
    return withDetail(ErrorCodes.WSMAN_PARSE_ERROR, err)
  }
  if (err instanceof CONNECTION_RESET_ERROR) {
    return withDetail(ErrorCodes.WSMAN_CONNECTION_RESET, err)
  }
  if (err instanceof TLS_TUNNEL_ERROR) {
    return withDetail(ErrorCodes.WSMAN_TLS_TUNNEL_FAILED, err)
  }
  if (err instanceof EA_TIMEOUT_ERROR) {
    return withDetail(ErrorCodes.RPS_EA_TIMEOUT, err)
  }
  // The raw http-z response model of an AMT reply carries a numeric statusCode. Known transport
  // classes were handled above so their synthetic status codes (503/504/599) are not misread as
  // AMT HTTP responses.
  // A status below 400 is not a failure: it means the caller handed over a stale successful response.
  // An Error with a statusCode (HttpResponseError, an HTTP client error) came from a service that
  // is not AMT, such as MPS: the status is kept, but the code stays generic so it is never
  // reported as a WSMAN failure and its text stays RPS-side.
  const statusCode = (err as any).statusCode
  if (typeof statusCode === 'number' && statusCode >= 400) {
    const code = isAmtHttpResponse(err) ? fromHttpStatus(statusCode) : ErrorCodes.RPS_UNEXPECTED_ERROR
    const detail = (err as any).statusMessage ?? (err as any).message
    return {
      code,
      reason: DESCRIPTIONS[code],
      httpStatus: statusCode,
      detail: typeof detail === 'string' && detail !== '' ? detail : undefined
    }
  }
  if (err instanceof RPSError) {
    return { code: ErrorCodes.RPS_INTERNAL_ERROR, reason: DESCRIPTIONS.RPS_INTERNAL_ERROR, detail: err.message }
  }
  if (err instanceof Error) {
    return {
      code: ErrorCodes.RPS_UNEXPECTED_ERROR,
      reason: DESCRIPTIONS.RPS_UNEXPECTED_ERROR,
      detail: err.message !== '' ? err.message : undefined
    }
  }
  return { code: ErrorCodes.RPS_UNEXPECTED_ERROR, reason: DESCRIPTIONS.RPS_UNEXPECTED_ERROR }
}

function withDetail(code: ErrorCode, err: Error): ResolvedError {
  const detail = err.message !== '' && err.message !== DESCRIPTIONS[code] ? err.message : undefined
  return { code, reason: DESCRIPTIONS[code], detail }
}
