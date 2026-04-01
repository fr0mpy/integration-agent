'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { PipelineEvent, PipelineStage, ValidateEventData, DeployEventData } from '@/lib/pipeline/events'
import type { DiscoveryResult } from '@/lib/pipeline/discover'
import type { MCPToolDefinition, MCPServerConfig } from '@/lib/mcp/types'

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
  'deploy-mcp': 'pending',
  'health-check': 'pending',
}

const MAX_RETRIES = 3
const CONNECTION_TIMEOUT_MS = 15_000

export function usePipeline(integrationId: string, cached = false): PipelineState {
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

  const lastIndexRef = useRef(-1)
  const retriesRef = useRef(0)
  const receivedEventRef = useRef(false)
  const terminalRef = useRef(false)

  const handleEvent = useCallback((event: PipelineEvent) => {
    receivedEventRef.current = true
    setState((prev) => {
      const next = { ...prev }
      next.stageStatus = { ...prev.stageStatus }

      if (event.status === 'running') {
        next.currentStage = event.stage
        next.stageStatus[event.stage] = 'running'

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
        } else if (event.stage === 'deploy-mcp' && event.data) {
          const d = event.data as DeployEventData
          if (d.step !== undefined) next.deployStep = d.step
          if (d.mcpUrl) next.deployMcpUrl = d.mcpUrl
          if (d.deploymentId) next.deploymentId = d.deploymentId
          if (d.prUrl) next.deployPrUrl = d.prUrl
          if (d.repoUrl) next.deployRepoUrl = d.repoUrl
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
        const errorData = event.data as { error?: string; errors?: string } | null
        next.error = errorData?.error ?? errorData?.errors ?? 'Pipeline failed'
        terminalRef.current = true
      }

      return next
    })
  }, [])

  useEffect(() => {
    if (cached) return

    let eventSource: EventSource | null = null
    let timeoutId: ReturnType<typeof setTimeout> | null = null

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
      }, CONNECTION_TIMEOUT_MS)

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

        if (retriesRef.current > MAX_RETRIES) {
          setState((prev) => ({
            ...prev,
            connected: false,
            error: prev.error ?? 'Lost connection to pipeline stream.',
          }))
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

  return state
}
