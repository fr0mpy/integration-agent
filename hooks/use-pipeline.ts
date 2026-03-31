'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { PipelineEvent, PipelineStage } from '@/lib/pipeline/events'
import type { DiscoveryResult } from '@/lib/pipeline/discover'
import type { MCPToolDefinition, MCPServerConfig } from '@/lib/mcp/types'

export interface PipelineState {
  currentStage: PipelineStage | null
  stageStatus: Record<PipelineStage, 'pending' | 'running' | 'complete' | 'failed'>
  discovery: DiscoveryResult | null
  tools: MCPToolDefinition[]
  config: MCPServerConfig | null
  error: string | null
  connected: boolean
}

const INITIAL_STAGE_STATUS: PipelineState['stageStatus'] = {
  discover: 'pending',
  synthesise: 'pending',
  validate: 'pending',
  sandbox: 'pending',
  deploy: 'pending',
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
    error: null,
    connected: false,
  })

  // Fetch cached config directly (no SSE)
  useEffect(() => {
    if (!cached) return

    async function fetchCached() {
      try {
        const res = await fetch(`/api/pipeline/${integrationId}?cached=true`)
        if (!res.ok) throw new Error('Failed to load cached config.')
        const { config } = await res.json()
        setState((prev) => ({
          ...prev,
          config,
          tools: config.tools ?? [],
          connected: true,
          stageStatus: {
            ...prev.stageStatus,
            discover: 'complete',
            synthesise: 'complete',
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
      } else if (event.status === 'complete') {
        next.stageStatus[event.stage] = 'complete'

        if (event.stage === 'discover' && event.data) {
          next.discovery = event.data as DiscoveryResult
        } else if (event.stage === 'synthesise' && event.data) {
          next.config = event.data as MCPServerConfig
        }
      } else if (event.status === 'tool_complete' && event.data) {
        next.tools = [...prev.tools, event.data as MCPToolDefinition]
      } else if (event.status === 'failed') {
        next.stageStatus[event.stage] = 'failed'
        const errorData = event.data as { error: string } | null
        next.error = errorData?.error ?? 'Pipeline failed'
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

      // Timeout: if no events arrive within 15s, something is wrong
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
        // Clear timeout on first message
        if (timeoutId) {
          clearTimeout(timeoutId)
          timeoutId = null
        }

        try {
          const event = JSON.parse(msg.data) as PipelineEvent
          lastIndexRef.current++

          // Only reset retry counter for progress events, not terminal failures
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

        // Don't reconnect after a terminal failure
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

        // Reconnect with backoff
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
