/*********************************************************************
 * Copyright (c) Intel Corporation 2026
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { type AMT } from '@device-management-toolkit/wsman-messages'

/**
 * Parameters for AMT_PublicKeyManagementService.GenerateKeyPair.
 *
 * The Intel AMT WS-Management class reference defines KeyAlgorithm as
 * ValueMap {0, 1} / Values {RSA-2K, ECC-384}, and states "Supported ECC key
 * size: 384 bits. Supported RSA key size: 2048 bits".
 *
 * RSA-3072 is therefore not a legal request on any AMT generation — asking for
 * it returns 2066 (PT_STATUS_UNSUPPORTED) and no key pair, which is what broke
 * AMT 22 TLS provisioning. This type exists so the device-held key size can
 * never again be confused with the RPS-side root/CA key size.
 *
 * ECC-384 (keyAlgorithm 1) is what hardened firmware binds. node-forge's
 * publicKeyFromPem cannot *parse* an EC SubjectPublicKeyInfo, but RPS never
 * needs to. The leaf is signed with the RPS root's RSA key; the device's EC key
 * only has to be embedded. AMT returns AMT_PublicPrivateKeyPair.DERKey as the
 * SPKI DER already, so it can be spliced into the TBSCertificate verbatim
 * (forge's certificateToAsn1 reuses a caller-supplied cert.tbsCertificate)
 * without ever being parsed.
 */
export interface RSADeviceKeyPair {
  keyAlgorithm: 0
  keyLength: 2048
}

export interface ECCDeviceKeyPair {
  keyAlgorithm: 1
  keyLength: 384
}

/**
 * The algorithm and the length are not independent — the firmware supports
 * exactly two pairs. Keeping them in one union means a cross-pair such as
 * RSA-384 or ECC-2048 cannot be written down, let alone sent, which mirrors
 * `AMT.Models.GenerateKeyPairParameters` in wsman-messages.
 */
export type DeviceKeyPairParameters = RSADeviceKeyPair | ECCDeviceKeyPair

/**
 * Translate a policy's device key pair into the wsman-messages request object.
 *
 * `AMT.Models.GenerateKeyPairParameters` is the union of the two valid
 * pairs, so this cannot be written as a field-by-field copy — destructuring
 * `{ keyAlgorithm, keyLength }` widens each field back to `0 | 1` and
 * `384 | 2048` independently and the result no longer matches either member.
 * Branching on the algorithm keeps the two halves tied together.
 */
export function toGenerateKeyPairRequest(deviceKeyPair: DeviceKeyPairParameters): AMT.Models.GenerateKeyPairParameters {
  return deviceKeyPair.keyAlgorithm === 1 ? { KeyAlgorithm: 1, KeyLength: 384 } : { KeyAlgorithm: 0, KeyLength: 2048 }
}

export interface AMTCertificatePolicy {
  /**
   * Digest RPS signs the TLS *leaf* (and any root it has to mint) with.
   * Unrelated to the provisioning certificate — see
   * `requiresSha384ProvisioningCert` and `resolveProvisioningSignature`.
   */
  hashAlgorithm: 'sha256' | 'sha384'
  /** Size of the RSA key RPS generates itself (root/CA cert). Not the device key. */
  rsaKeySize: 2048 | 3072
  /** What RPS asks the firmware to generate and hold. */
  deviceKeyPair: DeviceKeyPairParameters
  /**
   * Whether host-based setup on this generation refuses a SHA-256 provisioning
   * certificate. Kept separate from `hashAlgorithm` because the two travel in
   * opposite directions: the provisioning cert's digest is validated by the
   * firmware against a signature RPS produced, while the TLS leaf's digest only
   * has to be something the firmware will accept as a server credential.
   */
  requiresSha384ProvisioningCert: boolean
}

const RSA_2048_DEVICE_KEY: RSADeviceKeyPair = { keyAlgorithm: 0, keyLength: 2048 }
const ECC_384_DEVICE_KEY: ECCDeviceKeyPair = { keyAlgorithm: 1, keyLength: 384 }

/**
 * Firmware that still carries the weak algorithms — AES-128, SHA-256, RSA-2K and
 * ECC-256. Everything that has not reported the hardening lands here, including
 * a device whose agent is too old to report anything at all.
 */
const LEGACY_CRYPTO_POLICY: AMTCertificatePolicy = {
  hashAlgorithm: 'sha256',
  rsaKeySize: 2048,
  deviceKeyPair: RSA_2048_DEVICE_KEY,
  requiresSha384ProvisioningCert: false
}

/**
 * The policy for firmware that has reported, through bit 4 of the change-enabled
 * response, that it has removed the weak algorithms — AES-128, SHA-256, RSA-2K
 * and ECC-256. AMT 22 is the first generation to report it, but the report is
 * what selects this tuple, not the generation, so an older platform updated to
 * hardened firmware lands here too.
 *
 * AMT 22 asks the firmware for an ECC-384 device key, not RSA-2048.
 *
 * Everything about the certificate itself has been eliminated as the cause of the
 * `Put AMT_TLSCredentialContext` -> HTTP 500 / AMT-STATUS 1 failure. Decoding the
 * AddCertificate blobs from a working AMT 21.0.6 run and three failing AMT 22.0.0
 * runs showed the leaves are equivalent in every field that matters — same
 * 3072-bit sha384 MPS root, same basicConstraints/keyUsage/EKU/validity, same
 * certificate handle 2 — and the three differences that did exist were each
 * removed on hardware without changing the fault: the leaf signature algorithm
 * (sha384 -> sha256), the issuer DN attribute order, and the device clock being
 * set only after the bind rather than before it.
 *
 * What is left is the key. AMT 22's factory key handle 0 is id-ecPublicKey /
 * secp384r1 and its device identity chain is the EC DICE chain; AMT 21's factory
 * key is RSA. An RSA-2048 credential is stored happily by AddCertificate and
 * refused only at bind time, with no diagnostic beyond a generic internal error —
 * exactly the observed behaviour. The SDK offers only RSA-2048 or ECC-384
 * (KeyAlgorithm ValueMap {0, 1}), so ECC-384 is both the stronger option and the
 * only remaining one.
 *
 * `hashAlgorithm` is sha384. Intel's AMT 22 crypto-hardening list requires both
 * halves at once and no run so far supplied both: "TlsProvisionVerifyLeafCertificate()
 * - remove SHA-256" rules out a sha256-signed leaf, and "do not accept leaf
 * certificates with RSA-2K or ECC-256 keys in TLS handshake and all WSMAN
 * certificate configuration APIs" rules out the RSA-2048 device key. The first
 * AMT 22 run had sha384 over an RSA-2048 key; the next two had sha256 over
 * RSA-2048 and then over ECC-384. Each failed the bind on the half it got wrong.
 */
const HARDENED_CRYPTO_POLICY: AMTCertificatePolicy = {
  hashAlgorithm: 'sha384',
  rsaKeySize: 3072,
  deviceKeyPair: ECC_384_DEVICE_KEY,
  requiresSha384ProvisioningCert: true
}

/**
 * Resolve the certificate policy for one device.
 *
 * `weakAlgorithmsRemoved` is the firmware's own answer, read by rpc-go from bit
 * 4 of the STATE_INDEPENDENCE_IsChangeToAMTEnabled response and forwarded in the
 * activation payload. It is the only input: the AMT version is an inference
 * about what the firmware will accept, and the firmware reports the same thing
 * directly.
 *
 * A reported `true` is honoured whatever the device's AMT version. The hardening
 * can reach an older platform through a firmware update, and when it does the
 * version is the one thing that does not move.
 *
 * An absent field — what an rpc-go predating it sends — is the legacy policy,
 * not a cue to guess from the version. The cost is a rollout order: rpc-go ships
 * before, or with, RPS, because an AMT 22 device on an older agent will take the
 * legacy policy and fail the `Put AMT_TLSCredentialContext` bind.
 */
export function getAMTCertificatePolicy(weakAlgorithmsRemoved?: boolean): AMTCertificatePolicy {
  return weakAlgorithmsRemoved === true ? HARDENED_CRYPTO_POLICY : LEGACY_CRYPTO_POLICY
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
 * The nonce is signed with the digest the provisioning certificate offers, and
 * the label follows the digest: SHA-384 -> 3, anything else -> 2. The two
 * returned values must agree with each other, because the firmware recomputes
 * the digest named by SigningAlgorithm and checks it against the signature RPS
 * produced.
 *
 * Which certificates are acceptable is decided by the policy, not here:
 * hardened firmware accepts only a SHA-384 certificate (createSignedString
 * rejects SHA-256 and names the digest), unhardened firmware accepts either.
 *
 * Unhardened firmware is no longer pinned to SigningAlgorithm 2. That is
 * deliberate, to measure SHA-384 across AMT 12 and later. It is known to fail
 * on at least one generation: an AMT 20.0.5 device rejected UpgradeClientToAdmin
 * with ReturnValue 3 (PT_STATUS_INVALID_PT_MODE) for SigningAlgorithm 3, where
 * AMT 21.0.6 and AMT 22.0.0 returned 0.
 */
export function resolveProvisioningSignature(
  certHashAlgorithm: string | null | undefined
): ProvisioningSignatureParameters {
  return certHashAlgorithm?.toLowerCase() === 'sha384'
    ? { hashAlgorithm: 'sha384', signingAlgorithm: 3 }
    : { hashAlgorithm: 'sha256', signingAlgorithm: 2 }
}

/*
 * Compile-time assertions that the two key-pair unions still reject the
 * cross-pairs. They live here, in a file the build compiles, rather than in
 * amtCertificatePolicy.test.ts: tsconfig.json excludes the test files and
 * vitest strips types without checking them, so a negative type assertion in a
 * test file would never be evaluated. These are types only and emit no code.
 *
 * If a later change widens `DeviceKeyPairParameters` back into two independent
 * scalars, `Rejects<...>` resolves to `false`, `Assert` fails its constraint,
 * and `npm run compile` reports it here.
 */
type Assert<T extends true> = T
/** True when `Pair` is assignable to neither member of the union. */
type Rejects<Union, Pair> = Pair extends Union ? false : true
type Accepts<Union, Pair> = Rejects<Union, Pair> extends false ? true : false

export type DeviceKeyPairRejectsCrossPairs = [
  Assert<Rejects<DeviceKeyPairParameters, { keyAlgorithm: 0; keyLength: 384 }>>,
  Assert<Rejects<DeviceKeyPairParameters, { keyAlgorithm: 1; keyLength: 2048 }>>,
  // The valid pairs have to stay accepted - a type that rejected everything
  // would satisfy the two assertions above and say nothing.
  Assert<Accepts<DeviceKeyPairParameters, { keyAlgorithm: 0; keyLength: 2048 }>>,
  Assert<Accepts<DeviceKeyPairParameters, { keyAlgorithm: 1; keyLength: 384 }>>
]

/** The same guarantee for the wsman-messages request type this module maps onto. */
export type GenerateKeyPairRequestRejectsCrossPairs = [
  Assert<Rejects<AMT.Models.GenerateKeyPairParameters, { KeyAlgorithm: 0; KeyLength: 384 }>>,
  Assert<Rejects<AMT.Models.GenerateKeyPairParameters, { KeyAlgorithm: 1; KeyLength: 2048 }>>,
  Assert<Accepts<AMT.Models.GenerateKeyPairParameters, { KeyAlgorithm: 0; KeyLength: 2048 }>>,
  Assert<Accepts<AMT.Models.GenerateKeyPairParameters, { KeyAlgorithm: 1; KeyLength: 384 }>>
]
