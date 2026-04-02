// Wraps a value in a JSON response with a 2xx status; used by every successful API route handler.
export function success<T>(data: T, status = 200) {
  return Response.json(data, { status })
}

// Wraps an error message in a JSON response with the given status; base helper called by all errors.* shorthands.
export function error(message: string, status: number) {
  return Response.json({ error: message }, { status })
}

// Typed shorthand helpers for common HTTP errors; import and call instead of constructing Response objects manually in route handlers.
export const errors = {
  badRequest: (message = 'Bad request.') => error(message, 400),
  notFound: (message = 'Not found.') => error(message, 404),
  forbidden: (message = 'Forbidden.') => error(message, 403),
  serviceUnavailable: (message = 'Service unavailable.') => error(message, 503),
  conflict: (message = 'Conflict.') => error(message, 409),
  tooManyRequests: () => error('Too many requests. Please try again later.', 429),
  internal: () => error('Something went wrong.', 500),
}
