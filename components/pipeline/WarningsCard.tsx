'use client'

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'

export function WarningsCard({ warnings }: { warnings: string[] }) {
  return (
    <Card className="border-amber-500/25">
      <CardHeader>
        <CardTitle className="text-sm text-amber-400">Warnings</CardTitle>
      </CardHeader>

      <CardContent>
        <ul className="space-y-1 text-sm text-amber-300/80">
          {warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
