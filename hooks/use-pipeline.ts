'use client'

import { useState, useEffect } from 'react'

export function usePipeline<T>(integrationId: string) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function run() {
      try {
        const res = await fetch(`/api/pipeline/${integrationId}`)

        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || `Request failed (${res.status})`)
        }

        const json = await res.json()

        if (!cancelled) setData(json as T)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Something went wrong.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    run()

    return () => { cancelled = true }
  }, [integrationId])

  return { data, loading, error }
}
