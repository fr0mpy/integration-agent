import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import { Badge } from '@/components/ui/badge'
import { methodColors } from '@/lib/ui/badges'
import { cn } from '@/lib/utils'
import { ChevronRight } from 'lucide-react'
import type { MCPToolDefinition } from '@/lib/mcp/types'

export function ToolCard({ tool }: { tool: MCPToolDefinition }) {
  const colors = methodColors[tool.httpMethod] ?? ''
  const requiredParams = tool.inputSchema.required
  const allParams = Object.entries(tool.inputSchema.properties)

  return (
    <Collapsible defaultOpen={false} className="rounded-lg border border-zinc-800 bg-zinc-950">
      <CollapsibleTrigger className="flex w-full cursor-pointer items-center gap-2 px-4 py-3 text-left hover:bg-zinc-900/50 transition-colors [&[data-panel-open]>svg]:rotate-90">
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200" />
        <Badge variant="outline" className={cn('font-mono text-[10px]', colors)}>
          {tool.httpMethod}
        </Badge>
        <span className="text-sm font-mono font-medium text-zinc-200 truncate">{tool.name}</span>
        <span className="text-xs font-mono text-muted-foreground truncate ml-auto">{tool.httpPath}</span>
        {tool.authRequired && (
          <Badge variant="outline" className="text-[9px] bg-sky-500/10 text-sky-400 border-sky-500/20 shrink-0">
            Auth
          </Badge>
        )}
      </CollapsibleTrigger>

      <CollapsibleContent className="px-4 pb-4 pt-1 space-y-3 border-t border-zinc-800">
        <p className="text-sm text-zinc-300">{tool.description}</p>

        {allParams.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Parameters</p>
            <div className="space-y-1">
              {allParams.map(([name, prop]) => (
                <div key={name} className="flex items-baseline gap-2 text-xs">
                  <code className="text-zinc-300">{name}</code>
                  <span className="text-muted-foreground">{prop.type}</span>
                  {requiredParams.includes(name) && (
                    <Badge variant="outline" className="text-[9px] bg-amber-500/10 text-amber-400 border-amber-500/20">
                      required
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}
