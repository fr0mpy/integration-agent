import { getIntegration } from '@/lib/storage/neon'
import { isValidUUID } from '@/lib/validation'
import { success, errors } from '@/lib/api/response'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ integrationId: string }> },
) {
  const { integrationId } = await params

  if (!isValidUUID(integrationId)) {
    return errors.badRequest('Invalid integration ID.')
  }

  const integration = await getIntegration(integrationId)

  if (!integration) {
    return errors.notFound('Integration not found.')
  }

  return success({
    status: integration.status,
    mcp_url: integration.mcp_url ?? null,
    deployment_id: integration.deployment_id ?? null,
  })
}
