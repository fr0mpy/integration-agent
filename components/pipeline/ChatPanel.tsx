'use client'

import { useRef, useEffect, useState } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from 'ai'
import type { UIMessage } from 'ai'
import { cn } from '@/lib/utils'

interface ChatPanelProps {
  integrationId: string
  sandboxUrl: string | null
  validatedAt?: string | null
  sandboxBuilding?: boolean
}

// ── Reasoning block ──────────────────────────────────────────────────────────

function ReasoningBlock({ text, streaming }: { text: string; streaming: boolean }) {
  const [expanded, setExpanded] = useState(true)

  // Collapse when streaming finishes
  useEffect(() => {
    if (!streaming) {
      const t = setTimeout(() => setExpanded(false), 800)
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

// ── Tool call card ────────────────────────────────────────────────────────────

type ToolState = 'input-streaming' | 'input-available' | 'output-available' | 'output-error'

function ToolCard({
  toolName,
  state,
  input,
  output,
  errorText,
}: {
  toolName: string
  state: ToolState
  input?: unknown
  output?: unknown
  errorText?: string
}) {
  const isStreaming = state === 'input-streaming'
  const hasResult = state === 'output-available' || state === 'output-error'

  const toolLabel: Record<string, string> = {
    listTools: '📋 listTools',
    readTool: '📖 readTool',
    callTool: '⚡ callTool',
  }

  return (
    <div className="mb-2 rounded-md border border-zinc-700/50 bg-zinc-900/60 text-xs font-mono">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-zinc-700/40 px-3 py-2">
        <span className={cn('text-zinc-300', isStreaming && 'animate-pulse')}>
          {toolLabel[toolName] ?? `🔧 ${toolName}`}
        </span>
        {isStreaming && (
          <span className="text-zinc-500">···</span>
        )}
        {state === 'input-available' && !hasResult && (
          <span className="ml-auto text-zinc-500">running</span>
        )}
        {state === 'output-available' && (
          <span className="ml-auto text-emerald-400">✓ done</span>
        )}
        {state === 'output-error' && (
          <span className="ml-auto text-red-400">✗ error</span>
        )}
      </div>

      {/* Input */}
      {input != null && Object.keys(input as object).length > 0 && (
        <div className="border-b border-zinc-700/30 px-3 py-2">
          <pre className="whitespace-pre-wrap break-all text-zinc-400">
            {JSON.stringify(input, null, 2)}
          </pre>
        </div>
      )}

      {/* Output */}
      {state === 'output-available' && output != null && (
        <div className="px-3 py-2">
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all text-emerald-300/80">
            {typeof output === 'string' ? output : JSON.stringify(output, null, 2)}
          </pre>
        </div>
      )}

      {/* Error */}
      {state === 'output-error' && errorText && (
        <div className="px-3 py-2 text-red-400">{errorText}</div>
      )}
    </div>
  )
}

// ── Message renderer ──────────────────────────────────────────────────────────

function MessageBubble({ message }: { message: UIMessage }) {
  const isUser = message.role === 'user'

  if (isUser) {
    return (
      <div className="mb-4 flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-zinc-700 px-3 py-2 text-sm text-zinc-100">
          {message.parts
            .filter((p) => p.type === 'text')
            .map((p, i) => (
              <span key={i}>{p.type === 'text' ? p.text : ''}</span>
            ))}
        </div>
      </div>
    )
  }

  return (
    <div className="mb-4">
      {message.parts.map((part, i) => {
        switch (part.type) {
          case 'reasoning':
            return (
              <ReasoningBlock
                key={i}
                text={part.text}
                streaming={part.state === 'streaming'}
              />
            )

          case 'text':
            return part.text ? (
              <p key={i} className="mb-2 text-sm leading-relaxed text-zinc-200 whitespace-pre-wrap">
                {part.text}
              </p>
            ) : null

          case 'step-start':
            return i > 0 ? (
              <hr key={i} className="my-3 border-zinc-700/50" />
            ) : null

          case 'tool-listTools':
          case 'tool-readTool':
          case 'tool-callTool': {
            const toolName = part.type.replace('tool-', '')
            const state = part.state as ToolState
            return (
              <ToolCard
                key={i}
                toolName={toolName}
                state={state}
                input={'input' in part ? part.input : undefined}
                output={'output' in part ? part.output : undefined}
                errorText={'errorText' in part ? (part.errorText as string) : undefined}
              />
            )
          }

          default:
            return null
        }
      })}
    </div>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────

const SUGGESTIONS = [
  'List all the available tools',
  'Explain how authentication works in this server',
  'Walk me through what happens when a tool is called',
]

export function ChatPanel({ integrationId, sandboxUrl, validatedAt, sandboxBuilding }: ChatPanelProps) {
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/validate/chat',
      body: { integrationId, sandboxUrl },
    }),
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
      "flex h-130 flex-col overflow-hidden rounded-lg border border-border bg-zinc-950 transition-all duration-300",
      sandboxBuilding && "pointer-events-none select-none blur-sm opacity-50"
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
