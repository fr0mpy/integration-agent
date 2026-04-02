import { type NextRequest } from 'next/server'
import { resumeHook } from 'workflow/api'
import { isValidUUID } from '@/lib/validation'
import { success, errors } from '@/lib/api/response'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ integrationId: string }> },
) {
  const { integrationId } = await params

  if (!isValidUUID(integrationId)) {
    return errors.badRequest('Invalid integration ID')
  }

  try {
    await resumeHook(`audit-trigger:${integrationId}`, { triggered: true })
    return success({ ok: true })
  } catch (err) {
    console.error('Failed to resume audit hook:', err)
    return errors.serviceUnavailable(
      'Failed to trigger audit. The pipeline may have already completed or expired.',
    )
  }
}
