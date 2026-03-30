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

export const ciraInsertValidator = (): any => [
  check('configName')
    .not()
    .isEmpty()
    .withMessage('CIRA profile name is required')
    .matches('^[a-zA-Z0-9_-]+$')
    .withMessage('CIRA profile name accepts letters, numbers, underscore and hyphen only'),
  check('serverAddressFormat')
    .not()
    .isEmpty()
    .withMessage('MPS server address format is required')
    .isIn([
      3,
      4,
      201
    ])
    .withMessage('MPS server address format should be either 3(IPV4) , 4(IPV6) or 201(FQDN)'),
  check('mpsServerAddress')
    .not()
    .isEmpty()
    .withMessage('MPS server address is required')
    .custom((value, { req }) => {
      if (serverAddressFormatValidator(value, req)) {
        return true
      }
      return false
    }),
  check('mpsPort')
    .not()
    .isEmpty()
    .withMessage('MPS port is required')
    .isInt({ min: 1024, max: 49151 })
    .withMessage('MPS Port value should range between 1024 and 49151'),
  check('username')
    .not()
    .isEmpty()
    .withMessage('MPS user name is required')
    .matches('^[a-zA-Z0-9]+$') // As per AMT SDK, accepts only alphanumeric values
    .withMessage('MPS user name should be alphanumeric')
    .isLength({ min: 5, max: 16 })
    .withMessage('MPS user name length should be in between 5 to 16'),
  check('commonName')
    .if((value, { req }) => req.body.serverAddressFormat !== 201)
    .optional()
    .matches(
      '^([01]?[0-9]?[0-9]|2[0-4][0-9]|25[0-5])\\.([01]?[0-9]?[0-9]|2[0-4][0-9]|25[0-5])\\.([01]?[0-9]?[0-9]|2[0-4][0-9]|25[0-5])\\.([01]?[0-9]?[0-9]|2[0-4][0-9]|25[0-5])$'
    )
    .withMessage('Cert. Hostname(CN) should be an IP address.'),
  check('authMethod')
    .not()
    .isEmpty()
    .withMessage('Authentication method is required')
    .isIn([1, 2])
    .withMessage('Authentication method should be either 1 (Mutual Auth) or 2 (username and password)'),
  check('mpsRootCertificate').not().isEmpty().withMessage('MPS public root certificate is required'),
  check('proxyDetails').optional()
]

export const ciraUpdateValidator = (): any => [
  check('configName')
    .not()
    .isEmpty()
    .withMessage('CIRA profile name is required')
    .matches('^[a-zA-Z0-9_-]+$')
    .withMessage('CIRA profile name accepts letters, numbers, underscore and hyphen only'),
  check('serverAddressFormat')
    .optional()
    .isIn([
      3,
      4,
      201
    ])
    .withMessage('MPS server address format 3(IPV4) , 4(IPV6) or 201(FQDN)')
    .custom((value, { req }) => {
      if (req.body.mpsServerAddress == null) {
        throw new Error('Server address is required to update')
      }
      return true
    }),
  check('mpsServerAddress')
    .optional()
    .custom((value, { req }) => {
      if (serverAddressFormatValidator(value, req)) {
        return true
      }
      return false
    }),
  check('mpsPort')
    .optional()
    .custom((value, { req }) => {
      if (typeof value !== 'number' || value <= 1024 || value >= 49151) {
        throw new Error('MPS Port value should range between 1024 and 49151')
      }
      return true
    }),
  check('username')
    .optional()
    .matches('^[a-zA-Z0-9]+$') // As per AMT SDK, accepts only alphanumeric values
    .withMessage('MPS user name should be alphanumeric')
    .isLength({ min: 5, max: 16 })
    .withMessage('MPS user name length should be in between 5 to 16'),
  check('commonName')
    .if((value, { req }) => req.body.serverAddressFormat !== 201)
    .optional()
    .matches(
      '^([01]?[0-9]?[0-9]|2[0-4][0-9]|25[0-5])\\.([01]?[0-9]?[0-9]|2[0-4][0-9]|25[0-5])\\.([01]?[0-9]?[0-9]|2[0-4][0-9]|25[0-5])\\.([01]?[0-9]?[0-9]|2[0-4][0-9]|25[0-5])$'
    )
    .withMessage('Cert. Hostname(CN) should be an IP address.')
    .custom((value, { req }) => {
      if (req.body.serverAddressFormat == null || req.body.mpsServerAddress == null) {
        throw new Error('serverAddressFormat and mpsServerAddress is required')
      }
      return true
    }),
  check('authMethod')
    .optional()
    .isIn([1, 2])
    .withMessage('Authentication method accepts either 1 - Mutual Auth or 2 -username/password)'),
  check('mpsRootCertificate').optional(),
  check('proxyDetails').optional(),
  check('regeneratePassword').optional().isBoolean()
]

function serverAddressFormatValidator(value, req): boolean {
  if (req.body.serverAddressFormat == null) {
    throw new Error('serverAddressFormat is required')
  }
  if (value != null) {
    if (req.body.serverAddressFormat === 3) {
      if (!value.match(ipv4)) {
        throw new Error('serverAddressFormat 3 requires IPV4 server address')
      } else if (req.body.commonName == null) {
        throw new Error('commonName is required when serverAddressFormat is 3')
      }
    } else if (req.body.serverAddressFormat === 4) {
      if (!value.match(ipv6)) {
        throw new Error('serverAddressFormat 4 requires IPV6 server address')
      }
    } else if (req.body.serverAddressFormat === 201) {
      if (!value.match(fqdn) && !value.match(ipv4)) {
        throw new Error('serverAddressFormat 201 requires FQDN server address')
      }
    }
  }
  return true
}
