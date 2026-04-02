import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { methodColors } from '@/lib/ui/badges'
import { cn } from '@/lib/utils'
import { ChevronRight } from 'lucide-react'
import type { MCPToolDefinition } from '@/lib/mcp/types'

export function ToolCard({
  tool,
  enabled,
  onToggle,
  showToggle = false,
}: {
  tool: MCPToolDefinition
  enabled?: boolean
  onToggle?: (name: string) => void
  showToggle?: boolean
}) {
  const colors = methodColors[tool.httpMethod] ?? ''
  const requiredParams = tool.inputSchema.required
  const allParams = Object.entries(tool.inputSchema.properties)
  const isComposed = !!tool.composedOf

  return (
    <Collapsible defaultOpen={false} className={cn(
      'rounded-lg border border-zinc-800 bg-zinc-950 transition-opacity',
      showToggle && enabled === false && 'opacity-50',
    )}>
      <CollapsibleTrigger className="flex w-full cursor-pointer items-center gap-2 px-4 py-3 text-left hover:bg-zinc-900/50 transition-colors [&[data-panel-open]>svg]:rotate-90">
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200" />
        <Badge variant="outline" className={cn('font-mono text-[10px]', colors)}>
          {tool.httpMethod}
        </Badge>
        {isComposed && (
          <Badge variant="outline" className="text-[9px] bg-violet-500/10 text-violet-400 border-violet-500/20 shrink-0">
            Composed
          </Badge>
        )}
        <span className="text-sm font-mono font-medium text-zinc-200 truncate">{tool.name}</span>
        <span className="text-xs font-mono text-muted-foreground truncate ml-auto">{tool.httpPath}</span>
        {tool.authRequired && (
          <Badge variant="outline" className="text-[9px] bg-sky-500/10 text-sky-400 border-sky-500/20 shrink-0">
            Auth
          </Badge>
        )}
        {showToggle && onToggle && (
          <Switch
            checked={enabled !== false}
            onCheckedChange={() => onToggle(tool.name)}
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
            className="shrink-0 data-checked:bg-emerald-600"
          />
        )}
      </CollapsibleTrigger>

      <CollapsibleContent className="px-4 pb-4 pt-1 space-y-3 border-t border-zinc-800">
        <p className="text-sm text-zinc-300">{tool.description}</p>

        {isComposed && tool.composedOf && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Composed endpoints</p>
            <div className="space-y-1">
              {tool.composedOf.map((sub) => (
                <div key={`${sub.httpMethod}:${sub.httpPath}`} className="flex items-baseline gap-2 text-xs">
                  <Badge variant="outline" className={cn('font-mono text-[9px]', methodColors[sub.httpMethod] ?? '')}>
                    {sub.httpMethod}
                  </Badge>
                  <code className="text-zinc-300">{sub.httpPath}</code>
                </div>
              ))}
            </div>
          </div>
        )}

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
