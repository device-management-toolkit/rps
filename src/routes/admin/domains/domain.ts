/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { check, type CustomValidator } from 'express-validator'
import { NodeForge } from '../../../NodeForge.js'
import { CertManager } from '../../../certManager.js'
import Logger from '../../../Logger.js'
import { type CertsAndKeys } from '../../../models/index.js'

const nodeForge = new NodeForge()
const certManager = new CertManager(new Logger('CertManager'), nodeForge)
let pfxobj

export const domainInsertValidator = (): any => [
  check('profileName')
    .not()
    .isEmpty()
    .withMessage('AMT Domain profile name is required')
    .matches('^[a-zA-Z0-9_-]+$')
    .withMessage('AMT Domain profile name accepts letters, numbers, hyphens (-), and underscores (_)'),
  check('provisioningCertPassword')
    .not()
    .isEmpty()
    .withMessage('Provisioning Cert Password is required')
    .isLength({ max: 64 })
    .withMessage('Password should not exceed 64 characters in length')
    .custom(passwordValidator()),
  check('domainSuffix').not().isEmpty().withMessage('Domain suffix name is required').custom(domainSuffixValidator()),
  check('provisioningCert')
    .not()
    .isEmpty()
    .withMessage('Provisioning certificate is required')
    .custom(expirationValidator()),
  check('provisioningCertStorageFormat')
    .not()
    .isEmpty()
    .withMessage('Provisioning Cert Storage Format is required')
    .isIn(['raw', 'string'])
    .withMessage("Provisioning Cert Storage Format should be either 'raw' or 'string'")
]

export const domainUpdateValidator = (): any => [
  check('profileName')
    .not()
    .isEmpty()
    .withMessage('AMT Domain profile name is required')
    .matches('^[a-zA-Z0-9_-]+$')
    .withMessage('AMT Domain profile name accepts letters, numbers, hyphens (-), and underscores (_)'),
  check('domainSuffix'),
  check('provisioningCert'),
  check('provisioningCertStorageFormat')
    .isIn(['raw', 'string'])
    .withMessage('Provisioning Cert Storage Format is either "raw" or "string"'),
  check('provisioningCertPassword')
    .isLength({ max: 64 })
    .withMessage('Password should not exceed 64 characters in length')
]

function passwordValidator(): CustomValidator {
  return (value, { req }) => {
    pfxobj = passwordChecker(certManager, req)
    return true
  }
}

function domainSuffixValidator(): CustomValidator {
  return (value, { req }) => {
    if (pfxobj != null) {
      domainSuffixChecker(pfxobj, value)
    }
    return true
  }
}

function expirationValidator(): CustomValidator {
  return (value, { req }) => {
    if (pfxobj != null) {
      expirationChecker(pfxobj)
    }
    return true
  }
}

export function passwordChecker(certManager: CertManager, req: any): CertsAndKeys {
  try {
    const pfxobj = certManager.convertPfxToObject(req.body.provisioningCert, req.body.provisioningCertPassword)
    return pfxobj
  } catch (error) {
    throw new Error(
      'Unable to decrypt provisioning certificate. Please check that the password is correct, and that the certificate is a valid certificate.'
    )
  }
}

export function domainSuffixChecker(pfxobj: CertsAndKeys, value: any): void {
  const certCommonName = pfxobj.certs[0].subject.getField('CN').value
  const splittedCertCommonName: string[] = certCommonName.split('.')
  const parsedCertCommonName = (
    splittedCertCommonName[splittedCertCommonName.length - 2] +
    '.' +
    splittedCertCommonName[splittedCertCommonName.length - 1]
  ).trim()
  const splittedDomainName: string[] = value.split('.')
  const parsedDomainName = (
    splittedDomainName[splittedDomainName.length - 2] +
    '.' +
    splittedDomainName[splittedDomainName.length - 1]
  ).trim()
  if (parsedCertCommonName !== parsedDomainName) {
    throw new Error('FQDN not associated with provisioning certificate')
  }
}

export function expirationChecker(pfxobj: CertsAndKeys): void {
  const today = new Date()
  for (const cert of pfxobj.certs) {
    if (cert.validity.notAfter < today) {
      throw new Error('Uploaded certificate has expired')
    }
  }
}
