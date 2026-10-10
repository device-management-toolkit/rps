/*********************************************************************
 * Copyright (c) Intel Corporation 2026
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { describe, expect, it } from 'vitest'
import { getAMTCertificatePolicy, resolveProvisioningSignature } from './amtCertificatePolicy.js'

const RSA_2048_DEVICE_KEY = { keyAlgorithm: 0, keyLength: 2048 }
const ECC_384_DEVICE_KEY = { keyAlgorithm: 1, keyLength: 384 }

describe('getAMTCertificatePolicy', () => {
  it.each([
    {
      version: '11.8.50',
      hashAlgorithm: 'sha256',
      rsaKeySize: 2048,
      deviceKeyPair: RSA_2048_DEVICE_KEY,
      requiresSha384ProvisioningCert: false,
      supportsSha384ProvisioningSignature: false
    },
    {
      version: '20.0.5',
      hashAlgorithm: 'sha256',
      rsaKeySize: 2048,
      deviceKeyPair: RSA_2048_DEVICE_KEY,
      requiresSha384ProvisioningCert: false,
      supportsSha384ProvisioningSignature: false
    },
    {
      version: '21.0.6',
      hashAlgorithm: 'sha256',
      rsaKeySize: 2048,
      deviceKeyPair: RSA_2048_DEVICE_KEY,
      requiresSha384ProvisioningCert: false,
      supportsSha384ProvisioningSignature: true
    },
    {
      version: '22.0.0',
      hashAlgorithm: 'sha384',
      rsaKeySize: 3072,
      deviceKeyPair: ECC_384_DEVICE_KEY,
      requiresSha384ProvisioningCert: true,
      supportsSha384ProvisioningSignature: true
    },
    {
      version: '22.1.15',
      hashAlgorithm: 'sha384',
      rsaKeySize: 3072,
      deviceKeyPair: ECC_384_DEVICE_KEY,
      requiresSha384ProvisioningCert: true,
      supportsSha384ProvisioningSignature: true
    },
    {
      version: 'unknown',
      hashAlgorithm: 'sha256',
      rsaKeySize: 2048,
      deviceKeyPair: RSA_2048_DEVICE_KEY,
      requiresSha384ProvisioningCert: false,
      supportsSha384ProvisioningSignature: false
    },
    {
      version: '',
      hashAlgorithm: 'sha256',
      rsaKeySize: 2048,
      deviceKeyPair: RSA_2048_DEVICE_KEY,
      requiresSha384ProvisioningCert: false,
      supportsSha384ProvisioningSignature: false
    }
  ])('selects the certificate policy for AMT $version', ({ version, ...expected }) => {
    expect(getAMTCertificatePolicy(version)).toEqual(expected)
  })

  it('never asks the firmware for an RSA size other than 2048', () => {
    // The Intel AMT SDK supports only RSA-2048 and ECC-384 for GenerateKeyPair.
    // Requesting RSA-3072 returns 2066 PT_STATUS_UNSUPPORTED and no key pair.
    for (const version of [
      '11.8.50',
      '21.0.6',
      '22.0.0',
      '22.1.15',
      'unknown',
      ''
    ]) {
      const { deviceKeyPair } = getAMTCertificatePolicy(version)
      expect([384, 2048]).toContain(deviceKeyPair.keyLength)
      expect([0, 1]).toContain(deviceKeyPair.keyAlgorithm)
    }
  })

  it('does not expose a version-derived signing algorithm', () => {
    // SigningAlgorithm is resolved from the provisioning certificate and the
    // firmware's verification capability together — see
    // resolveProvisioningSignature. A bare version-gated field here invited the
    // wrong rule, and was never read by any caller.
    expect(getAMTCertificatePolicy('22.0.0')).not.toHaveProperty('signingAlgorithm')
  })

  it('keeps the 3072-bit RPS root key for AMT 22 and asks the device for ECC-384', () => {
    // rsaKeySize is the RPS-side root/CA key; deviceKeyPair is what the firmware
    // is asked to generate. The two are unrelated, and conflating them is what
    // produced the original GenerateKeyPair(RSA, 3072) -> 2066 failure.
    const policy = getAMTCertificatePolicy('22.0.0')
    expect(policy.rsaKeySize).toBe(3072)
    expect(policy.deviceKeyPair).toEqual({ keyAlgorithm: 1, keyLength: 384 })
  })

  it('leaves pre-22 generations on RSA-2048 device keys', () => {
    // Only AMT 22 is known to bind an EC credential. Switching AMT 21 would be an
    // untested change to a path that already works.
    for (const version of [
      '11.8.50',
      '21.0.6',
      'unknown',
      ''
    ]) {
      expect(getAMTCertificatePolicy(version).deviceKeyPair).toEqual({ keyAlgorithm: 0, keyLength: 2048 })
    }
  })

  it('signs the AMT 22 TLS leaf with sha384 over a non-RSA-2K key', () => {
    // Intel's AMT 22 crypto-hardening list requires both at the credential bind:
    // "TlsProvisionVerifyLeafCertificate() - remove SHA-256", and "do not accept
    // leaf certificates with RSA-2K or ECC-256 keys". Satisfying only one half
    // still fails, which is what the first three AMT 22 hardware runs showed.
    const policy = getAMTCertificatePolicy('22.0.0')
    expect(policy.hashAlgorithm).toBe('sha384')
    expect(policy.deviceKeyPair).toEqual({ keyAlgorithm: 1, keyLength: 384 })
  })

  it('leaves pre-22 generations on sha256', () => {
    // AMT 21 binds a sha256 leaf successfully; the hardening rules are AMT 22's.
    expect(getAMTCertificatePolicy('21.0.6').hashAlgorithm).toBe('sha256')
    expect(getAMTCertificatePolicy('11.8.50').hashAlgorithm).toBe('sha256')
  })
})

describe('getAMTCertificatePolicy with a firmware-reported capability', () => {
  // rpc-go reads bit 4 of STATE_INDEPENDENCE_IsChangeToAMTEnabled and forwards
  // it in the activation payload. Every test above calls with one argument, so
  // they are also the regression suite for the undefined/version fallback.
  it.each([
    { version: '22.0.0', weakAlgorithmsRemoved: true, hardened: true },
    { version: '21.0.6', weakAlgorithmsRemoved: true, hardened: true },
    { version: '11.8.50', weakAlgorithmsRemoved: true, hardened: true },
    { version: 'unknown', weakAlgorithmsRemoved: true, hardened: true },
    { version: '22.0.0', weakAlgorithmsRemoved: false, hardened: false },
    { version: '21.0.6', weakAlgorithmsRemoved: false, hardened: false },
    { version: '22.0.0', weakAlgorithmsRemoved: undefined, hardened: true },
    { version: '21.0.6', weakAlgorithmsRemoved: undefined, hardened: false }
  ])(
    'AMT $version reporting weakAlgorithmsRemoved=$weakAlgorithmsRemoved is hardened=$hardened',
    ({ version, weakAlgorithmsRemoved, hardened }) => {
      const policy = getAMTCertificatePolicy(version, weakAlgorithmsRemoved)
      expect(policy.hashAlgorithm).toBe(hardened ? 'sha384' : 'sha256')
      expect(policy.rsaKeySize).toBe(hardened ? 3072 : 2048)
      expect(policy.deviceKeyPair).toEqual(hardened ? ECC_384_DEVICE_KEY : RSA_2048_DEVICE_KEY)
      expect(policy.requiresSha384ProvisioningCert).toBe(hardened)
    }
  )

  it('prefers an explicit false over the version inference', () => {
    // An AMT 22 SKU that reports the weak algorithms are still present is
    // telling us something the version number cannot. `??` and not `||`.
    expect(getAMTCertificatePolicy('22.0.0', false).hashAlgorithm).toBe('sha256')
    expect(getAMTCertificatePolicy('22.0.0').hashAlgorithm).toBe('sha384')
  })

  it('falls back to the version when the agent does not report the field', () => {
    // An rpc-go predating the field sends undefined. Treating that as `false`
    // would silently downgrade every AMT 22 device behind an older agent and
    // fail the credential bind with no diagnostic.
    expect(getAMTCertificatePolicy('22.0.0', undefined)).toEqual(getAMTCertificatePolicy('22.0.0'))
  })

  it('honours the capability on any firmware version, however old the AMT version reads', () => {
    // The hardening can reach an older platform through a firmware update. When
    // it does, the AMT version still reads 11 or 16 and the reported bit is the
    // only signal there is, so no version may cap it.
    for (const version of [
      '11.8.50',
      '16.1.25',
      '18.0.5',
      '20.0.5',
      'unknown',
      ''
    ]) {
      const policy = getAMTCertificatePolicy(version, true)
      expect(policy.hashAlgorithm).toBe('sha384')
      expect(policy.rsaKeySize).toBe(3072)
      expect(policy.deviceKeyPair).toEqual(ECC_384_DEVICE_KEY)
      expect(policy.requiresSha384ProvisioningCert).toBe(true)
      expect(policy.supportsSha384ProvisioningSignature).toBe(true)
      expect(resolveProvisioningSignature(version, 'sha384', true)).toEqual({
        hashAlgorithm: 'sha384',
        signingAlgorithm: 3
      })
    }
  })

  it('treats the capability as sufficient for a sha384 provisioning signature', () => {
    // Hardened firmware necessarily verifies sha384; the version gate only
    // exists for AMT 21, which is not hardened but can still verify.
    expect(getAMTCertificatePolicy('20.0.5', true).supportsSha384ProvisioningSignature).toBe(true)
    expect(getAMTCertificatePolicy('20.0.5', false).supportsSha384ProvisioningSignature).toBe(false)
    expect(getAMTCertificatePolicy('21.0.6', false).supportsSha384ProvisioningSignature).toBe(true)
  })
})

describe('resolveProvisioningSignature', () => {
  it.each([
    { version: '21.0.6', certHashAlgorithm: 'sha384', hashAlgorithm: 'sha384', signingAlgorithm: 3 },
    { version: '21.0.6', certHashAlgorithm: 'SHA384', hashAlgorithm: 'sha384', signingAlgorithm: 3 },
    { version: '22.0.0', certHashAlgorithm: 'sha384', hashAlgorithm: 'sha384', signingAlgorithm: 3 },
    { version: '21.0.6', certHashAlgorithm: 'sha256', hashAlgorithm: 'sha256', signingAlgorithm: 2 },
    { version: '21.0.6', certHashAlgorithm: undefined, hashAlgorithm: 'sha256', signingAlgorithm: 2 },
    { version: '21.0.6', certHashAlgorithm: null, hashAlgorithm: 'sha256', signingAlgorithm: 2 },
    { version: '20.0.5', certHashAlgorithm: 'sha384', hashAlgorithm: 'sha256', signingAlgorithm: 2 },
    { version: '11.8.50', certHashAlgorithm: 'sha384', hashAlgorithm: 'sha256', signingAlgorithm: 2 },
    { version: 'unknown', certHashAlgorithm: 'sha384', hashAlgorithm: 'sha256', signingAlgorithm: 2 }
  ])(
    'AMT $version with a $certHashAlgorithm provisioning cert signs with $hashAlgorithm / SigningAlgorithm $signingAlgorithm',
    ({ version, certHashAlgorithm, ...expected }) => {
      expect(resolveProvisioningSignature(version, certHashAlgorithm)).toEqual(expected)
    }
  )

  it('downgrades to sha256 on firmware that cannot verify a sha384 signature', () => {
    // AMT 20.0.5 returned ReturnValue 3 (PT_STATUS_INVALID_PT_MODE) for
    // UpgradeClientToAdmin with SigningAlgorithm=3, where AMT 21.0.6 and
    // AMT 22.0.0 returned 0 for byte-for-byte the same provisioning cert.
    expect(resolveProvisioningSignature('20.0.5', 'sha384').signingAlgorithm).toBe(2)
    expect(resolveProvisioningSignature('21.0.6', 'sha384').signingAlgorithm).toBe(3)
  })

  it('forwards the firmware capability', () => {
    // A hardened device on a version the gate would reject must still sign
    // with sha384; a device reporting it is not hardened must not be pushed
    // past what the version says it can verify.
    expect(resolveProvisioningSignature('20.0.5', 'sha384', true).signingAlgorithm).toBe(3)
    expect(resolveProvisioningSignature('20.0.5', 'sha384', false).signingAlgorithm).toBe(2)
    // A version-22 device reporting it is not hardened is still >= 21, so it
    // can verify sha384 even though its certificate policy is the legacy one.
    expect(resolveProvisioningSignature('22.0.0', 'sha384', false).signingAlgorithm).toBe(3)
  })

  it('never labels the signature with a digest it was not made with', () => {
    // The firmware recomputes the digest named by SigningAlgorithm, so the two
    // halves have to be resolved together rather than derived independently.
    for (const version of [
      '11.8.50',
      '20.0.5',
      '21.0.6',
      '22.0.0',
      'unknown',
      ''
    ]) {
      for (const certHashAlgorithm of [
        'sha256',
        'sha384',
        undefined
      ]) {
        const { hashAlgorithm, signingAlgorithm } = resolveProvisioningSignature(version, certHashAlgorithm)
        expect(signingAlgorithm).toBe(hashAlgorithm === 'sha384' ? 3 : 2)
      }
    }
  })
})
