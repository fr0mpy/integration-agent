'use client'

import { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { config } from '@/lib/config'

export function ReasoningBlock({ text, streaming }: { text: string; streaming: boolean }) {
  const [expanded, setExpanded] = useState(true)

  // Collapse when streaming finishes
  useEffect(() => {
    if (!streaming) {
      const t = setTimeout(() => setExpanded(false), config.ui.reasoningCollapseMs)
      return () => clearTimeout(t)
    }
  }, [streaming])

  return (
    <div className="mb-2 rounded-md border border-amber-500/20 bg-amber-950/20">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <span className={cn('text-xs', streaming && 'animate-pulse')}>
          {streaming ? '●' : expanded ? '▾' : '▸'}
        </span>
        <span className="text-xs font-medium text-amber-400">
          {streaming ? 'Thinking…' : 'Reasoning'}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-200/70 whitespace-pre-wrap">
          {text}
        </div>
      )}
    </div>
  )
}
