/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { check } from 'express-validator'

export const proxyValidator = (): any => [
  // Validate and normalize infoFormat first so conditional checks can rely on a number
  check('infoFormat')
    .not()
    .isEmpty()
    .withMessage('Server address format is required')
    .isInt()
    .toInt()
    .isIn([
      3,
      4,
      201
    ])
    .withMessage('Server address format should be either 3(IPV4), 4(IPV6) or 201(FQDN)'),

  // accessInfo presence
  check('accessInfo').not().isEmpty().withMessage('Server address is required'),

  // accessInfo format based on infoFormat
  check('accessInfo')
    .if((_, { req }) => req.body.infoFormat === 3)
    .isIP(4)
    .withMessage('infoFormat 3 requires IPV4 server address'),
  check('accessInfo')
    .if((_, { req }) => req.body.infoFormat === 4)
    .isIP(6)
    .withMessage('infoFormat 4 requires IPV6 server address'),
  check('accessInfo')
    .if((_, { req }) => req.body.infoFormat === 201)
    .isFQDN({ require_tld: true, allow_underscores: false, allow_numeric_tld: false })
    .withMessage('infoFormat 201 requires FQDN server address'),

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
