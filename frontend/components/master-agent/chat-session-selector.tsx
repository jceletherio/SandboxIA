'use client'

import { MessageSquarePlus, MessagesSquare } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { MasterChatSession } from '@/lib/api'
import type { ChatVariant } from '@/components/chat'

/** Id local do rascunho — a conversa nova ainda não existe no backend. */
export const DRAFT_CHAT_SESSION_LABEL = 'New conversation'

interface ChatSessionSelectorProps {
  sessions: MasterChatSession[]
  /** Conversa aberta. `null` = nenhuma (projeto sem histórico). */
  currentId: string | null
  /**
   * A conversa aberta ainda não tem mensagem gravada, então não veio da
   * listagem — é mostrada como uma opção local até a primeira mensagem.
   */
  isDraft?: boolean
  loading?: boolean
  creating?: boolean
  onSelect: (chatSessionId: string) => void
  onNewChat: () => void
  variant?: ChatVariant
  className?: string
}

/**
 * Barra `[conversa atual ▾] [+ new chat]` do chat do Master (P3.2).
 *
 * Componente próprio de propósito: o P3.3 (redesign) reaproveita esta barra no
 * layout novo. Ela não busca nada — quem carrega/troca conversa é a página.
 *
 * Trocar de conversa é puramente visual: **não** existe um runtime ou pane tmux
 * por conversa, o Master do projeto continua sendo um só (CA4).
 */
export function ChatSessionSelector({
  sessions,
  currentId,
  isDraft = false,
  loading = false,
  creating = false,
  onSelect,
  onNewChat,
  variant = 'desktop',
  className,
}: ChatSessionSelectorProps) {
  // O rascunho não está na listagem: entra como primeira opção sintética.
  const showDraftOption = isDraft && !!currentId && !sessions.some((s) => s.chatSessionId === currentId)

  return (
    <div
      className={cn(
        'flex items-center gap-2 py-2 border-b border-border bg-card/20 shrink-0',
        variant === 'mobile' ? 'px-4' : 'px-6',
        className,
      )}
    >
      <MessagesSquare className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
      <select
        aria-label="Conversation"
        value={currentId ?? ''}
        disabled={loading || (!currentId && sessions.length === 0)}
        onChange={(e) => {
          const next = e.target.value
          if (next && next !== currentId) onSelect(next)
        }}
        className="flex-1 min-w-0 bg-input border border-border rounded-md px-2 py-1.5 text-[11px] text-foreground outline-none focus:border-primary/40 disabled:opacity-50"
      >
        {!currentId && (
          <option value="">
            {loading ? 'Loading conversations...' : 'No conversations yet'}
          </option>
        )}
        {showDraftOption && (
          <option value={currentId!}>{DRAFT_CHAT_SESSION_LABEL} (empty)</option>
        )}
        {sessions.map((s) => (
          <option key={s.chatSessionId} value={s.chatSessionId}>
            {s.title} · {s.messageCount} msg
            {s.lastMessageAt
              ? ` · ${new Date(s.lastMessageAt).toLocaleDateString('en-US', {
                  month: 'short',
                  day: '2-digit',
                })}`
              : ''}
          </option>
        ))}
      </select>
      <button
        onClick={onNewChat}
        disabled={creating}
        title="Start a new conversation — nothing is deleted"
        className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border text-[11px] text-muted-foreground hover:text-primary hover:border-primary/40 hover:bg-primary/5 disabled:opacity-50 transition-colors whitespace-nowrap"
      >
        <MessageSquarePlus className="w-3 h-3" />
        {creating ? 'Opening...' : 'New chat'}
      </button>
    </div>
  )
}
