'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { usePipeline } from '@/hooks/use-pipeline';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { ToolCard } from '@/components/pipeline/ToolCard';
import { StagePanel } from '@/components/pipeline/StagePanel';
import { HeaderCard } from '@/components/pipeline/HeaderCard';
import { WarningsCard } from '@/components/pipeline/WarningsCard';
import { EndpointGroup } from '@/components/pipeline/EndpointGroup';
import { ValidatePanel } from '@/components/pipeline/ValidatePanel';
import { DeployPanel } from '@/components/pipeline/DeployPanel';
import { AuditPanel } from '@/components/pipeline/AuditPanel';
import { AuditTriggerButton } from '@/components/pipeline/AuditTriggerButton';
import { BuildTriggerButton } from '@/components/pipeline/BuildTriggerButton';
import { cn } from '@/lib/utils';
import type { PipelineStage } from '@/lib/pipeline/events';

const METHOD_ORDER: Record<string, number> = {
  GET: 0,
  POST: 1,
  PUT: 2,
  PATCH: 3,
  DELETE: 4,
};

const STAGES: { key: PipelineStage; label: string }[] = [
  { key: 'discover-api', label: 'Discover API' },
  { key: 'build-mcp', label: 'Generated Tools' },
  { key: 'preview-mcp', label: 'Preview MCP' },
  { key: 'audit-mcp', label: 'Security Audit' },
  { key: 'deploy-mcp', label: 'Deploy MCP' },
];

const STATUS_ICONS: Record<string, string> = {
  complete: '\u2713',
  running: '\u25CF',
  failed: '\u2717',
};

const VALID_STAGES = new Set<string>(STAGES.map((s) => s.key));

function parseTabParam(value: string | null): PipelineStage {
  if (value && VALID_STAGES.has(value)) return value as PipelineStage;
  return 'discover-api';
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
  integrationId: string;
  cached?: boolean;
  initialSandboxUrl?: string | null;
  initialVerifiedTools?: string[];
  initialValidatedAt?: string | null;
  authMethod?: string | null;
  initialHasCredentials?: boolean;
  initialLiveValidatedAt?: string | null;
  initialPrUrl?: string | null;
  initialMcpUrl?: string | null;
  initialRepoUrl?: string | null;
}) {
  const state = usePipeline(integrationId, cached);

  const [excludedTools, setExcludedTools] = useState<Set<string>>(new Set());

  const handleToolToggle = useCallback((name: string) => {
    setExcludedTools((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const toolGroups = useMemo(() => {
    const sorted = [...state.tools].sort((a, b) => {
      const pathCmp = a.httpPath.localeCompare(b.httpPath);

      if (pathCmp !== 0) return pathCmp;

      return (
        (METHOD_ORDER[a.httpMethod] ?? 9) - (METHOD_ORDER[b.httpMethod] ?? 9)
      );
    });

    const groups: Record<string, typeof sorted> = {};

    for (const tool of sorted) {
      const root = tool.httpPath.split('/')[1] ?? 'other';
      (groups[root] ??= []).push(tool);
    }

    return groups;
  }, [state.tools]);

  const router = useRouter();
  const searchParams = useSearchParams();

  const [activeTab, setActiveTab] = useState<PipelineStage>(() =>
    parseTabParam(searchParams.get('tab')),
  );
  // Sync URL → state on popstate / external navigation
  useEffect(() => {
    const paramTab = parseTabParam(searchParams.get('tab'));

    if (paramTab !== activeTab) {
      setActiveTab(paramTab);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const isConnecting = !state.connected && !state.discovery && !state.error;

  const handleTabChange = useCallback(
    (value: unknown) => {
      const tab = value as PipelineStage;
      setActiveTab(tab);
      // Sync to URL
      const params = new URLSearchParams(searchParams.toString());
      params.set('tab', tab);
      router.replace(`?${params.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

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
    );
  }

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange}>
      <TabsList variant="line" className="w-full justify-start gap-0">
        {STAGES.map(({ key, label }) => {
          const status = state.stageStatus[key];
          const icon = STATUS_ICONS[status];
          const isPending = status === 'pending';

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
                <span
                  className={cn(
                    'text-xs',
                    status === 'running' && 'animate-pulse',
                  )}
                >
                  {icon}
                </span>
              )}
              {label}
            </TabsTrigger>
          );
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
        <StagePanel
          status={state.stageStatus['discover-api']}
          error={state.error}
          stage="discover-api"
          stageLabel="Discover API"
        >
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

                {Object.entries(state.discovery.groups).map(
                  ([group, endpoints]) => (
                    <EndpointGroup
                      key={group}
                      name={group}
                      endpoints={endpoints}
                    />
                  ),
                )}
              </div>
            </>
          )}
        </StagePanel>
      </TabsContent>

      {/* Build MCP */}
      <TabsContent value="build-mcp" className="mt-4 space-y-4">
        <StagePanel
          status={state.stageStatus['build-mcp']}
          error={state.error}
          stage="build-mcp"
          stageLabel="Generated Tools"
        >
          {state.tools.length > 0 && (
            <>
              <div className="flex items-baseline justify-between">
                <h2 className="text-lg font-medium">
                  MCP Tools ({state.tools.length}
                  {state.config ? ` / ${state.config.tools.length}` : ''})
                </h2>
                {state.awaitingBuildTrigger && (
                  <span className="text-sm text-muted-foreground">
                    {state.tools.length - excludedTools.size} of{' '}
                    {state.tools.length} selected
                  </span>
                )}
              </div>

              {state.awaitingBuildTrigger && (
                <BuildTriggerButton
                  integrationId={integrationId}
                  excludedTools={excludedTools}
                  totalTools={state.tools.length}
                />
              )}

              <div className="space-y-4">
                {Object.entries(toolGroups).map(([group, tools]) => (
                  <div key={group} className="space-y-2">
                    <h3 className="text-sm font-medium text-muted-foreground font-mono">
                      /{group}
                    </h3>
                    {tools.map((tool) => (
                      <ToolCard
                        key={tool.name}
                        tool={tool}
                        showToggle={state.awaitingBuildTrigger}
                        enabled={!excludedTools.has(tool.name)}
                        onToggle={handleToolToggle}
                      />
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
        <StagePanel
          status={state.stageStatus['preview-mcp']}
          error={state.error}
          stage="preview-mcp"
          stageLabel="Preview MCP"
        >
          {state.stageStatus['preview-mcp'] === 'complete' && (
            <AuditTriggerButton
              integrationId={integrationId}
              onTriggered={() => {
                state.setStageRunning('audit-mcp')
                handleTabChange('audit-mcp')
              }}
            />
          )}
          <ValidatePanel
            integrationId={integrationId}
            sandboxUrl={state.sandboxUrl ?? initialSandboxUrl}
            sourceCode={state.sourceCode}
            buildLog={state.buildLog}
            verifiedTools={
              state.verifiedTools.length > 0
                ? state.verifiedTools
                : initialVerifiedTools
            }
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
        <StagePanel
          status={state.stageStatus['deploy-mcp']}
          error={state.error}
          stage="deploy-mcp"
          stageLabel="Deploy MCP"
        >
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

      {/* Security Audit */}
      <TabsContent value="audit-mcp" className="mt-4">
        <StagePanel
          status={state.stageStatus['audit-mcp']}
          error={state.error}
          stage="audit-mcp"
          stageLabel="Security Audit"
        >
          {state.awaitingAuditTrigger &&
            state.stageStatus['audit-mcp'] === 'failed' && (
              <AuditTriggerButton
                integrationId={integrationId}
                onTriggered={() => {
                  state.setStageRunning('audit-mcp')
                  handleTabChange('audit-mcp')
                }}
              />
            )}
          <AuditPanel
            findings={state.auditFindings}
            summary={state.auditSummary}
            blocked={state.auditBlocked}
            status={state.stageStatus['audit-mcp']}
          />
        </StagePanel>
      </TabsContent>
    </Tabs>
  );
}

