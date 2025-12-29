/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

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

export class CertManager {
  private readonly nodeForge: NodeForge
  private readonly logger: ILogger
  constructor(logger: Logger, nodeForge: NodeForge) {
    this.logger = logger
    this.nodeForge = nodeForge
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
        } else {
          const inter: CertificateObject = {
            pem,
            issuer: cert.issuer.hash,
            subject: cert.subject.hash
          }
          interObj.push(inter)
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

    // Convert DER to ASN.1
    let asn
    try {
      asn = this.nodeForge.asn1FromDer(pfxder)
    } catch (e) {
      throw new Error('ASN.1 parsing failed')
    }
    let pfx: pkcs12.Pkcs12Pfx
    try {
      pfx = this.nodeForge.pkcs12FromAsn1(asn, true, passphrase)
    } catch (e) {
      throw new Error('Decrypting provisioning certificate failed')
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
    } else {
      throw new Error('No certificate bags found')
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
    } else {
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
    extKeyUsage: AMTKeyUsage
  ): CertCreationResult {
    if (!caPrivateKey || caPrivateKey == null) {
      const certAndKey = this.createCertificate(issuerAttributes)
      caPrivateKey = certAndKey.key
    }
    return this.createCertificate(certAttributes, caPrivateKey, DERKey, issuerAttributes, extKeyUsage)
  }

  // Generate a certificate with a set of attributes signed by a rootCert. If the rootCert is omitted, the generated certificate is self-signed.
  createCertificate(
    certAttributes: CertAttributes,
    caPrivateKey: pki.PrivateKey | null = null,
    DERKey: string | null = null,
    issuerAttributes: CertAttributes | null = null,
    extKeyUsage: AMTKeyUsage | null = null
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
    cert.serialNumber = Math.floor(Math.random() * 100000 + 1).toString()
    cert.validity.notBefore = new Date(2018, 0, 1)
    cert.validity.notAfter = new Date(2049, 11, 31)

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
