'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown } from 'lucide-react'

const EXAMPLE_SPECS = [
  { label: 'Petstore',   url: 'https://petstore3.swagger.io/api/v3/openapi.json' },
  { label: 'Resend',     url: 'https://raw.githubusercontent.com/resend/resend-openapi/main/resend.yaml' },
  { label: 'Vercel',     url: 'https://openapi.vercel.sh' },
  { label: 'Stripe',     url: 'https://raw.githubusercontent.com/stripe/openapi/master/openapi/spec3.json' },
  { label: 'SendGrid',   url: 'https://raw.githubusercontent.com/twilio/sendgrid-oai/main/oai.json' },
  { label: 'TMDB',       url: 'https://developer.themoviedb.org/openapi/64542913e1f86100738e227f' },
  { label: 'PagerDuty',  url: 'https://raw.githubusercontent.com/PagerDuty/api-schema/main/reference/REST/openapiv3.json' },
  { label: 'Twilio',     url: 'https://raw.githubusercontent.com/twilio/twilio-oai/main/spec/json/twilio_api_v2010.json' },
  { label: 'Slack',      url: 'https://raw.githubusercontent.com/slackapi/slack-api-specs/master/web-api/slack_web_openapi_v2.json' },
  { label: 'GitHub',     url: 'https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/api.github.com/api.github.com.json' },
  { label: 'Cloudflare', url: 'https://raw.githubusercontent.com/cloudflare/api-schemas/main/openapi.json' },
  { label: 'Notion',     url: 'https://raw.githubusercontent.com/Chrischuck/notion-openapi/main/notion-openapi.json' },
  { label: 'Linear',     url: 'https://raw.githubusercontent.com/nicoepp/linear-openapi-spec/main/openapi.json' },
  { label: 'Supabase',   url: 'https://raw.githubusercontent.com/supabase/supabase/master/apps/docs/spec/api_v1_openapi.json' },
  { label: 'Plaid',      url: 'https://raw.githubusercontent.com/plaid/plaid-openapi/master/2020-09-14.yml' },
  { label: 'OpenAI',     url: 'https://raw.githubusercontent.com/openai/openai-openapi/master/openapi.yaml' },
]

export function SpecInput() {
  const router = useRouter()
  const [specUrl, setSpecUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!specUrl.trim()) {
      setError('Provide a spec URL.')
      return
    }

    setLoading(true)

    try {
      const res = await fetch('/api/synthesise', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ specUrl: specUrl.trim() }),
      })

      if (!res.ok) {
        const data = await res.json().catch((e) => { console.warn('Failed to parse error response:', e); return {} })
        throw new Error(data.error || `Request failed (${res.status})`)
      }

      const { integrationId } = await res.json()
      router.push(`/integrate/${integrationId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="specUrl" className="block text-sm font-medium text-zinc-300 mb-1">
          OpenAPI Spec URL
        </label>
        <div className="flex gap-2">
          <input
            id="specUrl"
            type="url"
            placeholder="https://api.example.com/openapi.json"
            value={specUrl}
            onChange={(e) => setSpecUrl(e.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 text-zinc-100 placeholder-zinc-500 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
          />
          <div className="relative shrink-0">
            <select
              value=""
              onChange={(e) => { if (e.target.value) setSpecUrl(e.target.value) }}
              className="w-32 appearance-none rounded-lg border border-zinc-700 bg-zinc-900 pl-3 pr-7 py-3 text-sm text-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 cursor-pointer"
            >
              <option value="" disabled>Examples</option>
              {EXAMPLE_SPECS.map((s) => (
                <option key={s.label} value={s.url}>{s.label}</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 size-4 text-zinc-500" />
          </div>
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-400">{error}</p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-white px-4 py-3 font-medium text-zinc-900 hover:bg-zinc-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {loading ? 'Processing…' : 'Generate MCP Server'}
      </button>
    </form>
  )
}
