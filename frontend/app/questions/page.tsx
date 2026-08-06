'use client'

import { Shell } from '@/components/shell'
import { cn } from '@/lib/utils'
import { questionsGlobalApi, type Question as ApiQuestion } from '@/lib/api'
import { useGlobalSSE, type SseEvent } from '@/lib/use-sse'
import { Send, CheckCheck, Zap, ShieldAlert, GitMerge, X, AlertCircle, Star, Trash2, Loader2, ChevronLeft } from 'lucide-react'
import { useState, useEffect, useCallback, useMemo, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useProject } from '@/lib/project-context'

type Priority = 'high' | 'normal' | 'low'
type QuestionKind = 'approval' | 'merge-conflict'

interface QuestionVM {
  /** UUID completo — usado em toda chamada de API. */
  id: string
  /** ID curto SÓ para exibição. */
  displayId: string
  /** UUID completo da sessão. */
  sessionId: string
  /** ID curto da sessão SÓ para exibição. */
  sessionDisplayId: string
  priority: Priority
  text: string
  answered: boolean
  /** Pergunta descartada como obsoleta (status 'dismissed'). */
  dismissed: boolean
  /** answered || dismissed — não aceita mais resposta. */
  resolved: boolean
  dismissAudit?: { dismissedBy?: string; reason?: string; at?: string }
  answer?: string
  context?: string
  kind?: QuestionKind
  options?: string[]
  /** Opção recomendada pelo agente que perguntou (metadata.recommended). */
  recommended?: string
  /** Sugestão do Master Agent ao escalar (metadata.suggestion). */
  suggestion?: { answer: string; confidence?: number; reason?: string }
  answeredBy?: string
  confidence?: number
  reason?: string
  agent: string
  task: string
  branch: string
  stage: string
  time: string
  createdAt: string
}

const PAGE_SIZE = 50

/**
 * Normaliza o retorno de questionsGlobalApi.list: com { cursor, limit } o client
 * devolve { data, nextCursor }; sem params (ou backend antigo) devolve array puro.
 */
function unwrapPage(result: unknown): { items: ApiQuestion[]; nextCursor: string | null } {
  if (Array.isArray(result)) return { items: result, nextCursor: null }
  const obj = result as { data?: unknown; nextCursor?: unknown } | null | undefined
  return {
    items: Array.isArray(obj?.data) ? (obj.data as ApiQuestion[]) : [],
    nextCursor: typeof obj?.nextCursor === 'string' && obj.nextCursor.length > 0 ? obj.nextCursor : null,
  }
}

function mapApiQuestion(q: ApiQuestion): QuestionVM {
  const meta = q.metadata ?? {}
  const priority: Priority = q.priority === 'high' || q.priority === 'low' ? q.priority : 'normal'
  const kind: QuestionKind | undefined =
    meta.kind === 'approval' || meta.kind === 'merge-conflict' ? meta.kind : undefined

  const answered = q.status === 'answered'
  const dismissed = q.status === 'dismissed'
  const audit = meta.audit && typeof meta.audit === 'object' ? meta.audit : undefined

  return {
    id: q.id,
    displayId: q.id.slice(0, 8),
    sessionId: q.sessionId,
    sessionDisplayId: q.sessionId.slice(0, 8),
    priority,
    text: q.question,
    answered,
    dismissed,
    resolved: answered || dismissed,
    dismissAudit: dismissed
      ? {
          dismissedBy: typeof audit?.dismissedBy === 'string' ? audit.dismissedBy : undefined,
          reason: typeof audit?.reason === 'string' ? audit.reason : undefined,
          at: typeof audit?.at === 'string' ? audit.at : undefined,
        }
      : undefined,
    answer: q.answer || undefined,
    context: typeof meta.context === 'string' && meta.context.length > 0 ? meta.context : undefined,
    kind,
    options: Array.isArray(meta.options) ? meta.options.filter((o: unknown): o is string => typeof o === 'string') : undefined,
    recommended: typeof meta.recommended === 'string' ? meta.recommended : undefined,
    suggestion:
      meta.suggestion && typeof meta.suggestion.answer === 'string'
        ? {
            answer: meta.suggestion.answer,
            confidence: typeof meta.suggestion.confidence === 'number' ? meta.suggestion.confidence : undefined,
            reason: typeof meta.suggestion.reason === 'string' ? meta.suggestion.reason : undefined,
          }
        : undefined,
    answeredBy: typeof meta.answeredBy === 'string' ? meta.answeredBy : undefined,
    confidence: typeof meta.confidence === 'number' ? meta.confidence : undefined,
    reason: typeof meta.reason === 'string' ? meta.reason : undefined,
    agent: q.session?.agent?.name || 'Unknown agent',
    task: q.session?.macroTask?.title || 'Unknown task',
    branch: q.session?.branchName || '—',
    stage: q.session?.currentStage || '—',
    time: new Date(q.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
    createdAt: q.createdAt,
  }
}

const priorityConfig: Record<Priority, { dot: string; label: string; bg: string; text: string; border: string }> = {
  high: {
    dot: 'bg-destructive',
    label: 'Urgent',
    bg: 'bg-destructive/5',
    text: 'text-destructive',
    border: 'border-destructive/30',
  },
  normal: {
    dot: 'bg-status-waiting',
    label: 'Medium',
    bg: 'bg-status-waiting/5',
    text: 'text-status-waiting',
    border: 'border-status-waiting/30',
  },
  low: {
    dot: 'bg-status-done',
    label: 'Optional',
    bg: 'bg-status-done/5',
    text: 'text-status-done',
    border: 'border-status-done/30',
  },
}

const kindConfig: Record<QuestionKind, { label: string; bg: string; text: string; icon: typeof ShieldAlert }> = {
  approval: {
    label: 'APPROVAL',
    bg: 'bg-status-waiting/10',
    text: 'text-status-waiting',
    icon: ShieldAlert,
  },
  'merge-conflict': {
    label: 'MERGE CONFLICT',
    bg: 'bg-destructive/10',
    text: 'text-destructive',
    icon: GitMerge,
  },
}

function KindBadge({ kind, small }: { kind: QuestionKind; small?: boolean }) {
  const cfg = kindConfig[kind]
  const Icon = cfg.icon
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 font-mono rounded px-1.5 py-0.5',
        small ? 'text-[9px]' : 'text-[10px]',
        cfg.bg,
        cfg.text
      )}
    >
      <Icon className={small ? 'w-2.5 h-2.5' : 'w-3 h-3'} />
      {cfg.label}
    </span>
  )
}

function QuestionCard({
  question,
  selected,
  onClick,
}: {
  question: QuestionVM
  selected: boolean
  onClick: () => void
}) {
  const cfg = priorityConfig[question.priority]
  return (
    <div
      onClick={onClick}
      className={cn(
        'flex items-start gap-3 px-4 py-3 cursor-pointer border-b border-border/60 transition-colors',
        selected ? 'bg-accent/20' : 'hover:bg-muted/20',
        question.resolved && 'opacity-50'
      )}
    >
      <div className={cn('w-1.5 h-1.5 rounded-full shrink-0 mt-1.5', question.dismissed ? 'bg-muted-foreground/50' : cfg.dot)} />
      <div className="flex-1 min-w-0 space-y-0.5">
        <p className={cn('text-xs leading-snug', question.resolved ? 'text-muted-foreground line-through' : 'text-foreground')}>
          {question.text}
        </p>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] font-mono text-primary">{question.sessionDisplayId}</span>
          <span className="text-[10px] text-muted-foreground">·</span>
          <span className="text-[10px] text-muted-foreground">{question.agent}</span>
          <span className="text-[10px] text-muted-foreground">·</span>
          <span className="text-[10px] text-muted-foreground">{question.time}</span>
          {question.kind && <KindBadge kind={question.kind} small />}
        </div>
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0">
        {question.dismissed ? (
          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground">
            DISMISSED
          </span>
        ) : (
          <span className={cn('text-[9px] font-mono px-1.5 py-0.5 rounded', cfg.bg, cfg.text)}>
            {cfg.label.toUpperCase()}
          </span>
        )}
        {question.answered && <CheckCheck className="w-3 h-3 text-status-done" />}
        {question.dismissed && <Trash2 className="w-3 h-3 text-muted-foreground" />}
      </div>
    </div>
  )
}

function QuestionsInbox() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const sessionFilter = searchParams.get('session')

  const [questions, setQuestions] = useState<QuestionVM[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  /** Só governa o mobile: no `lg` os dois painéis ficam visíveis sempre. */
  const [detailOpen, setDetailOpen] = useState(false)
  const [answer, setAnswer] = useState('')
  const [filter, setFilter] = useState<'all' | 'pending' | 'answered'>('pending')
  const [loading, setLoading] = useState(true)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [dismissOpen, setDismissOpen] = useState(false)
  const [dismissReason, setDismissReason] = useState('')

  const { currentProject } = useProject()

  /**
   * Recarrega a PRIMEIRA página e reseta o cursor de paginação.
   * Usado no fetch inicial, polling, refresh via SSE e após responder/descartar.
   */
  const fetchQuestions = useCallback(async () => {
    try {
      const result = await questionsGlobalApi.list({
        limit: PAGE_SIZE,
        ...(currentProject ? { projectId: currentProject.id } : {}),
      })
      const page = unwrapPage(result)
      setQuestions(page.items.map(mapApiQuestion))
      setNextCursor(page.nextCursor)
      setFetchError(null)
    } catch (error) {
      console.error('Failed to fetch questions:', error)
      setFetchError(error instanceof Error ? error.message : 'Failed to load questions')
    } finally {
      setLoading(false)
    }
  }, [currentProject])

  /** Busca a próxima página e concatena (dedup por id, por segurança). */
  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    try {
      const result = await questionsGlobalApi.list({
        cursor: nextCursor,
        limit: PAGE_SIZE,
        ...(currentProject ? { projectId: currentProject.id } : {}),
      })
      const page = unwrapPage(result)
      setQuestions((prev) => {
        const seen = new Set(prev.map((q) => q.id))
        return [...prev, ...page.items.map(mapApiQuestion).filter((q) => !seen.has(q.id))]
      })
      setNextCursor(page.nextCursor)
      setFetchError(null)
    } catch (error) {
      console.error('Failed to load more questions:', error)
      setFetchError(error instanceof Error ? error.message : 'Failed to load more questions')
    } finally {
      setLoadingMore(false)
    }
  }, [nextCursor, loadingMore, currentProject])

  // Fetch inicial + polling leve de fallback (30s). SSE cuida do tempo real.
  // Trocar de aba/filtro de sessão (ou de projeto, via fetchQuestions) volta
  // para a primeira página e reseta o cursor.
  useEffect(() => {
    fetchQuestions()
    const interval = setInterval(fetchQuestions, 30000)
    return () => clearInterval(interval)
  }, [fetchQuestions, filter, sessionFilter])

  const handleSseMessage = useCallback(
    (event: SseEvent) => {
      if (event.type === 'question:created' || event.type === 'question:answered') {
        fetchQuestions()
      }
    },
    [fetchQuestions]
  )
  useGlobalSSE(handleSseMessage, true, currentProject?.id)

  const filtered = useMemo(
    () =>
      questions.filter((q) => {
        if (sessionFilter && q.sessionId !== sessionFilter) return false
        if (filter === 'pending') return !q.resolved
        if (filter === 'answered') return q.resolved
        return true
      }),
    [questions, filter, sessionFilter]
  )

  // Auto-seleção: só quando nada está selecionado (ou o selecionado sumiu da lista).
  useEffect(() => {
    if (loading) return
    if (selectedId && questions.some((q) => q.id === selectedId)) return
    setSelectedId(filtered[0]?.id ?? null)
  }, [loading, questions, filtered, selectedId])

  const selected = questions.find((q) => q.id === selectedId) ?? null

  const selectQuestion = (id: string) => {
    setSelectedId(id)
    // No mobile os dois painéis não cabem: abrir uma pergunta troca a lista pelo
    // detalhe. `detailOpen` é separado de `selectedId` porque a auto-seleção
    // acima roda sem o usuário pedir — se o mobile seguisse `selectedId`, a
    // página abriria já dentro de uma pergunta, sem lista.
    setDetailOpen(true)
    setAnswer('')
    setFeedback(null)
    setDismissOpen(false)
    setDismissReason('')
  }

  const submitDismiss = async () => {
    if (!selected || selected.resolved || submitting) return
    const reason = dismissReason.trim()
    if (!reason) return
    setSubmitting(true)
    setFeedback(null)
    try {
      await questionsGlobalApi.dismiss(selected.id, reason)
      setDismissOpen(false)
      setDismissReason('')
      setFeedback({ type: 'success', message: 'Question dismissed. Waiting sessions resume when no pending questions remain.' })
      // Mesmo motivo do submitAnswer: resolvida, o detalhe não tem mais função.
      setDetailOpen(false)
      await fetchQuestions()
    } catch (error) {
      setFeedback({
        type: 'error',
        message: error instanceof Error ? error.message : 'Failed to dismiss question',
      })
    } finally {
      setSubmitting(false)
    }
  }

  const submitAnswer = async (text: string) => {
    const value = text.trim()
    if (!value || !selected || selected.resolved || submitting) return
    setSubmitting(true)
    setFeedback(null)
    try {
      await questionsGlobalApi.answer(selected.id, value)
      setAnswer('')
      setFeedback({ type: 'success', message: 'Answer sent. Session will resume shortly.' })
      // Volta para a inbox no mobile: respondida, essa pergunta sai da lista de
      // pendentes e ficar parado no detalhe dela não leva a lugar nenhum.
      setDetailOpen(false)
      await fetchQuestions()
    } catch (error) {
      setFeedback({
        type: 'error',
        message: error instanceof Error ? error.message : 'Failed to submit answer',
      })
    } finally {
      setSubmitting(false)
    }
  }

  const scoped = sessionFilter ? questions.filter((q) => q.sessionId === sessionFilter) : questions
  const pending = scoped.filter((q) => !q.resolved)
  const urgent = pending.filter((q) => q.priority === 'high')

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-sm text-muted-foreground">Loading questions...</div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      <div
        className={cn(
          'w-full lg:w-80 shrink-0 border-r border-border flex-col min-h-0',
          detailOpen ? 'hidden lg:flex' : 'flex',
        )}
      >
        <div className="px-4 py-3 border-b border-border">
          <h1 className="text-sm font-semibold text-foreground">Questions Inbox</h1>
          <p className="text-[11px] text-muted-foreground font-mono mt-0.5">
            {pending.length} pending · {urgent.length} urgent
          </p>
          {sessionFilter && (
            <button
              onClick={() => router.replace('/questions')}
              className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded bg-accent/20 text-primary hover:bg-accent/30 transition-colors"
              title={sessionFilter}
            >
              session {sessionFilter.slice(0, 8)}
              <X className="w-2.5 h-2.5" />
            </button>
          )}
        </div>
        <div className="flex border-b border-border">
          {(['pending', 'all', 'answered'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                'flex-1 py-2 text-[11px] font-mono transition-colors capitalize',
                filter === f ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          {fetchError && (
            <div className="mx-3 my-2 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
              <AlertCircle className="w-3 h-3 text-destructive shrink-0" />
              <p className="text-[11px] text-destructive leading-snug">{fetchError}</p>
            </div>
          )}
          {filtered.map((q) => (
            <QuestionCard
              key={q.id}
              question={q}
              selected={selectedId === q.id}
              onClick={() => selectQuestion(q.id)}
            />
          ))}
          {filtered.length === 0 && !nextCursor && (
            <div className="flex flex-col items-center justify-center h-40 gap-2">
              <CheckCheck className="w-5 h-5 text-status-done" />
              <span className="text-xs text-muted-foreground">
                {filter === 'answered' ? 'No answered questions' : 'All answered'}
              </span>
            </div>
          )}
          {nextCursor && (
            <div className="p-3">
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="w-full flex items-center justify-center gap-1.5 text-[11px] font-mono py-2 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {loadingMore ? (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Loading...
                  </>
                ) : (
                  'Load more'
                )}
              </button>
            </div>
          )}
        </div>
      </div>

      <div
        className={cn(
          'flex-1 min-w-0 flex-col min-h-0',
          detailOpen ? 'flex' : 'hidden lg:flex',
        )}
      >
        {selected ? (
          <>
            <div className="px-4 lg:px-6 py-4 border-b border-border">
              <button
                onClick={() => setDetailOpen(false)}
                className="lg:hidden inline-flex items-center gap-1 -ml-1 mb-2 px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                Inbox
              </button>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <span
                      className={cn(
                        'text-[10px] font-mono px-1.5 py-0.5 rounded',
                        priorityConfig[selected.priority].bg,
                        priorityConfig[selected.priority].text
                      )}
                    >
                      {priorityConfig[selected.priority].label.toUpperCase()}
                    </span>
                    {selected.kind && <KindBadge kind={selected.kind} />}
                    <span className="text-[10px] font-mono text-muted-foreground" title={selected.id}>
                      {selected.displayId}
                    </span>
                  </div>
                  <h2 className="text-sm font-semibold text-foreground leading-snug">{selected.text}</h2>
                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    <span className="text-[11px] font-mono text-primary" title={selected.sessionId}>
                      {selected.sessionDisplayId}
                    </span>
                    <span className="text-[11px] text-muted-foreground">·</span>
                    <span className="text-[11px] text-muted-foreground">{selected.agent}</span>
                    <span className="text-[11px] text-muted-foreground">·</span>
                    <span className="text-[11px] text-muted-foreground">{selected.task}</span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    <span className="text-[10px] font-mono text-muted-foreground">{selected.branch}</span>
                    <span className="text-[10px] text-muted-foreground">·</span>
                    <span className="text-[10px] font-mono text-muted-foreground">stage: {selected.stage}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-4 lg:p-6 space-y-4">
              {selected.context && (
                <div className="rounded-lg border border-border bg-muted/20 p-4">
                  <p className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-2">Context from agent</p>
                  <p className="text-xs text-foreground leading-relaxed whitespace-pre-wrap">{selected.context}</p>
                </div>
              )}

              {selected.dismissed && (
                <div className="rounded-lg border border-border bg-muted/30 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
                    <p className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">
                      Dismissed
                      {selected.dismissAudit?.dismissedBy ? ` · by ${selected.dismissAudit.dismissedBy}` : ''}
                      {selected.dismissAudit?.at ? ` · ${new Date(selected.dismissAudit.at).toLocaleString()}` : ''}
                    </p>
                  </div>
                  <p className="text-xs text-foreground leading-relaxed whitespace-pre-wrap">
                    {selected.dismissAudit?.reason || selected.answer || 'No reason recorded'}
                  </p>
                </div>
              )}

              {!selected.resolved && selected.suggestion && (
                <div className="rounded-lg border border-primary/20 bg-accent/10 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Zap className="w-3.5 h-3.5 text-primary" />
                    <p className="text-[10px] uppercase tracking-widest font-mono text-primary">
                      Master Agent suggestion
                      {typeof selected.suggestion.confidence === 'number' &&
                        ` · ${Math.round(selected.suggestion.confidence * (selected.suggestion.confidence <= 1 ? 100 : 1))}% confidence`}
                    </p>
                  </div>
                  <p className="text-xs text-foreground leading-relaxed whitespace-pre-wrap">
                    {selected.suggestion.answer}
                  </p>
                  {selected.suggestion.reason && (
                    <p className="text-[11px] text-muted-foreground mt-1.5">{selected.suggestion.reason}</p>
                  )}
                  <button
                    onClick={() => setAnswer(selected.suggestion!.answer)}
                    className="mt-2 text-[11px] text-primary hover:underline"
                  >
                    Use this answer
                  </button>
                </div>
              )}

              {selected.answered && selected.options && selected.options.length > 0 && (
                <div className="rounded-lg border border-border bg-muted/20 p-4">
                  <p className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-2">Options offered</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    {selected.options.map((option) => (
                      <span
                        key={option}
                        className={cn(
                          'text-xs px-3 py-1.5 rounded-md border',
                          selected.answer === option
                            ? 'border-status-done/50 bg-status-done/10 text-status-done'
                            : 'border-border bg-card text-muted-foreground'
                        )}
                      >
                        {option}
                        {selected.recommended === option && <Star className="w-3 h-3 inline ml-1.5 -mt-0.5" />}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {selected.answeredBy === 'master-agent' && (
                <div className="rounded-lg border border-primary/20 bg-accent/10 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Zap className="w-3.5 h-3.5 text-primary" />
                    <p className="text-[10px] uppercase tracking-widest font-mono text-primary">
                      Auto-answered by Master Agent
                      {typeof selected.confidence === 'number' &&
                        ` · ${Math.round(selected.confidence * (selected.confidence <= 1 ? 100 : 1))}% confidence`}
                    </p>
                  </div>
                  {selected.reason && (
                    <p className="text-xs text-foreground leading-relaxed">{selected.reason}</p>
                  )}
                </div>
              )}

              {selected.answered && selected.answer && (
                <div className="rounded-lg border border-status-done/20 bg-status-done/5 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCheck className="w-3.5 h-3.5 text-status-done" />
                    <p className="text-[10px] uppercase tracking-widest font-mono text-status-done">
                      {selected.answeredBy === 'master-agent' ? 'Master Agent Answer' : 'Your Answer'}
                    </p>
                  </div>
                  <p className="text-xs text-foreground leading-relaxed whitespace-pre-wrap">{selected.answer}</p>
                </div>
              )}

              {feedback && (
                <div
                  className={cn(
                    'rounded-lg border p-3 flex items-center gap-2',
                    feedback.type === 'success'
                      ? 'border-status-done/20 bg-status-done/5'
                      : 'border-destructive/30 bg-destructive/5'
                  )}
                >
                  {feedback.type === 'success' ? (
                    <CheckCheck className="w-3.5 h-3.5 text-status-done shrink-0" />
                  ) : (
                    <AlertCircle className="w-3.5 h-3.5 text-destructive shrink-0" />
                  )}
                  <p className={cn('text-xs', feedback.type === 'success' ? 'text-status-done' : 'text-destructive')}>
                    {feedback.message}
                  </p>
                </div>
              )}
            </div>

            {!selected.resolved && (
              <div className="px-4 lg:px-6 pb-4 lg:pb-6 pt-3 border-t border-border">
                <div className="flex flex-col gap-2">
                  {selected.options && selected.options.length > 0 && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">Options</span>
                      {selected.options.map((option) => {
                        const isRecommended =
                          selected.recommended === option ||
                          (!selected.recommended && selected.suggestion?.answer === option)
                        const isSelected = answer === option
                        return (
                          <button
                            key={option}
                            onClick={() => setAnswer(option)}
                            disabled={submitting}
                            title={isRecommended ? 'Recommended option' : undefined}
                            className={cn(
                              'text-xs px-3 py-1.5 rounded-md border transition-colors disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1.5',
                              isSelected
                                ? 'border-primary bg-primary/10 text-primary'
                                : isRecommended
                                  ? 'border-primary/50 bg-accent/10 text-foreground hover:bg-primary/10'
                                  : 'border-border bg-card text-foreground hover:border-primary/50 hover:bg-accent/10'
                            )}
                          >
                            {isRecommended && <Star className="w-3 h-3 text-primary" />}
                            {option}
                            {isRecommended && (
                              <span className="text-[9px] font-mono text-primary">Recommended</span>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  )}
                  <textarea
                    className="w-full bg-input rounded-md px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground outline-none resize-none leading-relaxed border border-border focus:border-primary/50 transition-colors"
                    placeholder="Type your answer..."
                    rows={3}
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                    disabled={submitting}
                  />
                  {/* Empilha no mobile: em 390px a legenda e os dois botões na
                      mesma linha esmagavam o "Send Answer" para duas linhas. */}
                  <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2">
                    <span className="text-[10px] text-muted-foreground">
                      Session will resume immediately after your reply
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => {
                          setDismissOpen(!dismissOpen)
                          setFeedback(null)
                        }}
                        disabled={submitting}
                        className={cn(
                          'flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
                          dismissOpen
                            ? 'border-destructive/50 bg-destructive/10 text-destructive'
                            : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted/40'
                        )}
                        title="Dismiss this question as obsolete (no answer needed)"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Dismiss
                      </button>
                      <button
                        onClick={() => submitAnswer(answer)}
                        disabled={!answer.trim() || submitting}
                        className="flex items-center gap-1.5 text-xs bg-primary text-primary-foreground px-4 py-1.5 rounded-md hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium"
                      >
                        <Send className="w-3.5 h-3.5" />
                        {submitting ? 'Sending...' : 'Send Answer'}
                      </button>
                    </div>
                  </div>

                  {dismissOpen && (
                    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-2">
                      <p className="text-[11px] text-foreground">
                        Dismiss this question as obsolete? The session is notified with{' '}
                        <span className="font-mono">DISMISSED: &lt;reason&gt;</span> and no human answer is recorded.
                      </p>
                      <input
                        type="text"
                        value={dismissReason}
                        onChange={(e) => setDismissReason(e.target.value)}
                        placeholder="Reason (required) — e.g. already resolved in a later stage"
                        disabled={submitting}
                        className="w-full bg-input rounded-md px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground outline-none border border-border focus:border-destructive/50 transition-colors"
                      />
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => {
                            setDismissOpen(false)
                            setDismissReason('')
                          }}
                          disabled={submitting}
                          className="text-[11px] text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-md transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={submitDismiss}
                          disabled={!dismissReason.trim() || submitting}
                          className="flex items-center gap-1.5 text-[11px] bg-destructive text-destructive-foreground px-3 py-1.5 rounded-md hover:bg-destructive/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                          <Trash2 className="w-3 h-3" />
                          {submitting ? 'Dismissing...' : 'Confirm dismiss'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center space-y-2">
              <CheckCheck className="w-8 h-8 text-status-done mx-auto" />
              <p className="text-sm font-medium text-foreground">All questions answered</p>
              <p className="text-xs text-muted-foreground">Sessions are running autonomously</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function QuestionsPage() {
  return (
    <Shell>
      <Suspense
        fallback={
          <div className="flex items-center justify-center h-full">
            <div className="text-sm text-muted-foreground">Loading questions...</div>
          </div>
        }
      >
        <QuestionsInbox />
      </Suspense>
    </Shell>
  )
}
