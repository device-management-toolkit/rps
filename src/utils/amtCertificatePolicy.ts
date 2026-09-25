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
 * ECC-384 (keyAlgorithm 1) is what AMT 22 asks for. node-forge cannot parse an
 * EC SubjectPublicKeyInfo, so the device's key is spliced into the TBSCertificate
 * as DER rather than parsed — see the external-public-key helpers in certManager.
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
  /**
   * Whether host-based setup on this generation can validate a provisioning
   * certificate *chain* that is itself signed with SHA-384.
   *
   * Distinct from `supportsSha384ProvisioningSignature`, which is about the
   * digest over the nonce: a device can be told to verify a SHA-256 nonce
   * signature (SigningAlgorithm 2) and still be unable to walk a SHA-384-signed
   * chain up to a trusted root, because that validation happens in
   * AddNextCertInChain/AdminSetup independently of the nonce.
   *
   * Intel documents SHA-256 provisioning-chain support from ME 11.0 onward and
   * says nothing about SHA-384 for that generation; SHA-384 chains are only
   * known-good from AMT 21. Gating here lets RPS refuse the combination with a
   * readable message instead of letting the firmware answer with an opaque
   * host-based-setup ReturnValue 5 (AuthFailed).
   *
   * Consequence worth stating explicitly: AMT 22 *requires* a SHA-384
   * provisioning certificate and pre-21 generations may refuse one, so no single
   * provisioning certificate covers the whole fleet. That is a deployment
   * problem — one domain profile per certificate digest — not something this
   * code can resolve.
   */
  supportsSha384ProvisioningCert: boolean
  /**
   * Whether host-based setup on this generation can *verify* a SHA-384 signature
   * over the provisioning nonce (`IPS_HostBasedSetupService` AdminSetup /
   * UpgradeClientToAdmin with SigningAlgorithm 3).
   *
   * This is the only field that gates the provisioning signature on the AMT
   * version, and it is a firmware capability, not a preference: an AMT 20.0.5
   * device rejected UpgradeClientToAdmin with ReturnValue 3
   * (PT_STATUS_INVALID_PT_MODE) for a SHA-384 signature, where an AMT 21.0.6 and
   * an AMT 22.0.0 device accepted byte-for-byte the same provisioning
   * certificate and returned 0. The digest used for the nonce signature is
   * independent of the certificate's own signature algorithm, so a device that
   * cannot do SHA-384 can still be provisioned with a SHA-384-signed
   * certificate — see `resolveProvisioningSignature`.
   */
  supportsSha384ProvisioningSignature: boolean
}

const RSA_2048_DEVICE_KEY: DeviceKeyPairParameters = { keyAlgorithm: 0, keyLength: 2048 }
const ECC_384_DEVICE_KEY: DeviceKeyPairParameters = { keyAlgorithm: 1, keyLength: 384 }

const PRE_AMT_21_POLICY: AMTCertificatePolicy = {
  hashAlgorithm: 'sha256',
  rsaKeySize: 2048,
  deviceKeyPair: RSA_2048_DEVICE_KEY,
  requiresSha384ProvisioningCert: false,
  supportsSha384ProvisioningCert: false,
  supportsSha384ProvisioningSignature: false
}

/**
 * AMT 21 is identical to earlier generations for every certificate RPS mints —
 * it binds a sha256 leaf over an RSA-2048 device key — and differs only on the
 * provisioning side, where it is the first generation known to accept both a
 * SHA-384-signed certificate chain and a SHA-384 nonce signature.
 */
const AMT_21_POLICY: AMTCertificatePolicy = {
  ...PRE_AMT_21_POLICY,
  supportsSha384ProvisioningCert: true,
  supportsSha384ProvisioningSignature: true
}

/**
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
const AMT_22_POLICY: AMTCertificatePolicy = {
  hashAlgorithm: 'sha384',
  rsaKeySize: 3072,
  deviceKeyPair: ECC_384_DEVICE_KEY,
  requiresSha384ProvisioningCert: true,
  supportsSha384ProvisioningCert: true,
  supportsSha384ProvisioningSignature: true
}

export function getAMTCertificatePolicy(version: unknown): AMTCertificatePolicy {
  if (typeof version !== 'string' || !/^\d+(?:\.\d+)*$/.test(version.trim())) {
    return PRE_AMT_21_POLICY
  }

  const majorVersion = Number.parseInt(version, 10)
  if (majorVersion >= 22) {
    return AMT_22_POLICY
  }
  return majorVersion >= 21 ? AMT_21_POLICY : PRE_AMT_21_POLICY
}

/** Outcome of checking a provisioning certificate against a device's policy. */
export interface ProvisioningCertificateCompatibility {
  supported: boolean
  /** Populated only when `supported` is false; safe to log and surface verbatim. */
  reason?: string
}

/**
 * Whether this device can be provisioned with a certificate chain of the given
 * digest, checked before any host-based setup call is sent.
 *
 * Both directions are real and were observed on hardware. AMT 22.0.0 rejects a
 * SHA-256 chain; pre-21 firmware is not documented to validate a SHA-384 one,
 * and an AMT 11.8.95 device answered UpgradeClientToAdmin with ReturnValue 5
 * (AuthFailed) for a SHA-384 chain. Neither failure names the digest, so the
 * point of this check is to say which certificate the profile needs rather than
 * to change what the firmware would have done.
 *
 * An unrecognised or missing digest is allowed through: the pre-existing
 * behaviour is to attempt provisioning, and turning "we could not read the
 * certificate's algorithm" into a hard stop would break deployments this change
 * has no evidence about.
 */
export function checkProvisioningCertificateCompatibility(
  version: unknown,
  certHashAlgorithm: string | null | undefined
): ProvisioningCertificateCompatibility {
  const policy = getAMTCertificatePolicy(version)
  const digest = certHashAlgorithm?.toLowerCase()
  const versionLabel = typeof version === 'string' && version !== '' ? version : 'unknown'

  if (digest === 'sha384' && !policy.supportsSha384ProvisioningCert) {
    return {
      supported: false,
      reason: `AMT ${versionLabel} cannot validate a SHA384-signed provisioning certificate chain; supply a SHA256 provisioning certificate for this device (AMT 22 requires SHA384, so the two need separate domain profiles)`
    }
  }

  if (digest !== 'sha384' && policy.requiresSha384ProvisioningCert) {
    return {
      supported: false,
      reason: `AMT ${versionLabel} requires a SHA384 provisioning certificate; the configured domain profile supplies ${digest ?? 'an unknown digest'}`
    }
  }

  return { supported: true }
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
 * The two have to be the intersection of what the provisioning certificate
 * offers and what the firmware can verify, and they have to agree with each
 * other — the firmware recomputes the digest named by SigningAlgorithm and
 * checks it against the signature RPS produced, so deriving them separately
 * risks sending a SHA-384 signature labelled 2, or the reverse.
 *
 * Neither input alone is sufficient. Deriving purely from the certificate sent
 * SigningAlgorithm 3 to an AMT 20.0.5 device and got ReturnValue 3 back;
 * deriving purely from the AMT version would sign with a digest the
 * certificate's key was never used for on the generations that do accept both.
 *
 * Nor can this collapse back to a hardcoded 2. Forcing SigningAlgorithm 2 with a
 * SHA-256 nonce signature on an AMT 22.0.0 device returned ReturnValue 1 from
 * UpgradeClientToAdmin and the activation fell back to Unprovision (verified
 * 2026-09-24), where 3 with the same SHA-384 provisioning certificate returns 0.
 * AMT 22 does not merely accept 3 — it requires it.
 */
export function resolveProvisioningSignature(
  version: unknown,
  certHashAlgorithm: string | null | undefined
): ProvisioningSignatureParameters {
  const certIsSha384 = certHashAlgorithm?.toLowerCase() === 'sha384'
  const useSha384 = certIsSha384 && getAMTCertificatePolicy(version).supportsSha384ProvisioningSignature
  return useSha384 ? { hashAlgorithm: 'sha384', signingAlgorithm: 3 } : { hashAlgorithm: 'sha256', signingAlgorithm: 2 }
}
