/*********************************************************************
 * Copyright (c) Intel Corporation 2026
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { createPublicKey, X509Certificate } from 'node:crypto'
import forge from 'node-forge'

const SERVER_AUTH = '1.3.6.1.5.5.7.3.1'

export interface TlsInventory {
  certificates: any[] // AMT_PublicKeyCertificate
  keys: any[] // AMT_PublicPrivateKeyPair
  tlsContexts: any // AMT_TLSCredentialContext items: they establish which certificate TLS uses
  otherContexts: any // 802.1X, Wi-Fi and remote-access associations: they only protect what they reference
  signingKey?: any // private key RPS signs TLS leaves with (MPSCerts root_key); only its public half is used
  persistedLeafPem?: string // TLS leaf saved for this device after activation
}

// PEM from RPS is often single-line and AMT returns bare base64, so decode the DER directly.
const parse = (cert: string): X509Certificate =>
  new X509Certificate(Buffer.from(cert.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, ''), 'base64'))

const isFalse = (value: any): boolean => value === false || value === 'false'

const publicKeyOf = (cert: X509Certificate): string =>
  cert.publicKey.export({ type: 'spki', format: 'der' }).toString('base64')

const keyId = (der: string): string => {
  for (const type of ['spki', 'pkcs1'] as const) {
    try {
      return createPublicKey({ key: Buffer.from(der, 'base64'), type, format: 'der' })
        .export({ type: 'spki', format: 'der' })
        .toString('base64')
    } catch {
      // try the other encoding
    }
  }
  throw new Error('Unrecognised AMT public key')
}

// An unreadable association is unknown usage, never proof that an object is unused.
const referenceIds = (contexts: any): Set<string> => {
  const ids = new Set<string>()
  const endpoint = (value: any, providing = false): void => {
    const selectors: any[] = []
    const visit = (item: any): void => {
      if (item == null || typeof item !== 'object') return
      for (const [name, child] of Object.entries(item)) {
        if (name === 'Selector') selectors.push(...(Array.isArray(child) ? child : [child]))
        else visit(child)
      }
    }
    visit(value)
    // The TLS providing endpoint identifies a protocol collection, not a certificate or key.
    if (
      providing &&
      value?.ReferenceParameters?.ResourceURI ===
        'http://intel.com/wbem/wscim/1/amt-schema/1/AMT_TLSProtocolEndpointCollection' &&
      selectors.length === 1 &&
      selectors[0]?.$?.Name === 'ElementName' &&
      /^TLSProtocolEndpoint ?Instances Collection$/.test(selectors[0]._)
    )
      return
    const instanceIds = selectors.filter((selector) => selector?.$?.Name == null || selector.$.Name === 'InstanceID')
    if (!instanceIds.length || instanceIds.some((selector) => typeof selector?._ !== 'string' || !selector._)) {
      throw new Error('Unreadable credential reference')
    }
    instanceIds.forEach((selector) => ids.add(selector._))
  }
  const visit = (value: any): void => {
    if (value == null || value === '') return
    if (Array.isArray(value)) {
      return value.forEach((association) => {
        if (association == null || association === '') throw new Error('Unreadable credential association')
        visit(association)
      })
    }
    if (typeof value !== 'object' || !Object.keys(value).length) throw new Error('Unreadable credential association')
    if ('ElementInContext' in value) {
      endpoint(value.ElementInContext)
      endpoint(value.ElementProvidingContext, true)
    } else {
      for (const [name, associations] of Object.entries(value)) {
        if (!name.endsWith('CredentialContext') || associations == null) {
          throw new Error('Unreadable credential association')
        }
        visit(associations)
      }
    }
  }
  visit(contexts)
  return ids
}

/**
 * Selects TLS certificates (and their key pairs) left on AMT by an interrupted provisioning attempt.
 *
 * Nothing is selected unless the saved TLS identity is on AMT, with its key, and is referenced by a TLS
 * credential context. A certificate is abandoned only when RPS provably issued it (server-auth leaf named
 * AMT-*, signed by the key RPS holds) and no association of any kind references it. A key is removed only
 * with its abandoned certificate and only when no other certificate or reference needs it. If anything is
 * unclear, nothing is selected.
 */
export function findAbandonedTlsObjects(inventory: TlsInventory): { certificates: any[]; keys: any[] } {
  const none = { certificates: [], keys: [] }
  const { certificates, keys, tlsContexts, otherContexts, signingKey, persistedLeafPem } = inventory
  if (!signingKey || !persistedLeafPem) return none
  try {
    // Ownership is proven by a signature from the key RPS holds, not by an issuer name or a cached CA.
    const signer = createPublicKey(forge.pki.publicKeyToPem(forge.pki.setRsaPublicKey(signingKey.n, signingKey.e)))
    const tlsReferences = referenceIds(tlsContexts)
    const references = new Set([...tlsReferences, ...referenceIds(otherContexts)])
    const isReferenced = (object: any): boolean => references.has(object.InstanceID)
    const parsed = certificates.map((entry) => ({ entry, x509: parse(entry.X509Certificate) }))

    // The identity RPS saved must be installed, in use by TLS, and backed by a key; otherwise stop.
    const saved = parse(persistedLeafPem)
    // AMT may hold several copies of the saved certificate; the one TLS references is the identity in use.
    const active = parsed.find(
      ({ entry, x509 }) => x509.fingerprint256 === saved.fingerprint256 && tlsReferences.has(entry.InstanceID)
    )
    if (!active || !keys.some((key) => keyId(key.DERKey) === publicKeyOf(active.x509))) {
      return none
    }
    const abandoned = parsed.filter(
      ({ entry, x509 }) =>
        !isReferenced(entry) &&
        isFalse(entry.TrustedRootCertficate) && // sic: AMT's spelling
        isFalse(entry.ReadOnlyCertificate) &&
        x509.fingerprint256 !== saved.fingerprint256 &&
        /^CN=AMT-/m.test(x509.subject) &&
        !x509.ca &&
        x509.keyUsage?.length === 1 &&
        x509.keyUsage[0] === SERVER_AUTH &&
        x509.verify(signer)
    )
    const abandonedKeyIds = new Set(abandoned.map(({ x509 }) => publicKeyOf(x509)))
    const keptKeyIds = new Set(parsed.filter((item) => !abandoned.includes(item)).map(({ x509 }) => publicKeyOf(x509)))
    return {
      certificates: abandoned.map(({ entry }) => entry),
      keys: keys.filter((key) => {
        const id = keyId(key.DERKey)
        return abandonedKeyIds.has(id) && !keptKeyIds.has(id) && !isReferenced(key)
      })
    }
  } catch {
    return none
  }
}
