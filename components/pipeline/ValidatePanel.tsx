// Preview MCP tab — code viewer + chat panel + on-demand sandbox lifecycle + build log
'use client'

import { useCallback } from 'react'
import { Loader2 } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { CodeViewer } from './CodeViewer'
import { ChatPanel } from './ChatPanel'
import { useSandbox } from '@/hooks/use-sandbox'

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
  /** True while a build-error retry is in-flight */
  buildRetrying: boolean
  /** The raw build error that triggered the retry */
  buildErrors: string | null
  /** True when the Preview MCP tab is selected — triggers sandbox spin-up */
  active?: boolean
}

export function ValidatePanel({
  integrationId,
  sandboxUrl: pipelineSandboxUrl,
  sourceCode,
  buildLog,
  verifiedTools,
  validateStatus,
  validatedAt,
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

  // Prefer the pipeline sandbox while it's alive; fall back to on-demand spin-up
  const sandboxUrl = pipelineSandboxUrl ?? sandbox.sandboxUrl

  // Persist edited route.ts to the source override store so chat and deploy use the user's version
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

  const sandboxBuilding = validateStatus !== 'complete' || sandbox.isSpinning

  // Merge pipeline build log with on-demand respawn log
  const allBuildLog = sandbox.buildLog.length > 0 ? [...buildLog, ...sandbox.buildLog] : buildLog

  return (
    <div className="space-y-4">

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
