'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Shell } from '@/components/shell'
import { cn } from '@/lib/utils'
import { contextApi, type ContextFileMeta, type QmdIndexStatus } from '@/lib/api'
import { useProject } from '@/lib/project-context'
import {
  FileText,
  FolderOpen,
  Shield,
  BookOpen,
  RefreshCw,
  Sparkles,
  ChevronRight,
  ChevronDown,
  Check,
  AlertTriangle,
  Edit3,
  Save,
  X,
  Plus,
  Search,
  FolderTree,
  Eye,
  Code,
  Columns,
} from 'lucide-react'
import { ConfirmModal } from '@/components/confirm-modal'

type FileStatus = 'updated' | 'stale'

/** A listagem traz só metadados; o conteúdo é buscado sob demanda em `openFile`. */
type ContextFile = ContextFileMeta

interface SearchResult {
  file: string
  snippet?: string
}

const statusIcon: Record<FileStatus, React.ReactNode> = {
  updated: <Check className="w-3 h-3 text-status-done" />,
  stale: <AlertTriangle className="w-3 h-3 text-status-waiting" />,
}
const statusLabel: Record<FileStatus, string> = { updated: 'Updated', stale: 'Stale' }
const statusColor: Record<FileStatus, string> = {
  updated: 'text-status-done',
  stale: 'text-status-waiting',
}

const sections = [
  { id: 'qmd', label: 'QMD', icon: BookOpen },
  { id: 'context', label: 'Context Files', icon: FolderOpen },
  { id: 'rules', label: 'Rules', icon: Shield },
] as const

/** "3 min ago" — o `qmd status` não expõe timestamp do índice, só do nosso embed. */
function timeAgo(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

/**
 * Estado do índice do qmd (MT-6). O usuário precisa saber se a busca semântica
 * é confiável ANTES de confiar nela — daí o rótulo ser explícito sobre o
 * motivo, e não um ícone solto.
 */
function describeIndex(status: QmdIndexStatus): { label: string; detail: string; tone: 'ok' | 'warn' | 'off' } {
  if (!status.cliAvailable) {
    return { label: 'qmd CLI missing', detail: 'Search falls back to grep. Install qmd or set QMD_BIN.', tone: 'off' }
  }
  if (!status.indexed) {
    return { label: 'Not indexed', detail: 'No qmd collection for this project yet — reindex to create one.', tone: 'off' }
  }
  if (status.freshness === 'fresh') {
    return { label: 'Index fresh', detail: `${status.vectors} vectors · embedded ${timeAgo(status.lastEmbedAt!)}`, tone: 'ok' }
  }
  return {
    label: 'Index stale',
    detail: status.lastEmbedAt
      ? `Last embed ${timeAgo(status.lastEmbedAt)}${status.lastEmbedOk === false ? ' (failed)' : ''} · ${status.vectors} vectors`
      : `No embed run by the orchestrator yet · ${status.vectors} vectors`,
    tone: 'warn',
  }
}

function renderMarkdown(text: string): string {
  // Escapa TODO o texto de entrada antes de qualquer regex de markdown —
  // a partir daqui nenhum replacement reintroduz HTML bruto do conteúdo.
  let html = escapeHtml(text)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, _lang, code) =>
    `<pre style="background:oklch(0.2 0.02 250);padding:1rem;border-radius:0.5rem;overflow-x:auto;margin:1rem 0"><code style="font-family:ui-monospace,monospace;font-size:0.75rem;color:oklch(0.9 0.01 250)">${code.trim()}</code></pre>`
  )
  html = html.replace(/^######\s+(.+)$/gm, '<h6 style="font-size:0.75rem;font-weight:600;margin:1rem 0 0.5rem;color:oklch(0.95 0 0)">$1</h6>')
  html = html.replace(/^#####\s+(.+)$/gm, '<h5 style="font-size:0.8rem;font-weight:600;margin:1rem 0 0.5rem;color:oklch(0.95 0 0)">$1</h5>')
  html = html.replace(/^####\s+(.+)$/gm, '<h4 style="font-size:0.875rem;font-weight:600;margin:1rem 0 0.5rem;color:oklch(0.95 0 0)">$1</h4>')
  html = html.replace(/^###\s+(.+)$/gm, '<h3 style="font-size:1rem;font-weight:600;margin:1.25rem 0 0.5rem;color:oklch(0.95 0 0)">$1</h3>')
  html = html.replace(/^##\s+(.+)$/gm, '<h2 style="font-size:1.25rem;font-weight:600;margin:1.5rem 0 0.5rem;color:oklch(0.95 0 0)">$1</h2>')
  html = html.replace(/^#\s+(.+)$/gm, '<h1 style="font-size:1.5rem;font-weight:700;margin:1.5rem 0 0.75rem;color:oklch(0.95 0 0)">$1</h1>')
  html = html.replace(/^---+$/gm, '<hr style="border:none;border-top:1px solid oklch(0.3 0.02 250);margin:1.5rem 0" />')
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong style="font-weight:600;color:oklch(0.95 0 0)">$1</strong>')
  html = html.replace(/\*(.+?)\*/g, '<em style="font-style:italic">$1</em>')
  html = html.replace(/`([^`]+)`/g, '<code style="background:oklch(0.2 0.02 250);padding:0.125rem 0.375rem;border-radius:0.25rem;font-family:ui-monospace,monospace;font-size:0.75rem;color:oklch(0.85 0.05 300)">$1</code>')
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, url) =>
    `<a href="${sanitizeUrl(url)}" style="color:oklch(0.7 0.15 250);text-decoration:underline" target="_blank" rel="noopener noreferrer">${label}</a>`
  )
  const lines = html.split('\n')
  let result = ''
  let inUl = false
  let inOl = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const ulMatch = line.match(/^[\-\*]\s+(.+)$/)
    const olMatch = line.match(/^\d+\.\s+(.+)$/)
    if (ulMatch) {
      if (!inUl) { result += '<ul style="list-style:disc;padding-left:1.5rem;margin:0.75rem 0">'; inUl = true }
      result += `<li style="margin:0.25rem 0;color:oklch(0.85 0 0)">${ulMatch[1]}</li>`
    } else if (olMatch) {
      if (!inOl) { result += '<ol style="list-style:decimal;padding-left:1.5rem;margin:0.75rem 0">'; inOl = true }
      result += `<li style="margin:0.25rem 0;color:oklch(0.85 0 0)">${olMatch[1]}</li>`
    } else {
      if (inUl) { result += '</ul>'; inUl = false }
      if (inOl) { result += '</ol>'; inOl = false }
      if (line.trim() === '') {
        result += ''
      } else if (!line.startsWith('<h') && !line.startsWith('<hr') && !line.startsWith('<pre')) {
        result += `<p style="margin:0.75rem 0;line-height:1.625;color:oklch(0.85 0 0)">${line}</p>`
      } else {
        result += line
      }
    }
  }
  if (inUl) result += '</ul>'
  if (inOl) result += '</ol>'
  return result
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Permite só http/https, âncoras (#) e caminhos relativos.
 * Bloqueia javascript:, data:, vbscript: e URLs protocol-relative (//).
 * Recebe texto já HTML-escapado, então a URL não escapa do atributo href.
 */
function sanitizeUrl(url: string): string {
  const cleaned = url.trim()
  // Remove controle/espaços antes de checar o scheme (bloqueia "java\tscript:")
  const probe = cleaned.replace(/[\u0000-\u0020]/g, '').toLowerCase()
  if (probe.startsWith('#') || probe.startsWith('http://') || probe.startsWith('https://')) {
    return cleaned
  }
  // Caminho relativo: sem scheme e não protocol-relative
  if (!/^[a-z][a-z0-9+.-]*:/.test(probe) && !probe.startsWith('//')) {
    return cleaned
  }
  return '#'
}

export default function ContextPage() {
  const { currentProject } = useProject()
  const [contextFiles, setContextFiles] = useState<Record<string, ContextFile[]>>({})
  const [root, setRoot] = useState<string>('')
  const [rootExists, setRootExists] = useState(true)
  const [activeFile, setActiveFile] = useState<ContextFile | null>(null)
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({ qmd: true, context: true, rules: true })
  const [editing, setEditing] = useState(false)
  const [isNewFile, setIsNewFile] = useState(false)
  const [editedContent, setEditedContent] = useState('')
  const [ruleInput, setRuleInput] = useState('')
  const [generatingRule, setGeneratingRule] = useState(false)
  const [showRulePanel, setShowRulePanel] = useState(false)
  const [mobileTreeOpen, setMobileTreeOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saveMessage, setSaveMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false)
  const [pendingFile, setPendingFile] = useState<ContextFile | null>(null)
  const [viewMode, setViewMode] = useState<'raw' | 'rendered' | 'split'>('raw')
  // Conteúdo do arquivo aberto: buscado sob demanda e cacheado por fileId (P1.2)
  const [fileContent, setFileContent] = useState('')
  const [contentTruncated, setContentTruncated] = useState(false)
  const [contentLoading, setContentLoading] = useState(false)
  const [contentError, setContentError] = useState<string | null>(null)
  const contentCache = useRef<Map<string, { content: string; truncated: boolean }>>(new Map())
  const [filtering, setFiltering] = useState(false)
  const [contentNonce, setContentNonce] = useState(0)
  const [qmd, setQmd] = useState<QmdIndexStatus | null>(null)
  const [reindexing, setReindexing] = useState(false)
  // Último termo já aplicado no servidor, para o debounce não refazer o fetch inicial
  const appliedSearch = useRef<{ projectId: string | null; term: string }>({ projectId: null, term: '' })

  const fetchFiles = useCallback(async (keepActive = false, search = '') => {
    if (!currentProject) {
      setContextFiles({})
      setLoading(false)
      return
    }
    try {
      const files = await contextApi.getFiles(currentProject.id, search.trim() || undefined)
      const { projectId: _pid, root: fileRoot, rootExists: exists, search: _s, ...groups } = files
      setContextFiles(groups as Record<string, ContextFile[]>)
      setRoot(fileRoot || '')
      setRootExists(exists !== false)
      if (!keepActive) {
        // primeiro arquivo de QUALQUER grupo — nunca esconder a página
        const first =
          (groups.qmd && groups.qmd[0]) ||
          (groups.context && groups.context[0]) ||
          (groups.rules && groups.rules[0]) ||
          null
        setActiveFile(first)
      }
    } catch (error) {
      console.error('Failed to fetch context files:', error)
    } finally {
      setLoading(false)
    }
  }, [currentProject])

  /**
   * Estado do índice do qmd. Poll lento (30 s) quando parado e rápido (5 s)
   * enquanto há embed rodando ou na fila — é nesse intervalo que o número muda.
   */
  const fetchQmd = useCallback(async () => {
    if (!currentProject) return setQmd(null)
    try {
      setQmd(await contextApi.qmdStatus(currentProject.id))
    } catch (error) {
      console.error('Failed to fetch qmd status:', error)
    }
  }, [currentProject])

  // `qmdBusy` é BOOLEAN de propósito: depender de `qmd.running`/`qmd.queued`
  // (objetos novos a cada fetch) refazia o efeito a cada resposta, e o
  // `fetchQmd()` de dentro dele viraria um loop de requests justamente quando há
  // embed na fila.
  const qmdBusy = !!qmd?.running || !!qmd?.queued
  useEffect(() => {
    fetchQmd()
    const timer = setInterval(fetchQmd, qmdBusy ? 5_000 : 30_000)
    return () => clearInterval(timer)
  }, [fetchQmd, qmdBusy])

  const runReindex = async () => {
    if (!currentProject) return
    setReindexing(true)
    try {
      const outcome = await contextApi.reindex(currentProject.id, 'manual')
      setSaveMessage({ ok: outcome.status !== 'skipped', text: outcome.reason })
      await fetchQmd()
    } catch (error: any) {
      setSaveMessage({ ok: false, text: error?.message || 'Failed to queue the reindex' })
    } finally {
      setReindexing(false)
    }
  }

  useEffect(() => {
    setLoading(true)
    setActiveFile(null)
    setEditing(false)
    setSearchResults(null)
    setSearchQuery('')
    contentCache.current.clear()
    appliedSearch.current = { projectId: currentProject?.id ?? null, term: '' }
    fetchFiles()
  }, [fetchFiles, currentProject])

  /**
   * Filtro do tree = busca SERVER-SIDE com debounce (CA3). A listagem não traz mais
   * `content`, então não há como filtrar por texto no cliente.
   */
  useEffect(() => {
    if (!currentProject) return
    const term = searchQuery.trim()
    if (appliedSearch.current.projectId === currentProject.id && appliedSearch.current.term === term) return
    const timer = setTimeout(() => {
      appliedSearch.current = { projectId: currentProject.id, term }
      setFiltering(true)
      fetchFiles(true, term).finally(() => setFiltering(false))
    }, 300)
    return () => clearTimeout(timer)
  }, [searchQuery, currentProject, fetchFiles])

  /** Conteúdo sob demanda do arquivo aberto, com cache em memória por fileId. */
  const activeFileId = activeFile?.id
  useEffect(() => {
    if (isNewFile) return // arquivo ainda não existe em disco (regra gerada)
    if (!activeFileId || !currentProject) {
      setFileContent('')
      setContentTruncated(false)
      setContentError(null)
      setContentLoading(false)
      return
    }
    const cached = contentCache.current.get(activeFileId)
    if (cached) {
      setFileContent(cached.content)
      setContentTruncated(cached.truncated)
      setContentError(null)
      setContentLoading(false)
      return
    }
    let cancelled = false
    setContentLoading(true)
    setContentError(null)
    setFileContent('')
    contextApi
      .getFileContent(activeFileId, currentProject.id)
      .then(({ content, truncated }) => {
        if (cancelled) return
        contentCache.current.set(activeFileId, { content, truncated })
        setFileContent(content)
        setContentTruncated(truncated)
      })
      .catch((error: any) => {
        if (cancelled) return
        setContentError(error?.message || 'Failed to load file content')
      })
      .finally(() => {
        if (!cancelled) setContentLoading(false)
      })
    return () => { cancelled = true }
  }, [activeFileId, currentProject, isNewFile, contentNonce])

  /** Recarrega listagem + conteúdo do arquivo aberto (botões de Refresh). */
  const refreshAll = () => {
    contentCache.current.clear()
    setContentNonce((n) => n + 1)
    fetchFiles(true, searchQuery)
  }

  const allFiles = Object.values(contextFiles).flat()
  const totalFiles = allFiles.length

  const toggleSection = (id: string) =>
    setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }))

  const openFile = (file: ContextFile) => {
    if (editing) {
      setPendingFile(file)
      setShowDiscardConfirm(true)
      return
    }
    setActiveFile(file)
    setMobileTreeOpen(false)
  }

  const confirmDiscard = () => {
    setEditing(false)
    setIsNewFile(false)
    if (pendingFile) {
      setActiveFile(pendingFile)
      setPendingFile(null)
    }
    setShowDiscardConfirm(false)
    setMobileTreeOpen(false)
  }

  const openFileByPath = (relativePath: string) => {
    const file = allFiles.find((f) => f.relativePath === relativePath)
    if (file) openFile(file)
  }

  const startEdit = () => {
    if (activeFile && !contentLoading && !contentError) {
      setEditedContent(fileContent)
      setEditing(true)
    }
  }

  const saveEdit = async () => {
    if (!activeFile || !currentProject) return
    try {
      await contextApi.updateFile(activeFile.id, editedContent, currentProject.id)
      contentCache.current.set(activeFile.id, { content: editedContent, truncated: false })
      setFileContent(editedContent)
      setContentTruncated(false)
      setEditing(false)
      setSaveMessage({ ok: true, text: `Saved ${activeFile.relativePath}` })
      if (isNewFile) {
        setIsNewFile(false)
        await fetchFiles(true, searchQuery)
      }
      setTimeout(() => setSaveMessage(null), 4000)
    } catch (error: any) {
      setSaveMessage({ ok: false, text: error?.message || 'Failed to save file' })
    }
  }

  /**
   * Manda a descrição para o Master Agent, que escreve o arquivo da regra no
   * projeto por conta própria. É assíncrono: nada volta para o editor — a regra
   * aparece na seção Rules depois que o Master terminar (daí o refresh à mão).
   */
  const handleGenerateRule = async () => {
    if (!ruleInput.trim() || !currentProject) return
    setGeneratingRule(true)
    try {
      const { queued, message } = await contextApi.generateRule(ruleInput, currentProject.id)
      if (queued) {
        setSaveMessage({
          ok: true,
          text:
            message ||
            'Pedido enviado ao Master Agent. A regra aparece em Rules quando ele terminar — use Refresh Files.',
        })
        setRuleInput('')
        setShowRulePanel(false)
        setTimeout(() => setSaveMessage(null), 8000)
      } else {
        setSaveMessage({
          ok: false,
          text: message || 'O Master Agent não pôde receber o pedido agora.',
        })
      }
    } catch (error: any) {
      setSaveMessage({ ok: false, text: error?.message || 'Failed to send rule request to the Master' })
    } finally {
      setGeneratingRule(false)
    }
  }

  const runSearch = async () => {
    if (!searchQuery.trim() || !currentProject) return
    setSearching(true)
    try {
      const { results } = await contextApi.search(searchQuery.trim(), currentProject.id)
      setSearchResults(results || [])
    } catch (error) {
      console.error('Search failed:', error)
      setSearchResults([])
    } finally {
      setSearching(false)
    }
  }

  if (!currentProject) {
    return (
      <Shell>
        <div className="flex items-center justify-center h-full">
          <div className="text-sm text-muted-foreground">Create/select a project to see its context</div>
        </div>
      </Shell>
    )
  }

  if (loading) {
    return (
      <Shell>
        <div className="flex items-center justify-center h-full">
          <div className="text-sm text-muted-foreground">Loading context...</div>
        </div>
      </Shell>
    )
  }

  const indexState = qmd ? describeIndex(qmd) : null

  /**
   * Estado do índice sempre visível, sem clique: se a busca semântica é
   * confiável, quando foi o último embed e se há um na fila/rodando. Fica no
   * topo do tree porque é onde o usuário está quando decide em quem confiar.
   */
  const QmdIndexCard = indexState && (
    <div className="p-3 border-b border-border shrink-0 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {indexState.tone === 'ok' ? (
            <Check className="w-3 h-3 text-status-done shrink-0" />
          ) : indexState.tone === 'warn' ? (
            <AlertTriangle className="w-3 h-3 text-status-waiting shrink-0" />
          ) : (
            <X className="w-3 h-3 text-muted-foreground shrink-0" />
          )}
          <span
            className={cn('text-[11px] font-medium truncate', {
              'text-status-done': indexState.tone === 'ok',
              'text-status-waiting': indexState.tone === 'warn',
              'text-muted-foreground': indexState.tone === 'off',
            })}
          >
            {indexState.label}
          </span>
        </div>
        <button
          onClick={runReindex}
          disabled={reindexing || !!qmd?.running}
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors shrink-0"
          title="Queue a qmd embed — it never runs while a session is active"
        >
          <RefreshCw className={cn('w-3 h-3', (reindexing || qmd?.running) && 'animate-spin')} />
          Reindex
        </button>
      </div>
      <p className="text-[10px] text-muted-foreground leading-snug">{indexState.detail}</p>
      {qmd?.running && (
        <p className="text-[10px] text-primary">Embedding now ({qmd.running.reason}) — started {timeAgo(qmd.running.since)}</p>
      )}
      {!qmd?.running && qmd?.queued && (
        <p className="text-[10px] text-status-waiting">
          Embed queued ({qmd.queued.reason}){qmd.activeSessions > 0
            ? ` — waiting for ${qmd.activeSessions} active session(s) to finish`
            : ` — runs at ${new Date(qmd.queued.scheduledAt).toLocaleTimeString()}`}
        </p>
      )}
    </div>
  )

  const FileTree = (
    <>
      {QmdIndexCard}
      <div className="p-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2 bg-input border border-border rounded-md px-2.5 py-1.5 focus-within:border-primary/40 transition-colors">
          <Search className="w-3 h-3 text-muted-foreground shrink-0" />
          <input
            className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none min-w-0"
            placeholder="Filter docs (Enter = deep search)"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value)
              if (!e.target.value) setSearchResults(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') runSearch()
            }}
          />
          {(searching || filtering) && <RefreshCw className="w-3 h-3 text-muted-foreground animate-spin shrink-0" />}
        </div>
        {searchResults !== null && (
          <div className="mt-2 space-y-0.5 max-h-56 overflow-y-auto">
            <div className="flex items-center justify-between px-1">
              <span className="text-[10px] text-muted-foreground">
                {searchResults.length} result{searchResults.length === 1 ? '' : 's'}
              </span>
              <button
                onClick={() => { setSearchResults(null); setSearchQuery('') }}
                className="text-[10px] text-muted-foreground hover:text-foreground"
              >
                clear
              </button>
            </div>
            {searchResults.map((r, i) => (
              <button
                key={`${r.file}-${i}`}
                onClick={() => openFileByPath(r.file)}
                className="w-full text-left px-2 py-1.5 rounded hover:bg-muted/30 transition-colors"
              >
                <span className="text-[11px] font-mono text-primary block truncate">{r.file}</span>
                {r.snippet && (
                  <span className="text-[10px] text-muted-foreground block truncate">{r.snippet}</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto py-1">
        {sections.map((section) => {
          const Icon = section.icon
          const files = contextFiles[section.id] || []
          const open = openSections[section.id]
          return (
            <div key={section.id}>
              <div className="flex items-center w-full hover:bg-muted/20 transition-colors">
                <button
                  onClick={() => toggleSection(section.id)}
                  className="flex items-center gap-2 flex-1 px-3 py-1.5 text-left"
                >
                  {open
                    ? <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
                    : <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
                  }
                  <Icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span className="text-xs text-muted-foreground">{section.label}</span>
                  <span className="text-[10px] font-mono text-muted-foreground/50 ml-auto">{files.length}</span>
                </button>
                {section.id === 'rules' && (
                  <button
                    onClick={() => setShowRulePanel((v) => !v)}
                    className="p-1.5 mr-1.5 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"
                    title="Ask the Master Agent to write a rule"
                  >
                    <Sparkles className="w-3 h-3" />
                  </button>
                )}
              </div>
              {open && files.map((file) => (
                <button
                  key={file.id}
                  onClick={() => openFile(file)}
                  className={cn(
                    'w-full flex items-center gap-2 pl-8 pr-3 py-1.5 hover:bg-muted/20 transition-colors text-left',
                    activeFile?.id === file.id && 'bg-accent/50'
                  )}
                >
                  <FileText className={cn('w-3.5 h-3.5 shrink-0', activeFile?.id === file.id ? 'text-primary' : 'text-muted-foreground/60')} />
                  <span
                    className={cn('text-xs truncate flex-1 font-mono', activeFile?.id === file.id ? 'text-foreground' : 'text-muted-foreground')}
                    title={file.relativePath}
                  >
                    {file.name}
                  </span>
                  <span className={cn('shrink-0', statusColor[file.status])}>
                    {statusIcon[file.status]}
                  </span>
                </button>
              ))}
            </div>
          )
        })}
      </div>
      {showRulePanel && (
        <div className="border-t border-border p-3 shrink-0 space-y-2">
          <div className="flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 text-primary" />
            <span className="text-xs font-semibold text-foreground">Ask the Master to write a rule</span>
          </div>
          <input
            className="w-full bg-input border border-border rounded-md px-2.5 py-2 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/40 transition-colors"
            placeholder={'e.g. "log all API errors to Sentry"'}
            value={ruleInput}
            onChange={(e) => setRuleInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) handleGenerateRule()
            }}
          />
          <div className="flex items-center gap-2">
            <button
              onClick={handleGenerateRule}
              disabled={!ruleInput.trim() || generatingRule}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs bg-primary text-primary-foreground hover:bg-primary/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {generatingRule ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
              {generatingRule ? 'Sending to Master...' : 'Send to Master'}
            </button>
            <button
              onClick={refreshAll}
              title="Refresh files — the rule shows up here once the Master is done"
              className="p-2 rounded-md border border-border text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors shrink-0"
            >
              <RefreshCw className="w-3 h-3" />
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            O pedido vai para o terminal do Master Agent, que escreve o arquivo da regra no projeto. É
            assíncrono: nada abre no editor — a regra aparece em <span className="text-foreground">Rules</span>{' '}
            quando ele terminar (use o refresh).
          </p>
        </div>
      )}
      <div className="border-t border-border p-3 shrink-0">
        <button
          onClick={refreshAll}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md bg-primary/10 border border-primary/20 text-xs text-primary hover:bg-primary/20 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh Files
        </button>
      </div>
    </>
  )

  const emptyState = (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="text-center max-w-md">
        <FolderOpen className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
        {!rootExists ? (
          <>
            <p className="text-sm text-foreground mb-1">Project path not found</p>
            <p className="text-xs text-muted-foreground">
              The project mainPath <span className="font-mono text-destructive">{root}</span> does not
              exist or is not readable. Fix it in Settings → Project.
            </p>
          </>
        ) : totalFiles === 0 ? (
          <>
            <p className="text-sm text-foreground mb-1">No markdown files found</p>
            <p className="text-xs text-muted-foreground">
              No .md/.mdx/.rules files under <span className="font-mono">{root}</span>. Create docs in
              the repository, or generate a rule with the ✨ button in the Rules section.
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Select a file to view</p>
        )}
      </div>
    </div>
  )

  return (
    <Shell>
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <aside className="hidden lg:flex w-72 shrink-0 border-r border-border flex-col min-h-0 bg-card/20">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
            <div className="min-w-0">
              <span className="text-xs font-semibold text-foreground block">Project Context</span>
              <span className="text-[10px] text-muted-foreground font-mono block truncate" title={root}>
                {currentProject.name}
              </span>
            </div>
            <button onClick={refreshAll} className="p-1 rounded hover:bg-primary/5 text-muted-foreground hover:text-primary transition-colors shrink-0" title="Refresh">
              <RefreshCw className="w-3 h-3" />
            </button>
          </div>
          {FileTree}
        </aside>

        {mobileTreeOpen && (
          <div className="lg:hidden fixed inset-0 z-50 flex flex-col justify-end" role="dialog" aria-modal="true">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setMobileTreeOpen(false)} />
            <div className="relative bg-sidebar border-t border-border rounded-t-2xl flex flex-col max-h-[75vh] z-10">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
                <span className="text-xs font-semibold text-foreground">Project Context</span>
                <button onClick={() => setMobileTreeOpen(false)} className="p-1.5 rounded-md hover:bg-muted/40 transition-colors">
                  <X className="w-4 h-4 text-foreground" />
                </button>
              </div>
              {FileTree}
            </div>
          </div>
        )}

        <div className="flex-1 min-w-0 flex flex-col min-h-0">
          {saveMessage && (
            <div className={cn(
              'px-4 lg:px-6 py-2 text-xs border-b',
              saveMessage.ok
                ? 'bg-status-done/10 border-status-done/20 text-status-done'
                : 'bg-destructive/10 border-destructive/30 text-destructive'
            )}>
              {saveMessage.text}
            </div>
          )}
          {!activeFile ? (
            <>
              <header className="flex items-center gap-2 px-4 lg:px-6 py-3 border-b border-border bg-card/40 shrink-0">
                <button
                  onClick={() => setMobileTreeOpen(true)}
                  className="lg:hidden p-1.5 rounded-md border border-border hover:bg-muted/40 transition-colors shrink-0"
                  aria-label="Browse files"
                >
                  <FolderTree className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
                <h1 className="text-sm font-semibold text-foreground">Context</h1>
                <span className="text-[10px] text-muted-foreground font-mono">{totalFiles} files</span>
              </header>
              {emptyState}
            </>
          ) : (
            <>
              <header className="flex items-center justify-between px-4 lg:px-6 py-3 border-b border-border bg-card/40 shrink-0 gap-2">
                <div className="flex items-center gap-2 lg:gap-3 min-w-0">
                  <button
                    onClick={() => setMobileTreeOpen(true)}
                    className="lg:hidden p-1.5 rounded-md border border-border hover:bg-muted/40 transition-colors shrink-0"
                    aria-label="Browse files"
                  >
                    <FolderTree className="w-3.5 h-3.5 text-muted-foreground" />
                  </button>
                  <FileText className="w-4 h-4 text-primary shrink-0 hidden sm:block" />
                  <div className="min-w-0">
                    <h1 className="text-sm font-semibold text-foreground font-mono truncate">
                      {activeFile.relativePath}
                      {isNewFile && <span className="ml-2 text-[10px] text-primary">(new — save to create)</span>}
                    </h1>
                    <p className="text-[11px] text-muted-foreground mt-0.5 hidden sm:block truncate">{activeFile.description}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 lg:gap-2 shrink-0">
                  <div className={cn('hidden sm:flex items-center gap-1.5 text-[10px] font-mono px-2 py-1 rounded border', {
                    'bg-status-done/10 border-status-done/20 text-status-done': activeFile.status === 'updated',
                    'bg-status-waiting/10 border-status-waiting/20 text-status-waiting': activeFile.status === 'stale',
                  })}>
                    {statusIcon[activeFile.status]}
                    {statusLabel[activeFile.status]}
                  </div>
                  <span className="hidden lg:inline text-[10px] text-muted-foreground font-mono">{activeFile.size}</span>
                  <div className="hidden lg:block h-3 w-px bg-border" />
                  {!editing && (
                    <div className="flex items-center gap-0.5 border border-border rounded-md overflow-hidden">
                      <button
                        onClick={() => setViewMode('raw')}
                        className={cn(
                          'flex items-center gap-1 px-2 py-1 text-[10px] transition-colors',
                          viewMode === 'raw' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
                        )}
                        title="Raw"
                      >
                        <Code className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => setViewMode('rendered')}
                        className={cn(
                          'flex items-center gap-1 px-2 py-1 text-[10px] transition-colors',
                          viewMode === 'rendered' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
                        )}
                        title="Rendered"
                      >
                        <Eye className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                  {!editing ? (
                    <button
                      onClick={startEdit}
                      disabled={contentLoading || !!contentError || contentTruncated}
                      title={contentTruncated ? 'File too large to edit safely (content truncated)' : undefined}
                      className="flex items-center gap-1.5 px-2.5 lg:px-3 py-1.5 rounded-md text-xs border border-border hover:bg-muted/40 transition-colors text-foreground disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Edit3 className="w-3 h-3" />
                      <span className="hidden sm:inline">Edit</span>
                    </button>
                  ) : (
                    <>
                      <div className="flex items-center gap-0.5 border border-border rounded-md overflow-hidden">
                        <button
                          onClick={() => setViewMode('raw')}
                          className={cn(
                            'flex items-center gap-1 px-2 py-1 text-[10px] transition-colors',
                            viewMode === 'raw' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
                          )}
                          title="Editor only"
                        >
                          <Code className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => setViewMode('split')}
                          className={cn(
                            'flex items-center gap-1 px-2 py-1 text-[10px] transition-colors',
                            viewMode === 'split' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
                          )}
                          title="Split view"
                        >
                          <Columns className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => setViewMode('rendered')}
                          className={cn(
                            'flex items-center gap-1 px-2 py-1 text-[10px] transition-colors',
                            viewMode === 'rendered' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
                          )}
                          title="Preview only"
                        >
                          <Eye className="w-3 h-3" />
                        </button>
                      </div>
                      <button
                        onClick={saveEdit}
                        className="flex items-center gap-1.5 px-2.5 lg:px-3 py-1.5 rounded-md text-xs bg-primary text-primary-foreground hover:bg-primary/80 transition-colors"
                      >
                        <Save className="w-3 h-3" />
                        <span className="hidden sm:inline">Save</span>
                      </button>
                      <button
                        onClick={() => { setEditing(false); if (isNewFile) { setIsNewFile(false); setActiveFile(allFiles[0] || null) } }}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs border border-border hover:bg-muted/40 transition-colors text-foreground"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </>
                  )}
                </div>
              </header>

              {contentTruncated && !editing && (
                <div className="px-4 lg:px-6 py-1.5 text-[11px] border-b bg-status-waiting/10 border-status-waiting/20 text-status-waiting shrink-0">
                  File is larger than 100 KB — showing a truncated preview (editing disabled).
                </div>
              )}
              <div className="flex-1 min-h-0 overflow-y-auto">
                {!editing && contentLoading ? (
                  <div className="flex items-center justify-center h-full gap-2 text-xs text-muted-foreground">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    Loading {activeFile.name}...
                  </div>
                ) : !editing && contentError ? (
                  <div className="flex flex-col items-center justify-center h-full gap-2 p-6 text-center">
                    <AlertTriangle className="w-5 h-5 text-destructive" />
                    <p className="text-xs text-destructive">{contentError}</p>
                    <button
                      onClick={() => setContentNonce((n) => n + 1)}
                      className="text-[11px] text-muted-foreground hover:text-foreground underline"
                    >
                      retry
                    </button>
                  </div>
                ) : editing && viewMode === 'split' ? (
                  <div className="flex h-full">
                    <div className="flex-1 min-w-0 border-r border-border">
                      <textarea
                        className="w-full h-full bg-transparent text-xs font-mono text-foreground leading-relaxed p-4 lg:p-6 outline-none resize-none"
                        value={editedContent}
                        onChange={(e) => setEditedContent(e.target.value)}
                        spellCheck={false}
                      />
                    </div>
                    <div className="flex-1 min-w-0 overflow-y-auto">
                      <div className="px-4 sm:px-6 lg:px-8 py-4 lg:py-6 max-w-4xl md-rendered">
                        <div dangerouslySetInnerHTML={{ __html: renderMarkdown(editedContent) }} />
                      </div>
                    </div>
                  </div>
                ) : editing ? (
                  <textarea
                    className="w-full h-full bg-transparent text-xs font-mono text-foreground leading-relaxed p-4 lg:p-6 outline-none resize-none"
                    value={editedContent}
                    onChange={(e) => setEditedContent(e.target.value)}
                    spellCheck={false}
                  />
                ) : viewMode === 'rendered' ? (
                  <div className="px-4 sm:px-6 lg:px-8 py-4 lg:py-6 max-w-4xl md-rendered">
                    <div dangerouslySetInnerHTML={{ __html: renderMarkdown(fileContent) }} />
                  </div>
                ) : (
                  <div className="px-4 sm:px-6 lg:px-8 py-4 lg:py-6 max-w-4xl">
                    <pre className="text-xs font-mono text-foreground leading-relaxed whitespace-pre-wrap break-words">
                      {fileContent}
                    </pre>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
      {showDiscardConfirm && (
        <ConfirmModal
          title="Discard Changes"
          message="Discard unsaved changes?"
          confirmLabel="Discard"
          destructive
          onConfirm={confirmDiscard}
          onCancel={() => { setShowDiscardConfirm(false); setPendingFile(null) }}
        />
      )}
    </Shell>
  )
}
