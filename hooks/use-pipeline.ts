// SSE client hook — streams pipeline events in real-time, reconnects with lastIndex, falls back to DB polling
'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { PipelineEvent, PipelineStage, ValidateEventData, DeployEventData, AuditEventData, AuditFinding } from '@/lib/pipeline/events'
import type { DiscoveryResult } from '@/lib/pipeline/discover'
import type { MCPToolDefinition, MCPServerConfig } from '@/lib/mcp/types'
import { config } from '@/lib/config'

export interface PipelineState {
  currentStage: PipelineStage | null
  stageStatus: Record<PipelineStage, 'pending' | 'running' | 'complete' | 'failed'>
  discovery: DiscoveryResult | null
  tools: MCPToolDefinition[]
  config: MCPServerConfig | null
  /** Generated MCP server TypeScript source — available after codegen */
  sourceCode: string | null
  /** Streaming build log lines from the sandbox VM */
  buildLog: string[]
  /** True while a build-error retry is in-flight */
  buildRetrying: boolean
  /** The raw build error that triggered the retry */
  buildErrors: string | null
  /** Verified tool names returned by the live MCP server in the sandbox */
  verifiedTools: string[]
  /** Live sandbox URL — available after validate completes */
  sandboxUrl: string | null
  error: string | null
  connected: boolean
  // audit-mcp stage
  auditFindings: AuditFinding[]
  auditSummary: { pass: number; warn: number; fail: number } | null
  auditBlocked: boolean
  // manual trigger gates
  awaitingBuildTrigger: boolean
  awaitingAuditTrigger: boolean
  // deploy-mcp stage
  deployStep: DeployEventData['step'] | null
  deployPrUrl: string | null
  deployPrTitle: string | null
  deployRepoUrl: string | null
  deployRepoName: string | null
  deployWaitMessage: string | null
  deployPrStatus: 'open' | 'merged' | null
  deployBuildLog: string[]
  deployMcpUrl: string | null
  deploymentId: string | null
}

const INITIAL_STAGE_STATUS: PipelineState['stageStatus'] = {
  'discover-api': 'pending',
  'build-mcp': 'pending',
  'preview-mcp': 'pending',
  'audit-mcp': 'pending',
  'deploy-mcp': 'pending',
}


export function usePipeline(integrationId: string, cached = false): PipelineState & { setStageRunning: (stage: PipelineStage) => void } {
  const [state, setState] = useState<PipelineState>({
    currentStage: null,
    stageStatus: { ...INITIAL_STAGE_STATUS },
    discovery: null,
    tools: [],
    config: null,
    sourceCode: null,
    buildLog: [],
    buildRetrying: false,
    buildErrors: null,
    verifiedTools: [],
    sandboxUrl: null,
    error: null,
    connected: false,
    auditFindings: [],
    auditSummary: null,
    auditBlocked: false,
    awaitingBuildTrigger: false,
    awaitingAuditTrigger: false,
    deployStep: null,
    deployPrUrl: null,
    deployPrTitle: null,
    deployRepoUrl: null,
    deployRepoName: null,
    deployWaitMessage: null,
    deployPrStatus: null,
    deployBuildLog: [],
    deployMcpUrl: null,
    deploymentId: null,
  })

  // Fetch cached config directly (no SSE)
  useEffect(() => {
    if (!cached) return

    async function fetchCached() {
      try {
        const res = await fetch(`/api/pipeline/${integrationId}?cached=true`)
        if (!res.ok) throw new Error('Failed to load cached config.')
        const { config, discovery } = await res.json()
        setState((prev) => ({
          ...prev,
          config,
          discovery: discovery ?? null,
          tools: config.tools ?? [],
          verifiedTools: (config.tools ?? []).map((t: MCPToolDefinition) => t.name),
          currentStage: null,  // don't trigger auto-advance for cached loads
          connected: true,
          stageStatus: {
            ...prev.stageStatus,
            'discover-api': 'complete',
            'build-mcp': 'complete',
            'preview-mcp': 'complete',
          },
        }))
      } catch {
        setState((prev) => ({
          ...prev,
          error: 'Failed to load cached config.',
        }))
      }
    }

    fetchCached()
  }, [integrationId, cached])

  // SSE connection state — refs avoid re-renders and persist across reconnections
  const lastIndexRef = useRef(-1)       // tracks last received event index for reconnect offset
  const retriesRef = useRef(0)          // exponential backoff counter
  const receivedEventRef = useRef(false) // distinguishes timeout from slow start
  const terminalRef = useRef(false)     // stops reconnection after pipeline completes or fails
  const fallbackRef = useRef(false)     // triggers DB polling when SSE dies during deploy

  const handleEvent = useCallback((event: PipelineEvent) => {
    receivedEventRef.current = true
    setState((prev) => {
      const next = { ...prev }
      next.stageStatus = { ...prev.stageStatus }

      if (event.status === 'awaiting-trigger') {
        // Pipeline paused — signal UI to show the appropriate trigger button
        // Reset terminal flag so SSE reconnects while waiting for re-trigger
        terminalRef.current = false

        if (event.stage === 'build-mcp') {
          next.awaitingBuildTrigger = true
        } else {
          next.awaitingAuditTrigger = true
        }
      } else if (event.status === 'running') {
        next.currentStage = event.stage
        next.stageStatus[event.stage] = 'running'

        // Clear awaiting flags when next stage starts
        if (event.stage === 'preview-mcp') {
          next.awaitingBuildTrigger = false
        }

        if (event.stage === 'audit-mcp') {
          next.awaitingAuditTrigger = false
          // Clear previous audit results so UI resets on re-run
          next.auditFindings = []
          next.auditSummary = null
          next.auditBlocked = false
          next.error = null
        }

        // preview-mcp 'running' event carries the generated source code
        if (event.stage === 'preview-mcp' && event.data) {
          const d = event.data as ValidateEventData
          if (d.sourceCode) next.sourceCode = d.sourceCode
          next.buildRetrying = false
        }

        if (event.stage === 'deploy-mcp' && event.data) {
          const d = event.data as DeployEventData
          if (d.step !== undefined) next.deployStep = d.step
          if (d.prUrl) next.deployPrUrl = d.prUrl
          if (d.prTitle) next.deployPrTitle = d.prTitle
          if (d.repoUrl) next.deployRepoUrl = d.repoUrl
          if (d.repoName) next.deployRepoName = d.repoName
          if (d.prStatus) next.deployPrStatus = d.prStatus
          if (d.waitMessage) next.deployWaitMessage = d.waitMessage
        }
      } else if (event.status === 'building') {
        if (event.stage === 'preview-mcp' && event.data) {
          const d = event.data as ValidateEventData
          if (d.buildLog) next.buildLog = [...prev.buildLog, d.buildLog]
        }

        if (event.stage === 'deploy-mcp' && event.data) {
          const d = event.data as DeployEventData
          if (d.buildLog) next.deployBuildLog = [...prev.deployBuildLog, d.buildLog]
        }
      } else if (event.status === 'complete') {
        next.stageStatus[event.stage] = 'complete'

        if (event.stage === 'discover-api' && event.data) {
          next.discovery = event.data as DiscoveryResult
        } else if (event.stage === 'build-mcp' && event.data) {
          next.config = event.data as MCPServerConfig
        } else if (event.stage === 'preview-mcp' && event.data) {
          const d = event.data as ValidateEventData
          if (d.verifiedTools) next.verifiedTools = d.verifiedTools
          if (d.sandboxUrl) next.sandboxUrl = d.sandboxUrl
        } else if (event.stage === 'audit-mcp' && event.data) {
          const d = event.data as AuditEventData
          if (d.summary) next.auditSummary = d.summary
          if (d.blocked) next.auditBlocked = true
        } else if (event.stage === 'deploy-mcp' && event.data) {
          const d = event.data as DeployEventData
          if (d.step !== undefined) next.deployStep = d.step
          if (d.mcpUrl) next.deployMcpUrl = d.mcpUrl
          if (d.deploymentId) next.deploymentId = d.deploymentId
          if (d.prUrl) next.deployPrUrl = d.prUrl
          if (d.repoUrl) next.deployRepoUrl = d.repoUrl
        }
      } else if (event.status === 'finding' && event.stage === 'audit-mcp' && event.data) {
        const d = event.data as AuditEventData

        if (d.finding) {
          next.auditFindings = [...prev.auditFindings, d.finding]
        }
      } else if (event.status === 'tool_complete' && event.data) {
        next.tools = [...prev.tools, event.data as MCPToolDefinition]
      } else if (event.status === 'retrying') {
        if (event.stage === 'preview-mcp' && event.data) {
          const d = event.data as ValidateEventData
          next.buildRetrying = true
          next.buildErrors = d.errors ?? null
          next.buildLog = []
        }
      } else if (event.status === 'done') {
        terminalRef.current = true
      } else if (event.status === 'failed') {
        next.stageStatus[event.stage] = 'failed'

        if (event.stage === 'audit-mcp' && event.data) {
          const d = event.data as AuditEventData
          if (d.summary) next.auditSummary = d.summary
          next.auditBlocked = true
        }

        const errorData = event.data as { error?: string; errors?: string } | null
        next.error = errorData?.error ?? errorData?.errors ?? 'Pipeline failed'

        // Audit failures aren't terminal — the workflow stays alive for re-triggers
        if (event.stage !== 'audit-mcp') {
          terminalRef.current = true
        }
      }

      return next
    })
  }, [])

  useEffect(() => {
    if (cached) return

    let eventSource: EventSource | null = null
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    // Open SSE connection — includes lastIndex param on reconnect so server only sends unseen events
    function connect() {
      const url = lastIndexRef.current >= 0
        ? `/api/pipeline/${integrationId}?lastIndex=${lastIndexRef.current}`
        : `/api/pipeline/${integrationId}`

      eventSource = new EventSource(url)

      timeoutId = setTimeout(() => {
        if (!receivedEventRef.current && eventSource) {
          eventSource.close()
          setState((prev) => ({
            ...prev,
            connected: false,
            error: 'Pipeline connection timed out. The workflow may not have started.',
          }))
        }
      }, config.sse.connectionTimeoutMs)

      eventSource.onopen = () => {
        setState((prev) => ({ ...prev, connected: true }))
      }

      eventSource.onmessage = (msg) => {
        if (timeoutId) {
          clearTimeout(timeoutId)
          timeoutId = null
        }

        try {
          const event = JSON.parse(msg.data) as PipelineEvent
          lastIndexRef.current++

          if (event.status !== 'failed') {
            retriesRef.current = 0
          }

          handleEvent(event)
        } catch (err) {
          if (!(err instanceof SyntaxError)) {
            console.warn('Pipeline event handling error:', err)
          }
        }
      }

      // On disconnect: exponential backoff reconnect, or switch to DB polling during deploy
      eventSource.onerror = () => {
        eventSource?.close()

        if (timeoutId) {
          clearTimeout(timeoutId)
          timeoutId = null
        }

        if (terminalRef.current) {
          setState((prev) => ({ ...prev, connected: false }))
          return
        }

        retriesRef.current++

        if (retriesRef.current > config.sse.maxRetries) {
          setState((prev) => {
            // If we're in the deploy stage, start DB fallback polling instead of giving up
            if (prev.stageStatus['deploy-mcp'] === 'running') {
              fallbackRef.current = true
              return { ...prev, connected: false }
            }

            return {
              ...prev,
              connected: false,
              error: prev.error ?? 'Lost connection to pipeline stream.',
            }
          })
          return
        }

        setState((prev) => ({ ...prev, connected: false }))

        const delay = Math.min(1000 * Math.pow(2, retriesRef.current - 1), 5000)
        setTimeout(connect, delay)
      }
    }

    connect()

    return () => {
      eventSource?.close()
      if (timeoutId) clearTimeout(timeoutId)
    }
  }, [integrationId, cached, handleEvent])

  // Fallback: poll DB for deployment status when SSE dies during deploy stage
  useEffect(() => {
    if (cached || !fallbackRef.current) return

    const FALLBACK_POLL_MS = 10_000
    const intervalId = setInterval(async () => {
      if (!fallbackRef.current) {
        clearInterval(intervalId)
        return
      }

      try {
        const res = await fetch(`/api/integrate/${integrationId}/status`)
        if (!res.ok) return

        const data = await res.json() as { status: string; mcp_url: string | null; deployment_id: string | null }

        if (data.mcp_url) {
          fallbackRef.current = false
          clearInterval(intervalId)
          setState((prev) => ({
            ...prev,
            stageStatus: { ...prev.stageStatus, 'deploy-mcp': 'complete' },
            deployStep: 'live',
            deployMcpUrl: data.mcp_url,
            deploymentId: data.deployment_id,
            error: null,
          }))
        }
      } catch (err) {
        console.warn('Status polling error:', err instanceof Error ? err.message : 'unknown')
      }
    }, FALLBACK_POLL_MS)

    return () => clearInterval(intervalId)
  }, [integrationId, cached, state.stageStatus])

  // Optimistic UI update — marks a stage as running before the SSE event arrives
  const setStageRunning = useCallback((stage: PipelineStage) => {
    setState((prev) => ({
      ...prev,
      stageStatus: { ...prev.stageStatus, [stage]: 'running' },
      // Immediately flush old audit UI so stale results don't flash
      ...(stage === 'audit-mcp' && {
        auditFindings: [],
        auditSummary: null,
        auditBlocked: false,
        error: null,
      }),
    }))
  }, [])

  return { ...state, setStageRunning }
}
