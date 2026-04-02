/**
 * Central configuration — single source of truth for all hardcoded values.
 * Import from here instead of scattering magic strings across files.
 */
export const config = {
  models: {
    synthesis: 'anthropic/claude-haiku-4.5',
    chat: 'anthropic/claude-sonnet-4.6',
  },

  deploy: {
    envKeys: {
      hmacSecret: 'HMAC_SECRET',
      credentialEndpoint: 'CREDENTIAL_ENDPOINT',
      integrationId: 'INTEGRATION_ID',
    },
    /** URL prefixes that identify a local dev environment (GitHub rejects webhooks to these). */
    localUrlPrefixes: ['http://localhost', 'http://127.'],
  },

  sse: {
    maxRetries: 3,
    connectionTimeoutMs: 15_000,
  },
} as const
