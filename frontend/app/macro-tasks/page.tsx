'use client'

import { Shell } from '@/components/shell'
import { macroTasksApi, pipelinesApi, agentsApi, pipelineExecutionApi, healthApi, githubApi, type MacroTask, type Pipeline, type Agent, type GitHubIssue, type GitHubStatus, type BatchCreateResult } from '@/lib/api'
import { useProject } from '@/lib/project-context'
import type { MacroTaskStatus } from '@/lib/status'
import { cn } from '@/lib/utils'
import { ListTodo, ChevronDown, Terminal, GitBranch, Clock, CheckCircle2, Circle, AlertCircle, Plus, X, Play, Loader2, Inbox, Filter, Pencil, Trash2, RotateCcw, ShieldCheck, ShieldAlert, Upload, CircleDot, Search } from 'lucide-react'
import Link from 'next/link'
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useGlobalSSE, type SseEvent } from '@/lib/use-sse'
import { useToast } from '@/components/toast-provider'
import { SkeletonKanban } from '@/components/ui/skeleton'
import { BacklogSection } from '@/components/macro-tasks/backlog-section'

/**
 * Colunas do kanban — subconjunto do vocabulário canônico (`lib/status.ts`), não
 * uma lista à parte. `Extract` é o que impede a divergência silenciosa que a
 * MT-15 fechou: renomear um status no canônico quebra o build aqui em vez de
 * deixar a macro task invisível na tela.
 */
type TaskStatus = Extract<MacroTaskStatus, 'pending' | 'planned' | 'running' | 'review' | 'done'>

interface Task extends MacroTask {
  agent?: string
  branch?: string
  tags?: string[]
}

// "Backlog" saiu daqui de propósito: a palavra passou a designar os itens vindos
// dos task-reports (melhorias.md #5), que vivem na seção própria abaixo do kanban.
const statusColumns: { key: TaskStatus; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'planned', label: 'Planned' },
  { key: 'running', label: 'Running' },
  { key: 'review', label: 'Review' },
  { key: 'done', label: 'Done' },
]

const priorityColors = {
  0: 'text-muted-foreground',
  1: 'text-status-waiting',
  2: 'text-destructive',
}

const statusIcons = {
  pending: Circle,
  planned: AlertCircle,
  running: Terminal,
  review: Clock,
  done: CheckCircle2,
}

const RUNNABLE_STATUSES = ['pending', 'planned', 'backlog']
const isRunnable = (task: Task) => RUNNABLE_STATUSES.includes(task.status)

/**
 * Eventos SSE que podem mudar a LISTA de macro tasks (ver
 * `backend/src/redis/channels.ts`). Enumerado em vez de casado por prefixo:
 * `session:log` e `session:chat` são um evento por chunk de saída e só
 * mudariam o refetch de tempo em tempo para refetch por tecla digitada.
 * `question:*` e `git:changed` não mexem no kanban.
 */
const TASK_LIST_EVENTS = new Set([
  'session:created',
  'session:updated',
  'session:deleted',
  'session:status',
  'session:paused',
  'session:resumed',
  'session:completed',
  'session:stage-start',
  'session:stage-complete',
  'session:stage-failed',
  'session:stalled',
])

function RunningDot() {
  return (
    <span className="relative flex h-2 w-2" title="Running">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-status-running opacity-75" />
      <span className="relative inline-flex rounded-full h-2 w-2 bg-status-running" />
    </span>
  )
}

export default function MacroTasksPage() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [newTask, setNewTask] = useState({
    title: '',
    description: '',
    pipelineId: '',
    priority: 0,
  })
  const [runTask, setRunTask] = useState<Task | null>(null)
  const [agents, setAgents] = useState<Agent[]>([])
  const [agentsLoading, setAgentsLoading] = useState(false)
  const [selectedAgentId, setSelectedAgentId] = useState('')
  const [starting, setStarting] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)
  const [runSuccess, setRunSuccess] = useState<string | null>(null)
  const [filterPriority, setFilterPriority] = useState<number | null>(null)
  const [filterPipeline, setFilterPipeline] = useState<string | null>(null)
  const [filterAgent, setFilterAgent] = useState<string | null>(null)
  const [showFilters, setShowFilters] = useState(false)
  const [precheckOpen, setPrecheckOpen] = useState(false)
  const [precheckLoading, setPrecheckLoading] = useState(false)
  const [precheckResult, setPrecheckResult] = useState<{
    status: string;
    checks: Record<string, any>;
  } | null>(null)
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [editData, setEditData] = useState({ title: '', description: '', priority: 0, pipelineId: '' })
  const [deletingTask, setDeletingTask] = useState<Task | null>(null)
  const [restartingTask, setRestartingTask] = useState<Task | null>(null)
  // --- Import (JSON / GitHub Issues) ---
  const [showImportModal, setShowImportModal] = useState(false)
  const [importMode, setImportMode] = useState<'json' | 'github'>('json')
  const [importPipelineId, setImportPipelineId] = useState('')
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [importResult, setImportResult] = useState<BatchCreateResult | null>(null)
  const [jsonText, setJsonText] = useState('')
  const [ghStatus, setGhStatus] = useState<GitHubStatus | null>(null)
  const [ghStatusLoading, setGhStatusLoading] = useState(false)
  const [ghRepo, setGhRepo] = useState('')
  const [ghState, setGhState] = useState('open')
  const [ghIssues, setGhIssues] = useState<GitHubIssue[]>([])
  const [ghSelected, setGhSelected] = useState<number[]>([])
  const [ghLoading, setGhLoading] = useState(false)
  const [ghError, setGhError] = useState<string | null>(null)
  const { currentProject } = useProject()
  const { toast, update } = useToast()

  const refetchTasks = useCallback(async () => {
    if (!currentProject) return
    try {
      const updatedTasks = await macroTasksApi.list(currentProject.id)
      setTasks(updatedTasks.data)
    } catch (error) {
      console.error('Failed to refetch tasks:', error)
    }
  }, [currentProject])

  useEffect(() => {
    if (!currentProject) {
      // sem projeto: não fica preso no skeleton
      setTasks([])
      setLoading(false)
      return
    }
    let cancelled = false
    async function fetchData() {
      try {
        const [tasksData, pipelinesData] = await Promise.all([
          macroTasksApi.list(currentProject!.id),
          pipelinesApi.list(currentProject!.id),
        ])
        if (cancelled) return
        setTasks(tasksData.data)
        setPipelines(pipelinesData)
        if (pipelinesData.length > 0) {
          setNewTask(prev => (prev.pipelineId ? prev : { ...prev, pipelineId: pipelinesData[0].id }))
        }
      } catch (error) {
        console.error('Failed to fetch data:', error)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetchData()
    return () => {
      cancelled = true
    }
  }, [currentProject])

  /**
   * Auto-refresh via SSE, no lugar do antigo poll de 10s (MT-17). Ganho duplo:
   * o kanban reflete a mudança de status na hora em vez de com até 10s de
   * atraso, e o par list+pipelines para de ser refeito a cada 10s por aba
   * aberta — a MT-7 passou a criar uma macro task por finding, então a lista
   * só cresce.
   *
   * Só a lista de tasks é recarregada. `pipelines` alimenta os selects dos
   * modais e muda por ação do usuário na /pipelines, não por evento de sessão:
   * refazer aquele fetch em cada evento era metade da carga do poll antigo.
   *
   * A lista de eventos é explícita porque `session:log` (um evento por chunk de
   * PTY) e `master:activity` (idem, `phase: 'chunk'`) passariam num
   * `startsWith('session:')` e trocariam o poll de 10s por um refetch por
   * chunk — o oposto do objetivo.
   */
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const backlogTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Depende de `currentProject` e não de `[]`: na troca de projeto, um timer já
  // agendado ainda apontaria para o `refetchTasks` do projeto ANTERIOR e
  // sobrescreveria a lista nova com a antiga (até 3s depois, no caso do
  // `backlogTimer`). O poll antigo não tinha esse furo porque o `clearInterval`
  // vinha no cleanup do mesmo effect que dependia do projeto.
  useEffect(() => {
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
      if (backlogTimer.current) clearTimeout(backlogTimer.current)
      refreshTimer.current = null
      backlogTimer.current = null
    }
  }, [currentProject])

  const handleSseEvent = useCallback(
    (event: SseEvent) => {
      if (!TASK_LIST_EVENTS.has(event.type)) return

      // Debounce: um stage que termina dispara stage-complete + status +
      // stage-start em sequência: colapsa a rajada num refetch só.
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
      refreshTimer.current = setTimeout(() => {
        refreshTimer.current = null
        void refetchTasks()
      }, 500)

      // A ingestão de backlog (MT-7) roda DEPOIS do `session:completed` e não
      // publica evento próprio, então o refetch acima chega cedo demais para
      // ver as tasks que ela cria. Uma segunda passada fecha essa janela — era
      // o que o poll de 10s cobria por acidente.
      if (event.type === 'session:completed') {
        if (backlogTimer.current) clearTimeout(backlogTimer.current)
        backlogTimer.current = setTimeout(() => {
          backlogTimer.current = null
          void refetchTasks()
        }, 3000)
      }
    },
    [refetchTasks]
  )

  useGlobalSSE(handleSseEvent, !!currentProject, currentProject?.id)

  const openRunModal = async (task: Task) => {
    if (!currentProject) return
    setRunTask(task)
    setRunError(null)
    setAgentsLoading(true)
    try {
      const agentsData = await agentsApi.list(currentProject.id)
      setAgents(agentsData)
      setSelectedAgentId(agentsData[0]?.id ?? '')
    } catch (error) {
      console.error('Failed to load agents:', error)
      setAgents([])
      setSelectedAgentId('')
      setRunError('Failed to load agents. Please try again.')
    } finally {
      setAgentsLoading(false)
    }
  }

  const closeRunModal = () => {
    if (starting) return
    setRunTask(null)
    setRunError(null)
  }

  const handleStartPipeline = async () => {
    if (!runTask || !selectedAgentId) return
    setPrecheckOpen(true)
    setPrecheckLoading(true)
    setPrecheckResult(null)
    setRunError(null)
    try {
      const result = await healthApi.detailed()
      setPrecheckResult(result)
    } catch (error) {
      setPrecheckResult({
        status: 'error',
        checks: { connection: { status: 'error', message: error instanceof Error ? error.message : 'Failed to reach health endpoint' } },
      })
    } finally {
      setPrecheckLoading(false)
    }
  }

  const handleConfirmStart = async () => {
    if (!runTask || !selectedAgentId) return
    setPrecheckOpen(false)
    setStarting(true)
    setRunError(null)
    const toastId = toast('loading', 'Iniciando pipeline...')
    try {
      await pipelineExecutionApi.start(runTask.pipelineId, {
        macroTaskId: runTask.id,
        agentId: selectedAgentId,
      })
      update(toastId, 'success', 'Pipeline iniciado com sucesso')
      setRunSuccess(runTask.title)
      setRunTask(null)
      await refetchTasks()
    } catch (error) {
      update(toastId, 'error', 'Erro ao iniciar pipeline')
      console.error('Failed to start pipeline:', error)
      setRunError(error instanceof Error ? error.message : 'Failed to start pipeline. Please try again.')
    } finally {
      setStarting(false)
    }
  }

  const isPrecheckOk = (result: typeof precheckResult): boolean => {
    if (!result) return false
    return Object.entries(result.checks).every(([key, value]) => {
      if (key === 'cliProfiles' || key === 'cli_profiles') {
        return typeof value === 'object' && value !== null && !('status' in value)
          ? Object.values(value as Record<string, any>).every((c: any) => c.status === 'ok')
          : (value as any).status === 'ok'
      }
      return (value as any).status === 'ok'
    })
  }

  const handleCreateTask = async () => {
    if (!currentProject || !newTask.title || !newTask.pipelineId) return
    
    const toastId = toast('loading', 'Criando macro task...')
    try {
      // NÃO enviar `status`: CreateMacroTaskDto não o declara e o ValidationPipe global roda com
      // forbidNonWhitelisted, então o campo derrubava a request com 400. O Prisma já usa 'pending'
      // como default da coluna.
      await macroTasksApi.create(currentProject.id, {
        title: newTask.title,
        description: newTask.description,
        pipelineId: newTask.pipelineId,
        priority: newTask.priority,
      })
      update(toastId, 'success', 'Macro task criada com sucesso')
      setShowCreateModal(false)
      setNewTask({ title: '', description: '', pipelineId: pipelines[0]?.id || '', priority: 0 })
      
      const updatedTasks = await macroTasksApi.list(currentProject.id)
      setTasks(updatedTasks.data)
    } catch (error) {
      update(toastId, 'error', 'Erro ao criar macro task')
      console.error('Failed to create task:', error)
    }
  }

  const filteredTasks = useMemo(() => {
    return tasks.filter(t => {
      if (filterPriority !== null && t.priority !== filterPriority) return false
      if (filterPipeline !== null && t.pipelineId !== filterPipeline) return false
      if (filterAgent !== null && !t.sessions?.some(s => s.agentId === filterAgent)) return false
      return true
    })
  }, [tasks, filterPriority, filterPipeline, filterAgent])

  const hasActiveFilters = filterPriority !== null || filterPipeline !== null || filterAgent !== null

  const openEditModal = (task: Task) => {
    setEditingTask(task)
    setEditData({
      title: task.title,
      description: task.description || '',
      priority: task.priority,
      pipelineId: task.pipelineId,
    })
  }

  const handleUpdateTask = async () => {
    if (!currentProject || !editingTask || !editData.title || !editData.pipelineId) return
    try {
      await macroTasksApi.update(currentProject.id, editingTask.id, {
        title: editData.title,
        description: editData.description,
        priority: editData.priority,
        pipelineId: editData.pipelineId,
      })
      setEditingTask(null)
      await refetchTasks()
    } catch (error) {
      console.error('Failed to update task:', error)
    }
  }

  const handleDeleteTask = async () => {
    if (!currentProject || !deletingTask) return
    try {
      await macroTasksApi.delete(currentProject.id, deletingTask.id)
      setDeletingTask(null)
      setSelectedTask(null)
      await refetchTasks()
    } catch (error) {
      console.error('Failed to delete task:', error)
      toast('error', error instanceof Error ? error.message : 'Failed to delete task')
    }
  }

  const handleRestartTask = async () => {
    if (!currentProject || !restartingTask) return
    try {
      await macroTasksApi.update(currentProject.id, restartingTask.id, {
        status: 'pending',
      })
      setRestartingTask(null)
      setSelectedTask(null)
      await refetchTasks()
    } catch (error) {
      console.error('Failed to restart task:', error)
    }
  }

  const loadGithubStatus = async () => {
    setGhStatusLoading(true)
    try {
      setGhStatus(await githubApi.status())
    } catch (error) {
      setGhStatus({
        installed: false,
        authenticated: false,
        message: error instanceof Error ? error.message : 'Não foi possível verificar o GitHub CLI.',
      })
    } finally {
      setGhStatusLoading(false)
    }
  }

  const openImportModal = () => {
    setShowImportModal(true)
    setImportMode('json')
    setImportError(null)
    setImportResult(null)
    setImportPipelineId(prev => prev || pipelines[0]?.id || '')
    if (!ghStatus && !ghStatusLoading) void loadGithubStatus()
  }

  const closeImportModal = () => {
    if (importing) return
    setShowImportModal(false)
    setImportError(null)
    setImportResult(null)
    setJsonText('')
    setGhIssues([])
    setGhSelected([])
    setGhError(null)
  }

  // Parse local do JSON colado: erro estrutural bloqueia o envio, título ruim só avisa
  // (o backend é best-effort e reporta cada falha item a item).
  const parsedJson = useMemo<{ items: Record<string, any>[]; error: string | null; warning: string | null }>(() => {
    const text = jsonText.trim()
    if (!text) return { items: [], error: null, warning: null }
    let parsed: any
    try {
      parsed = JSON.parse(text)
    } catch (error) {
      return {
        items: [],
        error: `JSON inválido: ${error instanceof Error ? error.message : 'erro de parse'}`,
        warning: null,
      }
    }
    const arr = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.items) ? parsed.items : null
    if (!arr) {
      return { items: [], error: 'O JSON deve ser um array de objetos (ou um objeto com a chave "items").', warning: null }
    }
    if (arr.length === 0) return { items: [], error: 'O array está vazio.', warning: null }
    const badIndex = arr.findIndex(
      (it: any) => !it || typeof it !== 'object' || Array.isArray(it) || typeof it.title !== 'string' || !it.title.trim(),
    )
    return {
      items: arr,
      error: null,
      warning: badIndex >= 0 ? `Item ${badIndex + 1} não tem um "title" válido — ele será reportado como falha.` : null,
    }
  }, [jsonText])

  const importItems = useMemo<Record<string, any>[]>(() => {
    if (importMode === 'json') {
      return parsedJson.items.map(it => {
        // itens não-objeto seguem crus: o backend os reporta como "Item is not an object."
        if (!it || typeof it !== 'object' || Array.isArray(it)) return it
        const item: Record<string, any> = { ...it }
        if (typeof item.pipelineId !== 'string' || !item.pipelineId) item.pipelineId = importPipelineId
        return item
      })
    }
    const repo = ghRepo.trim()
    return ghIssues
      .filter(issue => ghSelected.includes(issue.number))
      .map(issue => ({
        title: issue.title,
        description: issue.body || undefined,
        pipelineId: importPipelineId,
        metadata: {
          source: 'github',
          repo,
          issueNumber: issue.number,
          url: issue.url,
          labels: issue.labels,
        },
      }))
  }, [importMode, parsedJson, ghIssues, ghSelected, importPipelineId, ghRepo])

  const githubUsable = !!ghStatus?.installed && !!ghStatus?.authenticated

  const handleFetchIssues = async () => {
    const repo = ghRepo.trim()
    if (!repo) return
    setGhLoading(true)
    setGhError(null)
    setGhIssues([])
    setGhSelected([])
    try {
      const issues = await githubApi.listIssues({ repo, state: ghState, limit: 100 })
      setGhIssues(issues)
      setGhSelected(issues.map(i => i.number))
      if (issues.length === 0) setGhError('Nenhuma issue encontrada para este repositório/estado.')
    } catch (error) {
      setGhError(error instanceof Error ? error.message : 'Falha ao buscar issues.')
    } finally {
      setGhLoading(false)
    }
  }

  const handleImport = async () => {
    if (!currentProject || importItems.length === 0) return
    setImporting(true)
    setImportError(null)
    setImportResult(null)
    const toastId = toast('loading', `Importando ${importItems.length} macro task${importItems.length > 1 ? 's' : ''}...`)
    try {
      const result = await macroTasksApi.createBatch(currentProject.id, importItems)
      setImportResult(result)
      if (result.summary.failed === 0) {
        update(toastId, 'success', `${result.summary.succeeded} macro task${result.summary.succeeded > 1 ? 's' : ''} criada${result.summary.succeeded > 1 ? 's' : ''}`)
      } else if (result.summary.succeeded === 0) {
        update(toastId, 'error', `Nenhuma macro task criada — ${result.summary.failed} falhou/falharam`)
      } else {
        update(toastId, 'success', `${result.summary.succeeded} criadas, ${result.summary.failed} falharam`)
      }
      await refetchTasks()
    } catch (error) {
      update(toastId, 'error', 'Erro ao importar macro tasks')
      console.error('Failed to import macro tasks:', error)
      setImportError(error instanceof Error ? error.message : 'Falha ao importar macro tasks.')
    } finally {
      setImporting(false)
    }
  }

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
          <SkeletonKanban />
        </div>
      </Shell>
    )
  }

  return (
    <Shell>
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      <header className="flex items-center justify-between px-4 lg:px-6 py-3 border-b border-border bg-card/50 sticky top-0 z-10">
        <div>
          <h1 className="text-sm font-semibold text-foreground">Macro Tasks</h1>
          <p className="text-[11px] text-muted-foreground font-mono mt-0.5">
            {/* Itens de backlog não entram no total: eles têm contagem própria na
                seção de baixo e o kanban não os mostra. */}
            {tasks.filter(t => t.status !== 'backlog').length} total ·{' '}
            {tasks.filter(t => t.status === 'running').length} running
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs border transition-colors',
              showFilters || hasActiveFilters
                ? 'border-primary/30 bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted/40'
            )}
          >
            <Filter className="w-3.5 h-3.5" />
            Filters
            {hasActiveFilters && (
              <span className="text-[9px] font-mono bg-primary/20 px-1 rounded">
                {[filterPriority, filterPipeline, filterAgent].filter(Boolean).length}
              </span>
            )}
          </button>
          <button
            onClick={openImportModal}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
          >
            <Upload className="w-3.5 h-3.5" />
            Import
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            New Task
          </button>
        </div>
      </header>

      {showFilters && (
        <div className="flex items-center gap-3 px-4 lg:px-6 py-2 border-b border-border bg-muted/10 flex-wrap">
          <select
            value={filterPriority ?? ''}
            onChange={(e) => setFilterPriority(e.target.value ? Number(e.target.value) : null)}
            className="bg-input border border-border rounded-md px-2 py-1 text-xs text-foreground outline-none focus:border-primary/50"
          >
            <option value="">Todas prioridades</option>
            <option value="0">P0 - Low</option>
            <option value="1">P1 - Medium</option>
            <option value="2">P2 - High</option>
          </select>
          <select
            value={filterPipeline ?? ''}
            onChange={(e) => setFilterPipeline(e.target.value || null)}
            className="bg-input border border-border rounded-md px-2 py-1 text-xs text-foreground outline-none focus:border-primary/50"
          >
            <option value="">Todos pipelines</option>
            {pipelines.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          {hasActiveFilters && (
            <button
              onClick={() => { setFilterPriority(null); setFilterPipeline(null); setFilterAgent(null) }}
              className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Limpar filtros
            </button>
          )}
        </div>
      )}

      {runSuccess && (
        <div className="flex items-center gap-2 mx-4 lg:mx-6 mt-3 px-3 py-2 rounded-md border border-status-running/30 bg-status-running/10">
          <Play className="w-3.5 h-3.5 text-status-running shrink-0" />
          <p className="text-[11px] text-foreground flex-1 min-w-0 truncate">
            Pipeline started for <span className="font-medium">{runSuccess}</span>.{' '}
            <Link href="/sessions" className="text-status-running hover:underline font-medium">
              View session
            </Link>
          </p>
          <button
            onClick={() => setRunSuccess(null)}
            className="p-1 rounded hover:bg-muted/40 text-muted-foreground hover:text-foreground shrink-0"
            aria-label="Dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {tasks.length === 0 ? (
        <div className="flex-1 min-h-0 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-center">
            <Inbox className="w-10 h-10 text-muted-foreground/50" />
            <div>
              <p className="text-sm font-medium text-foreground">Nenhuma macro task encontrada</p>
              <p className="text-xs text-muted-foreground mt-1">Crie sua primeira macro task para iniciar o pipeline</p>
            </div>
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs bg-primary text-primary-foreground hover:bg-primary/90 transition-colors mt-2"
            >
              <Plus className="w-3.5 h-3.5" />
              Crie sua primeira macro task
            </button>
          </div>
        </div>
      ) : (
      <div className="flex-1 min-h-0 overflow-x-auto">
        <div className="flex gap-3 p-4 lg:p-6 min-w-max">
          {statusColumns.map(col => {
            const columnTasks = filteredTasks.filter(t => t.status === col.key)
            const Icon = statusIcons[col.key]
            return (
              <div key={col.key} className="w-72 shrink-0 flex flex-col min-h-0">
                <div className="flex items-center gap-2 mb-3 px-1">
                  <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">{col.label}</span>
                  <span className="text-[10px] font-mono text-muted-foreground/50 ml-auto">({columnTasks.length})</span>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto space-y-2 rounded-lg bg-muted/5 p-2">
                  {columnTasks.map(task => (
                    <div
                      key={task.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedTask(task)}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedTask(task) } }}
                      className="w-full text-left rounded-lg border border-border bg-card p-3 hover:border-primary/30 transition-colors cursor-pointer"
                    >
                      <div className="flex items-start gap-2">
                        <p className="text-xs font-medium text-foreground leading-snug flex-1 min-w-0">{task.title}</p>
                        {task.status === 'running' && (
                          <span className="mt-0.5 shrink-0">
                            <RunningDot />
                          </span>
                        )}
                      </div>
                      {task.description && (
                        <p className="text-[10px] text-muted-foreground mt-1 line-clamp-2">{task.description}</p>
                      )}
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <span className={cn(
                          'text-[9px] font-mono px-1.5 py-0.5 rounded',
                          task.priority >= 2 ? 'bg-destructive/15 text-destructive' :
                            task.priority >= 1 ? 'bg-status-waiting/15 text-status-waiting' :
                              'bg-muted text-muted-foreground'
                        )}>
                          P{task.priority}
                        </span>
                        {task.sessions && task.sessions.length > 0 && (
                          <Link
                            href={`/sessions?task=${task.id}`}
                            className="text-[9px] font-mono text-primary flex items-center gap-0.5 hover:underline"
                            onClick={e => e.stopPropagation()}
                          >
                            <Terminal className="w-2.5 h-2.5" />
                            {task.sessions.length} session{task.sessions.length > 1 ? 's' : ''}
                          </Link>
                        )}
                        {task.sessions && task.sessions.length > 0 && (() => {
                          const latestSession = task.sessions[task.sessions.length - 1]
                          const sessionStatus = latestSession?.status
                          if (!sessionStatus) return null
                          const statusColors: Record<string, string> = {
                            running: 'bg-status-running/15 text-status-running',
                            waiting: 'bg-status-waiting/15 text-status-waiting',
                            failed: 'bg-destructive/15 text-destructive',
                            completed: 'bg-status-done/15 text-status-done',
                          }
                          return (
                            <Link
                              href={`/sessions?task=${task.id}`}
                              className={cn('text-[9px] font-mono px-1.5 py-0.5 rounded', statusColors[sessionStatus] || 'bg-muted text-muted-foreground')}
                              onClick={e => e.stopPropagation()}
                            >
                              {sessionStatus}
                            </Link>
                          )
                        })()}
                        {isRunnable(task) && (
                          <button
                            onClick={e => { e.stopPropagation(); openRunModal(task) }}
                            className="ml-auto flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 rounded bg-primary/15 text-primary hover:bg-primary/25 transition-colors"
                          >
                            <Play className="w-2.5 h-2.5" />
                            Run
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                  {columnTasks.length === 0 && (
                    <div className="flex items-center justify-center h-20 text-[10px] text-muted-foreground/50">
                      No tasks
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
      )}

      {currentProject && (
        <BacklogSection
          projectId={currentProject.id}
          pipelines={pipelines}
          onPromoted={refetchTasks}
        />
      )}

      {selectedTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setSelectedTask(null)}>
          <div className="w-full max-w-md rounded-lg border border-border bg-card shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-border">
              <h2 className="text-sm font-semibold text-foreground">{selectedTask.title}</h2>
              <p className="text-[11px] text-muted-foreground mt-1 overflow-auto max-h-52">{selectedTask.description}</p>
            </div>
            <div className="px-6 py-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground">Status</span>
                <span className="flex items-center gap-1.5">
                {selectedTask.status === 'running' && <RunningDot />}
                <span className={cn(
                  'text-[10px] font-mono px-1.5 py-0.5 rounded',
                  selectedTask.status === 'done' ? 'bg-status-done/15 text-status-done' :
                    selectedTask.status === 'running' ? 'bg-status-running/15 text-status-running' :
                      'bg-muted text-muted-foreground'
                )}>
                  {selectedTask.status.toUpperCase()}
                </span>
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground">Priority</span>
                <span className={cn('text-[10px] font-mono', priorityColors[selectedTask.priority as keyof typeof priorityColors])}>
                  P{selectedTask.priority}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground">Sessions</span>
                <span className="text-[10px] font-mono text-foreground">{selectedTask.sessions?.length || 0}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground">Created</span>
                <span className="text-[10px] font-mono text-foreground">{new Date(selectedTask.createdAt).toLocaleDateString()}</span>
              </div>
            </div>
            <div className="px-6 py-3 border-t border-border flex justify-between gap-2">
              <div className="flex gap-2">
                <button
                  onClick={() => openEditModal(selectedTask)}
                  className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-md border border-border hover:bg-muted/40 transition-colors"
                >
                  <Pencil className="w-3 h-3" />
                  Edit
                </button>
                <button
                  onClick={() => setDeletingTask(selectedTask)}
                  className="flex items-center gap-1.5 text-[11px] text-destructive hover:text-destructive px-3 py-1.5 rounded-md border border-destructive/30 hover:bg-destructive/10 transition-colors"
                >
                  <Trash2 className="w-3 h-3" />
                  Delete
                </button>
                {(selectedTask.status === 'done' || selectedTask.status === 'failed') && (
                  <button
                    onClick={() => setRestartingTask(selectedTask)}
                    className="flex items-center gap-1.5 text-[11px] text-status-running hover:text-status-running px-3 py-1.5 rounded-md border border-status-running/30 hover:bg-status-running/10 transition-colors"
                  >
                    <RotateCcw className="w-3 h-3" />
                    Restart
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setSelectedTask(null)}
                  className="text-[11px] text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-md transition-colors"
                >
                  Close
                </button>
                {isRunnable(selectedTask) && (
                  <button
                    onClick={() => {
                      const task = selectedTask
                      setSelectedTask(null)
                      openRunModal(task)
                    }}
                    className="flex items-center gap-1.5 text-[11px] bg-primary text-primary-foreground px-3 py-1.5 rounded-md hover:bg-primary/90 transition-colors"
                  >
                    <Play className="w-3 h-3" />
                    Run
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowCreateModal(false)}>
          <div className="w-full max-w-md rounded-lg border border-border bg-card shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h2 className="text-sm font-semibold text-foreground">Create Macro Task</h2>
              <button onClick={() => setShowCreateModal(false)} className="p-1 rounded hover:bg-muted/40">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div>
                <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-1 block">
                  Title *
                </label>
                <input
                  type="text"
                  value={newTask.title}
                  onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
                  className="w-full bg-input rounded-md px-3 py-2 text-xs text-foreground outline-none border border-border focus:border-primary/50 transition-colors"
                  placeholder="Implement feature X"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-1 block">
                  Description
                </label>
                <textarea
                  value={newTask.description}
                  onChange={(e) => setNewTask({ ...newTask, description: e.target.value })}
                  rows={3}
                  className="w-full bg-input rounded-md px-3 py-2 text-xs text-foreground outline-none border border-border focus:border-primary/50 transition-colors resize-none"
                  placeholder="Detailed description of the task..."
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-1 block">
                  Pipeline *
                </label>
                <select
                  value={newTask.pipelineId}
                  onChange={(e) => setNewTask({ ...newTask, pipelineId: e.target.value })}
                  className="w-full bg-input rounded-md px-3 py-2 text-xs text-foreground outline-none border border-border focus:border-primary/50 transition-colors"
                >
                  {pipelines.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-1 block">
                  Priority
                </label>
                <select
                  value={newTask.priority}
                  onChange={(e) => setNewTask({ ...newTask, priority: Number(e.target.value) })}
                  className="w-full bg-input rounded-md px-3 py-2 text-xs text-foreground outline-none border border-border focus:border-primary/50 transition-colors"
                >
                  <option value={0}>Low (P0)</option>
                  <option value={1}>Medium (P1)</option>
                  <option value={2}>High (P2)</option>
                </select>
              </div>
            </div>
            <div className="px-6 py-3 border-t border-border flex justify-end gap-2">
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-[11px] text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-md transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateTask}
                disabled={!newTask.title || !newTask.pipelineId}
                className="text-[11px] bg-primary text-primary-foreground px-3 py-1.5 rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Create Task
              </button>
            </div>
          </div>
        </div>
      )}

      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={closeImportModal}>
          <div className="w-full max-w-2xl rounded-lg border border-border bg-card shadow-xl flex flex-col max-h-[85vh]" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-foreground">Import Macro Tasks</h2>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Cole um array JSON ou importe issues de um repositório do GitHub.
                </p>
              </div>
              <button
                onClick={closeImportModal}
                disabled={importing}
                className="p-1 rounded hover:bg-muted/40 disabled:opacity-50 shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {importResult ? (
              <div className="px-6 py-4 space-y-3 overflow-y-auto">
                <div className="flex items-center gap-2">
                  {importResult.summary.failed === 0 ? (
                    <CheckCircle2 className="w-4 h-4 text-status-done shrink-0" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-status-waiting shrink-0" />
                  )}
                  <p className="text-xs text-foreground">
                    <span className="font-medium">{importResult.summary.succeeded}</span> criadas ·{' '}
                    <span className="font-medium">{importResult.summary.failed}</span> falharam
                    <span className="text-muted-foreground"> (de {importResult.summary.total})</span>
                  </p>
                </div>
                {importResult.failed.length > 0 && (
                  <div className="rounded-md border border-destructive/30 bg-destructive/5 divide-y divide-destructive/10">
                    {importResult.failed.map(f => (
                      <div key={f.index} className="px-3 py-2">
                        <p className="text-[11px] text-foreground truncate">
                          <span className="font-mono text-muted-foreground mr-1.5">#{f.index + 1}</span>
                          {f.title || <span className="text-muted-foreground italic">sem título</span>}
                        </p>
                        <p className="text-[10px] text-destructive mt-0.5">{f.reason}</p>
                      </div>
                    ))}
                  </div>
                )}
                {importResult.created.length > 0 && (
                  <div className="rounded-md border border-border bg-muted/10 max-h-40 overflow-y-auto divide-y divide-border">
                    {importResult.created.map(t => (
                      <div key={t.id} className="px-3 py-1.5 flex items-center gap-2">
                        <CheckCircle2 className="w-3 h-3 text-status-done shrink-0" />
                        <p className="text-[11px] text-foreground truncate">{t.title}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <>
                <div className="flex items-center gap-1 px-6 pt-3 border-b border-border shrink-0">
                  {([
                    { key: 'json' as const, label: 'Colar JSON', Icon: Upload },
                    { key: 'github' as const, label: 'GitHub Issues', Icon: CircleDot },
                  ]).map(({ key, label, Icon }) => (
                    <button
                      key={key}
                      onClick={() => setImportMode(key)}
                      className={cn(
                        'flex items-center gap-1.5 px-3 py-1.5 -mb-px text-xs border-b-2 transition-colors',
                        importMode === key
                          ? 'border-primary text-primary'
                          : 'border-transparent text-muted-foreground hover:text-foreground',
                      )}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {label}
                    </button>
                  ))}
                </div>

                <div className="px-6 py-4 space-y-4 overflow-y-auto">
                  <div>
                    <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-1 block">
                      Pipeline de destino *
                    </label>
                    {pipelines.length === 0 ? (
                      <p className="text-[11px] text-destructive">
                        Este projeto não tem pipelines. Crie um pipeline antes de importar tasks.
                      </p>
                    ) : (
                      <>
                        <select
                          value={importPipelineId}
                          onChange={(e) => setImportPipelineId(e.target.value)}
                          disabled={importing}
                          className="w-full bg-input rounded-md px-3 py-2 text-xs text-foreground outline-none border border-border focus:border-primary/50 transition-colors disabled:opacity-50"
                        >
                          {pipelines.map(p => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                        <p className="text-[10px] text-muted-foreground mt-1">
                          {importMode === 'json'
                            ? 'Aplicado aos itens que não trouxerem "pipelineId" próprio.'
                            : 'Aplicado a todas as issues importadas.'}
                        </p>
                      </>
                    )}
                  </div>

                  {importMode === 'json' ? (
                    <div>
                      <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-1 block">
                        JSON
                      </label>
                      <textarea
                        value={jsonText}
                        onChange={(e) => setJsonText(e.target.value)}
                        rows={10}
                        spellCheck={false}
                        disabled={importing}
                        className="w-full bg-input rounded-md px-3 py-2 text-[11px] font-mono text-foreground outline-none border border-border focus:border-primary/50 transition-colors resize-y disabled:opacity-50"
                        placeholder={'[\n  { "title": "Implement feature X", "description": "...", "priority": 1 },\n  { "title": "Fix bug Y" }\n]'}
                      />
                      {parsedJson.error && (
                        <div className="flex items-start gap-2 mt-2 px-3 py-2 rounded-md border border-destructive/30 bg-destructive/10">
                          <AlertCircle className="w-3.5 h-3.5 text-destructive shrink-0 mt-0.5" />
                          <p className="text-[11px] text-destructive">{parsedJson.error}</p>
                        </div>
                      )}
                      {!parsedJson.error && parsedJson.warning && (
                        <div className="flex items-start gap-2 mt-2 px-3 py-2 rounded-md border border-status-waiting/30 bg-status-waiting/10">
                          <AlertCircle className="w-3.5 h-3.5 text-status-waiting shrink-0 mt-0.5" />
                          <p className="text-[11px] text-status-waiting">{parsedJson.warning}</p>
                        </div>
                      )}
                      {!parsedJson.error && parsedJson.items.length > 0 && (
                        <p className="text-[10px] font-mono text-muted-foreground mt-2">
                          {parsedJson.items.length} item{parsedJson.items.length > 1 ? 's' : ''} detectado{parsedJson.items.length > 1 ? 's' : ''}
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {ghStatusLoading ? (
                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          Verificando o GitHub CLI...
                        </div>
                      ) : !githubUsable ? (
                        <div className="flex items-start gap-2 px-3 py-2 rounded-md border border-status-waiting/30 bg-status-waiting/10">
                          <AlertCircle className="w-3.5 h-3.5 text-status-waiting shrink-0 mt-0.5" />
                          <div className="min-w-0">
                            <p className="text-[11px] text-status-waiting">
                              {ghStatus?.message ||
                                'O GitHub CLI (gh) não está disponível. Instale o gh e rode "gh auth login" nesta máquina.'}
                            </p>
                            <button
                              onClick={() => void loadGithubStatus()}
                              className="text-[10px] text-muted-foreground hover:text-foreground underline mt-1"
                            >
                              Verificar de novo
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-[10px] font-mono text-muted-foreground">
                          gh autenticado{ghStatus?.account ? ` como ${ghStatus.account}` : ''}
                        </p>
                      )}

                      <div className="flex items-end gap-2">
                        <div className="flex-1 min-w-0">
                          <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-1 block">
                            Repositório *
                          </label>
                          <input
                            type="text"
                            value={ghRepo}
                            onChange={(e) => setGhRepo(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter' && githubUsable) { e.preventDefault(); void handleFetchIssues() } }}
                            disabled={!githubUsable || importing}
                            className="w-full bg-input rounded-md px-3 py-2 text-xs font-mono text-foreground outline-none border border-border focus:border-primary/50 transition-colors disabled:opacity-50"
                            placeholder="owner/name"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-1 block">
                            State
                          </label>
                          <select
                            value={ghState}
                            onChange={(e) => setGhState(e.target.value)}
                            disabled={!githubUsable || importing}
                            className="bg-input rounded-md px-2 py-2 text-xs text-foreground outline-none border border-border focus:border-primary/50 transition-colors disabled:opacity-50"
                          >
                            <option value="open">open</option>
                            <option value="closed">closed</option>
                            <option value="all">all</option>
                          </select>
                        </div>
                        <button
                          onClick={() => void handleFetchIssues()}
                          disabled={!githubUsable || !ghRepo.trim() || ghLoading || importing}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-md text-xs border border-border text-foreground hover:bg-muted/40 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          {ghLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                          Buscar
                        </button>
                      </div>

                      {ghError && (
                        <div className="flex items-start gap-2 px-3 py-2 rounded-md border border-destructive/30 bg-destructive/10">
                          <AlertCircle className="w-3.5 h-3.5 text-destructive shrink-0 mt-0.5" />
                          <p className="text-[11px] text-destructive">{ghError}</p>
                        </div>
                      )}

                      {ghIssues.length > 0 && (
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">
                              {ghIssues.length} issues · {ghSelected.length} selecionadas
                            </span>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => setGhSelected(ghIssues.map(i => i.number))}
                                className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                              >
                                Selecionar todas
                              </button>
                              <button
                                onClick={() => setGhSelected([])}
                                className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                              >
                                Nenhuma
                              </button>
                            </div>
                          </div>
                          <div className="rounded-md border border-border divide-y divide-border max-h-64 overflow-y-auto">
                            {ghIssues.map(issue => (
                              <label
                                key={issue.number}
                                className="flex items-start gap-2 px-3 py-2 hover:bg-muted/20 cursor-pointer"
                              >
                                <input
                                  type="checkbox"
                                  checked={ghSelected.includes(issue.number)}
                                  onChange={(e) => setGhSelected(prev =>
                                    e.target.checked
                                      ? [...prev, issue.number]
                                      : prev.filter(n => n !== issue.number),
                                  )}
                                  disabled={importing}
                                  className="mt-0.5 accent-primary"
                                />
                                <div className="min-w-0 flex-1">
                                  <p className="text-[11px] text-foreground truncate">
                                    <span className="font-mono text-muted-foreground mr-1.5">#{issue.number}</span>
                                    {issue.title}
                                  </p>
                                  {issue.labels.length > 0 && (
                                    <div className="flex items-center gap-1 mt-1 flex-wrap">
                                      {issue.labels.map(label => (
                                        <span key={label} className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                                          {label}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {importError && (
                    <div className="flex items-start gap-2 px-3 py-2 rounded-md border border-destructive/30 bg-destructive/10">
                      <AlertCircle className="w-3.5 h-3.5 text-destructive shrink-0 mt-0.5" />
                      <p className="text-[11px] text-destructive">{importError}</p>
                    </div>
                  )}
                </div>
              </>
            )}

            <div className="px-6 py-3 border-t border-border flex items-center justify-between gap-2 shrink-0">
              <span className="text-[10px] font-mono text-muted-foreground">
                {importResult ? '' : `${importItems.length} task${importItems.length === 1 ? '' : 's'} a importar`}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={closeImportModal}
                  disabled={importing}
                  className="text-[11px] text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-md transition-colors disabled:opacity-50"
                >
                  {importResult ? 'Fechar' : 'Cancel'}
                </button>
                {!importResult && (
                  <button
                    onClick={() => void handleImport()}
                    disabled={
                      importing ||
                      importItems.length === 0 ||
                      !importPipelineId ||
                      (importMode === 'json' && !!parsedJson.error)
                    }
                    className="flex items-center gap-1.5 text-[11px] bg-primary text-primary-foreground px-3 py-1.5 rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {importing ? (
                      <>
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Importando...
                      </>
                    ) : (
                      <>
                        <Upload className="w-3 h-3" />
                        Importar
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {runTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={closeRunModal}>
          <div className="w-full max-w-sm rounded-lg border border-border bg-card shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-foreground">Run Pipeline</h2>
                <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{runTask.title}</p>
              </div>
              <button
                onClick={closeRunModal}
                disabled={starting}
                className="p-1 rounded hover:bg-muted/40 disabled:opacity-50 shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div>
                <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-1 block">
                  Agent *
                </label>
                {agentsLoading ? (
                  <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Loading agents...
                  </div>
                ) : agents.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground px-3 py-2">
                    No agents available for this project.
                  </p>
                ) : (
                  <select
                    value={selectedAgentId}
                    onChange={(e) => setSelectedAgentId(e.target.value)}
                    disabled={starting}
                    className="w-full bg-input rounded-md px-3 py-2 text-xs text-foreground outline-none border border-border focus:border-primary/50 transition-colors disabled:opacity-50"
                  >
                    {agents.map(agent => (
                      <option key={agent.id} value={agent.id}>
                        {agent.name} ({agent.type})
                      </option>
                    ))}
                  </select>
                )}
              </div>
              {runError && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-md border border-destructive/30 bg-destructive/10">
                  <AlertCircle className="w-3.5 h-3.5 text-destructive shrink-0 mt-0.5" />
                  <p className="text-[11px] text-destructive">{runError}</p>
                </div>
              )}
            </div>
            <div className="px-6 py-3 border-t border-border flex justify-end gap-2">
              <button
                onClick={closeRunModal}
                disabled={starting}
                className="text-[11px] text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-md transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleStartPipeline}
                disabled={starting || agentsLoading || !selectedAgentId}
                className="flex items-center gap-1.5 text-[11px] bg-primary text-primary-foreground px-3 py-1.5 rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {starting ? (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Starting...
                  </>
                ) : (
                  <>
                    <Play className="w-3 h-3" />
                    Start Pipeline
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {precheckOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => !precheckLoading && setPrecheckOpen(false)}>
          <div className="w-full max-w-sm rounded-lg border border-border bg-card shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <div className="flex items-center gap-2">
                {precheckLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                ) : isPrecheckOk(precheckResult) ? (
                  <ShieldCheck className="w-4 h-4 text-status-done" />
                ) : (
                  <ShieldAlert className="w-4 h-4 text-destructive" />
                )}
                <h2 className="text-sm font-semibold text-foreground">Pre-check</h2>
              </div>
              <button
                onClick={() => setPrecheckOpen(false)}
                disabled={precheckLoading}
                className="p-1 rounded hover:bg-muted/40 disabled:opacity-50"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-6 py-4 space-y-2">
              {precheckLoading ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Checking system health...
                </div>
              ) : precheckResult ? (
                <>
                  {/* `tmux` saiu da lista junto com a dependência: o runtime não usa
                      mais multiplexador externo, e o backend deixou de publicar essa
                      chave — ela aparecia eternamente como falha. */}
                  {(['database', 'redis'] as const).map((key) => {
                    const check = precheckResult.checks[key]
                    const ok = check?.status === 'ok'
                    return (
                      <div key={key} className="flex items-center gap-2 text-xs">
                        {ok ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-status-done shrink-0" />
                        ) : (
                          <AlertCircle className="w-3.5 h-3.5 text-destructive shrink-0" />
                        )}
                        <span className={ok ? 'text-foreground' : 'text-destructive'}>
                          {key === 'database' ? 'Database' : 'Redis'}
                        </span>
                        {!ok && check?.message && (
                          <span className="text-[10px] text-muted-foreground ml-auto truncate max-w-[120px]">
                            {check.message}
                          </span>
                        )}
                      </div>
                    )
                  })}
                  {precheckResult.checks.cliProfiles && typeof precheckResult.checks.cliProfiles === 'object' && (
                    <div className="pt-1 border-t border-border mt-1">
                      <p className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-1">CLI Profiles</p>
                      {Object.entries(precheckResult.checks.cliProfiles as Record<string, any>).map(([name, check]) => {
                        const ok = check?.status === 'ok'
                        return (
                          <div key={name} className="flex items-center gap-2 text-xs py-0.5">
                            {ok ? (
                              <CheckCircle2 className="w-3 h-3 text-status-done shrink-0" />
                            ) : (
                              <AlertCircle className="w-3 h-3 text-destructive shrink-0" />
                            )}
                            <span className={ok ? 'text-foreground' : 'text-destructive'}>{name}</span>
                            {!ok && check?.message && (
                              <span className="text-[10px] text-muted-foreground ml-auto truncate max-w-[120px]">
                                {check.message}
                              </span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </>
              ) : null}
            </div>
            <div className="px-6 py-3 border-t border-border flex justify-end gap-2">
              <button
                onClick={() => setPrecheckOpen(false)}
                className="text-[11px] text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-md transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmStart}
                disabled={!isPrecheckOk(precheckResult) || precheckLoading}
                className="flex items-center gap-1.5 text-[11px] bg-primary text-primary-foreground px-3 py-1.5 rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Play className="w-3 h-3" />
                Start Pipeline
              </button>
            </div>
          </div>
        </div>
      )}

      {editingTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setEditingTask(null)}>
          <div className="w-full max-w-md rounded-lg border border-border bg-card shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h2 className="text-sm font-semibold text-foreground">Edit Macro Task</h2>
              <button onClick={() => setEditingTask(null)} className="p-1 rounded hover:bg-muted/40">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div>
                <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-1 block">
                  Title *
                </label>
                <input
                  type="text"
                  value={editData.title}
                  onChange={(e) => setEditData({ ...editData, title: e.target.value })}
                  className="w-full bg-input rounded-md px-3 py-2 text-xs text-foreground outline-none border border-border focus:border-primary/50 transition-colors"
                  placeholder="Implement feature X"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-1 block">
                  Description
                </label>
                <textarea
                  value={editData.description}
                  onChange={(e) => setEditData({ ...editData, description: e.target.value })}
                  rows={3}
                  className="w-full bg-input rounded-md px-3 py-2 text-xs text-foreground outline-none border border-border focus:border-primary/50 transition-colors resize-none"
                  placeholder="Detailed description of the task..."
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-1 block">
                  Pipeline *
                </label>
                <select
                  value={editData.pipelineId}
                  onChange={(e) => setEditData({ ...editData, pipelineId: e.target.value })}
                  className="w-full bg-input rounded-md px-3 py-2 text-xs text-foreground outline-none border border-border focus:border-primary/50 transition-colors"
                >
                  {pipelines.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-1 block">
                  Priority
                </label>
                <select
                  value={editData.priority}
                  onChange={(e) => setEditData({ ...editData, priority: Number(e.target.value) })}
                  className="w-full bg-input rounded-md px-3 py-2 text-xs text-foreground outline-none border border-border focus:border-primary/50 transition-colors"
                >
                  <option value={0}>Low (P0)</option>
                  <option value={1}>Medium (P1)</option>
                  <option value={2}>High (P2)</option>
                </select>
              </div>
            </div>
            <div className="px-6 py-3 border-t border-border flex justify-end gap-2">
              <button
                onClick={() => setEditingTask(null)}
                className="text-[11px] text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-md transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleUpdateTask}
                disabled={!editData.title || !editData.pipelineId}
                className="text-[11px] bg-primary text-primary-foreground px-3 py-1.5 rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {deletingTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setDeletingTask(null)}>
          <div className="w-full max-w-sm rounded-lg border border-border bg-card shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-border">
              <h2 className="text-sm font-semibold text-foreground">Delete Macro Task</h2>
              <p className="text-[11px] text-muted-foreground mt-1">
                Are you sure you want to delete "{deletingTask.title}"? This action cannot be undone.
              </p>
            </div>
            <div className="px-6 py-3 border-t border-border flex justify-end gap-2">
              <button
                onClick={() => setDeletingTask(null)}
                className="text-[11px] text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-md transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteTask}
                className="text-[11px] bg-destructive text-destructive-foreground px-3 py-1.5 rounded-md hover:bg-destructive/90 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {restartingTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setRestartingTask(null)}>
          <div className="w-full max-w-sm rounded-lg border border-border bg-card shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-border">
              <h2 className="text-sm font-semibold text-foreground">Restart Macro Task</h2>
              <p className="text-[11px] text-muted-foreground mt-1">
                Reset "{restartingTask.title}" to pending status? This will allow running the pipeline again.
              </p>
            </div>
            <div className="px-6 py-3 border-t border-border flex justify-end gap-2">
              <button
                onClick={() => setRestartingTask(null)}
                className="text-[11px] text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-md transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleRestartTask}
                className="flex items-center gap-1.5 text-[11px] bg-status-running text-white px-3 py-1.5 rounded-md hover:bg-status-running/90 transition-colors"
              >
                <RotateCcw className="w-3 h-3" />
                Restart
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </Shell>
  )
}
