'use client'

import Link from 'next/link'
import { Clock, GitBranch, MessageSquare, SquareTerminal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { isSessionAlive, LIVE_SESSION_STATUSES } from '@/lib/status'

export { LIVE_SESSION_STATUSES }

/** Linha de sessão já pronta para exibição — a página não formata nada. */
export interface LiveSessionView {
  id: string
  shortId: string
  /** Título da macro task (ou fallback quando o join não veio). */
  title: string
  branch: string
  stage: string
  status: string
  pendingQuestions: number
  startedAt: string
}

/** A sessão está viva? Aceita o objeto cru da API. `paused` conta — ver `lib/status.ts`. */
export function isLiveSession(raw: any): boolean {
  return isSessionAlive(raw?.status)
}

/** Mapeia `GET /sessions` para a linha do painel. */
export function toLiveSessionView(raw: any): LiveSessionView {
  const pending = Array.isArray(raw?.questions)
    ? raw.questions.filter((q: any) => q?.status === 'pending').length
    : 0
  return {
    id: raw.id,
    shortId: String(raw.id).slice(0, 8),
    title: raw?.macroTask?.title || 'Unknown task',
    branch: raw?.branchName || '—',
    stage: raw?.currentStage || '—',
    status: raw?.status || 'initializing',
    pendingQuestions: pending,
    startedAt: raw?.startedAt || raw?.createdAt,
  }
}

const statusStyle: Record<string, { dot: string; badge: string; text: string }> = {
  initializing: { dot: 'bg-status-idle', badge: 'bg-muted', text: 'text-muted-foreground' },
  running: { dot: 'bg-status-running animate-pulse', badge: 'bg-status-running/15', text: 'text-status-running' },
  waiting: { dot: 'bg-status-waiting', badge: 'bg-status-waiting/15', text: 'text-status-waiting' },
  paused: { dot: 'bg-status-waiting', badge: 'bg-status-waiting/15', text: 'text-status-waiting' },
}

/** "há quanto tempo roda" — só grão de minuto/hora, sem timer por segundo. */
function elapsedSince(startedAt: string | undefined): string {
  if (!startedAt) return '—'
  const start = new Date(startedAt).getTime()
  if (!Number.isFinite(start)) return '—'
  const minutes = Math.floor(Math.max(0, Date.now() - start) / 60000)
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

interface MasterLiveSessionsProps {
  sessions: LiveSessionView[]
  loading?: boolean
  className?: string
}

/**
 * Sessões vivas do projeto — o "o que está acontecendo agora" que faltava na
 * página do Master.
 *
 * Cada linha leva ao terminal daquela sessão. Não mostramos "stage X de N":
 * `GET /sessions` não traz as stages do pipeline, e inventar porcentagem em
 * cima do stage atual seria progresso falso.
 */
export function MasterLiveSessions({ sessions, loading = false, className }: MasterLiveSessionsProps) {
  if (loading) {
    return (
      <div className={cn('divide-y divide-border/50', className)}>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3">
            <div className="w-1.5 h-1.5 rounded-full bg-muted animate-pulse shrink-0" />
            <div className="h-2.5 w-14 rounded bg-muted/50 animate-pulse shrink-0" />
            <div className="h-2.5 flex-1 rounded bg-muted/30 animate-pulse" />
          </div>
        ))}
      </div>
    )
  }

  if (sessions.length === 0) {
    return (
      <div className={cn('flex flex-col items-center justify-center gap-2 px-4 py-8 text-center', className)}>
        <SquareTerminal className="w-6 h-6 text-muted-foreground/50" />
        <p className="text-xs text-foreground">No live sessions</p>
        <p className="text-[11px] text-muted-foreground">
          Start a{' '}
          <Link href="/macro-tasks" className="text-primary hover:underline">
            macro task
          </Link>{' '}
          to spin one up.
        </p>
      </div>
    )
  }

  return (
    <div className={cn('divide-y divide-border/50', className)}>
      {sessions.map((s) => {
        const style = statusStyle[s.status] ?? statusStyle.initializing
        return (
          <Link
            key={s.id}
            href={`/terminal?session=${s.id}`}
            className="flex items-center gap-2.5 px-4 py-2.5 hover:bg-muted/20 transition-colors"
            title={`${s.title} — ${s.status}`}
          >
            <div className={cn('w-1.5 h-1.5 rounded-full shrink-0', style.dot)} />
            <span className="text-[10px] font-mono text-primary shrink-0">{s.shortId}</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-foreground truncate">{s.title}</p>
              <span className="flex items-center gap-1 mt-0.5 text-[10px] font-mono text-muted-foreground">
                <GitBranch className="w-3 h-3 shrink-0" />
                <span className="truncate">{s.branch}</span>
              </span>
            </div>
            {s.pendingQuestions > 0 && (
              <span className="flex items-center gap-1 text-[10px] font-mono text-destructive shrink-0">
                <MessageSquare className="w-3 h-3" />
                {s.pendingQuestions}
              </span>
            )}
            <span
              className={cn(
                'text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0 max-w-28 truncate',
                style.badge,
                style.text,
              )}
            >
              {s.stage.toUpperCase()}
            </span>
            <span className="hidden xl:flex items-center gap-1 text-[10px] font-mono text-muted-foreground shrink-0">
              <Clock className="w-3 h-3" />
              {elapsedSince(s.startedAt)}
            </span>
          </Link>
        )
      })}
    </div>
  )
}
