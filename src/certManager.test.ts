/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { createHash, createPublicKey, generateKeyPairSync, X509Certificate } from 'node:crypto'
import forge, { asn1 as forgeAsn1 } from 'node-forge'
import { CertManager, UnsupportedCertificateError } from './certManager.js'
import { NodeForge } from './NodeForge.js'
import { issueLeafWithDeviceKey } from './utils/ecLeafCertificate.js'
import { type AMTKeyUsage, type CertAttributes, type CertificateObject } from './models/index.js'
import Logger from './Logger.js'
import { TEST_PFXCERT, EXPECTED_CERT } from './test/helper/certs.js'
import { vi } from 'vitest'
describe('certManager tests', () => {
  describe('sortCertificate tests', () => {
    test('issuer is from root', () => {
      const nodeForge = new NodeForge()
      const certManager = new CertManager(new Logger('CertManager'), nodeForge)

      const certificateObject1: CertificateObject = {
        issuer: 'issuer',
        pem: 'pem1',
        subject: 'subject1'
      }
      const certificateObject2: CertificateObject = {
        issuer: 'issuer2',
        pem: 'pem2',
        subject: 'issuer'
      }
      const result = certManager.sortCertificate(certificateObject1, certificateObject2)
      expect(result).toEqual(true)
    })

    test('issuer is not from root', () => {
      const nodeForge = new NodeForge()
      const certManager = new CertManager(new Logger('CertManager'), nodeForge)

      const certificateObject1: CertificateObject = {
        issuer: 'issuer',
        pem: 'pem',
        subject: 'subject1'
      }

      const certificateObject2: CertificateObject = {
        issuer: 'issuer',
        pem: 'pem',
        subject: 'issuer2'
      }
      const result = certManager.sortCertificate(certificateObject1, certificateObject2)
      expect(result).toEqual(false)
    })
  })

  describe('convertPfxToObject tests', () => {
    test('Extracts the provisioning certificate', () => {
      const pfxb64: string = TEST_PFXCERT

      const nodeForge = new NodeForge()
      const certManager = new CertManager(new Logger('CertManager'), nodeForge)

      // convert the certificate pfx to an object
      const pfxobj = certManager.convertPfxToObject(pfxb64, 'P@ssw0rd')

      expect(pfxobj.certs).toHaveLength(2)
      expect(pfxobj.keys).toHaveLength(1)
    })

    test('throws UnsupportedCertificateError with remediation guidance when cert bags contain no parseable certs (e.g. ECDSA)', () => {
      const nodeForge = new NodeForge()
      const certManager = new CertManager(new Logger('CertManager'), nodeForge)
      const certBagOid = nodeForge.pkiOidsCertBag
      const keyBagOid = nodeForge.pkcs8ShroudedKeyBag

      vi.spyOn(nodeForge, 'pkcs12FromAsn1').mockReturnValue({
        getBags: (opts: any) => {
          if (opts.bagType === certBagOid) {
            return { [certBagOid]: [{ cert: null }, { cert: null }] }
          }

          return { [keyBagOid]: [] }
        }
      } as any)

      let thrown: unknown
      try {
        certManager.convertPfxToObject(TEST_PFXCERT, 'P@ssw0rd')
      } catch (e) {
        thrown = e
      }

      expect(thrown).toBeInstanceOf(UnsupportedCertificateError)
      const err = thrown as UnsupportedCertificateError
      expect(err.code).toBe('UNSUPPORTED_CERTIFICATE')
      expect(err.name).toBe('UnsupportedCertificateError')
      // diagnostic opening — must remain stable so the UI/clients can match on it
      expect(err.message).toMatch(/No certificates could be parsed from the provisioning certificate/)
      // states the actual requirement
      expect(err.message).toMatch(/RSA/)
    })
  })

  describe('dumpPfx tests', () => {
    test('Pulls the provisioning certificate apart and exports each PEM', () => {
      const nodeForge = new NodeForge()
      const certManager = new CertManager(new Logger('CertManager'), nodeForge)
      const pfxObj = certManager.convertPfxToObject(TEST_PFXCERT, 'P@ssw0rd')
      const certChainPfx = certManager.dumpPfx(pfxObj)

      expect(certChainPfx.provisioningCertificateObj.certChain).toEqual(
        EXPECTED_CERT.provisioningCertificateObj.certChain
      )
      expect(certChainPfx.fingerprint).toEqual(EXPECTED_CERT.fingerprint)
      expect(certChainPfx.hashAlgorithm).toEqual(EXPECTED_CERT.hashAlgorithm)
      expect(certChainPfx.provisioningCertificateObj).toHaveProperty('privateKey')
      expect(certChainPfx.provisioningCertificateObj.privateKey).toBeDefined()
    })

    test('describes every certificate of the chain by role, digest and RSA key size', () => {
      const certManager = new CertManager(new Logger('CertManager'), new NodeForge())
      const certChainPfx = certManager.dumpPfx(certManager.convertPfxToObject(TEST_PFXCERT, 'P@ssw0rd'))

      const { certificates } = certChainPfx
      expect(certificates).toHaveLength(certChainPfx.provisioningCertificateObj.certChain.length)
      expect(certificates[0]).toMatchObject({ role: 'leaf', hashAlgorithm: certChainPfx.hashAlgorithm })
      expect(certificates.at(-1)?.role).toBe('root')
      for (const cert of certificates) {
        expect(cert.name).not.toBe('')
        expect(cert.rsaKeySize).toBeGreaterThanOrEqual(2048)
      }
    })

    describe('chain details', () => {
      const keys = forge.pki.rsa.generateKeyPair(1024)
      const issue = (cn: string, issuer: string, md: forge.md.MessageDigest): forge.pki.Certificate => {
        const cert = forge.pki.createCertificate()
        cert.publicKey = keys.publicKey
        cert.serialNumber = '01'
        cert.validity.notBefore = new Date(Date.now() - 1000)
        cert.validity.notAfter = new Date(Date.now() + 86400000)
        cert.setSubject([{ name: 'commonName', value: cn }])
        cert.setIssuer([{ name: 'commonName', value: issuer }])
        cert.sign(keys.privateKey, md)
        // Parsing fills in the name hashes that the chain ordering relies on.
        return forge.pki.certificateFromPem(forge.pki.certificateToPem(cert), true)
      }
      const sha384 = (): forge.md.MessageDigest => forge.md.sha384.create()
      const sha256 = (): forge.md.MessageDigest => forge.md.sha256.create()

      test('describes only the certificates that are sent, not a root that was replaced', () => {
        const certManager = new CertManager(new Logger('CertManager'), new NodeForge())
        const certs = [
          issue('leaf', 'inter', sha384()),
          issue('unused-root', 'unused-root', sha256()),
          issue('inter', 'real-root', sha384()),
          issue('real-root', 'real-root', sha384())
        ]

        const result = certManager.dumpPfx({ certs, keys: [keys.privateKey] })

        expect(result.provisioningCertificateObj.certChain).toHaveLength(3)
        expect(result.certificates.map((c) => c.name)).toEqual([
          'leaf',
          'inter',
          'real-root'
        ])
      })

      test('reports the certificates in the order they are sent', () => {
        const certManager = new CertManager(new Logger('CertManager'), new NodeForge())
        const certs = [
          issue('leaf', 'inter-a', sha384()),
          issue('inter-b', 'root', sha384()),
          issue('inter-a', 'inter-b', sha384()),
          issue('root', 'root', sha384())
        ]

        const result = certManager.dumpPfx({ certs, keys: [] })

        expect(result.certificates.map((c) => c.name)).toEqual([
          'leaf',
          'inter-a',
          'inter-b',
          'root'
        ])
      })

      test('counts a certificate bag that cannot be read', () => {
        const nodeForge = new NodeForge()
        const certManager = new CertManager(new Logger('CertManager'), nodeForge)
        const readable = issue('leaf', 'root', sha384())
        const oid = nodeForge.pkiOidsCertBag
        vi.spyOn(nodeForge, 'pkcs12FromAsn1').mockReturnValue({
          getBags: (filter: { bagType: string }) =>
            filter.bagType === oid
              ? { [oid]: [{ cert: null }, { cert: readable }] }
              : { [filter.bagType]: [{ key: keys.privateKey }] }
        } as any)

        const result = certManager.convertPfxToObject(TEST_PFXCERT, 'P@ssw0rd')

        expect(result.certs).toHaveLength(1)
        expect(result.unreadableCertificates).toBe(1)
        expect(certManager.dumpPfx(result).unreadableCertificates).toBe(1)
      })
    })

    test('should generate SHA384 fingerprint along with SHA256 and SHA1', () => {
      const nodeForge = new NodeForge()
      const certManager = new CertManager(new Logger('CertManager'), nodeForge)
      const pfxObj = certManager.convertPfxToObject(TEST_PFXCERT, 'P@ssw0rd')
      const certChainPfx = certManager.dumpPfx(pfxObj)

      expect(certChainPfx.fingerprint).toHaveProperty('sha384')
      expect(certChainPfx.fingerprint.sha384).toBeDefined()
      expect(certChainPfx.fingerprint.sha384).toHaveLength(96) // SHA384 produces 96 hex characters
    })
  })

  describe('createCertificate tests', () => {
    test('should generate leaf certificate with console enabled', () => {
      const nodeForge = new NodeForge()
      const certManager = new CertManager(new Logger('CertManager'), nodeForge)
      const keyUsage: AMTKeyUsage = {
        /** Extension ID  */
        name: 'extKeyUsage',
        /** Enables Console Usage */
        '2.16.840.1.113741.1.2.1': true,
        /** Enables Agent Usage */
        '2.16.840.1.113741.1.2.2': false,
        /** Enables AMT Activation Usage */
        '2.16.840.1.113741.1.2.3': false,
        /** Enables TLS Usage on the Server */
        serverAuth: false,
        /** Enables TLS Usage Usage on the Client */
        clientAuth: false,
        /** Enables Email Protection */
        emailProtection: false,
        /** Enables Code Signing */
        codeSigning: false,
        /** Enables Time Stamping */
        timeStamping: false
      }
      const certAttr: CertAttributes = {
        CN: 'commonName',
        C: 'country',
        ST: 'stateOrProvince',
        O: 'organization'
      }
      const leafSpy = vi.spyOn(certManager, 'generateLeafCertificate')

      const rootCert = certManager.createCertificate(certAttr)
      const leafCert = certManager.createCertificate(certAttr, rootCert.key, null, certAttr, keyUsage)
      expect(leafCert).toBeDefined()
      expect(leafSpy).toHaveBeenCalled()
      expect(leafCert.cert.serialNumber).toBeDefined()
      expect(leafCert.cert.serialNumber).toMatch(/^[0-7][0-9a-f]{31}$/)
      expect(leafCert.cert.publicKey).toBeDefined()
      expect(leafCert.cert.validity.notBefore).toEqual(new Date(2018, 0, 1))
      expect(leafCert.cert.validity.notAfter).toEqual(new Date(2049, 11, 31))
      expect(leafCert.cert.extensions.length).toEqual(5)
      expect(leafCert.cert.extensions[0].name).toEqual('basicConstraints')
      expect(leafCert.cert.extensions[1].name).toEqual('keyUsage')
      expect(leafCert.cert.extensions[1].keyCertSign).toBe(true)
      expect(leafCert.cert.extensions[1].digitalSignature).toBe(true)
      expect(leafCert.cert.extensions[1].nonRepudiation).toBe(true)
      expect(leafCert.cert.extensions[1].keyEncipherment).toBe(true)
      expect(leafCert.cert.extensions[1].dataEncipherment).toBe(true)
      expect(leafCert.cert.extensions[2].name).toEqual('extKeyUsage')
      expect(leafCert.cert.extensions[2]['2.16.840.1.113741.1.2.1']).toBe(true)
      expect(leafCert.cert.extensions[2]['2.16.840.1.113741.1.2.2']).toBe(false)
      expect(leafCert.cert.extensions[2]['2.16.840.1.113741.1.2.3']).toBe(false)
      expect(leafCert.cert.extensions[2].serverAuth).toBe(false)
      expect(leafCert.cert.extensions[2].clientAuth).toBe(true)
      expect(leafCert.cert.extensions[2].emailProtection).toBe(false)
      expect(leafCert.cert.extensions[2].codeSigning).toBe(false)
      expect(leafCert.cert.extensions[2].timeStamping).toBe(false)
      expect(leafCert.cert.extensions[3].name).toEqual('nsCertType')
      expect(leafCert.cert.extensions[3].client).toBe(true)
      expect(leafCert.cert.extensions[3].server).toBe(false)
      expect(leafCert.cert.extensions[3].email).toBe(false)
      expect(leafCert.cert.extensions[3].objsign).toBe(false)
      expect(leafCert.cert.extensions[4].name).toEqual('subjectKeyIdentifier')
      expect(leafCert.cert.issuer.attributes.length).toEqual(4)
      expect(leafCert.cert.issuer.attributes[0].value).toEqual(certAttr.CN)
      expect(leafCert.cert.issuer.attributes[1].value).toEqual(certAttr.C)
      expect(leafCert.cert.issuer.attributes[2].value).toEqual(certAttr.ST)
      expect(leafCert.cert.issuer.attributes[3].value).toEqual(certAttr.O)
      expect(leafCert.cert.subject.attributes.length).toEqual(4)
      expect(leafCert.cert.subject.attributes[0].value).toEqual(certAttr.CN)
      expect(leafCert.cert.subject.attributes[1].value).toEqual(certAttr.C)
      expect(leafCert.cert.subject.attributes[2].value).toEqual(certAttr.ST)
      expect(leafCert.cert.subject.attributes[3].value).toEqual(certAttr.O)
    })

    test('should sign a leaf certificate with SHA384 when requested', () => {
      const nodeForge = new NodeForge()
      const certManager = new CertManager(new Logger('CertManager'), nodeForge)
      const certAttr: CertAttributes = { CN: 'AMT', O: 'None', ST: 'None', C: 'None' }
      const keyUsage: AMTKeyUsage = { name: 'extKeyUsage', serverAuth: true } as any
      const rootCert = certManager.createCertificate(certAttr)

      const leafCert = certManager.createCertificate(certAttr, rootCert.key, null, certAttr, keyUsage, undefined, {
        hashAlgorithm: 'sha384'
      })

      expect(leafCert.cert.md.algorithm).toBe('sha384')
    })

    test('should generate root certificate', () => {
      const nodeForge = new NodeForge()
      const certManager = new CertManager(new Logger('CertManager'), nodeForge)
      const rootSpy = vi.spyOn(certManager, 'generateRootCertificate')
      const certAttr: CertAttributes = {
        CN: 'commonName',
        C: 'country',
        ST: 'stateOrProvince',
        O: 'organization'
      }
      const rootCert = certManager.createCertificate(certAttr)
      expect(rootSpy).toHaveBeenCalled()
      expect(rootCert).toBeDefined()
      expect(rootCert.cert.serialNumber).toBeDefined()
      expect(rootCert.cert.serialNumber).toMatch(/^[0-7][0-9a-f]{31}$/)
      expect(rootCert.cert.publicKey).toBeDefined()
      expect(rootCert.cert.md.algorithm).toBe('sha256')
      expect((rootCert.cert.publicKey as forge.pki.rsa.PublicKey).n.bitLength()).toBe(2048)
      expect(rootCert.cert.validity.notBefore).toEqual(new Date(2018, 0, 1))
      expect(rootCert.cert.validity.notAfter).toEqual(new Date(2049, 11, 31))
      expect(rootCert.cert.issuer.attributes.length).toEqual(4)
      expect(rootCert.cert.issuer.attributes[0].value).toEqual(certAttr.CN)
      expect(rootCert.cert.issuer.attributes[1].value).toEqual(certAttr.C)
      expect(rootCert.cert.issuer.attributes[2].value).toEqual(certAttr.ST)
      expect(rootCert.cert.issuer.attributes[3].value).toEqual(certAttr.O)
      expect(rootCert.cert.subject.attributes[0].value).toEqual(certAttr.CN)
      expect(rootCert.cert.subject.attributes[1].value).toEqual(certAttr.C)
      expect(rootCert.cert.subject.attributes[2].value).toEqual(certAttr.ST)
      expect(rootCert.cert.subject.attributes[3].value).toEqual(certAttr.O)
      expect(rootCert.cert.extensions.length).toEqual(3)
      expect(rootCert.cert.extensions[0].name).toEqual('basicConstraints')
      expect(rootCert.cert.extensions[0].cA).toBe(true)
      expect(rootCert.cert.extensions[1].name).toBe('nsCertType')
      expect(rootCert.cert.extensions[1].sslCA).toBe(true)
      expect(rootCert.cert.extensions[1].emailCA).toBe(true)
      expect(rootCert.cert.extensions[1].objCA).toBe(true)
      expect(rootCert.cert.extensions[2].name).toEqual('subjectKeyIdentifier')
    })

    test('should generate an AMT 22 root certificate with SHA384 and a 3072-bit key', () => {
      const nodeForge = new NodeForge()
      const certManager = new CertManager(new Logger('CertManager'), nodeForge)
      const certAttr: CertAttributes = { CN: 'AMT 22 Root', O: 'Intel', ST: 'California', C: 'US' }

      const rootCert = certManager.createCertificate(certAttr, null, null, null, null, undefined, {
        hashAlgorithm: 'sha384',
        rsaKeySize: 3072
      })

      expect(rootCert.cert.md.algorithm).toBe('sha384')
      expect((rootCert.cert.publicKey as forge.pki.rsa.PublicKey).n.bitLength()).toBe(3072)
    })
  })

  describe('EC device keys', () => {
    // AMT 22 generates an ECC-384 key pair and returns its SubjectPublicKeyInfo
    // as AMT_PublicPrivateKeyPair.DERKey. node-forge cannot parse an EC SPKI, so
    // the leaf is assembled from node-forge's generic ASN.1 encoders around the key node:crypto validated. These
    // tests check the resulting certificate with node:crypto.
    const issueEcLeaf = (): { leafCert: any; rootCert: any; spki: Buffer } => {
      const nodeForge = new NodeForge()
      const certManager = new CertManager(new Logger('CertManager'), nodeForge)
      const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'secp384r1' })
      const spki = publicKey.export({ type: 'spki', format: 'der' }) as Buffer

      const rootAttr: CertAttributes = { CN: 'MPSRoot-f95514', O: 'unknown', C: 'unknown' }
      const leafAttr: CertAttributes = { CN: 'AMT-testhost', C: 'None', ST: 'None', O: 'None' }
      const keyUsage: AMTKeyUsage = { name: 'extKeyUsage', serverAuth: true } as AMTKeyUsage
      const rootCert = certManager.createCertificate(rootAttr, null, null, null, null, undefined, {
        hashAlgorithm: 'sha384',
        rsaKeySize: 3072
      })

      const leafCert = certManager.amtCertSignWithCAKey(
        spki.toString('base64'),
        rootCert.key,
        leafAttr,
        rootAttr,
        keyUsage,
        rootCert.pem,
        { hashAlgorithm: 'sha384', rsaKeySize: 3072 }
      )
      return { leafCert, rootCert, spki }
    }

    test('carries the AMT EC public key into the leaf byte-for-byte', () => {
      const { leafCert, spki } = issueEcLeaf()
      const parsed = new X509Certificate(Buffer.from(leafCert.certbin, 'base64'))

      expect(parsed.publicKey.asymmetricKeyType).toBe('ec')
      expect(parsed.publicKey.asymmetricKeyDetails?.namedCurve).toBe('secp384r1')
      expect(parsed.publicKey.export({ type: 'spki', format: 'der' })).toEqual(spki)
    })

    test('signs over the EC key', () => {
      const { leafCert, rootCert } = issueEcLeaf()
      const parsed = new X509Certificate(Buffer.from(leafCert.certbin, 'base64'))
      const root = new X509Certificate(Buffer.from(rootCert.certbin, 'base64'))

      // verify() re-digests the TBSCertificate that is actually in the DER. It
      // only passes if the EC SPKI was present when the signature was taken.
      expect(parsed.verify(root.publicKey)).toBe(true)
      expect(parsed.checkIssued(root)).toBe(true)
    })

    test('does not set the key encipherment bits that RFC 5480 forbids for an EC key', () => {
      const { leafCert } = issueEcLeaf()
      const parsed = forgeAsn1.fromDer(Buffer.from(leafCert.certbin, 'base64').toString('binary'))
      const tbs = (parsed.value as any[])[0].value as any[]
      const extensions = tbs[tbs.length - 1].value[0].value as any[]
      const keyUsageExt = extensions.find((e) => forgeAsn1.derToOid(e.value[0].value) === '2.5.29.15')
      // extnValue is an OCTET STRING wrapping the BIT STRING: the first byte is the unused-bit count, then the bits
      const bits = forgeAsn1.fromDer(keyUsageExt.value[keyUsageExt.value.length - 1].value).value as string
      const usage = bits.charCodeAt(1)

      expect(usage & 0x80).toBeTruthy() // digitalSignature
      expect(usage & 0x20).toBeFalsy() // keyEncipherment
      expect(usage & 0x10).toBeFalsy() // dataEncipherment
    })

    test('derives the subjectKeyIdentifier from the EC point', () => {
      const { leafCert, spki } = issueEcLeaf()
      // RFC 5280 4.2.1.2 method (1): SHA-1 over the subjectPublicKey BIT STRING contents, which for an uncompressed
      // EC key is 0x04 || x || y. Derived here from the JWK, independently of the code under test.
      const jwk = createPublicKey({ key: spki, format: 'der', type: 'spki' }).export({ format: 'jwk' })
      const point = Buffer.concat([
        Buffer.from([4]),
        Buffer.from(jwk.x, 'base64url'),
        Buffer.from(jwk.y, 'base64url')
      ])
      const expected = createHash('sha1').update(point).digest()

      const parsed = forgeAsn1.fromDer(Buffer.from(leafCert.certbin, 'base64').toString('binary'))
      const tbs = (parsed.value as any[])[0].value as any[]
      const extensions = tbs[tbs.length - 1].value[0].value as any[]
      const ski = extensions.find((e) => forgeAsn1.derToOid(e.value[0].value) === '2.5.29.14')
      // extnValue is an OCTET STRING wrapping the OCTET STRING with the identifier
      const wrapped = forgeAsn1.fromDer(ski.value[ski.value.length - 1].value)
      expect(Buffer.from(wrapped.value as string, 'binary')).toEqual(expected)
    })

    test('produces the same bytes as node-forge would for an RSA key', () => {
      // The EC path assembles the TBSCertificate itself. With an RSA device key node-forge can build the same
      // certificate, and RSA PKCS#1 v1.5 signatures are deterministic, so the two outputs must be identical.
      const nodeForge = new NodeForge()
      const certManager = new CertManager(new Logger('CertManager'), nodeForge)
      const certAttr: CertAttributes = { CN: 'AMT-testhost', O: 'None', ST: 'None', C: 'None' }
      const rootCert = certManager.createCertificate(certAttr, null, null, null, null, undefined, {
        hashAlgorithm: 'sha384',
        rsaKeySize: 3072
      })
      const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
      const spki = publicKey.export({ type: 'spki', format: 'der' }) as Buffer
      const usage = { name: 'extKeyUsage', serverAuth: true } as AMTKeyUsage
      const forgeLeaf = certManager.createCertificate(
        certAttr,
        rootCert.key,
        spki.toString('base64'),
        certAttr,
        usage,
        rootCert.pem,
        { hashAlgorithm: 'sha384', rsaKeySize: 3072 }
      )

      const der = issueLeafWithDeviceKey({
        cert: forgeLeaf.cert as any,
        devicePublicKey: { spki, keyIdentifier: Buffer.alloc(0) },
        caPrivateKeyPem: nodeForge.privateKeyToPem(rootCert.key),
        hashAlgorithm: 'sha384'
      })

      expect(der.toString('base64')).toBe(forgeLeaf.certbin)
    })

    test('rejects a public key that is neither RSA nor EC', () => {
      const nodeForge = new NodeForge()
      const certManager = new CertManager(new Logger('CertManager'), nodeForge)
      const certAttr: CertAttributes = { CN: 'AMT-testhost', O: 'None', ST: 'None', C: 'None' }
      const rootCert = certManager.createCertificate(certAttr)
      const { publicKey } = generateKeyPairSync('ed25519')
      const spki = (publicKey.export({ type: 'spki', format: 'der' }) as Buffer).toString('base64')

      expect(() => certManager.createCertificate(certAttr, rootCert.key, spki, certAttr, null)).toThrow(
        UnsupportedCertificateError
      )
    })

    test('keeps an RSA device key on the node-forge path', () => {
      const nodeForge = new NodeForge()
      const certManager = new CertManager(new Logger('CertManager'), nodeForge)
      const externalKeySpy = vi.spyOn(certManager, 'parseExternalPublicKey')
      const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
      const spki = (publicKey.export({ type: 'spki', format: 'der' }) as Buffer).toString('base64')
      const certAttr: CertAttributes = { CN: 'AMT-testhost', O: 'None', ST: 'None', C: 'None' }
      const rootCert = certManager.createCertificate(certAttr)

      const leafCert = certManager.createCertificate(certAttr, rootCert.key, spki, certAttr, {
        name: 'extKeyUsage',
        serverAuth: true
      } as AMTKeyUsage)

      expect(externalKeySpy).not.toHaveBeenCalled()
      expect(new X509Certificate(Buffer.from(leafCert.certbin, 'base64')).publicKey.asymmetricKeyType).toBe('rsa')
    })

    test('rejects a device key that is neither RSA nor valid DER', () => {
      const nodeForge = new NodeForge()
      const certManager = new CertManager(new Logger('CertManager'), nodeForge)
      const certAttr: CertAttributes = { CN: 'AMT-testhost', O: 'None', ST: 'None', C: 'None' }
      const rootCert = certManager.createCertificate(certAttr)

      expect(() =>
        certManager.createCertificate(certAttr, rootCert.key, Buffer.from('not der').toString('base64'), certAttr, null)
      ).toThrow(UnsupportedCertificateError)
    })
  })

  describe('amtCertSignWithCAKey tests', () => {
    test('should sign AMT Cert with CA Key', () => {
      const nodeForge = new NodeForge()
      const certManager = new CertManager(new Logger('CertManager'), nodeForge)
      const keys = nodeForge.rsaGenerateKeyPair(2048)
      const createCertificateSpy = vi.spyOn(certManager, 'createCertificate')
      const generateLeafCertificateSpy = vi.spyOn(certManager, 'generateLeafCertificate')

      const certAttr: CertAttributes = { CN: 'AMT', O: 'None', ST: 'None', C: 'None' }
      const issuerAttr: CertAttributes = { CN: 'Untrusted Root Certificate' }
      const extKeyUsage: AMTKeyUsage = { name: 'extKeyUsage', serverAuth: true } as any
      const derkey = `MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAw51PMBm2psyIjHPU1efH
      Ulyh22zy3hEhlsNPH6/Cqg0HJorX1WbNKLfiU2aAt24jn4CC+y8PusrmMMCIca5x
      0L4XZxm14QvKKImIOMOMblS1Te29n64HuuQ9owKLHuSMww4wiLiY/nAvjK/5/kKT
      HL6x7nK/Pq72eoQ/etFBkaX5nYGUD/+G+5BgAPx1mBgU5/y9+/+QZ9xbYU6zogOW
      Tfa6rDMSAbmJOtkk1ghnuaq4dSoHWbW+zpHMVtjtHgzDGhX9KjOmvSDQIGn4wevD
      p2yDLULUbsdO4ylacTkxyIc92ZHdZeP6Hh+KhNC04Z65zwXLEA3M4bucX+u6nszW
      xwIDAQAB`
      certManager.amtCertSignWithCAKey(derkey, keys.privateKey, certAttr, issuerAttr, extKeyUsage)
      expect(createCertificateSpy).toHaveBeenCalledTimes(1)
      expect(generateLeafCertificateSpy).toHaveBeenCalled()
    })
    test('should set caPrivateKey to certAndKey.key if caPrivateKey is null', () => {
      const nodeForge = new NodeForge()
      const certManager = new CertManager(new Logger('CertManager'), nodeForge)
      const createCertificateSpy = vi.spyOn(certManager, 'createCertificate')
      const generateLeafCertificateSpy = vi.spyOn(certManager, 'generateLeafCertificate')

      const certAttr: CertAttributes = { CN: 'AMT', O: 'None', ST: 'None', C: 'None' }
      const issuerAttr: CertAttributes = { CN: 'Untrusted Root Certificate' }
      const extKeyUsage: AMTKeyUsage = { name: 'extKeyUsage', serverAuth: true } as any
      const derkey = `MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAw51PMBm2psyIjHPU1efH
      Ulyh22zy3hEhlsNPH6/Cqg0HJorX1WbNKLfiU2aAt24jn4CC+y8PusrmMMCIca5x
      0L4XZxm14QvKKImIOMOMblS1Te29n64HuuQ9owKLHuSMww4wiLiY/nAvjK/5/kKT
      HL6x7nK/Pq72eoQ/etFBkaX5nYGUD/+G+5BgAPx1mBgU5/y9+/+QZ9xbYU6zogOW
      Tfa6rDMSAbmJOtkk1ghnuaq4dSoHWbW+zpHMVtjtHgzDGhX9KjOmvSDQIGn4wevD
      p2yDLULUbsdO4ylacTkxyIc92ZHdZeP6Hh+KhNC04Z65zwXLEA3M4bucX+u6nszW
      xwIDAQAB`
      certManager.amtCertSignWithCAKey(derkey, null, certAttr, issuerAttr, extKeyUsage)
      expect(createCertificateSpy).toHaveBeenCalledTimes(2)
      expect(generateLeafCertificateSpy).toHaveBeenCalled()
    })
  })

  describe('getExpirationDate tests', () => {
    test('should retrieve the correct expiry date', () => {
      const nodeForge = new NodeForge()
      const certManager = new CertManager(new Logger('CertManager'), nodeForge)
      const provisioningCert =
        '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'
      const provisioningCertPassword = 'P@ssw0rd'
      const expectedExpDate = new Date('2033-05-03T07:11:10.000Z')
      const result = certManager.getExpirationDate(provisioningCert, provisioningCertPassword)
      expect(result).toEqual(expectedExpDate)
    })
  })
})
