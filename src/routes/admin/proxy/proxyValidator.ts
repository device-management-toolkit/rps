/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { check } from 'express-validator'
import { type AMT } from '@device-management-toolkit/wsman-messages'

/**
 * Detects the address format (IPv4, IPv6, or FQDN) based on the address string
 * @param address The address to detect
 * @returns InfoFormat enum value (3 for IPv4, 4 for IPv6, 201 for FQDN)
 */
export function detectAddressFormat(address: string): AMT.Types.MPServer.InfoFormat {
  // Check for IPv6 (contains colons and hex characters)
  const ipv6Regex =
    /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]+|::(ffff(:0{1,4})?:)?((25[0-5]|(2[0-4]|1?[0-9])?[0-9])\.){3}(25[0-5]|(2[0-4]|1?[0-9])?[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1?[0-9])?[0-9])\.){3}(25[0-5]|(2[0-4]|1?[0-9])?[0-9]))$/
  if (ipv6Regex.test(address)) {
    return 4 // IPv6
  }

  // Check for IPv4 (xxx.xxx.xxx.xxx)
  const ipv4Regex = /^((25[0-5]|(2[0-4]|1\d|[1-9]|)\d)\.?\b){4}$/
  if (ipv4Regex.test(address)) {
    return 3 // IPv4
  }

  // Otherwise, treat as FQDN
  return 201 // FQDN
}

export const proxyValidator = (): any => [
  check('name')
    .not()
    .isEmpty()
    .withMessage('Proxy profile name is required')
    .matches('^[a-zA-Z0-9]+$')
    .withMessage('Proxy profile name should be alphanumeric')
    .isLength({ max: 32 })
    .withMessage('Proxy profile name maximum length is 32'),

  // address presence and format validation
  check('address')
    .not()
    .isEmpty()
    .withMessage('Server address is required')
    .custom((value) => {
      // Validate if it's a valid IPv4, IPv6, or FQDN
      const ipv4Regex = /^((25[0-5]|(2[0-4]|1\d|[1-9]|)\d)\.?\b){4}$/
      const ipv6Regex =
        /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]+|::(ffff(:0{1,4})?:)?((25[0-5]|(2[0-4]|1?[0-9])?[0-9])\.){3}(25[0-5]|(2[0-4]|1?[0-9])?[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1?[0-9])?[0-9])\.){3}(25[0-5]|(2[0-4]|1?[0-9])?[0-9]))$/
      const fqdnRegex = /^(?!:\/\/)([a-zA-Z0-9-_]+\.)*[a-zA-Z0-9][a-zA-Z0-9-_]+\.[a-zA-Z]{2,11}?$/

      if (ipv4Regex.test(value) || ipv6Regex.test(value) || fqdnRegex.test(value)) {
        return true
      }
      throw new Error('Server address must be a valid IPv4, IPv6, or FQDN')
    }),

  check('port').exists().isPort().withMessage('Port value should range between 1 and 65535'),
  check('networkDnsSuffix')
    .not()
    .isEmpty()
    .withMessage('Domain name of the network is required')
    .isFQDN({ require_tld: true, allow_underscores: false })
    .withMessage('Domain name of the network should contain alphanumeric and hyphens in the middle')
    .isLength({ max: 192 })
    .withMessage('Domain name of the network maximum length is 192')
]

export const proxyUpdateValidator = (): any => [
  // address presence and format validation
  check('address')
    .not()
    .isEmpty()
    .withMessage('Server address is required')
    .custom((value) => {
      // Validate if it's a valid IPv4, IPv6, or FQDN
      const ipv4Regex = /^((25[0-5]|(2[0-4]|1\d|[1-9]|)\d)\.?\b){4}$/
      const ipv6Regex =
        /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]+|::(ffff(:0{1,4})?:)?((25[0-5]|(2[0-4]|1?[0-9])?[0-9])\.){3}(25[0-5]|(2[0-4]|1?[0-9])?[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1?[0-9])?[0-9])\.){3}(25[0-5]|(2[0-4]|1?[0-9])?[0-9]))$/
      const fqdnRegex = /^(?!:\/\/)([a-zA-Z0-9-_]+\.)*[a-zA-Z0-9][a-zA-Z0-9-_]+\.[a-zA-Z]{2,11}?$/

      if (ipv4Regex.test(value) || ipv6Regex.test(value) || fqdnRegex.test(value)) {
        return true
      }
      throw new Error('Server address must be a valid IPv4, IPv6, or FQDN')
    }),

  check('port').exists().isPort().withMessage('Port value should range between 1 and 65535'),
  check('networkDnsSuffix')
    .not()
    .isEmpty()
    .withMessage('Domain name of the network is required')
    .isFQDN({ require_tld: true, allow_underscores: false })
    .withMessage('Domain name of the network should contain alphanumeric and hyphens in the middle')
    .isLength({ max: 192 })
    .withMessage('Domain name of the network maximum length is 192')
]
