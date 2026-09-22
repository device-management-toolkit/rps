/*********************************************************************
 * Copyright (c) Intel Corporation 2026
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { describe, expect, it } from 'vitest'
import { getAMTCertificatePolicy, getSigningAlgorithm } from './amtCertificatePolicy.js'

const RSA_2048_DEVICE_KEY = { keyAlgorithm: 0, keyLength: 2048 }
const ECC_384_DEVICE_KEY = { keyAlgorithm: 1, keyLength: 384 }

describe('getAMTCertificatePolicy', () => {
  it.each([
    {
      version: '11.8.50',
      hashAlgorithm: 'sha256',
      rsaKeySize: 2048,
      deviceKeyPair: RSA_2048_DEVICE_KEY,
      requiresSha384ProvisioningCert: false
    },
    {
      version: '21.0.6',
      hashAlgorithm: 'sha256',
      rsaKeySize: 2048,
      deviceKeyPair: RSA_2048_DEVICE_KEY,
      requiresSha384ProvisioningCert: false
    },
    {
      version: '22.0.0',
      hashAlgorithm: 'sha384',
      rsaKeySize: 3072,
      deviceKeyPair: ECC_384_DEVICE_KEY,
      requiresSha384ProvisioningCert: true
    },
    {
      version: '22.1.15',
      hashAlgorithm: 'sha384',
      rsaKeySize: 3072,
      deviceKeyPair: ECC_384_DEVICE_KEY,
      requiresSha384ProvisioningCert: true
    },
    {
      version: 'unknown',
      hashAlgorithm: 'sha256',
      rsaKeySize: 2048,
      deviceKeyPair: RSA_2048_DEVICE_KEY,
      requiresSha384ProvisioningCert: false
    },
    {
      version: '',
      hashAlgorithm: 'sha256',
      rsaKeySize: 2048,
      deviceKeyPair: RSA_2048_DEVICE_KEY,
      requiresSha384ProvisioningCert: false
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
    // SigningAlgorithm belongs to the provisioning certificate, not the AMT
    // version — see getSigningAlgorithm. A version-gated field here invited the
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

describe('getSigningAlgorithm', () => {
  it.each([
    { hashAlgorithm: 'sha384', expected: 3 },
    { hashAlgorithm: 'SHA384', expected: 3 },
    { hashAlgorithm: 'sha256', expected: 2 },
    { hashAlgorithm: undefined, expected: 2 },
    { hashAlgorithm: null, expected: 2 }
  ])('maps a $hashAlgorithm provisioning cert to SigningAlgorithm $expected', ({ hashAlgorithm, expected }) => {
    expect(getSigningAlgorithm(hashAlgorithm)).toBe(expected)
  })

  it('is driven by the certificate, not the AMT version', () => {
    // Both AMT 21.0.6 and AMT 22.0.0 returned ReturnValue 0 for
    // UpgradeClientToAdmin with SigningAlgorithm=3 and a SHA-384 provisioning
    // cert, so this must not be gated on the AMT version.
    expect(getSigningAlgorithm('sha384')).toBe(3)
    expect(getAMTCertificatePolicy('21.0.6').hashAlgorithm).toBe('sha256')
  })
})
