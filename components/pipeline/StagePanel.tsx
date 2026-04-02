'use client'

import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import type { PipelineStage } from '@/lib/pipeline/events'

interface StagePanelProps {
  status: 'pending' | 'running' | 'complete' | 'failed'
  error: string | null
  stage: PipelineStage
  stageLabel?: string
  children: React.ReactNode
}

export function StagePanel({ status, error, stage, stageLabel, children }: StagePanelProps) {
  if (status === 'pending') {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Waiting for previous stages to complete.
      </p>
    )
  }

  if (status === 'failed' && stage !== 'audit-mcp') {
    return (
      <Card className="border-red-500/25">
        <CardHeader>
          <CardTitle className="text-sm text-red-400">
            {stageLabel ?? stage} failed
          </CardTitle>
          <CardDescription>{error ?? 'Unknown error'}</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  if (
    status === 'running' &&
    stage !== 'preview-mcp' &&
    stage !== 'audit-mcp' &&
    stage !== 'deploy-mcp'
  ) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 py-2">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-600 border-t-zinc-300" />
          <span className="text-sm text-muted-foreground">Running...</span>
        </div>
        {children}
      </div>
    )
  }

  return <>{children}</>
}
