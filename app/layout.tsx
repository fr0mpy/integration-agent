import type { Metadata } from 'next'
import { Geist } from 'next/font/google'
import Link from 'next/link'
import { VercelMark } from '@/components/VercelMark'
import './globals.css'
import { cn } from '@/lib/utils';

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: 'IntegrationAgent',
  description:
    'Paste an OpenAPI spec. Get a live, deployed MCP server on Vercel in under two minutes.',
  icons: {
    icon: '/vercel-triangle.svg',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={cn('dark font-sans', geist.variable)}>
      <body className="antialiased">
        <header className="fixed top-0 left-0 right-0 z-50 flex items-center h-12 px-4 bg-background">
          <Link href="/" className="flex items-center opacity-90 hover:opacity-100 transition-opacity">
            <VercelMark size={22} />
          </Link>
        </header>
        <div className="pt-12">
          {children}
        </div>
      </body>
    </html>
  )
}
