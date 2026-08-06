'use client'

import { useCallback, useEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { CornerDownLeft, Paperclip, RefreshCw, Send } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ChatVariant } from './types'

/** Altura máxima do textarea antes de virar área rolável (~9 linhas). */
const MAX_TEXTAREA_HEIGHT = 200

interface ChatComposerProps {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  /** Prompt em voo: trava o input e troca o ícone do botão. */
  sending?: boolean
  /** Trava o input por outro motivo (ex.: sessão morta), sem spinner. */
  disabled?: boolean
  placeholder?: string
  hint?: ReactNode
  variant?: ChatVariant
  /**
   * Conteúdo ancorado acima da caixa (ex.: o autocomplete de `@arquivo`).
   * O wrapper é `relative`, então um dropdown absoluto se posiciona por ele.
   */
  overlay?: ReactNode
  /** Exposto para quem precisa manipular o cursor (inserção de `@referência`). */
  textareaRef?: RefObject<HTMLTextAreaElement | null>
  /** Roda antes do handler padrão; chame `preventDefault()` para suprimi-lo. */
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  /**
   * Habilita o botão de referenciar arquivo. Recebe o clique e deve inserir o
   * `@` no cursor — o atalho sozinho não é descobrível.
   */
  onAttachFile?: () => void
  /** Botões extras à esquerda do enviar. */
  actions?: ReactNode
  className?: string
}

/**
 * Caixa de envio do chat.
 *
 * O textarea **cresce com o conteúdo** até `MAX_TEXTAREA_HEIGHT` e só então
 * rola: antes era `rows={1}` fixo, e escrever um prompt de várias linhas virava
 * uma fresta de uma linha.
 *
 * Enter envia, Shift+Enter quebra linha — e o guard de `isComposing`/keyCode 229
 * é obrigatório: sem ele, o Enter que confirma a escolha de um IME
 * (japonês/chinês) enviava a mensagem no meio da digitação.
 */
export function ChatComposer({
  value,
  onChange,
  onSend,
  sending = false,
  disabled = false,
  placeholder,
  hint,
  variant = 'desktop',
  overlay,
  textareaRef,
  onKeyDown,
  onAttachFile,
  actions,
  className,
}: ChatComposerProps) {
  const locked = sending || disabled
  const innerRef = useRef<HTMLTextAreaElement | null>(null)

  /** Ref combinado: o dono da página também precisa alcançar o nó. */
  const setRefs = useCallback(
    (node: HTMLTextAreaElement | null) => {
      innerRef.current = node
      if (textareaRef) textareaRef.current = node
    },
    [textareaRef],
  )

  // Auto-grow: zera a altura para o scrollHeight refletir o conteúdo atual
  // (senão ele só cresce e nunca encolhe ao apagar linhas).
  useEffect(() => {
    const el = innerRef.current
    if (!el) return
    el.style.height = 'auto'
    const next = Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)
    el.style.height = `${next}px`
    el.style.overflowY = el.scrollHeight > MAX_TEXTAREA_HEIGHT ? 'auto' : 'hidden'
  }, [value])

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    onKeyDown?.(event)
    if (event.defaultPrevented) return
    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing &&
      !(event.keyCode === 229)
    ) {
      event.preventDefault()
      onSend()
    }
  }

  const defaultHint = (
    <span className="flex items-center gap-1.5 flex-wrap">
      <kbd className="px-1 py-0.5 rounded border border-border bg-muted/40 font-mono text-[9px]">
        Enter
      </kbd>
      to send
      <kbd className="px-1 py-0.5 rounded border border-border bg-muted/40 font-mono text-[9px]">
        Shift+Enter
      </kbd>
      new line
      {onAttachFile && (
        <>
          <kbd className="px-1 py-0.5 rounded border border-border bg-muted/40 font-mono text-[9px]">
            @
          </kbd>
          reference a project file
        </>
      )}
    </span>
  )

  return (
    <div
      className={cn(
        'py-3 border-t border-border shrink-0 bg-card/30 relative',
        variant === 'mobile' ? 'px-4' : 'px-6',
        className,
      )}
    >
      {overlay}
      <div
        className={cn(
          'flex flex-col gap-2 bg-input border border-border rounded-lg px-3 py-2.5 transition-colors',
          locked ? 'opacity-60' : 'focus-within:border-primary/40',
        )}
      >
        <textarea
          ref={setRefs}
          rows={1}
          className="w-full bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none resize-none leading-relaxed disabled:cursor-not-allowed"
          placeholder={placeholder}
          value={value}
          disabled={locked}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
        />

        {/* Barra de ações abaixo do texto: com o textarea crescendo, botões
            alinhados ao lado ficariam pulando de posição a cada linha. */}
        <div className="flex items-center gap-1.5">
          {onAttachFile && (
            <button
              type="button"
              onClick={onAttachFile}
              disabled={locked}
              title="Reference a project file (@)"
              aria-label="Reference a project file"
              className="shrink-0 flex items-center gap-1 px-1.5 py-1 rounded-md text-[10px] text-muted-foreground hover:text-primary hover:bg-primary/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Paperclip className="w-3.5 h-3.5" />
              <span className="font-mono">@</span>
            </button>
          )}
          {actions}
          <button
            onClick={onSend}
            disabled={!value.trim() || locked}
            className="ml-auto shrink-0 flex items-center gap-1.5 h-7 px-2.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/80 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            aria-label="Send message"
          >
            {sending ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <>
                <Send className="w-3.5 h-3.5" />
                <CornerDownLeft className="w-3 h-3 opacity-60" />
              </>
            )}
          </button>
        </div>
      </div>
      {hint !== null && (
        <div className="text-[10px] text-muted-foreground/60 mt-1.5">{hint ?? defaultHint}</div>
      )}
    </div>
  )
}
