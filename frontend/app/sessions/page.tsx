'use client'

import { Shell } from '@/components/shell'
import { Terminal as SessionTerminal } from '@/components/terminal'
import { cn } from '@/lib/utils'
import { copyToClipboard } from '@/lib/clipboard'
import { SkeletonTable } from '@/components/ui/skeleton'
import {
  sessionsApi,
  artifactsApi,
  pipelineExecutionApi,
  terminalApi,
  type SDDArtifact,
  type GovernorStatus,
} from '@/lib/api'
import { useGlobalSSE, type SseEvent } from '@/lib/use-sse'
import { useProject } from '@/lib/project-context'
import {
  GitBranch,
  MessageSquare,
  ChevronDown,
  ChevronRight,
  Clock,
  Cpu,
  Copy,
  FileText,
  GitPullRequest,
  Play,
  SquareTerminal,
  X,
  AlertTriangle,
  RotateCcw,
  Terminal,
  Inbox,
  Filter,
  Calendar,
  Eraser,
  History,
  ListTree,
  Loader2,
  SkipForward,
  Link2Off,
  Activity,
} from 'lucide-react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useState, useEffect, useCallback, useRef, useMemo, Suspense } from 'react'
import { useToast } from '@/components/toast-provider'
import { ConfirmModal } from '@/components/confirm-modal'

type SessionStatus =
  | 'initializing'
  | 'running'
  | 'waiting'
  | 'paused'
  | 'completed'
  | 'stopped'
  | 'failed'
  | 'timeout'

interface SessionView {
  id: string
  shortId: string
  task: string
  projectId?: string
  macroTaskId?: string
  pipelineId?: string
  branch: string
  worktreePath: string
  tmuxSession?: string
  model: string
  agent: string
  status: SessionStatus
  stage: string
  pendingQuestions: number
  startedAt: string
  completedAt?: string
  stalledAt?: string | null
  stageData?: any
  /**
   * CLI vivo no tmux mas sem PTY no backend (MT-11). Diferente de
   * `lastActivityAt` ausente: aqui a informação existe e o backend perdeu o
   * vínculo — a sessão segue trabalhando e a UI não consegue mais escrever nela.
   */
  linkLost?: boolean
  lastActivityAt?: string | null
}

type StageState = 'completed' | 'running' | 'failed' | 'pending'

interface ExecStage {
  name: string
  status: StageState
  completedAt?: string
  summary?: string
}

interface ExecStatus {
  sessionId: string
  status: string
  currentStage: string
  stages: ExecStage[]
  questions: { total: number; pending: number; answered: number }
  artifacts: number
  pauseReason?: string
}

function mapApiSession(s: any): SessionView {
  return {
    id: s.id,
    shortId: s.id.slice(0, 8),
    task: s.macroTask?.title || 'Unknown Task',
    projectId: s.macroTask?.projectId,
    macroTaskId: s.macroTaskId || s.macroTask?.id,
    pipelineId: s.macroTask?.pipelineId,
    branch: s.branchName,
    worktreePath: s.worktreePath,
    tmuxSession: s.tmuxSession,
    model: s.agent?.model || 'unknown',
    agent: s.agent?.name || 'Unknown',
    status: (s.status as SessionStatus) || 'initializing',
    stage: s.currentStage || '—',
    pendingQuestions: s.questions?.filter((q: any) => q.status === 'pending').length || 0,
    startedAt: s.startedAt,
    completedAt: s.completedAt,
    stalledAt: s.stalledAt || s.stageData?.stalledAt || null,
    stageData: s.stageData,
    linkLost: s.linkLost ?? false,
    lastActivityAt: s.lastActivityAt ?? null,
  }
}

/** Minutos desde o último sinal de vida — o "silent Xm" só aparece acima de 5. */
function silentMinutes(lastActivityAt: string, now: number): number {
  return Math.floor(Math.max(0, now - new Date(lastActivityAt).getTime()) / 60000)
}

function formatDuration(startedAt: string, completedAt: string | undefined, now: number): string {
  const start = new Date(startedAt).getTime()
  const end = completedAt ? new Date(completedAt).getTime() : now
  const ms = Math.max(0, end - start)
  const totalMinutes = Math.floor(ms / 60000)
  if (totalMinutes < 1) return '<1m'
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours < 1) return `${minutes}m`
  return `${hours}h ${minutes}m`
}

const statusConfig: Record<SessionStatus, { dot: string; label: string; badge: string; text: string }> = {
  initializing: { dot: 'bg-status-idle', label: 'Initializing', badge: 'bg-muted', text: 'text-muted-foreground' },
  running: { dot: 'bg-status-running animate-pulse', label: 'Running', badge: 'bg-status-running/15', text: 'text-status-running' },
  waiting: { dot: 'bg-status-waiting', label: 'Waiting', badge: 'bg-status-waiting/15', text: 'text-status-waiting' },
  paused: { dot: 'bg-status-waiting', label: 'Paused', badge: 'bg-status-waiting/15', text: 'text-status-waiting' },
  completed: { dot: 'bg-status-done', label: 'Completed', badge: 'bg-status-done/15', text: 'text-status-done' },
  // Abortada manualmente (kill/stop) — diferente de Completed
  stopped: { dot: 'bg-muted-foreground/60', label: 'Interrompida', badge: 'bg-muted/60', text: 'text-muted-foreground' },
  failed: { dot: 'bg-destructive', label: 'Failed', badge: 'bg-destructive/15', text: 'text-destructive' },
  timeout: { dot: 'bg-destructive', label: 'Timeout', badge: 'bg-destructive/15', text: 'text-destructive' },
}

const allStatuses: SessionStatus[] = ['running', 'waiting', 'completed', 'stopped', 'failed', 'paused', 'initializing', 'timeout']

/** MT-10 — mesmo vocabulário de fila usado nos logs do backend (session-governor.service.ts). */
const queueReasonLabel: Record<'global' | 'project' | 'resource', string> = {
  global: 'teto global',
  project: 'teto do projeto',
  resource: 'pressão de recurso',
}

const stageDotColor: Record<StageState, string> = {
  completed: 'bg-status-done',
  running: 'bg-status-running animate-pulse',
  failed: 'bg-destructive',
  pending: 'bg-status-idle',
}

const stageTextColor: Record<StageState, string> = {
  completed: 'text-status-done',
  running: 'text-status-running',
  failed: 'text-destructive',
  pending: 'text-muted-foreground',
}

type DatePreset = 'all' | '24h' | '7d' | '30d' | 'custom'

function StageStepper({ stages }: { stages: ExecStage[] }) {
  if (stages.length === 0) {
    return <p className="text-[11px] text-muted-foreground font-mono">No stage data available</p>
  }
  return (
    <div className="flex items-start gap-1 overflow-x-auto pb-1">
      {stages.map((stage, i) => (
        <div key={`${stage.name}-${i}`} className="flex items-start gap-1 shrink-0">
          <div
            className="flex flex-col items-center gap-0.5 max-w-28"
            title={[
              stage.summary,
              stage.completedAt ? `Completed at ${new Date(stage.completedAt).toLocaleString()}` : null,
            ]
              .filter(Boolean)
              .join(' — ') || undefined}
          >
            <div className={cn('w-1.5 h-1.5 rounded-full', stageDotColor[stage.status])} />
            <span className={cn('text-[9px] font-mono whitespace-nowrap', stageTextColor[stage.status])}>
              {stage.name}
            </span>
            {stage.completedAt ? (
              <span className="text-[9px] font-mono text-muted-foreground/60">
                {new Date(stage.completedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}
              </span>
            ) : (
              <span className="text-[9px] font-mono text-muted-foreground/40">
                {stage.status === 'running' ? '...' : ''}
              </span>
            )}
          </div>
          {i < stages.length - 1 && (
            <div
              className={cn(
                'w-6 h-px mt-[3px] shrink-0',
                stage.status === 'completed' ? 'bg-status-done/40' : 'bg-border'
              )}
            />
          )}
        </div>
      ))}
    </div>
  )
}

function ArtifactModal({ artifact, onClose }: { artifact: SDDArtifact; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-lg w-full max-w-3xl max-h-[80vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                {artifact.type}
              </span>
              <span className="text-xs font-mono text-foreground truncate">{artifact.path}</span>
            </div>
            <p className="text-[10px] font-mono text-muted-foreground mt-1">
              {new Date(artifact.createdAt).toLocaleString()}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors shrink-0"
            aria-label="Close artifact"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-auto p-4">
          {artifact.content ? (
            <pre className="text-[11px] font-mono leading-relaxed text-foreground/80 whitespace-pre-wrap">
              {artifact.content}
            </pre>
          ) : (
            <p className="text-xs text-muted-foreground font-mono">No content stored for this artifact.</p>
          )}
        </div>
      </div>
    </div>
  )
}

function SessionRow({
  session,
  now,
  onRefetch,
}: {
  session: SessionView
  now: number
  onRefetch: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [showTerminal, setShowTerminal] = useState(false)
  const [execStatus, setExecStatus] = useState<ExecStatus | null>(null)
  const [execLoading, setExecLoading] = useState(false)
  const [artifacts, setArtifacts] = useState<SDDArtifact[]>([])
  const [openArtifact, setOpenArtifact] = useState<SDDArtifact | null>(null)
  const [attachCmd, setAttachCmd] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [confirming, setConfirming] = useState<'kill' | 'delete' | null>(null)
  const [confirmingSkip, setConfirmingSkip] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cfg = statusConfig[session.status] ?? statusConfig.initializing
  const pending = execStatus?.questions.pending ?? session.pendingQuestions
  const highlightArtifacts = artifacts.filter((a) => a.type === 'merge' || a.type === 'pull-request')
  const regularArtifacts = artifacts.filter((a) => a.type !== 'merge' && a.type !== 'pull-request')

  useEffect(() => {
    if (!expanded) return
    let cancelled = false

    if (session.pipelineId) {
      setExecLoading(true)
      pipelineExecutionApi
        .getStatus(session.pipelineId, session.id)
        .then((status: ExecStatus) => {
          if (!cancelled) setExecStatus(status)
        })
        .catch((err) => console.error('Failed to fetch pipeline status:', err))
        .finally(() => {
          if (!cancelled) setExecLoading(false)
        })
    }

    artifactsApi
      .list(session.id)
      .then((list) => {
        if (!cancelled) setArtifacts(list)
      })
      .catch((err) => console.error('Failed to fetch artifacts:', err))

    return () => {
      cancelled = true
    }
  }, [expanded, session])

  useEffect(() => () => {
    if (confirmTimer.current) clearTimeout(confirmTimer.current)
  }, [])

  const armConfirm = (action: 'kill' | 'delete') => {
    setConfirming(action)
    if (confirmTimer.current) clearTimeout(confirmTimer.current)
    confirmTimer.current = setTimeout(() => setConfirming(null), 4000)
  }

  const runAction = async (name: string, fn: () => Promise<unknown>) => {
    setBusy(name)
    setActionError(null)
    try {
      await fn()
      onRefetch()
    } catch (error: any) {
      setActionError(error?.message || `Failed to ${name}`)
    } finally {
      setBusy(null)
      setConfirming(null)
    }
  }

  const handleAttachCmd = async () => {
    setBusy('attach')
    setActionError(null)
    try {
      const result = await terminalApi.open(session.id)
      setAttachCmd(result.command || result.message || result.path)
    } catch (error: any) {
      setActionError(error?.message || 'Failed to get attach command')
    } finally {
      setBusy(null)
    }
  }

  const copyAttachCmd = async () => {
    if (!attachCmd) return
    // Falha ia só para o console: pelo IP da LAN em http o `navigator.clipboard`
    // não existe, então no celular o botão não fazia nada e nada explicava.
    if (await copyToClipboard(attachCmd)) {
      setCopied(true)
      setActionError(null)
      setTimeout(() => setCopied(false), 2000)
    } else {
      setActionError('Não foi possível copiar — selecione o comando e copie à mão.')
    }
  }

  const canResume = session.status === 'paused' || session.status === 'waiting'
  const canKill = session.status === 'running' || session.status === 'initializing' || canResume
  const canDelete =
    session.status === 'completed' ||
    session.status === 'stopped' ||
    session.status === 'failed' ||
    session.status === 'timeout'
  const duration = formatDuration(session.startedAt, session.completedAt, now)

  return (
    <div className="border border-border rounded-lg bg-card overflow-hidden">
      <div
        className="cursor-pointer hover:bg-muted/20 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="hidden sm:flex items-center gap-4 px-4 py-3">
          <div className={cn('w-1.5 h-1.5 rounded-full shrink-0', cfg.dot)} />
          <div className="w-16 shrink-0">
            <span className="text-xs font-mono font-semibold text-primary">{session.shortId}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-foreground">{session.task}</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <GitBranch className="w-3 h-3 text-muted-foreground" />
              <span className="text-[10px] font-mono text-muted-foreground">{session.branch}</span>
            </div>
          </div>
          <div className="w-28 shrink-0">
            <span className={cn('text-[10px] font-mono px-1.5 py-0.5 rounded', cfg.badge, cfg.text)}>
              {session.stage.toUpperCase()}
            </span>
          </div>
          <div className="w-32 shrink-0">
            <p className="text-xs font-mono text-muted-foreground">{session.model}</p>
          </div>
          <div className="flex items-center gap-3 shrink-0 w-32">
            {pending > 0 && (
              <div className="flex items-center gap-1">
                <MessageSquare className="w-3 h-3 text-destructive" />
                <span className="text-[10px] font-mono text-destructive">{pending}</span>
              </div>
            )}
            <div className="flex items-center gap-1">
              <Clock className="w-3 h-3 text-muted-foreground" />
              <span className="text-[10px] font-mono text-muted-foreground">{duration}</span>
            </div>
          </div>
          <ChevronDown className={cn('w-3.5 h-3.5 text-muted-foreground transition-transform shrink-0', expanded && 'rotate-180')} />
        </div>

        <div className="sm:hidden px-4 py-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className={cn('w-1.5 h-1.5 rounded-full shrink-0', cfg.dot)} />
              <span className="text-[10px] font-mono font-semibold text-primary shrink-0">{session.shortId}</span>
              <span className="text-xs font-medium text-foreground truncate">{session.task}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className={cn('text-[10px] font-mono px-1.5 py-0.5 rounded', cfg.badge, cfg.text)}>
                {session.stage.toUpperCase()}
              </span>
              <ChevronDown className={cn('w-3.5 h-3.5 text-muted-foreground transition-transform', expanded && 'rotate-180')} />
            </div>
          </div>
          <div className="flex items-center gap-3 text-[10px] font-mono text-muted-foreground flex-wrap">
            <div className="flex items-center gap-1">
              <GitBranch className="w-3 h-3" />
              {session.branch}
            </div>
            <div className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {duration}
            </div>
            {pending > 0 && (
              <div className="flex items-center gap-1 text-destructive">
                <MessageSquare className="w-3 h-3" />
                {pending} pending
              </div>
            )}
            {/* Vínculo perdido e silêncio ficam na linha fechada de propósito:
                até a MT-11 a sessão sem PTY aparecia como se estivesse normal e
                só um clique (ou o pane na mão) revelava o problema. */}
            {session.linkLost && (
              <div
                className="flex items-center gap-1 text-status-waiting"
                title="CLI vivo no tmux, mas o backend não tem PTY para ele — telemetria e input pela UI indisponíveis até reanexar"
              >
                <Link2Off className="w-3 h-3" />
                link lost
              </div>
            )}
            {/* Só em running/waiting: sessão `paused` está calada de propósito,
                e um "silent 3h" âmbar ali seria alarme falso. */}
            {session.lastActivityAt &&
              (session.status === 'running' || session.status === 'waiting') &&
              silentMinutes(session.lastActivityAt, now) >= 5 && (
              <div
                className="flex items-center gap-1 text-status-waiting"
                title={`Último sinal de vida: ${new Date(session.lastActivityAt).toLocaleString()}`}
              >
                <Activity className="w-3 h-3" />
                silent {formatDuration(session.lastActivityAt, undefined, now)}
              </div>
            )}
          </div>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border bg-muted/5">
          <div className="px-4 py-3 space-y-3">
            {session.linkLost && (
              <div className="flex items-center gap-3 px-3 py-2 rounded-md border border-status-waiting/30 bg-status-waiting/10">
                <Link2Off className="w-4 h-4 text-status-waiting shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-medium text-foreground">Runtime link lost</p>
                  <p className="text-[10px] text-muted-foreground">
                    The CLI is alive in tmux but the backend has no PTY for it — usually a backend
                    restart. Reattaching restores telemetry and terminal input without touching the
                    running CLI.
                  </p>
                </div>
                <button
                  onClick={() => runAction('reattach', () => sessionsApi.resume(session.id))}
                  disabled={busy !== null}
                  className="flex items-center gap-1.5 text-[11px] bg-status-waiting/20 text-status-waiting px-3 py-1.5 rounded-md hover:bg-status-waiting/30 transition-colors disabled:opacity-50 shrink-0"
                >
                  <RotateCcw className="w-3 h-3" />
                  {busy === 'reattach' ? 'Reattaching...' : 'Reattach'}
                </button>
              </div>
            )}

            {session.stalledAt && (
              <div className="flex items-center gap-3 px-3 py-2 rounded-md border border-status-waiting/30 bg-status-waiting/10">
                <AlertTriangle className="w-4 h-4 text-status-waiting shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-medium text-foreground">Session stalled</p>
                  {/* Mede `lastActivityAt`, não `stalledAt`: o segundo é a hora em
                      que o campo foi gravado, então um restart do backend
                      remarcava a sessão e zerava um número que se chama "no
                      output for". `stalledAt` só entra como reserva quando a API
                      não devolveu sinal de vida nenhum. */}
                  <p
                    className="text-[10px] text-muted-foreground"
                    title={`Marcada como travada em ${new Date(session.stalledAt).toLocaleString()}`}
                  >
                    No output for{' '}
                    {formatDuration(session.lastActivityAt || session.stalledAt, undefined, now)}
                  </p>
                </div>
                <button
                  onClick={() =>
                    runAction('restart-cli', () => sessionsApi.restartCli(session.id))
                  }
                  disabled={busy !== null}
                  className="flex items-center gap-1.5 text-[11px] bg-status-waiting/20 text-status-waiting px-3 py-1.5 rounded-md hover:bg-status-waiting/30 transition-colors disabled:opacity-50 shrink-0"
                >
                  <RotateCcw className="w-3 h-3" />
                  {busy === 'restart-cli' ? 'Restarting...' : 'Restart CLI'}
                </button>
              </div>
            )}

            <div>
              <p className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-2">
                Pipeline
              </p>
              {execLoading && !execStatus ? (
                <p className="text-[11px] text-muted-foreground font-mono">Loading stages...</p>
              ) : execStatus ? (
                <StageStepper stages={execStatus.stages} />
              ) : (
                <p className="text-[11px] text-muted-foreground font-mono">
                  {session.pipelineId ? 'No stage data available' : 'No pipeline linked to this session'}
                </p>
              )}
              {session.status === 'paused' && execStatus?.pauseReason && (
                <div className="mt-2 text-[11px] font-mono text-status-waiting bg-status-waiting/10 border border-status-waiting/20 rounded-md px-3 py-1.5">
                  Paused: {execStatus.pauseReason}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => setShowTerminal(!showTerminal)}
                className={cn(
                  'flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-md border transition-colors',
                  showTerminal
                    ? 'bg-primary/10 border-primary/30 text-primary'
                    : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted/40'
                )}
              >
                <SquareTerminal className="w-3.5 h-3.5" />
                {showTerminal ? 'Hide terminal' : 'Terminal'}
              </button>

              <button
                onClick={handleAttachCmd}
                disabled={busy === 'attach'}
                className="flex items-center gap-1.5 text-[11px] border border-border text-muted-foreground px-3 py-1.5 rounded-md hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-50"
                title="Get tmux attach command for this session"
              >
                <Copy className="w-3 h-3" />
                Attach cmd
              </button>

              {canResume && session.pipelineId && (
                <button
                  onClick={() =>
                    runAction('resume', () =>
                      pipelineExecutionApi.resume(session.pipelineId!, session.id)
                    )
                  }
                  disabled={busy !== null}
                  className="flex items-center gap-1.5 text-[11px] bg-status-done/15 text-status-done px-3 py-1.5 rounded-md hover:bg-status-done/25 transition-colors disabled:opacity-50"
                >
                  <Play className="w-3 h-3" />
                  {busy === 'resume' ? 'Resuming...' : 'Resume'}
                </button>
              )}

              {(session.status === 'failed' || session.status === 'paused') && session.pipelineId && (
                <button
                  onClick={() =>
                    runAction('retry-stage', () =>
                      pipelineExecutionApi.retryStage(session.pipelineId!, session.id)
                    )
                  }
                  disabled={busy !== null}
                  className="flex items-center gap-1.5 text-[11px] bg-primary/15 text-primary px-3 py-1.5 rounded-md hover:bg-primary/25 transition-colors disabled:opacity-50"
                >
                  <RotateCcw className="w-3 h-3" />
                  {busy === 'retry-stage' ? 'Retrying...' : 'Retry Stage'}
                </button>
              )}

              {['waiting', 'paused', 'running'].includes(session.status) && session.pipelineId && (
                <button
                  onClick={() => setConfirmingSkip(true)}
                  disabled={busy !== null}
                  className="flex items-center gap-1.5 text-[11px] border border-status-waiting/40 text-status-waiting px-3 py-1.5 rounded-md hover:bg-status-waiting/10 transition-colors disabled:opacity-50"
                  title={`Pular o stage atual (${session.stage}) e avançar o pipeline`}
                >
                  <SkipForward className="w-3 h-3" />
                  {busy === 'skip-stage' ? 'Skipping...' : 'Skip Stage'}
                </button>
              )}
              {confirmingSkip && (
                <ConfirmModal
                  title="Skip Stage"
                  message={`Pular o stage "${session.stage}" e avançar o pipeline? O stage será marcado como skipped e o agente seguirá para o próximo.`}
                  confirmLabel="Skip"
                  onConfirm={() => {
                    setConfirmingSkip(false)
                    runAction('skip-stage', () =>
                      pipelineExecutionApi.skipStage(session.pipelineId!, session.id)
                    )
                  }}
                  onCancel={() => setConfirmingSkip(false)}
                />
              )}

              {pending > 0 && (
                <Link
                  href={`/questions?session=${session.id}`}
                  className="flex items-center gap-1.5 text-[11px] bg-destructive/20 text-destructive px-3 py-1.5 rounded-md hover:bg-destructive/30 transition-colors"
                >
                  <MessageSquare className="w-3 h-3" />
                  Answer questions ({pending})
                </Link>
              )}

              {canKill && (
                <button
                  onClick={() =>
                    confirming === 'kill'
                      ? runAction('kill', () => sessionsApi.kill(session.id))
                      : armConfirm('kill')
                  }
                  disabled={busy !== null}
                  className={cn(
                    'text-[11px] px-3 py-1.5 rounded-md transition-colors disabled:opacity-50',
                    confirming === 'kill'
                      ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                      : 'bg-destructive/20 text-destructive hover:bg-destructive/30'
                  )}
                >
                  {busy === 'kill' ? 'Killing...' : confirming === 'kill' ? 'Confirm kill?' : 'Kill'}
                </button>
              )}

              {canDelete && (
                <button
                  onClick={() =>
                    confirming === 'delete'
                      ? runAction('delete', () => sessionsApi.delete(session.id))
                      : armConfirm('delete')
                  }
                  disabled={busy !== null}
                  className={cn(
                    'text-[11px] px-3 py-1.5 rounded-md transition-colors disabled:opacity-50',
                    confirming === 'delete'
                      ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                      : 'bg-destructive/20 text-destructive hover:bg-destructive/30'
                  )}
                >
                  {busy === 'delete' ? 'Deleting...' : confirming === 'delete' ? 'Confirm delete?' : 'Delete'}
                </button>
              )}
            </div>

            {actionError && (
              <p className="text-[11px] font-mono text-destructive">{actionError}</p>
            )}

            {attachCmd && (
              <div className="flex items-center gap-2 bg-muted/20 border border-border rounded-md px-3 py-1.5">
                <code className="text-[11px] font-mono text-foreground/80 flex-1 min-w-0 truncate">
                  {attachCmd}
                </code>
                <button
                  onClick={copyAttachCmd}
                  className="text-[10px] font-mono text-muted-foreground hover:text-foreground transition-colors shrink-0"
                >
                  {copied ? 'copied' : 'copy'}
                </button>
              </div>
            )}

            {artifacts.length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-2">
                  Artifacts
                </p>
                <div className="space-y-1">
                  {highlightArtifacts.map((artifact) => (
                    <button
                      key={artifact.id}
                      onClick={() => setOpenArtifact(artifact)}
                      className="w-full flex items-center gap-2 px-3 py-1.5 rounded-md bg-primary/10 border border-primary/30 text-left hover:bg-primary/15 transition-colors"
                    >
                      <GitPullRequest className="w-3.5 h-3.5 text-primary shrink-0" />
                      <span className="text-[10px] font-mono uppercase tracking-widest text-primary shrink-0">
                        {artifact.type}
                      </span>
                      <span className="text-[11px] font-mono text-foreground/80 truncate flex-1">
                        {artifact.path}
                      </span>
                      <span className="text-[10px] font-mono text-muted-foreground shrink-0 hidden sm:inline">
                        {new Date(artifact.createdAt).toLocaleString()}
                      </span>
                    </button>
                  ))}
                  {regularArtifacts.map((artifact) => (
                    <button
                      key={artifact.id}
                      onClick={() => setOpenArtifact(artifact)}
                      className="w-full flex items-center gap-2 px-3 py-1.5 rounded-md border border-border text-left hover:bg-muted/40 transition-colors"
                    >
                      <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground shrink-0">
                        {artifact.type}
                      </span>
                      <span className="text-[11px] font-mono text-foreground/80 truncate flex-1">
                        {artifact.path}
                      </span>
                      <span className="text-[10px] font-mono text-muted-foreground shrink-0 hidden sm:inline">
                        {new Date(artifact.createdAt).toLocaleString()}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {showTerminal && (
            <div className="border-t border-border h-[400px]">
              <SessionTerminal
                sessionId={session.id}
                worktreePath={session.worktreePath}
                onClose={() => setShowTerminal(false)}
              />
            </div>
          )}
        </div>
      )}

      {openArtifact && <ArtifactModal artifact={openArtifact} onClose={() => setOpenArtifact(null)} />}
    </div>
  )
}

interface MacroTaskGroup {
  macroTaskId: string
  title: string
  sessions: SessionView[]
  latestStatus: SessionStatus
}

function SessionsContent() {
  const searchParams = useSearchParams()
  const [sessions, setSessions] = useState<SessionView[]>([])
  const [loading, setLoading] = useState(true)
  const [governor, setGovernor] = useState<GovernorStatus | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const { currentProject } = useProject()
  const { toast } = useToast()

  const [taskFilter, setTaskFilter] = useState<string | null>(() => searchParams.get('task'))
  const [statusFilters, setStatusFilters] = useState<Set<SessionStatus>>(new Set())
  const [datePreset, setDatePreset] = useState<DatePreset>('all')
  const [customDateFrom, setCustomDateFrom] = useState('')
  const [customDateTo, setCustomDateTo] = useState('')
  const [groupByMacroTask, setGroupByMacroTask] = useState(true)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [showCleanupModal, setShowCleanupModal] = useState(false)
  const [cleanupDays, setCleanupDays] = useState(7)
  const [cleaning, setCleaning] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [historyData, setHistoryData] = useState<any[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [showFilters, setShowFilters] = useState(false)

  const fetchSessions = useCallback(async () => {
    try {
      // Com `limit`, o client retorna o objeto paginado { data, nextCursor }
      const result = await sessionsApi.list(
        currentProject ? { projectId: currentProject.id, limit: 200 } : { limit: 200 }
      )
      const apiSessions: any[] = Array.isArray(result) ? result : result?.data ?? []
      setSessions(apiSessions.map(mapApiSession))
    } catch (error) {
      console.error('Failed to fetch sessions:', error)
    } finally {
      setLoading(false)
    }
  }, [currentProject])

  /**
   * MT-10: slots usados/total + fila. Sessão enfileirada não vira nenhuma
   * Session no banco (de propósito, ver session-governor.service.ts) — sem
   * este fetch a fila seria simplesmente invisível na página.
   */
  const fetchGovernorStatus = useCallback(async () => {
    try {
      setGovernor(await sessionsApi.getGovernorStatus())
    } catch (error) {
      console.error('Failed to fetch governor status:', error)
    }
  }, [])

  useEffect(() => {
    fetchSessions()
    fetchGovernorStatus()
    const interval = setInterval(fetchSessions, 30000)
    const governorInterval = setInterval(fetchGovernorStatus, 15000)
    const tick = setInterval(() => setNow(Date.now()), 30000)
    return () => {
      clearInterval(interval)
      clearInterval(governorInterval)
      clearInterval(tick)
    }
  }, [fetchSessions, fetchGovernorStatus])

  const handleSseEvent = useCallback(
    (event: SseEvent) => {
      if (event.type.startsWith('session:') || event.type.startsWith('question:')) {
        fetchSessions()
        fetchGovernorStatus()
      }
    },
    [fetchSessions, fetchGovernorStatus]
  )

  useGlobalSSE(handleSseEvent, true, currentProject?.id)

  const filteredSessions = useMemo(() => {
    let result = sessions

    if (taskFilter) {
      result = result.filter(s => s.macroTaskId === taskFilter)
    }

    if (statusFilters.size > 0) {
      result = result.filter(s => statusFilters.has(s.status))
    }

    if (datePreset !== 'all' && datePreset !== 'custom') {
      // MT-25: usa o `now` do tick de 30s, não `Date.now()` — ler o relógio no
      // render é impuro (react-hooks/purity) e dois renders seguidos podiam
      // filtrar em janelas diferentes. É o mesmo clock das durações da lista.
      const nowMs = now
      const msMap: Record<string, number> = {
        '24h': 24 * 60 * 60 * 1000,
        '7d': 7 * 24 * 60 * 60 * 1000,
        '30d': 30 * 24 * 60 * 60 * 1000,
      }
      const cutoff = nowMs - (msMap[datePreset] || 0)
      result = result.filter(s => new Date(s.startedAt).getTime() >= cutoff)
    } else if (datePreset === 'custom') {
      if (customDateFrom) {
        const from = new Date(customDateFrom).getTime()
        result = result.filter(s => new Date(s.startedAt).getTime() >= from)
      }
      if (customDateTo) {
        const to = new Date(customDateTo).getTime()
        result = result.filter(s => new Date(s.startedAt).getTime() <= to)
      }
    }

    return result.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
  }, [sessions, taskFilter, statusFilters, datePreset, customDateFrom, customDateTo, now])

  const groupedSessions = useMemo(() => {
    if (!groupByMacroTask) return null
    const groups: Record<string, MacroTaskGroup> = {}
    for (const session of filteredSessions) {
      const key = session.macroTaskId || 'ungrouped'
      if (!groups[key]) {
        groups[key] = {
          macroTaskId: key,
          title: session.task,
          sessions: [],
          latestStatus: session.status,
        }
      }
      groups[key].sessions.push(session)
    }
    return Object.values(groups)
  }, [filteredSessions, groupByMacroTask])

  function toggleStatusFilter(status: SessionStatus) {
    setStatusFilters(prev => {
      const next = new Set(prev)
      if (next.has(status)) next.delete(status)
      else next.add(status)
      return next
    })
  }

  function toggleGroup(macroTaskId: string) {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(macroTaskId)) next.delete(macroTaskId)
      else next.add(macroTaskId)
      return next
    })
  }

  async function handleCleanup() {
    if (!currentProject) return
    setCleaning(true)
    const toastId = toast('loading', 'Limpando sessões antigas...')
    try {
      const result = await sessionsApi.cleanup(currentProject.id, cleanupDays)
      toast('success', `${result.count} sessão(ões) removida(s)`)
      setShowCleanupModal(false)
      await fetchSessions()
    } catch (error: any) {
      toast('error', error?.message || 'Erro ao limpar sessões')
    } finally {
      setCleaning(false)
    }
  }

  async function handleLoadHistory() {
    if (!currentProject) return
    setShowHistory(prev => !prev)
    if (!showHistory && historyData.length === 0) {
      setHistoryLoading(true)
      try {
        const data = await sessionsApi.getHistory(currentProject.id)
        setHistoryData(data)
      } catch (error) {
        console.error('Failed to fetch history:', error)
        toast('error', 'Erro ao carregar histórico')
      } finally {
        setHistoryLoading(false)
      }
    }
  }

  if (loading) {
    return (
      <Shell>
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <header className="flex items-center justify-between px-4 lg:px-6 py-3 border-b border-border bg-card/50 sticky top-0 z-10">
            <div className="space-y-2">
              <div className="h-4 w-20 bg-muted/50 rounded animate-pulse" />
              <div className="h-3 w-40 bg-muted/50 rounded animate-pulse" />
            </div>
          </header>
          <div className="flex-1 min-h-0 overflow-y-auto p-4 lg:p-6 space-y-2">
            <SkeletonTable rows={5} />
          </div>
        </div>
      </Shell>
    )
  }

  return (
    <Shell>
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
        <header className="flex items-center justify-between px-4 lg:px-6 py-3 border-b border-border bg-card/50 sticky top-0 z-10">
          <div>
            <h1 className="text-sm font-semibold text-foreground">Sessions</h1>
            <p className="text-[11px] text-muted-foreground font-mono mt-0.5">
              {filteredSessions.filter((s) => s.status === 'running').length} running ·{' '}
              {filteredSessions.filter((s) => s.status === 'waiting' || s.status === 'paused').length} waiting ·{' '}
              {filteredSessions.filter((s) => s.status === 'completed').length} completed
            </p>
          </div>
          <div className="flex items-center gap-3">
            {governor && (
              <span
                title={
                  governor.resource.ok
                    ? 'Teto global de sessões da máquina'
                    : `Pressão de recurso: ${governor.resource.detail}`
                }
                className={cn(
                  'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-mono border',
                  governor.resource.ok
                    ? 'border-border text-muted-foreground'
                    : 'border-amber-500/30 bg-amber-500/10 text-amber-600'
                )}
              >
                <Cpu className="w-3 h-3" />
                Slots {governor.global.active}/{governor.global.max}
                {!governor.resource.ok && <AlertTriangle className="w-3 h-3" />}
              </span>
            )}
            {governor && governor.queue.length > 0 && (
              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-mono border border-primary/30 bg-primary/10 text-primary">
                <Inbox className="w-3 h-3" />
                {governor.queue.length} na fila
              </span>
            )}
            <div className="flex items-center gap-2">
              <Cpu className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-[11px] font-mono text-muted-foreground">{filteredSessions.length} total</span>
            </div>
          </div>
        </header>

        {governor && governor.queue.length > 0 && (
          <div className="px-4 lg:px-6 py-2 border-b border-border bg-primary/5 space-y-1.5">
            <p className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">
              Aguardando slot — não é sessão travada, sobe sozinha quando um slot libera
            </p>
            {governor.queue.map((item) => (
              <div
                key={item.macroTaskId}
                className="flex items-center gap-2 text-[11px] font-mono text-foreground"
              >
                <span className="px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground shrink-0">
                  #{item.position}
                </span>
                <span className="truncate max-w-64">{item.title}</span>
                <span
                  className={cn(
                    'px-1.5 py-0.5 rounded text-[10px] shrink-0',
                    item.reason === 'resource'
                      ? 'bg-amber-500/10 text-amber-600'
                      : 'bg-muted/50 text-muted-foreground'
                  )}
                >
                  {queueReasonLabel[item.reason]}
                </span>
                <span className="text-muted-foreground truncate">{item.detail}</span>
              </div>
            ))}
          </div>
        )}

        <div className="px-4 lg:px-6 py-2 border-b border-border bg-muted/10">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-mono border transition-colors',
                showFilters
                  ? 'bg-primary/10 border-primary/30 text-primary'
                  : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted/40'
              )}
            >
              <Filter className="w-3 h-3" />
              Filtros
              {(statusFilters.size > 0 || datePreset !== 'all' || taskFilter) && (
                <span className="w-1.5 h-1.5 rounded-full bg-primary" />
              )}
            </button>

            {taskFilter && (
              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-mono border border-primary/30 bg-primary/10 text-primary">
                <ListTree className="w-3 h-3" />
                <span className="max-w-48 truncate">
                  Filtrando por task{' '}
                  {sessions.find(s => s.macroTaskId === taskFilter)?.task || taskFilter.slice(0, 8)}
                </span>
                <button
                  onClick={() => setTaskFilter(null)}
                  className="hover:text-foreground transition-colors"
                  aria-label="Limpar filtro de task"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}

            <button
              onClick={() => setGroupByMacroTask(!groupByMacroTask)}
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-mono border transition-colors',
                groupByMacroTask
                  ? 'bg-primary/10 border-primary/30 text-primary'
                  : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted/40'
              )}
            >
              <ListTree className="w-3 h-3" />
              Agrupar por Macro Task
            </button>

            <button
              onClick={handleLoadHistory}
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-mono border transition-colors',
                showHistory
                  ? 'bg-primary/10 border-primary/30 text-primary'
                  : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted/40'
              )}
            >
              <History className="w-3 h-3" />
              Ver histórico
            </button>

            {currentProject && (
              <button
                onClick={() => setShowCleanupModal(true)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-mono border border-destructive/30 text-destructive hover:bg-destructive/10 transition-colors ml-auto"
              >
                <Eraser className="w-3 h-3" />
                Limpar sessões antigas
              </button>
            )}
          </div>

          {showFilters && (
            <div className="mt-3 space-y-3 pb-1">
              <div>
                <p className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-1.5">Status</p>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {allStatuses.map(status => {
                    const cfg = statusConfig[status]
                    const isActive = statusFilters.has(status)
                    return (
                      <button
                        key={status}
                        onClick={() => toggleStatusFilter(status)}
                        className={cn(
                          'flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-mono border transition-colors',
                          isActive
                            ? cn(cfg.badge, cfg.text, 'border-current/30')
                            : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted/40'
                        )}
                      >
                        <div className={cn('w-1.5 h-1.5 rounded-full', cfg.dot)} />
                        {cfg.label}
                      </button>
                    )
                  })}
                  {statusFilters.size > 0 && (
                    <button
                      onClick={() => setStatusFilters(new Set())}
                      className="text-[10px] font-mono text-muted-foreground hover:text-foreground transition-colors ml-1"
                    >
                      Limpar
                    </button>
                  )}
                </div>
              </div>

              <div>
                <p className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-1.5">Período</p>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {([
                    { key: 'all', label: 'Todos' },
                    { key: '24h', label: 'Últimas 24h' },
                    { key: '7d', label: 'Últimos 7 dias' },
                    { key: '30d', label: 'Últimos 30 dias' },
                    { key: 'custom', label: 'Custom' },
                  ] as { key: DatePreset; label: string }[]).map(preset => (
                    <button
                      key={preset.key}
                      onClick={() => setDatePreset(preset.key)}
                      className={cn(
                        'flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-mono border transition-colors',
                        datePreset === preset.key
                          ? 'bg-primary/10 border-primary/30 text-primary'
                          : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted/40'
                      )}
                    >
                      {preset.key !== 'custom' && <Calendar className="w-3 h-3" />}
                      {preset.label}
                    </button>
                  ))}
                </div>
                {datePreset === 'custom' && (
                  <div className="flex items-center gap-2 mt-2">
                    <input
                      type="date"
                      value={customDateFrom}
                      onChange={e => setCustomDateFrom(e.target.value)}
                      className="bg-input rounded-md px-2 py-1 text-[10px] font-mono text-foreground outline-none border border-border focus:border-primary/50 transition-colors"
                    />
                    <span className="text-[10px] text-muted-foreground">até</span>
                    <input
                      type="date"
                      value={customDateTo}
                      onChange={e => setCustomDateTo(e.target.value)}
                      className="bg-input rounded-md px-2 py-1 text-[10px] font-mono text-foreground outline-none border border-border focus:border-primary/50 transition-colors"
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="hidden sm:flex items-center gap-4 px-4 py-2 border-b border-border bg-muted/10">
          <div className="w-1.5 shrink-0" />
          <div className="w-16 shrink-0">
            <span className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">ID</span>
          </div>
          <div className="flex-1">
            <span className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">Task</span>
          </div>
          <div className="w-28 shrink-0">
            <span className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">Stage</span>
          </div>
          <div className="w-32 shrink-0">
            <span className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">Model</span>
          </div>
          <div className="w-32 shrink-0">
            <span className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">Activity</span>
          </div>
          <div className="w-4 shrink-0" />
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-4 lg:p-6 space-y-2">
          {showHistory && (
            <div className="mb-4 border border-border rounded-lg bg-card overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/10">
                <div className="flex items-center gap-2">
                  <History className="w-4 h-4 text-muted-foreground" />
                  <span className="text-xs font-semibold text-foreground">Histórico de Sessões</span>
                </div>
                <button
                  onClick={() => setShowHistory(false)}
                  className="p-1 rounded hover:bg-muted/40 transition-colors"
                >
                  <X className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
              </div>
              <div className="px-4 py-3">
                {historyLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                  </div>
                ) : historyData.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground font-mono text-center py-4">
                    Nenhum dado de histórico disponível
                  </p>
                ) : (
                  <div className="space-y-1">
                    {historyData.map((entry: any, i: number) => (
                      <div
                        key={entry.id || i}
                        className="flex items-center gap-3 px-3 py-2 rounded-md bg-muted/10 border border-border/50"
                      >
                        <div className={cn(
                          'w-1.5 h-1.5 rounded-full shrink-0',
                          statusConfig[(entry.status as SessionStatus)]?.dot || 'bg-muted'
                        )} />
                        <span className="text-[10px] font-mono text-primary shrink-0">
                          {(entry.id || '').slice(0, 8)}
                        </span>
                        <span className="text-[11px] font-mono text-foreground flex-1 min-w-0 truncate">
                          {entry.macroTask?.title || entry.task || 'Unknown'}
                        </span>
                        <span className={cn(
                          'text-[9px] font-mono px-1.5 py-0.5 rounded shrink-0',
                          statusConfig[(entry.status as SessionStatus)]?.badge || 'bg-muted',
                          statusConfig[(entry.status as SessionStatus)]?.text || 'text-muted-foreground'
                        )}>
                          {(entry.status || 'unknown').toUpperCase()}
                        </span>
                        <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                          {entry.startedAt ? new Date(entry.startedAt).toLocaleDateString() : '—'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {filteredSessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Terminal className="w-10 h-10 text-muted-foreground/50" />
              <div className="text-center">
                <p className="text-sm font-medium text-foreground">
                  {currentProject ? `Nenhuma sessão para ${currentProject.name}` : 'Nenhuma sessão ainda'}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Inicie uma macro task para criar uma sessão
                </p>
              </div>
            </div>
          ) : groupedSessions ? (
            groupedSessions.map(group => {
              const isCollapsed = collapsedGroups.has(group.macroTaskId)
              const latestCfg = statusConfig[group.latestStatus] ?? statusConfig.initializing
              return (
                <div key={group.macroTaskId} className="space-y-1">
                  <button
                    onClick={() => toggleGroup(group.macroTaskId)}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-border/50 bg-muted/10 hover:bg-muted/20 transition-colors text-left"
                  >
                    {isCollapsed
                      ? <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    }
                    <span className="text-xs font-medium text-foreground flex-1 min-w-0 truncate">
                      {group.title}
                    </span>
                    <span className={cn(
                      'text-[9px] font-mono px-1.5 py-0.5 rounded shrink-0',
                      latestCfg.badge, latestCfg.text
                    )}>
                      {latestCfg.label.toUpperCase()}
                    </span>
                    <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                      {group.sessions.length} sessão(ões)
                    </span>
                  </button>
                  {!isCollapsed && (
                    <div className="space-y-2 pl-4">
                      {group.sessions.map(session => (
                        <SessionRow key={session.id} session={session} now={now} onRefetch={fetchSessions} />
                      ))}
                    </div>
                  )}
                </div>
              )
            })
          ) : (
            filteredSessions.map((session) => (
              <SessionRow key={session.id} session={session} now={now} onRefetch={fetchSessions} />
            ))
          )}
        </div>
      </div>

      {showCleanupModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => !cleaning && setShowCleanupModal(false)}>
          <div className="w-full max-w-sm rounded-lg border border-border bg-card shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-border">
              <div className="flex items-center gap-2">
                <Eraser className="w-4 h-4 text-destructive" />
                <h2 className="text-sm font-semibold text-foreground">Limpar Sessões Antigas</h2>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                Remover sessões completadas/failed com mais de X dias?
              </p>
            </div>
            <div className="px-6 py-4">
              <div className="flex items-center gap-3">
                <label className="text-[11px] font-mono text-muted-foreground">Dias:</label>
                <input
                  type="number"
                  min={1}
                  value={cleanupDays}
                  onChange={e => setCleanupDays(Math.max(1, parseInt(e.target.value) || 7))}
                  className="w-20 bg-input rounded-md px-3 py-1.5 text-xs text-foreground outline-none border border-border focus:border-primary/50 transition-colors font-mono"
                />
              </div>
            </div>
            <div className="px-6 py-3 border-t border-border flex justify-end gap-2">
              <button
                onClick={() => setShowCleanupModal(false)}
                disabled={cleaning}
                className="text-[11px] text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-md transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleCleanup}
                disabled={cleaning}
                className="flex items-center gap-1.5 text-[11px] bg-destructive text-destructive-foreground px-3 py-1.5 rounded-md hover:bg-destructive/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {cleaning ? <><Loader2 className="w-3 h-3 animate-spin" /> Limpando...</> : 'Limpar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Shell>
  )
}

export default function SessionsPage() {
  return (
    <Suspense
      fallback={
        <Shell>
          <div className="flex-1 min-h-0 overflow-y-auto p-4 lg:p-6 space-y-2">
            <SkeletonTable rows={5} />
          </div>
        </Shell>
      }
    >
      <SessionsContent />
    </Suspense>
  )
}
