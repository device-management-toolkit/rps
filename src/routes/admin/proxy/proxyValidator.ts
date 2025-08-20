/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { check } from 'express-validator'

const ipv4 =
  '^([01]?[0-9]?[0-9]|2[0-4][0-9]|25[0-5])\\.([01]?[0-9]?[0-9]|2[0-4][0-9]|25[0-5])\\.([01]?[0-9]?[0-9]|2[0-4][0-9]|25[0-5])\\.([01]?[0-9]?[0-9]|2[0-4][0-9]|25[0-5])$'
const ipv6 =
  '^((?:[0-9A-Fa-f]{1,4}))((?::[0-9A-Fa-f]{1,4}))*::((?:[0-9A-Fa-f]{1,4}))((?::[0-9A-Fa-f]{1,4}))*|((?:[0-9A-Fa-f]{1,4}))((?::[0-9A-Fa-f]{1,4})){7}$'
const fqdn = '^(?=.{1,254}$)((?=[a-z0-9-]{1,63}\\.)(xn--+)?[a-z0-9]+(-[a-z0-9]+)*\\.)+[a-z]{2,63}$'

export const proxyValidator = (): any => [
  check('accessInfo')
    .not()
    .isEmpty()
    .withMessage('Server address is required')
    .custom((value, { req }) => {
      if (accessInfoFormatValidator(value, req)) {
        return true
      }
      return false
    }),
  check('infoFormat')
    .not()
    .isEmpty()
    .withMessage('Server address format is required')
    .isIn([
      3,
      4,
      201
    ])
    .withMessage('Server address format should be either 3(IPV4), 4(IPV6) or 201(FQDN)'),
  check('port')
    .not()
    .isEmpty()
    .withMessage('Port is required')
    .isInt({ min: 0, max: 65535 })
    .withMessage('Port value should range between 0 and 65535'),
  check('networkDnsSuffix')
    .not()
    .isEmpty()
    .withMessage('Domain name of the network is required')
    .matches('^(?=.{1,192}$)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\\.[a-zA-Z]{2,})+$')
    .withMessage('Domain name of the network should contain alphanumeric and hyphens in the middle')
    .isLength({ max: 192 })
    .withMessage('Domain name of the network maximum length is 192')
]

function accessInfoFormatValidator(value, req): boolean {
  if (req.body.infoFormat == null) {
    throw new Error('accessInfo is required')
  }
  if (value != null) {
    if (req.body.infoFormat === 3) {
      if (!value.match(ipv4)) {
        throw new Error('infoFormat 3 requires IPV4 server address')
      }
    } else if (req.body.infoFormat === 4) {
      if (!value.match(ipv6)) {
        throw new Error('infoFormat 4 requires IPV6 server address')
      }
    } else if (req.body.infoFormat === 201) {
      if (!value.match(fqdn)) {
        throw new Error('infoFormat 201 requires FQDN server address')
      }
    }
  }
  return true
}
