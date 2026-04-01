'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { usePipeline } from '@/hooks/use-pipeline'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import { ToolCard } from '@/components/pipeline/ToolCard'
import { ValidatePanel } from '@/components/pipeline/ValidatePanel'
import { DeployPanel } from '@/components/pipeline/DeployPanel'
import { methodColors, authStyles } from '@/lib/ui/badges'
import { cn } from '@/lib/utils'
import type { DiscoveryResult, DiscoveredEndpoint } from '@/lib/pipeline/discover'
import type { PipelineStage } from '@/lib/pipeline/events'

const STAGES: { key: PipelineStage; label: string }[] = [
  { key: 'discover-api', label: 'Discover API' },
  { key: 'build-mcp', label: 'Generated Tools' },
  { key: 'preview-mcp', label: 'Preview MCP' },
  { key: 'deploy-mcp', label: 'Deploy MCP' },
  { key: 'health-check', label: 'Health Check' },
]

const STATUS_ICONS: Record<string, string> = {
  complete: '\u2713',
  running: '\u25CF',
  failed: '\u2717',
}

const VALID_STAGES = new Set<string>(STAGES.map((s) => s.key))

function parseTabParam(value: string | null): PipelineStage {
  if (value && VALID_STAGES.has(value)) return value as PipelineStage
  return 'discover-api'
}

export function PipelineView({
  integrationId,
  cached = false,
  initialSandboxUrl = null,
  initialVerifiedTools = [],
  initialValidatedAt = null,
  authMethod = null,
  initialHasCredentials = false,
  initialLiveValidatedAt = null,
  initialPrUrl = null,
  initialMcpUrl = null,
  initialRepoUrl = null,
}: {
  integrationId: string
  cached?: boolean
  initialSandboxUrl?: string | null
  initialVerifiedTools?: string[]
  initialValidatedAt?: string | null
  authMethod?: string | null
  initialHasCredentials?: boolean
  initialLiveValidatedAt?: string | null
  initialPrUrl?: string | null
  initialMcpUrl?: string | null
  initialRepoUrl?: string | null
}) {
  const state = usePipeline(integrationId, cached)

  const METHOD_ORDER: Record<string, number> = { GET: 0, POST: 1, PUT: 2, PATCH: 3, DELETE: 4 }
  const toolGroups = useMemo(() => {
    const sorted = [...state.tools].sort((a, b) => {
      const pathCmp = a.httpPath.localeCompare(b.httpPath)
      if (pathCmp !== 0) return pathCmp
      return (METHOD_ORDER[a.httpMethod] ?? 9) - (METHOD_ORDER[b.httpMethod] ?? 9)
    })
    const groups: Record<string, typeof sorted> = {}
    for (const tool of sorted) {
      const root = tool.httpPath.split('/')[1] ?? 'other'
      ;(groups[root] ??= []).push(tool)
    }
    return groups
  }, [state.tools])

  const router = useRouter()
  const searchParams = useSearchParams()

  const [activeTab, setActiveTab] = useState<PipelineStage>(() =>
    parseTabParam(searchParams.get('tab')),
  )
  // Sync URL → state on popstate / external navigation
  useEffect(() => {
    const paramTab = parseTabParam(searchParams.get('tab'))
    if (paramTab !== activeTab) {
      setActiveTab(paramTab)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  const isConnecting = !state.connected && !state.discovery && !state.error

  const handleTabChange = useCallback((value: unknown) => {
    const tab = value as PipelineStage
    setActiveTab(tab)
    // Sync to URL
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', tab)
    router.replace(`?${params.toString()}`, { scroll: false })
  }, [router, searchParams])

  if (state.error && !state.discovery) {
    return (
      <div className="space-y-6">
        <Card className="border-red-500/25">
          <CardHeader>
            <CardTitle className="text-red-400">Pipeline failed</CardTitle>
            <CardDescription>{state.error}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange}>
      <TabsList variant="line" className="w-full justify-start gap-0">
        {STAGES.map(({ key, label }) => {
          const status = state.stageStatus[key]
          const icon = STATUS_ICONS[status]
          const isPending = status === 'pending'

          return (
            <TabsTrigger
              key={key}
              value={key}
              disabled={isPending}
              className={cn(
                'gap-1.5 px-3 py-1.5',
                !isPending && 'cursor-pointer',
                status === 'running' && 'text-blue-400',
                status === 'complete' && 'text-emerald-400',
                status === 'failed' && 'text-red-400',
              )}
            >
              {icon && (
                <span className={cn(
                  'text-xs',
                  status === 'running' && 'animate-pulse',
                )}>
                  {icon}
                </span>
              )}
              {label}
            </TabsTrigger>
          )
        })}
      </TabsList>

      {isConnecting && (
        <div className="flex items-center gap-3 py-6">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-600 border-t-zinc-300" />
          <span className="text-sm text-muted-foreground">
            Connecting to pipeline...
          </span>
        </div>
      )}

      {/* Discover API */}
      <TabsContent value="discover-api" className="mt-4 space-y-4">
        <StagePanel status={state.stageStatus['discover-api']} error={state.error} stage="discover-api">
          {state.discovery && (
            <>
              <HeaderCard result={state.discovery} />

              {state.discovery.warnings.length > 0 && (
                <WarningsCard warnings={state.discovery.warnings} />
              )}

              <div className="space-y-3">
                <h2 className="text-lg font-medium">
                  Endpoints ({state.discovery.endpointCount})
                </h2>

                {Object.entries(state.discovery.groups).map(([group, endpoints]) => (
                  <EndpointGroup key={group} name={group} endpoints={endpoints} />
                ))}
              </div>
            </>
          )}
        </StagePanel>
      </TabsContent>

      {/* Build MCP */}
      <TabsContent value="build-mcp" className="mt-4 space-y-4">
        <StagePanel status={state.stageStatus['build-mcp']} error={state.error} stage="build-mcp">
          {state.tools.length > 0 && (
            <>
              <h2 className="text-lg font-medium">
                MCP Tools ({state.tools.length}
                {state.config ? ` / ${state.config.tools.length}` : ''})
              </h2>

              <div className="space-y-4">
                {Object.entries(toolGroups).map(([group, tools]) => (
                  <div key={group} className="space-y-2">
                    <h3 className="text-sm font-medium text-muted-foreground font-mono">/{group}</h3>
                    {tools.map((tool) => (
                      <ToolCard key={tool.name} tool={tool} />
                    ))}
                  </div>
                ))}
              </div>
            </>
          )}
        </StagePanel>
      </TabsContent>

      {/* Preview MCP — code IDE + AI chat + build log */}
      <TabsContent value="preview-mcp" className="mt-4">
        <StagePanel status={state.stageStatus['preview-mcp']} error={state.error} stage="preview-mcp">
          <ValidatePanel
            integrationId={integrationId}
            sandboxUrl={state.sandboxUrl ?? initialSandboxUrl}
            sourceCode={state.sourceCode}
            buildLog={state.buildLog}
            verifiedTools={state.verifiedTools.length > 0 ? state.verifiedTools : initialVerifiedTools}
            validatedAt={state.sandboxUrl ? null : initialValidatedAt}
            validateStatus={state.stageStatus['preview-mcp']}
            authMethod={authMethod}
            initialHasCredentials={initialHasCredentials}
            initialLiveValidatedAt={initialLiveValidatedAt}
            buildRetrying={state.buildRetrying}
            buildErrors={state.buildErrors}
          />
        </StagePanel>
      </TabsContent>

      {/* Deploy MCP */}
      <TabsContent value="deploy-mcp" className="mt-4">
        <StagePanel status={state.stageStatus['deploy-mcp']} error={state.error} stage="deploy-mcp">
          <DeployPanel
            deployStep={state.deployStep}
            deployPrUrl={state.deployPrUrl}
            deployPrTitle={state.deployPrTitle}
            deployRepoUrl={state.deployRepoUrl}
            deployRepoName={state.deployRepoName}
            deployWaitMessage={state.deployWaitMessage}
            deployPrStatus={state.deployPrStatus}
            deployBuildLog={state.deployBuildLog}
            deployMcpUrl={state.deployMcpUrl}
            deployStatus={state.stageStatus['deploy-mcp']}
            initialPrUrl={initialPrUrl}
            initialMcpUrl={initialMcpUrl}
            initialRepoUrl={initialRepoUrl}
          />
        </StagePanel>
      </TabsContent>

      {/* Health Check */}
      <TabsContent value="health-check" className="mt-4">
        <StagePanel status={state.stageStatus['health-check']} error={state.error} stage="health-check">
          <PlaceholderPanel label="Health check" />
        </StagePanel>
      </TabsContent>
    </Tabs>
  )
}

/** Wraps tab content with loading/error/pending states */
function StagePanel({
  status,
  error,
  stage,
  children,
}: {
  status: 'pending' | 'running' | 'complete' | 'failed'
  error: string | null
  stage: PipelineStage
  children: React.ReactNode
}) {
  if (status === 'pending') {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Waiting for previous stages to complete.
      </p>
    )
  }

  if (status === 'failed') {
    return (
      <Card className="border-red-500/25">
        <CardHeader>
          <CardTitle className="text-sm text-red-400">
            {STAGES.find((s) => s.key === stage)?.label} failed
          </CardTitle>
          <CardDescription>{error ?? 'Unknown error'}</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  if (status === 'running' && stage !== 'preview-mcp' && stage !== 'deploy-mcp') {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 py-2">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-600 border-t-zinc-300" />
          <span className="text-sm text-muted-foreground">
            Running...
          </span>
        </div>
        {children}
      </div>
    )
  }

  return <>{children}</>
}

function PlaceholderPanel({ label }: { label: string }) {
  return (
    <Card className="border-dashed">
      <CardContent>
        <p className="py-6 text-center text-sm text-muted-foreground">
          {label} will appear here once this stage runs.
        </p>
      </CardContent>
    </Card>
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
