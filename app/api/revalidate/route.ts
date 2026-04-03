// On-demand ISR revalidation — called externally with a Bearer secret to refresh the integration list cache
import { revalidateTag } from 'next/cache'
import { success, errors } from '@/lib/api/response'

export async function POST(req: Request) {
  const authHeader = req.headers.get('authorization')
  const expected = process.env.REVALIDATE_SECRET

  if (!expected || authHeader !== `Bearer ${expected}`) {
    return errors.forbidden('Invalid revalidation secret.')
  }

  revalidateTag('integrations', 'hours')

  return success({ revalidated: true })
}
