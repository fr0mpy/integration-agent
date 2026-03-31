import { notFound } from 'next/navigation'
import { PipelineView } from '@/components/PipelineView'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function IntegrationPage({
  params,
  searchParams,
}: {
  params: Promise<{ integrationId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { integrationId } = await params
  const query = await searchParams

  if (!UUID_RE.test(integrationId)) {
    notFound()
  }

  const cached = query.cached === 'true'

  return (
    <main className="mx-auto max-w-6xl px-4 py-12">
      <PipelineView integrationId={integrationId} cached={cached} />
    </main>
  )
}
