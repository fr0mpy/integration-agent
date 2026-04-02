import { cn } from '@/lib/utils'

export type ToolState = 'input-streaming' | 'input-available' | 'output-available' | 'output-error'

export function ChatToolCall({
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
