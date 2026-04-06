'use client'

import { useTransition, useState } from 'react'
import { clearData } from '@/app/actions'

export function ClearDataButton() {
  const [isPending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)

  function handleClick() {
    setMessage(null)
    startTransition(async () => {
      const result = await clearData()
      setMessage(result.message)
      setTimeout(() => setMessage(null), 3000)
    })
  }

  return (
    <button
      onClick={handleClick}
      disabled={isPending}
      className="text-xs text-muted-foreground underline hover:text-zinc-300 disabled:opacity-50 disabled:no-underline"
    >
      {isPending ? 'Clearing...' : message ?? 'Clear all data'}
    </button>
  )
}
