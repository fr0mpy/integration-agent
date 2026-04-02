export default function HomeLoading() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-16">
      <div className="w-full max-w-2xl space-y-10">
        {/* Heading */}
        <div className="space-y-3 text-center">
          <div className="mx-auto h-10 w-64 animate-pulse rounded-lg bg-zinc-800" />
          <br />
          <div className="mx-auto h-6 w-96 animate-pulse rounded-lg bg-zinc-800/60" />
        </div>

        {/* Spec input form placeholder */}
        <div className="space-y-4">
          <div className="h-4 w-28 animate-pulse rounded bg-zinc-800" />
          <div className="flex gap-2">
            <div className="min-w-0 flex-1 h-12 animate-pulse rounded-lg border border-zinc-700 bg-zinc-900" />
            <div className="h-12 w-32 animate-pulse rounded-lg border border-zinc-700 bg-zinc-900" />
          </div>
          <div className="h-12 w-full animate-pulse rounded-lg bg-zinc-800" />
        </div>

        {/* Recent pipelines list placeholder */}
        <div className="space-y-3">
          <div className="h-4 w-28 animate-pulse rounded bg-zinc-800" />
          <div className="space-y-1.5">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="h-14 animate-pulse rounded-lg border border-zinc-800 bg-zinc-900/50"
              />
            ))}
          </div>
        </div>
      </div>
    </main>
  )
}
