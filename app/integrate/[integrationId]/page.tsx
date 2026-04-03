import { notFound } from 'next/navigation'
import { PipelineView } from '@/components/PipelineView'
import { getIntegration } from '@/lib/storage/neon'
import { isValidUUID } from '@/lib/validation'

export default async function IntegrationPage({
  params,
}: {
  params: Promise<{ integrationId: string }>
}) {
  const { integrationId } = await params

  if (!isValidUUID(integrationId)) {
    notFound()
  }

  const integration = await getIntegration(integrationId)

  if (!integration) {
    notFound()
  }

  // Cache hits never start a workflow, so run_id stays null
  const cached = integration.run_id === null

  return (
    <main className="mx-auto max-w-6xl px-4 py-12">
      <PipelineView
        integrationId={integrationId}
        cached={cached}
        initialSandboxUrl={null}
        initialVerifiedTools={integration.verified_tools ?? []}
        initialValidatedAt={integration.validated_at ?? null}
        initialPrUrl={integration.github_pr_url ?? null}
        initialRepoUrl={integration.github_repo_url ?? null}
        initialMcpUrl={integration.mcp_url ?? null}
      />
    </main>
  )
}
