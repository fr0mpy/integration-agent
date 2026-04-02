export default function IntegrationLoading() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-12">
      <div className="space-y-6">
        {/* Tab bar skeleton */}
        <div className="flex gap-1 rounded-lg border border-zinc-800 bg-zinc-900/50 p-1">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="h-8 flex-1 animate-pulse rounded-md bg-zinc-800/60"
            />
          ))}
        </div>

        {/* Header card skeleton */}
        <div className="rounded-lg border border-zinc-800 p-6 space-y-3">
          <div className="h-6 w-48 animate-pulse rounded bg-zinc-800" />
          <div className="h-4 w-72 animate-pulse rounded bg-zinc-800/60" />
          <div className="flex gap-2 pt-1">
            <div className="h-5 w-20 animate-pulse rounded-full bg-zinc-800" />
            <div className="h-5 w-24 animate-pulse rounded-full bg-zinc-800" />
          </div>
        </div>

        {/* Content panel skeleton */}
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-lg border border-zinc-800 bg-zinc-900/50"
            />
          ))}
        </div>
      </div>
    </main>
  )
}
