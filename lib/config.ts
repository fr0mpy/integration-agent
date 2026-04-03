/**
 * Central configuration — single source of truth for all hardcoded values.
 * Import from here instead of scattering magic strings across files.
 */
export const BUILD_VERSION = process.env.BUILD_VERSION ?? 'dev'

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
    vercelApi: 'https://api.vercel.com',
    buildTimeoutMs: 10 * 60 * 1000,
    appearTimeoutMs: 5 * 60 * 1000,
    pollIntervalMs: 20_000,
    pingTimeoutMs: 10 * 60 * 1000,
    pingPollMs: 15_000,
    pollDeadlineMs: 24 * 60 * 60 * 1000,
    githubBranchInitMs: 1_500,
  },

  sse: {
    maxRetries: 3,
    connectionTimeoutMs: 15_000,
  },

  pipeline: {
    synthesisMaxRetries: 2,
    runIdPollAttempts: 3,
    runIdPollIntervalMs: 1_000,
  },

  sandbox: {
    liveTimeoutMs: 30 * 60 * 1000,
    serverWarmupMs: 3_000,
  },

  discovery: {
    maxEndpoints: 50,
    minSummaryLength: 10,
    maxSchemaDepth: 2,
  },

  validation: {
    maxSpecSize: 10 * 1024 * 1024,
    maxSourceLength: 512_000,
  },

  cache: {
    ttlSeconds: 60 * 60 * 24 * 30,
  },

  ui: {
    reasoningCollapseMs: 800,
    codeSaveDebounceMs: 1_000,
    clipboardFeedbackMs: 2_000,
    sandboxRetryMs: 2_000,
    sandboxFallbackDelayMs: 2_000,
  },
} as const
