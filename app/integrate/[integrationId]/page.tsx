import { notFound } from 'next/navigation'
import { PipelineView } from '@/components/PipelineView'
import { getIntegration, hasCredentials } from '@/lib/storage/neon'
import { configCache } from '@/lib/storage/redis'
import type { MCPServerConfig } from '@/lib/mcp/types'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function IntegrationPage({
  params,
}: {
  params: Promise<{ integrationId: string }>
}) {
  const { integrationId } = await params

  if (!UUID_RE.test(integrationId)) {
    notFound()
  }

  const [integration, credentialsExist] = await Promise.all([
    getIntegration(integrationId),
    hasCredentials(integrationId),
  ])

  if (!integration) {
    notFound()
  }

  // Resolve auth method from cached config (Redis) — used to decide whether to show credential input
  const config = await configCache.get(integration.spec_hash) as MCPServerConfig | null
  const authMethod = config?.authMethod ?? null

  // Cache hits never start a workflow, so run_id stays null
  const cached = integration.run_id === null

  return (
    <main className="mx-auto max-w-6xl px-4 py-12">
      <PipelineView
        integrationId={integrationId}
        cached={cached}
        initialSandboxUrl={integration.sandbox_url ?? null}
        initialVerifiedTools={integration.verified_tools ?? []}
        initialValidatedAt={integration.validated_at ?? null}
        authMethod={authMethod}
        initialHasCredentials={credentialsExist}
        initialLiveValidatedAt={integration.live_validated_at ?? null}
      />
    </main>
  )
}
