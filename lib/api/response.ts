export function success<T>(data: T, status = 200) {
  return Response.json(data, { status })
}

export function error(message: string, status: number) {
  return Response.json({ error: message }, { status })
}

export const errors = {
  badRequest: (message = 'Bad request.') => error(message, 400),
  notFound: (message = 'Not found.') => error(message, 404),
  forbidden: (message = 'Forbidden.') => error(message, 403),
  serviceUnavailable: (message = 'Service unavailable.') => error(message, 503),
  conflict: (message = 'Conflict.') => error(message, 409),
  tooManyRequests: () => error('Too many requests. Please try again later.', 429),
  internal: () => error('Something went wrong.', 500),
}
