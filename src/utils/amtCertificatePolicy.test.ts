/*********************************************************************
 * Copyright (c) Intel Corporation 2026
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { describe, expect, it } from 'vitest'
import {
  getAMTCertificatePolicy,
  resolveProvisioningSignature,
  toGenerateKeyPairRequest
} from './amtCertificatePolicy.js'

const RSA_2048_DEVICE_KEY = { keyAlgorithm: 0, keyLength: 2048 }
const ECC_384_DEVICE_KEY = { keyAlgorithm: 1, keyLength: 384 }

const LEGACY = {
  hashAlgorithm: 'sha256',
  rsaKeySize: 2048,
  deviceKeyPair: RSA_2048_DEVICE_KEY,
  requiresSha384ProvisioningCert: false
}

const HARDENED = {
  hashAlgorithm: 'sha384',
  rsaKeySize: 3072,
  deviceKeyPair: ECC_384_DEVICE_KEY,
  requiresSha384ProvisioningCert: true
}

describe('getAMTCertificatePolicy', () => {
  // rpc-go reads bit 4 of STATE_INDEPENDENCE_IsChangeToAMTEnabled and forwards it
  // in the activation payload. A reported value is authoritative; the version is
  // only consulted when nothing was reported.
  it.each([
    { weakAlgorithmsRemoved: true, version: '21.0.6', expected: HARDENED },
    { weakAlgorithmsRemoved: true, version: undefined, expected: HARDENED },
    { weakAlgorithmsRemoved: false, version: '22.0.0', expected: LEGACY },
    { weakAlgorithmsRemoved: false, version: '21.0.6', expected: LEGACY },
    { weakAlgorithmsRemoved: undefined, version: '22.0.0', expected: HARDENED },
    { weakAlgorithmsRemoved: undefined, version: '23.1.0', expected: HARDENED },
    { weakAlgorithmsRemoved: undefined, version: '21.0.6', expected: LEGACY },
    { weakAlgorithmsRemoved: undefined, version: '12.0.95', expected: LEGACY },
    { weakAlgorithmsRemoved: undefined, version: 'not-a-version', expected: LEGACY },
    { weakAlgorithmsRemoved: undefined, version: undefined, expected: LEGACY },
    // The payload is device-supplied JSON; a non-boolean is not a report, so the version decides.
    { weakAlgorithmsRemoved: 'false' as any, version: '22.0.0', expected: HARDENED },
    { weakAlgorithmsRemoved: 'true' as any, version: '21.0.6', expected: LEGACY }
  ])(
    'weakAlgorithmsRemoved=$weakAlgorithmsRemoved version=$version selects the matching policy',
    ({ weakAlgorithmsRemoved, version, expected }) => {
      expect(getAMTCertificatePolicy(weakAlgorithmsRemoved, version)).toEqual(expected)
    }
  )

  it('falls back to the version only when nothing is reported', () => {
    // An explicit false from a current rpc-go must not be overridden by a
    // version guess; only an absent field (older rpc-go) uses the version.
    expect(getAMTCertificatePolicy(false, '22.0.0')).toEqual(LEGACY)
    expect(getAMTCertificatePolicy(undefined, '22.0.0')).toEqual(HARDENED)
    expect(getAMTCertificatePolicy()).toEqual(LEGACY)
  })

  it('never asks the firmware for an RSA size other than 2048', () => {
    // The Intel AMT SDK supports only RSA-2048 and ECC-384 for GenerateKeyPair.
    // Requesting RSA-3072 returns 2066 PT_STATUS_UNSUPPORTED and no key pair.
    for (const weakAlgorithmsRemoved of [
      true,
      false,
      undefined
    ]) {
      const { deviceKeyPair } = getAMTCertificatePolicy(weakAlgorithmsRemoved)
      expect([384, 2048]).toContain(deviceKeyPair.keyLength)
      expect([0, 1]).toContain(deviceKeyPair.keyAlgorithm)
    }
  })

  it('does not expose a signing algorithm', () => {
    // SigningAlgorithm is resolved from the provisioning certificate and the
    // capability together — see resolveProvisioningSignature. A field here
    // invited the wrong rule, and was never read by any caller.
    expect(getAMTCertificatePolicy(true)).not.toHaveProperty('signingAlgorithm')
    expect(getAMTCertificatePolicy(true)).not.toHaveProperty('supportsSha384ProvisioningSignature')
  })

  it('keeps the 3072-bit RPS root key separate from the ECC-384 device key', () => {
    // rsaKeySize is the RPS-side root/CA key; deviceKeyPair is what the firmware
    // is asked to generate. The two are unrelated, and conflating them is what
    // produced the original GenerateKeyPair(RSA, 3072) -> 2066 failure.
    const policy = getAMTCertificatePolicy(true)
    expect(policy.rsaKeySize).toBe(3072)
    expect(policy.deviceKeyPair).toEqual(ECC_384_DEVICE_KEY)
  })

  it('signs the hardened TLS leaf with sha384 over a non-RSA-2K key', () => {
    // Intel's crypto-hardening list requires both at the credential bind:
    // "TlsProvisionVerifyLeafCertificate() - remove SHA-256", and "do not accept
    // leaf certificates with RSA-2K or ECC-256 keys". Satisfying only one half
    // still fails, which is what the first three AMT 22 hardware runs showed.
    const policy = getAMTCertificatePolicy(true)
    expect(policy.hashAlgorithm).toBe('sha384')
    expect(policy.deviceKeyPair).toEqual(ECC_384_DEVICE_KEY)
  })

  it('leaves unhardened firmware on sha256 over an RSA-2048 device key', () => {
    // AMT 21 and below bind a sha256 leaf over an RSA-2048 key successfully.
    // Switching them would be an untested change to a path that already works.
    const policy = getAMTCertificatePolicy(false)
    expect(policy.hashAlgorithm).toBe('sha256')
    expect(policy.deviceKeyPair).toEqual(RSA_2048_DEVICE_KEY)
  })
})

describe('toGenerateKeyPairRequest', () => {
  it('maps each policy onto the pair the firmware supports', () => {
    expect(toGenerateKeyPairRequest(getAMTCertificatePolicy(true).deviceKeyPair)).toEqual({
      KeyAlgorithm: 1,
      KeyLength: 384
    })
    expect(toGenerateKeyPairRequest(getAMTCertificatePolicy(false).deviceKeyPair)).toEqual({
      KeyAlgorithm: 0,
      KeyLength: 2048
    })
  })

  it('never emits a cross-pair', () => {
    // RSA-384 and ECC-2048 are both rejected by the firmware with 2066
    // PT_STATUS_UNSUPPORTED. The union makes them unwritable at compile time;
    // this asserts the mapper does not reintroduce one at runtime by copying
    // the two fields independently.
    for (const weakAlgorithmsRemoved of [
      true,
      false,
      undefined
    ]) {
      const { KeyAlgorithm, KeyLength } = toGenerateKeyPairRequest(
        getAMTCertificatePolicy(weakAlgorithmsRemoved).deviceKeyPair
      )
      expect(KeyLength).toBe(KeyAlgorithm === 1 ? 384 : 2048)
    }
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
    // Hardened firmware with a SHA-256 certificate never reaches a SHA-384 label;
    // createSignedString rejects it before anything is sent.
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
    // The firmware recomputes the digest named by SigningAlgorithm, so the two
    // halves have to be resolved together rather than derived independently.
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
