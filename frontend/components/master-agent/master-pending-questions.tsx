'use client'

import Link from 'next/link'
import { CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Question } from '@/lib/api'

type Priority = 'high' | 'normal' | 'low'

/** Mesma paleta de prioridade da página /questions. */
const priorityStyle: Record<Priority, { dot: string; text: string; label: string }> = {
  high: { dot: 'bg-destructive', text: 'text-destructive', label: 'Urgent' },
  normal: { dot: 'bg-status-waiting', text: 'text-status-waiting', label: 'Medium' },
  low: { dot: 'bg-status-done', text: 'text-status-done', label: 'Optional' },
}

function priorityOf(value: string | undefined): Priority {
  return value === 'high' || value === 'low' ? value : 'normal'
}

interface MasterPendingQuestionsProps {
  questions: Question[]
  loading?: boolean
  /** Quantas linhas mostrar — o resto vira "+N more" para /questions. */
  limit?: number
  className?: string
}

/**
 * Perguntas pendentes das sessões, com prioridade e origem.
 *
 * É a fila que trava o pipeline: fica visível no painel, não atrás de um
 * clique. Cada linha abre a inbox já filtrada pela sessão de origem.
 */
export function MasterPendingQuestions({
  questions,
  loading = false,
  limit = 5,
  className,
}: MasterPendingQuestionsProps) {
  if (loading) {
    return (
      <div className={cn('divide-y divide-border/50', className)}>
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="px-4 py-3 space-y-2">
            <div className="h-2.5 w-full rounded bg-muted/40 animate-pulse" />
            <div className="h-2.5 w-1/2 rounded bg-muted/30 animate-pulse" />
          </div>
        ))}
      </div>
    )
  }

  if (questions.length === 0) {
    return (
      <div className={cn('flex flex-col items-center justify-center gap-2 px-4 py-8 text-center', className)}>
        <CheckCircle2 className="w-6 h-6 text-status-done/60" />
        <p className="text-xs text-foreground">Nothing waiting on you</p>
        <p className="text-[11px] text-muted-foreground">Agents will ask here when they get stuck.</p>
      </div>
    )
  }

  const visible = questions.slice(0, limit)
  const rest = questions.length - visible.length

  return (
    <div className={cn('divide-y divide-border/50', className)}>
      {visible.map((q) => {
        const style = priorityStyle[priorityOf(q.priority)]
        return (
          <Link
            key={q.id}
            href={`/questions?session=${q.sessionId}`}
            className="flex items-start gap-2.5 px-4 py-2.5 hover:bg-muted/20 transition-colors"
          >
            <div className={cn('w-1.5 h-1.5 rounded-full shrink-0 mt-1.5', style.dot)} />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-foreground leading-snug line-clamp-2">{q.question}</p>
              <div className="flex items-center gap-1.5 mt-1 text-[10px] font-mono text-muted-foreground min-w-0">
                <span className={cn('shrink-0', style.text)}>{style.label}</span>
                <span className="text-muted-foreground/40">·</span>
                <span className="truncate">{q.session?.macroTask?.title || 'Unknown task'}</span>
                {q.session?.currentStage && (
                  <>
                    <span className="text-muted-foreground/40">·</span>
                    <span className="shrink-0">{q.session.currentStage}</span>
                  </>
                )}
              </div>
              {q.session?.branchName && (
                <p className="text-[10px] font-mono text-muted-foreground/60 truncate mt-0.5">
                  {q.session.branchName}
                </p>
              )}
            </div>
            <span className="text-[10px] font-mono text-muted-foreground/60 shrink-0 mt-0.5">
              {new Date(q.createdAt).toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
              })}
            </span>
          </Link>
        )
      })}
      {rest > 0 && (
        <Link
          href="/questions"
          className="block px-4 py-2 text-[10px] font-mono text-primary hover:underline"
        >
          +{rest} more pending question{rest > 1 ? 's' : ''}
        </Link>
      )}
    </div>
  )
}
