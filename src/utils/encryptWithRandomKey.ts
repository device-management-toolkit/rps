import crypto from 'crypto'

/**
 * Encrypts a string using AES-256-GCM with a random key and random nonce, returns base64 ciphertext and key.
 * @param {string} plainText - The plaintext to encrypt.
 * @returns {{ cipherText: string, key: string }}
 */
export function encryptWithRandomKey(plainText: string): { cipherText: string; key: string } {
  // 24 bytes key for AES-192 to match Go's default (or use 32 bytes for AES-256 if you fix Go)
  const rawKey = crypto.randomBytes(24) // <-- AES-192, matches Go default!
  const keyString = rawKey.toString('base64') // This is what Go stores/uses
  const key = Buffer.from(keyString, 'ascii') // <-- This is what Go *actually* uses as key

  const nonce = crypto.randomBytes(12) // GCM standard
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce)
  const encrypted = Buffer.concat([
    cipher.update(plainText, 'utf8'),
    cipher.final()
  ])
  const tag = cipher.getAuthTag()

  // [nonce][ciphertext][tag] for Go compatibility
  const cipherText = Buffer.concat([
    nonce,
    encrypted,
    tag
  ]).toString('base64')

  return {
    cipherText,
    key: keyString
  }
}
