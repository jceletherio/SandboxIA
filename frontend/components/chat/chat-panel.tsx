'use client'

import type { KeyboardEvent, ReactNode, RefObject } from 'react'
import { cn } from '@/lib/utils'
import { ChatComposer } from './chat-composer'
import { ChatMessageList } from './chat-message-list'
import type { ChatMessageView, ChatVariant } from './types'

interface ChatPanelProps {
  messages: ChatMessageView[]
  input: string
  onInputChange: (value: string) => void
  onSend: () => void
  sending?: boolean
  disabled?: boolean
  variant?: ChatVariant
  /** Cabeçalho do painel (título + status). Slot: cada contexto tem o seu. */
  header?: ReactNode
  /** Faixa abaixo do header (ex.: quick commands do Master). */
  toolbar?: ReactNode
  /** Faixa no topo da lista de mensagens (ex.: "Clear chat"). */
  listTopSlot?: ReactNode
  pendingContent?: ReactNode
  emptyLabel?: string
  placeholder?: string
  hint?: ReactNode
  composerOverlay?: ReactNode
  composerRef?: RefObject<HTMLTextAreaElement | null>
  onComposerKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  /** Habilita o botão de referenciar arquivo do composer (insere o `@`). */
  onAttachFile?: () => void
  /** Botões extras na barra de ações do composer. */
  composerActions?: ReactNode
  className?: string
}

/**
 * Painel de chat completo (header + toolbar + lista + composer).
 *
 * É a UI compartilhada entre o chat do Master Agent e o chat de uma Session
 * (CA3 do P3.1: "sem duplicar UI"). Tudo que é específico de um contexto entra
 * por slot — o componente não sabe de onde vêm nem para onde vão as mensagens.
 */
export function ChatPanel({
  messages,
  input,
  onInputChange,
  onSend,
  sending = false,
  disabled = false,
  variant = 'desktop',
  header,
  toolbar,
  listTopSlot,
  pendingContent,
  emptyLabel,
  placeholder,
  hint,
  composerOverlay,
  composerRef,
  onComposerKeyDown,
  onAttachFile,
  composerActions,
  className,
}: ChatPanelProps) {
  return (
    <div className={cn('flex flex-col h-full', className)}>
      {header}
      {toolbar}
      <ChatMessageList
        messages={messages}
        sending={sending}
        variant={variant}
        topSlot={listTopSlot}
        pendingContent={pendingContent}
        emptyLabel={emptyLabel}
      />
      <ChatComposer
        value={input}
        onChange={onInputChange}
        onSend={onSend}
        sending={sending}
        disabled={disabled}
        variant={variant}
        placeholder={placeholder}
        hint={hint}
        overlay={composerOverlay}
        textareaRef={composerRef}
        onKeyDown={onComposerKeyDown}
        onAttachFile={onAttachFile}
        actions={composerActions}
      />
    </div>
  )
}
