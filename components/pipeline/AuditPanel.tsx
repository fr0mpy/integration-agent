import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { AuditFinding } from '@/lib/pipeline/events'

interface AuditPanelProps {
  findings: AuditFinding[]
  summary: { pass: number; warn: number; fail: number } | null
  blocked: boolean
  status: 'pending' | 'running' | 'complete' | 'failed'
}

const SEVERITY_STYLES = {
  pass: {
    border: 'border-l-emerald-500',
    badge: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
    label: 'PASS',
  },
  warn: {
    border: 'border-l-amber-500',
    badge: 'bg-amber-500/15 text-amber-400 border-amber-500/25',
    label: 'WARN',
  },
  fail: {
    border: 'border-l-red-500',
    badge: 'bg-red-500/15 text-red-400 border-red-500/25',
    label: 'FAIL',
  },
} as const

const SEVERITY_ORDER: Record<string, number> = { fail: 0, warn: 1, pass: 2 }

export function AuditPanel({ findings, summary, blocked, status }: AuditPanelProps) {
  const sorted = [...findings].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9),
  )

  return (
    <div className="space-y-4">
      {/* Blocked banner */}
      {blocked && (
        <Card className="border-red-500/25 bg-red-500/5">
          <CardHeader>
            <CardTitle className="text-sm text-red-400">
              Deployment blocked — critical security issues found
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-red-300/80">
              {sorted.filter((f) => f.severity === 'fail').length} critical finding(s) must be
              resolved before this MCP server can be deployed. Re-run the pipeline with a
              corrected spec or adjusted configuration.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Summary bar */}
      {summary && (
        <div className="flex items-center gap-3">
          <span className="text-sm text-zinc-400">Security audit</span>
          <div className="flex items-center gap-2">
            {summary.fail > 0 && (
              <Badge variant="outline" className={SEVERITY_STYLES.fail.badge}>
                {summary.fail} critical
              </Badge>
            )}
            {summary.warn > 0 && (
              <Badge variant="outline" className={SEVERITY_STYLES.warn.badge}>
                {summary.warn} warning{summary.warn !== 1 ? 's' : ''}
              </Badge>
            )}
            {summary.pass > 0 && (
              <Badge variant="outline" className={SEVERITY_STYLES.pass.badge}>
                {summary.pass} passed
              </Badge>
            )}
          </div>
        </div>
      )}

      {/* Running indicator */}
      {status === 'running' && !summary && (
        <div className="flex items-center gap-3 py-2">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-600 border-t-zinc-300" />
          <span className="text-sm text-muted-foreground">
            Running security audit...
          </span>
        </div>
      )}

      {/* Findings list */}
      {sorted.length > 0 && (
        <div className="space-y-2">
          {sorted.map((f) => (
            <FindingCard key={f.checkId} finding={f} />
          ))}
        </div>
      )}
    </div>
  )
}

function FindingCard({ finding }: { finding: AuditFinding }) {
  const style = SEVERITY_STYLES[finding.severity]

  return (
    <Card className={cn('border-l-4', style.border)}>
      <CardContent className="py-3">
        <div className="flex items-start gap-3">
          <Badge variant="outline" className={cn('mt-0.5 shrink-0 text-[10px] font-mono', style.badge)}>
            {style.label}
          </Badge>

          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-zinc-200">
              {finding.title}
            </p>
            <p className="mt-1 text-sm text-zinc-400">
              {finding.description}
            </p>

            {finding.tools.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {finding.tools.map((tool) => (
                  <Badge key={tool} variant="secondary" className="font-mono text-[10px]">
                    {tool}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          <code className="hidden shrink-0 text-[10px] text-zinc-600 sm:block">
            {finding.checkId}
          </code>
        </div>
      </CardContent>
    </Card>
  )
}
