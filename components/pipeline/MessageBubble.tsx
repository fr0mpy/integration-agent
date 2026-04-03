// Renders a single chat message — dispatches to reasoning blocks, text, step dividers, or tool call cards
import type { UIMessage } from 'ai'
import { ReasoningBlock } from './ReasoningBlock'
import { ChatToolCall } from './ChatToolCall'
import type { ToolState } from './ChatToolCall'

export function MessageBubble({ message }: { message: UIMessage }) {
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
      {/* Each message part renders as its own block — reasoning, text, step dividers, or tool calls */}
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

          // Tool call parts — strip the 'tool-' prefix and delegate to ChatToolCall
          case 'tool-listTools':
          case 'tool-readTool':
          case 'tool-callTool': {
            const toolName = part.type.replace('tool-', '')
            const state = part.state as ToolState
            return (
              <ChatToolCall
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
