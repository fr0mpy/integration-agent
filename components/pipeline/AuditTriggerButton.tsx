'use client'

import { useState } from 'react'
import { ShieldCheck } from 'lucide-react'

export function AuditTriggerButton({ integrationId, onTriggered }: { integrationId: string; onTriggered?: () => void }) {
  const [triggering, setTriggering] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleTrigger() {
    setTriggering(true)
    setError(null)

    try {
      const res = await fetch(`/api/integrate/${integrationId}/trigger-audit`, { method: 'POST' })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? 'Failed to trigger audit')
      }

      onTriggered?.()
      setTriggering(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to trigger audit')
      setTriggering(false)
    }
  }

  return (
    <div className="mx-auto flex flex-col items-center gap-3 rounded-lg border border-zinc-700/50 bg-zinc-900/30 mb-4 p-4 w-fit">
      <p className="text-sm text-zinc-400 text-center">
        Preview is ready. When you&apos;re satisfied, run the security audit to proceed to deployment.
      </p>
      <button
        onClick={handleTrigger}
        disabled={triggering}
        className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
      >
        <ShieldCheck className="h-4 w-4" />
        {triggering ? 'Starting audit\u2026' : 'Run Security Audit & Deploy'}
      </button>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}
