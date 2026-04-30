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
  } {
    const provisioningCertificateObj: ProvisioningCertObj = {} as ProvisioningCertObj
    const interObj: CertificateObject[] = []
    const leaf: CertificateObject = {} as CertificateObject
    const root: CertificateObject = {} as CertificateObject
    const fingerprint: RootCertFingerprint = {} as RootCertFingerprint
    let hashAlgorithm: string | null = null

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
          leaf.pem = pem
          leaf.subject = cert.subject.hash
          leaf.issuer = cert.issuer.hash
          hashAlgorithm = cert.md.algorithm
          this.logger.debug(
            `  Certificate[${i}]: LEAF (subject=${cert.subject.hash}, issuer=${cert.issuer.hash}, algo=${hashAlgorithm})`
          )
        } else if (cert.subject.hash === cert.issuer.hash) {
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
          this.logger.debug(
            `  Certificate[${i}]: INTERMEDIATE (subject=${cert.subject.hash}, issuer=${cert.issuer.hash})`
          )
        }
      }
    }

    // Need to put the certificate PEMs in the correct order before sending to AMT.
    // This currently only supports certificate chains that are no more than 4 certificates long
    provisioningCertificateObj.certChain = []
    // Leaf PEM is first
    provisioningCertificateObj.certChain.push(leaf.pem)
    // Need to figure out which Intermediate PEM is next to the Leaf PEM
    for (const obj of interObj) {
      if (!this.sortCertificate(obj, root)) {
        provisioningCertificateObj.certChain.push(obj.pem)
      }
    }
    // Need to figure out which Intermediate PEM is next to the Root PEM
    for (const obj of interObj) {
      if (this.sortCertificate(obj, root)) {
        provisioningCertificateObj.certChain.push(obj.pem)
      }
    }
    // Root PEM goes in last
    provisioningCertificateObj.certChain.push(root.pem)
    if (pfxobj.keys?.length > 0) {
      for (const key of pfxobj.keys) {
        // Just need the key in key format for signing.  Keeping the private key in memory only.
        provisioningCertificateObj.privateKey = key
      }
    }

    this.logger.debug(
      `Certificate chain built: ${provisioningCertificateObj.certChain.length} certificates (leaf -> intermediate -> root)`
    )

    return { provisioningCertificateObj, fingerprint, hashAlgorithm }
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

  generateLeafCertificate(cert: pki.Certificate, keyUsage: AMTKeyUsage | null): pki.Certificate {
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
        keyEncipherment: true,
        dataEncipherment: true
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

  amtCertSignWithCAKey(
    DERKey: string,
    caPrivateKey: pki.PrivateKey | null,
    certAttributes: CertAttributes,
    issuerAttributes: CertAttributes,
    extKeyUsage: AMTKeyUsage,
    rootCertPem?: string
  ): CertCreationResult {
    if (!caPrivateKey || caPrivateKey == null) {
      const certAndKey = this.createCertificate(issuerAttributes)
      caPrivateKey = certAndKey.key
    }
    return this.createCertificate(certAttributes, caPrivateKey, DERKey, issuerAttributes, extKeyUsage, rootCertPem)
  }

  // Generate a certificate with a set of attributes signed by a rootCert. If the rootCert is omitted, the generated certificate is self-signed.
  // If rootCertPem is provided, the leaf cert validity will be set to start 1 minute after root's notBefore and expire 1 minute before root's notAfter.
  createCertificate(
    certAttributes: CertAttributes,
    caPrivateKey: pki.PrivateKey | null = null,
    DERKey: string | null = null,
    issuerAttributes: CertAttributes | null = null,
    extKeyUsage: AMTKeyUsage | null = null,
    rootCertPem?: string
  ): CertCreationResult {
    // Generate a keypair and create an X.509v3 certificate
    let keys
    let cert = this.nodeForge.createCert()
    if (!DERKey) {
      keys = this.nodeForge.rsaGenerateKeyPair(2048)
      cert.publicKey = keys.publicKey
    } else {
      cert.publicKey = this.nodeForge.publicKeyFromPem(`-----BEGIN PUBLIC KEY-----${DERKey}-----END PUBLIC KEY-----`)
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
      cert = this.generateLeafCertificate(cert, extKeyUsage)
      cert.sign(caPrivateKey as pki.rsa.PrivateKey, this.nodeForge.sha256Create())
    } else {
      // Use our own attributes
      cert.setIssuer(attrs)
      cert = this.generateRootCertificate(cert)
      cert.sign(keys.privateKey, this.nodeForge.sha256Create())
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
