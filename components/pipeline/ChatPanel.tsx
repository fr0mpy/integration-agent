// Interactive chat panel — Sonnet with tool use against the live sandbox MCP server
'use client'

import { useRef, useEffect, useState } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from 'ai'
import { cn } from '@/lib/utils'
import { MessageBubble } from './MessageBubble'

interface ChatPanelProps {
  integrationId: string
  sandboxUrl: string | null
  validatedAt?: string | null
  sandboxBuilding?: boolean
}

// ── Main panel ────────────────────────────────────────────────────────────────

const SUGGESTIONS = [
  'List all the available tools',
  'Explain how authentication works in this server',
  'Walk me through what happens when a tool is called',
]

export function ChatPanel({ integrationId, sandboxUrl, validatedAt: _validatedAt, sandboxBuilding }: ChatPanelProps) {
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  // useChat ignores transport prop changes after mount (transport is readonly in AbstractChat).
  // Keep sandboxUrl in a ref so the body function always sends the current value at request time.
  const sandboxUrlRef = useRef<string | null>(sandboxUrl)
  const integrationIdRef = useRef(integrationId)

  useEffect(() => {
    sandboxUrlRef.current = sandboxUrl
  }, [sandboxUrl])

  useEffect(() => {
    integrationIdRef.current = integrationId
  }, [integrationId])

  /* eslint-disable react-hooks/refs -- refs are only read inside the body() callback at request time, not during init */
  const [transport] = useState(
    () => new DefaultChatTransport({
      api: '/api/validate/chat',
      body: () => ({ integrationId: integrationIdRef.current, sandboxUrl: sandboxUrlRef.current }),
    }),
  )
  /* eslint-enable react-hooks/refs */

  const { messages, sendMessage, status } = useChat({
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
  })

  const isStreaming = status === 'streaming' || status === 'submitted'

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  function handleSubmit(text: string) {
    const trimmed = text.trim()
    if (!trimmed || isStreaming) return
    sendMessage({ text: trimmed })
    setInput('')
  }

  return (
    <div className={cn(
      'flex h-130 flex-col overflow-hidden rounded-lg border border-border bg-zinc-950 transition-all duration-300',
      sandboxBuilding && 'pointer-events-none select-none blur-sm opacity-50'
    )}>
      {/* Header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5">
        <span className="text-xs font-medium text-zinc-300">MCP Inspector</span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <div className="space-y-2">
            <p className="text-xs text-zinc-500">Ask anything about this MCP server.</p>
            <div className="flex flex-col gap-1.5 pt-1">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => handleSubmit(s)}
                  disabled={sandboxBuilding}
                  className="rounded-md border border-zinc-700/50 bg-zinc-900/50 px-3 py-2 text-left text-xs text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {isStreaming && messages[messages.length - 1]?.role === 'user' && (
          <div className="mb-4 flex items-center gap-2 text-xs text-zinc-500">
            <span className="animate-pulse">●</span>
            <span>Thinking…</span>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-border p-3">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            handleSubmit(input)
          }}
          className="flex items-end gap-2"
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSubmit(input)
              }
            }}
            placeholder="Ask about a tool, call a live endpoint…"
            rows={2}
            disabled={isStreaming || sandboxBuilding}
            className="flex-1 resize-none rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-zinc-500 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!input.trim() || isStreaming || sandboxBuilding}
            className="shrink-0 rounded-md bg-zinc-700 px-3 py-2 text-xs text-zinc-200 transition-colors hover:bg-zinc-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isStreaming ? '…' : 'Send'}
          </button>
        </form>
      </div>
    </div>
  )
}
