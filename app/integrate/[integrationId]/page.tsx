import { notFound } from 'next/navigation'
import { PipelineView } from '@/components/PipelineView'

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

  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <PipelineView integrationId={integrationId} />
    </main>
  )
}
