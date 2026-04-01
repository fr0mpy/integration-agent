'use client'

import { useState } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { CodeViewer } from './CodeViewer'
import { ChatPanel } from './ChatPanel'
import type { RevalidateResponse } from '@/app/api/integrate/[integrationId]/revalidate/route'
import { relativeTime } from '@/lib/ui/time'

interface ValidatePanelProps {
  integrationId: string
  sandboxUrl: string | null
  /** Live route.ts source from the validate:running event — overrides stale Redis cache */
  sourceCode: string | null
  buildLog: string[]
  verifiedTools: string[]
  validateStatus: 'running' | 'complete' | 'failed' | 'pending'
  /** ISO timestamp of when MCP sandbox validation last passed — null if from live SSE */
  validatedAt: string | null
  /** 'apiKey' | 'bearer' | 'basic' | 'none' | null — controls whether credential input is shown */
  authMethod: string | null
  /** Whether a credential was previously saved for this integration */
  initialHasCredentials: boolean
  /** ISO timestamp of when live API validation last passed */
  initialLiveValidatedAt: string | null
}

function credentialLabel(authMethod: string | null): string {
  if (authMethod === 'bearer') return 'Bearer token'
  if (authMethod === 'basic') return 'Password'
  return 'API key'
}

export function ValidatePanel({
  integrationId,
  sandboxUrl,
  sourceCode,
  buildLog,
  verifiedTools,
  validateStatus,
  validatedAt,
  authMethod,
  initialHasCredentials,
  initialLiveValidatedAt,
}: ValidatePanelProps) {
  const [credential, setCredential] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [hasCredentials, setHasCredentials] = useState(initialHasCredentials)
  const [liveValidatedAt, setLiveValidatedAt] = useState<string | null>(initialLiveValidatedAt)
  const [liveResults, setLiveResults] = useState<RevalidateResponse['results'] | null>(null)
  const [credError, setCredError] = useState<string | null>(null)

  const liveVerifiedTools = new Set(liveResults?.filter((r) => r.ok).map((r) => r.toolName) ?? [])

  async function handleSave() {
    if (!credential.trim()) return
    setSaving(true)
    setCredError(null)
    try {
      const res = await fetch(`/api/integrate/${integrationId}/credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: credential.trim() }),
      })
      if (!res.ok) throw new Error(await res.text())
      setHasCredentials(true)
      setCredential('')
    } catch (err) {
      setCredError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveAndTest() {
    if (!credential.trim()) return
    setSaving(true)
    setCredError(null)
    try {
      const saveRes = await fetch(`/api/integrate/${integrationId}/credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: credential.trim() }),
      })
      if (!saveRes.ok) throw new Error(await saveRes.text())
      setHasCredentials(true)
      setCredential('')
    } catch (err) {
      setCredError(err instanceof Error ? err.message : 'Failed to save')
      setSaving(false)
      return
    }
    setSaving(false)

    // Now test
    setTesting(true)
    try {
      const res = await fetch(`/api/integrate/${integrationId}/revalidate`, { method: 'POST' })
      const data = await res.json() as RevalidateResponse
      setLiveResults(data.results)
      if (data.ok && data.liveValidatedAt) {
        setLiveValidatedAt(data.liveValidatedAt)
      } else if (!data.ok) {
        setCredError(data.error ?? 'Live test failed — check your credential')
      }
    } catch (err) {
      setCredError(err instanceof Error ? err.message : 'Revalidation failed')
    } finally {
      setTesting(false)
    }
  }

  async function handleTest() {
    setTesting(true)
    setCredError(null)
    try {
      const res = await fetch(`/api/integrate/${integrationId}/revalidate`, { method: 'POST' })
      const data = await res.json() as RevalidateResponse
      setLiveResults(data.results)
      if (data.ok && data.liveValidatedAt) {
        setLiveValidatedAt(data.liveValidatedAt)
      } else if (!data.ok) {
        setCredError(data.error ?? 'Live test failed — check your credential')
      }
    } catch (err) {
      setCredError(err instanceof Error ? err.message : 'Revalidation failed')
    } finally {
      setTesting(false)
    }
  }

  const showCredentialSection = authMethod && authMethod !== 'none'

  return (
    <div className="space-y-4">
      {/* Sandbox status banner */}
      {sandboxUrl ? (
        <div className="flex items-center gap-2 rounded-md border border-emerald-500/20 bg-emerald-950/20 px-3 py-2">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
          <span className="text-xs font-medium text-emerald-400">Live sandbox</span>
          <span className="text-xs text-zinc-500">
            —{verifiedTools.length > 0 ? ` ${verifiedTools.length} tools MCP-verified` : ' compiled, started, and MCP-verified'} in an isolated Firecracker VM
          </span>
        </div>
      ) : validatedAt ? (
        <div className="flex items-center gap-2 rounded-md border border-zinc-700/50 bg-zinc-900/40 px-3 py-2">
          <span className="text-xs text-emerald-500">✓</span>
          <span className="text-xs font-medium text-zinc-300">
            {verifiedTools.length > 0 ? `${verifiedTools.length} tools MCP-verified` : 'Sandbox verified'}
          </span>
          <span className="text-xs text-zinc-500">{relativeTime(validatedAt)}</span>
          <span className="text-xs text-zinc-600">— VM expired, chat inspection still available</span>
        </div>
      ) : null}

      {/* Credential input */}
      {showCredentialSection && (
        <div className="rounded-md border border-zinc-700/50 bg-zinc-900/30 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-300">
              {credentialLabel(authMethod)}
            </span>
            {liveValidatedAt ? (
              <span className="text-[10px] text-emerald-400">
                ✓ API verified {relativeTime(liveValidatedAt)}
              </span>
            ) : hasCredentials ? (
              <span className="text-[10px] text-zinc-500">Saved — not yet tested</span>
            ) : null}
          </div>

          <div className="flex gap-2">
            <input
              type="password"
              value={credential}
              onChange={(e) => setCredential(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (sandboxUrl ? handleSaveAndTest() : handleSave())}
              placeholder={hasCredentials ? '••••••••••••  (replace existing)' : `Enter ${credentialLabel(authMethod).toLowerCase()}`}
              className="flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 font-mono text-xs text-zinc-300 placeholder-zinc-600 focus:border-zinc-500 focus:outline-none"
            />
            {sandboxUrl ? (
              <button
                onClick={handleSaveAndTest}
                disabled={!credential.trim() || saving || testing}
                className="rounded bg-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-600 disabled:opacity-40"
              >
                {testing ? 'Testing…' : saving ? 'Saving…' : 'Save & Test'}
              </button>
            ) : (
              <>
                <button
                  onClick={handleSave}
                  disabled={!credential.trim() || saving}
                  className="rounded bg-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-600 disabled:opacity-40"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
                {hasCredentials && (
                  <button
                    onClick={handleTest}
                    disabled={testing}
                    className="rounded border border-zinc-600 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
                  >
                    {testing ? 'Testing…' : 'Test'}
                  </button>
                )}
              </>
            )}
          </div>

          {credError && (
            <p className="text-[11px] text-red-400">{credError}</p>
          )}

          {/* Live test results per tool */}
          {liveResults && liveResults.length > 0 && (
            <div className="mt-1 space-y-1">
              {liveResults.map((r) => (
                <div key={r.toolName} className="flex items-start gap-2 rounded bg-zinc-950/60 px-2 py-1.5">
                  <span className={`mt-px text-[10px] ${r.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                    {r.ok ? '✓' : '✗'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <span className="font-mono text-[11px] text-zinc-300">{r.toolName}</span>
                    {r.status && (
                      <span className={`ml-2 text-[10px] ${r.status < 400 ? 'text-zinc-500' : 'text-amber-400'}`}>
                        HTTP {r.status}
                      </span>
                    )}
                    <p className="truncate text-[10px] text-zinc-600">{r.preview}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Two-panel layout: code viewer + chat */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[3fr_2fr]">
        <CodeViewer integrationId={integrationId} sourceCode={sourceCode} />
        <ChatPanel integrationId={integrationId} sandboxUrl={sandboxUrl} validatedAt={validatedAt} />
      </div>

      {/* Build log */}
      {buildLog.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Build log</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <pre className="max-h-48 overflow-y-auto rounded-b-lg bg-zinc-950 p-4 text-xs leading-relaxed text-zinc-400">
              {buildLog.join('\n')}
            </pre>
          </CardContent>
        </Card>
      )}

      {/* Verified tools — dual badge tiers */}
      {(validateStatus === 'complete' || validatedAt) && verifiedTools.length > 0 && (
        <Card className="border-zinc-700/50">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-zinc-300">
              <span className="text-emerald-400">✓</span>
              {verifiedTools.length} tools verified
              {liveValidatedAt && (
                <Badge variant="outline" className="ml-1 border-emerald-500/40 text-[10px] text-emerald-400">
                  API verified
                </Badge>
              )}
              {validatedAt && (
                <span className="ml-auto text-[10px] font-normal text-zinc-500">
                  {relativeTime(validatedAt)}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-1.5">
              {verifiedTools.map((name) => {
                const isLive = liveVerifiedTools.has(name)
                return (
                  <Badge
                    key={name}
                    variant="outline"
                    className={
                      isLive
                        ? 'border-emerald-500/40 font-mono text-xs text-emerald-400'
                        : 'border-blue-500/30 font-mono text-xs text-blue-400'
                    }
                    title={isLive ? 'API verified — real call succeeded' : 'MCP verified — protocol + compile check'}
                  >
                    {name}
                    {isLive && <span className="ml-1 text-emerald-500">✓</span>}
                  </Badge>
                )
              })}
            </div>
            {verifiedTools.length > 0 && (
              <div className="mt-2 flex gap-3 text-[10px] text-zinc-600">
                <span><span className="text-blue-400">■</span> MCP verified</span>
                {liveVerifiedTools.size > 0 && (
                  <span><span className="text-emerald-400">■</span> API verified</span>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Starting sandbox indicator */}
      {validateStatus === 'running' && buildLog.length === 0 && (
        <div className="flex items-center gap-3 py-2 text-sm text-muted-foreground">
          <div className="h-3 w-3 animate-spin rounded-full border-2 border-zinc-600 border-t-zinc-300" />
          Starting sandbox…
        </div>
      )}
    </div>
  )
}
