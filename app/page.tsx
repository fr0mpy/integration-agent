import Link from 'next/link';
import { cacheLife, cacheTag } from 'next/cache';
import { SpecInput } from '@/components/SpecInput';
import { listIntegrations, type IntegrationSummary } from '@/lib/storage/neon';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { RelativeTime } from '@/components/RelativeTime';

async function getCachedIntegrations() {
  'use cache'
  cacheLife('minutes')
  cacheTag('integrations')
  return listIntegrations(10)
}

export default async function Home() {
  const integrations = await getCachedIntegrations();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-16">
      <div className="w-full max-w-2xl space-y-10">
        <div className="space-y-3 text-center">
          <h1 className="text-4xl font-bold tracking-tight">
            Integration Agent
          </h1>
          <br />
          <p className="text-lg text-zinc-400">
            Pass in an OpenAPI spec URL and get a secure, audited, MCP server
            deployed on Vercel, in minutes.
          </p>
        </div>

        <SpecInput />

        {integrations.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-medium text-muted-foreground">
              Recent pipelines
            </h2>
            <div className="space-y-1.5">
              {integrations.map((integration) => (
                <IntegrationRow
                  key={integration.id}
                  integration={integration}
                />
              ))}
            </div>
          </div>
        )}

      </div>
    </main>
  );
}

function statusInfo(integration: IntegrationSummary): {
  label: string;
  className: string;
  pulse: boolean;
} {
  switch (integration.status) {
    case 'pending':
    case 'synthesising':
      return {
        label: 'Awaiting deployment',
        className: 'border-amber-500/50 text-amber-400',
        pulse: true,
      };
    case 'deploying':
      return {
        label: 'Deploying',
        className: 'border-blue-500/50 text-blue-400',
        pulse: true,
      };
    case 'validating':
      return {
        label: 'Validating',
        className: 'border-blue-500/50 text-blue-400',
        pulse: true,
      };
    case 'live':
      return {
        label: 'Deployed',
        className: 'border-emerald-500/40 text-emerald-400',
        pulse: false,
      };
    case 'failed':
      return {
        label: 'Failed',
        className: 'border-red-500/40 text-red-400',
        pulse: false,
      };
    default:
      return {
        label: 'In progress',
        className: 'border-zinc-500/40 text-zinc-400',
        pulse: false,
      };
  }
}

function parseSpecUrl(url: string | null): {
  host: string | null;
  path: string | null;
} {
  if (!url) return { host: null, path: null };

  try {
    const u = new URL(url);
    return { host: u.hostname, path: u.pathname === '/' ? null : u.pathname };
  } catch {
    return { host: url, path: null };
  }
}

function IntegrationRow({ integration }: { integration: IntegrationSummary }) {
  const href = `/integrate/${integration.id}`;
  const { label, className, pulse } = statusInfo(integration);
  const { host, path } = parseSpecUrl(integration.spec_url);
  const shortId = integration.id.slice(0, 8);

  return (
    <Card className="transition-colors hover:bg-zinc-800/50">
      <CardContent className="flex items-center gap-3 px-4 py-2.5">
        <Link href={href} className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-zinc-200">
            {host ?? 'Unknown source'}
          </span>
          <span className="block truncate font-mono text-xs text-muted-foreground">
            {path ? `${path} · ${shortId}` : shortId}
          </span>
        </Link>

        <span className="shrink-0 text-xs text-muted-foreground">
          <RelativeTime date={integration.created_at} />
        </span>

        <Badge
          variant="outline"
          className={`shrink-0 text-[10px] ${className} ${pulse ? 'animate-pulse' : ''}`}
        >
          {label}
        </Badge>
      </CardContent>
    </Card>
  );
}
