import type { Metadata, Viewport } from 'next'
import { GeistSans } from 'geist/font/sans'
import { GeistMono } from 'geist/font/mono'
import './globals.css'
import { ProjectProvider } from '@/lib/project-context'
import { NavCountsProvider } from '@/lib/nav-counts'
import { BrowserAlertsProvider } from '@/lib/browser-alerts'
import { ToastProvider } from '@/components/toast-provider'
import { GlobalEventToasts } from '@/components/global-event-toasts'

export const metadata: Metadata = {
  title: 'Orchestr — AI Development Orchestrator',
  description: 'Coordinate multiple AI coding agents, sessions, and workflows from a single control plane.',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/apple-icon.png',
  },
  appleWebApp: {
    capable: true,
    title: 'Orchestr',
    statusBarStyle: 'black-translucent',
  },
}

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#0d0d0d',
  width: 'device-width',
  initialScale: 1,
  // Zoom continua liberado: a UI é densa, e travar o pinch tira a única saída
  // de quem precisa ler uma coluna de log no celular.
  maximumScale: 5,
  userScalable: true,
  // Pinta atrás do notch — os componentes compensam com env(safe-area-inset-*).
  viewportFit: 'cover',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable} bg-background dark`}>
      <body className="antialiased font-sans">
        <ProjectProvider>
          {/* NavCountsProvider no layout, não na Shell: cada página monta sua
              própria Shell, e daí os contadores recomeçariam do zero (e
              refetchariam) a cada navegação. */}
          <NavCountsProvider>
            <BrowserAlertsProvider>
              <ToastProvider>
                <GlobalEventToasts />
                {children}
              </ToastProvider>
            </BrowserAlertsProvider>
          </NavCountsProvider>
        </ProjectProvider>
      </body>
    </html>
  )
}
