'use client'

import { Shell } from '@/components/shell'
import { ConfirmModal } from '@/components/confirm-modal'
import { gitApi, sessionsApi, type GitOverview, type GitBranchInfo, type Session } from '@/lib/api'
import { useProject } from '@/lib/project-context'
import { useGlobalSSE, type SseEvent } from '@/lib/use-sse'
import { cn } from '@/lib/utils'
import {
  GitBranch,
  GitMerge,
  GitCommitHorizontal,
  FolderGit2,
  RefreshCw,
  Trash2,
  AlertTriangle,
  FileDiff,
  X,
  FolderOpen,
} from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type BranchFilter = 'todas' | 'ativas' | 'merged'

type GitDiff = Awaited<ReturnType<typeof gitApi.diff>>

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr)
  if (isNaN(date.getTime())) return dateStr
  const diffMs = Date.now() - date.getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'agora'
  if (mins < 60) return `${mins}m atrás`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h atrás`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d atrás`
  return date.toLocaleDateString()
}

function diffStatusColor(status: string): string {
  const s = status.charAt(0).toUpperCase()
  if (s === 'A') return 'text-status-done'
  if (s === 'M') return 'text-status-waiting'
  if (s === 'D') return 'text-destructive'
  return 'text-muted-foreground'
}

export default function GitPage() {
  const { currentProject } = useProject()
  const [overview, setOverview] = useState<GitOverview | null>(null)
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [branchFilter, setBranchFilter] = useState<BranchFilter>('todas')

  // Diff viewer
  const [diffBranch, setDiffBranch] = useState<string | null>(null)
  const [diff, setDiff] = useState<GitDiff | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  const [diffError, setDiffError] = useState<string | null>(null)

  // Cleanup de sessões antigas
  const [cleanupOpen, setCleanupOpen] = useState(false)
  const [cleaning, setCleaning] = useState(false)

  const fetchData = useCallback(async (manual = false) => {
    if (!currentProject) {
      // sem projeto: não fica preso em "Loading..."
      setOverview(null)
      setSessions([])
      setLoading(false)
      return
    }
    if (manual) setRefreshing(true)
    try {
      const [ov, sess] = await Promise.all([
        gitApi.overview(currentProject.id),
        sessionsApi.list({ projectId: currentProject.id }).catch(() => [] as Session[]),
      ])
      setOverview(ov)
      setSessions(Array.isArray(sess) ? sess : [])
      setError(null)
    } catch (err: any) {
      setError(err?.message || 'Falha ao carregar dados git')
    } finally {
      setLoading(false)
      if (manual) setRefreshing(false)
    }
  }, [currentProject])

  useEffect(() => {
    setLoading(true)
    fetchData()
  }, [fetchData])

  // Auto-refresh via SSE (substitui o antigo poll de 30s): o backend publica
  // `git:changed` em merge/commit/worktree criado|removido. Debounce curto para
  // colapsar rajadas (ex.: vários commits seguidos) em um único refetch.
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
      refreshTimer.current = null
    }
  }, [])

  const handleSseEvent = useCallback(
    (event: SseEvent) => {
      if (event.type !== 'git:changed') return
      const eventProjectId = event.data?.projectId
      if (eventProjectId && currentProject && eventProjectId !== currentProject.id) return
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
      refreshTimer.current = setTimeout(() => {
        refreshTimer.current = null
        fetchData()
      }, 500)
    },
    [currentProject, fetchData]
  )

  useGlobalSSE(handleSseEvent, !!currentProject, currentProject?.id)

  const filteredBranches = useMemo(() => {
    if (!overview) return []
    if (branchFilter === 'ativas') return overview.branches.filter(b => !b.merged)
    if (branchFilter === 'merged') return overview.branches.filter(b => b.merged)
    return overview.branches
  }, [overview, branchFilter])

  const sessionByWorktree = useMemo(() => {
    const map = new Map<string, Session>()
    for (const s of sessions) {
      if (s.worktreePath) map.set(s.worktreePath, s)
    }
    return map
  }, [sessions])

  const orphanSessions = useMemo(
    () => sessions.filter(s => s.status === 'failed' || s.status === 'killed'),
    [sessions]
  )

  const openDiff = useCallback(async (branch: GitBranchInfo) => {
    if (!currentProject) return
    if (branch.merged || (overview && branch.name === overview.mainBranch)) return
    setDiffBranch(branch.name)
    setDiff(null)
    setDiffError(null)
    setDiffLoading(true)
    try {
      const result = await gitApi.diff(currentProject.id, branch.name)
      setDiff(result)
    } catch (err: any) {
      setDiffError(err?.message || 'Falha ao carregar diff')
    } finally {
      setDiffLoading(false)
    }
  }, [currentProject, overview])

  const closeDiff = () => {
    setDiffBranch(null)
    setDiff(null)
    setDiffError(null)
  }

  const confirmCleanup = async () => {
    setCleaning(true)
    try {
      for (const s of orphanSessions) {
        await sessionsApi.delete(s.id)
      }
      await fetchData()
    } catch (err) {
      console.error('Cleanup failed:', err)
    } finally {
      setCleaning(false)
      setCleanupOpen(false)
    }
  }

  if (!currentProject) {
    return (
      <Shell>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-3">
            <FolderGit2 className="w-8 h-8 text-muted-foreground mx-auto" />
            <p className="text-sm font-medium text-foreground">Nenhum projeto selecionado</p>
            <p className="text-xs text-muted-foreground">Selecione um projeto para ver o estado real do repositório git.</p>
            <Link
              href="/projects"
              className="inline-flex items-center gap-1.5 text-[11px] bg-primary text-primary-foreground px-3 py-1.5 rounded-md hover:bg-primary/90 transition-colors"
            >
              <FolderOpen className="w-3 h-3" />
              Ir para Projetos
            </Link>
          </div>
        </div>
      </Shell>
    )
  }

  if (loading) {
    return (
      <Shell>
        <div className="flex items-center justify-center h-full">
          <div className="text-sm text-muted-foreground">Loading git data...</div>
        </div>
      </Shell>
    )
  }

  return (
    <Shell>
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
        <header className="flex items-center justify-between gap-4 px-4 lg:px-6 py-3 border-b border-border bg-card/50 sticky top-0 z-10">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-semibold text-foreground">Git</h1>
              {overview && (
                <>
                  <span className="flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded bg-primary/15 text-primary">
                    <GitBranch className="w-3 h-3" />
                    {overview.currentBranch}
                  </span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                    main: {overview.mainBranch}
                  </span>
                </>
              )}
            </div>
            {overview && (
              <p className="text-[11px] text-muted-foreground font-mono mt-0.5 truncate">
                {overview.repoPath}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setCleanupOpen(true)}
              disabled={cleaning || orphanSessions.length === 0}
              title={orphanSessions.length === 0 ? 'Nenhuma sessão failed/killed para limpar' : undefined}
              className="flex items-center gap-1.5 text-[10px] font-mono px-2 py-1 rounded border border-border hover:bg-muted/40 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            >
              <Trash2 className="w-3 h-3" />
              {cleaning ? 'Cleaning...' : `Clean up${orphanSessions.length > 0 ? ` (${orphanSessions.length})` : ''}`}
            </button>
            <button
              onClick={() => fetchData(true)}
              disabled={refreshing}
              className="flex items-center gap-1.5 text-[10px] font-mono px-2 py-1 rounded border border-border hover:bg-muted/40 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            >
              <RefreshCw className={cn('w-3 h-3', refreshing && 'animate-spin')} />
              Refresh
            </button>
          </div>
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto p-4 lg:p-6 space-y-6">
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3">
              <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-medium text-destructive">Erro ao consultar o repositório git</p>
                <p className="text-[11px] text-destructive/80 font-mono mt-0.5">{error}</p>
              </div>
            </div>
          )}

          {/* Branches */}
          <div>
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h2 className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">Branches</h2>
              <div className="flex items-center gap-1">
                {(['todas', 'ativas', 'merged'] as BranchFilter[]).map(f => (
                  <button
                    key={f}
                    onClick={() => setBranchFilter(f)}
                    className={cn(
                      'text-[10px] font-mono px-2 py-1 rounded transition-colors',
                      branchFilter === f
                        ? 'bg-primary/15 text-primary'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
                    )}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>
            <div className="rounded-lg border border-border bg-card overflow-hidden">
              <div className="divide-y divide-border/50">
                {filteredBranches.map(branch => {
                  const isMain = overview ? branch.name === overview.mainBranch : false
                  const clickable = !branch.merged && !isMain
                  return (
                    <div
                      key={branch.name}
                      onClick={() => clickable && openDiff(branch)}
                      className={cn(
                        'flex items-center gap-3 px-4 py-3 transition-colors',
                        clickable && 'cursor-pointer hover:bg-muted/20'
                      )}
                    >
                      <GitBranch className={cn('w-3.5 h-3.5 shrink-0', branch.current ? 'text-primary' : 'text-muted-foreground')} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-mono text-foreground truncate">{branch.name}</span>
                          {branch.current && (
                            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-primary/15 text-primary">CURRENT</span>
                          )}
                          {branch.merged && (
                            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-status-done/15 text-status-done">MERGED</span>
                          )}
                          {branch.aheadBehind && (
                            <span className="text-[10px] font-mono text-muted-foreground">
                              <span className={cn(branch.aheadBehind.ahead > 0 && 'text-status-done')}>↑{branch.aheadBehind.ahead}</span>
                              {' '}
                              <span className={cn(branch.aheadBehind.behind > 0 && 'text-status-waiting')}>↓{branch.aheadBehind.behind}</span>
                            </span>
                          )}
                        </div>
                        {branch.lastCommit && (
                          <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
                            <span className="text-[10px] font-mono text-primary shrink-0">{branch.lastCommit.hash}</span>
                            <span className="text-[10px] text-muted-foreground truncate">{branch.lastCommit.message}</span>
                            <span className="text-[10px] text-muted-foreground shrink-0">·</span>
                            <span className="text-[10px] text-muted-foreground shrink-0">{branch.lastCommit.author}</span>
                            <span className="text-[10px] text-muted-foreground shrink-0">·</span>
                            <span className="text-[10px] text-muted-foreground shrink-0">{formatRelativeDate(branch.lastCommit.date)}</span>
                          </div>
                        )}
                      </div>
                      {clickable && (
                        <FileDiff className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      )}
                    </div>
                  )
                })}
                {filteredBranches.length === 0 && (
                  <div className="px-4 py-6 text-center text-[10px] text-muted-foreground">
                    {overview ? `Nenhuma branch ${branchFilter === 'todas' ? '' : branchFilter} encontrada` : 'Sem dados do repositório'}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Worktrees */}
          <div>
            <h2 className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-3">Worktrees</h2>
            <div className="rounded-lg border border-border bg-card overflow-hidden">
              <div className="divide-y divide-border/50">
                {(overview?.worktrees || []).map(wt => {
                  const session = sessionByWorktree.get(wt.worktree)
                  return (
                    <div key={wt.worktree} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/20 transition-colors">
                      <FolderGit2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-xs font-mono text-foreground truncate">{wt.worktree}</span>
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          {wt.branch && (
                            <>
                              <GitBranch className="w-3 h-3 text-muted-foreground shrink-0" />
                              <span className="text-[10px] font-mono text-muted-foreground truncate">{wt.branch.replace('refs/heads/', '')}</span>
                            </>
                          )}
                          {wt.HEAD && (
                            <>
                              <span className="text-[10px] text-muted-foreground">·</span>
                              <span className="text-[10px] font-mono text-primary">{wt.HEAD.slice(0, 7)}</span>
                            </>
                          )}
                        </div>
                      </div>
                      {session ? (
                        <div className="flex items-center gap-2 shrink-0">
                          <div className={cn(
                            'w-1.5 h-1.5 rounded-full',
                            session.status === 'running' ? 'bg-status-running animate-pulse' :
                            session.status === 'waiting' ? 'bg-status-waiting' :
                            'bg-muted-foreground/40'
                          )} />
                          <span className="text-[10px] font-mono text-muted-foreground">
                            sessão {session.id.slice(0, 8)} · {session.status}
                          </span>
                        </div>
                      ) : (
                        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
                          SEM SESSÃO
                        </span>
                      )}
                    </div>
                  )
                })}
                {(!overview || overview.worktrees.length === 0) && (
                  <div className="px-4 py-6 text-center text-[10px] text-muted-foreground">Nenhuma worktree encontrada</div>
                )}
              </div>
            </div>
          </div>

          {/* Histórico de Merges */}
          <div>
            <h2 className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-3">Histórico de Merges</h2>
            <div className="rounded-lg border border-border bg-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="border-b border-border bg-muted/20">
                    <tr>
                      <th className="px-4 py-2 text-[10px] font-mono text-muted-foreground">Hash</th>
                      <th className="px-4 py-2 text-[10px] font-mono text-muted-foreground">Mensagem</th>
                      <th className="px-4 py-2 text-[10px] font-mono text-muted-foreground">Autor</th>
                      <th className="px-4 py-2 text-[10px] font-mono text-muted-foreground">Data</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {(overview?.recentMerges || []).map(merge => (
                      <tr key={merge.hash} className="hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <GitMerge className="w-3 h-3 text-muted-foreground shrink-0" />
                            <span className="text-[10px] font-mono text-primary">{merge.hash}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-[10px] text-foreground truncate max-w-[320px]">{merge.message}</td>
                        <td className="px-4 py-2.5 text-[10px] text-muted-foreground whitespace-nowrap">{merge.author}</td>
                        <td className="px-4 py-2.5 text-[10px] font-mono text-muted-foreground whitespace-nowrap">
                          {formatRelativeDate(merge.date)}
                        </td>
                      </tr>
                    ))}
                    {(!overview || overview.recentMerges.length === 0) && (
                      <tr>
                        <td colSpan={4} className="px-4 py-6 text-center text-[10px] text-muted-foreground">
                          Nenhum merge encontrado no histórico
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Diff viewer */}
      {diffBranch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={closeDiff}>
          <div
            className="w-full max-w-2xl max-h-[80vh] flex flex-col rounded-lg border border-border bg-card shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <FileDiff className="w-4 h-4 text-primary shrink-0" />
                  <h2 className="text-sm font-semibold text-foreground truncate">{diffBranch}</h2>
                </div>
                {diff && (
                  <p className="text-[11px] text-muted-foreground font-mono mt-0.5">
                    diff vs {diff.base}{diff.shortstat ? ` · ${diff.shortstat.trim()}` : ''}
                  </p>
                )}
              </div>
              <button onClick={closeDiff} className="text-muted-foreground hover:text-foreground transition-colors shrink-0">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto">
              {diffLoading && (
                <div className="px-6 py-8 text-center text-[10px] text-muted-foreground">Carregando diff...</div>
              )}
              {diffError && (
                <div className="flex items-start gap-2 m-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3">
                  <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                  <p className="text-[11px] text-destructive/80 font-mono">{diffError}</p>
                </div>
              )}
              {diff && !diffLoading && (
                <div className="divide-y divide-border/50">
                  {diff.files.map(file => (
                    <div key={`${file.status}-${file.path}`} className="flex items-center gap-3 px-6 py-2">
                      <span className={cn('text-[10px] font-mono font-semibold w-4 shrink-0', diffStatusColor(file.status))}>
                        {file.status.charAt(0).toUpperCase()}
                      </span>
                      <span className="text-[11px] font-mono text-foreground truncate">{file.path}</span>
                    </div>
                  ))}
                  {diff.files.length === 0 && (
                    <div className="px-6 py-8 text-center text-[10px] text-muted-foreground">
                      Nenhuma diferença em relação a {diff.base}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {cleanupOpen && (
        <ConfirmModal
          title="Clean up de sessões"
          message={`Remover ${orphanSessions.length} sessão(ões) failed/killed e suas worktrees órfãs?`}
          confirmLabel="Remover"
          destructive
          loading={cleaning}
          onConfirm={confirmCleanup}
          onCancel={() => setCleanupOpen(false)}
        />
      )}
    </Shell>
  )
}
