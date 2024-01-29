/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { parseValue } from './parseEnvValue.js'

describe('Check parseEnvValue', () => {
  it('Should pass when converting string to number', async () => {
    const result = parseValue('1020')
    expect(result).toEqual(1020)
  })
  it('Should pass when converting string to true', async () => {
    const result = parseValue('true')
    expect(result).toEqual(true)
  })
  it('Should pass when converting string to false', async () => {
    const result = parseValue('false')
    expect(result).toEqual(false)
  })
  it('Should pass when converting FALSE to false', async () => {
    const result = parseValue('FALSE')
    expect(result).toEqual(false)
  })
  it('Should pass when converting TRUE to true', async () => {
    const result = parseValue('TRUE')
    expect(result).toEqual(true)
  })
  it('Should return val', async () => {
    const result = parseValue('fake')
    expect(result).toEqual('fake')
  })
})
