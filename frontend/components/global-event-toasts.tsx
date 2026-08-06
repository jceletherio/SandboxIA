'use client'

import { useRef } from 'react'
import { useToast } from '@/components/toast-provider'
import { useProject } from '@/lib/project-context'
import { useGlobalSSE, type SseEvent } from '@/lib/use-sse'
import { useBrowserAlerts, type AlertUrgency } from '@/lib/browser-alerts'
import { useTitleBadge } from '@/lib/use-title-badge'

/**
 * Toasts globais para eventos importantes do orquestrador (SSE):
 * sessão travada, stage falhou, decisão do Master. Montado no layout,
 * dentro de ToastProvider + ProjectProvider.
 *
 * Além do toast — que só serve para quem está olhando a tela — dispara som,
 * vibração e notificação de sistema pelo `useBrowserAlerts`, e mantém o
 * contador no título da aba. O push com o app fechado é outra coisa: sai do
 * backend pelo ntfy (ver docs/guides/mobile-e-notificacoes.md).
 */
export function GlobalEventToasts() {
  const { toast } = useToast()
  const { currentProject } = useProject()
  const { alert } = useBrowserAlerts()
  useTitleBadge()
  // Anti-spam: um toast por chave a cada 5 min (ex.: mesma sessão travada)
  const lastShown = useRef<Map<string, number>>(new Map())

  function showOnce(
    key: string,
    type: 'error' | 'success',
    message: string,
    urgency: AlertUrgency,
  ) {
    const now = Date.now()
    const last = lastShown.current.get(key)
    if (last && now - last < 5 * 60 * 1000) return
    lastShown.current.set(key, now)
    toast(type, message)
    // Mesma janela de dedup do toast: som e vibração seguem o toast, senão o
    // celular vibraria por um evento que a tela não mostrou.
    alert({ title: message, urgency, tag: key })
  }

  useGlobalSSE((event: SseEvent) => {
    const data: any = event.data || {}
    switch (event.type) {
      case 'session:stalled':
        showOnce(
          `stalled:${data.sessionId}`,
          'error',
          `Sessão ${String(data.sessionId || '').slice(0, 8)} travada — ${data.reason || 'sem output'}`,
          'high',
        )
        break
      case 'session:stage-failed':
        showOnce(
          `stage-failed:${data.sessionId}:${data.stage}`,
          'error',
          `Stage "${data.stage}" falhou na sessão ${String(data.sessionId || '').slice(0, 8)}`,
          'high',
        )
        break
      case 'question:created':
        // Pergunta bloqueia a sessão: é o evento que mais justifica interromper
        // quem está longe da tela. Faltava no toast global.
        if (!data.id) break
        showOnce(
          `question:${data.id}`,
          'error',
          `Pergunta esperando resposta: ${String(data.question || '').slice(0, 80)}`,
          'high',
        )
        break
      case 'master:decision':
        if (data.action === 'escalate') {
          showOnce(
            `escalate:${data.questionId}`,
            'error',
            'Master escalou uma pergunta para você — veja em Questions',
            'high',
          )
        }
        break
      case 'session:completed':
        showOnce(
          `completed:${data.sessionId}`,
          'success',
          `Sessão ${String(data.sessionId || '').slice(0, 8)} concluída`,
          'normal',
        )
        break
    }
  }, true, currentProject?.id)

  return null
}
