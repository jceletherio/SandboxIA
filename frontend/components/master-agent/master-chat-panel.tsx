'use client'

import { useRef } from 'react'
import Link from 'next/link'
import { AlertCircle, ListTodo, RefreshCw, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  ChatPanel,
  FileMentionList,
  useFileMentions,
  type ChatMessageView,
  type ChatVariant,
} from '@/components/chat'
import type { MasterChatSession } from '@/lib/api'
import { ChatSessionSelector } from './chat-session-selector'

/**
 * Prompts prontos da faixa acima da lista de mensagens.
 *
 * `prompt` é o texto que vai para o Master (inalterado); `label` é a versão
 * curta que cabe na coluna estreita do chat. O `title` mostra o prompt inteiro.
 */
const QUICK_COMMANDS = [
  { label: 'Status summary', prompt: 'Summarize project status', icon: Sparkles },
  { label: "What's blocked?", prompt: 'What is blocked right now?', icon: AlertCircle },
  { label: 'Next macro tasks', prompt: 'Suggest next macro tasks', icon: ListTodo },
] as const

interface MasterChatPanelProps {
  variant: ChatVariant
  /** Projeto do autocomplete de `@arquivo`. */
  projectId?: string
  messages: ChatMessageView[]
  input: string
  onInputChange: (value: string) => void
  onSend: () => void
  /** Envia um texto pronto (quick command). */
  onQuickCommand: (text: string) => void
  sending: boolean
  masterActive: boolean
  cliProfileName?: string | null
  chatSessions: MasterChatSession[]
  currentChatSessionId: string | null
  chatSessionIsDraft: boolean
  loadingChatSessions: boolean
  creatingChatSession: boolean
  onSelectChatSession: (chatSessionId: string) => void
  onNewChatSession: () => void
  onClearMessages: () => void
}

/**
 * Chat do Master Agent — a coluna fixa à direita do painel de situação.
 *
 * A página monta **uma única** instância (desktop e mobile compartilham a mesma
 * coluna, que só troca de posição por CSS), então há um ref de textarea e um
 * autocomplete de `@arquivo` só — sem duas caixas disputando o foco.
 */
export function MasterChatPanel({
  variant,
  projectId,
  messages,
  input,
  onInputChange,
  onSend,
  onQuickCommand,
  sending,
  masterActive,
  cliProfileName,
  chatSessions,
  currentChatSessionId,
  chatSessionIsDraft,
  loadingChatSessions,
  creatingChatSession,
  onSelectChatSession,
  onNewChatSession,
  onClearMessages,
}: MasterChatPanelProps) {
  const composerRef = useRef<HTMLTextAreaElement>(null)
  // Busca server-side nos arquivos reais do repo do projeto — sem `projectId`
  // o `@` fica inerte (nada a listar), então a página precisa passá-lo.
  const mentions = useFileMentions({
    projectId,
    value: input,
    onChange: onInputChange,
    textareaRef: composerRef,
  })

  return (
    <ChatPanel
      variant={variant}
      messages={messages}
      input={input}
      onInputChange={onInputChange}
      onSend={onSend}
      sending={sending}
      emptyLabel="Start a conversation with the Master Agent"
      placeholder={sending ? 'Waiting for the CLI to reply...' : 'Ask the Master Agent about the project...'}
      composerRef={composerRef}
      onComposerKeyDown={mentions.onKeyDown}
      // Torna o `@` descobrível: o botão de anexo insere o gatilho no cursor.
      onAttachFile={mentions.trigger}
      composerOverlay={
        mentions.open ? (
          <FileMentionList
            files={mentions.suggestions}
            activeIndex={mentions.activeIndex}
            onHover={mentions.setActiveIndex}
            onSelect={mentions.select}
            loading={mentions.loading}
            hiddenCount={mentions.hiddenCount}
            query={mentions.query}
            // O composer aqui usa a densidade compacta (px-4) em todo
            // breakpoint; sem isso o dropdown ficaria 8px mais estreito no lg.
            className="lg:mx-4"
          />
        ) : null
      }
      header={
        <header
          className={cn(
            'flex items-center justify-between py-3 border-b border-border bg-card/50 shrink-0',
            variant === 'mobile' ? 'px-4' : 'px-6',
          )}
        >
          {/*
            O título da página vive no cabeçalho do painel de situação — aqui a
            coluna se identifica só como "Chat", mas mantém o chip do runtime
            (ACTIVE · profile) para quem só olha para o chat.
          */}
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground">Chat</h2>
            <p className="text-[11px] text-muted-foreground font-mono mt-0.5 truncate">
              Ask the Master about the project
            </p>
          </div>
          <span
            className={cn(
              'text-[10px] font-mono px-2 py-1 rounded border shrink-0',
              masterActive
                ? 'bg-primary/10 text-primary border-primary/20'
                : 'bg-muted text-muted-foreground border-border',
            )}
          >
            {masterActive ? `ACTIVE${cliProfileName ? ` · ${cliProfileName}` : ''}` : 'INACTIVE'}
          </span>
        </header>
      }
      toolbar={
        <>
          {/* P3.2 — [conversa atual ▾] [+ new chat], logo abaixo do header. */}
          <ChatSessionSelector
            variant={variant}
            sessions={chatSessions}
            currentId={currentChatSessionId}
            isDraft={chatSessionIsDraft}
            loading={loadingChatSessions}
            creating={creatingChatSession}
            onSelect={onSelectChatSession}
            onNewChat={onNewChatSession}
          />
          <div
            className={cn(
              'flex items-center gap-2 py-2.5 border-b border-border bg-muted/5 shrink-0 overflow-x-auto scrollbar-none',
              variant === 'mobile' ? 'px-4' : 'px-6',
            )}
          >
            {QUICK_COMMANDS.map((c) => {
              const Icon = c.icon
              return (
                <button
                  key={c.label}
                  onClick={() => onQuickCommand(c.prompt)}
                  disabled={sending}
                  title={c.prompt}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border border-border text-[11px] text-muted-foreground hover:text-primary hover:border-primary/40 hover:bg-primary/5 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
                >
                  <Icon className="w-3 h-3" />
                  {c.label}
                </button>
              )
            })}
          </div>
        </>
      }
      listTopSlot={
        messages.length > 0 ? (
          <div className="flex justify-end mb-2">
            <button
              onClick={onClearMessages}
              title="Delete the messages of this conversation only"
              className="text-[10px] text-muted-foreground hover:text-destructive transition-colors"
            >
              Clear this conversation
            </button>
          </div>
        ) : null
      }
      pendingContent={
        <p className="text-xs text-muted-foreground flex items-center gap-2">
          <RefreshCw className="w-3 h-3 animate-spin" />
          Thinking in the terminal...
          <Link href="/terminal" className="text-primary hover:underline">
            watch live
          </Link>
        </p>
      }
    />
  )
}
