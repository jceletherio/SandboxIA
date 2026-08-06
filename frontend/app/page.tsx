'use client'

import { sessionsApi, questionsGlobalApi, masterAgentApi, healthApi, macroTasksApi, logsApi, type Session, type Question, type WaveReport } from '@/lib/api'
import { useProject } from '@/lib/project-context'
import { cn } from '@/lib/utils'
import { Shell } from '@/components/shell'
import { StatCard } from '@/components/dashboard/stat-card'
import { SkeletonCard } from '@/components/ui/skeleton'
import {
  ListTodo,
  Terminal,
  MessageSquare,
  GitMerge,
  Zap,
  Clock,
  Bot,
  ArrowRight,
  ChevronRight,
  Activity,
  Server,
  Database,
  AlertTriangle,
  HardDrive,
} from 'lucide-react'
import Link from 'next/link'
import { useState, useEffect } from 'react'

interface HealthStatus {
  backend: boolean
  redis: boolean
  /**
   * Substituiu o antigo card de `tmux`. O runtime não usa mais multiplexador
   * externo — cada sessão é um PTY do próprio backend —, então o backend parou
   * de publicar `checks.tmux` e o card ficava preso em "Indisponível". A
   * dependência que de fato decide se uma sessão consegue rodar hoje é o
   * binário do CLI de agente estar no PATH, e é isso que aparece aqui.
   */
  agents: { ok: number; total: number; missing: string[] } | null
  database: boolean
  disk: boolean | null
}

/**
 * `null` vira "—", não "0m": sem sessão concluída na janela não existe mediana,
 * e um zero aqui leria como "instantâneo".
 */
function formatMedian(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '—'
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}`
}

export default function DashboardPage() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [questions, setQuestions] = useState<Question[]>([])
  const [loading, setLoading] = useState(true)
  const [health, setHealth] = useState<HealthStatus>({ backend: false, redis: false, agents: null, database: false, disk: null })
  const [masterStatus, setMasterStatus] = useState<{ isActive: boolean; lastActivity?: string } | null>(null)
  const [macroTaskCount, setMacroTaskCount] = useState(0)
  const [triageDecisions, setTriageDecisions] = useState(0)
  const [wave, setWave] = useState<WaveReport | null>(null)
  const { currentProject } = useProject()

  useEffect(() => {
    async function fetchData() {
      if (!currentProject) {
        // sem projeto: não fica preso no skeleton
        setSessions([])
        setQuestions([])
        setLoading(false)
        return
      }

      try {
        const [allSessions, healthRes, masterRes, macroTasksRes, decisionsRes, questionsRes, waveRes] = await Promise.allSettled([
          sessionsApi.list({ projectId: currentProject.id }),
          healthApi.detailed(),
          masterAgentApi.getStatus(currentProject.id),
          macroTasksApi.list(currentProject.id),
          masterAgentApi.getDecisions(currentProject.id),
          questionsGlobalApi.list({ projectId: currentProject.id }),
          logsApi.waveReport(currentProject.id),
        ])

        if (healthRes.status === 'fulfilled') {
          const h = healthRes.value
          const profiles = Object.entries((h?.checks?.cliProfiles ?? {}) as Record<string, { status?: string }>)
          setHealth({
            // Núcleo do backend, NÃO o `status` agregado. O agregado vira
            // `degraded` quando falta um binário de CLI — e pintar o backend de
            // "Unhealthy" em vermelho por causa disso mente sobre onde está o
            // problema: ele respondeu esta requisição e o banco está de pé. A
            // falta do CLI aparece no card de agentes, que é onde se resolve.
            backend: h?.checks?.database?.status === 'ok',
            redis: h?.checks?.redis?.connected === true || h?.checks?.redis?.status === 'ok',
            agents: profiles.length
              ? {
                  ok: profiles.filter(([, v]) => v?.status === 'ok').length,
                  total: profiles.length,
                  missing: profiles.filter(([, v]) => v?.status !== 'ok').map(([name]) => name),
                }
              : null,
            database: h?.checks?.database?.status === 'ok',
            disk: h?.checks?.disk ? (h.checks.disk.status === 'ok' || h.checks.disk.connected === true) : null,
          })
        }

        if (masterRes.status === 'fulfilled') {
          const masterData = masterRes.value as any
          setMasterStatus({
            isActive: masterData?.isActive ?? false,
            lastActivity: masterData?.lastActivity,
          })
        }

        if (macroTasksRes.status === 'fulfilled') {
          setMacroTaskCount(macroTasksRes.value.data.length)
        }

        if (decisionsRes.status === 'fulfilled') {
          const today = new Date().toDateString()
          setTriageDecisions(
            (decisionsRes.value as any[]).filter(
              (d) =>
                ['AUTO_ANSWERED', 'ESCALATED', 'ANSWERED'].includes(d.type) &&
                new Date(d.time).toDateString() === today,
            ).length,
          )
        }

        if (allSessions.status === 'fulfilled') {
          setSessions(allSessions.value)
        }
        if (questionsRes.status === 'fulfilled') {
          setQuestions(questionsRes.value as Question[])
        }
        if (waveRes.status === 'fulfilled') {
          setWave(waveRes.value)
        }
      } catch (error) {
        console.error('Failed to fetch dashboard data:', error)
      } finally {
        setLoading(false)
      }
    }
    fetchData()
    const interval = setInterval(fetchData, 10000)
    return () => clearInterval(interval)
  }, [currentProject])

  const activeSessions = sessions.filter(s => s.status === 'running')
  const pendingQuestions = questions.filter(q => q.status === 'pending')
  const completedSessions = sessions.filter(s => s.status === 'completed')

  if (loading) {
    return (
      <Shell>
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <header className="flex items-center justify-between px-4 lg:px-6 py-3 border-b border-border bg-card/50 sticky top-0 z-10">
            <div className="space-y-2">
              <div className="h-4 w-24 bg-muted/50 rounded animate-pulse" />
              <div className="h-3 w-32 bg-muted/50 rounded animate-pulse" />
            </div>
          </header>
          <div className="flex-1 min-h-0 overflow-y-auto p-4 lg:p-6 space-y-4 lg:space-y-6">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-2 lg:gap-3">
              {Array.from({ length: 7 }).map((_, i) => (
                <SkeletonCard key={i} />
              ))}
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              <div className="lg:col-span-5">
                <div className="rounded-lg border border-border bg-card p-4 space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="h-10 bg-muted/30 rounded animate-pulse" />
                  ))}
                </div>
              </div>
              <div className="lg:col-span-4">
                <div className="rounded-lg border border-border bg-card p-4 space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="h-12 bg-muted/30 rounded animate-pulse" />
                  ))}
                </div>
              </div>
              <div className="lg:col-span-3 space-y-4">
                <div className="rounded-lg border border-border bg-card h-24 animate-pulse" />
                <div className="rounded-lg border border-border bg-card p-4 space-y-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="h-8 bg-muted/30 rounded animate-pulse" />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </Shell>
    )
  }

  const failedSessions = sessions.filter(s => s.status === 'failed' || s.status === 'timeout')

  return (
    <Shell>
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
        <header className="flex items-center justify-between px-4 lg:px-6 py-3 border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
          <div>
            <h1 className="text-sm font-semibold text-foreground">Dashboard</h1>
            <p className="text-[11px] text-muted-foreground font-mono mt-0.5">
              {currentProject ? currentProject.name : 'no project selected'}
            </p>
          </div>
          <div className="flex items-center gap-2 lg:gap-3">
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-status-running animate-pulse" />
              <span className="hidden sm:inline text-[11px] font-mono text-muted-foreground">Orchestrator running</span>
            </div>
            <div className="hidden sm:block h-3 w-px bg-border" />
            <span className="hidden sm:inline text-[11px] font-mono text-muted-foreground">
              {new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}
            </span>
          </div>
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto p-4 lg:p-6 space-y-4 lg:space-y-6">
          {failedSessions.length > 0 && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-destructive/30 bg-destructive/10">
              <AlertTriangle className="w-4 h-4 text-destructive shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-destructive">
                  {failedSessions.length} sessão(ões) com falha ou timeout
                </p>
                <p className="text-[10px] text-destructive/80 mt-0.5">
                  Verifique as sessões failed/timeout para mais detalhes
                </p>
              </div>
              <Link
                href="/sessions"
                className="text-[10px] font-mono text-destructive hover:underline shrink-0"
              >
                Ver sessões
              </Link>
            </div>
          )}

          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <span className="text-xs font-semibold text-foreground">Status do Orquestrador</span>
              <Activity className="w-3.5 h-3.5 text-muted-foreground" />
            </div>
            <div className={cn('grid divide-x divide-border', health.disk !== null ? 'grid-cols-4' : 'grid-cols-3')}>
              <div className="flex items-center gap-2 px-4 py-3">
                <Server className={cn('w-3.5 h-3.5', health.backend ? 'text-status-done' : 'text-destructive')} />
                <div>
                  <p className="text-[10px] text-muted-foreground">Backend</p>
                  <p className={cn('text-xs font-medium', health.backend ? 'text-status-done' : 'text-destructive')}>
                    {health.backend ? 'Healthy' : 'Unhealthy'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 px-4 py-3">
                <Database className={cn('w-3.5 h-3.5', health.redis ? 'text-status-done' : 'text-destructive')} />
                <div>
                  <p className="text-[10px] text-muted-foreground">Redis</p>
                  <p className={cn('text-xs font-medium', health.redis ? 'text-status-done' : 'text-destructive')}>
                    {health.redis ? 'Conectado' : 'Desconectado'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 px-4 py-3">
                <Terminal
                  className={cn(
                    'w-3.5 h-3.5',
                    !health.agents
                      ? 'text-muted-foreground'
                      : health.agents.missing.length === 0
                        ? 'text-status-done'
                        : 'text-status-waiting',
                  )}
                />
                <div className="min-w-0">
                  <p className="text-[10px] text-muted-foreground">Agentes CLI</p>
                  <p
                    className={cn(
                      'text-xs font-medium truncate',
                      !health.agents
                        ? 'text-muted-foreground'
                        : health.agents.missing.length === 0
                          ? 'text-status-done'
                          : 'text-status-waiting',
                    )}
                    title={
                      health.agents?.missing.length
                        ? `Não encontrado no PATH: ${health.agents.missing.join(', ')}`
                        : undefined
                    }
                  >
                    {!health.agents
                      ? '—'
                      : health.agents.missing.length === 0
                        ? `${health.agents.ok}/${health.agents.total} disponíveis`
                        : `falta ${health.agents.missing.join(', ')}`}
                  </p>
                </div>
              </div>
              {health.disk !== null && (
                <div className="flex items-center gap-2 px-4 py-3">
                  <HardDrive className={cn('w-3.5 h-3.5', health.disk ? 'text-status-done' : 'text-destructive')} />
                  <div>
                    <p className="text-[10px] text-muted-foreground">Disk</p>
                    <p className={cn('text-xs font-medium', health.disk ? 'text-status-done' : 'text-destructive')}>
                      {health.disk ? 'OK' : 'Low'}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-2 lg:gap-3">
            <StatCard label="Active Sessions" value={activeSessions.length} sub="running" icon={Terminal} accent href="/sessions" />
            <StatCard label="Sessions" value={sessions.length} sub="total" icon={ListTodo} href="/sessions" />
            <StatCard label="Questions" value={pendingQuestions.length} sub="pending" icon={MessageSquare} href="/questions" />
            <StatCard label="Macro Tasks" value={macroTaskCount} sub="total" icon={GitMerge} href="/macro-tasks" />
            <StatCard label="Agents" value={new Set(sessions.map(s => s.agentId)).size} sub="active" icon={Bot} href="/agents" />
            {/* Mediana da sessão nos últimos 7 dias — a porta de entrada do report. */}
            <StatCard label="Sessão" value={formatMedian(wave?.medianDurationMs ?? null)} sub="mediana 7d" icon={Activity} href="/logs" />
            <StatCard label="Status" value={health.backend ? "OK" : "ERR"} sub={health.backend ? "healthy" : "issues"} icon={Zap} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <div className="lg:col-span-5 flex flex-col gap-4">
              <div className="rounded-lg border border-border bg-card overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                  <span className="text-xs font-semibold text-foreground">Active Sessions</span>
                  <span className="text-[10px] font-mono text-muted-foreground">{activeSessions.length} RUNNING</span>
                </div>
                <div className="divide-y divide-border/50">
                  {activeSessions.slice(0, 5).map(session => (
                    <div key={session.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/20 transition-colors">
                      <div className="w-1.5 h-1.5 rounded-full bg-status-running animate-pulse shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-mono text-foreground truncate">{session.branchName}</p>
                        <p className="text-[10px] text-muted-foreground">{session.currentStage}</p>
                      </div>
                      <span className="text-[9px] font-mono text-primary">{session.id.slice(0, 8)}</span>
                    </div>
                  ))}
                  {activeSessions.length === 0 && (
                    <div className="px-4 py-6 text-center text-[10px] text-muted-foreground">No active sessions</div>
                  )}
                </div>
              </div>
            </div>

            <div className="lg:col-span-4 flex flex-col gap-4">
              <div className="rounded-lg border border-border bg-card overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-foreground">Pending Questions</span>
                    {pendingQuestions.length > 0 && (
                      <span className="text-[10px] font-mono bg-destructive/20 text-destructive px-1.5 rounded">
                        {pendingQuestions.length} pending
                      </span>
                    )}
                  </div>
                  <Link href="/questions" className="text-[10px] text-primary hover:underline flex items-center gap-1">
                    View all <ChevronRight className="w-3 h-3" />
                  </Link>
                </div>
                <div className="divide-y divide-border/50">
                  {pendingQuestions.slice(0, 3).map(q => (
                    <Link key={q.id} href="/questions" className="flex items-start gap-3 px-4 py-3 hover:bg-muted/20 transition-colors">
                      <div className={cn(
                        'w-1.5 h-1.5 rounded-full shrink-0 mt-1.5',
                        q.priority === 'high' ? 'bg-destructive' : 'bg-status-waiting'
                      )} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-foreground leading-relaxed line-clamp-2">{q.question}</p>
                        <div className="flex items-center gap-1.5 mt-1">
                          <span className="text-[10px] font-mono text-primary">{q.sessionId.slice(0, 8)}</span>
                        </div>
                      </div>
                      <span className={cn(
                        'text-[9px] font-mono px-1.5 py-0.5 rounded shrink-0',
                        q.priority === 'high' ? 'bg-destructive/10 text-destructive' : 'bg-status-waiting/10 text-status-waiting'
                      )}>
                        {q.priority.toUpperCase()}
                      </span>
                    </Link>
                  ))}
                  {pendingQuestions.length === 0 && (
                    <div className="px-4 py-6 text-center text-[10px] text-muted-foreground">All questions answered</div>
                  )}
                </div>
              </div>
            </div>

            <div className="lg:col-span-3 flex flex-col gap-4">
              <Link
                href="/master-agent"
                className="rounded-lg border border-primary/25 bg-primary/5 overflow-hidden flex flex-col hover:border-primary/40 transition-colors group"
              >
                <div className="flex items-center gap-2 px-4 py-3 border-b border-primary/15">
                  <div className={cn(
                    'w-1.5 h-1.5 rounded-full shrink-0',
                    masterStatus?.isActive ? 'bg-primary animate-pulse' : 'bg-muted-foreground/40'
                  )} />
                  <span className="text-xs font-semibold text-primary">Master Agent</span>
                  <span className={cn(
                    'text-[9px] font-mono px-1.5 py-0.5 rounded ml-auto',
                    masterStatus?.isActive ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'
                  )}>
                    {masterStatus?.isActive ? 'ATIVO' : 'INATIVO'}
                  </span>
                  <ArrowRight className="w-3 h-3 text-primary/50 group-hover:text-primary transition-colors" />
                </div>
                <div className="px-4 py-3">
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    {activeSessions.length} sessions running. {pendingQuestions.length} questions need review.
                  </p>
                  <p className="text-[10px] text-muted-foreground/60 mt-1 font-mono">
                    Triage decisions today: {triageDecisions}
                  </p>
                  {masterStatus?.lastActivity && (
                    <p className="text-[10px] text-muted-foreground/60 mt-0.5 font-mono">
                      Última atividade: {new Date(masterStatus.lastActivity).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}
                    </p>
                  )}
                </div>
              </Link>

              <div className="rounded-lg border border-border bg-card overflow-hidden">
                <div className="px-4 py-3 border-b border-border">
                  <span className="text-xs font-semibold text-foreground">Quick Actions</span>
                </div>
                <div className="p-3 flex flex-col gap-1.5">
                  {[
                    { label: `Answer ${pendingQuestions.length} questions`, href: '/questions', urgent: pendingQuestions.length > 0 },
                    { label: 'View active sessions', href: '/sessions', urgent: false },
                    { label: 'Manage pipelines', href: '/pipelines', urgent: false },
                    { label: 'View logs', href: '/logs', urgent: false },
                  ].map((a) => (
                    <Link
                      key={a.label}
                      href={a.href}
                      className={cn(
                        'flex items-center justify-between px-3 py-2 rounded-md text-xs transition-colors',
                        a.urgent
                          ? 'bg-destructive/10 text-destructive hover:bg-destructive/20 border border-destructive/20'
                          : 'bg-muted/40 text-foreground hover:bg-muted/70'
                      )}
                    >
                      {a.label}
                      <ChevronRight className="w-3 h-3 opacity-50" />
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Shell>
  )
}
