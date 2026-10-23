/*********************************************************************
 * Copyright (c) Intel Corporation 2026
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { type AMT } from '@device-management-toolkit/wsman-messages'

export interface AMTCertificatePolicy {
  /** The firmware supports exactly RSA-2048 and ECC-384; any other pair returns 2066. */
  deviceKeyPair: AMT.Models.GenerateKeyPairParameters
}

const LEGACY_CRYPTO_POLICY: AMTCertificatePolicy = { deviceKeyPair: { KeyAlgorithm: 0, KeyLength: 2048 } }
const HARDENED_CRYPTO_POLICY: AMTCertificatePolicy = { deviceKeyPair: { KeyAlgorithm: 1, KeyLength: 384 } }

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
export function getAMTCertificatePolicy(version: unknown, weakAlgorithmsRemoved?: boolean): AMTCertificatePolicy {
  const majorVersion = parseMajorVersion(version)
  // The payload is device-supplied JSON, so anything that is not a boolean counts as not reported.
  const reported = typeof weakAlgorithmsRemoved === 'boolean' ? weakAlgorithmsRemoved : undefined
  const hardened = reported ?? (majorVersion != null && majorVersion >= 22)
  return hardened ? HARDENED_CRYPTO_POLICY : LEGACY_CRYPTO_POLICY
}
