import type { MetadataRoute } from 'next'

/**
 * Manifest do PWA — serve `/manifest.webmanifest`.
 *
 * Instalar na tela inicial dá tela cheia (sem barra de endereço, que come ~10%
 * da altura útil no celular) e é o que habilita as notificações push do
 * navegador. Chrome só oferece a instalação em origem segura: pelo IP da LAN em
 * http isso não aparece — ver docs/guides/mobile-e-notificacoes.md.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Orchestr — AI Development Orchestrator',
    short_name: 'Orchestr',
    description:
      'Coordinate multiple AI coding agents, sessions, and workflows from a single control plane.',
    start_url: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#0d0d0d',
    theme_color: '#0d0d0d',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // maskable separado: o launcher do Android recorta o ícone, e no "any" o
      // arredondado do próprio desenho ficaria cortado duas vezes.
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Questions', short_name: 'Questions', url: '/questions' },
      { name: 'Sessions', short_name: 'Sessions', url: '/sessions' },
      { name: 'Terminal', short_name: 'Terminal', url: '/terminal' },
    ],
  }
}
