/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { randomBytes } from 'node:crypto'
import { type pkcs12, type pki } from 'node-forge'
import { type ILogger } from './interfaces/ILogger.js'
import type Logger from './Logger.js'
import {
  type AMTKeyUsage,
  type CertAttributes,
  type CertCreationResult,
  type CertificateObject,
  type CertsAndKeys,
  type ProvisioningCertObj,
  type RootCertFingerprint
} from './models/index.js'
import { type NodeForge } from './NodeForge.js'
import { type AMTCertificatePolicy } from './utils/amtCertificatePolicy.js'
import {
  type DevicePublicKey,
  issueLeafWithDeviceKey,
  parseDevicePublicKey,
  UnsupportedDeviceKeyError
} from './utils/ecLeafCertificate.js'

/** What the firmware checks on each certificate of a provisioning chain as it is uploaded. */
export interface ProvisioningCertInfo {
  role: 'leaf' | 'intermediate' | 'root'
  /** Common name, falling back to the role when the certificate has none. */
  name: string
  /** Digest the certificate is signed with, for example sha256. */
  hashAlgorithm: string | null
  /** RSA modulus size in bits, null for a key that is not RSA. */
  rsaKeySize: number | null
}

function describeCertificate(cert: pki.Certificate, role: ProvisioningCertInfo['role']): ProvisioningCertInfo {
  const cn = cert.subject?.getField?.('CN')?.value
  const modulus = (cert.publicKey as pki.rsa.PublicKey | undefined)?.n
  return {
    role,
    name: typeof cn === 'string' && cn !== '' ? cn : role,
    hashAlgorithm: cert.md?.algorithm?.toLowerCase() ?? null,
    rsaKeySize: typeof modulus?.bitLength === 'function' ? modulus.bitLength() : null
  }
}

/** The digest a certificate is signed with and the size of a key RPS generates, as chosen by the certificate policy. */
export type CertificateSigningOptions = Partial<Pick<AMTCertificatePolicy, 'hashAlgorithm' | 'rsaKeySize'>>

interface Attribute {
  name?: string
  shortName?: string
  value: string
}

export class UnsupportedCertificateError extends Error {
  public readonly code = 'UNSUPPORTED_CERTIFICATE'

  constructor(message: string) {
    super(message)
    this.name = 'UnsupportedCertificateError'
  }
}

export class CertManager {
  private readonly nodeForge: NodeForge
  private readonly logger: ILogger
  constructor(logger: Logger, nodeForge: NodeForge) {
    this.logger = logger
    this.nodeForge = nodeForge
  }

  private parseCertificateFlexible(certData: string): pki.Certificate {
    if (certData.includes('-----BEGIN CERTIFICATE-----')) {
      return this.nodeForge.certificateFromPem(certData)
    }

    const derBytes = Buffer.from(certData.replace(/\s+/g, ''), 'base64').toString('binary')
    const asn1 = this.nodeForge.asn1FromDer(derBytes)
    return this.nodeForge.certificateFromAsn1(asn1)
  }

  /**
   * @description Sorts the intermediate certificates to properly order the certificate chain
   * @param {CertificateObject} intermediate
   * @param {CertificateObject} root
   * @returns {boolean} Returns true if issuer is from root.  Returns false if issuer is not from root.
   */
  sortCertificate(intermediate: CertificateObject, root: CertificateObject): boolean {
    return intermediate.issuer === root.subject
  }

  /**
   * @description Pulls the provisioning certificate apart and exports each PEM for injecting into AMT.  Only supports certificate chains up to 4 certificates long
   * @param {any} pfxobj Certificate object from convertPfxToObject function
   * @returns {any} Returns provisioning certificate object with certificate chain in proper order and fingerprint
   */
  dumpPfx(pfxobj: CertsAndKeys): {
    provisioningCertificateObj: ProvisioningCertObj
    fingerprint: RootCertFingerprint
    hashAlgorithm: string | null
    certificates: ProvisioningCertInfo[]
    /** Certificates in the PFX that could not be read, so they are in neither the chain nor `certificates`. */
    unreadableCertificates: number
  } {
    const provisioningCertificateObj: ProvisioningCertObj = {} as ProvisioningCertObj
    const interObj: CertificateObject[] = []
    const leaf: CertificateObject = {} as CertificateObject
    const root: CertificateObject = {} as CertificateObject
    const fingerprint: RootCertFingerprint = {} as RootCertFingerprint
    let hashAlgorithm: string | null = null
    // Details of exactly the certificates that end up in the chain sent to AMT, so a root or certificate that is
    // not sent is never judged.
    let leafInfo: ProvisioningCertInfo | undefined
    let rootInfo: ProvisioningCertInfo | undefined
    const interInfos = new Map<CertificateObject, ProvisioningCertInfo>()

    this.logger.debug(
      `Processing PFX with ${pfxobj.certs?.length ?? 0} certificates and ${pfxobj.keys?.length ?? 0} keys`
    )

    if (pfxobj.certs?.length > 0) {
      for (let i = 0; i < pfxobj.certs.length; i++) {
        const cert = pfxobj.certs[i]
        let pem = this.nodeForge.pkiCertificateToPem(cert)
        // Need to trim off the BEGIN and END so we just have the raw pem
        pem = pem
          .split('-----BEGIN CERTIFICATE-----')
          .join('')
          .split('-----END CERTIFICATE-----')
          .join('')
          .split('\r\n')
          .join('')
        // pem = pem.replace(/(\r\n|\n|\r)/g, '');
        // Index 0 = Leaf, Root subject.hash will match issuer.hash, rest are Intermediate.
        if (i === 0) {
          leafInfo = describeCertificate(cert, 'leaf')
          leaf.pem = pem
          leaf.subject = cert.subject.hash
          leaf.issuer = cert.issuer.hash
          hashAlgorithm = cert.md.algorithm
          this.logger.debug(
            `  Certificate[${i}]: LEAF (subject=${cert.subject.hash}, issuer=${cert.issuer.hash}, algo=${hashAlgorithm})`
          )
        } else if (cert.subject.hash === cert.issuer.hash) {
          // A later self-signed certificate replaces this one, as in the chain below.
          rootInfo = describeCertificate(cert, 'root')
          root.pem = pem
          root.subject = cert.subject.hash
          root.issuer = cert.issuer.hash
          const der = this.nodeForge.asn1ToDer(this.nodeForge.pkiCertificateToAsn1(cert)).getBytes()
          // Generate SHA256 fingerprint of root certificate
          fingerprint.sha256 = this.nodeForge.sha256Create().update(der).digest().toHex()
          // Generate SHA384 fingerprint of root certificate
          fingerprint.sha384 = this.nodeForge.sha384Create().update(der).digest().toHex()
          // Generate SHA1 fingerprint of root certificate
          fingerprint.sha1 = this.nodeForge.sha1Create().update(der).digest().toHex()
          this.logger.debug(`  Certificate[${i}]: ROOT (subject=${cert.subject.hash}, self-signed)`)
          this.logger.debug(
            `    Fingerprints: SHA256=${fingerprint.sha256.substring(0, 16)}..., SHA1=${fingerprint.sha1.substring(0, 16)}...`
          )
        } else {
          const inter: CertificateObject = {
            pem,
            issuer: cert.issuer.hash,
            subject: cert.subject.hash
          }
          interObj.push(inter)
          interInfos.set(inter, describeCertificate(cert, 'intermediate'))
          this.logger.debug(
            `  Certificate[${i}]: INTERMEDIATE (subject=${cert.subject.hash}, issuer=${cert.issuer.hash})`
          )
        }
      }
    }

    // Need to put the certificate PEMs in the correct order before sending to AMT.
    // This currently only supports certificate chains that are no more than 4 certificates long
    provisioningCertificateObj.certChain = []
    const certificates: ProvisioningCertInfo[] = []
    // Leaf PEM is first
    provisioningCertificateObj.certChain.push(leaf.pem)
    if (leafInfo != null) certificates.push(leafInfo)
    // Need to figure out which Intermediate PEM is next to the Leaf PEM
    for (const obj of interObj) {
      if (!this.sortCertificate(obj, root)) {
        provisioningCertificateObj.certChain.push(obj.pem)
        certificates.push(interInfos.get(obj)!)
      }
    }
    // Need to figure out which Intermediate PEM is next to the Root PEM
    for (const obj of interObj) {
      if (this.sortCertificate(obj, root)) {
        provisioningCertificateObj.certChain.push(obj.pem)
        certificates.push(interInfos.get(obj)!)
      }
    }
    // Root PEM goes in last
    provisioningCertificateObj.certChain.push(root.pem)
    if (rootInfo != null) certificates.push(rootInfo)
    if (pfxobj.keys?.length > 0) {
      for (const key of pfxobj.keys) {
        // Just need the key in key format for signing.  Keeping the private key in memory only.
        provisioningCertificateObj.privateKey = key
      }
    }

    this.logger.debug(
      `Certificate chain built: ${provisioningCertificateObj.certChain.length} certificates (leaf -> intermediate -> root)`
    )

    return {
      provisioningCertificateObj,
      fingerprint,
      hashAlgorithm,
      certificates,
      unreadableCertificates: pfxobj.unreadableCertificates ?? 0
    }
  }

  /**
   * @description Extracts the provisioning certificate into an object for later manipulation
   * @param {string} pfxb64 provisioning certificate
   * @param {string} passphrase Password to open provisioning certificate
   * @returns {object} Object containing cert pems and private key
   */
  convertPfxToObject(pfxb64: string, passphrase: string): CertsAndKeys {
    const pfxOut: CertsAndKeys = { certs: [], keys: [] }
    const pfxder = Buffer.from(pfxb64, 'base64').toString('binary')

    this.logger.debug(`Converting PFX to object (${pfxder.length} bytes)`)

    // Convert DER to ASN.1
    let asn
    try {
      asn = this.nodeForge.asn1FromDer(pfxder)
      this.logger.debug('ASN.1 parsing successful')
    } catch (e) {
      this.logger.error('ASN.1 parsing failed')
      throw new Error('ASN.1 parsing failed', { cause: e })
    }
    let pfx: pkcs12.Pkcs12Pfx
    try {
      pfx = this.nodeForge.pkcs12FromAsn1(asn, true, passphrase)
      this.logger.debug('PKCS#12 decryption successful')
    } catch (e) {
      this.logger.error('Decrypting provisioning certificate failed')
      throw new Error('Decrypting provisioning certificate failed', { cause: e })
    }

    // Process certificate bags
    const certBags = pfx.getBags({ bagType: this.nodeForge.pkiOidsCertBag })
    const certBagArray = certBags[this.nodeForge.pkiOidsCertBag]
    if (certBagArray) {
      for (const certBag of certBagArray) {
        if (certBag.cert) {
          pfxOut.certs.push(certBag.cert)
        } else {
          pfxOut.unreadableCertificates = (pfxOut.unreadableCertificates ?? 0) + 1
        }
      }
      this.logger.debug(`Extracted ${pfxOut.certs.length} certificates from PFX`)
    } else {
      this.logger.error('No certificate bags found in PFX')
      throw new Error('No certificate bags found')
    }

    if (pfxOut.certs.length === 0) {
      throw new UnsupportedCertificateError(
        'No certificates could be parsed from the provisioning certificate. ' +
          'The certificate may use an unsupported public-key algorithm; an RSA-keyed certificate is required.'
      )
    }

    // Process key bags
    const keyBags = pfx.getBags({ bagType: this.nodeForge.pkcs8ShroudedKeyBag })
    const keyBagArray = keyBags[this.nodeForge.pkcs8ShroudedKeyBag]
    if (keyBagArray) {
      for (const keyBag of keyBagArray) {
        if (keyBag.key) {
          pfxOut.keys.push(keyBag.key)
        }
      }
      this.logger.debug(`Extracted ${pfxOut.keys.length} private keys from PFX`)
    } else {
      this.logger.error('No key bags found in PFX')
      throw new Error('No key bags found')
    }

    return pfxOut
  }

  /**
   * @param deviceKeyIsEc True when the certificate carries an elliptic-curve key. RFC 5480 section 3 does not allow
   * the keyEncipherment and dataEncipherment bits for such a key, so they are left out.
   */
  generateLeafCertificate(cert: pki.Certificate, keyUsage: AMTKeyUsage | null, deviceKeyIsEc = false): pki.Certificate {
    if (keyUsage) {
      // Figure out the extended key usages
      if (
        keyUsage['2.16.840.1.113741.1.2.1'] ||
        keyUsage['2.16.840.1.113741.1.2.2'] ||
        keyUsage['2.16.840.1.113741.1.2.3']
      ) {
        keyUsage.clientAuth = true
      }
    }

    // Create a leaf certificate
    cert.setExtensions([
      {
        name: 'basicConstraints'
      },
      {
        name: 'keyUsage',
        keyCertSign: true,
        digitalSignature: true,
        nonRepudiation: true,
        keyEncipherment: !deviceKeyIsEc,
        dataEncipherment: !deviceKeyIsEc
      },
      keyUsage,
      {
        name: 'nsCertType',
        client: keyUsage?.clientAuth,
        server: keyUsage?.serverAuth,
        email: keyUsage?.emailProtection,
        objsign: keyUsage?.codeSigning
      },
      {
        name: 'subjectKeyIdentifier'
      }
    ])

    return cert
  }

  generateRootCertificate(cert: pki.Certificate): pki.Certificate {
    // Create a root certificate
    cert.setExtensions([
      {
        name: 'basicConstraints',
        cA: true
      },
      {
        name: 'nsCertType',
        sslCA: true,
        emailCA: true,
        objCA: true
      },
      {
        name: 'subjectKeyIdentifier'
      }
    ])

    return cert
  }

  hex2rstr(hex: string): string {
    let str = ''
    for (let n = 0; n < hex.length; n += 2) {
      str += String.fromCharCode(parseInt(hex.substr(n, 2), 16))
    }
    return str
  }

  /**
   * Accept a device public key node-forge cannot represent.
   *
   * AMT returns AMT_PublicPrivateKeyPair.DERKey as a DER SubjectPublicKeyInfo. For an RSA key forge parses it
   * directly; for the ECC-384 key AMT 22 generates, publicKeyFromPem throws because forge is RSA-only. node:crypto
   * validates the key instead, and the leaf is built around it in issueLeafWithDeviceKey.
   */
  parseExternalPublicKey(DERKey: string, forgeError: unknown): DevicePublicKey {
    try {
      const key = parseDevicePublicKey(DERKey)
      this.logger.debug('AMT public key is not RSA; embedding its SubjectPublicKeyInfo as exported by node:crypto')
      return key
    } catch (err) {
      if (err instanceof UnsupportedDeviceKeyError) {
        throw new UnsupportedCertificateError(`${err.message} (not a parsable RSA key either: ${String(forgeError)})`)
      }
      throw err
    }
  }

  amtCertSignWithCAKey(
    DERKey: string,
    caPrivateKey: pki.PrivateKey | null,
    certAttributes: CertAttributes,
    issuerAttributes: CertAttributes,
    extKeyUsage: AMTKeyUsage,
    rootCertPem?: string,
    options: CertificateSigningOptions = {}
  ): CertCreationResult {
    if (!caPrivateKey || caPrivateKey == null) {
      // Fallback CA: honour the policy key size here too, otherwise an AMT 22
      // profile silently gets a 2048-bit signing key.
      const certAndKey = this.createCertificate(issuerAttributes, null, null, null, null, undefined, options)
      caPrivateKey = certAndKey.key
    }
    return this.createCertificate(
      certAttributes,
      caPrivateKey,
      DERKey,
      issuerAttributes,
      extKeyUsage,
      rootCertPem,
      options
    )
  }

  // Generate a certificate with a set of attributes signed by a rootCert. If the rootCert is omitted, the generated certificate is self-signed.
  // If rootCertPem is provided, the leaf cert validity will be set to start 1 minute after root's notBefore and expire 1 minute before root's notAfter.
  createCertificate(
    certAttributes: CertAttributes,
    caPrivateKey: pki.PrivateKey | null = null,
    DERKey: string | null = null,
    issuerAttributes: CertAttributes | null = null,
    extKeyUsage: AMTKeyUsage | null = null,
    rootCertPem?: string,
    options: CertificateSigningOptions = {}
  ): CertCreationResult {
    const { hashAlgorithm = 'sha256', rsaKeySize = 2048 } = options
    // Generate a keypair and create an X.509v3 certificate
    let keys
    // Set when the AMT-supplied key is not RSA (AMT 22 generates ECC-384).
    let externalKey: DevicePublicKey | null = null
    let cert = this.nodeForge.createCert()
    if (!DERKey) {
      keys = this.nodeForge.rsaGenerateKeyPair(rsaKeySize)
      cert.publicKey = keys.publicKey
    } else {
      try {
        cert.publicKey = this.nodeForge.publicKeyFromPem(`-----BEGIN PUBLIC KEY-----${DERKey}-----END PUBLIC KEY-----`)
      } catch (err) {
        externalKey = this.parseExternalPublicKey(DERKey, err)
      }
    }
    // RFC 5280: serialNumber must be a positive integer. node-forge reads this as a hex string and
    // DER-encodes it as a signed two's-complement INTEGER, so the high bit of the first byte must
    // be clear or strict parsers (Go 1.23+ crypto/x509) reject it as a negative serial number.
    // Also guarantee non-zero (zero is not "positive") by setting a low bit on the last byte.
    const serialBytes = randomBytes(16)
    serialBytes[0] &= 0x7f
    serialBytes[serialBytes.length - 1] |= 0x01
    cert.serialNumber = serialBytes.toString('hex')

    // If creating a leaf cert with MPS root cert provided, base validity on root cert validity dates.
    // Accept both PEM and base64 DER to avoid silently falling back to legacy dates.
    if (caPrivateKey && rootCertPem) {
      try {
        const rootCert = this.parseCertificateFlexible(rootCertPem)
        const oneMinuteMs = 1 * 60 * 1000
        cert.validity.notBefore = new Date(rootCert.validity.notBefore.getTime() + oneMinuteMs)
        cert.validity.notAfter = new Date(rootCert.validity.notAfter.getTime() - oneMinuteMs)
      } catch (err) {
        // Fallback to default dates if root cert parsing fails
        cert.validity.notBefore = new Date(2018, 0, 1)
        cert.validity.notAfter = new Date(2049, 11, 31)
      }
    } else {
      // Default dates for self-signed or when no root cert provided
      cert.validity.notBefore = new Date(2018, 0, 1)
      cert.validity.notAfter = new Date(2049, 11, 31)
    }

    const attrs: Attribute[] = []
    if (certAttributes.CN) attrs.push({ name: 'commonName', value: certAttributes.CN })
    if (certAttributes.C) attrs.push({ name: 'countryName', value: certAttributes.C })
    if (certAttributes.ST) attrs.push({ shortName: 'ST', value: certAttributes.ST })
    if (certAttributes.O) attrs.push({ name: 'organizationName', value: certAttributes.O })
    cert.setSubject(attrs)

    if (caPrivateKey) {
      // Use root attributes
      const rootattrs: Attribute[] = []
      if (issuerAttributes?.CN) rootattrs.push({ name: 'commonName', value: issuerAttributes.CN })
      if (issuerAttributes?.C) rootattrs.push({ name: 'countryName', value: issuerAttributes.C })
      if (issuerAttributes?.ST) rootattrs.push({ shortName: 'ST', value: issuerAttributes.ST })
      if (issuerAttributes?.O) rootattrs.push({ name: 'organizationName', value: issuerAttributes.O })
      cert.setIssuer(rootattrs)
      if (externalKey) {
        // forge would derive the key identifier from cert.publicKey, which an EC key cannot be
        const keyIdentifier = this.nodeForge.createBuffer(externalKey.keyIdentifier.toString('binary'))
        cert.generateSubjectKeyIdentifier = () => keyIdentifier
      }
      cert = this.generateLeafCertificate(cert, extKeyUsage, externalKey != null)
      if (externalKey) {
        const certDer = issueLeafWithDeviceKey({
          cert,
          devicePublicKey: externalKey,
          caPrivateKeyPem: this.nodeForge.privateKeyToPem(caPrivateKey),
          hashAlgorithm
        })
        const certBase64 = certDer.toString('base64')
        return {
          h: Math.random(),
          cert: null,
          pem: `-----BEGIN CERTIFICATE-----${certBase64}-----END CERTIFICATE-----`,
          certbin: certBase64,
          privateKey: undefined as any,
          privateKeyBin: null,
          checked: false,
          key: null
        }
      }
      const digest = hashAlgorithm === 'sha384' ? this.nodeForge.sha384Create() : this.nodeForge.sha256Create()
      cert.sign(caPrivateKey as pki.rsa.PrivateKey, digest)
    } else {
      // Use our own attributes
      cert.setIssuer(attrs)
      cert = this.generateRootCertificate(cert)
      const digest = hashAlgorithm === 'sha384' ? this.nodeForge.sha384Create() : this.nodeForge.sha256Create()
      cert.sign(keys.privateKey, digest)
    }

    return {
      h: Math.random(),
      cert,
      pem: this.nodeForge.pkiCertificateToPem(cert).replace(/(\r\n|\n|\r)/gm, ''),
      certbin: Buffer.from(
        this.hex2rstr(this.nodeForge.asn1ToDer(this.nodeForge.pkiCertificateToAsn1(cert)).toHex()),
        'binary'
      ).toString('base64'),
      privateKey: keys?.privateKey,
      privateKeyBin: keys == null ? null : this.nodeForge.privateKeyToPem(keys.privateKey),
      checked: false,
      key: keys?.privateKey
    }
  }

  getExpirationDate(cert: string, password: string): Date {
    const pfxobj = this.convertPfxToObject(cert, password)
    let expiresFirst = pfxobj.certs[0].validity.notAfter
    for (const cert of pfxobj.certs) {
      if (cert.validity.notAfter < expiresFirst) {
        expiresFirst = cert.validity.notAfter
      }
    }
    return expiresFirst
  }
}
