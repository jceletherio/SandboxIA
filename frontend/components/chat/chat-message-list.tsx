'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { Bot, User } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ChatMessageView, ChatVariant } from './types'

interface ChatMessageListProps {
  messages: ChatMessageView[]
  /** Há um prompt em voo — mostra a bolha de "pensando". */
  sending?: boolean
  variant?: ChatVariant
  /** Faixa fixa no topo da lista (ex.: o botão "Clear chat" do master-agent). */
  topSlot?: ReactNode
  /** Conteúdo da bolha exibida enquanto `sending` (o texto muda por contexto). */
  pendingContent?: ReactNode
  emptyLabel?: string
  className?: string
}

/**
 * Lista de mensagens com auto-scroll para o fim. O ref de scroll é interno:
 * cada instância cuida da própria (a página master-agent renderiza uma versão
 * mobile e uma desktop, e antes as duas disputavam o mesmo ref).
 */
export function ChatMessageList({
  messages,
  sending = false,
  variant = 'desktop',
  topSlot,
  pendingContent,
  emptyLabel = 'Start a conversation',
  className,
}: ChatMessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, sending])

  return (
    <div
      className={cn(
        'flex-1 min-h-0 overflow-y-auto py-4 space-y-4',
        variant === 'mobile' ? 'px-4' : 'px-6',
        className,
      )}
    >
      {topSlot}
      {messages.map((msg) => (
        <div key={msg.id} className={cn('flex gap-3', msg.role === 'user' && 'flex-row-reverse')}>
          <div
            className={cn(
              'w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5',
              msg.role === 'agent'
                ? 'bg-primary/15 border border-primary/20'
                : 'bg-muted border border-border',
            )}
          >
            {msg.role === 'agent' ? (
              <Bot className="w-3.5 h-3.5 text-primary" />
            ) : (
              <User className="w-3.5 h-3.5 text-muted-foreground" />
            )}
          </div>
          <div
            className={cn(
              'flex flex-col gap-1',
              variant === 'mobile' ? 'max-w-[85%]' : 'max-w-[75%]',
              msg.role === 'user' && 'items-end',
            )}
          >
            <div
              className={cn(
                'rounded-xl px-4 py-3',
                msg.role === 'agent'
                  ? 'bg-card border border-border rounded-tl-sm'
                  : 'bg-primary/10 border border-primary/20 rounded-tr-sm',
              )}
            >
              <p className="text-xs leading-relaxed text-foreground whitespace-pre-wrap">
                {msg.content}
              </p>
            </div>
            <span className="text-[10px] font-mono text-muted-foreground/60 px-1">{msg.time}</span>
          </div>
        </div>
      ))}
      {sending && pendingContent && (
        <div className="flex gap-3">
          <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 bg-primary/15 border border-primary/20">
            <Bot className="w-3.5 h-3.5 text-primary" />
          </div>
          <div className="rounded-xl rounded-tl-sm px-4 py-3 bg-card border border-border">
            {pendingContent}
          </div>
        </div>
      )}
      {messages.length === 0 && !sending && (
        <div className="flex items-center justify-center h-full">
          <p className="text-xs text-muted-foreground">{emptyLabel}</p>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  )
}
