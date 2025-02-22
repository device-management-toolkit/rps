/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import crypto from 'node:crypto'
import cryptoRandomString from 'crypto-random-string'

const PasswordHelper = {
  /**
   * @description Generates the console nonce used validate the console.  AMT only accepts a nonce that is 20 bytes long of random data
   * @returns {buffer} Returns console nonce used to verify RCS server to AMT
   */
  generateNonce: (): Buffer => {
    const nonce = crypto.randomBytes(20)
    return nonce
  },

  /**
   * @description Checks the proposed AMT password against AMT password requirements
   * @param {string} password Password string to test
   * @returns {boolean} Returns true if password meets AMT password requirements
   */
  passwordCheck: (password: string): boolean => {
    let pass: boolean
    const len = 8
    const maxLen = 32
    const matches: string[] = []
    matches.push('[$@$!%*#?]')
    matches.push('[A-Z]')
    matches.push('[0-9]')
    matches.push('[a-z]')
    let n = 0
    for (const match of matches) {
      if (new RegExp(match).test(password)) {
        n++
      }
    }

    if (password.length < len || password.length > maxLen || n < 4) {
      pass = false
    } else {
      pass = true
    }
    return pass
  },

  /**
   * @description Generates a random password out of a given set of characters and of a given length
   * @param {number} length Length of desired password
   * @returns {string} Returns random password string
   */
  generateRandomPassword: (length = 16): string => {
    const PasswordChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz1234567890!@#$%^*()'

    for (let i = 0; i < 10000; ++i) {
      const password: string = cryptoRandomString({ length, characters: PasswordChars })

      if (PasswordHelper.passwordCheck(password)) {
        return password
      }
    }

    throw new Error('Failed to generate a valid random password')
  }
}

export { PasswordHelper }
