'use client'

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { CodeViewer } from './CodeViewer'
import { ChatPanel } from './ChatPanel'

interface ValidatePanelProps {
  integrationId: string
  sandboxUrl: string | null
  /** Live route.ts source from the validate:running event — overrides stale Redis cache */
  sourceCode: string | null
  buildLog: string[]
  verifiedTools: string[]
  validateStatus: 'running' | 'complete' | 'failed' | 'pending'
}

export function ValidatePanel({
  integrationId,
  sandboxUrl,
  sourceCode,
  buildLog,
  verifiedTools,
  validateStatus,
}: ValidatePanelProps) {
  return (
    <div className="space-y-4">
      {/* Two-panel layout: code viewer + chat */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[3fr_2fr]">
        <CodeViewer integrationId={integrationId} sourceCode={sourceCode} />
        <ChatPanel integrationId={integrationId} sandboxUrl={sandboxUrl} />
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

      {/* Verified tools */}
      {validateStatus === 'complete' && verifiedTools.length > 0 && (
        <Card className="border-emerald-500/25">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-emerald-400">
              <span>✓</span>
              {verifiedTools.length}/{verifiedTools.length} tools verified
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-1.5">
              {verifiedTools.map((name) => (
                <Badge
                  key={name}
                  variant="outline"
                  className="border-emerald-500/30 font-mono text-xs text-emerald-400"
                >
                  {name}
                </Badge>
              ))}
            </div>
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
