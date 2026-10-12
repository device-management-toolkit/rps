/*********************************************************************
 * Copyright (c) Intel Corporation 2026
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

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
 * ECC-384 (keyAlgorithm 1) is expressible but not yet used. The obstacle is
 * narrower than it first appears: node-forge's publicKeyFromPem cannot *parse*
 * an EC SubjectPublicKeyInfo, but RPS never needs to. The leaf is signed with
 * the RPS root's RSA key; the device's EC key only has to be embedded. AMT
 * returns AMT_PublicPrivateKeyPair.DERKey as the SPKI DER already, so it can be
 * spliced into the TBSCertificate verbatim (forge's certificateToAsn1 reuses a
 * caller-supplied cert.tbsCertificate) without ever being parsed.
 */
export interface DeviceKeyPairParameters {
  keyAlgorithm: 0 | 1
  keyLength: 384 | 2048
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

const RSA_2048_DEVICE_KEY: DeviceKeyPairParameters = { keyAlgorithm: 0, keyLength: 2048 }
const ECC_384_DEVICE_KEY: DeviceKeyPairParameters = { keyAlgorithm: 1, keyLength: 384 }

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
 * SHA-384 is used when the certificate offers it *and* the firmware has reported
 * the hardening. The two returned values must agree with each other — the
 * firmware recomputes the digest named by SigningAlgorithm and checks it against
 * the signature RPS produced, so deriving them separately risks sending a
 * SHA-384 signature labelled 2, or the reverse.
 *
 * Neither input alone is sufficient. Deriving purely from the certificate sent
 * SigningAlgorithm 3 to an AMT 20.0.5 device and got ReturnValue 3
 * (PT_STATUS_INVALID_PT_MODE) back; deriving purely from the firmware ignores
 * what the certificate actually offers.
 *
 * Nor can this collapse back to a hardcoded 2. Forcing SigningAlgorithm 2 with a
 * SHA-256 nonce signature on an AMT 22.0.0 device returned ReturnValue 1 from
 * UpgradeClientToAdmin and the activation fell back to Unprovision (verified
 * 2026-09-24), where 3 with the same SHA-384 provisioning certificate returns 0.
 * AMT 22 does not merely accept 3 — it requires it.
 *
 * Firmware that has not reported the hardening is signed with SHA-256 even when
 * the certificate is SHA-384. That includes AMT 21, which can verify SHA-384 but
 * does not require it; the nonce digest is independent of the digest the
 * certificate itself was signed with, so nothing is lost.
 */
export function resolveProvisioningSignature(
  certHashAlgorithm: string | null | undefined,
  weakAlgorithmsRemoved?: boolean
): ProvisioningSignatureParameters {
  const certIsSha384 = certHashAlgorithm?.toLowerCase() === 'sha384'
  const useSha384 = certIsSha384 && weakAlgorithmsRemoved === true
  return useSha384 ? { hashAlgorithm: 'sha384', signingAlgorithm: 3 } : { hashAlgorithm: 'sha256', signingAlgorithm: 2 }
}
