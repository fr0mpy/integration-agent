'use client'

import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { authStyles } from '@/lib/ui/badges'
import type { DiscoveryResult } from '@/lib/pipeline/discover'

export function HeaderCard({ result }: { result: DiscoveryResult }) {
  const auth = authStyles[result.authMethod] ?? authStyles.none

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{result.apiName}</CardTitle>
        {result.apiDescription && (
          <CardDescription>{result.apiDescription}</CardDescription>
        )}
      </CardHeader>

      <CardContent>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline" className={auth.className}>
            {auth.label}
          </Badge>

          <Badge variant="secondary">
            {result.endpointCount} endpoint
            {result.endpointCount !== 1 ? 's' : ''}
          </Badge>

          {result.baseUrl && <Badge variant="outline">{result.baseUrl}</Badge>}
        </div>
      </CardContent>
    </Card>
  )
}
