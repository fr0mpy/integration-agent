import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { resumeHook } from 'workflow/api'
import { isValidUUID } from '@/lib/validation'
import { success, errors } from '@/lib/api/response'

const bodySchema = z.object({
  excludedTools: z.array(z.string().min(1).regex(/^[a-z][a-z0-9_]*$/)).default([]),
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ integrationId: string }> },
) {
  const { integrationId } = await params

  if (!isValidUUID(integrationId)) {
    return errors.badRequest('Invalid integration ID')
  }

  const body = await req.json()
  const parsed = bodySchema.safeParse(body)

  if (!parsed.success) {
    return errors.badRequest('Invalid excludedTools')
  }

  const { excludedTools } = parsed.data

  try {
    await resumeHook(`build-trigger:${integrationId}`, { excludedTools })
    return success({ ok: true })
  } catch (err) {
    console.error('Failed to resume build hook:', err)
    return errors.serviceUnavailable(
      'Failed to trigger build. The pipeline may have already completed or expired.',
    )
  }
}
