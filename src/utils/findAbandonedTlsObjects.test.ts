/*********************************************************************
 * Copyright (c) Intel Corporation 2026
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { generateKeyPairSync } from 'node:crypto'
import forge from 'node-forge'
import { describe, expect, it } from 'vitest'
import { CertManager } from '../certManager.js'
import Logger from '../Logger.js'
import { NodeForge } from '../NodeForge.js'
import { findAbandonedTlsObjects } from './findAbandonedTlsObjects.js'

const certManager = new CertManager(new Logger('test'), new NodeForge())
const issuer = { CN: 'MPSRoot' }
const root = certManager.createCertificate(issuer)
const otherRoot = certManager.createCertificate(issuer)
const extKeyUsage = (extra: Record<string, boolean>): any => ({
  name: 'extKeyUsage',
  serverAuth: true,
  clientAuth: false,
  ...extra
})

// A device key pair in AMT's format (base64 SPKI) and the matching AMT_PublicPrivateKeyPair entry.
const deviceKey = (handle: number): { DERKey: string; key: any } => {
  const spki = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'der' })
  const DERKey = spki.toString('base64')
  return { DERKey, key: { InstanceID: `Intel(r) AMT Key: Handle: ${handle}`, DERKey } }
}
const leaf = (DERKey: string, options: { cn?: string; ca?: any; extraUsage?: Record<string, boolean> } = {}): string =>
  certManager.amtCertSignWithCAKey(
    DERKey,
    (options.ca ?? root).key,
    { CN: options.cn ?? 'AMT-device' },
    issuer,
    extKeyUsage(options.extraUsage ?? {}),
    root.pem
  ).pem
// A CA certificate with the AMT-* name, signed by the same root.
const caCertificate = (DERKey: string): string => {
  const cert = forge.pki.createCertificate()
  cert.publicKey = forge.pki.publicKeyFromPem(`-----BEGIN PUBLIC KEY-----${DERKey}-----END PUBLIC KEY-----`)
  cert.serialNumber = '01'
  cert.validity.notBefore = new Date(2018, 0, 1)
  cert.validity.notAfter = new Date(2049, 11, 31)
  cert.setSubject([{ name: 'commonName', value: 'AMT-ca' }])
  cert.setIssuer(root.cert.subject.attributes)
  cert.setExtensions([
    { name: 'basicConstraints', cA: true },
    { name: 'extKeyUsage', serverAuth: true }
  ])
  cert.sign(root.key, forge.md.sha256.create())
  return forge.pki.certificateToPem(cert).replace(/\r?\n/g, '')
}
const certEntry = (handle: number, pem: string, flags: Record<string, boolean> = {}): any => ({
  InstanceID: `Intel(r) AMT Certificate: Handle: ${handle}`,
  X509Certificate: pem,
  TrustedRootCertficate: false,
  ReadOnlyCertificate: false,
  ...flags
})
const contextFor = (...handles: number[]): any => ({
  AMT_TLSCredentialContext: handles.map((handle) => ({
    ElementInContext: {
      ReferenceParameters: {
        SelectorSet: { Selector: { _: `Intel(r) AMT Certificate: Handle: ${handle}`, $: { Name: 'InstanceID' } } }
      }
    }
  }))
})

describe('findAbandonedTlsObjects', () => {
  const active = deviceKey(0)
  const orphan = deviceKey(1)
  const activeEntry = certEntry(0, leaf(active.DERKey))
  const orphanEntry = certEntry(1, leaf(orphan.DERKey))
  const base = {
    certificates: [activeEntry, orphanEntry],
    keys: [active.key, orphan.key],
    tlsContexts: contextFor(0),
    otherContexts: [],
    signingKey: root.key,
    persistedLeafPem: activeEntry.X509Certificate
  }
  const nothing = { certificates: [], keys: [] }

  it('selects an unreferenced leaf signed by the RPS signing key and its key pair', () => {
    const result = findAbandonedTlsObjects(base)
    expect(result.certificates).toEqual([orphanEntry])
    expect(result.keys).toEqual([orphan.key])
  })

  it('recognises its own leaves when the root has attributes that tls.ts does not copy into the issuer', () => {
    // tls.ts copies only CN, O and C from the root, so the leaf issuer name differs from this root's subject.
    const stRoot = certManager.createCertificate({ CN: 'MPSRoot', ST: 'None' })
    const ownLeaf = certEntry(1, leaf(orphan.DERKey, { ca: stRoot }))
    const result = findAbandonedTlsObjects({
      ...base,
      certificates: [activeEntry, ownLeaf],
      signingKey: stRoot.key
    })
    expect(result).toEqual({ certificates: [ownLeaf], keys: [orphan.key] })
  })

  it('accepts raw base64 DER certificates as AMT returns them', () => {
    const raw = certEntry(1, orphanEntry.X509Certificate.replace(/-----[A-Z ]+-----/g, ''))
    expect(findAbandonedTlsObjects({ ...base, certificates: [activeEntry, raw] }).certificates).toEqual([raw])
  })

  it('selects nothing when no certificate is referenced by a credential context', () => {
    expect(findAbandonedTlsObjects({ ...base, tlsContexts: '' })).toEqual(nothing)
  })

  it('selects nothing without the signing key RPS holds', () => {
    expect(findAbandonedTlsObjects({ ...base, signingKey: undefined })).toEqual(nothing)
  })

  it('does not treat a non-TLS reference as proof that TLS works', () => {
    const wifiOnly = { ...base, tlsContexts: '', otherContexts: contextFor(0) }
    expect(findAbandonedTlsObjects(wifiOnly)).toEqual(nothing)
  })

  it('selects nothing unless the saved identity is installed, in use by TLS, and has its key', () => {
    const replacement = certEntry(5, leaf(deviceKey(5).DERKey))
    expect(findAbandonedTlsObjects({ ...base, persistedLeafPem: undefined })).toEqual(nothing)
    expect(findAbandonedTlsObjects({ ...base, persistedLeafPem: replacement.X509Certificate })).toEqual(nothing)
    expect(findAbandonedTlsObjects({ ...base, tlsContexts: contextFor(1) })).toEqual(nothing)
    expect(findAbandonedTlsObjects({ ...base, keys: [orphan.key] })).toEqual(nothing)
  })

  it('keeps objects that 802.1X, Wi-Fi or remote-access associations reference', () => {
    const result = findAbandonedTlsObjects({ ...base, otherContexts: contextFor(1) })
    expect(result).toEqual(nothing)
  })

  it('finds the TLS-referenced copy even when an unreferenced duplicate is listed first', () => {
    const duplicate = certEntry(2, activeEntry.X509Certificate)
    const result = findAbandonedTlsObjects({ ...base, certificates: [
        duplicate,
        activeEntry,
        orphanEntry
      ] })
    expect(result).toEqual({ certificates: [orphanEntry], keys: [orphan.key] })
  })

  it('keeps a duplicate entry of the active leaf', () => {
    const duplicate = certEntry(2, activeEntry.X509Certificate)
    expect(findAbandonedTlsObjects({ ...base, certificates: [activeEntry, duplicate] }).certificates).toEqual([])
  })

  it('selects an abandoned certificate whose key was already removed', () => {
    const result = findAbandonedTlsObjects({ ...base, keys: [active.key] })
    expect(result).toEqual({ certificates: [orphanEntry], keys: [] })
  })

  it.each([
    ['trusted root', { TrustedRootCertficate: true }],
    ['read-only', { ReadOnlyCertificate: true }]
  ])('keeps %s certificates', (_name, flags) => {
    const protectedEntry = certEntry(1, orphanEntry.X509Certificate, flags)
    expect(findAbandonedTlsObjects({ ...base, certificates: [activeEntry, protectedEntry] })).toEqual(nothing)
  })

  it('keeps certificates not signed by the RPS CA', () => {
    const foreign = certEntry(1, leaf(orphan.DERKey, { ca: otherRoot }))
    expect(findAbandonedTlsObjects({ ...base, certificates: [activeEntry, foreign] }).certificates).toEqual([])
  })

  it('keeps certificates RPS would not issue for TLS', () => {
    const notAmt = certEntry(1, leaf(orphan.DERKey, { cn: 'someone-else' }))
    const clientAuth = certEntry(1, leaf(orphan.DERKey, { extraUsage: { clientAuth: true } }))
    const extraUsage = certEntry(1, leaf(orphan.DERKey, { extraUsage: { codeSigning: true } }))
    const ca = certEntry(1, caCertificate(orphan.DERKey))
    for (const entry of [
      notAmt,
      clientAuth,
      extraUsage,
      ca
    ]) {
      expect(findAbandonedTlsObjects({ ...base, certificates: [activeEntry, entry] }).certificates).toEqual([])
    }
  })

  it('keeps a key that another certificate still uses', () => {
    const sharing = certEntry(2, leaf(orphan.DERKey, { cn: 'other-identity' }))
    const result = findAbandonedTlsObjects({ ...base, certificates: [
        activeEntry,
        orphanEntry,
        sharing
      ] })
    expect(result.certificates).toEqual([orphanEntry])
    expect(result.keys).toEqual([])
  })

  it('keeps keys without an abandoned certificate', () => {
    const stray = deviceKey(2)
    expect(
      findAbandonedTlsObjects({ ...base, keys: [
          active.key,
          orphan.key,
          stray.key
        ] }).keys
    ).toEqual([orphan.key])
  })

  it('selects nothing when inventory cannot be parsed', () => {
    const broken = certEntry(3, 'not a certificate')
    expect(
      findAbandonedTlsObjects({ ...base, certificates: [
          activeEntry,
          orphanEntry,
          broken
        ] })
    ).toEqual({
      certificates: [],
      keys: []
    })
  })
})
