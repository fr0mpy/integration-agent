'use client'

import { useState } from 'react'
import { Hammer } from 'lucide-react'

export function BuildTriggerButton({
  integrationId,
  excludedTools,
  totalTools,
}: {
  integrationId: string
  excludedTools: Set<string>
  totalTools: number
}) {
  const [triggering, setTriggering] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const enabledCount = totalTools - excludedTools.size

  async function handleTrigger() {
    setTriggering(true)
    setError(null)

    try {
      const res = await fetch(`/api/integrate/${integrationId}/trigger-build`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ excludedTools: [...excludedTools] }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? 'Failed to trigger build')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to trigger build')
      setTriggering(false)
    }
    // Don't reset triggering — the SSE stream will update the UI when preview-mcp starts
  }

  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-zinc-700/50 bg-zinc-900/30 p-6">
      <p className="text-sm text-zinc-400 text-center">
        Review the generated tools above. Toggle off any you don&apos;t need, then build the MCP server.
      </p>
      <button
        onClick={handleTrigger}
        disabled={triggering || enabledCount === 0}
        className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
      >
        <Hammer className="h-4 w-4" />
        {triggering
          ? 'Starting build\u2026'
          : `Build MCP Server (${enabledCount} tool${enabledCount !== 1 ? 's' : ''})`}
      </button>
      {enabledCount === 0 && !triggering && (
        <p className="text-xs text-amber-400">Enable at least one tool to proceed.</p>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}
