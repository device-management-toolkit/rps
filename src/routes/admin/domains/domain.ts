/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { check, type CustomValidator } from 'express-validator'
import forge from 'node-forge'
import type { pki } from 'node-forge'
const { pki: pkiRuntime } = forge
import { NodeForge } from '../../../NodeForge.js'
import { CertManager, UnsupportedCertificateError } from '../../../certManager.js'
import Logger from '../../../Logger.js'
import { type CertsAndKeys } from '../../../models/index.js'

const nodeForge = new NodeForge()
const certManager = new CertManager(new Logger('CertManager'), nodeForge)

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
    .withMessage('Password should not exceed 64 characters in length'),
  check('domainSuffix').not().isEmpty().withMessage('Domain suffix name is required'),
  check('provisioningCert')
    .not()
    .isEmpty()
    .withMessage('Provisioning certificate is required')
    .custom(provisioningCertValidator()),
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

function provisioningCertValidator(): CustomValidator {
  return (value, { req }) => {
    const password = req?.body?.provisioningCertPassword
    if (password == null || password === '' || value == null || value === '') {
      return true
    }

    const pfxobj = passwordChecker(certManager, req)
    domainSuffixChecker(pfxobj, req?.body?.domainSuffix)
    expirationChecker(pfxobj)
    rootCertChecker(pfxobj)
    keySizeChecker(pfxobj)
    privateKeyChecker(pfxobj)
    chainIntegrityChecker(pfxobj)
    amtOidChecker(pfxobj)
    return true
  }
}

export function passwordChecker(certManager: CertManager, req: any): CertsAndKeys {
  try {
    const pfxobj = certManager.convertPfxToObject(req.body.provisioningCert, req.body.provisioningCertPassword)
    return pfxobj
  } catch (error) {
    if (error instanceof UnsupportedCertificateError) {
      throw error
    }

    throw new Error(
      'Unable to decrypt provisioning certificate. Please check that the password is correct, and that the certificate is a valid certificate.',
      { cause: error }
    )
  }
}

export function domainSuffixChecker(pfxobj: CertsAndKeys, value: any): void {
  if (!pfxobj.certs || pfxobj.certs.length === 0) {
    throw new Error('No certificates found in the provisioning certificate')
  }

  const cnField = pfxobj.certs[0].subject.getField('CN')

  if (!cnField) {
    throw new Error('Provisioning certificate does not contain a Common Name (CN) in the subject')
  }

  const certCommonName = cnField.value
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
    if (cert.validity.notBefore > today) {
      throw new Error(
        `Uploaded certificate is not yet valid: notBefore date ${cert.validity.notBefore.toISOString()} is in the future`
      )
    }
    if (cert.validity.notAfter < today) {
      throw new Error('Uploaded certificate has expired')
    }
  }
}

export function rootCertChecker(pfxobj: CertsAndKeys): void {
  const hasRoot = pfxobj.certs.some((cert) => cert.subject.hash === cert.issuer.hash)
  if (!hasRoot) {
    throw new Error('Provisioning certificate does not contain a root certificate')
  }
}

export function keySizeChecker(pfxobj: CertsAndKeys): void {
  const MIN_KEY_SIZE = 2048
  for (const cert of pfxobj.certs) {
    const rsaKey = cert.publicKey as pki.rsa.PublicKey
    const keySize = rsaKey.n.bitLength()
    if (keySize < MIN_KEY_SIZE) {
      throw new Error(`Certificate key size ${keySize} bits is below the minimum required ${MIN_KEY_SIZE} bits for AMT`)
    }
  }
}

export function privateKeyChecker(pfxobj: CertsAndKeys): void {
  if (pfxobj.keys.length === 0) {
    throw new Error('Provisioning certificate does not contain a private key')
  }
  const leafPublicKey = pfxobj.certs[0].publicKey as pki.rsa.PublicKey
  const privateKey = pfxobj.keys[0] as pki.rsa.PrivateKey
  if (!leafPublicKey.n.equals(privateKey.n)) {
    throw new Error('Private key in the PFX does not match the leaf certificate public key')
  }
}

export function chainIntegrityChecker(pfxobj: CertsAndKeys): void {
  const { certs } = pfxobj
  if (certs.length <= 1) return // single cert (self-signed root): nothing to chain-verify

  // Build ordered chain: leaf → intermediates → root, following issuer links
  const chain: pki.Certificate[] = []
  const pool = [...certs]
  let current: pki.Certificate | undefined = pool.splice(pool.indexOf(certs[0]), 1)[0]

  while (current != null) {
    chain.push(current)
    if (current.subject.hash === current.issuer.hash) break // reached root
    const nextIdx = pool.findIndex((c) => c.subject.hash === current!.issuer.hash)
    if (nextIdx === -1) {
      throw new Error('Certificate chain is broken: cannot find issuer for a certificate in the chain')
    }
    current = pool.splice(nextIdx, 1)[0]
  }

  // Cryptographically verify each cert was signed by the next one up
  const root = chain[chain.length - 1]
  const caStore = pkiRuntime.createCaStore([root])
  try {
    pkiRuntime.verifyCertificateChain(caStore, chain)
  } catch (e) {
    throw new Error(`Certificate chain signature verification failed: ${(e as Error).message}`, { cause: e })
  }
}

export function amtOidChecker(pfxobj: CertsAndKeys): void {
  const AMT_ACTIVATION_OID = '2.16.840.1.113741.1.2.3'
  const leafCert = pfxobj.certs[0]
  const ekuExt = leafCert.getExtension('extKeyUsage') as Record<string, unknown> | null
  if (ekuExt?.[AMT_ACTIVATION_OID] !== true) {
    throw new Error(`Leaf certificate is missing the Intel AMT Activation EKU OID (${AMT_ACTIVATION_OID})`)
  }
}
