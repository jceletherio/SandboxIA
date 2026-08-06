'use client'

import { useEffect, useRef } from 'react'
import { useNavCounts } from '@/lib/nav-counts'

/**
 * Prefixa o título da aba com o que está pendente: `(2) Orchestr — …`.
 *
 * É o único sinal que sobrevive à aba em segundo plano sem push: no celular a
 * aba fica na lista do navegador, e no desktop na barra de abas. Vem dos
 * contadores que já são pollados (`useNavCounts`) em vez de eventos, porque
 * assim o título reflete o ESTADO — quem chegou depois do evento também vê.
 */
export function useTitleBadge() {
  const counts = useNavCounts()
  const baseTitleRef = useRef<string | null>(null)

  const pending = (counts.questions ?? 0) + (counts.stalledSessions ?? 0)

  useEffect(() => {
    if (typeof document === 'undefined') return
    // Captura o título "limpo" uma vez. Se lesse a cada efeito, o prefixo
    // anterior entraria na base e viraria `(1) (1) Orchestr`.
    if (baseTitleRef.current === null) {
      baseTitleRef.current = document.title.replace(/^\(\d+\)\s*/, '')
    }
    const base = baseTitleRef.current
    document.title = pending > 0 ? `(${pending}) ${base}` : base
  }, [pending])
}
