import { SpecInput } from '@/components/SpecInput'

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="w-full max-w-2xl space-y-8">
        <div className="space-y-3 text-center">
          <h1 className="text-4xl font-bold tracking-tight">
            IntegrationAgent
          </h1>
          <p className="text-lg text-zinc-400">
            Paste an OpenAPI spec URL or upload a file. Get a live MCP server
            deployed on Vercel in under two minutes.
          </p>
        </div>
        <SpecInput />
      </div>
    </main>
  )
}
