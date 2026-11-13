/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

export interface PTStatusType {
  name: string
  value: number
}

export function getPTStatus(value: number): PTStatusType | undefined {
  return Object.values(PTStatus).find((v) => v.value === value)
}

export function getPTStatusName(value: number): string {
  const status = getPTStatus(value)
  if (status) {
    return status.name
  }
  return 'UNKNOWN'
}
export const PTStatus = {
  SUCCESS: {
    name: 'PT_STATUS_SUCCESS',
    value: 0
  },
  INTERNAL_ERROR: {
    name: 'PT_STATUS_INTERNAL_ERROR',
    value: 1
  },
  NOT_READY: {
    name: 'PT_STATUS_NOT_READY',
    value: 2
  },
  INVALID_PT_MODE: {
    name: 'PT_STATUS_INVALID_PT_MODE',
    value: 3
  },
  INVALID_MESSAGE_LENGTH: {
    name: 'PT_STATUS_INVALID_MESSAGE_LENGTH',
    value: 4
  },
  INVALID_REGISTRATION_DATA: {
    name: 'PT_STATUS_INVALID_REGISTRATION_DATA',
    value: 9
  },
  APPLICATION_DOES_NOT_EXIST: {
    name: 'PT_STATUS_APPLICATION_DOES_NOT_EXIST',
    value: 10
  },
  NOT_ENOUGH_STORAGE: {
    name: 'PT_STATUS_NOT_ENOUGH_STORAGE',
    value: 11
  },
  INVALID_NAME: {
    name: 'PT_STATUS_INVALID_NAME',
    value: 12
  },
  BLOCK_DOES_NOT_EXIST: {
    name: 'PT_STATUS_BLOCK_DOES_NOT_EXIST',
    value: 13
  },
  INVALID_BYTE_OFFSET: {
    name: 'PT_STATUS_INVALID_BYTE_OFFSET',
    value: 14
  },
  INVALID_BYTE_COUNT: {
    name: 'PT_STATUS_INVALID_BYTE_COUNT',
    value: 15
  },
  NOT_PERMITTED: {
    name: 'PT_STATUS_NOT_PERMITTED',
    value: 16
  },
  NOT_OWNER: {
    name: 'PT_STATUS_NOT_OWNER',
    value: 17
  },
  BLOCK_LOCKED_BY_OTHER: {
    name: 'PT_STATUS_BLOCK_LOCKED_BY_OTHER',
    value: 18
  },
  BLOCK_NOT_LOCKED: {
    name: 'PT_STATUS_BLOCK_NOT_LOCKED',
    value: 19
  },
  INVALID_GROUP_PERMISSIONS: {
    name: 'PT_STATUS_INVALID_GROUP_PERMISSIONS',
    value: 20
  },
  GROUP_DOES_NOT_EXIST: {
    name: 'PT_STATUS_GROUP_DOES_NOT_EXIST',
    value: 21
  },
  INVALID_MEMBER_COUNT: {
    name: 'PT_STATUS_INVALID_MEMBER_COUNT',
    value: 22
  },
  MAX_LIMIT_REACHED: {
    name: 'PT_STATUS_MAX_LIMIT_REACHED',
    value: 23
  },
  INVALID_AUTH_TYPE: {
    name: 'PT_STATUS_INVALID_AUTH_TYPE',
    value: 24
  },
  INVALID_DHCP_MODE: {
    name: 'PT_STATUS_INVALID_DHCP_MODE',
    value: 26
  },
  INVALID_IP_ADDRESS: {
    name: 'PT_STATUS_INVALID_IP_ADDRESS',
    value: 27
  },
  INVALID_DOMAIN_NAME: {
    name: 'PT_STATUS_INVALID_DOMAIN_NAME',
    value: 28
  },
  REQUEST_UNEXPECTED: {
    name: 'PT_STATUS_REQUEST_UNEXPECTED',
    value: 30
  },
  INVALID_PROVISIONING_STATE: {
    name: 'PT_STATUS_INVALID_PROVISIONING_STATE',
    value: 32
  },
  INVALID_TIME: {
    name: 'PT_STATUS_INVALID_TIME',
    value: 34
  },
  INVALID_INDEX: {
    name: 'PT_STATUS_INVALID_INDEX',
    value: 35
  },
  INVALID_PARAMETER: {
    name: 'PT_STATUS_INVALID_PARAMETER',
    value: 36
  },
  INVALID_NETMASK: {
    name: 'PT_STATUS_INVALID_NETMASK',
    value: 37
  },
  FLASH_WRITE_LIMIT_EXCEEDED: {
    name: 'PT_STATUS_FLASH_WRITE_LIMIT_EXCEEDED',
    value: 38
  },
  RNG_GENERATION_IN_PROGRESS: {
    name: 'PT_STATUS_RNG_GENERATION_IN_PROGRESS',
    value: 47
  },
  RNG_NOT_READY: {
    name: 'PT_STATUS_RNG_NOT_READY',
    value: 48
  },
  CERTIFICATE_NOT_READY: {
    name: 'PT_STATUS_CERTIFICATE_NOT_READY',
    value: 49
  },
  UNSUPPORTED_OEM_NUMBER: {
    name: 'PT_STATUS_UNSUPPORTED_OEM_NUMBER',
    value: 2049
  },
  UNSUPPORTED_BOOT_OPTION: {
    name: 'PT_STATUS_UNSUPPORTED_BOOT_OPTION',
    value: 2050
  },
  INVALID_COMMAND: {
    name: 'PT_STATUS_INVALID_COMMAND',
    value: 2051
  },
  INVALID_SPECIAL_COMMAND: {
    name: 'PT_STATUS_INVALID_SPECIAL_COMMAND',
    value: 2052
  },
  INVALID_HANDLE: {
    name: 'PT_STATUS_INVALID_HANDLE',
    value: 2053
  },
  INVALID_PASSWORD: {
    name: 'PT_STATUS_INVALID_PASSWORD',
    value: 2054
  },
  INVALID_REALM: {
    name: 'PT_STATUS_INVALID_REALM',
    value: 2055
  },
  STORAGE_ACL_ENTRY_IN_USE: {
    name: 'PT_STATUS_STORAGE_ACL_ENTRY_IN_USE',
    value: 2056
  },
  DATA_MISSING: {
    name: 'PT_STATUS_DATA_MISSING',
    value: 2057
  },
  DUPLICATE: {
    name: 'PT_STATUS_DUPLICATE',
    value: 2058
  },
  EVENTLOG_FROZEN: {
    name: 'PT_STATUS_EVENTLOG_FROZEN',
    value: 2059
  },
  PKI_MISSING_KEYS: {
    name: 'PT_STATUS_PKI_MISSING_KEYS',
    value: 2060
  },
  PKI_GENERATING_KEYS: {
    name: 'PT_STATUS_PKI_GENERATING_KEYS',
    value: 2061
  },
  INVALID_KEY: {
    name: 'PT_STATUS_INVALID_KEY',
    value: 2062
  },
  INVALID_CERT: {
    name: 'PT_STATUS_INVALID_CERT',
    value: 2063
  },
  CERT_KEY_NOT_MATCH: {
    name: 'PT_STATUS_CERT_KEY_NOT_MATCH',
    value: 2064
  },
  MAX_KERB_DOMAIN_REACHED: {
    name: 'PT_STATUS_MAX_KERB_DOMAIN_REACHED',
    value: 2065
  },
  UNSUPPORTED: {
    name: 'PT_STATUS_UNSUPPORTED',
    value: 2066
  },
  INVALID_PRIORITY: {
    name: 'PT_STATUS_INVALID_PRIORITY',
    value: 2067
  },
  NOT_FOUND: {
    name: 'PT_STATUS_NOT_FOUND',
    value: 2068
  },
  INVALID_CREDENTIALS: {
    name: 'PT_STATUS_INVALID_CREDENTIALS',
    value: 2069
  },
  INVALID_PASSPHRASE: {
    name: 'PT_STATUS_INVALID_PASSPHRASE',
    value: 2070
  },
  NO_ASSOCIATION: {
    name: 'PT_STATUS_NO_ASSOCIATION',
    value: 2072
  },
  AUDIT_FAIL: {
    name: 'PT_STATUS_AUDIT_FAIL',
    value: 2075
  },
  BLOCKING_COMPONENT: {
    name: 'PT_STATUS_BLOCKING_COMPONENT',
    value: 2076
  },
  USER_CONSENT_REQUIRED: {
    name: 'PT_STATUS_USER_CONSENT_REQUIRED',
    value: 2081
  },
  OPERATION_IN_PROGRESS: {
    name: 'PT_STATUS_OPERATION_IN_PROGRESS',
    value: 2082
  }
}
