'use client'

export default function IntegrationError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="space-y-4 text-center">
        <h1 className="text-2xl font-bold">Failed to load integration</h1>
        <p className="text-zinc-400">Could not load this integration. Please try again.</p>
        <button
          onClick={reset}
          className="rounded-lg bg-white px-4 py-2 font-medium text-zinc-900 hover:bg-zinc-200 transition-colors"
        >
          Try again
        </button>
      </div>
    </main>
  )
}
