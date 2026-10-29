/*********************************************************************
 * Copyright (c) Intel Corporation 2026
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { isUsableHostname } from './ISecretManagerService.js'

describe('isUsableHostname', () => {
  it.each(['pc01', 'PC01.corp'])('should accept %j', (hostname) => {
    expect(isUsableHostname(hostname)).toBe(true)
  })

  it.each([
    '',
    'localhost',
    'LOCALHOST',
    'LocalHost',
    123,
    {},
    undefined,
    null
  ])('should reject %j', (hostname) => {
    expect(isUsableHostname(hostname)).toBe(false)
  })
})
