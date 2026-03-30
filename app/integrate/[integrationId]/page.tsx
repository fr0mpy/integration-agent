export default async function IntegrationPage({
  params,
}: {
  params: Promise<{ integrationId: string }>
}) {
  const { integrationId } = await params

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="space-y-4 text-center">
        <h1 className="text-2xl font-bold">Pipeline</h1>
        <p className="text-zinc-400">
          Integration <code className="text-zinc-200">{integrationId}</code> —
          pipeline UI coming next.
        </p>
      </div>
    </main>
  )
}
