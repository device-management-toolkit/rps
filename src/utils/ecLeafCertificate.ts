/*********************************************************************
 * Copyright (c) Intel Corporation 2026
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto'
import forge from 'node-forge'

/**
 * An X.509 leaf certificate that carries a device public key node-forge cannot read (the ECC-384 key AMT 22
 * generates), signed by an RSA CA key.
 *
 * node:crypto reads, validates, hashes and signs, but it cannot build a certificate, so the TBSCertificate is
 * assembled here from node-forge's generic ASN.1 and name/extension encoders. Nothing is spliced into a forge
 * structure by position: every field of the TBSCertificate is placed explicitly, and the device key enters as
 * the SubjectPublicKeyInfo node:crypto exported.
 */

const SIGNATURE_OIDS: Record<'sha256' | 'sha384', string> = {
  sha256: forge.pki.oids.sha256WithRSAEncryption,
  sha384: forge.pki.oids.sha384WithRSAEncryption
}

export class UnsupportedDeviceKeyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsupportedDeviceKeyError'
  }
}

export interface DevicePublicKey {
  /** The SubjectPublicKeyInfo, DER, exactly as it is embedded in the certificate. */
  spki: Buffer
  /** RFC 5280 4.2.1.2 method (1): SHA-1 over the subjectPublicKey BIT STRING contents. */
  keyIdentifier: Buffer
}

export interface LeafCertificateInput {
  /** Holds serial number, validity, subject, issuer and extensions. Its publicKey is not used. */
  cert: forge.pki.Certificate
  devicePublicKey: DevicePublicKey
  /** The RSA key of the issuing CA, PEM. */
  caPrivateKeyPem: string
  hashAlgorithm: 'sha256' | 'sha384'
}

/**
 * Validate a device public key with node:crypto. Only an elliptic-curve key reaches here (RSA keys take the
 * node-forge path), so anything else, or bytes that are not a SubjectPublicKeyInfo, is refused before
 * anything is signed.
 */
export function parseDevicePublicKey(derKeyBase64: string): DevicePublicKey {
  const der = Buffer.from(derKeyBase64, 'base64')
  let spki: Buffer
  try {
    const key = createPublicKey({ key: der, format: 'der', type: 'spki' })
    if (key.asymmetricKeyType !== 'ec') {
      throw new UnsupportedDeviceKeyError(
        `AMT returned a ${String(key.asymmetricKeyType)} public key that RPS cannot embed`
      )
    }
    spki = key.export({ type: 'spki', format: 'der' })
  } catch (err) {
    if (err instanceof UnsupportedDeviceKeyError) throw err
    throw new UnsupportedDeviceKeyError(`AMT returned a public key that is not a SubjectPublicKeyInfo: ${String(err)}`)
  }

  // decodeBitStrings: false keeps the key bits as raw bytes, so a point that also happens to parse as DER is not
  // decoded into a structure.
  const spkiAsn1 = fromDerRaw(spki)
  const bitString = (spkiAsn1.value as forge.asn1.Asn1[])[1]
  const keyBits = Buffer.from((bitString.value as string).slice(1), 'binary') // drop the unused-bits octet
  return { spki, keyIdentifier: createHash('sha1').update(keyBits).digest() }
}

// @types/node-forge only declares the boolean `strict` form of the second argument
function fromDerRaw(der: Buffer): forge.asn1.Asn1 {
  return (forge.asn1.fromDer as any)(forge.util.createBuffer(der.toString('binary')), { decodeBitStrings: false })
}

function dateToAsn1(date: Date): forge.asn1.Asn1 {
  const year = date.getUTCFullYear()
  return year >= 1950 && year < 2050
    ? forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.UTCTIME, false, forge.asn1.dateToUtcTime(date))
    : forge.asn1.create(
        forge.asn1.Class.UNIVERSAL,
        forge.asn1.Type.GENERALIZEDTIME,
        false,
        forge.asn1.dateToGeneralizedTime(date)
      )
}

/** Build, sign and encode the leaf. Returns the certificate DER. */
export function issueLeafWithDeviceKey(input: LeafCertificateInput): Buffer {
  const { cert, devicePublicKey, caPrivateKeyPem, hashAlgorithm } = input
  const { asn1, util, pki } = forge
  const sequence = (children: forge.asn1.Asn1[]): forge.asn1.Asn1 =>
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, children)

  const signatureAlgorithm = sequence([
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(SIGNATURE_OIDS[hashAlgorithm]).getBytes()),
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.NULL, false, '')
  ])

  const tbs = sequence([
    asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, asn1.integerToDer(cert.version).getBytes())
    ]),
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, util.hexToBytes(cert.serialNumber)),
    signatureAlgorithm,
    pki.distinguishedNameToAsn1(cert.issuer),
    sequence([dateToAsn1(cert.validity.notBefore), dateToAsn1(cert.validity.notAfter)]),
    pki.distinguishedNameToAsn1(cert.subject),
    fromDerRaw(devicePublicKey.spki),
    (pki as any).certificateExtensionsToAsn1(cert.extensions)
  ])

  const tbsDer = Buffer.from(asn1.toDer(tbs).getBytes(), 'binary')
  const signature = sign(hashAlgorithm, tbsDer, createPrivateKey(caPrivateKeyPem))

  const certificate = sequence([
    tbs,
    signatureAlgorithm,
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.BITSTRING, false, String.fromCharCode(0) + signature.toString('binary'))
  ])
  return Buffer.from(asn1.toDer(certificate).getBytes(), 'binary')
}
