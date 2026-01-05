/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import forge from 'node-forge'

export class NodeForge {
  public readonly pkiOidsCertBag: string = '1.2.840.113549.1.12.10.1.3'
  public readonly pkcs8ShroudedKeyBag: string = '1.2.840.113549.1.12.10.1.2'

  pkcs12FromAsn1(obj: any, strict?: boolean, password?: string): forge.pkcs12.Pkcs12Pfx {
    return forge.pkcs12.pkcs12FromAsn1(obj, strict, password)
  }

  asn1FromDer(input: string, strict?: boolean): forge.asn1.Asn1 {
    return forge.asn1.fromDer(input, strict)
  }

  getBags(
    pkcs12Pfx: forge.pkcs12.Pkcs12Pfx,
    filter: forge.pkcs12.BagsFilter
  ): {
    [key: string]: forge.pkcs12.Bag[] | undefined
    localKeyId?: forge.pkcs12.Bag[]
    friendlyName?: forge.pkcs12.Bag[]
  } {
    return pkcs12Pfx.getBags(filter)
  }

  pkiCertificateToPem(cert: forge.pki.Certificate, maxline?: number): string {
    return forge.pki.certificateToPem(cert, maxline)
  }

  asn1ToDer(obj: forge.asn1.Asn1): forge.util.ByteStringBuffer {
    return forge.asn1.toDer(obj)
  }

  pkiCertificateToAsn1(cert: forge.pki.Certificate): forge.asn1.Asn1 {
    return forge.pki.certificateToAsn1(cert)
  }

  sha256Create(): forge.md.MessageDigest {
    return forge.md.sha256.create()
  }

  sha384Create(): forge.md.MessageDigest {
    return forge.md.sha384.create()
  }

  sha1Create(): forge.md.MessageDigest {
    return forge.md.sha1.create()
  }

  privateKeyToPem(key: forge.pki.PrivateKey, maxline?: number): string {
    return forge.pki.privateKeyToPem(key, maxline)
  }

  publicKeyFromPem(pem: string): forge.pki.rsa.PublicKey {
    return forge.pki.publicKeyFromPem(pem)
  }

  rsaGenerateKeyPair(length: number): forge.pki.rsa.KeyPair {
    return forge.pki.rsa.generateKeyPair(length)
  }

  createCert(): forge.pki.Certificate {
    return forge.pki.createCertificate()
  }
}
