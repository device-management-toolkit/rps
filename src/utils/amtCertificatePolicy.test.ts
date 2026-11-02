/*********************************************************************
 * Copyright (c) Intel Corporation 2026
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { AMT } from '@device-management-toolkit/wsman-messages'
import { getAMTCertificatePolicy, resolveProvisioningSignature } from './amtCertificatePolicy.js'

const RSA_2048 = { KeyAlgorithm: 0, KeyLength: 2048 }
const ECC_384 = { KeyAlgorithm: 1, KeyLength: 384 }

describe('getAMTCertificatePolicy', () => {
  it.each([
    // [version, weakAlgorithmsRemoved, expected]
    [
      '22.0.0',
      true,
      ECC_384
    ],
    [
      '22.0.0',
      undefined,
      ECC_384
    ],
    [
      '22.0.0',
      false,
      RSA_2048
    ], // an explicit report beats the version guess
    [
      '21.0.6',
      true,
      ECC_384
    ], // a reported capability beats the version too
    [
      '21.0.6',
      false,
      RSA_2048
    ],
    [
      '21.0.6',
      undefined,
      RSA_2048
    ],
    [
      '12.0.95',
      undefined,
      RSA_2048
    ],
    [
      '11.8.50',
      undefined,
      RSA_2048
    ],
    [
      undefined,
      true,
      ECC_384
    ],
    [
      undefined,
      undefined,
      RSA_2048
    ],
    [
      'not-a-version',
      undefined,
      RSA_2048
    ]
  ])('version=%s weakAlgorithmsRemoved=%s', (version, weakAlgorithmsRemoved, expected) => {
    expect(getAMTCertificatePolicy(weakAlgorithmsRemoved, version).deviceKeyPair).toEqual(expected)
  })
})

describe('device key pair', () => {
  it.each([
    true,
    false,
    undefined
  ])('never pairs mismatched fields (weakAlgorithmsRemoved=%s)', (reported) => {
    const { KeyAlgorithm, KeyLength } = getAMTCertificatePolicy(reported, '22.0.0').deviceKeyPair
    expect(KeyLength).toBe(KeyAlgorithm === 1 ? 384 : 2048)
  })
})

describe('shared policy constants', () => {
  it.each([true, false])('gives every caller its own device key pair (weakAlgorithmsRemoved=%s)', (reported) => {
    const first = getAMTCertificatePolicy(reported)
    const second = getAMTCertificatePolicy(reported)
    expect(first).not.toBe(second)
    expect(first.deviceKeyPair).not.toBe(second.deviceKeyPair)
  })

  it.each([true, false])(
    'builds the same GenerateKeyPair request for each device (weakAlgorithmsRemoved=%s)',
    (reported) => {
      // wsman-messages renames the keys of the object it is given while building the XML, so a shared
      // object produced `h:h:KeyAlgorithm` for the second device.
      const requestBody = (xml: string): string => xml.match(/<Body>.*<\/Body>/)?.[0] ?? ''
      const messages = new AMT.Messages()
      const first = messages.PublicKeyManagementService.GenerateKeyPair(getAMTCertificatePolicy(reported).deviceKeyPair)
      const second = messages.PublicKeyManagementService.GenerateKeyPair(
        getAMTCertificatePolicy(reported).deviceKeyPair
      )
      expect(requestBody(second)).toBe(requestBody(first))
      expect(requestBody(second)).not.toContain('h:h:')
    }
  )
})

describe('certificate policy tuples', () => {
  it('uses SHA-384, an RSA-3072 root and an ECC-384 device key on hardened firmware', () => {
    // Intel's hardening list removes SHA-256 leaves and RSA-2K/ECC-256 leaf keys together, so both
    // halves have to be supplied. The RSA-3072 root is RPS's own key and is unrelated to the device
    // key, which the firmware only offers as RSA-2048 or ECC-384.
    expect(getAMTCertificatePolicy(true)).toEqual({
      hashAlgorithm: 'sha384',
      rsaKeySize: 3072,
      deviceKeyPair: { KeyAlgorithm: 1, KeyLength: 384 },
      requiresSha384ProvisioningCert: true
    })
  })

  it('keeps SHA-256 and RSA-2048 on firmware that has not reported the hardening', () => {
    expect(getAMTCertificatePolicy(false)).toEqual({
      hashAlgorithm: 'sha256',
      rsaKeySize: 2048,
      deviceKeyPair: { KeyAlgorithm: 0, KeyLength: 2048 },
      requiresSha384ProvisioningCert: false
    })
  })
})

describe('resolveProvisioningSignature', () => {
  const SHA384_3 = { hashAlgorithm: 'sha384', signingAlgorithm: 3 }
  const SHA256_2 = { hashAlgorithm: 'sha256', signingAlgorithm: 2 }

  it.each([
    // Hardened, reported or inferred from AMT 22 or later: SHA-384 nonce, label 3.
    { cert: 'sha384', weak: true, version: '22.0.0', expected: SHA384_3 },
    { cert: 'SHA384', weak: true, version: '21.0.6', expected: SHA384_3 },
    { cert: 'sha384', weak: undefined, version: '22.0.0', expected: SHA384_3 },
    // A SHA-256 certificate never reaches a SHA-384 label; createSignedString rejects it first.
    { cert: 'sha256', weak: true, version: '22.0.0', expected: SHA256_2 },
    // Not hardened: the certificate may be SHA-384, the nonce is still SHA-256 / 2.
    // AMT 20.0.5 accepted a SHA-384 chain and refused SigningAlgorithm 3.
    { cert: 'sha384', weak: false, version: '22.0.0', expected: SHA256_2 },
    { cert: 'sha384', weak: false, version: '20.0.5', expected: SHA256_2 },
    { cert: 'sha384', weak: undefined, version: '20.0.5', expected: SHA256_2 },
    { cert: 'sha384', weak: undefined, version: '21.0.6', expected: SHA256_2 },
    { cert: 'sha384', weak: undefined, version: undefined, expected: SHA256_2 },
    { cert: 'sha256', weak: false, version: '20.0.5', expected: SHA256_2 },
    { cert: undefined, weak: true, version: '22.0.0', expected: SHA256_2 },
    { cert: null, weak: true, version: '22.0.0', expected: SHA256_2 }
  ])('$cert certificate, weakAlgorithmsRemoved=$weak, version=$version', ({ cert, weak, version, expected }) => {
    expect(resolveProvisioningSignature(cert, weak, version)).toEqual(expected)
  })

  it('never labels the signature with a digest it was not made with', () => {
    // The firmware recomputes the digest named by SigningAlgorithm, so the two halves have to be
    // resolved together rather than derived independently.
    for (const weak of [
      true,
      false,
      undefined
    ]) {
      for (const version of [
        '12.0.95',
        '20.0.5',
        '21.0.6',
        '22.0.0',
        undefined
      ]) {
        for (const cert of [
          'sha256',
          'sha384',
          undefined
        ]) {
          const { hashAlgorithm, signingAlgorithm } = resolveProvisioningSignature(cert, weak, version)
          expect(signingAlgorithm).toBe(hashAlgorithm === 'sha384' ? 3 : 2)
        }
      }
    }
  })
})
