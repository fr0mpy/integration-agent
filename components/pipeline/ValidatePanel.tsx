'use client'

import { useState, useCallback } from 'react'
import { Loader2 } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { CodeViewer } from './CodeViewer'
import { ChatPanel } from './ChatPanel'
import { useSandbox } from '@/hooks/use-sandbox'
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
  /** True while a build-error retry is in-flight */
  buildRetrying: boolean
  /** The raw build error that triggered the retry */
  buildErrors: string | null
  /** True when the Preview MCP tab is selected — triggers sandbox spin-up */
  active?: boolean
}

function credentialLabel(authMethod: string | null): string {
  if (authMethod === 'bearer') return 'Bearer token'
  if (authMethod === 'basic') return 'Password'
  return 'API key'
}

export function ValidatePanel({
  integrationId,
  sandboxUrl: pipelineSandboxUrl,
  sourceCode,
  buildLog,
  verifiedTools,
  validateStatus,
  validatedAt,
  authMethod,
  initialHasCredentials,
  initialLiveValidatedAt,
  buildRetrying,
  buildErrors,
  active = false,
}: ValidatePanelProps) {
  // On-demand sandbox: spins up when tab is active and pipeline sandbox is gone
  const sandbox = useSandbox(
    integrationId,
    pipelineSandboxUrl,
    active && validateStatus === 'complete',
  )

  // Use pipeline sandbox URL while pipeline is running, otherwise use on-demand sandbox
  const sandboxUrl = pipelineSandboxUrl ?? sandbox.sandboxUrl

  const [credential, setCredential] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [hasCredentials, setHasCredentials] = useState(initialHasCredentials)
  const [liveValidatedAt, setLiveValidatedAt] = useState<string | null>(initialLiveValidatedAt)
  const [liveResults, setLiveResults] = useState<RevalidateResponse['results'] | null>(null)
  const [credError, setCredError] = useState<string | null>(null)

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

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? 'Failed to save credentials')
      }

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

      if (!saveRes.ok) {
        const data = await saveRes.json().catch(() => ({}))
        throw new Error(data.error ?? 'Failed to save credentials')
      }

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

  const handleCodeSave = useCallback(async (source: string) => {
    await fetch(`/api/integrate/${integrationId}/source`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source }),
    })
  }, [integrationId])

  const handleCodeReset = useCallback(async () => {
    await fetch(`/api/integrate/${integrationId}/source`, { method: 'DELETE' })
  }, [integrationId])

  const showCredentialSection = authMethod && authMethod !== 'none'
  const sandboxBuilding = validateStatus !== 'complete' || sandbox.isSpinning

  // Merge pipeline build log with on-demand respawn log
  const allBuildLog = sandbox.buildLog.length > 0 ? [...buildLog, ...sandbox.buildLog] : buildLog

  return (
    <div className="space-y-4">

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

      {/* Build-error retry banner */}
      {buildRetrying && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-3 text-sm">
          <div className="flex items-center gap-2 font-medium text-yellow-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Build error detected — re-synthesising with AI…
          </div>
          {buildErrors && (
            <pre className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap font-mono text-xs text-zinc-400">
              {buildErrors}
            </pre>
          )}
        </div>
      )}

      {/* Two-panel layout: code viewer + chat */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[3fr_2fr]">
        <CodeViewer
          integrationId={integrationId}
          sourceCode={sourceCode}
          sandboxBuilding={sandboxBuilding}
          editable={validateStatus === 'complete'}
          onSave={handleCodeSave}
          onReset={handleCodeReset}
        />
        <ChatPanel integrationId={integrationId} sandboxUrl={sandboxUrl} validatedAt={validatedAt} sandboxBuilding={sandboxBuilding} />
      </div>

      {/* Sandbox error */}
      {sandbox.error && (
        <div className="rounded-md border border-red-500/25 bg-red-950/20 px-4 py-3">
          <p className="text-xs font-medium text-red-400">Sandbox failed</p>
          <p className="mt-1 text-[11px] text-zinc-400">{sandbox.error}</p>
          <button
            onClick={sandbox.spinUp}
            className="mt-2 rounded bg-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-600"
          >
            Retry
          </button>
        </div>
      )}

      {/* Build log */}
      {(sandboxBuilding || allBuildLog.length > 0 || validateStatus === 'complete') && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Build log</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <pre className="max-h-48 overflow-y-auto rounded-b-lg bg-zinc-950 p-4 text-xs leading-relaxed">
              {allBuildLog.length > 0 ? (
                allBuildLog.map((line, i) => (
                  <span key={i} className={line.startsWith('Sandbox live') || line.startsWith('Sandbox still') ? 'text-emerald-400' : 'text-zinc-400'}>
                    {line}{'\n'}
                  </span>
                ))
              ) : validateStatus === 'complete' ? (
                <span className="text-zinc-400">
                  {verifiedTools.length > 0 ? `✓ ${verifiedTools.length} tools MCP-verified` : '✓ Sandbox verified'}
                </span>
              ) : (
                <span className="flex items-center gap-2 text-zinc-400">
                  <span className="inline-block h-2 w-2 animate-spin rounded-full border border-zinc-600 border-t-zinc-300" />
                  Setting up sandbox...
                </span>
              )}
            </pre>
          </CardContent>
        </Card>
      )}

    </div>
  )
}
