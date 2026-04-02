import type { NextConfig } from 'next'
import { withWorkflow } from 'workflow/next'

const isDev = process.env.NODE_ENV === 'development'

const nextConfig: NextConfig = {
  cacheComponents: true,
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

export default withWorkflow(nextConfig)
