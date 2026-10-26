/*********************************************************************
 * Copyright (c) Intel Corporation 2026
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import crypto from 'node:crypto'
import forge from 'node-forge'
import { vi } from 'vitest'
import { TLSTunnelManager, isIntelDiceSubCASubject } from './TLSTunnelManager.js'
import { AMT_ODCA_ROOT_CERTS } from './certs/amt-odca.js'
import Logger from './Logger.js'

const DICE_SUBJECT = 'O=Intel Corporation\norganizationIdentifier=PEN:343\nCN=Intel DICE SubCA CAID:343_1'

/** A self-signed certificate with the given subject attributes, as DER. */
const selfSignedDer = (attributes: forge.pki.CertificateField[]): Buffer => {
  const keys = forge.pki.rsa.generateKeyPair(1024)
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = '01'
  cert.validity.notBefore = new Date()
  cert.validity.notAfter = new Date(Date.now() + 86400000)
  cert.setSubject(attributes)
  cert.setIssuer(attributes)
  cert.sign(keys.privateKey)
  return Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(), 'binary')
}

const verify = (chainDer: Buffer[]): { ok: boolean; reason: string } => {
  const manager: any = new TLSTunnelManager({ on: vi.fn(), send: vi.fn() } as any, 'client', true)
  manager.peerChainDer = chainDer
  return manager.verifyAmtChainAgainstODCA({})
}

describe('isIntelDiceSubCASubject', () => {
  it('identifies the Intel DICE SubCA subject', () => {
    expect(isIntelDiceSubCASubject(DICE_SUBJECT)).toBe(true)
  })

  it.each([
    'O=Example Corporation\norganizationIdentifier=PEN:343\nCN=Intel DICE SubCA CAID:343_1',
    'O=Intel Corporation\nCN=Intel DICE SubCA CAID:343_1',
    'O=Intel Corporation\norganizationIdentifier=PEN:343\nCN=Example SubCA'
  ])('rejects a subject that is not the Intel DICE SubCA: %s', (subject) => {
    expect(isIntelDiceSubCASubject(subject)).toBe(false)
  })
})

describe('AMT chain verification', () => {
  it('warns and accepts an Intel DICE chain', () => {
    const der = selfSignedDer([
      { name: 'organizationName', value: 'Intel Corporation' },
      { type: '2.5.4.97', value: 'PEN:343' },
      { name: 'commonName', value: 'Intel DICE SubCA CAID:343_1' }
    ])
    expect(new crypto.X509Certificate(der).subject).toBe(DICE_SUBJECT)
    const warnSpy = vi.spyOn(Logger.prototype, 'warn')

    const result = verify([der])

    expect(result.ok).toBe(true)
    expect(result.reason).toBe('Intel DICE chain accepted without validation')
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('SECURITY WARNING: Intel DICE certificate chain'))
  })

  it('still rejects a chain that does not end at an ODCA root', () => {
    const der = selfSignedDer([{ name: 'commonName', value: 'Not Intel' }])

    const result = verify([der])

    expect(result.ok).toBe(false)
    expect(result.reason).toContain('does not terminate at any trusted ODCA root')
  })

  it('still accepts a chain that ends at an ODCA root', () => {
    const root = new crypto.X509Certificate(AMT_ODCA_ROOT_CERTS[0])

    const result = verify([root.raw])

    expect(result.ok).toBe(true)
    expect(result.reason).toContain('trusted ODCA root')
  })
})
