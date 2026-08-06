'use client'

import { Shell } from '@/components/shell'
import { logsApi, sessionsApi, type SessionReport, type WaveReport } from '@/lib/api'
import { useProject } from '@/lib/project-context'
import { cn } from '@/lib/utils'
import {
  ScrollText,
  Search,
  Filter,
  Activity,
  GitMerge,
  AlertTriangle,
  RotateCcw,
  SkipForward,
  Clock,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

type LogLevel = 'info' | 'warn' | 'error' | 'debug' | 'system'
type Tab = 'wave' | 'session' | 'logs'

interface LogEntry {
  id: string
  createdAt: string
  level: string
  sessionId?: string
  message: string
  metadata?: any
}

interface SessionOption {
  id: string
  branchName: string
  status: string
  startedAt: string
  currentStage: string
}

const levelColors: Record<string, { bg: string; text: string; dot: string }> = {
  info: { bg: 'bg-primary/10', text: 'text-primary', dot: 'bg-primary' },
  warn: { bg: 'bg-status-waiting/10', text: 'text-status-waiting', dot: 'bg-status-waiting' },
  error: { bg: 'bg-destructive/10', text: 'text-destructive', dot: 'bg-destructive' },
  debug: { bg: 'bg-muted', text: 'text-muted-foreground', dot: 'bg-muted-foreground' },
  system: { bg: 'bg-status-done/10', text: 'text-status-done', dot: 'bg-status-done' },
}

/** Cor por status de stage — a mesma leitura em todas as tabelas. */
const stageColors: Record<string, string> = {
  completed: 'text-status-done',
  running: 'text-status-running',
  failed: 'text-destructive',
  skipped: 'text-status-waiting',
  inherited: 'text-primary',
  pending: 'text-muted-foreground',
}

const WINDOWS = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: 'Tudo', days: null },
] as const

/** Sessões concluídas necessárias para um pipeline entrar na comparação. */
const MIN_SAMPLE_FOR_HIGHLIGHT = 3

/**
 * `null` vira "—", não "0s": o backend usa `null` justamente para dizer "não
 * medido", e mostrar zero aqui inventaria um dado que não existe.
 */
function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '—'
  const totalMinutes = Math.floor(ms / 60_000)
  if (totalMinutes < 1) return `${Math.max(1, Math.round(ms / 1000))}s`
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
}

function StatChip({
  label,
  value,
  tone,
}: {
  label: string
  value: string | number
  tone?: 'good' | 'bad' | 'warn'
}) {
  return (
    <div className="px-3 py-2 rounded-md border border-border bg-card">
      <p className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={cn(
          'text-sm font-mono font-medium mt-0.5',
          tone === 'good' && 'text-status-done',
          tone === 'bad' && 'text-destructive',
          tone === 'warn' && 'text-status-waiting',
          !tone && 'text-foreground',
        )}
      >
        {value}
      </p>
    </div>
  )
}

/** Comparação entre pipelines: é a resposta a "o fluxo novo ficou mais rápido?". */
function WaveView({ projectId }: { projectId?: string }) {
  const [report, setReport] = useState<WaveReport | null>(null)
  const [days, setDays] = useState<number | null>(30)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!projectId) return
    let active = true
    async function fetchReport() {
      try {
        const from =
          days === null
            ? new Date(0).toISOString()
            : new Date(Date.now() - days * 86_400_000).toISOString()
        const data = await logsApi.waveReport(projectId!, from)
        if (active) {
          setReport(data)
          setError(null)
        }
      } catch (err: any) {
        if (active) setError(err?.message || 'Falha ao carregar o report de onda')
      } finally {
        if (active) setLoading(false)
      }
    }
    setLoading(true)
    fetchReport()
    return () => {
      active = false
    }
  }, [projectId, days])

  /**
   * O destaque exige amostra mínima. Sem isso, um pipeline de uso único com
   * uma sessão de 4 segundos lidera a tabela (visto nos dados reais) e o
   * cabeçalho anuncia como "mais rápido" o que só tem menos dado.
   */
  const fastest = report?.pipelines.find(
    p => p.medianDurationMs !== null && p.completed >= MIN_SAMPLE_FOR_HIGHLIGHT,
  )

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 lg:p-6 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Clock className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-[10px] text-muted-foreground">Janela</span>
        {WINDOWS.map(w => (
          <button
            key={w.label}
            onClick={() => setDays(w.days)}
            className={cn(
              'text-[10px] font-mono px-2 py-1 rounded transition-colors',
              days === w.days
                ? 'bg-primary/15 text-primary'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/40',
            )}
          >
            {w.label}
          </button>
        ))}
      </div>

      {loading && <p className="text-xs text-muted-foreground">Carregando report…</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}

      {report && !loading && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            <StatChip label="Sessões" value={report.sessions} />
            <StatChip label="Completas" value={report.completed} tone="good" />
            <StatChip
              label="Travadas"
              value={report.failed}
              tone={report.failed > 0 ? 'bad' : undefined}
            />
            <StatChip label="Em curso" value={report.live} />
            <StatChip label="Mediana" value={formatDuration(report.medianDurationMs)} />
            <StatChip
              label="Questions humanas"
              value={report.questionsHuman}
              tone={report.questionsHuman > 0 ? 'warn' : undefined}
            />
          </div>

          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <span className="text-xs font-semibold text-foreground">Por pipeline</span>
              {fastest && report.pipelines.length > 1 && (
                <span className="text-[10px] font-mono text-status-done">
                  mais rápido: {fastest.pipelineName} ({formatDuration(fastest.medianDurationMs)} ·{' '}
                  {fastest.completed} sessões)
                </span>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-[9px] uppercase tracking-wide text-muted-foreground border-b border-border/50">
                    <th className="text-left font-medium px-4 py-2">Pipeline</th>
                    <th className="text-right font-medium px-2 py-2">Stages</th>
                    <th className="text-right font-medium px-2 py-2">Sessões</th>
                    <th className="text-right font-medium px-2 py-2">OK</th>
                    <th className="text-right font-medium px-2 py-2">Travadas</th>
                    <th className="text-right font-medium px-2 py-2">Mediana</th>
                    <th className="text-right font-medium px-2 py-2">Média</th>
                    <th className="text-left font-medium px-4 py-2">Stage mais caro</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {report.pipelines.map(pipeline => (
                    <tr key={pipeline.pipelineName} className="hover:bg-muted/10">
                      <td className="px-4 py-2 text-foreground font-medium">
                        {pipeline.pipelineName}
                      </td>
                      <td className="px-2 py-2 text-right font-mono text-muted-foreground">
                        {pipeline.stageCount}
                      </td>
                      <td className="px-2 py-2 text-right font-mono">{pipeline.sessions}</td>
                      <td className="px-2 py-2 text-right font-mono text-status-done">
                        {pipeline.completed}
                      </td>
                      <td
                        className={cn(
                          'px-2 py-2 text-right font-mono',
                          pipeline.failed > 0 ? 'text-destructive' : 'text-muted-foreground',
                        )}
                      >
                        {pipeline.failed}
                      </td>
                      <td className="px-2 py-2 text-right font-mono text-foreground">
                        {formatDuration(pipeline.medianDurationMs)}
                      </td>
                      <td className="px-2 py-2 text-right font-mono text-muted-foreground">
                        {formatDuration(pipeline.avgDurationMs)}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {pipeline.slowestStage
                          ? `${pipeline.slowestStage.name} · ${formatDuration(pipeline.slowestStage.medianDurationMs)}`
                          : '—'}
                      </td>
                    </tr>
                  ))}
                  {report.pipelines.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-6 text-center text-muted-foreground">
                        Nenhuma sessão nesta janela
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Tempo por stage sem precisar clicar: é onde se vê qual fase pesa. */}
          {report.pipelines.map(pipeline => (
            <div
              key={`stages-${pipeline.pipelineName}`}
              className="rounded-lg border border-border bg-card overflow-hidden"
            >
              <div className="px-4 py-2 border-b border-border flex items-center justify-between">
                <span className="text-[11px] font-medium text-foreground">
                  {pipeline.pipelineName} · tempo por stage
                </span>
                <span className="text-[10px] font-mono text-muted-foreground">
                  {pipeline.questionsTotal} questions · {pipeline.questionsHuman} humanas
                </span>
              </div>
              <div className="divide-y divide-border/30">
                {pipeline.stages.map(stage => {
                  const max = Math.max(
                    ...pipeline.stages.map(s => s.medianDurationMs ?? 0),
                    1,
                  )
                  const width = ((stage.medianDurationMs ?? 0) / max) * 100
                  return (
                    <div key={stage.name} className="flex items-center gap-3 px-4 py-1.5">
                      <span className="text-[10px] text-foreground w-32 shrink-0 truncate">
                        {stage.name}
                      </span>
                      <div className="flex-1 h-1.5 rounded-full bg-muted/40 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary/60"
                          style={{ width: `${width}%` }}
                        />
                      </div>
                      <span className="text-[10px] font-mono text-muted-foreground w-16 text-right shrink-0">
                        {formatDuration(stage.medianDurationMs)}
                      </span>
                      <span className="text-[9px] font-mono text-muted-foreground/60 w-20 text-right shrink-0">
                        {stage.samples}x
                        {stage.retries > 0 && (
                          <span className="text-status-waiting"> +{stage.retries}r</span>
                        )}
                      </span>
                    </div>
                  )
                })}
                {pipeline.stages.length === 0 && (
                  <div className="px-4 py-3 text-[10px] text-muted-foreground">
                    Nenhum stage medido
                  </div>
                )}
              </div>
            </div>
          ))}

          {report.stuck.length > 0 && (
            <div className="rounded-lg border border-border bg-card overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
                <AlertTriangle className="w-3.5 h-3.5 text-status-waiting" />
                <span className="text-xs font-semibold text-foreground">
                  Onde travaram ({report.stuck.length})
                </span>
              </div>
              <div className="divide-y divide-border/30">
                {report.stuck.map(session => (
                  <div key={session.sessionId} className="flex items-center gap-3 px-4 py-2">
                    <span className="text-[9px] font-mono text-primary shrink-0">
                      {session.sessionId.slice(0, 8)}
                    </span>
                    <span className="text-[11px] text-foreground flex-1 min-w-0 truncate">
                      {session.macroTaskTitle || '(sem título)'}
                    </span>
                    <span className="text-[10px] font-mono text-status-waiting shrink-0">
                      {session.stage}
                    </span>
                    <span className="text-[10px] font-mono text-muted-foreground shrink-0 w-16 text-right">
                      {session.status}
                    </span>
                    {session.questionsOpen > 0 && (
                      <span className="text-[9px] font-mono text-status-waiting shrink-0">
                        {session.questionsOpen}q
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

/** Report de uma sessão: o que aconteceu em cada stage, sem nada instrumentado. */
function SessionView({
  sessions,
  selectedId,
  onSelect,
}: {
  sessions: SessionOption[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const [report, setReport] = useState<SessionReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!selectedId) return
    let active = true
    async function fetchReport() {
      try {
        const data = await logsApi.sessionReport(selectedId!)
        if (active) {
          setReport(data)
          setError(null)
        }
      } catch (err: any) {
        if (active) setError(err?.message || 'Falha ao carregar o report da sessão')
      } finally {
        if (active) setLoading(false)
      }
    }
    setLoading(true)
    fetchReport()
    return () => {
      active = false
    }
  }, [selectedId])

  const mergeTone =
    report?.merge.status === 'merged'
      ? 'good'
      : report?.merge.status === 'conflict'
        ? 'bad'
        : undefined

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 lg:p-6 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Activity className="w-3.5 h-3.5 text-muted-foreground" />
        <select
          value={selectedId ?? ''}
          onChange={e => onSelect(e.target.value)}
          className="flex-1 max-w-xl bg-input rounded-md px-2 py-1.5 text-xs text-foreground outline-none border border-border focus:border-primary/50"
        >
          <option value="">Selecione uma sessão…</option>
          {sessions.map(session => (
            <option key={session.id} value={session.id}>
              {session.branchName} · {session.status} · {session.currentStage}
            </option>
          ))}
        </select>
      </div>

      {!selectedId && (
        <p className="text-xs text-muted-foreground">
          Escolha uma sessão para ver o report derivado dela.
        </p>
      )}
      {loading && <p className="text-xs text-muted-foreground">Carregando report…</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}

      {report && !loading && (
        <>
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              {report.macroTaskTitle || report.branch}
            </h2>
            <p className="text-[10px] font-mono text-muted-foreground mt-0.5">
              {report.pipelineName || '(sem pipeline)'} · {report.branch}
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            <StatChip
              label="Status"
              value={report.status}
              tone={
                report.status === 'completed'
                  ? 'good'
                  : report.status === 'failed'
                    ? 'bad'
                    : undefined
              }
            />
            <StatChip label="Duração" value={formatDuration(report.durationMs)} />
            <StatChip
              label="Stages OK"
              value={`${report.counts.completed}/${report.counts.stages}`}
            />
            <StatChip label="Artefatos" value={report.counts.artifacts} />
            <StatChip
              label="Questions"
              value={`${report.counts.questionsAnswered}+${report.counts.questionsOpen}`}
              tone={report.counts.questionsOpen > 0 ? 'warn' : undefined}
            />
            <StatChip label="Merge" value={report.merge.status} tone={mergeTone} />
          </div>

          {/* Sinais que só aparecem em sessão atípica: some quando não se aplica. */}
          {(report.resume ||
            report.counts.retried > 0 ||
            report.counts.skipped > 0 ||
            report.merge.conflicts.length > 0) && (
            <div className="flex flex-wrap items-center gap-3 px-3 py-2 rounded-md border border-border bg-muted/10 text-[10px]">
              {report.resume && (
                <span className="flex items-center gap-1 text-primary">
                  <RotateCcw className="w-3 h-3" />
                  retomada de {report.resume.fromSessionId?.slice(0, 8)} (
                  {report.resume.inheritedStages.length} stage(s) herdado(s))
                </span>
              )}
              {report.counts.retried > 0 && (
                <span className="flex items-center gap-1 text-status-waiting">
                  <RotateCcw className="w-3 h-3" />
                  {report.counts.retried} stage(s) refeito(s)
                </span>
              )}
              {report.counts.skipped > 0 && (
                <span className="flex items-center gap-1 text-status-waiting">
                  <SkipForward className="w-3 h-3" />
                  {report.counts.skipped} stage(s) pulado(s)
                </span>
              )}
              {report.merge.conflicts.length > 0 && (
                <span className="flex items-center gap-1 text-destructive">
                  <GitMerge className="w-3 h-3" />
                  conflito em {report.merge.conflicts.join(', ')}
                </span>
              )}
            </div>
          )}

          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <span className="text-xs font-semibold text-foreground">Stages</span>
              {report.slowestStage && (
                <span className="text-[10px] font-mono text-muted-foreground">
                  mais lento: {report.slowestStage.name} ·{' '}
                  {formatDuration(report.slowestStage.durationMs)}
                </span>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-[9px] uppercase tracking-wide text-muted-foreground border-b border-border/50">
                    <th className="text-left font-medium px-4 py-2">Stage</th>
                    <th className="text-left font-medium px-2 py-2">Status</th>
                    <th className="text-right font-medium px-2 py-2">Duração</th>
                    <th className="text-right font-medium px-2 py-2">Tent.</th>
                    <th className="text-left font-medium px-2 py-2">Modelo / profile</th>
                    <th className="text-left font-medium px-4 py-2">Resumo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {report.stages.map(stage => (
                    <tr key={stage.name} className="hover:bg-muted/10 align-top">
                      <td className="px-4 py-2 text-foreground font-medium whitespace-nowrap">
                        {stage.name}
                      </td>
                      <td
                        className={cn(
                          'px-2 py-2 font-mono whitespace-nowrap',
                          stageColors[stage.status] || 'text-muted-foreground',
                        )}
                      >
                        {stage.status}
                      </td>
                      <td className="px-2 py-2 text-right font-mono whitespace-nowrap">
                        {formatDuration(stage.durationMs)}
                      </td>
                      <td
                        className={cn(
                          'px-2 py-2 text-right font-mono',
                          stage.attempts > 1 ? 'text-status-waiting' : 'text-muted-foreground',
                        )}
                      >
                        {stage.attempts || '—'}
                      </td>
                      <td
                        className="px-2 py-2 font-mono text-muted-foreground whitespace-nowrap"
                        title={stage.provenance || undefined}
                      >
                        {stage.model || '—'}
                        {stage.cliProfile && (
                          <span className="text-muted-foreground/60"> / {stage.cliProfile}</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground max-w-md">
                        {stage.summary || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-lg border border-border bg-card overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground">Questions</span>
                <span className="text-[10px] font-mono text-muted-foreground">
                  {report.counts.questionsHuman} para humano
                </span>
              </div>
              <div className="divide-y divide-border/30">
                {report.questions.map(question => (
                  <div key={question.id} className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          'text-[9px] font-mono px-1 py-0.5 rounded uppercase',
                          question.status === 'pending'
                            ? 'bg-status-waiting/10 text-status-waiting'
                            : 'bg-status-done/10 text-status-done',
                        )}
                      >
                        {question.status}
                      </span>
                      <span className="text-[10px] font-mono text-muted-foreground">
                        {formatDuration(question.waitMs)}
                      </span>
                      {question.answeredBy && (
                        <span className="text-[9px] font-mono text-muted-foreground/60">
                          {question.answeredBy}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-foreground mt-1 line-clamp-2">
                      {question.question}
                    </p>
                  </div>
                ))}
                {report.questions.length === 0 && (
                  <div className="px-4 py-4 text-[10px] text-muted-foreground">
                    Nenhuma question nesta sessão
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-lg border border-border bg-card overflow-hidden">
              <div className="px-4 py-3 border-b border-border">
                <span className="text-xs font-semibold text-foreground">
                  Artefatos ({report.artifacts.length})
                </span>
              </div>
              <div className="divide-y divide-border/30 max-h-72 overflow-y-auto">
                {report.artifacts.map(artifact => (
                  <div key={artifact.id} className="flex items-center gap-2 px-4 py-2">
                    <span className="text-[9px] font-mono px-1 py-0.5 rounded bg-primary/10 text-primary shrink-0">
                      {artifact.type}
                    </span>
                    <span className="text-[10px] font-mono text-muted-foreground truncate">
                      {artifact.path}
                    </span>
                  </div>
                ))}
                {report.artifacts.length === 0 && (
                  <div className="px-4 py-4 text-[10px] text-muted-foreground">
                    Nenhum artefato gravado
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default function LogsPage() {
  const [tab, setTab] = useState<Tab>('wave')
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [sessions, setSessions] = useState<SessionOption[]>([])
  const [selectedSession, setSelectedSession] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [levelFilter, setLevelFilter] = useState<LogLevel | 'all'>('all')
  const { currentProject } = useProject()

  const fetchLogs = useCallback(async () => {
    try {
      const data = await logsApi.list(undefined, currentProject?.id)
      setLogs(data)
    } catch (error) {
      console.error('Failed to fetch logs:', error)
    } finally {
      setLoading(false)
    }
  }, [currentProject])

  useEffect(() => {
    setLoading(true)
    fetchLogs()
    // Só a aba de logs precisa de polling: os reports são de sessão terminada.
    if (tab !== 'logs') return
    const interval = setInterval(fetchLogs, 5000)
    return () => clearInterval(interval)
  }, [fetchLogs, tab])

  useEffect(() => {
    if (!currentProject?.id) return
    let active = true
    async function fetchSessions() {
      try {
        const data = await sessionsApi.list({ projectId: currentProject!.id })
        if (!active) return
        const list: SessionOption[] = (Array.isArray(data) ? data : []).map((s: any) => ({
          id: s.id,
          branchName: s.branchName,
          status: s.status,
          startedAt: s.startedAt,
          currentStage: s.currentStage,
        }))
        setSessions(list)
        setSelectedSession(current => current ?? list[0]?.id ?? null)
      } catch (error) {
        console.error('Failed to fetch sessions:', error)
      }
    }
    fetchSessions()
    return () => {
      active = false
    }
  }, [currentProject])

  const filtered = useMemo(
    () =>
      logs.filter(log => {
        const matchesSearch =
          !search ||
          log.message.toLowerCase().includes(search.toLowerCase()) ||
          log.sessionId?.toLowerCase().includes(search.toLowerCase())
        const matchesLevel = levelFilter === 'all' || log.level === levelFilter
        return matchesSearch && matchesLevel
      }),
    [logs, search, levelFilter],
  )

  if (loading && tab === 'logs') {
    return (
      <Shell>
        <div className="flex items-center justify-center h-full">
          <div className="text-sm text-muted-foreground">Loading logs...</div>
        </div>
      </Shell>
    )
  }

  return (
    <Shell>
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
        <header className="flex items-center justify-between px-4 lg:px-6 py-3 border-b border-border bg-card/50 sticky top-0 z-10">
          <div>
            <h1 className="text-sm font-semibold text-foreground">Observabilidade</h1>
            <p className="text-[11px] text-muted-foreground font-mono mt-0.5">
              {tab === 'logs'
                ? `${filtered.length} entries${levelFilter !== 'all' ? ` · ${levelFilter}` : ''}`
                : 'derivado do que o orquestrador já registra'}
            </p>
          </div>
          <div className="flex items-center gap-1">
            {(
              [
                ['wave', 'Onda'],
                ['session', 'Sessão'],
                ['logs', 'Logs'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                onClick={() => setTab(value)}
                className={cn(
                  'text-[11px] px-2.5 py-1 rounded transition-colors',
                  tab === value
                    ? 'bg-primary/15 text-primary'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/40',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </header>

        {tab === 'wave' && <WaveView projectId={currentProject?.id} />}

        {tab === 'session' && (
          <SessionView
            sessions={sessions}
            selectedId={selectedSession}
            onSelect={id => setSelectedSession(id || null)}
          />
        )}

        {tab === 'logs' && (
          <>
            <div className="flex items-center gap-2 px-4 lg:px-6 py-2 border-b border-border bg-muted/10">
              <div className="flex-1 relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search logs..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full bg-input rounded-md pl-8 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground outline-none border border-border focus:border-primary/50 transition-colors"
                />
              </div>
              <div className="flex items-center gap-1">
                <Filter className="w-3.5 h-3.5 text-muted-foreground" />
                {(['all', 'info', 'warn', 'error', 'debug', 'system'] as const).map(level => (
                  <button
                    key={level}
                    onClick={() => setLevelFilter(level)}
                    className={cn(
                      'text-[10px] font-mono px-2 py-1 rounded transition-colors capitalize',
                      levelFilter === level
                        ? 'bg-primary/15 text-primary'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
                    )}
                  >
                    {level}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto font-mono">
              {filtered.map(log => {
                const colors = levelColors[log.level] || levelColors.info
                return (
                  <div
                    key={log.id}
                    className="flex items-start gap-3 px-4 lg:px-6 py-2 border-b border-border/30 hover:bg-muted/10 transition-colors"
                  >
                    <span className="text-[10px] text-muted-foreground/50 shrink-0 pt-0.5 w-20 hidden sm:block">
                      {new Date(log.createdAt).toLocaleTimeString('en-US', { hour12: false })}
                    </span>
                    <div className={cn('w-1.5 h-1.5 rounded-full shrink-0 mt-1.5', colors?.dot || 'bg-muted-foreground')} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className={cn('text-[9px] font-mono px-1 py-0.5 rounded uppercase', colors?.bg, colors?.text)}>
                          {log.level}
                        </span>
                        {log.sessionId && (
                          <span className="text-[10px] text-primary">{log.sessionId.slice(0, 8)}</span>
                        )}
                      </div>
                      <p className="text-[11px] text-foreground leading-relaxed break-all">{log.message}</p>
                      {log.metadata && (
                        <pre className="text-[10px] text-muted-foreground/60 mt-1 whitespace-pre-wrap">
                          {JSON.stringify(log.metadata, null, 2)}
                        </pre>
                      )}
                    </div>
                  </div>
                )
              })}

              {filtered.length === 0 && (
                <div className="flex flex-col items-center justify-center h-60 gap-3">
                  <ScrollText className="w-8 h-8 text-muted-foreground" />
                  <div className="text-center">
                    <p className="text-sm font-medium text-foreground">No logs found</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {search || levelFilter !== 'all' ? 'Try adjusting your filters' : 'Logs will appear here as sessions run'}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </Shell>
  )
}
