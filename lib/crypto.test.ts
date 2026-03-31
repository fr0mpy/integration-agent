import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { randomBytes } from 'crypto'

describe('crypto', () => {
  const TEST_KEY = randomBytes(32).toString('hex')
  const originalEnv = process.env.ENCRYPTION_KEY

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = TEST_KEY
    vi.resetModules()
  })

  afterEach(() => {
    process.env.ENCRYPTION_KEY = originalEnv
  })

  async function loadCrypto() {
    return import('./crypto')
  }

  it('round-trips encrypt and decrypt', async () => {
    const { encrypt, decrypt } = await loadCrypto()
    const plaintext = 'my-secret-api-key-12345'
    const encrypted = encrypt(plaintext)
    expect(encrypted).not.toBe(plaintext)
    expect(decrypt(encrypted)).toBe(plaintext)
  })

  it('produces different ciphertexts for same input (random IV)', async () => {
    const { encrypt } = await loadCrypto()
    const plaintext = 'same-input'
    const a = encrypt(plaintext)
    const b = encrypt(plaintext)
    expect(a).not.toBe(b)
  })

  it('throws on missing ENCRYPTION_KEY', async () => {
    process.env.ENCRYPTION_KEY = ''
    const { encrypt } = await loadCrypto()
    expect(() => encrypt('test')).toThrow('ENCRYPTION_KEY must be a 64-character hex string')
  })

  it('throws on short ENCRYPTION_KEY', async () => {
    process.env.ENCRYPTION_KEY = 'abcd'
    const { encrypt } = await loadCrypto()
    expect(() => encrypt('test')).toThrow('ENCRYPTION_KEY must be a 64-character hex string')
  })

  it('throws on tampered ciphertext', async () => {
    const { encrypt, decrypt } = await loadCrypto()
    const encrypted = encrypt('secret')
    const buf = Buffer.from(encrypted, 'base64')
    buf[buf.length - 1] ^= 0xff // flip a byte
    const tampered = buf.toString('base64')
    expect(() => decrypt(tampered)).toThrow()
  })

  it('handles empty string', async () => {
    const { encrypt, decrypt } = await loadCrypto()
    const encrypted = encrypt('')
    expect(decrypt(encrypted)).toBe('')
  })

  it('handles unicode', async () => {
    const { encrypt, decrypt } = await loadCrypto()
    const plaintext = '密码 пароль 🔑'
    expect(decrypt(encrypt(plaintext))).toBe(plaintext)
  })
})
