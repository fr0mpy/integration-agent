'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { config } from '@/lib/config'

interface SandboxReadyEvent {
  type: 'ready'
  sandboxUrl: string
  sandboxId: string
}

interface SandboxLogEvent {
  type: 'log'
  message: string
}

interface SandboxErrorEvent {
  type: 'error'
  message: string
}

type SandboxEvent = SandboxReadyEvent | SandboxLogEvent | SandboxErrorEvent

export interface UseSandboxReturn {
  /** Live sandbox URL — null while spinning or if failed */
  sandboxUrl: string | null
  /** Sandbox VM ID — null while spinning or if failed */
  sandboxId: string | null
  /** True while a sandbox is being created */
  isSpinning: boolean
  /** Build log lines from the current spin-up */
  buildLog: string[]
  /** Error message if spin-up failed */
  error: string | null
  /** Trigger a new sandbox spin-up */
  spinUp: () => void
}

/**
 * Manages on-demand sandbox lifecycle for the Preview MCP tab.
 *
 * - When `active` becomes true, checks if the existing sandbox is alive
 *   by POSTing to the sandbox route (which does a health check first).
 * - Streams ndjson build logs during spin-up.
 * - Returns the live sandbox URL once ready.
 */
export function useSandbox(
  integrationId: string,
  initialSandboxUrl: string | null,
  active: boolean,
): UseSandboxReturn {
  const [sandboxUrl, setSandboxUrl] = useState<string | null>(initialSandboxUrl)
  const [sandboxId, setSandboxId] = useState<string | null>(null)
  const [isSpinning, setIsSpinning] = useState(false)
  const [buildLog, setBuildLog] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const hasTriedRef = useRef(false)
  const currentUrlRef = useRef<string | null>(initialSandboxUrl)

  const spinUp = useCallback(async () => {
    // Abort any in-flight request
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setIsSpinning(true)
    setBuildLog([])
    setError(null)
    setSandboxUrl(null)

    try {
      const res = await fetch(`/api/integrate/${integrationId}/sandbox`, {
        method: 'POST',
        signal: controller.signal,
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        // 503 = race condition (sandbox URL not yet persisted) — retry once after a brief wait
        if (res.status === 503 && !controller.signal.aborted) {
          await new Promise((r) => setTimeout(r, config.ui.sandboxRetryMs))
          const retry = await fetch(`/api/integrate/${integrationId}/sandbox`, {
            method: 'POST',
            signal: controller.signal,
          })
          if (retry.ok) {
            const retryData = await retry.json() as SandboxReadyEvent
            setSandboxUrl(retryData.sandboxUrl)
            setSandboxId(retryData.sandboxId)
            setBuildLog(['Sandbox reconnected after brief wait'])
            setIsSpinning(false)
            return
          }
        }
        throw new Error(data.error ?? `Sandbox request failed (${res.status})`)
      }

      const contentType = res.headers.get('content-type') ?? ''

      // Fast path: existing sandbox still alive — JSON response
      if (contentType.includes('application/json')) {
        const data = await res.json() as SandboxReadyEvent
        setSandboxUrl(data.sandboxUrl)
        setSandboxId(data.sandboxId)
        setBuildLog(['Sandbox still active — reconnected'])
        setIsSpinning(false)
        return
      }

      // Streaming path: ndjson
      const reader = res.body?.getReader()
      if (!reader) throw new Error('No response body')

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.trim()) continue

          try {
            const event = JSON.parse(line) as SandboxEvent

            if (event.type === 'log') {
              setBuildLog((prev) => [...prev, event.message])
            } else if (event.type === 'ready') {
              setSandboxUrl(event.sandboxUrl)
              setSandboxId(event.sandboxId)
            } else if (event.type === 'error') {
              setError(event.message)
            }
          } catch {
            // Skip malformed lines
          }
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      setError(err instanceof Error ? err.message : 'Sandbox spin-up failed')
    } finally {
      if (!controller.signal.aborted) {
        setIsSpinning(false)
      }
    }
  }, [integrationId])

  // Keep ref in sync so the delayed spinUp check can read the latest value
  useEffect(() => {
    currentUrlRef.current = sandboxUrl
  }, [sandboxUrl])

  // Sync with pipeline sandbox URL — when SSE delivers the URL after mount,
  // reflect it immediately so chat and UI have the live sandbox.
  useEffect(() => {
    if (initialSandboxUrl) {
      setSandboxUrl(initialSandboxUrl)
      setError(null)
    }
  }, [initialSandboxUrl])

  // Auto-spin when tab becomes active — but skip if pipeline sandbox is available.
  // Uses a brief delay before spinning up to let SSE deliver the pipeline URL first.
  useEffect(() => {
    if (!active) {
      hasTriedRef.current = false
      return
    }

    if (hasTriedRef.current) return
    hasTriedRef.current = true

    if (initialSandboxUrl) {
      setSandboxUrl(initialSandboxUrl)
      return
    }

    // Delay: give SSE time to deliver the pipeline sandbox URL before falling back to on-demand spin-up
    const timer = setTimeout(() => {
      if (!currentUrlRef.current) {
        spinUp()
      }
    }, config.ui.sandboxFallbackDelayMs)

    return () => {
      clearTimeout(timer)
      abortRef.current?.abort()
    }
  }, [active, initialSandboxUrl, spinUp])

  return { sandboxUrl, sandboxId, isSpinning, buildLog, error, spinUp }
}
