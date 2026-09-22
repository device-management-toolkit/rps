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
   * `requiresSha384ProvisioningCert` and `getSigningAlgorithm`.
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

const LEGACY_POLICY: AMTCertificatePolicy = {
  hashAlgorithm: 'sha256',
  rsaKeySize: 2048,
  deviceKeyPair: RSA_2048_DEVICE_KEY,
  requiresSha384ProvisioningCert: false
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
  requiresSha384ProvisioningCert: true
}

export function getAMTCertificatePolicy(version: unknown): AMTCertificatePolicy {
  if (typeof version !== 'string' || !/^\d+(?:\.\d+)*$/.test(version.trim())) {
    return LEGACY_POLICY
  }

  const majorVersion = Number.parseInt(version, 10)
  return majorVersion >= 22 ? AMT_22_POLICY : LEGACY_POLICY
}

/**
 * SigningAlgorithm for IPS_HostBasedSetupService AdminSetup / UpgradeClientToAdmin.
 *
 * This is a property of the *provisioning certificate*, not of the AMT version:
 * the firmware validates the digital signature RPS produced with that
 * certificate's key, so the algorithm has to match how the signature was made.
 * AMT 21 devices legitimately use 3 when the provisioning cert is SHA-384 —
 * deriving this from the AMT version would break signature validation.
 *
 * 2 = RSA_SHA-2_256, 3 = RSA_SHA-2_384.
 */
export function getSigningAlgorithm(certHashAlgorithm: string | null | undefined): 2 | 3 {
  return certHashAlgorithm?.toLowerCase() === 'sha384' ? 3 : 2
}
