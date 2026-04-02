import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16

// Reads and validates the 32-byte AES key from ENCRYPTION_KEY; throws immediately if missing or malformed so misconfiguration is caught at startup.
function getKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY

  if (!hex || hex.length !== 64) {
    throw new Error('ENCRYPTION_KEY must be a 64-character hex string (32 bytes)')
  }

  return Buffer.from(hex, 'hex')
}

// AES-256-GCM encrypts a plaintext string and returns a base64-encoded iv+authTag+ciphertext payload; used to store API credentials at rest.
export function encrypt(plaintext: string): string {
  const key = getKey()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ])
  const authTag = cipher.getAuthTag()

  // Format: base64(iv + authTag + ciphertext)
  return Buffer.concat([iv, authTag, encrypted]).toString('base64')
}

// Reverses encrypt: decodes the base64 envelope, authenticates the GCM tag, and returns the original plaintext; used to retrieve stored API credentials.
export function decrypt(encoded: string): string {
  const key = getKey()
  const data = Buffer.from(encoded, 'base64')

  const iv = data.subarray(0, IV_LENGTH)
  const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH)
  const ciphertext = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH)

  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ])
  return decrypted.toString('utf8')
}
