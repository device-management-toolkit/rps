/*********************************************************************
 * Copyright (c) Intel Corporation 2026
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/
import forge from 'node-forge'

export function createTlsReuseCertificates(): {
  root: string
  leaf: string
  issue: (hostname: string, days: number, startDays?: number) => string
} {
  const rootKeys = forge.pki.rsa.generateKeyPair(2048)
  const leafKeys = forge.pki.rsa.generateKeyPair(2048)
  const ca = forge.pki.createCertificate()
  ca.publicKey = rootKeys.publicKey
  ca.serialNumber = '01'
  ca.validity.notBefore = new Date(Date.now() - 86400000)
  ca.validity.notAfter = new Date(Date.now() + 365 * 86400000)
  ca.setSubject([{ name: 'commonName', value: 'Test MPS root' }])
  ca.setIssuer(ca.subject.attributes)
  ca.setExtensions([
    { name: 'basicConstraints', cA: true },
    { name: 'keyUsage', keyCertSign: true }
  ])
  ca.sign(rootKeys.privateKey, forge.md.sha256.create())
  const issue = (hostname: string, days: number, startDays = -1): string => {
    const leaf = forge.pki.createCertificate()
    leaf.publicKey = leafKeys.publicKey
    leaf.serialNumber = '02'
    leaf.validity.notBefore = new Date(Date.now() + startDays * 86400000)
    leaf.validity.notAfter = new Date(Date.now() + days * 86400000)
    leaf.setSubject([{ name: 'commonName', value: `AMT-${hostname}` }])
    leaf.setIssuer(ca.subject.attributes)
    leaf.setExtensions([
      { name: 'basicConstraints', cA: false },
      { name: 'extKeyUsage', serverAuth: true }
    ])
    leaf.sign(rootKeys.privateKey, forge.md.sha256.create())
    return forge.pki.certificateToPem(leaf)
  }
  return { root: forge.pki.certificateToPem(ca), leaf: issue('test-device', 90), issue }
}
