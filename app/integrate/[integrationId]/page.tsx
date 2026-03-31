import { notFound } from 'next/navigation'
import { PipelineView } from '@/components/PipelineView'
import { getIntegration } from '@/lib/storage/neon'

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

  const integration = await getIntegration(integrationId)
  if (!integration) {
    notFound()
  }

  // Cache hits never start a workflow, so run_id stays null
  const cached = integration.run_id === null

  return (
    <main className="mx-auto max-w-6xl px-4 py-12">
      <PipelineView integrationId={integrationId} cached={cached} />
    </main>
  )
}
