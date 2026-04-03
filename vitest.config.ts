// Test config — mirrors Next.js path aliases and stubs out the 'server-only' guard for unit tests
import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      // Next.js 'server-only' throws at import time in client bundles — replace with a no-op for tests
      'server-only': path.resolve(__dirname, 'test/server-only-mock.ts'),
    },
  },
})
