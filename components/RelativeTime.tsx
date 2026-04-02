'use client'

import { relativeTime } from '@/lib/ui/time'

export function RelativeTime({ date }: { date: string }) {
  return <>{relativeTime(date)}</>
}
