/*********************************************************************
 * Copyright (c) Intel Corporation 2026
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { describe, expect, it } from 'vitest'
import { getAMTCertificatePolicy } from './amtCertificatePolicy.js'

describe('getAMTCertificatePolicy', () => {
  it.each([
    { version: '11.8.50', hashAlgorithm: 'sha256', rsaKeySize: 2048, signingAlgorithm: 2 },
    { version: '21.0.6', hashAlgorithm: 'sha256', rsaKeySize: 2048, signingAlgorithm: 2 },
    { version: '22.0.0', hashAlgorithm: 'sha384', rsaKeySize: 3072, signingAlgorithm: 3 },
    { version: '22.1.15', hashAlgorithm: 'sha384', rsaKeySize: 3072, signingAlgorithm: 3 },
    { version: 'unknown', hashAlgorithm: 'sha256', rsaKeySize: 2048, signingAlgorithm: 2 },
    { version: '', hashAlgorithm: 'sha256', rsaKeySize: 2048, signingAlgorithm: 2 }
  ])('selects the certificate policy for AMT $version', ({ version, ...expected }) => {
    expect(getAMTCertificatePolicy(version)).toEqual(expected)
  })
})
