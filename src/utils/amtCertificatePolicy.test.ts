/*********************************************************************
 * Copyright (c) Intel Corporation 2026
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { describe, expect, it } from 'vitest'
import {
  checkProvisioningCertificateCompatibility,
  getAMTCertificatePolicy,
  resolveProvisioningSignature
} from './amtCertificatePolicy.js'

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
      supportsSha384ProvisioningCert: false,
      supportsSha384ProvisioningSignature: false
    },
    {
      version: '20.0.5',
      hashAlgorithm: 'sha256',
      rsaKeySize: 2048,
      deviceKeyPair: RSA_2048_DEVICE_KEY,
      requiresSha384ProvisioningCert: false,
      supportsSha384ProvisioningCert: false,
      supportsSha384ProvisioningSignature: false
    },
    {
      version: '21.0.6',
      hashAlgorithm: 'sha256',
      rsaKeySize: 2048,
      deviceKeyPair: RSA_2048_DEVICE_KEY,
      requiresSha384ProvisioningCert: false,
      supportsSha384ProvisioningCert: true,
      supportsSha384ProvisioningSignature: true
    },
    {
      version: '22.0.0',
      hashAlgorithm: 'sha384',
      rsaKeySize: 3072,
      deviceKeyPair: ECC_384_DEVICE_KEY,
      requiresSha384ProvisioningCert: true,
      supportsSha384ProvisioningCert: true,
      supportsSha384ProvisioningSignature: true
    },
    {
      version: '22.1.15',
      hashAlgorithm: 'sha384',
      rsaKeySize: 3072,
      deviceKeyPair: ECC_384_DEVICE_KEY,
      requiresSha384ProvisioningCert: true,
      supportsSha384ProvisioningCert: true,
      supportsSha384ProvisioningSignature: true
    },
    {
      version: 'unknown',
      hashAlgorithm: 'sha256',
      rsaKeySize: 2048,
      deviceKeyPair: RSA_2048_DEVICE_KEY,
      requiresSha384ProvisioningCert: false,
      supportsSha384ProvisioningCert: false,
      supportsSha384ProvisioningSignature: false
    },
    {
      version: '',
      hashAlgorithm: 'sha256',
      rsaKeySize: 2048,
      deviceKeyPair: RSA_2048_DEVICE_KEY,
      requiresSha384ProvisioningCert: false,
      supportsSha384ProvisioningCert: false,
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

describe('checkProvisioningCertificateCompatibility', () => {
  it('rejects a SHA384 provisioning certificate on pre-AMT-21 firmware', () => {
    const result = checkProvisioningCertificateCompatibility('11.8.95', 'sha384')
    expect(result.supported).toBe(false)
    expect(result.reason).toContain('SHA384')
    expect(result.reason).toContain('11.8.95')
  })

  it('rejects a SHA256 provisioning certificate on AMT 22', () => {
    const result = checkProvisioningCertificateCompatibility('22.0.0', 'sha256')
    expect(result.supported).toBe(false)
    expect(result.reason).toContain('requires a SHA384')
  })

  it.each([
    ['11.8.95', 'sha256'],
    ['20.0.5', 'sha256'],
    ['21.0.6', 'sha256'],
    ['21.0.6', 'sha384'],
    ['22.0.0', 'sha384']
  ])('accepts a %s device with a %s provisioning certificate', (version, digest) => {
    expect(checkProvisioningCertificateCompatibility(version, digest)).toEqual({ supported: true })
  })

  it('does not block provisioning when the certificate digest is unreadable', () => {
    // Pre-existing behaviour is to attempt the chain; an unknown digest is not
    // evidence of an incompatibility, only of a gap in what we could parse.
    expect(checkProvisioningCertificateCompatibility('11.8.95', undefined).supported).toBe(true)
    expect(checkProvisioningCertificateCompatibility('11.8.95', 'sha512').supported).toBe(true)
  })

  it('still demands SHA384 on AMT 22 when the digest is unreadable', () => {
    expect(checkProvisioningCertificateCompatibility('22.0.0', undefined).supported).toBe(false)
  })
})
