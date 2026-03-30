'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

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
        const data = await res.json().catch(() => ({}))
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
        <input
          id="specUrl"
          type="url"
          placeholder="https://api.example.com/openapi.json"
          value={specUrl}
          onChange={(e) => setSpecUrl(e.target.value)}
          className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 text-zinc-100 placeholder-zinc-500 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
        />
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
