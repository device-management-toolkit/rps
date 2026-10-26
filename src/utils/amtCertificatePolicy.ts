/*********************************************************************
 * Copyright (c) Intel Corporation 2026
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { type AMT } from '@device-management-toolkit/wsman-messages'

export interface AMTCertificatePolicy {
  /**
   * Digest RPS signs the TLS *leaf* (and any root it has to mint) with.
   * Unrelated to the provisioning certificate - see
   * `requiresSha384ProvisioningCert` and `resolveProvisioningSignature`.
   */
  hashAlgorithm: 'sha256' | 'sha384'
  /** Size of the RSA key RPS generates itself (root/CA cert). Not the device key. */
  rsaKeySize: 2048 | 3072
  /** The firmware supports exactly RSA-2048 and ECC-384; any other pair returns 2066. */
  deviceKeyPair: AMT.Models.GenerateKeyPairParameters
  /**
   * Whether host-based setup on this generation refuses a SHA-256 provisioning
   * certificate. Kept separate from `hashAlgorithm` because the provisioning
   * cert's digest is validated by the firmware against a signature RPS produced,
   * while the TLS leaf's digest only has to be something the firmware will accept
   * as a server credential.
   */
  requiresSha384ProvisioningCert: boolean
}

/**
 * Firmware that still carries the weak algorithms (AES-128, SHA-256, RSA-2K and
 * ECC-256). Everything that has not reported the hardening lands here.
 */
const LEGACY_CRYPTO_POLICY: AMTCertificatePolicy = {
  hashAlgorithm: 'sha256',
  rsaKeySize: 2048,
  deviceKeyPair: { KeyAlgorithm: 0, KeyLength: 2048 },
  requiresSha384ProvisioningCert: false
}

/**
 * Firmware that has removed the weak algorithms. AMT 22 is the first generation
 * to report it, but the report selects this policy, not the generation.
 *
 * AMT 22 binds an ECC-384 device key and a SHA-384 leaf: an RSA-2048 credential
 * or a SHA-256 leaf is stored by AddCertificate and refused only at the
 * `Put AMT_TLSCredentialContext` bind, with a bare HTTP 500. The firmware offers
 * only RSA-2048 or ECC-384 for GenerateKeyPair, so ECC-384 is the one that works.
 * The RPS-side root is RSA-3072; that is unrelated to the device key.
 */
const HARDENED_CRYPTO_POLICY: AMTCertificatePolicy = {
  hashAlgorithm: 'sha384',
  rsaKeySize: 3072,
  deviceKeyPair: { KeyAlgorithm: 1, KeyLength: 384 },
  requiresSha384ProvisioningCert: true
}

function parseMajorVersion(version: unknown): number | null {
  if (typeof version !== 'string' || !/^\d+(?:\.\d+)*$/.test(version.trim())) {
    return null
  }
  return Number.parseInt(version, 10)
}

/**
 * Select the certificate policy for a device.
 *
 * `weakAlgorithmsRemoved` is the capability the firmware reports (HECI
 * IsChangeToAMTEnabled bit 4, forwarded by rpc-go). When it is present it is
 * authoritative. An rpc-go that predates the field sends `undefined`, and only
 * then is the policy inferred from the AMT major version.
 */
export function getAMTCertificatePolicy(weakAlgorithmsRemoved?: boolean, version?: unknown): AMTCertificatePolicy {
  const majorVersion = parseMajorVersion(version)
  // The payload is device-supplied JSON, so anything that is not a boolean counts as not reported.
  const reported = typeof weakAlgorithmsRemoved === 'boolean' ? weakAlgorithmsRemoved : undefined
  const hardened = reported ?? (majorVersion != null && majorVersion >= 22)
  const policy = hardened ? HARDENED_CRYPTO_POLICY : LEGACY_CRYPTO_POLICY
  // wsman-messages renames the keys of the object it is given (KeyAlgorithm becomes h:KeyAlgorithm)
  // while building the XML, so every caller needs its own copy. Returning the shared constant would
  // corrupt the request for every device after the first.
  return { ...policy, deviceKeyPair: { ...policy.deviceKeyPair } }
}

/** Digest and `SigningAlgorithm` to use for one host-based provisioning signature. */
export interface ProvisioningSignatureParameters {
  /** Digest RPS signs the `fwNonce || mcNonce` concatenation with. */
  hashAlgorithm: 'sha256' | 'sha384'
  /** IPS_HostBasedSetupService SigningAlgorithm. 2 = RSA_SHA-2_256, 3 = RSA_SHA-2_384. */
  signingAlgorithm: 2 | 3
}

/**
 * Digest and SigningAlgorithm for IPS_HostBasedSetupService AdminSetup /
 * UpgradeClientToAdmin.
 *
 * The two returned values must agree with each other, because the firmware
 * recomputes the digest named by SigningAlgorithm and checks it against the
 * signature RPS produced.
 *
 * The digest of the provisioning certificate and the digest of the nonce
 * signature are separate requirements:
 * - Hardened firmware requires a SHA-384 certificate and a SHA-384 nonce
 *   signature, so SHA-384 -> label 3.
 * - Every other generation accepts either certificate digest, but its nonce is
 *   signed with SHA-256 -> label 2, even when the certificate is SHA-384. An
 *   AMT 20.0.5 device accepted a SHA-384 certificate chain and then refused
 *   SigningAlgorithm 3 with ReturnValue 3 (InvalidParam) on UpgradeClientToAdmin.
 *
 * Which certificates are acceptable is decided by the policy, not here:
 * createSignedString rejects a non-SHA-384 certificate on hardened firmware and
 * names the digest.
 */
export function resolveProvisioningSignature(
  certHashAlgorithm: string | null | undefined,
  weakAlgorithmsRemoved?: boolean,
  version?: unknown
): ProvisioningSignatureParameters {
  const hardened = getAMTCertificatePolicy(weakAlgorithmsRemoved, version).requiresSha384ProvisioningCert
  return hardened && certHashAlgorithm?.toLowerCase() === 'sha384'
    ? { hashAlgorithm: 'sha384', signingAlgorithm: 3 }
    : { hashAlgorithm: 'sha256', signingAlgorithm: 2 }
}
