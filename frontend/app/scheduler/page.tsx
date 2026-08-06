'use client'

import { Shell } from '@/components/shell'
import {
  scheduledJobsApi,
  MASTER_LOOP_JOB_TYPE,
  type ScheduledJob,
  type MasterLoopPayload,
} from '@/lib/api'
import { useProject } from '@/lib/project-context'
import { cn } from '@/lib/utils'
import {
  Clock, Play, Pause, Trash2, Zap, Inbox, Plus, X, Pencil, Loader2, StickyNote,
  PauseCircle, Filter, ChevronDown, ChevronRight, Repeat, MessageSquareText, AlertTriangle,
} from 'lucide-react'
import { useState, useEffect, useMemo } from 'react'
import { SkeletonTable } from '@/components/ui/skeleton'
import { useToast } from '@/components/toast-provider'
import { ConfirmModal } from '@/components/confirm-modal'

interface ScheduledJobExtended extends ScheduledJob {
  notes?: string
}

const JOB_TYPE_LABELS: Record<string, string> = {
  [MASTER_LOOP_JOB_TYPE]: 'Instruções Agendadas',
  session_timeout: 'Timeout de Sessão',
  stage_timeout: 'Timeout de Stage',
  cleanup_worktrees: 'Limpeza de Worktrees',
}

/** Tipos técnicos internos do orquestrador — ficam na seção "Avançado". */
const TECHNICAL_JOB_TYPES = ['session_timeout', 'stage_timeout', 'cleanup_worktrees'] as const

/**
 * O que cada job técnico faz e o que muda se você editar ou disparar um na mão
 * (item 4 do diagnóstico da MT-20 — antes apareciam sem nenhuma explicação).
 */
const TECHNICAL_JOB_HINTS: Record<(typeof TECHNICAL_JOB_TYPES)[number], string> = {
  session_timeout: 'Marca a sessão como "timeout" — ela para de rodar. Editar o horário adia (ou antecipa) quando isso acontece; a sessão continua normalmente até lá.',
  stage_timeout: 'PAUSA a sessão no stage atual (não mata) — fica esperando um humano retomar ou tentar de novo pelo inbox. Só age se o stage ainda não tiver avançado.',
  cleanup_worktrees: 'Remove o worktree de sessões já concluídas/paradas para liberar disco. Sem um sessionId no payload, varre até 20 sessões finalizadas de uma vez.',
}

function friendlyType(type: string): string {
  return JOB_TYPE_LABELS[type] || type
}

function isCustomType(type: string): boolean {
  return !JOB_TYPE_LABELS[type]
}

function isMasterLoop(job: ScheduledJobExtended): boolean {
  return job.type === MASTER_LOOP_JOB_TYPE
}

function loopPayload(job: ScheduledJobExtended): MasterLoopPayload {
  const raw = (job.payload || {}) as Partial<MasterLoopPayload>
  return {
    instructions: raw.instructions || '',
    projectId: raw.projectId || '',
    repeatIntervalMinutes: raw.repeatIntervalMinutes,
    maxRuns: raw.maxRuns,
    runCount: typeof raw.runCount === 'number' ? raw.runCount : 0,
    lastRunAt: raw.lastRunAt,
    lastError: raw.lastError,
    deferCount: typeof raw.deferCount === 'number' ? raw.deferCount : 0,
  }
}

/** Teto de adiamentos consecutivos antes do job falhar (ver `MASTER_LOOP_MAX_DEFERRALS` no backend). */
const MASTER_LOOP_MAX_DEFERRALS = 24

/** "3", "∞" ou "1" — total de execuções previstas. */
function runsLabel(payload: MasterLoopPayload): string {
  if (payload.maxRuns) return String(payload.maxRuns)
  return payload.repeatIntervalMinutes ? '∞' : '1'
}

function cadenceLabel(payload: MasterLoopPayload): string {
  if (!payload.repeatIntervalMinutes) return 'Uma vez'
  const every =
    payload.repeatIntervalMinutes % 60 === 0
      ? `${payload.repeatIntervalMinutes / 60}h`
      : `${payload.repeatIntervalMinutes}min`
  return payload.maxRuns
    ? `A cada ${every} · para após ${payload.maxRuns}x`
    : `A cada ${every} · indefinido`
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = date.getTime() - now.getTime()
  const diffMin = Math.round(diffMs / 60000)
  if (diffMin < -60) return `há ${Math.round(-diffMin / 60)}h`
  if (diffMin < 0) return `há ${-diffMin}min`
  if (diffMin < 60) return `em ${diffMin}min`
  const diffH = Math.round(diffMin / 60)
  if (diffH < 24) return `em ${diffH}h`
  const diffD = Math.round(diffH / 24)
  return diffD === 1 ? 'amanhã' : `em ${diffD}d`
}

/** Date → valor de <input type="datetime-local"> (horário local). */
function toLocalInput(date: Date): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

function minutesFromNow(minutes: number): string {
  return toLocalInput(new Date(Date.now() + minutes * 60000))
}

// Form primário: instruções em texto livre + quando + recorrência.
const defaultLoopForm = {
  instructions: '',
  scheduledAt: '',
  repeat: false,
  repeatIntervalMinutes: '60',
  limitRuns: true,
  maxRuns: '3',
  notes: '',
}

// Form técnico (seção Avançado) — o form antigo, com payload JSON cru.
const defaultAdvancedForm = {
  type: 'session_timeout',
  payload: '{}',
  scheduledAt: '',
  notes: '',
}

// Vocabulário do worker/schema: pending (agendado), running (executando),
// disabled (pausado), completed, failed. "Ativo" = pending | running.
const STATUS_LABELS: Record<string, string> = {
  pending: 'AGENDADO',
  running: 'EXECUTANDO',
  disabled: 'PAUSADO',
  completed: 'CONCLUÍDO',
  failed: 'FALHOU',
  cancelled: 'CANCELADO',
}

type StatusFilter = 'all' | 'active' | 'disabled'

const filterTabs: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'Todos' },
  { key: 'active', label: 'Ativos' },
  { key: 'disabled', label: 'Pausados' },
]

const quickWhen: { label: string; minutes: number }[] = [
  { label: 'agora', minutes: 1 },
  { label: 'em 15min', minutes: 15 },
  { label: 'em 1h', minutes: 60 },
  { label: 'em 24h', minutes: 1440 },
]

export default function SchedulerPage() {
  const [jobs, setJobs] = useState<ScheduledJobExtended[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingJob, setEditingJob] = useState<ScheduledJobExtended | null>(null)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [loopForm, setLoopForm] = useState(defaultLoopForm)
  const [advancedForm, setAdvancedForm] = useState(defaultAdvancedForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deletingJobId, setDeletingJobId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [pausingAll, setPausingAll] = useState(false)
  const { toast } = useToast()
  const { currentProject, projects } = useProject()

  const projectNames = useMemo(() => {
    const map: Record<string, string> = {}
    for (const project of projects) map[project.id] = project.name
    return map
  }, [projects])

  // MT-25: estes dois memos ficam ANTES dos handlers de propósito. `pauseAll` é
  // uma `function` (hoisted) que lê `filteredJobs`; com a declaração depois dela,
  // o React Compiler não conseguia preservar a memoização e desistia de otimizar
  // a página inteira ("Compilation Skipped", react-hooks/preserve-manual-memoization).
  const filteredJobs = useMemo(() => {
    if (statusFilter === 'all') return jobs
    if (statusFilter === 'active') return jobs.filter(j => j.status === 'pending' || j.status === 'running')
    return jobs.filter(j => j.status === 'disabled')
  }, [jobs, statusFilter])

  const groupedJobs = useMemo(() => {
    const groups: Record<string, ScheduledJobExtended[]> = {}
    for (const job of filteredJobs) {
      const key = job.type
      if (!groups[key]) groups[key] = []
      groups[key].push(job)
    }
    // Agendamentos do usuário primeiro; jobs técnicos depois.
    return Object.entries(groups).sort(([a], [b]) => {
      if (a === MASTER_LOOP_JOB_TYPE) return -1
      if (b === MASTER_LOOP_JOB_TYPE) return 1
      return a.localeCompare(b)
    })
  }, [filteredJobs])

  useEffect(() => {
    async function fetchJobs() {
      try {
        const data = await scheduledJobsApi.list()
        setJobs(data as ScheduledJobExtended[])
      } catch (error) {
        console.error('Failed to fetch jobs:', error)
      } finally {
        setLoading(false)
      }
    }
    fetchJobs()
    const interval = setInterval(fetchJobs, 10000)
    return () => clearInterval(interval)
  }, [])

  const refetchJobs = async () => {
    try {
      const data = await scheduledJobsApi.list()
      setJobs(data as ScheduledJobExtended[])
    } catch (error) {
      console.error('Failed to refetch jobs:', error)
    }
  }

  async function toggleJob(job: ScheduledJobExtended) {
    try {
      const isActive = job.status === 'pending' || job.status === 'running'
      // 'pending' é o status que o worker reclama; 'disabled' fica fora da fila
      const newStatus = isActive ? 'disabled' : 'pending'
      await scheduledJobsApi.update(job.id, { status: newStatus })
      setJobs(prev => prev.map(j => j.id === job.id ? { ...j, status: newStatus } : j))
      toast('success', `Agendamento ${newStatus === 'pending' ? 'ativado' : 'pausado'}`)
    } catch (error) {
      toast('error', 'Erro ao atualizar agendamento')
      console.error('Failed to toggle job:', error)
    }
  }

  async function pauseAll() {
    const activeJobs = filteredJobs.filter(j => j.status === 'pending' || j.status === 'running')
    if (activeJobs.length === 0) return
    setPausingAll(true)
    toast('loading', 'Pausando todos os agendamentos...')
    try {
      await Promise.all(
        activeJobs.map(j => scheduledJobsApi.update(j.id, { status: 'disabled' }))
      )
      const pausedIds = new Set(activeJobs.map(j => j.id))
      setJobs(prev => prev.map(j =>
        pausedIds.has(j.id) ? { ...j, status: 'disabled' } : j
      ))
      toast('success', `${activeJobs.length} agendamento(s) pausado(s)`)
    } catch (error) {
      toast('error', 'Erro ao pausar agendamentos')
      console.error('Failed to pause all:', error)
    } finally {
      setPausingAll(false)
    }
  }

  function deleteJob(id: string) {
    setDeletingJobId(id)
  }

  async function confirmDeleteJob() {
    if (!deletingJobId) return
    toast('loading', 'Deletando agendamento...')
    try {
      await scheduledJobsApi.delete(deletingJobId)
      toast('success', 'Agendamento deletado com sucesso')
      setJobs(prev => prev.filter(j => j.id !== deletingJobId))
      setDeletingJobId(null)
    } catch (error) {
      toast('error', 'Erro ao deletar agendamento')
      console.error('Failed to delete job:', error)
      setDeletingJobId(null)
    }
  }

  const openCreateModal = () => {
    setEditingJob(null)
    setAdvancedOpen(false)
    setLoopForm({ ...defaultLoopForm, scheduledAt: minutesFromNow(5) })
    setAdvancedForm({ ...defaultAdvancedForm, scheduledAt: minutesFromNow(5) })
    setError(null)
    setShowModal(true)
  }

  const openEditModal = (job: ScheduledJobExtended) => {
    setEditingJob(job)
    setError(null)
    const local = toLocalInput(new Date(job.scheduledAt))

    if (isMasterLoop(job)) {
      const payload = loopPayload(job)
      setAdvancedOpen(false)
      setLoopForm({
        instructions: payload.instructions,
        scheduledAt: local,
        repeat: !!payload.repeatIntervalMinutes,
        repeatIntervalMinutes: String(payload.repeatIntervalMinutes ?? 60),
        limitRuns: !!payload.maxRuns,
        maxRuns: String(payload.maxRuns ?? 3),
        notes: job.notes || '',
      })
    } else {
      // Job técnico: abre direto na seção avançada.
      setAdvancedOpen(true)
      setAdvancedForm({
        type: job.type,
        payload: job.payload ? JSON.stringify(job.payload, null, 2) : '{}',
        scheduledAt: local,
        notes: job.notes || '',
      })
    }
    setShowModal(true)
  }

  const handleSave = async () => {
    setError(null)
    if (advancedOpen) {
      await saveAdvanced()
    } else {
      await saveLoop()
    }
  }

  const saveLoop = async () => {
    const instructions = loopForm.instructions.trim()
    if (!instructions || !loopForm.scheduledAt) return

    // Editar preserva o projeto original do agendamento; criar usa o selecionado.
    const projectId = editingJob ? loopPayload(editingJob).projectId : currentProject?.id
    if (!projectId) {
      setError('Selecione um projeto antes de criar um agendamento.')
      return
    }

    const repeatIntervalMinutes = loopForm.repeat ? Number(loopForm.repeatIntervalMinutes) : undefined
    const maxRuns = loopForm.repeat && loopForm.limitRuns ? Number(loopForm.maxRuns) : undefined
    if (repeatIntervalMinutes !== undefined && (!Number.isInteger(repeatIntervalMinutes) || repeatIntervalMinutes < 1)) {
      setError('O intervalo deve ser um número inteiro de minutos, no mínimo 1.')
      return
    }
    if (maxRuns !== undefined && (!Number.isInteger(maxRuns) || maxRuns < 1)) {
      setError('O limite de execuções deve ser um número inteiro, no mínimo 1.')
      return
    }

    setSaving(true)
    try {
      const scheduledAt = new Date(loopForm.scheduledAt).toISOString()
      if (editingJob) {
        await scheduledJobsApi.update(editingJob.id, {
          type: MASTER_LOOP_JOB_TYPE,
          payload: { instructions, projectId, repeatIntervalMinutes, maxRuns },
          scheduledAt,
          notes: loopForm.notes || undefined,
        })
      } else {
        await scheduledJobsApi.createMasterLoop({
          instructions,
          projectId,
          scheduledAt,
          repeatIntervalMinutes,
          maxRuns,
          notes: loopForm.notes || undefined,
        })
      }
      setShowModal(false)
      await refetchJobs()
      toast('success', editingJob ? 'Agendamento atualizado' : 'Agendamento criado')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao salvar o agendamento')
    } finally {
      setSaving(false)
    }
  }

  const saveAdvanced = async () => {
    if (!advancedForm.type || !advancedForm.scheduledAt) return
    setSaving(true)
    try {
      let parsedPayload = {}
      try {
        parsedPayload = JSON.parse(advancedForm.payload || '{}')
      } catch {
        setError('JSON inválido no campo payload')
        setSaving(false)
        return
      }
      const body = {
        type: advancedForm.type,
        payload: parsedPayload,
        scheduledAt: new Date(advancedForm.scheduledAt).toISOString(),
        notes: advancedForm.notes || undefined,
      }
      if (editingJob) {
        await scheduledJobsApi.update(editingJob.id, body)
      } else {
        await scheduledJobsApi.create(body)
      }
      setShowModal(false)
      await refetchJobs()
      toast('success', editingJob ? 'Job atualizado' : 'Job técnico criado')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao salvar o job')
    } finally {
      setSaving(false)
    }
  }

  const activeCount = jobs.filter(j => j.status === 'pending' || j.status === 'running').length
  const filteredActiveCount = filteredJobs.filter(j => j.status === 'pending' || j.status === 'running').length
  const canSave = advancedOpen
    ? !!advancedForm.type && !!advancedForm.scheduledAt
    : !!loopForm.instructions.trim() && !!loopForm.scheduledAt

  if (loading) {
    return (
      <Shell>
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <header className="flex items-center justify-between px-4 lg:px-6 py-3 border-b border-border bg-card/50 sticky top-0 z-10">
            <div className="space-y-2">
              <div className="h-4 w-20 bg-muted/50 rounded animate-pulse" />
              <div className="h-3 w-32 bg-muted/50 rounded animate-pulse" />
            </div>
          </header>
          <div className="flex-1 min-h-0 overflow-y-auto p-4 lg:p-6 space-y-6">
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
            <h1 className="text-sm font-semibold text-foreground">Agendamentos</h1>
            <p className="text-[11px] text-muted-foreground font-mono mt-0.5">
              {activeCount} ativos · {jobs.length} total
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={pauseAll}
              disabled={pausingAll || filteredActiveCount === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {pausingAll ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PauseCircle className="w-3.5 h-3.5" />}
              {statusFilter === 'all' ? 'Pausar Todos' : 'Pausar Filtrados'} ({filteredActiveCount})
            </button>
            <button
              onClick={openCreateModal}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Novo Agendamento
            </button>
          </div>
        </header>

        <div className="flex items-center gap-1 px-4 lg:px-6 py-2 border-b border-border">
          {filterTabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setStatusFilter(tab.key)}
              className={cn(
                'px-3 py-1 rounded-md text-[11px] font-mono transition-colors',
                statusFilter === tab.key
                  ? 'bg-primary/15 text-primary'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-4 lg:p-6 space-y-6">
          {groupedJobs.length === 0 && jobs.length === 0 && (
            <div className="flex flex-col items-center justify-center h-60 gap-3">
              <Inbox className="w-10 h-10 text-muted-foreground/50" />
              <div className="text-center">
                <p className="text-sm font-medium text-foreground">Nenhum agendamento</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Escreva instruções e o orquestrador as manda para o terminal do Master na hora marcada — uma vez ou em loop
                </p>
              </div>
              <button
                onClick={openCreateModal}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs bg-primary text-primary-foreground hover:bg-primary/90 transition-colors mt-2"
              >
                <Plus className="w-3.5 h-3.5" />
                Criar o primeiro agendamento
              </button>
            </div>
          )}

          {groupedJobs.length === 0 && jobs.length > 0 && (
            <div className="flex flex-col items-center justify-center py-12 gap-2">
              <Filter className="w-8 h-8 text-muted-foreground/50" />
              <p className="text-xs text-muted-foreground">Nenhum agendamento neste filtro</p>
            </div>
          )}

          {groupedJobs.map(([type, typeJobs]) => (
            <div key={type}>
              <h2 className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-3 flex items-center gap-2">
                {type === MASTER_LOOP_JOB_TYPE
                  ? <MessageSquareText className="w-3 h-3" />
                  : <Zap className="w-3 h-3" />}
                {friendlyType(type)}
                {isCustomType(type) && (
                  <span className="px-1.5 py-0.5 rounded text-[8px] bg-primary/10 text-primary uppercase tracking-wider">
                    Custom
                  </span>
                )}
                <span className="text-muted-foreground/50">({typeJobs.length})</span>
              </h2>
              <div className="space-y-2">
                {typeJobs.map(job => (
                  <JobCard
                    key={job.id}
                    job={job}
                    projectName={isMasterLoop(job) ? projectNames[loopPayload(job).projectId] : undefined}
                    onToggle={toggleJob}
                    onEdit={openEditModal}
                    onDelete={deleteJob}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>

        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => !saving && setShowModal(false)}>
            <div className="w-full max-w-md max-h-full overflow-y-auto rounded-lg border border-border bg-card shadow-xl" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                <h2 className="text-sm font-semibold text-foreground">
                  {editingJob ? 'Editar Agendamento' : 'Novo Agendamento'}
                </h2>
                <button onClick={() => !saving && setShowModal(false)} className="p-1 rounded hover:bg-muted/40">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="px-6 py-4 space-y-4">
                {!advancedOpen && (
                  <>
                    <div>
                      <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-1 block">
                        Instruções *
                      </label>
                      <textarea
                        value={loopForm.instructions}
                        onChange={(e) => setLoopForm({ ...loopForm, instructions: e.target.value })}
                        rows={5}
                        autoFocus
                        className="w-full bg-input rounded-md px-3 py-2 text-xs text-foreground outline-none border border-border focus:border-primary/50 transition-colors resize-none"
                        placeholder="Ex.: Revise as sessões travadas, tente desbloquear o que der e me manda um resumo no chat."
                      />
                      <p className="text-[10px] text-muted-foreground mt-1">
                        Vai como prompt para o terminal do Master{!editingJob && currentProject ? ` no projeto ${currentProject.name}` : ''}.
                        Escreva algo autocontido — o Master recebe isso sem contexto de conversa.
                      </p>
                    </div>

                    <div>
                      <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-1 block">
                        Primeira execução *
                      </label>
                      <input
                        type="datetime-local"
                        value={loopForm.scheduledAt}
                        onChange={(e) => setLoopForm({ ...loopForm, scheduledAt: e.target.value })}
                        className="w-full bg-input rounded-md px-3 py-2 text-xs text-foreground outline-none border border-border focus:border-primary/50 transition-colors"
                      />
                      <div className="flex items-center gap-1.5 mt-1.5">
                        {quickWhen.map(shortcut => (
                          <button
                            key={shortcut.label}
                            type="button"
                            onClick={() => setLoopForm({ ...loopForm, scheduledAt: minutesFromNow(shortcut.minutes) })}
                            className="px-2 py-0.5 rounded text-[10px] font-mono border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                          >
                            {shortcut.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground block">
                        Repetição
                      </label>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setLoopForm({ ...loopForm, repeat: false })}
                          className={cn(
                            'flex-1 px-3 py-1.5 rounded-md text-[11px] border transition-colors',
                            !loopForm.repeat
                              ? 'border-primary/50 bg-primary/10 text-primary'
                              : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted/40'
                          )}
                        >
                          Uma vez
                        </button>
                        <button
                          type="button"
                          onClick={() => setLoopForm({ ...loopForm, repeat: true })}
                          className={cn(
                            'flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] border transition-colors',
                            loopForm.repeat
                              ? 'border-primary/50 bg-primary/10 text-primary'
                              : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted/40'
                          )}
                        >
                          <Repeat className="w-3 h-3" />
                          Repetir
                        </button>
                      </div>

                      {loopForm.repeat && (
                        <div className="space-y-2 rounded-md border border-border/60 bg-muted/20 p-3">
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] text-muted-foreground">A cada</span>
                            <input
                              type="number"
                              min={1}
                              step={1}
                              value={loopForm.repeatIntervalMinutes}
                              onChange={(e) => setLoopForm({ ...loopForm, repeatIntervalMinutes: e.target.value })}
                              className="w-20 bg-input rounded-md px-2 py-1 text-xs text-foreground outline-none border border-border focus:border-primary/50 transition-colors"
                            />
                            <span className="text-[11px] text-muted-foreground">minutos</span>
                          </div>
                          <p className="text-[10px] text-muted-foreground/80 leading-snug">
                            A cada intervalo, o orquestrador cola as instruções acima no terminal do
                            Master — como se você tivesse digitado na hora. Se o Master estiver
                            desligado ou noutro projeto, esta execução é ADIADA (não é descontada do
                            total abaixo) e tentada de novo em 5 min.
                          </p>
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={loopForm.limitRuns}
                              onChange={(e) => setLoopForm({ ...loopForm, limitRuns: e.target.checked })}
                              className="accent-primary"
                            />
                            <span className="text-[11px] text-muted-foreground">Parar após</span>
                            <input
                              type="number"
                              min={1}
                              step={1}
                              disabled={!loopForm.limitRuns}
                              value={loopForm.maxRuns}
                              onChange={(e) => setLoopForm({ ...loopForm, maxRuns: e.target.value })}
                              className="w-16 bg-input rounded-md px-2 py-1 text-xs text-foreground outline-none border border-border focus:border-primary/50 transition-colors disabled:opacity-40"
                            />
                            <span className="text-[11px] text-muted-foreground">execuções</span>
                          </label>
                          {!loopForm.limitRuns && (
                            <p className="text-[10px] text-status-waiting">
                              Sem limite: repete para sempre, até você pausar ou deletar este agendamento.
                            </p>
                          )}
                          <p className="text-[10px] text-muted-foreground/80 leading-snug">
                            Se o Master ficar fora do ar por muito tempo, os adiamentos se acumulam —
                            depois de {MASTER_LOOP_MAX_DEFERRALS} seguidos (~2h) o agendamento desiste e
                            vira "failed" em vez de tentar pra sempre.
                          </p>
                        </div>
                      )}
                    </div>

                    <div>
                      <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-1 block">Notas</label>
                      <textarea
                        value={loopForm.notes}
                        onChange={(e) => setLoopForm({ ...loopForm, notes: e.target.value })}
                        rows={2}
                        className="w-full bg-input rounded-md px-3 py-2 text-xs text-foreground outline-none border border-border focus:border-primary/50 transition-colors resize-none"
                        placeholder="Observações sobre este agendamento..."
                      />
                    </div>
                  </>
                )}

                {/* Seção Avançado: jobs técnicos internos do orquestrador. Fechada por padrão. */}
                <div className="border-t border-border pt-3">
                  <button
                    type="button"
                    onClick={() => { setAdvancedOpen(!advancedOpen); setError(null) }}
                    disabled={!!editingJob}
                    title={editingJob ? 'O tipo de um agendamento existente não muda aqui' : undefined}
                    className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {advancedOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    Avançado — job técnico do orquestrador
                  </button>

                  {advancedOpen && (
                    <div className="space-y-4 mt-3">
                      <p className="text-[10px] text-muted-foreground">
                        Jobs internos do worker (timeouts, limpeza de worktrees). Normalmente o próprio
                        orquestrador cria estes — use só se souber o payload esperado.
                      </p>
                      <div>
                        <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-1 block">Tipo *</label>
                        <select
                          value={advancedForm.type}
                          onChange={(e) => setAdvancedForm({ ...advancedForm, type: e.target.value })}
                          className="w-full bg-input rounded-md px-3 py-2 text-xs text-foreground outline-none border border-border focus:border-primary/50 transition-colors"
                        >
                          {TECHNICAL_JOB_TYPES.map(value => (
                            <option key={value} value={value}>{JOB_TYPE_LABELS[value]}</option>
                          ))}
                          {editingJob && !TECHNICAL_JOB_TYPES.includes(advancedForm.type as (typeof TECHNICAL_JOB_TYPES)[number]) && (
                            <option value={advancedForm.type}>{friendlyType(advancedForm.type)}</option>
                          )}
                        </select>
                        {TECHNICAL_JOB_HINTS[advancedForm.type as (typeof TECHNICAL_JOB_TYPES)[number]] && (
                          <p className="text-[10px] text-muted-foreground mt-1.5">
                            {TECHNICAL_JOB_HINTS[advancedForm.type as (typeof TECHNICAL_JOB_TYPES)[number]]}
                          </p>
                        )}
                      </div>
                      <div>
                        <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-1 block">Agendado para *</label>
                        <input
                          type="datetime-local"
                          value={advancedForm.scheduledAt}
                          onChange={(e) => setAdvancedForm({ ...advancedForm, scheduledAt: e.target.value })}
                          className="w-full bg-input rounded-md px-3 py-2 text-xs text-foreground outline-none border border-border focus:border-primary/50 transition-colors"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-1 block">Payload (JSON)</label>
                        <textarea
                          value={advancedForm.payload}
                          onChange={(e) => setAdvancedForm({ ...advancedForm, payload: e.target.value })}
                          rows={4}
                          className="w-full bg-input rounded-md px-3 py-2 text-xs text-foreground outline-none border border-border focus:border-primary/50 transition-colors resize-none font-mono"
                          placeholder="{}"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-1 block">Notas</label>
                        <textarea
                          value={advancedForm.notes}
                          onChange={(e) => setAdvancedForm({ ...advancedForm, notes: e.target.value })}
                          rows={2}
                          className="w-full bg-input rounded-md px-3 py-2 text-xs text-foreground outline-none border border-border focus:border-primary/50 transition-colors resize-none"
                          placeholder="Observações sobre este job..."
                        />
                      </div>
                    </div>
                  )}
                </div>

                {error && (
                  <p className="text-[11px] text-destructive">{error}</p>
                )}
              </div>

              <div className="px-6 py-3 border-t border-border flex justify-end gap-2">
                <button
                  onClick={() => setShowModal(false)}
                  disabled={saving}
                  className="text-[11px] text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-md transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || !canSave}
                  className="flex items-center gap-1.5 text-[11px] bg-primary text-primary-foreground px-3 py-1.5 rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {saving
                    ? <><Loader2 className="w-3 h-3 animate-spin" /> Salvando...</>
                    : advancedOpen ? 'Salvar job' : 'Agendar'}
                </button>
              </div>
            </div>
          </div>
        )}
        {deletingJobId && (
          <ConfirmModal
            title="Deletar Agendamento"
            message="Deletar este agendamento?"
            confirmLabel="Deletar"
            destructive
            onConfirm={confirmDeleteJob}
            onCancel={() => setDeletingJobId(null)}
          />
        )}
      </div>
    </Shell>
  )
}

function JobCard({
  job,
  projectName,
  onToggle,
  onEdit,
  onDelete,
}: {
  job: ScheduledJobExtended
  projectName?: string
  onToggle: (job: ScheduledJobExtended) => void
  onEdit: (job: ScheduledJobExtended) => void
  onDelete: (id: string) => void
}) {
  const isActive = job.status === 'pending' || job.status === 'running'
  const masterLoop = isMasterLoop(job)
  const payload = masterLoop ? loopPayload(job) : null

  return (
    <div
      className={cn(
        'rounded-lg border bg-card p-4 transition-colors',
        isActive ? 'border-border hover:border-primary/30' : 'border-border/50 bg-card/50 opacity-60'
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div className={cn(
            'w-8 h-8 rounded-lg flex items-center justify-center shrink-0',
            isActive ? 'bg-primary/10' : 'bg-muted'
          )}>
            {masterLoop
              ? <MessageSquareText className={cn('w-4 h-4', isActive ? 'text-primary' : 'text-muted-foreground')} />
              : <Clock className={cn('w-4 h-4', isActive ? 'text-primary' : 'text-muted-foreground')} />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className={cn('text-xs font-semibold', isActive ? 'text-foreground' : 'text-muted-foreground')}>
                {masterLoop ? (projectName || 'Instruções Agendadas') : friendlyType(job.type)}
              </p>
              {isCustomType(job.type) && (
                <span className="px-1.5 py-0.5 rounded text-[8px] bg-primary/10 text-primary uppercase tracking-wider">
                  Custom
                </span>
              )}
              {job.notes && (
                <span className="relative group" title={job.notes}>
                  <StickyNote className="w-3 h-3 text-muted-foreground/60 cursor-help" />
                  <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block w-48 p-2 rounded-md bg-popover border border-border shadow-lg text-[10px] text-foreground font-mono whitespace-pre-wrap z-50">
                    {job.notes}
                  </span>
                </span>
              )}
            </div>

            {payload ? (
              <>
                <p className="text-[11px] text-foreground/90 mt-1 line-clamp-2 whitespace-pre-wrap break-words">
                  {payload.instructions || <span className="text-muted-foreground italic">sem instruções</span>}
                </p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-[10px] font-mono text-muted-foreground">
                  <span className="text-primary/80">run {payload.runCount}/{runsLabel(payload)}</span>
                  <span>{cadenceLabel(payload)}</span>
                  <span>
                    {isActive ? 'próxima ' : ''}{formatRelativeTime(job.scheduledAt)}
                    <span className="text-muted-foreground/40 ml-1">
                      ({new Date(job.scheduledAt).toLocaleString()})
                    </span>
                  </span>
                  {payload.lastRunAt && <span>último {formatRelativeTime(payload.lastRunAt)}</span>}
                  {!!payload.deferCount && (
                    <span
                      className="text-status-waiting"
                      title={`Adiado ${payload.deferCount}x seguidas — o Master estava fora do ar (ou noutro projeto) na hora marcada. Depois de ${MASTER_LOOP_MAX_DEFERRALS} adiamentos seguidos o job desiste.`}
                    >
                      adiado {payload.deferCount}/{MASTER_LOOP_MAX_DEFERRALS}
                    </span>
                  )}
                </div>
                {payload.lastError && (
                  <p className="flex items-start gap-1 text-[10px] text-status-waiting mt-1">
                    <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                    <span className="break-words">
                      {payload.lastError}
                      {!!payload.deferCount && ' — motivo do último adiamento, não um erro fatal.'}
                    </span>
                  </p>
                )}
              </>
            ) : (
              <>
                <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">
                  {formatRelativeTime(job.scheduledAt)}
                  <span className="text-muted-foreground/40 ml-2">
                    ({new Date(job.scheduledAt).toLocaleString()})
                  </span>
                </p>
                {TECHNICAL_JOB_HINTS[job.type as (typeof TECHNICAL_JOB_TYPES)[number]] && (
                  <p className="text-[10px] text-muted-foreground/80 mt-1">
                    {TECHNICAL_JOB_HINTS[job.type as (typeof TECHNICAL_JOB_TYPES)[number]]}
                  </p>
                )}
                {job.payload && Object.keys(job.payload).length > 0 && (
                  <p className="text-[10px] text-muted-foreground mt-1 font-mono truncate">
                    {JSON.stringify(job.payload)}
                  </p>
                )}
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={cn(
            'text-[9px] font-mono px-1.5 py-0.5 rounded',
            job.status === 'pending' ? 'bg-status-waiting/15 text-status-waiting' :
            job.status === 'running' ? 'bg-status-running/15 text-status-running' :
            job.status === 'failed' ? 'bg-destructive/15 text-destructive' :
            'bg-muted text-muted-foreground'
          )}>
            {STATUS_LABELS[job.status] || job.status.toUpperCase()}
          </span>
          <button
            onClick={() => onEdit(job)}
            className="p-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
            title="Editar"
          >
            <Pencil className="w-3 h-3" />
          </button>
          <button
            onClick={() => onToggle(job)}
            className="p-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
            title={isActive ? 'Pausar' : 'Ativar'}
          >
            {isActive ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
          </button>
          <button
            onClick={() => onDelete(job.id)}
            className="p-1.5 rounded-md border border-destructive/30 text-destructive hover:bg-destructive/10 transition-colors"
            title="Deletar"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  )
}
