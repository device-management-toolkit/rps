/*********************************************************************
 * Copyright (c) Intel Corporation 2026
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

export interface AMTCertificatePolicy {
  hashAlgorithm: 'sha256' | 'sha384'
  rsaKeySize: 2048 | 3072
  signingAlgorithm: 2 | 3
}

const LEGACY_POLICY: AMTCertificatePolicy = {
  hashAlgorithm: 'sha256',
  rsaKeySize: 2048,
  signingAlgorithm: 2
}

const AMT_22_POLICY: AMTCertificatePolicy = {
  hashAlgorithm: 'sha384',
  rsaKeySize: 3072,
  signingAlgorithm: 3
}

export function getAMTCertificatePolicy(version: unknown): AMTCertificatePolicy {
  if (typeof version !== 'string' || !/^\d+(?:\.\d+)*$/.test(version.trim())) {
    return LEGACY_POLICY
  }

  const majorVersion = Number.parseInt(version, 10)
  return majorVersion >= 22 ? AMT_22_POLICY : LEGACY_POLICY
}
