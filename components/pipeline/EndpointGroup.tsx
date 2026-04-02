'use client'

import { useState } from 'react'
import { Card } from '@/components/ui/card'
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@/components/ui/collapsible'
import { EndpointRow } from './EndpointRow'
import type { DiscoveredEndpoint } from '@/lib/pipeline/discover'

export function EndpointGroup({
  name,
  endpoints,
}: {
  name: string
  endpoints: DiscoveredEndpoint[]
}) {
  const [open, setOpen] = useState(true)

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card size="sm">
        <CollapsibleTrigger className="flex w-full cursor-pointer items-center justify-between px-4 py-2 text-left">
          <span className="font-medium">/{name}</span>
          <span className="text-xs text-muted-foreground">
            {endpoints.length} endpoint{endpoints.length !== 1 ? 's' : ''}
            {open ? ' \u25B4' : ' \u25BE'}
          </span>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="divide-y divide-border">
            {endpoints.map((ep) => (
              <EndpointRow key={`${ep.method}:${ep.path}`} endpoint={ep} />
            ))}
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  )
}
