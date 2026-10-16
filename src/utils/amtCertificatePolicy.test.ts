/*********************************************************************
 * Copyright (c) Intel Corporation 2026
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { getAMTCertificatePolicy } from './amtCertificatePolicy.js'

const RSA_2048 = { KeyAlgorithm: 0, KeyLength: 2048 }
const ECC_384 = { KeyAlgorithm: 1, KeyLength: 384 }

describe('getAMTCertificatePolicy', () => {
  it.each([
    // [version, weakAlgorithmsRemoved, expected]
    [
      '22.0.0',
      true,
      ECC_384
    ],
    [
      '22.0.0',
      undefined,
      ECC_384
    ],
    [
      '22.0.0',
      false,
      RSA_2048
    ], // an explicit report beats the version guess
    [
      '21.0.6',
      true,
      ECC_384
    ], // a reported capability beats the version too
    [
      '21.0.6',
      false,
      RSA_2048
    ],
    [
      '21.0.6',
      undefined,
      RSA_2048
    ],
    [
      '12.0.95',
      undefined,
      RSA_2048
    ],
    [
      '11.8.50',
      undefined,
      RSA_2048
    ],
    [
      undefined,
      true,
      ECC_384
    ],
    [
      undefined,
      undefined,
      RSA_2048
    ],
    [
      'not-a-version',
      undefined,
      RSA_2048
    ]
  ])('version=%s weakAlgorithmsRemoved=%s', (version, weakAlgorithmsRemoved, expected) => {
    expect(getAMTCertificatePolicy(version, weakAlgorithmsRemoved).deviceKeyPair).toEqual(expected)
  })
})

describe('device key pair', () => {
  it.each([
    true,
    false,
    undefined
  ])('never pairs mismatched fields (weakAlgorithmsRemoved=%s)', (reported) => {
    const { KeyAlgorithm, KeyLength } = getAMTCertificatePolicy('22.0.0', reported).deviceKeyPair
    expect(KeyLength).toBe(KeyAlgorithm === 1 ? 384 : 2048)
  })
})
