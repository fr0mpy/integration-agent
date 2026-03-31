import { NextResponse } from 'next/server'

export function success<T>(data: T) {
  return NextResponse.json(data)
}

export function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

export const errors = {
  badRequest: (message: string) => error(message, 400),
  tooManyRequests: () => error('Too many requests. Please try again later.', 429),
  internal: () => error('Something went wrong.', 500),
}
