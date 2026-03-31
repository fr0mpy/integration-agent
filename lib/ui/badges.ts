export const methodColors: Record<string, string> = {
  GET: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
  POST: 'bg-blue-500/15 text-blue-400 border-blue-500/25',
  PUT: 'bg-amber-500/15 text-amber-400 border-amber-500/25',
  PATCH: 'bg-purple-500/15 text-purple-400 border-purple-500/25',
  DELETE: 'bg-red-500/15 text-red-400 border-red-500/25',
}

export const authStyles: Record<string, { label: string; className: string }> = {
  bearer: { label: 'Bearer Token', className: 'bg-sky-500/15 text-sky-400 border-sky-500/25' },
  apiKey: { label: 'API Key', className: 'bg-violet-500/15 text-violet-400 border-violet-500/25' },
  basic: { label: 'Basic Auth', className: 'bg-orange-500/15 text-orange-400 border-orange-500/25' },
  oauth2: { label: 'OAuth 2.0', className: 'bg-teal-500/15 text-teal-400 border-teal-500/25' },
  none: { label: 'No Auth', className: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/25' },
}
