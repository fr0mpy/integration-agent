import { Badge } from '@/components/ui/badge'
import { methodColors } from '@/lib/ui/badges'
import { cn } from '@/lib/utils'
import type { DiscoveredEndpoint } from '@/lib/pipeline/discover'

export function EndpointRow({ endpoint }: { endpoint: DiscoveredEndpoint }) {
  const colors = methodColors[endpoint.method] ?? ''

  return (
    <div className="flex items-start gap-3 px-4 py-2.5">
      <Badge
        variant="outline"
        className={cn('mt-0.5 shrink-0 font-mono text-[10px]', colors)}
      >
        {endpoint.method}
      </Badge>

      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-sm">{endpoint.path}</p>

        {endpoint.summary && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {endpoint.summary}
          </p>
        )}
      </div>

      {endpoint.operationId && (
        <code className="hidden shrink-0 text-xs text-muted-foreground sm:block">
          {endpoint.operationId}
        </code>
      )}
    </div>
  )
}
