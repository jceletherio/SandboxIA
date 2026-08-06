'use client'

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { projectsApi, type ProjectFileEntry } from '@/lib/api'

/** Quantos itens o dropdown mostra por vez. */
const MAX_SUGGESTIONS = 12
/** Espera antes de bater no servidor, para não disparar uma request por tecla. */
const DEBOUNCE_MS = 120

/**
 * Token `@parcial` imediatamente antes do cursor.
 *
 * Só abre depois de espaço/quebra de linha (ou no início do texto), para
 * `user@host` não virar autocomplete. O termo aceita `/`, `.`, `-` e `_`
 * (é caminho de arquivo), mas não espaço nem outro `@`.
 */
function findMentionToken(value: string, caret: number): { query: string; start: number } | null {
  const upToCaret = value.slice(0, caret)
  const match = /(?:^|\s)@([^\s@]*)$/.exec(upToCaret)
  if (!match) return null
  const query = match[1]
  return { query, start: caret - query.length - 1 }
}

interface UseFileMentionsOptions {
  projectId?: string
  value: string
  onChange: (value: string) => void
  textareaRef: RefObject<HTMLTextAreaElement | null>
}

/**
 * Autocomplete de `@arquivo` sobre os arquivos **reais do repositório** do
 * projeto — não só os `.md` do `/context`.
 *
 * A busca é **server-side e debounced**: um repo tem milhares de arquivos, então
 * não dá para baixar tudo e filtrar no cliente (era o que a versão anterior
 * fazia, e por isso "não aparecia todos os arquivos"). Cada termo digitado vira
 * uma consulta a `GET /projects/:id/files`, que ranqueia por relevância e
 * informa quantos ficaram de fora.
 *
 * O conteúdo do arquivo nunca é lido: o que entra no prompt é o caminho relativo.
 * Falha de rede, projeto sem repo ou resposta vazia => o `@` simplesmente não
 * abre nada. Nada aqui pode impedir o envio da mensagem.
 */
export function useFileMentions({ projectId, value, onChange, textareaRef }: UseFileMentionsOptions) {
  const [suggestions, setSuggestions] = useState<ProjectFileEntry[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  /** Quantos casaram além dos exibidos — vira "+N" no rodapé do dropdown. */
  const [hiddenCount, setHiddenCount] = useState(0)
  /** Token suprimido (usuário apertou Esc) até ele mudar de posição. */
  const dismissedAtRef = useRef<number | null>(null)
  const tokenStartRef = useRef<number | null>(null)
  /** Descarta resposta de request antiga que chegou fora de ordem. */
  const requestSeqRef = useRef(0)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const reset = useCallback(() => {
    setSuggestions([])
    setHiddenCount(0)
    setQuery('')
  }, [])

  // Trocar de projeto invalida tudo: os caminhos são de outro repositório.
  useEffect(() => {
    tokenStartRef.current = null
    dismissedAtRef.current = null
    reset()
  }, [projectId, reset])

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  // O caret só é legível no DOM depois do commit do valor controlado.
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    // Se a página montar mais de um composer, só o que está com o foco calcula
    // o token — o outro nem chega a consultar o servidor.
    if (typeof document !== 'undefined' && document.activeElement !== el) {
      setSuggestions([])
      return
    }

    const caret = el.selectionStart ?? value.length
    const token = findMentionToken(value, caret)

    if (!token) {
      tokenStartRef.current = null
      dismissedAtRef.current = null
      if (debounceRef.current) clearTimeout(debounceRef.current)
      reset()
      return
    }

    tokenStartRef.current = token.start
    setQuery(token.query)

    if (dismissedAtRef.current === token.start) {
      setSuggestions([])
      return
    }

    if (!projectId) {
      setSuggestions([])
      return
    }

    if (debounceRef.current) clearTimeout(debounceRef.current)
    const seq = ++requestSeqRef.current
    setLoading(true)
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await projectsApi.listFiles(projectId, token.query || undefined, MAX_SUGGESTIONS)
        if (seq !== requestSeqRef.current) return // resposta obsoleta
        setSuggestions(res.files)
        setHiddenCount(Math.max(res.total - res.files.length, 0))
        setActiveIndex(0)
      } catch (error) {
        if (seq !== requestSeqRef.current) return
        // Sem repo acessível o `@` é inerte — nunca quebra o envio.
        console.error('Failed to search project files for @ autocomplete:', error)
        setSuggestions([])
        setHiddenCount(0)
      } finally {
        if (seq === requestSeqRef.current) setLoading(false)
      }
    }, DEBOUNCE_MS)
  }, [value, projectId, reset, textareaRef])

  const open = suggestions.length > 0 || (loading && tokenStartRef.current !== null)

  /** Substitui o token `@parcial` pelo caminho escolhido e reposiciona o cursor. */
  const select = useCallback(
    (file: ProjectFileEntry) => {
      const el = textareaRef.current
      const start = tokenStartRef.current
      if (start === null) return
      const caret = el?.selectionStart ?? value.length
      const rest = value.slice(caret)
      // Não duplica o espaço quando o usuário já tinha um depois do token.
      const insertion = `@${file.path}${rest.startsWith(' ') ? '' : ' '}`
      const next = value.slice(0, start) + insertion + rest
      onChange(next)
      reset()
      const cursor = start + insertion.length
      // O valor é controlado: só dá para mexer no caret depois do re-render.
      requestAnimationFrame(() => {
        const node = textareaRef.current
        if (!node) return
        node.focus()
        node.setSelectionRange(cursor, cursor)
      })
    },
    [onChange, reset, textareaRef, value],
  )

  /**
   * Teclas do dropdown. Roda ANTES do handler do `ChatComposer`, que respeita
   * `defaultPrevented` — é assim que o Enter escolhe o arquivo em vez de enviar.
   */
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (!open) return
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setActiveIndex((i) => (suggestions.length ? (i + 1) % suggestions.length : 0))
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setActiveIndex((i) => (suggestions.length ? (i - 1 + suggestions.length) % suggestions.length : 0))
        return
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        const picked = suggestions[activeIndex]
        if (!picked) return
        event.preventDefault()
        select(picked)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        dismissedAtRef.current = tokenStartRef.current
        reset()
      }
    },
    [activeIndex, open, reset, select, suggestions],
  )

  const close = useCallback(() => {
    dismissedAtRef.current = tokenStartRef.current
    reset()
  }, [reset])

  /**
   * Insere um `@` no cursor e devolve o foco — é o que o botão de anexar chama,
   * já que o atalho `@` sozinho não é descobrível.
   */
  const trigger = useCallback(() => {
    const el = textareaRef.current
    const caret = el?.selectionStart ?? value.length
    const before = value.slice(0, caret)
    // Garante o separador que o regex exige para abrir o autocomplete.
    const needsSpace = before.length > 0 && !/\s$/.test(before)
    const insertion = `${needsSpace ? ' ' : ''}@`
    const next = before + insertion + value.slice(caret)
    onChange(next)
    dismissedAtRef.current = null
    const cursor = caret + insertion.length
    requestAnimationFrame(() => {
      const node = textareaRef.current
      if (!node) return
      node.focus()
      node.setSelectionRange(cursor, cursor)
    })
  }, [onChange, textareaRef, value])

  return {
    open,
    suggestions,
    activeIndex,
    setActiveIndex,
    query,
    loading,
    hiddenCount,
    select,
    onKeyDown,
    close,
    trigger,
  }
}
