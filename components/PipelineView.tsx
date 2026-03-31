'use client'

import { useState } from 'react'
import { usePipeline } from '@/hooks/use-pipeline'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import { Skeleton } from '@/components/ui/skeleton'
import { methodColors, authStyles } from '@/lib/ui/badges'
import { cn } from '@/lib/utils'
import type { DiscoveryResult, DiscoveredEndpoint } from '@/lib/pipeline/discover'

export function PipelineView({ integrationId }: { integrationId: string }) {
  const { data, loading, error } = usePipeline<DiscoveryResult>(integrationId)

  if (loading) return <LoadingSkeleton />

  if (error) {
    return (
      <Card className="border-red-500/25">
        <CardHeader>
          <CardTitle className="text-red-400">Discovery failed</CardTitle>
          <CardDescription>{error}</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  if (!data) return null

  return (
    <div className="space-y-6">
      <HeaderCard result={data} />

      {data.warnings.length > 0 && <WarningsCard warnings={data.warnings} />}

      <div className="space-y-3">
        <h2 className="text-lg font-medium">
          Endpoints ({data.endpointCount})
        </h2>

        {Object.entries(data.groups).map(([group, endpoints]) => (
          <EndpointGroup key={group} name={group} endpoints={endpoints} />
        ))}
      </div>
    </div>
  )
}

function HeaderCard({ result }: { result: DiscoveryResult }) {
  const auth = authStyles[result.authMethod] ?? authStyles.none

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{result.apiName}</CardTitle>
        {result.apiDescription && (
          <CardDescription>{result.apiDescription}</CardDescription>
        )}
      </CardHeader>

      <CardContent>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline" className={auth.className}>
            {auth.label}
          </Badge>

          <Badge variant="secondary">
            {result.endpointCount} endpoint{result.endpointCount !== 1 ? 's' : ''}
          </Badge>

          {result.baseUrl && (
            <Badge variant="outline">
              {result.baseUrl}
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function WarningsCard({ warnings }: { warnings: string[] }) {
  return (
    <Card className="border-amber-500/25">
      <CardHeader>
        <CardTitle className="text-sm text-amber-400">Warnings</CardTitle>
      </CardHeader>

      <CardContent>
        <ul className="space-y-1 text-sm text-amber-300/80">
          {warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

function EndpointGroup({ name, endpoints }: { name: string; endpoints: DiscoveredEndpoint[] }) {
  const [open, setOpen] = useState(true)

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card size="sm">
        <CollapsibleTrigger className="flex w-full cursor-pointer items-center justify-between px-4 py-2 text-left">
          <span className="font-medium">/{name}</span>
          <span className="text-xs text-muted-foreground">
            {endpoints.length} endpoint{endpoints.length !== 1 ? 's' : ''}
            {open ? ' \u25B4' : ' \u25BE'}
          </span>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="divide-y divide-border">
            {endpoints.map((ep) => (
              <EndpointRow key={`${ep.method}:${ep.path}`} endpoint={ep} />
            ))}
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  )
}

function EndpointRow({ endpoint }: { endpoint: DiscoveredEndpoint }) {
  const colors = methodColors[endpoint.method] ?? ''

  return (
    <div className="flex items-start gap-3 px-4 py-2.5">
      <Badge variant="outline" className={cn('mt-0.5 shrink-0 font-mono text-[10px]', colors)}>
        {endpoint.method}
      </Badge>

      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-sm">{endpoint.path}</p>

        {endpoint.summary && (
          <p className="mt-0.5 text-xs text-muted-foreground">{endpoint.summary}</p>
        )}
      </div>

      {endpoint.operationId && (
        <code className="hidden shrink-0 text-xs text-muted-foreground sm:block">
          {endpoint.operationId}
        </code>
      )}
    </div>
  )
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-72" />
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-5 w-32" />
          </div>
        </CardContent>
      </Card>

      {[1, 2, 3].map((i) => (
        <Card size="sm" key={i}>
          <CardContent>
            <div className="space-y-3">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
