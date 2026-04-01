'use client'

import { useState } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { DeployEventData } from '@/lib/pipeline/events'

interface DeployPanelProps {
  deployStep: DeployEventData['step'] | null
  deployPrUrl: string | null
  deployPrTitle: string | null
  deployRepoUrl: string | null
  deployRepoName: string | null
  deployWaitMessage: string | null
  deployPrStatus: 'open' | 'merged' | null
  deployBuildLog: string[]
  deployMcpUrl: string | null
  deployStatus: 'pending' | 'running' | 'complete' | 'failed'
  // Initial values from DB (for cached/reloaded views)
  initialPrUrl?: string | null
  initialMcpUrl?: string | null
  initialRepoUrl?: string | null
}

export function DeployPanel({
  deployStep,
  deployPrUrl,
  deployPrTitle,
  deployRepoUrl,
  deployRepoName,
  deployWaitMessage,
  deployPrStatus,
  deployBuildLog,
  deployMcpUrl,
  deployStatus,
  initialPrUrl,
  initialMcpUrl,
  initialRepoUrl,
}: DeployPanelProps) {
  const [copied, setCopied] = useState(false)

  const prUrl = deployPrUrl ?? initialPrUrl ?? null
  const mcpUrl = deployMcpUrl ?? initialMcpUrl ?? null
  const repoUrl = deployRepoUrl ?? initialRepoUrl ?? null

  async function handleCopy() {
    if (!mcpUrl) return
    await navigator.clipboard.writeText(mcpUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // Determine which beat we're on
  const isLive = deployStatus === 'complete' || !!mcpUrl
  const isMerged = deployPrStatus === 'merged' || deployStep === 'merged' || deployStep === 'deploying' || deployStep === 'live'
  const isPrOpen = !!prUrl && !isMerged && !isLive
  const isBuilding = (deployStep === 'deploying' || deployBuildLog.length > 0) && !isLive
  const isWaiting = deployStep === 'await-merge' && !isMerged

  return (
    <div className="space-y-4">

      {/* Beat 1–2: Creating repo / pushing files */}
      {deployStatus === 'running' && !prUrl && (
        <div className="flex items-center gap-3 py-1">
          <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-zinc-600 border-t-zinc-300" />
          <span className="text-sm text-zinc-400">
            {deployStep === 'push-files'
              ? `Pushing MCP server files to ${deployRepoName ?? 'generated-mcps'}...`
              : 'Creating GitHub repository...'}
          </span>
        </div>
      )}

      {/* Beat 7: Live banner */}
      {isLive && mcpUrl && (
        <div className="rounded-md border border-emerald-500/20 bg-emerald-950/20 px-4 py-3">
          <div className="flex items-center gap-2 mb-2">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            <span className="text-sm font-medium text-emerald-400">Live MCP server</span>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <code className="flex-1 truncate rounded bg-zinc-950/60 px-3 py-1.5 font-mono text-xs text-emerald-300">
              {mcpUrl}
            </code>
            <button
              onClick={handleCopy}
              className="shrink-0 rounded bg-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-600 transition-colors"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
            <a
              href={mcpUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 rounded bg-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-600 transition-colors"
            >
              Open ↗
            </a>
          </div>
          <p className="mt-2 text-[11px] text-zinc-500">
            This endpoint is live and ready to use with any MCP client.
          </p>
        </div>
      )}

      {/* Beat 5: PR merged badge */}
      {isMerged && !isLive && (
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="border-emerald-500/30 text-emerald-400 font-mono text-xs">
            ✓ PR merged
          </Badge>
          <span className="text-xs text-zinc-500">Deploying to Vercel...</span>
        </div>
      )}

      {/* Beat 3–4: PR card */}
      {prUrl && (
        <Card className={cn(
          'transition-colors',
          isMerged
            ? 'border-emerald-500/20 bg-emerald-950/10'
            : 'border-zinc-700/60',
        )}>
          <CardHeader className="pb-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <CardTitle className="text-sm font-medium leading-snug">
                  {deployPrTitle ?? 'Generated MCP Server'}
                </CardTitle>
                {deployRepoName && (
                  <p className="mt-0.5 font-mono text-[11px] text-zinc-500">
                    generate/{deployPrUrl?.split('/').pop()?.slice(0, 8) ?? '…'} → main
                  </p>
                )}
              </div>
              <a
                href={prUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 rounded bg-zinc-700/60 px-2.5 py-1 text-xs font-medium text-zinc-300 hover:bg-zinc-600/60 transition-colors"
              >
                GitHub ↗
              </a>
            </div>
          </CardHeader>
          <CardContent className="pb-3">
            <p className="text-xs text-zinc-400 leading-relaxed">
              This PR adds a generated MCP server. Review the tool definitions and API
              mappings before merging — merging will automatically trigger a Vercel deployment.
            </p>
            {repoUrl && (
              <a
                href={repoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                View repo ↗
              </a>
            )}
          </CardContent>
        </Card>
      )}

      {/* Beat 4: Waiting for merge */}
      {isWaiting && (
        <div className="flex items-center gap-3">
          <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-zinc-600 border-t-zinc-300" />
          <span className="text-xs text-zinc-400">
            {deployWaitMessage ?? 'Waiting for PR merge...'}
          </span>
        </div>
      )}

      {/* Beat 6: Build log */}
      {(isBuilding || deployBuildLog.length > 0) && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Vercel build log</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <pre className="max-h-48 overflow-y-auto rounded-b-lg bg-zinc-950 p-4 text-xs leading-relaxed text-zinc-400 whitespace-pre-wrap">
              {deployBuildLog.length > 0
                ? deployBuildLog.join('\n')
                : 'Waiting for build output...'}
            </pre>
          </CardContent>
        </Card>
      )}

      {/* Skeleton for truly pending state */}
      {deployStatus === 'pending' && !prUrl && !mcpUrl && (
        <Card className="border-dashed">
          <CardContent>
            <p className="py-6 text-center text-sm text-muted-foreground">
              Deployment will appear here once the preview stage completes.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
