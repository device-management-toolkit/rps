/*********************************************************************
 * Copyright (c) Intel Corporation 2026
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { describe, expect, it } from 'vitest'
import { getAMTCertificatePolicy, resolveProvisioningSignature } from './amtCertificatePolicy.js'

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
  // in the activation payload. It is the only input — the AMT version is an
  // inference about the firmware, and the firmware reports the same thing itself.
  it.each([
    { weakAlgorithmsRemoved: true, expected: HARDENED },
    { weakAlgorithmsRemoved: false, expected: LEGACY },
    { weakAlgorithmsRemoved: undefined, expected: LEGACY }
  ])(
    'weakAlgorithmsRemoved=$weakAlgorithmsRemoved selects the matching policy',
    ({ weakAlgorithmsRemoved, expected }) => {
      expect(getAMTCertificatePolicy(weakAlgorithmsRemoved)).toEqual(expected)
    }
  )

  it('treats a missing report as the legacy policy, not as a cue to guess', () => {
    // An rpc-go predating the field sends undefined. That is the legacy policy
    // by decision: inferring `>= 22` from the version here would reintroduce the
    // version keying this design removes, on the path where it is least visible.
    // The cost is a rollout order — rpc-go ships before, or with, RPS.
    expect(getAMTCertificatePolicy(undefined)).toEqual(LEGACY)
    expect(getAMTCertificatePolicy()).toEqual(LEGACY)
  })

  it('honours the report whatever generation the device is', () => {
    // The hardening can reach an older platform through a firmware update, and
    // when it does the AMT version is the one thing that does not move. Nothing
    // in the resolver may cap the capability by version — there is no version
    // parameter to cap it with.
    expect(getAMTCertificatePolicy.length).toBe(1)
    expect(getAMTCertificatePolicy(true)).toEqual(HARDENED)
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

describe('resolveProvisioningSignature', () => {
  it.each([
    { certHashAlgorithm: 'sha384', weakAlgorithmsRemoved: true, hashAlgorithm: 'sha384', signingAlgorithm: 3 },
    { certHashAlgorithm: 'SHA384', weakAlgorithmsRemoved: true, hashAlgorithm: 'sha384', signingAlgorithm: 3 },
    { certHashAlgorithm: 'sha256', weakAlgorithmsRemoved: true, hashAlgorithm: 'sha256', signingAlgorithm: 2 },
    { certHashAlgorithm: 'sha384', weakAlgorithmsRemoved: false, hashAlgorithm: 'sha256', signingAlgorithm: 2 },
    { certHashAlgorithm: 'sha384', weakAlgorithmsRemoved: undefined, hashAlgorithm: 'sha256', signingAlgorithm: 2 },
    { certHashAlgorithm: 'sha256', weakAlgorithmsRemoved: false, hashAlgorithm: 'sha256', signingAlgorithm: 2 },
    { certHashAlgorithm: undefined, weakAlgorithmsRemoved: true, hashAlgorithm: 'sha256', signingAlgorithm: 2 },
    { certHashAlgorithm: null, weakAlgorithmsRemoved: true, hashAlgorithm: 'sha256', signingAlgorithm: 2 }
  ])(
    'a $certHashAlgorithm cert on firmware reporting $weakAlgorithmsRemoved signs with $hashAlgorithm / SigningAlgorithm $signingAlgorithm',
    ({ certHashAlgorithm, weakAlgorithmsRemoved, ...expected }) => {
      expect(resolveProvisioningSignature(certHashAlgorithm, weakAlgorithmsRemoved)).toEqual(expected)
    }
  )

  it('requires both inputs before using sha384', () => {
    // Deriving from the certificate alone sent SigningAlgorithm 3 to an AMT
    // 20.0.5 device and got ReturnValue 3 (PT_STATUS_INVALID_PT_MODE) back.
    // Deriving from the firmware alone ignores what the certificate offers.
    expect(resolveProvisioningSignature('sha384', false).signingAlgorithm).toBe(2)
    expect(resolveProvisioningSignature('sha256', true).signingAlgorithm).toBe(2)
    expect(resolveProvisioningSignature('sha384', true).signingAlgorithm).toBe(3)
  })

  it('signs unhardened firmware with sha256 even when the certificate offers sha384', () => {
    // This is the deliberate cost of dropping the version gate. AMT 21 reports
    // 0xE2 and can verify sha384, but does not require it; the nonce digest is
    // independent of the digest the certificate itself was signed with.
    expect(resolveProvisioningSignature('sha384', false)).toEqual({
      hashAlgorithm: 'sha256',
      signingAlgorithm: 2
    })
  })

  it('never labels the signature with a digest it was not made with', () => {
    // The firmware recomputes the digest named by SigningAlgorithm, so the two
    // halves have to be resolved together rather than derived independently.
    for (const weakAlgorithmsRemoved of [
      true,
      false,
      undefined
    ]) {
      for (const certHashAlgorithm of [
        'sha256',
        'sha384',
        undefined
      ]) {
        const { hashAlgorithm, signingAlgorithm } = resolveProvisioningSignature(
          certHashAlgorithm,
          weakAlgorithmsRemoved
        )
        expect(signingAlgorithm).toBe(hashAlgorithm === 'sha384' ? 3 : 2)
      }
    }
  })
})
