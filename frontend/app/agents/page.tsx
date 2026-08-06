'use client'

import {
  agentsApi,
  cliFilesApi,
  cliLibraryApi,
  cliProfilesApi,
  masterAgentApi,
  type Agent,
  type CliFileKind,
  type CliFileProjectListing,
  type CliFileTarget,
  type CliLibraryListing,
  type CliMdFile,
  type CliProfile,
  type MasterScheduling,
} from '@/lib/api'
import Link from 'next/link'
import { useProject } from '@/lib/project-context'
import { cn } from '@/lib/utils'
import { Shell } from '@/components/shell'
import {
  AlertTriangle,
  Bot,
  ChevronDown,
  ChevronRight,
  Clock,
  Download,
  Eye,
  FileText,
  FolderOpen,
  Inbox,
  Library,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useToast } from '@/components/toast-provider'
import { Skeleton } from '@/components/ui/skeleton'
import { ConfirmModal } from '@/components/confirm-modal'

const FILE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/

const NEW_FILE_TEMPLATE = `---
name: meu-agente
description: O que este agente faz
---

Instruções do agente aqui.
`

type FileScope = 'project' | 'library'

const TARGETS: Array<{ value: CliFileTarget; label: string }> = [
  { value: 'claude', label: 'Claude Code' },
  { value: 'opencode', label: 'OpenCode' },
]

function fallbackDir(target: CliFileTarget, kind: CliFileKind): string {
  return target === 'claude'
    ? `.claude/${kind}`
    : `.opencode/${kind === 'agents' ? 'agent' : 'command'}`
}

type FileEditorState = {
  scope: FileScope
  fileName: string
  content: string
  truncated: boolean
}

type ExecutorForm = {
  name: string
  model: string
  cliProfileId: string
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} KB`
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
  } catch {
    return iso
  }
}

/**
 * Resumo curto pro link de /master-agent — o usuário veio até aqui procurando
 * as automações. MT-20 (item 3): `nextTick` vem do job em banco, então aparece
 * certo mesmo com o Master deste projeto desligado (antes só mostrava fora do
 * projeto ativo do Master, e vazio virava "não há automação" aos olhos do
 * usuário). Quando o Master está desligado, o tick ainda dispara — só a parte
 * de triagem/health-check/report (que dependem do terminal) fica pra trás.
 */
function automationSummary(scheduling: MasterScheduling | null): string {
  if (!scheduling) return 'Automações do Master'
  const enabledCount = [
    scheduling.autoTriageEnabled,
    scheduling.sessionCheckEnabled,
    scheduling.statusReportEnabled,
  ].filter(Boolean).length
  const label = enabledCount === 1 ? 'automação ativa' : 'automações ativas'
  if (enabledCount === 0) return 'Nenhuma automação ativa'

  const masterNote = scheduling.masterActive === false ? ' · Master desligado' : ''
  if (!scheduling.nextTick) return `${enabledCount} ${label}${masterNote}`

  // MT-28: um tick só, então o "próxima em" é o do tick — não o menor de três.
  const minutes = Math.max(0, Math.round((new Date(scheduling.nextTick).getTime() - Date.now()) / 60_000))
  return `${enabledCount} ${label} · próxima em ${minutes} min${masterNote}`
}

function SectionSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="rounded-lg border border-border bg-card p-4 space-y-2">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-2.5 w-48" />
          <Skeleton className="h-2.5 w-24" />
        </div>
      ))}
    </div>
  )
}

function SectionError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3">
      <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
      <p className="flex-1 text-xs text-destructive">{message}</p>
      <button
        onClick={onRetry}
        className="text-[11px] text-destructive underline hover:no-underline shrink-0"
      >
        Tentar novamente
      </button>
    </div>
  )
}

function NoProjectNotice({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-3">
      <FolderOpen className="w-4 h-4 text-muted-foreground shrink-0" />
      <p className="text-xs text-muted-foreground">{message}</p>
    </div>
  )
}

function FileCard({
  file,
  badges,
  onOpen,
  actions,
}: {
  file: CliMdFile
  badges?: ReactNode
  onOpen: () => void
  actions: ReactNode
}) {
  return (
    <div
      onClick={onOpen}
      className="rounded-lg border border-border bg-card p-4 hover:border-primary/30 transition-colors cursor-pointer flex flex-col"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <p className="text-xs font-semibold text-foreground font-mono truncate">{file.fileName}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {file.truncated && (
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-status-running/15 text-status-running uppercase">
              truncated
            </span>
          )}
          {badges}
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground mt-1.5 line-clamp-2 flex-1">
        {file.description || '—'}
      </p>
      <div className="flex items-center justify-between mt-3 pt-2 border-t border-border/50">
        <span className="text-[10px] font-mono text-muted-foreground">
          {formatSize(file.size)} · {formatDate(file.updatedAt)}
        </span>
        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
          {actions}
        </div>
      </div>
    </div>
  )
}

export default function AgentsPage() {
  const { currentProject } = useProject()
  const { toast, update } = useToast()

  const [kind, setKind] = useState<CliFileKind>('agents')
  const [target, setTarget] = useState<CliFileTarget>('claude')

  // Resumo de automação do Master (ponte de navegação — MT-2, item #6: o
  // usuário procurou as automações aqui e não achou nem elas nem o /scheduler).
  const [scheduling, setScheduling] = useState<MasterScheduling | null>(null)
  useEffect(() => {
    let cancelled = false
    masterAgentApi
      .getScheduling(currentProject?.id)
      .then((data) => {
        if (!cancelled) setScheduling(data)
      })
      .catch((error) => {
        console.error('Failed to load scheduling summary:', error)
        if (!cancelled) setScheduling(null)
      })
    return () => {
      cancelled = true
    }
  }, [currentProject?.id])
  // false até o usuário escolher manualmente um target — enquanto isso o
  // default vem do primeiro target com exists=true na resposta do list.
  const targetTouchedRef = useRef(false)

  // Seção 1 — arquivos do projeto
  const [projectListing, setProjectListing] = useState<CliFileProjectListing | null>(null)
  const [projectLoading, setProjectLoading] = useState(true)
  const [projectError, setProjectError] = useState<string | null>(null)

  // Seção 2 — biblioteca global
  const [libraryListing, setLibraryListing] = useState<CliLibraryListing | null>(null)
  const [libraryLoading, setLibraryLoading] = useState(true)
  const [libraryError, setLibraryError] = useState<string | null>(null)

  // Seção 3 — executores de sessão
  const [executorsOpen, setExecutorsOpen] = useState(false)
  const [executors, setExecutors] = useState<Agent[]>([])
  const [cliProfiles, setCliProfiles] = useState<CliProfile[]>([])
  const [executorsLoading, setExecutorsLoading] = useState(true)
  const [executorsError, setExecutorsError] = useState<string | null>(null)

  // Modais — arquivos
  const [fileEditor, setFileEditor] = useState<FileEditorState | null>(null)
  const [savingFile, setSavingFile] = useState(false)
  const [savingToLibrary, setSavingToLibrary] = useState(false)
  const [deletingFile, setDeletingFile] = useState<{ scope: FileScope; fileName: string } | null>(null)
  const [deletingFileBusy, setDeletingFileBusy] = useState(false)
  const [injectTarget, setInjectTarget] = useState<CliMdFile | null>(null)
  const [injectingFile, setInjectingFile] = useState<string | null>(null)

  // Modal — criar novo arquivo
  const [showNewModal, setShowNewModal] = useState(false)
  const [newForm, setNewForm] = useState({ fileName: '', content: NEW_FILE_TEMPLATE, alsoLibrary: false })
  const [newError, setNewError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  // Modais — executores
  const [showExecModal, setShowExecModal] = useState(false)
  const [editingExecutor, setEditingExecutor] = useState<Agent | null>(null)
  const [execForm, setExecForm] = useState<ExecutorForm>({ name: '', model: 'sonnet', cliProfileId: '' })
  const [execError, setExecError] = useState<string | null>(null)
  const [execSaving, setExecSaving] = useState(false)
  const [deletingExecutor, setDeletingExecutor] = useState<Agent | null>(null)

  const kindLabel = kind === 'agents' ? 'agentes' : 'commands'
  const kindSingular = kind === 'agents' ? 'agente' : 'command'
  const targetLabel = TARGETS.find(t => t.value === target)?.label ?? target
  const targetListing = projectListing?.targets.find(t => t.target === target) ?? null
  const projectDir = targetListing?.dir || fallbackDir(target, kind)
  const projectFileNames = new Set((targetListing?.files ?? []).map(f => f.fileName))

  const loadProjectFiles = useCallback(async () => {
    if (!currentProject) {
      setProjectListing(null)
      setProjectLoading(false)
      setProjectError(null)
      return
    }
    setProjectLoading(true)
    setProjectError(null)
    try {
      const listing = await cliFilesApi.list(currentProject.id, kind)
      setProjectListing(listing)
      if (!targetTouchedRef.current) {
        const firstExisting = listing.targets.find(t => t.exists)
        setTarget(firstExisting?.target ?? 'claude')
      }
    } catch (err) {
      console.error('Failed to load project cli files:', err)
      setProjectError(`Erro ao carregar os ${kindLabel} do projeto`)
    } finally {
      setProjectLoading(false)
    }
  }, [currentProject, kind, kindLabel])

  const loadLibrary = useCallback(async () => {
    setLibraryLoading(true)
    setLibraryError(null)
    try {
      setLibraryListing(await cliLibraryApi.list(kind))
    } catch (err) {
      console.error('Failed to load cli library:', err)
      setLibraryError('Erro ao carregar a biblioteca')
    } finally {
      setLibraryLoading(false)
    }
  }, [kind])

  const loadExecutors = useCallback(async () => {
    if (!currentProject) {
      setExecutors([])
      setExecutorsLoading(false)
      setExecutorsError(null)
      return
    }
    setExecutorsLoading(true)
    setExecutorsError(null)
    try {
      const [agentsData, profilesData] = await Promise.all([
        agentsApi.list(currentProject.id),
        cliProfilesApi.list(),
      ])
      setExecutors(agentsData)
      setCliProfiles(profilesData)
    } catch (err) {
      console.error('Failed to load executors:', err)
      setExecutorsError('Erro ao carregar os executores de sessão')
    } finally {
      setExecutorsLoading(false)
    }
  }, [currentProject])

  useEffect(() => {
    // ao trocar de projeto, volta a derivar o target default da resposta do list
    targetTouchedRef.current = false
  }, [currentProject])

  useEffect(() => {
    loadProjectFiles()
  }, [loadProjectFiles])

  useEffect(() => {
    loadLibrary()
  }, [loadLibrary])

  useEffect(() => {
    loadExecutors()
  }, [loadExecutors])

  const refreshAll = () => {
    loadProjectFiles()
    loadLibrary()
    loadExecutors()
  }

  // ── Ações de arquivo ────────────────────────────────────────────────────

  const openFileEditor = (scope: FileScope, file: CliMdFile) => {
    setFileEditor({ scope, fileName: file.fileName, content: file.content, truncated: file.truncated })
  }

  const handleSaveFile = async () => {
    if (!fileEditor) return
    setSavingFile(true)
    const toastId = toast('loading', `Salvando ${fileEditor.fileName}...`)
    try {
      if (fileEditor.scope === 'project') {
        if (!currentProject) throw new Error('no project')
        await cliFilesApi.write(currentProject.id, kind, target, fileEditor.fileName, fileEditor.content)
        await loadProjectFiles()
      } else {
        await cliLibraryApi.save(kind, fileEditor.fileName, fileEditor.content)
        await loadLibrary()
      }
      update(toastId, 'success', `${fileEditor.fileName} salvo`)
      setFileEditor(null)
    } catch (err) {
      console.error('Failed to save file:', err)
      update(toastId, 'error', `Erro ao salvar ${fileEditor.fileName}`)
    } finally {
      setSavingFile(false)
    }
  }

  const handleSaveToLibrary = async () => {
    if (!fileEditor) return
    setSavingToLibrary(true)
    const toastId = toast('loading', 'Salvando na biblioteca...')
    try {
      await cliLibraryApi.save(kind, fileEditor.fileName, fileEditor.content)
      update(toastId, 'success', `${fileEditor.fileName} salvo na biblioteca`)
      await loadLibrary()
    } catch (err) {
      console.error('Failed to save to library:', err)
      update(toastId, 'error', 'Erro ao salvar na biblioteca')
    } finally {
      setSavingToLibrary(false)
    }
  }

  const handleDeleteFile = async () => {
    if (!deletingFile) return
    setDeletingFileBusy(true)
    const toastId = toast('loading', `Deletando ${deletingFile.fileName}...`)
    try {
      if (deletingFile.scope === 'project') {
        if (!currentProject) throw new Error('no project')
        await cliFilesApi.delete(currentProject.id, kind, target, deletingFile.fileName)
        await loadProjectFiles()
      } else {
        await cliLibraryApi.delete(kind, deletingFile.fileName)
        await loadLibrary()
      }
      update(toastId, 'success', `${deletingFile.fileName} deletado`)
      setDeletingFile(null)
    } catch (err) {
      console.error('Failed to delete file:', err)
      update(toastId, 'error', `Erro ao deletar ${deletingFile.fileName}`)
    } finally {
      setDeletingFileBusy(false)
    }
  }

  const doInject = async (file: CliMdFile) => {
    if (!currentProject) return
    setInjectingFile(file.fileName)
    const toastId = toast('loading', `Injetando ${file.fileName} no projeto (${targetLabel})...`)
    try {
      await cliFilesApi.write(currentProject.id, kind, target, file.fileName, file.content)
      update(toastId, 'success', `${file.fileName} injetado em ${projectDir}`)
      await loadProjectFiles()
    } catch (err) {
      console.error('Failed to inject file:', err)
      update(toastId, 'error', `Erro ao injetar ${file.fileName}`)
    } finally {
      setInjectingFile(null)
    }
  }

  const handleInject = (file: CliMdFile) => {
    if (!currentProject) return
    if (projectFileNames.has(file.fileName)) {
      setInjectTarget(file)
    } else {
      doInject(file)
    }
  }

  // ── Criar novo arquivo ──────────────────────────────────────────────────

  const openNewModal = () => {
    setNewForm({ fileName: '', content: NEW_FILE_TEMPLATE, alsoLibrary: false })
    setNewError(null)
    setShowNewModal(true)
  }

  const handleCreateFile = async () => {
    if (!currentProject) return
    let fileName = newForm.fileName.trim()
    if (!fileName) {
      setNewError('Informe o nome do arquivo')
      return
    }
    if (!fileName.endsWith('.md')) fileName = `${fileName}.md`
    if (!FILE_NAME_RE.test(fileName)) {
      setNewError('Nome inválido — use letras, números, ".", "_" ou "-" (começando com letra/número) e extensão .md')
      return
    }
    setNewError(null)
    setCreating(true)
    const toastId = toast('loading', `Criando ${fileName}...`)
    try {
      await cliFilesApi.write(currentProject.id, kind, target, fileName, newForm.content)
      if (newForm.alsoLibrary) {
        await cliLibraryApi.save(kind, fileName, newForm.content)
      }
      update(toastId, 'success', `${fileName} criado${newForm.alsoLibrary ? ' (projeto + biblioteca)' : ''}`)
      setShowNewModal(false)
      await Promise.all([loadProjectFiles(), newForm.alsoLibrary ? loadLibrary() : Promise.resolve()])
    } catch (err) {
      console.error('Failed to create file:', err)
      update(toastId, 'error', `Erro ao criar ${fileName}`)
      setNewError(err instanceof Error ? err.message : 'Erro ao criar o arquivo')
    } finally {
      setCreating(false)
    }
  }

  // ── Executores ──────────────────────────────────────────────────────────

  const openCreateExecutor = () => {
    setEditingExecutor(null)
    setExecForm({ name: '', model: 'sonnet', cliProfileId: '' })
    setExecError(null)
    setShowExecModal(true)
  }

  const openEditExecutor = (agent: Agent) => {
    setEditingExecutor(agent)
    setExecForm({ name: agent.name, model: agent.model, cliProfileId: agent.cliProfileId || '' })
    setExecError(null)
    setShowExecModal(true)
  }

  const handleSaveExecutor = async () => {
    if (!currentProject) return
    if (!execForm.name.trim()) {
      setExecError('Informe o nome do executor')
      return
    }
    if (!execForm.cliProfileId) {
      setExecError('CLI profile é obrigatório — sem ele o start de pipeline falha')
      return
    }
    setExecError(null)
    setExecSaving(true)
    const toastId = toast('loading', editingExecutor ? 'Atualizando executor...' : 'Criando executor...')
    try {
      const payload = {
        name: execForm.name.trim(),
        model: execForm.model.trim() || 'sonnet',
        cliProfileId: execForm.cliProfileId,
      }
      if (editingExecutor) {
        await agentsApi.update(currentProject.id, editingExecutor.id, payload)
        update(toastId, 'success', 'Executor atualizado')
      } else {
        await agentsApi.create(currentProject.id, { ...payload, type: 'claude' })
        update(toastId, 'success', 'Executor criado')
      }
      setShowExecModal(false)
      await loadExecutors()
    } catch (err) {
      console.error('Failed to save executor:', err)
      update(toastId, 'error', 'Erro ao salvar executor')
      setExecError(err instanceof Error ? err.message : 'Erro ao salvar')
    } finally {
      setExecSaving(false)
    }
  }

  const handleDeleteExecutor = async () => {
    if (!currentProject || !deletingExecutor) return
    const toastId = toast('loading', 'Deletando executor...')
    try {
      await agentsApi.delete(currentProject.id, deletingExecutor.id)
      update(toastId, 'success', 'Executor deletado')
      setDeletingExecutor(null)
      await loadExecutors()
    } catch (err) {
      console.error('Failed to delete executor:', err)
      update(toastId, 'error', 'Erro ao deletar executor')
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <Shell>
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
        <header className="flex items-center justify-between gap-3 px-4 lg:px-6 py-3 border-b border-border bg-card/50 sticky top-0 z-10">
          <div className="min-w-0">
            <h1 className="text-sm font-semibold text-foreground">Agents</h1>
            <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
              Agentes e commands dos CLIs de IA do projeto (Claude Code, OpenCode, ...), com injeção a partir de uma biblioteca reutilizável entre projetos.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link
              href="/master-agent"
              title="Automações do Master (sweep, health-check, status report) e /scheduler"
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] border border-border text-muted-foreground hover:text-primary hover:border-primary/40 hover:bg-primary/5 transition-colors"
            >
              <Clock className="w-3.5 h-3.5" />
              {automationSummary(scheduling)}
            </Link>
            <div className="flex items-center rounded-md border border-border p-0.5">
              {(['agents', 'commands'] as const).map(k => (
                <button
                  key={k}
                  onClick={() => setKind(k)}
                  className={cn(
                    'text-[11px] px-2.5 py-1 rounded transition-colors',
                    kind === k
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
                  )}
                >
                  {k === 'agents' ? 'Agents' : 'Commands'}
                </button>
              ))}
            </div>
            <div className="flex items-center rounded-md border border-border p-0.5">
              {TARGETS.map(t => (
                <button
                  key={t.value}
                  onClick={() => {
                    targetTouchedRef.current = true
                    setTarget(t.value)
                  }}
                  className={cn(
                    'text-[11px] px-2.5 py-1 rounded transition-colors',
                    target === t.value
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <button
              onClick={refreshAll}
              title="Atualizar"
              className="p-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
            >
              <RefreshCw className={cn('w-3.5 h-3.5', (projectLoading || libraryLoading) && 'animate-spin')} />
            </button>
            <button
              onClick={openNewModal}
              disabled={!currentProject}
              title={!currentProject ? 'Selecione um projeto' : undefined}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Plus className="w-3.5 h-3.5" />
              New
            </button>
          </div>
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto p-4 lg:p-6 space-y-8">
          {/* ── Seção 1 — No projeto ─────────────────────────────────── */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <FolderOpen className="w-4 h-4 text-primary" />
                No projeto
              </h2>
              {currentProject && !projectLoading && !projectError && (
                <span className="text-[10px] font-mono text-muted-foreground">
                  {projectDir} · {targetListing?.files.length ?? 0} {kindLabel}
                </span>
              )}
            </div>

            {!currentProject ? (
              <NoProjectNotice message={`Selecione um projeto para gerenciar os ${kindLabel} do repo.`} />
            ) : projectLoading ? (
              <SectionSkeleton />
            ) : projectError ? (
              <SectionError message={projectError} onRetry={loadProjectFiles} />
            ) : (targetListing?.files.length ?? 0) === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 gap-3 rounded-lg border border-dashed border-border">
                <Inbox className="w-8 h-8 text-muted-foreground/50" />
                <div className="text-center">
                  <p className="text-xs font-medium text-foreground">
                    O projeto ainda não tem {kindLabel} de {targetLabel} em {projectDir}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Crie um novo ou injete um {kindSingular} da biblioteca abaixo.
                  </p>
                </div>
                <button
                  onClick={openNewModal}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Criar {kindSingular}
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {targetListing?.files.map(file => (
                  <FileCard
                    key={file.fileName}
                    file={file}
                    onOpen={() => openFileEditor('project', file)}
                    actions={
                      <>
                        <button
                          onClick={() => openFileEditor('project', file)}
                          title="Ver / editar conteúdo"
                          className="p-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                        >
                          <Eye className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => setDeletingFile({ scope: 'project', fileName: file.fileName })}
                          title="Deletar do projeto"
                          className="p-1.5 rounded-md border border-destructive/30 text-destructive hover:bg-destructive/10 transition-colors"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </>
                    }
                  />
                ))}
              </div>
            )}
          </section>

          {/* ── Seção 2 — Biblioteca ─────────────────────────────────── */}
          <section>
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Library className="w-4 h-4 text-primary" />
                Biblioteca (sugestões reutilizáveis)
              </h2>
              {!libraryLoading && !libraryError && (
                <span className="text-[10px] font-mono text-muted-foreground">
                  {libraryListing?.files.length ?? 0} {kindLabel}
                </span>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground mb-3">
              A biblioteca vive em <span className="font-mono">~/.orchestr/defaults</span> e vale para todos os projetos.
            </p>

            {libraryLoading ? (
              <SectionSkeleton />
            ) : libraryError ? (
              <SectionError message={libraryError} onRetry={loadLibrary} />
            ) : (libraryListing?.files.length ?? 0) === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 gap-2 rounded-lg border border-dashed border-border">
                <Inbox className="w-7 h-7 text-muted-foreground/50" />
                <p className="text-xs text-muted-foreground">
                  A biblioteca ainda não tem {kindLabel}. Salve um {kindSingular} do projeto na biblioteca para reutilizá-lo.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {libraryListing?.files.map(file => {
                  const inProject = projectFileNames.has(file.fileName)
                  return (
                    <FileCard
                      key={file.fileName}
                      file={file}
                      badges={
                        inProject ? (
                          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-primary/15 text-primary uppercase">
                            já no projeto
                          </span>
                        ) : undefined
                      }
                      onOpen={() => openFileEditor('library', file)}
                      actions={
                        <>
                          <button
                            onClick={() => handleInject(file)}
                            disabled={!currentProject || injectingFile === file.fileName}
                            title={
                              !currentProject
                                ? 'Selecione um projeto para injetar'
                                : `Injetar em ${projectDir} (${targetLabel})`
                            }
                            className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {injectingFile === file.fileName ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Download className="w-3 h-3" />
                            )}
                            Injetar
                          </button>
                          <button
                            onClick={() => openFileEditor('library', file)}
                            title="Ver / editar conteúdo"
                            className="p-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                          >
                            <Eye className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => setDeletingFile({ scope: 'library', fileName: file.fileName })}
                            title="Deletar da biblioteca"
                            className="p-1.5 rounded-md border border-destructive/30 text-destructive hover:bg-destructive/10 transition-colors"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </>
                      }
                    />
                  )
                })}
              </div>
            )}
          </section>

          {/* ── Seção 3 — Executores de sessão ───────────────────────── */}
          <section>
            <button
              onClick={() => setExecutorsOpen(o => !o)}
              className="w-full flex items-center justify-between mb-1 group"
            >
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                {executorsOpen ? (
                  <ChevronDown className="w-4 h-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                )}
                <Bot className="w-4 h-4 text-muted-foreground" />
                Executores de sessão (CLI)
              </h2>
              <span className="text-[10px] font-mono text-muted-foreground group-hover:text-foreground transition-colors">
                {currentProject ? `${executors.length} registrados` : '—'}
              </span>
            </button>
            <p className="text-[11px] text-muted-foreground mb-3">
              Executores são os runners que rodam sessões de pipeline (binário definido pelo CLI profile).
              Não confundir com os {kindLabel} .md acima.
            </p>

            {executorsOpen && (
              <>
                {!currentProject ? (
                  <NoProjectNotice message="Selecione um projeto para gerenciar os executores de sessão." />
                ) : executorsLoading ? (
                  <div className="space-y-2">
                    {Array.from({ length: 2 }).map((_, i) => (
                      <div key={i} className="rounded-lg border border-border bg-card px-4 py-2.5">
                        <Skeleton className="h-3 w-64" />
                      </div>
                    ))}
                  </div>
                ) : executorsError ? (
                  <SectionError message={executorsError} onRetry={loadExecutors} />
                ) : (
                  <div className="rounded-lg border border-border bg-card divide-y divide-border/50">
                    {executors.length === 0 && (
                      <div className="flex items-center justify-between px-4 py-3">
                        <p className="text-xs text-muted-foreground">Nenhum executor registrado neste projeto.</p>
                      </div>
                    )}
                    {executors.map(agent => {
                      const profile = cliProfiles.find(p => p.id === agent.cliProfileId)
                      return (
                        <div key={agent.id} className="flex items-center gap-3 px-4 py-2.5">
                          <div
                            className={cn(
                              'w-2 h-2 rounded-full shrink-0',
                              agent.status === 'idle'
                                ? 'bg-status-idle'
                                : agent.status === 'running'
                                  ? 'bg-status-running animate-pulse'
                                  : 'bg-muted-foreground/40'
                            )}
                            title={agent.status}
                          />
                          <span className="text-xs font-semibold text-foreground truncate">{agent.name}</span>
                          <span className="text-[10px] font-mono text-muted-foreground shrink-0">{agent.model}</span>
                          <span
                            className={cn(
                              'text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0',
                              profile ? 'bg-muted text-muted-foreground' : 'bg-destructive/10 text-destructive'
                            )}
                          >
                            {profile ? profile.name : 'sem CLI profile'}
                          </span>
                          <span className="text-[10px] font-mono text-muted-foreground ml-auto shrink-0">
                            {agent.sessions?.length ?? 0} sessions
                          </span>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={() => openEditExecutor(agent)}
                              title="Editar"
                              className="p-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                            >
                              <Pencil className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => setDeletingExecutor(agent)}
                              title="Deletar"
                              className="p-1.5 rounded-md border border-destructive/30 text-destructive hover:bg-destructive/10 transition-colors"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      )
                    })}
                    <div className="px-4 py-2.5">
                      <button
                        onClick={openCreateExecutor}
                        className="flex items-center gap-1.5 text-[11px] text-primary hover:underline"
                      >
                        <Plus className="w-3 h-3" />
                        Novo executor
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
        </div>

        {/* ── Modal — ver/editar arquivo ─────────────────────────────── */}
        {fileEditor && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
            onClick={() => !savingFile && !savingToLibrary && setFileEditor(null)}
          >
            <div
              className="w-full max-w-2xl rounded-lg border border-border bg-card shadow-xl max-h-[90vh] flex flex-col"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                <div className="flex items-center gap-2 min-w-0">
                  <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                  <h2 className="text-sm font-semibold text-foreground font-mono truncate">{fileEditor.fileName}</h2>
                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground uppercase shrink-0">
                    {fileEditor.scope === 'project' ? projectDir : 'biblioteca'}
                  </span>
                  {fileEditor.truncated && (
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-status-running/15 text-status-running uppercase shrink-0">
                      truncated
                    </span>
                  )}
                </div>
                <button
                  onClick={() => !savingFile && !savingToLibrary && setFileEditor(null)}
                  className="p-1 rounded hover:bg-muted/40"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="px-6 py-4 flex-1 min-h-0 flex flex-col">
                {fileEditor.truncated && (
                  <p className="text-[11px] text-status-running mb-2">
                    Conteúdo truncado pelo backend — salvar sobrescreveria o arquivo com a versão incompleta, por isso a edição está desabilitada.
                  </p>
                )}
                <textarea
                  value={fileEditor.content}
                  onChange={e => setFileEditor({ ...fileEditor, content: e.target.value })}
                  readOnly={fileEditor.truncated}
                  spellCheck={false}
                  rows={18}
                  className="w-full flex-1 min-h-[320px] bg-input rounded-md px-3 py-2 text-xs text-foreground outline-none border border-border focus:border-primary/50 transition-colors font-mono resize-none"
                />
              </div>
              <div className="px-6 py-3 border-t border-border flex justify-end gap-2">
                <button
                  onClick={() => setFileEditor(null)}
                  disabled={savingFile || savingToLibrary}
                  className="text-[11px] text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-md transition-colors"
                >
                  Fechar
                </button>
                {fileEditor.scope === 'project' && (
                  <button
                    onClick={handleSaveToLibrary}
                    disabled={savingFile || savingToLibrary || fileEditor.truncated}
                    title="Salva o conteúdo atual em ~/.orchestr/defaults para reutilizar em outros projetos"
                    className="flex items-center gap-1.5 text-[11px] border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 px-3 py-1.5 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {savingToLibrary ? <Loader2 className="w-3 h-3 animate-spin" /> : <Library className="w-3 h-3" />}
                    Salvar na biblioteca
                  </button>
                )}
                <button
                  onClick={handleSaveFile}
                  disabled={savingFile || savingToLibrary || fileEditor.truncated}
                  className="flex items-center gap-1.5 text-[11px] bg-primary text-primary-foreground px-3 py-1.5 rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {savingFile ? <><Loader2 className="w-3 h-3 animate-spin" /> Salvando...</> : 'Salvar'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Modal — novo arquivo ───────────────────────────────────── */}
        {showNewModal && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
            onClick={() => !creating && setShowNewModal(false)}
          >
            <div
              className="w-full max-w-xl rounded-lg border border-border bg-card shadow-xl max-h-[90vh] flex flex-col"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                <h2 className="text-sm font-semibold text-foreground">
                  Novo {kindSingular} em {projectDir}
                </h2>
                <button onClick={() => !creating && setShowNewModal(false)} className="p-1 rounded hover:bg-muted/40">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="px-6 py-4 space-y-4 flex-1 min-h-0 overflow-y-auto">
                <div>
                  <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-1 block">
                    Nome do arquivo *
                  </label>
                  <input
                    type="text"
                    value={newForm.fileName}
                    onChange={e => setNewForm({ ...newForm, fileName: e.target.value })}
                    placeholder="meu-agente.md"
                    className="w-full bg-input rounded-md px-3 py-2 text-xs text-foreground outline-none border border-border focus:border-primary/50 transition-colors font-mono"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">
                    “.md” é adicionado automaticamente se faltar.
                  </p>
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-1 block">
                    Conteúdo
                  </label>
                  <textarea
                    value={newForm.content}
                    onChange={e => setNewForm({ ...newForm, content: e.target.value })}
                    spellCheck={false}
                    rows={12}
                    className="w-full bg-input rounded-md px-3 py-2 text-xs text-foreground outline-none border border-border focus:border-primary/50 transition-colors font-mono resize-none"
                  />
                </div>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={newForm.alsoLibrary}
                    onChange={e => setNewForm({ ...newForm, alsoLibrary: e.target.checked })}
                    className="w-3.5 h-3.5 accent-[var(--primary,currentColor)]"
                  />
                  <span className="text-xs text-foreground">Salvar também na biblioteca (~/.orchestr/defaults)</span>
                </label>
                {newError && <p className="text-[11px] text-destructive">{newError}</p>}
              </div>
              <div className="px-6 py-3 border-t border-border flex justify-end gap-2">
                <button
                  onClick={() => setShowNewModal(false)}
                  disabled={creating}
                  className="text-[11px] text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-md transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleCreateFile}
                  disabled={creating || !newForm.fileName.trim()}
                  className="flex items-center gap-1.5 text-[11px] bg-primary text-primary-foreground px-3 py-1.5 rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {creating ? <><Loader2 className="w-3 h-3 animate-spin" /> Criando...</> : 'Criar'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Modal — executor create/edit ───────────────────────────── */}
        {showExecModal && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
            onClick={() => !execSaving && setShowExecModal(false)}
          >
            <div
              className="w-full max-w-md rounded-lg border border-border bg-card shadow-xl"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                <h2 className="text-sm font-semibold text-foreground">
                  {editingExecutor ? 'Editar executor' : 'Novo executor'}
                </h2>
                <button onClick={() => !execSaving && setShowExecModal(false)} className="p-1 rounded hover:bg-muted/40">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="px-6 py-4 space-y-4">
                <div>
                  <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-1 block">
                    Name *
                  </label>
                  <input
                    type="text"
                    value={execForm.name}
                    onChange={e => setExecForm({ ...execForm, name: e.target.value })}
                    placeholder="Executor name"
                    className="w-full bg-input rounded-md px-3 py-2 text-xs text-foreground outline-none border border-border focus:border-primary/50 transition-colors"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-1 block">
                    Model
                  </label>
                  <input
                    type="text"
                    value={execForm.model}
                    onChange={e => setExecForm({ ...execForm, model: e.target.value })}
                    placeholder="sonnet"
                    list="executor-model-options"
                    className="w-full bg-input rounded-md px-3 py-2 text-xs text-foreground outline-none border border-border focus:border-primary/50 transition-colors"
                  />
                  <datalist id="executor-model-options">
                    <option value="sonnet" />
                    <option value="opus" />
                    <option value="haiku" />
                  </datalist>
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-1 block">
                    CLI Profile *
                  </label>
                  <select
                    value={execForm.cliProfileId}
                    onChange={e => setExecForm({ ...execForm, cliProfileId: e.target.value })}
                    className="w-full bg-input rounded-md px-3 py-2 text-xs text-foreground outline-none border border-border focus:border-primary/50 transition-colors"
                  >
                    <option value="">Selecione um profile...</option>
                    {cliProfiles.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Obrigatório — define o binário usado pelas sessões de pipeline.
                  </p>
                </div>
                {execError && <p className="text-[11px] text-destructive">{execError}</p>}
              </div>
              <div className="px-6 py-3 border-t border-border flex justify-end gap-2">
                <button
                  onClick={() => setShowExecModal(false)}
                  disabled={execSaving}
                  className="text-[11px] text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-md transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSaveExecutor}
                  disabled={execSaving || !execForm.name.trim() || !execForm.cliProfileId}
                  className="flex items-center gap-1.5 text-[11px] bg-primary text-primary-foreground px-3 py-1.5 rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {execSaving ? <><Loader2 className="w-3 h-3 animate-spin" /> Salvando...</> : 'Salvar'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── ConfirmModals ──────────────────────────────────────────── */}
        {deletingFile && (
          <ConfirmModal
            title={deletingFile.scope === 'project' ? 'Deletar do projeto' : 'Deletar da biblioteca'}
            message={
              deletingFile.scope === 'project'
                ? `Deletar "${deletingFile.fileName}" de ${projectDir}? Esta ação não pode ser desfeita.`
                : `Deletar "${deletingFile.fileName}" da biblioteca (~/.orchestr/defaults)? Esta ação não pode ser desfeita.`
            }
            confirmLabel="Deletar"
            cancelLabel="Cancelar"
            destructive
            loading={deletingFileBusy}
            onConfirm={handleDeleteFile}
            onCancel={() => setDeletingFile(null)}
          />
        )}

        {injectTarget && (
          <ConfirmModal
            title="Sobrescrever arquivo do projeto"
            message={`"${injectTarget.fileName}" já existe em ${projectDir}. Injetar da biblioteca vai sobrescrever o conteúdo atual do projeto. Continuar?`}
            confirmLabel="Sobrescrever"
            cancelLabel="Cancelar"
            destructive
            onConfirm={() => {
              const file = injectTarget
              setInjectTarget(null)
              doInject(file)
            }}
            onCancel={() => setInjectTarget(null)}
          />
        )}

        {deletingExecutor && (
          <ConfirmModal
            title="Deletar executor"
            message={
              deletingExecutor.status === 'running'
                ? `"${deletingExecutor.name}" está RUNNING — deletá-lo pode interromper a sessão em andamento. Esta ação não pode ser desfeita. Continuar?`
                : `Deletar o executor "${deletingExecutor.name}"? Esta ação não pode ser desfeita.`
            }
            confirmLabel="Deletar"
            cancelLabel="Cancelar"
            destructive
            onConfirm={handleDeleteExecutor}
            onCancel={() => setDeletingExecutor(null)}
          />
        )}
      </div>
    </Shell>
  )
}
