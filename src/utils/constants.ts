/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { type apiResponse } from '../models/RCS.Config.js'
export const ProtocolVersion = '4.0.0'
export const AMTUserName = 'admin'
export const mpsserver = (name: string): string =>
  `<Address xmlns="http://schemas.xmlsoap.org/ws/2004/08/addressing">http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</Address><ReferenceParameters xmlns="http://schemas.xmlsoap.org/ws/2004/08/addressing"><ResourceURI xmlns="http://schemas.dmtf.org/wbem/wsman/1/wsman.xsd">http://intel.com/wbem/wscim/1/amt-schema/1/AMT_ManagementPresenceRemoteSAP</ResourceURI><SelectorSet xmlns="http://schemas.dmtf.org/wbem/wsman/1/wsman.xsd"><Selector Name="Name">${name}</Selector></SelectorSet></ReferenceParameters>`

// Profile API
export const PROFILE_INSERTION_FAILED_DUPLICATE = (profileName: string): string =>
  `AMT profile ${profileName} already exists`
export const PROFILE_INSERTION_CIRA_CONSTRAINT = (config: string): string => `Referenced config ${config} doesn't exist`
export const PROFILE_INSERTION_NETWORK_CONSTRAINT = (config: string): string =>
  `Referenced network ${config} doesn't exist`
export const PROFILE_INSERTION_GENERIC_CONSTRAINT = (name: string): string =>
  `Referenced constraint ${name} doesn't exist`

// CIRA REST API
export const CIRA_CONFIG_DELETION_FAILED_CONSTRAINT = (ciraConfig: string): string =>
  `CIRA Config: ${ciraConfig} is associated with an AMT profile`
export const CIRA_CONFIG_INSERTION_FAILED = (ciraConfig: string): string =>
  `CIRA Config insertion failed for ${ciraConfig}`
export const CIRA_CONFIG_INSERTION_FAILED_DUPLICATE = (ciraConfig: string): string =>
  `CIRA Config ${ciraConfig} already exists.`

// IEEE 802.1X
export const IEEE8021X_DELETION_FAILED_CONSTRAINT_WIRELESS = (config: string): string =>
  `802.1x config: ${config} is associated with a wireless profile.`
export const IEEE8021X_DELETION_FAILED_CONSTRAINT_AMT_PROFILE = (config: string): string =>
  `802.1x config: ${config} is associated with an AMT Profile.`
export const IEEE8021X_INSERTION_FAILED = (config: string): string => `802.1x insertion failed for ${config}`
export const IEEE8021X_INSERTION_FAILED_DUPLICATE = (config: string): string =>
  `802.1x config: ${config} already exists`

// Network configs REST API
export const NETWORK_CONFIG_DELETION_FAILED_CONSTRAINT = (type: string, config: string): string =>
  `${type} profile: ${config} is associated with an AMT Profile.`
export const NETWORK_CONFIG_ERROR = (type: string, config: string): string =>
  `Operation failed for ${type} profile: ${config}`
export const NETWORK_UPDATE_ERROR = (type: string, config: string): string =>
  `Operation failed for ${type} profile: ${config}. Cannot modify ${type} settings if its already associated with a profile.`
export const NETWORK_CONFIG_INSERTION_FAILED_DUPLICATE = (type: string, config: string): string =>
  `${type} profile ${config} already exists`

// Domain REST API
export const DUPLICATE_DOMAIN_FAILED = (message: string): string => `Domain ${message} ID or Suffix already exists`

// Generic REST API Error Message
export const API_UNEXPECTED_EXCEPTION = (message: string): string => `Operation failed: ${message}`
export const CONCURRENCY_EXCEPTION = 'Concurrency'
export const CONCURRENCY_MESSAGE = 'No records were updated'
export const NOT_FOUND_EXCEPTION = 'Not Found'
export const NOT_FOUND_MESSAGE = (
  type: 'Domain' | 'Wireless' | '802.1x' | 'CIRA' | 'AMT' | 'Proxy',
  name: string
): string => `${type} profile ${name} Not Found`
// JSON response
export const API_RESPONSE = (data?: any, error?: string | null, message?: string): apiResponse => {
  const response: apiResponse = {}
  if (error != null) {
    response.error = error
  } else if (data != null) {
    return data
  }
  if (message != null) {
    response.message = message
  }
  return response
}

export const VAULT_RESPONSE_CODES = (statusCode: any = null): string => {
  let vaultError: string
  if (statusCode != null) {
    switch (statusCode) {
      case 429:
        vaultError = 'unsealed and standby'
        break
      case 472:
        vaultError = 'disaster recovery mode replication secondary and active'
        break
      case 473:
        vaultError = 'performance standby'
        break
      case 501:
        vaultError = 'not initialized'
        break
      case 503:
        vaultError = 'sealed'
        break
      default:
        vaultError = 'unknown error'
        break
    }
  } else {
    vaultError = 'statusCode null'
  }

  return vaultError
}

export const POSTGRES_RESPONSE_CODES = (statusCode: any = null): string => {
  let postgresError: string
  if (statusCode != null) {
    switch (statusCode) {
      case '28P01':
        postgresError = 'invalid_password'
        break
      default:
        postgresError = 'unknown error'
        break
    }
  } else {
    postgresError = 'statusCode null'
  }

  return postgresError
}

// Network Configurator

export const WIFIENDPOINT = {
  __parameterType: 'reference',
  __resourceUri: 'http://schemas.dmtf.org/wbem/wscim/1/cim-schema/2/CIM_WiFiEndpoint',
  Name: 'WiFi Endpoint 0'
}

// Default limit and offset for api pagination

export const DEFAULT_TOP = 25
export const DEFAULT_SKIP = 0

export class UnexpectedParseError extends Error {
  statusCode: number
  constructor(message = 'Unexpected Parse Error', statusCode = 599) {
    super(message)
    this.name = this.constructor.name
    this.statusCode = statusCode
    Error.captureStackTrace(this, this.constructor)
  }
}
export const UNEXPECTED_PARSE_ERROR = UnexpectedParseError
export class GatewayTimeoutError extends Error {
  statusCode: number
  constructor(message = 'Gateway Timeout', statusCode = 504) {
    super(message)
    this.name = this.constructor.name
    this.statusCode = statusCode
    Error.captureStackTrace(this, this.constructor)
  }
}
export const GATEWAY_TIMEOUT_ERROR = GatewayTimeoutError
export class EATimeoutError extends Error {
  statusCode: number
  constructor(message = 'Enterprise Assistant Timeout', statusCode = 504) {
    super(message)
    this.name = this.constructor.name
    this.statusCode = statusCode
    Error.captureStackTrace(this, this.constructor)
  }
}
export const EA_TIMEOUT_ERROR = EATimeoutError
