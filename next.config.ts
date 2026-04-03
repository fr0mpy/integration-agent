// Next.js config — WDK integration, security headers, build version stamping, template bundling
import type { NextConfig } from 'next'
import { withWorkflow } from 'workflow/next'
import { execSync } from 'child_process'

const isDev = process.env.NODE_ENV === 'development'

// Stamp every build with a git SHA + timestamp — used in log lines for deploy traceability
let gitSha = 'unknown'
try {
  gitSha = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim()
} catch { /* not in a git repo during build */ }

const nextConfig: NextConfig = {
  env: {
    BUILD_VERSION: `${gitSha}-${Date.now()}`,
  },
  cacheComponents: true,
  // Bundle the generated-server-template directory into API route lambdas so codegen can read it at runtime
  outputFileTracingIncludes: {
    '/api/*': ['./generated-server-template/**/*'],
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Content-Security-Policy', value: `default-src 'self'; script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https:;` },
        ],
      },
    ]
  },
}

// withWorkflow wraps the config to enable WDK's durable execution runtime for API routes
export default withWorkflow(nextConfig)
