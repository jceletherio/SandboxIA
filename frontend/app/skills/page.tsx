'use client'

import {
  cliSkillsApi,
  cliSkillsLibraryApi,
  type CliFileTarget,
  type CliSkill,
  type SkillFileContent,
  type SkillFileEntry,
  type SkillProjectListing,
} from '@/lib/api'
import { useProject } from '@/lib/project-context'
import { cn } from '@/lib/utils'
import { Shell } from '@/components/shell'
import {
  AlertTriangle,
  Download,
  FileText,
  Folder,
  FolderOpen,
  FolderTree,
  Inbox,
  Library,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useToast } from '@/components/toast-provider'
import { Skeleton } from '@/components/ui/skeleton'
import { ConfirmModal } from '@/components/confirm-modal'

const DIR_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

const NEW_SKILL_TEMPLATE = `---
name: minha-skill
description: Quando usar esta skill
---

Instruções da skill aqui.
`

const TARGET_LABELS: Record<string, string> = {
  claude: 'Claude Code',
  opencode: 'OpenCode',
}

type SkillScope = 'project' | 'library'

type ExplorerState = {
  scope: SkillScope
  target: CliFileTarget
  skill: CliSkill
  selectedPath: string | null
  fileLoading: boolean
  fileError: string | null
  file: SkillFileContent | null
  /** edição do arquivo aberto (só skills do projeto, arquivo não truncado) */
  editing: boolean
  draft: string
  saving: boolean
  saveError: string | null
}

/** ação adiada até o usuário decidir o que fazer com as alterações não salvas */
type PendingDiscard = { kind: 'close' } | { kind: 'select'; path: string }

type TreeRow =
  | { type: 'dir'; path: string; depth: number; name: string }
  | { type: 'file'; path: string; depth: number; name: string; size: number }

function buildTree(files: SkillFileEntry[]): TreeRow[] {
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path))
  const rows: TreeRow[] = []
  const seenDirs = new Set<string>()
  for (const file of sorted) {
    const parts = file.path.split('/')
    for (let i = 0; i < parts.length - 1; i++) {
      const dirPath = parts.slice(0, i + 1).join('/')
      if (!seenDirs.has(dirPath)) {
        seenDirs.add(dirPath)
        rows.push({ type: 'dir', path: dirPath, depth: i, name: parts[i] })
      }
    }
    rows.push({
      type: 'file',
      path: file.path,
      depth: parts.length - 1,
      name: parts[parts.length - 1],
      size: file.size,
    })
  }
  return rows
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
  } catch {
    return iso
  }
}

function isAlreadyExistsError(err: unknown): boolean {
  return err instanceof Error && /already exists|já existe/i.test(err.message)
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

function SkillCard({
  skill,
  badges,
  onOpen,
  actions,
}: {
  skill: CliSkill
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
          <FolderTree className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <p className="text-xs font-semibold text-foreground font-mono truncate">{skill.dirName}</p>
        </div>
        {badges && <div className="flex items-center gap-1 shrink-0">{badges}</div>}
      </div>
      <p className="text-[11px] text-muted-foreground mt-1.5 line-clamp-2 flex-1">
        {skill.description || '—'}
      </p>
      <div className="flex items-center justify-between mt-3 pt-2 border-t border-border/50">
        <span className="text-[10px] font-mono text-muted-foreground truncate">
          {skill.fileCount} {skill.fileCount === 1 ? 'arquivo' : 'arquivos'} · {formatSize(skill.totalSize)} ·{' '}
          {formatDate(skill.updatedAt)}
        </span>
        <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
          {actions}
        </div>
      </div>
    </div>
  )
}

export default function SkillsPage() {
  const { currentProject } = useProject()
  const { toast, update } = useToast()

  const [target, setTarget] = useState<CliFileTarget>('claude')
  // false até o usuário escolher manualmente um target — enquanto isso o
  // default vem do primeiro target com exists=true na resposta do list.
  const targetTouchedRef = useRef(false)

  // Seção 1 — skills do projeto
  const [projectListing, setProjectListing] = useState<SkillProjectListing | null>(null)
  const [projectLoading, setProjectLoading] = useState(true)
  const [projectError, setProjectError] = useState<string | null>(null)

  // Seção 2 — biblioteca global
  const [libraryListing, setLibraryListing] = useState<{
    dir: string
    exists: boolean
    skills: CliSkill[]
  } | null>(null)
  const [libraryLoading, setLibraryLoading] = useState(true)
  const [libraryError, setLibraryError] = useState<string | null>(null)

  // Modal — explorador de skill
  const [explorer, setExplorer] = useState<ExplorerState | null>(null)
  const fileReqRef = useRef(0)
  const [confirmSave, setConfirmSave] = useState(false)
  const [pendingDiscard, setPendingDiscard] = useState<PendingDiscard | null>(null)

  // Ações — salvar na biblioteca / injetar / deletar
  const [savingToLibrary, setSavingToLibrary] = useState<string | null>(null)
  const [saveOverwriteTarget, setSaveOverwriteTarget] = useState<CliSkill | null>(null)
  const [injecting, setInjecting] = useState<string | null>(null)
  const [injectOverwriteTarget, setInjectOverwriteTarget] = useState<CliSkill | null>(null)
  const [deletingSkill, setDeletingSkill] = useState<{ scope: SkillScope; skill: CliSkill } | null>(null)
  const [deletingBusy, setDeletingBusy] = useState(false)

  // Modal — nova skill
  const [showNewModal, setShowNewModal] = useState(false)
  const [newForm, setNewForm] = useState({ dirName: '', content: NEW_SKILL_TEMPLATE })
  const [newError, setNewError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const targetOptions = projectListing?.targets ?? []
  const targetListing =
    targetOptions.find(t => t.target === target) ?? targetOptions[0] ?? null
  const activeTarget = targetListing?.target ?? target
  const targetLabel = TARGET_LABELS[activeTarget] ?? activeTarget
  const projectDir = targetListing?.dir ?? '.claude/skills'
  const projectSkillNames = new Set((targetListing?.skills ?? []).map(s => s.dirName))

  const loadProject = useCallback(async () => {
    if (!currentProject) {
      setProjectListing(null)
      setProjectLoading(false)
      setProjectError(null)
      return
    }
    setProjectLoading(true)
    setProjectError(null)
    try {
      const listing = await cliSkillsApi.list(currentProject.id)
      setProjectListing(listing)
      if (!targetTouchedRef.current) {
        const firstExisting = listing.targets.find(t => t.exists)
        setTarget(firstExisting?.target ?? listing.targets[0]?.target ?? 'claude')
      }
    } catch (err) {
      console.error('Failed to load project skills:', err)
      setProjectError('Erro ao carregar as skills do projeto')
    } finally {
      setProjectLoading(false)
    }
  }, [currentProject])

  const loadLibrary = useCallback(async () => {
    setLibraryLoading(true)
    setLibraryError(null)
    try {
      setLibraryListing(await cliSkillsLibraryApi.list())
    } catch (err) {
      console.error('Failed to load skills library:', err)
      setLibraryError('Erro ao carregar a biblioteca de skills')
    } finally {
      setLibraryLoading(false)
    }
  }, [])

  useEffect(() => {
    // ao trocar de projeto, volta a derivar o target default da resposta do list
    targetTouchedRef.current = false
  }, [currentProject])

  useEffect(() => {
    loadProject()
  }, [loadProject])

  useEffect(() => {
    loadLibrary()
  }, [loadLibrary])

  const refreshAll = () => {
    loadProject()
    loadLibrary()
  }

  // ── Explorador ──────────────────────────────────────────────────────────

  const loadExplorerFile = useCallback(
    async (scope: SkillScope, fileTarget: CliFileTarget, dirName: string, path: string) => {
      const reqId = ++fileReqRef.current
      setExplorer(prev =>
        prev
          ? {
              ...prev,
              selectedPath: path,
              fileLoading: true,
              fileError: null,
              file: null,
              editing: false,
              draft: '',
              saving: false,
              saveError: null,
            }
          : prev
      )
      try {
        const data =
          scope === 'project'
            ? await cliSkillsApi.readFile(currentProject!.id, fileTarget, dirName, path)
            : await cliSkillsLibraryApi.readFile(dirName, path)
        if (fileReqRef.current !== reqId) return
        setExplorer(prev => (prev ? { ...prev, file: data, fileLoading: false } : prev))
      } catch (err) {
        console.error('Failed to read skill file:', err)
        if (fileReqRef.current !== reqId) return
        setExplorer(prev =>
          prev ? { ...prev, fileLoading: false, fileError: `Erro ao carregar ${path}` } : prev
        )
      }
    },
    [currentProject]
  )

  const openExplorer = (scope: SkillScope, skill: CliSkill) => {
    const initialPath =
      skill.files.find(f => f.path === 'SKILL.md')?.path ?? skill.files[0]?.path ?? null
    setExplorer({
      scope,
      target: activeTarget,
      skill,
      selectedPath: initialPath,
      fileLoading: initialPath !== null,
      fileError: null,
      file: null,
      editing: false,
      draft: '',
      saving: false,
      saveError: null,
    })
    if (initialPath) {
      loadExplorerFile(scope, activeTarget, skill.dirName, initialPath)
    }
  }

  // ── Edição de arquivo da skill (só projeto) ─────────────────────────────

  const explorerDirty = !!explorer?.editing && explorer.draft !== (explorer.file?.content ?? '')

  const canEditFile =
    !!explorer &&
    explorer.scope === 'project' &&
    !!currentProject &&
    !!explorer.file &&
    !explorer.file.truncated

  const startEdit = () => {
    setExplorer(prev =>
      prev ? { ...prev, editing: true, draft: prev.file?.content ?? '', saveError: null } : prev
    )
  }

  const cancelEdit = () => {
    setExplorer(prev => (prev ? { ...prev, editing: false, draft: '', saveError: null } : prev))
  }

  const closeExplorer = () => {
    setExplorer(null)
    setConfirmSave(false)
    setPendingDiscard(null)
  }

  /** Roda a ação direto, ou pede confirmação se há alterações não salvas. */
  const guardDirty = (action: PendingDiscard) => {
    if (explorerDirty) {
      setPendingDiscard(action)
      return
    }
    runDiscardAction(action)
  }

  const runDiscardAction = (action: PendingDiscard) => {
    if (action.kind === 'close') {
      closeExplorer()
    } else if (explorer) {
      loadExplorerFile(explorer.scope, explorer.target, explorer.skill.dirName, action.path)
    }
  }

  const handleSaveFile = async () => {
    if (!explorer || !explorer.selectedPath || !currentProject) return
    const { target: fileTarget, skill, selectedPath, draft } = explorer
    setExplorer(prev => (prev ? { ...prev, saving: true, saveError: null } : prev))
    const toastId = toast('loading', `Salvando ${selectedPath}...`)
    try {
      const saved = await cliSkillsApi.writeFile(
        currentProject.id,
        fileTarget,
        skill.dirName,
        selectedPath,
        draft
      )
      update(toastId, 'success', `${selectedPath} salvo em ${projectDir}/${skill.dirName}`)
      setExplorer(prev =>
        prev && prev.selectedPath === selectedPath
          ? {
              ...prev,
              file: saved,
              draft: saved.content,
              editing: false,
              saving: false,
              saveError: null,
              skill: {
                ...prev.skill,
                files: prev.skill.files.map(f =>
                  f.path === selectedPath ? { ...f, size: saved.size } : f
                ),
              },
            }
          : prev
      )
      loadProject()
    } catch (err) {
      console.error('Failed to save skill file:', err)
      update(toastId, 'error', `Erro ao salvar ${selectedPath}`)
      setExplorer(prev =>
        prev
          ? {
              ...prev,
              saving: false,
              saveError: err instanceof Error ? err.message : `Erro ao salvar ${selectedPath}`,
            }
          : prev
      )
    }
  }

  // ── Salvar na biblioteca (projeto → ~/.orchestr/defaults/skills) ────────

  const doSaveToLibrary = async (skill: CliSkill, overwrite: boolean) => {
    if (!currentProject) return
    setSavingToLibrary(skill.dirName)
    const toastId = toast('loading', `Salvando "${skill.dirName}" na biblioteca...`)
    try {
      await cliSkillsApi.saveToLibrary(currentProject.id, activeTarget, skill.dirName, overwrite)
      update(toastId, 'success', `"${skill.dirName}" salva na biblioteca`)
      await loadLibrary()
    } catch (err) {
      if (!overwrite && isAlreadyExistsError(err)) {
        update(toastId, 'error', `"${skill.dirName}" já existe na biblioteca`)
        setSaveOverwriteTarget(skill)
      } else {
        console.error('Failed to save skill to library:', err)
        update(toastId, 'error', `Erro ao salvar "${skill.dirName}" na biblioteca`)
      }
    } finally {
      setSavingToLibrary(null)
    }
  }

  const handleSaveToLibrary = (skill: CliSkill) => {
    if (libraryListing?.skills.some(s => s.dirName === skill.dirName)) {
      setSaveOverwriteTarget(skill)
    } else {
      doSaveToLibrary(skill, false)
    }
  }

  // ── Injetar (biblioteca → projeto) ──────────────────────────────────────

  const doInject = async (skill: CliSkill, overwrite: boolean) => {
    if (!currentProject) return
    setInjecting(skill.dirName)
    const toastId = toast('loading', `Injetando "${skill.dirName}" em ${projectDir}...`)
    try {
      await cliSkillsApi.inject(currentProject.id, activeTarget, skill.dirName, overwrite)
      update(toastId, 'success', `"${skill.dirName}" injetada em ${projectDir}`)
      await loadProject()
    } catch (err) {
      if (!overwrite && isAlreadyExistsError(err)) {
        update(toastId, 'error', `"${skill.dirName}" já existe no projeto`)
        setInjectOverwriteTarget(skill)
      } else {
        console.error('Failed to inject skill:', err)
        update(toastId, 'error', `Erro ao injetar "${skill.dirName}"`)
      }
    } finally {
      setInjecting(null)
    }
  }

  const handleInject = (skill: CliSkill) => {
    if (!currentProject) return
    if (projectSkillNames.has(skill.dirName)) {
      setInjectOverwriteTarget(skill)
    } else {
      doInject(skill, false)
    }
  }

  // ── Deletar ─────────────────────────────────────────────────────────────

  const handleDelete = async () => {
    if (!deletingSkill) return
    const { scope, skill } = deletingSkill
    setDeletingBusy(true)
    const toastId = toast('loading', `Deletando "${skill.dirName}"...`)
    try {
      if (scope === 'project') {
        if (!currentProject) throw new Error('no project')
        await cliSkillsApi.delete(currentProject.id, activeTarget, skill.dirName)
        await loadProject()
      } else {
        await cliSkillsLibraryApi.delete(skill.dirName)
        await loadLibrary()
      }
      update(toastId, 'success', `"${skill.dirName}" deletada`)
      setDeletingSkill(null)
    } catch (err) {
      console.error('Failed to delete skill:', err)
      update(toastId, 'error', `Erro ao deletar "${skill.dirName}"`)
    } finally {
      setDeletingBusy(false)
    }
  }

  // ── Nova skill ──────────────────────────────────────────────────────────

  const openNewModal = () => {
    setNewForm({ dirName: '', content: NEW_SKILL_TEMPLATE })
    setNewError(null)
    setShowNewModal(true)
  }

  const handleCreate = async () => {
    if (!currentProject) return
    const dirName = newForm.dirName.trim()
    if (!dirName) {
      setNewError('Informe o nome da pasta da skill')
      return
    }
    if (!DIR_NAME_RE.test(dirName)) {
      setNewError('Nome inválido — use letras, números, ".", "_" ou "-", começando com letra ou número')
      return
    }
    setNewError(null)
    setCreating(true)
    const toastId = toast('loading', `Criando skill "${dirName}"...`)
    try {
      await cliSkillsApi.create(currentProject.id, activeTarget, dirName, newForm.content)
      update(toastId, 'success', `"${dirName}" criada em ${projectDir}`)
      setShowNewModal(false)
      await loadProject()
    } catch (err) {
      console.error('Failed to create skill:', err)
      update(toastId, 'error', `Erro ao criar "${dirName}"`)
      setNewError(err instanceof Error ? err.message : 'Erro ao criar a skill')
    } finally {
      setCreating(false)
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <Shell>
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
        <header className="flex items-center justify-between gap-3 px-4 lg:px-6 py-3 border-b border-border bg-card/50 sticky top-0 z-10">
          <div className="min-w-0">
            <h1 className="text-sm font-semibold text-foreground">Skills</h1>
            <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
              Skills são pastas de instruções e recursos (SKILL.md, scripts, templates) que os CLIs de IA carregam do repo do projeto, com uma biblioteca reutilizável entre projetos.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {targetOptions.length > 1 && (
              <div className="flex items-center rounded-md border border-border p-0.5">
                {targetOptions.map(t => (
                  <button
                    key={t.target}
                    onClick={() => {
                      targetTouchedRef.current = true
                      setTarget(t.target)
                    }}
                    className={cn(
                      'text-[11px] px-2.5 py-1 rounded transition-colors',
                      activeTarget === t.target
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
                    )}
                  >
                    {TARGET_LABELS[t.target] ?? t.target}
                  </button>
                ))}
              </div>
            )}
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
              New skill
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
                  {projectDir} · {targetListing?.skills.length ?? 0} skills
                </span>
              )}
            </div>

            {!currentProject ? (
              <NoProjectNotice message="Selecione um projeto para gerenciar as skills do repo." />
            ) : projectLoading ? (
              <SectionSkeleton />
            ) : projectError ? (
              <SectionError message={projectError} onRetry={loadProject} />
            ) : (targetListing?.skills.length ?? 0) === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 gap-3 rounded-lg border border-dashed border-border">
                <Inbox className="w-8 h-8 text-muted-foreground/50" />
                <div className="text-center">
                  <p className="text-xs font-medium text-foreground">
                    O projeto ainda não tem skills de {targetLabel} em {projectDir}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Crie uma nova ou injete uma skill da biblioteca abaixo.
                  </p>
                </div>
                <button
                  onClick={openNewModal}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Criar skill
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {targetListing?.skills.map(skill => (
                  <SkillCard
                    key={skill.dirName}
                    skill={skill}
                    onOpen={() => openExplorer('project', skill)}
                    actions={
                      <>
                        <button
                          onClick={() => openExplorer('project', skill)}
                          title="Explorar arquivos da skill"
                          className="p-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                        >
                          <FolderTree className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => handleSaveToLibrary(skill)}
                          disabled={savingToLibrary === skill.dirName}
                          title="Salvar na biblioteca (~/.orchestr/defaults/skills) — copia a pasta inteira"
                          className="p-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {savingToLibrary === skill.dirName ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Library className="w-3 h-3" />
                          )}
                        </button>
                        <button
                          onClick={() => setDeletingSkill({ scope: 'project', skill })}
                          title="Deletar a pasta da skill do repo"
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
                Biblioteca (reutilizável entre projetos)
              </h2>
              {!libraryLoading && !libraryError && (
                <span className="text-[10px] font-mono text-muted-foreground">
                  {libraryListing?.skills.length ?? 0} skills
                </span>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground mb-3">
              A biblioteca vive em <span className="font-mono">~/.orchestr/defaults/skills</span> e vale para todos os projetos. Injetar copia a pasta inteira da skill para o repo.
            </p>

            {libraryLoading ? (
              <SectionSkeleton />
            ) : libraryError ? (
              <SectionError message={libraryError} onRetry={loadLibrary} />
            ) : (libraryListing?.skills.length ?? 0) === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 gap-2 rounded-lg border border-dashed border-border">
                <Inbox className="w-7 h-7 text-muted-foreground/50" />
                <p className="text-xs text-muted-foreground">
                  A biblioteca ainda não tem skills. Salve uma skill do projeto na biblioteca para reutilizá-la.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {libraryListing?.skills.map(skill => {
                  const inProject = projectSkillNames.has(skill.dirName)
                  return (
                    <SkillCard
                      key={skill.dirName}
                      skill={skill}
                      badges={
                        inProject ? (
                          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-primary/15 text-primary uppercase">
                            já no projeto
                          </span>
                        ) : undefined
                      }
                      onOpen={() => openExplorer('library', skill)}
                      actions={
                        <>
                          <button
                            onClick={() => handleInject(skill)}
                            disabled={!currentProject || injecting === skill.dirName}
                            title={
                              !currentProject
                                ? 'Selecione um projeto para injetar'
                                : `Injetar em ${projectDir} (${targetLabel}) — copia a pasta inteira`
                            }
                            className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {injecting === skill.dirName ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Download className="w-3 h-3" />
                            )}
                            Injetar
                          </button>
                          <button
                            onClick={() => openExplorer('library', skill)}
                            title="Explorar arquivos da skill"
                            className="p-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                          >
                            <FolderTree className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => setDeletingSkill({ scope: 'library', skill })}
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
        </div>

        {/* ── Modal — explorador de skill ────────────────────────────── */}
        {explorer && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
            onClick={() => !explorer.saving && guardDirty({ kind: 'close' })}
          >
            <div
              className="w-full max-w-4xl h-[85vh] rounded-lg border border-border bg-card shadow-xl flex flex-col m-4"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-border gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <FolderTree className="w-4 h-4 text-muted-foreground shrink-0" />
                    <h2 className="text-sm font-semibold text-foreground font-mono truncate">
                      {explorer.skill.dirName}
                    </h2>
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground uppercase shrink-0">
                      {explorer.scope === 'project' ? projectDir : 'biblioteca'}
                    </span>
                    <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                      {explorer.skill.fileCount} {explorer.skill.fileCount === 1 ? 'arquivo' : 'arquivos'} ·{' '}
                      {formatSize(explorer.skill.totalSize)}
                    </span>
                  </div>
                  {explorer.skill.description && (
                    <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                      {explorer.skill.description}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => !explorer.saving && guardDirty({ kind: 'close' })}
                  className="p-1 rounded hover:bg-muted/40 shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex flex-1 min-h-0">
                {/* Coluna esquerda — árvore de arquivos */}
                <div className="w-64 shrink-0 border-r border-border overflow-y-auto py-2">
                  {explorer.skill.files.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground px-4 py-2">Skill sem arquivos.</p>
                  ) : (
                    buildTree(explorer.skill.files).map(row =>
                      row.type === 'dir' ? (
                        <div
                          key={`dir:${row.path}`}
                          className="flex items-center gap-1.5 px-3 py-1 text-[11px] text-muted-foreground"
                          style={{ paddingLeft: `${12 + row.depth * 14}px` }}
                          title={row.path}
                        >
                          <Folder className="w-3 h-3 shrink-0" />
                          <span className="font-mono truncate">{row.name}/</span>
                        </div>
                      ) : (
                        <button
                          key={`file:${row.path}`}
                          onClick={() => {
                            if (explorer.saving) return
                            // reabrir o arquivo aberto em edição descartaria o draft à toa
                            if (explorer.editing && row.path === explorer.selectedPath) return
                            guardDirty({ kind: 'select', path: row.path })
                          }}
                          title={row.path}
                          className={cn(
                            'w-full flex items-center gap-1.5 px-3 py-1 text-[11px] transition-colors text-left',
                            explorer.selectedPath === row.path
                              ? 'bg-primary/10 text-primary'
                              : 'text-foreground hover:bg-muted/40'
                          )}
                          style={{ paddingLeft: `${12 + row.depth * 14}px` }}
                        >
                          <FileText className="w-3 h-3 shrink-0 text-muted-foreground" />
                          <span className="font-mono truncate flex-1">{row.name}</span>
                          <span className="text-[9px] font-mono text-muted-foreground/70 shrink-0">
                            {formatSize(row.size)}
                          </span>
                        </button>
                      )
                    )
                  )}
                </div>

                {/* Coluna direita — conteúdo do arquivo */}
                <div className="flex-1 min-w-0 flex flex-col">
                  {explorer.selectedPath && (
                    <div className="flex items-center gap-2 px-4 py-2 border-b border-border/50">
                      <span className="text-[11px] font-mono text-muted-foreground truncate flex-1">
                        {explorer.selectedPath}
                      </span>
                      {explorer.file?.truncated && (
                        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-status-running/15 text-status-running uppercase shrink-0">
                          truncated
                        </span>
                      )}
                      {explorerDirty && (
                        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-status-running/15 text-status-running uppercase shrink-0">
                          não salvo
                        </span>
                      )}
                      {!canEditFile ? (
                        <span
                          title={
                            explorer.scope === 'library'
                              ? 'Skills da biblioteca são somente leitura — injete no projeto para editar'
                              : explorer.file?.truncated
                                ? 'Arquivo grande demais para editar no Orchestr (exibido truncado)'
                                : undefined
                          }
                          className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground uppercase shrink-0"
                        >
                          somente leitura
                        </span>
                      ) : explorer.editing ? (
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            onClick={cancelEdit}
                            disabled={explorer.saving}
                            className="text-[11px] text-muted-foreground hover:text-foreground px-2 py-1 rounded-md transition-colors disabled:opacity-50"
                          >
                            Cancelar
                          </button>
                          <button
                            onClick={() => setConfirmSave(true)}
                            disabled={!explorerDirty || explorer.saving}
                            title={!explorerDirty ? 'Nenhuma alteração' : `Salvar ${explorer.selectedPath}`}
                            className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {explorer.saving ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Save className="w-3 h-3" />
                            )}
                            Salvar
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={startEdit}
                          title={`Editar ${explorer.selectedPath} no repo do projeto`}
                          className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors shrink-0"
                        >
                          <Pencil className="w-3 h-3" />
                          Editar
                        </button>
                      )}
                    </div>
                  )}
                  {explorer.saveError && (
                    <div className="flex items-start gap-2 px-4 py-2 border-b border-destructive/30 bg-destructive/10">
                      <AlertTriangle className="w-3.5 h-3.5 text-destructive shrink-0 mt-0.5" />
                      <p className="text-[11px] text-destructive break-words">{explorer.saveError}</p>
                    </div>
                  )}
                  {!explorer.selectedPath ? (
                    <div className="flex-1 flex items-center justify-center">
                      <p className="text-xs text-muted-foreground">Selecione um arquivo à esquerda.</p>
                    </div>
                  ) : explorer.fileLoading ? (
                    <div className="flex-1 flex items-center justify-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">Carregando {explorer.selectedPath}...</span>
                    </div>
                  ) : explorer.fileError ? (
                    <div className="flex-1 flex flex-col items-center justify-center gap-2 px-6">
                      <AlertTriangle className="w-5 h-5 text-destructive" />
                      <p className="text-xs text-destructive">{explorer.fileError}</p>
                      <button
                        onClick={() =>
                          loadExplorerFile(
                            explorer.scope,
                            explorer.target,
                            explorer.skill.dirName,
                            explorer.selectedPath!
                          )
                        }
                        className="text-[11px] text-destructive underline hover:no-underline"
                      >
                        Tentar novamente
                      </button>
                    </div>
                  ) : explorer.editing ? (
                    <textarea
                      value={explorer.draft}
                      onChange={e =>
                        setExplorer(prev => (prev ? { ...prev, draft: e.target.value } : prev))
                      }
                      disabled={explorer.saving}
                      spellCheck={false}
                      className="flex-1 min-h-0 w-full resize-none bg-input px-4 py-3 text-xs font-mono text-foreground outline-none border-0 focus:ring-1 focus:ring-inset focus:ring-primary/50 transition-colors disabled:opacity-60"
                    />
                  ) : (
                    <pre className="flex-1 min-h-0 overflow-auto px-4 py-3 text-xs font-mono text-foreground whitespace-pre-wrap break-words">
                      {explorer.file?.content ?? ''}
                    </pre>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Modal — nova skill ─────────────────────────────────────── */}
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
                  Nova skill em {projectDir}
                </h2>
                <button onClick={() => !creating && setShowNewModal(false)} className="p-1 rounded hover:bg-muted/40">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="px-6 py-4 space-y-4 flex-1 min-h-0 overflow-y-auto">
                <div>
                  <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-1 block">
                    Nome da pasta *
                  </label>
                  <input
                    type="text"
                    value={newForm.dirName}
                    onChange={e => setNewForm({ ...newForm, dirName: e.target.value })}
                    placeholder="minha-skill"
                    className="w-full bg-input rounded-md px-3 py-2 text-xs text-foreground outline-none border border-border focus:border-primary/50 transition-colors font-mono"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Vira a pasta {projectDir}/&lt;nome&gt;/ com um SKILL.md dentro. Os demais arquivos (scripts, templates) podem ser evoluídos fora do Orchestr.
                  </p>
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-1 block">
                    SKILL.md
                  </label>
                  <textarea
                    value={newForm.content}
                    onChange={e => setNewForm({ ...newForm, content: e.target.value })}
                    spellCheck={false}
                    rows={12}
                    className="w-full bg-input rounded-md px-3 py-2 text-xs text-foreground outline-none border border-border focus:border-primary/50 transition-colors font-mono resize-none"
                  />
                </div>
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
                  onClick={handleCreate}
                  disabled={creating || !newForm.dirName.trim()}
                  className="flex items-center gap-1.5 text-[11px] bg-primary text-primary-foreground px-3 py-1.5 rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {creating ? <><Loader2 className="w-3 h-3 animate-spin" /> Criando...</> : 'Criar'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── ConfirmModals ──────────────────────────────────────────── */}
        {confirmSave && explorer?.selectedPath && (
          <ConfirmModal
            title="Salvar alterações no arquivo"
            message={`Salvar sobrescreve ${projectDir}/${explorer.skill.dirName}/${explorer.selectedPath} no repo do projeto. Continuar?`}
            confirmLabel="Salvar"
            cancelLabel="Cancelar"
            loading={explorer.saving}
            onConfirm={() => {
              setConfirmSave(false)
              handleSaveFile()
            }}
            onCancel={() => setConfirmSave(false)}
          />
        )}

        {pendingDiscard && (
          <ConfirmModal
            title="Descartar alterações"
            message={`Há alterações não salvas em ${explorer?.selectedPath ?? 'no arquivo aberto'}. Descartar?`}
            confirmLabel="Descartar"
            cancelLabel="Continuar editando"
            destructive
            onConfirm={() => {
              const action = pendingDiscard
              setPendingDiscard(null)
              runDiscardAction(action)
            }}
            onCancel={() => setPendingDiscard(null)}
          />
        )}

        {deletingSkill && (
          <ConfirmModal
            title={deletingSkill.scope === 'project' ? 'Deletar skill do projeto' : 'Deletar skill da biblioteca'}
            message={
              deletingSkill.scope === 'project'
                ? `Deletar "${deletingSkill.skill.dirName}" apaga a PASTA INTEIRA (${deletingSkill.skill.fileCount} ${deletingSkill.skill.fileCount === 1 ? 'arquivo' : 'arquivos'}) de ${projectDir} no repo do projeto. Esta ação não pode ser desfeita.`
                : `Deletar "${deletingSkill.skill.dirName}" apaga a pasta inteira (${deletingSkill.skill.fileCount} ${deletingSkill.skill.fileCount === 1 ? 'arquivo' : 'arquivos'}) da biblioteca (~/.orchestr/defaults/skills). Esta ação não pode ser desfeita.`
            }
            confirmLabel="Deletar"
            cancelLabel="Cancelar"
            destructive
            loading={deletingBusy}
            onConfirm={handleDelete}
            onCancel={() => setDeletingSkill(null)}
          />
        )}

        {injectOverwriteTarget && (
          <ConfirmModal
            title="Sobrescrever skill do projeto"
            message={`"${injectOverwriteTarget.dirName}" já existe em ${projectDir}. Injetar da biblioteca vai sobrescrever a pasta inteira no repo do projeto. Continuar?`}
            confirmLabel="Sobrescrever"
            cancelLabel="Cancelar"
            destructive
            onConfirm={() => {
              const skill = injectOverwriteTarget
              setInjectOverwriteTarget(null)
              doInject(skill, true)
            }}
            onCancel={() => setInjectOverwriteTarget(null)}
          />
        )}

        {saveOverwriteTarget && (
          <ConfirmModal
            title="Sobrescrever skill da biblioteca"
            message={`"${saveOverwriteTarget.dirName}" já existe na biblioteca (~/.orchestr/defaults/skills). Salvar vai sobrescrever a pasta inteira com a versão do projeto. Continuar?`}
            confirmLabel="Sobrescrever"
            cancelLabel="Cancelar"
            destructive
            onConfirm={() => {
              const skill = saveOverwriteTarget
              setSaveOverwriteTarget(null)
              doSaveToLibrary(skill, true)
            }}
            onCancel={() => setSaveOverwriteTarget(null)}
          />
        )}
      </div>
    </Shell>
  )
}
