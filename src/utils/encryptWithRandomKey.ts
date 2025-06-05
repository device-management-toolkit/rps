import crypto from 'crypto'

/**
 * Encrypts a string using AES-256-GCM with a random key and random nonce, returns base64 ciphertext and key.
 * @param {string} plainText - The plaintext to encrypt.
 * @returns {{ cipherText: string, key: string }}
 */
export function encryptWithRandomKey(plainText: string): { cipherText: string, key: string } {
  // Generate a random 32-byte key (256 bits)
  const key = crypto.randomBytes(32)
  // Generate a random 12-byte nonce (GCM standard)
  const nonce = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce)
  const encrypted = Buffer.concat([
    cipher.update(plainText, 'utf8'),
    cipher.final()
  ])
  const tag = cipher.getAuthTag()
  // Prepend nonce and tag to ciphertext for transport
  const cipherText = Buffer.concat([nonce, tag, encrypted]).toString('base64')
  return {
    cipherText,
    key: key.toString('base64')
  }
}
