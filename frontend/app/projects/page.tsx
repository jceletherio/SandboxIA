'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Shell } from '@/components/shell'
import { ConfirmModal } from '@/components/confirm-modal'
import { projectsApi, type Project } from '@/lib/api'
import { useProject } from '@/lib/project-context'
import { cn } from '@/lib/utils'
import {
  FolderGit2,
  Plus,
  Check,
  Trash2,
  GitBranch,
  ListTodo,
  Layers,
  AlertCircle,
  Star,
  StarOff,
  CopyPlus,
  X,
  CheckCircle2,
} from 'lucide-react'

const EMPTY_CLONE_FORM = {
  name: '',
  description: '',
  repoUrl: '',
  mainPath: '',
  worktreeBase: '/tmp/worktrees',
}

export default function ProjectsPage() {
  const router = useRouter()
  const { currentProject, projects, setCurrentProject, refreshProjects, loading } = useProject()
  const [deleting, setDeleting] = useState<Project | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [togglingTemplate, setTogglingTemplate] = useState<string | null>(null)
  const [cloneSource, setCloneSource] = useState<Project | null>(null)
  const [cloneForm, setCloneForm] = useState({ ...EMPTY_CLONE_FORM })
  const [cloning, setCloning] = useState(false)
  const [cloneError, setCloneError] = useState<string | null>(null)

  async function confirmDelete() {
    if (!deleting) return
    try {
      await projectsApi.delete(deleting.id)
      await refreshProjects()
      setDeleting(null)
    } catch (err: any) {
      setError(err?.message || 'Failed to delete project')
      setDeleting(null)
    }
  }

  function selectAndGo(project: Project) {
    setCurrentProject(project)
    router.push('/')
  }

  async function toggleTemplate(project: Project) {
    setError(null)
    setSuccess(null)
    setTogglingTemplate(project.id)
    try {
      await projectsApi.update(project.id, { isTemplate: !project.isTemplate })
      await refreshProjects()
      setSuccess(
        project.isTemplate
          ? `"${project.name}" is no longer a template`
          : `"${project.name}" is now a template`,
      )
    } catch (err: any) {
      setError(err?.message || 'Failed to update project')
    } finally {
      setTogglingTemplate(null)
    }
  }

  function openCloneForm(project: Project) {
    setError(null)
    setSuccess(null)
    setCloneError(null)
    setCloneForm({ ...EMPTY_CLONE_FORM, name: `${project.name}-copy` })
    setCloneSource(project)
  }

  async function submitClone(e: React.FormEvent) {
    e.preventDefault()
    if (!cloneSource) return
    setCloning(true)
    setCloneError(null)
    try {
      const result = await projectsApi.cloneFromTemplate(cloneSource.id, {
        name: cloneForm.name.trim(),
        repoUrl: cloneForm.repoUrl.trim(),
        mainPath: cloneForm.mainPath.trim(),
        worktreeBase: cloneForm.worktreeBase.trim(),
        description: cloneForm.description.trim() || undefined,
      })
      await refreshProjects()
      const { pipelines, agents, mcpLinks } = result.cloned
      setSuccess(
        `Created "${result.project.name}" from template "${result.templateName}" — ` +
          `${pipelines} pipeline${pipelines === 1 ? '' : 's'}, ` +
          `${agents} agent${agents === 1 ? '' : 's'}, ` +
          `${mcpLinks} MCP link${mcpLinks === 1 ? '' : 's'} copied.` +
          (result.warnings?.length ? ` (${result.warnings.join(' ')})` : ''),
      )
      setCloneSource(null)
      setCloneForm({ ...EMPTY_CLONE_FORM })
    } catch (err: any) {
      setCloneError(err?.message || 'Failed to create project from template')
    } finally {
      setCloning(false)
    }
  }

  return (
    <Shell>
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
        <header className="flex items-center justify-between px-4 lg:px-6 py-3 border-b border-border bg-card/50 sticky top-0 z-10">
          <div>
            <h1 className="text-sm font-semibold text-foreground">Projects</h1>
            <p className="text-[11px] text-muted-foreground font-mono mt-0.5">
              {projects.length} project{projects.length === 1 ? '' : 's'} registered
            </p>
          </div>
          <Link
            href="/projects/new"
            className="flex items-center gap-1.5 px-3 py-2 rounded-md text-xs bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            New Project
          </Link>
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto p-4 lg:p-6">
          {error && (
            <div className="flex items-start gap-2 p-3 mb-4 rounded-md bg-destructive/10 border border-destructive/30">
              <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
              <p className="text-xs text-destructive">{error}</p>
            </div>
          )}

          {success && (
            <div className="flex items-start gap-2 p-3 mb-4 rounded-md bg-primary/10 border border-primary/30">
              <CheckCircle2 className="w-4 h-4 text-primary shrink-0 mt-0.5" />
              <p className="text-xs text-primary flex-1">{success}</p>
              <button
                onClick={() => setSuccess(null)}
                className="text-primary/70 hover:text-primary transition-colors"
                title="Dismiss"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="rounded-lg border border-border bg-card h-40 animate-pulse" />
              ))}
            </div>
          ) : projects.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <FolderGit2 className="w-10 h-10 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">No projects yet</p>
              <p className="text-xs text-muted-foreground/70 max-w-sm text-center">
                Register a project pointing to a local git repository so the orchestrator can create
                worktrees and run coding sessions on it.
              </p>
              <Link
                href="/projects/new"
                className="mt-2 flex items-center gap-1.5 px-4 py-2 rounded-md text-xs bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Create your first project
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {projects.map((project) => {
                const isCurrent = currentProject?.id === project.id
                return (
                  <div
                    key={project.id}
                    className={cn(
                      'rounded-lg border bg-card overflow-hidden flex flex-col transition-colors',
                      isCurrent ? 'border-primary/40' : 'border-border hover:border-primary/25',
                    )}
                  >
                    <div className="flex items-start justify-between px-4 py-3 border-b border-border/60">
                      <div className="flex items-center gap-2 min-w-0">
                        <FolderGit2 className={cn('w-4 h-4 shrink-0', isCurrent ? 'text-primary' : 'text-muted-foreground')} />
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-foreground truncate">{project.name}</p>
                          {project.description && (
                            <p className="text-[10px] text-muted-foreground truncate mt-0.5">{project.description}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {project.isTemplate && (
                          <span className="flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 border border-amber-500/20">
                            <Star className="w-2.5 h-2.5" />
                            TEMPLATE
                          </span>
                        )}
                        {isCurrent && (
                          <span className="flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
                            <Check className="w-2.5 h-2.5" />
                            CURRENT
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="px-4 py-3 space-y-1.5 flex-1">
                      <p className="text-[10px] font-mono text-muted-foreground truncate" title={project.mainPath}>
                        <GitBranch className="w-3 h-3 inline mr-1.5 -mt-0.5" />
                        {project.mainPath}
                      </p>
                      <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Layers className="w-3 h-3" />
                          {project.pipelines?.length ?? 0} pipelines
                        </span>
                        <span className="flex items-center gap-1">
                          <ListTodo className="w-3 h-3" />
                          {project.macroTasks?.length ?? 0} tasks
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 px-4 py-2.5 border-t border-border/60 bg-muted/10">
                      <button
                        onClick={() => selectAndGo(project)}
                        className={cn(
                          'flex-1 px-2.5 py-1.5 rounded-md text-[11px] transition-colors',
                          isCurrent
                            ? 'bg-muted/40 text-muted-foreground cursor-default'
                            : 'bg-primary text-primary-foreground hover:bg-primary/90',
                        )}
                        disabled={isCurrent}
                      >
                        {isCurrent ? 'Selected' : 'Select & open'}
                      </button>
                      <Link
                        href="/settings"
                        onClick={() => setCurrentProject(project)}
                        className="px-2.5 py-1.5 rounded-md text-[11px] border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                      >
                        Settings
                      </Link>
                      <button
                        onClick={() => setDeleting(project)}
                        className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        title="Delete project"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="flex items-center gap-2 px-4 py-2 border-t border-border/60 bg-muted/5">
                      <button
                        onClick={() => toggleTemplate(project)}
                        disabled={togglingTemplate === project.id}
                        className={cn(
                          'flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] border transition-colors disabled:opacity-50',
                          project.isTemplate
                            ? 'border-amber-500/30 text-amber-500 hover:bg-amber-500/10'
                            : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted/40',
                        )}
                        title={
                          project.isTemplate
                            ? 'Stop using this project as a template'
                            : 'Mark this project as a configuration template'
                        }
                      >
                        {project.isTemplate ? (
                          <StarOff className="w-3 h-3" />
                        ) : (
                          <Star className="w-3 h-3" />
                        )}
                        {togglingTemplate === project.id
                          ? '...'
                          : project.isTemplate
                            ? 'Remove from templates'
                            : 'Use as template'}
                      </button>
                      {project.isTemplate && (
                        <button
                          onClick={() => openCloneForm(project)}
                          className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] border border-primary/30 text-primary hover:bg-primary/10 transition-colors"
                          title="Create a new project copying this template's configuration"
                        >
                          <CopyPlus className="w-3 h-3" />
                          Create from this template
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {cloneSource && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => !cloning && setCloneSource(null)}
        >
          <form
            onSubmit={submitClone}
            className="w-full max-w-md rounded-lg border border-border bg-card shadow-xl max-h-full overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-border">
              <div className="flex items-center gap-2">
                <CopyPlus className="w-4 h-4 text-primary" />
                <h2 className="text-sm font-semibold text-foreground">New project from template</h2>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                Copies configuration from{' '}
                <span className="font-mono text-foreground">{cloneSource.name}</span> — pipelines,
                agents (keeping their CLI profile) and MCP links. Sessions, macro tasks and history
                are not copied.
              </p>
            </div>

            <div className="px-5 py-4 space-y-3">
              {cloneError && (
                <div className="flex items-start gap-2 p-2.5 rounded-md bg-destructive/10 border border-destructive/30">
                  <AlertCircle className="w-3.5 h-3.5 text-destructive shrink-0 mt-0.5" />
                  <p className="text-[11px] text-destructive">{cloneError}</p>
                </div>
              )}

              <div>
                <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-1 block">
                  Project Name *
                </label>
                <input
                  type="text"
                  required
                  value={cloneForm.name}
                  onChange={(e) => setCloneForm({ ...cloneForm, name: e.target.value })}
                  className="w-full bg-input rounded-md px-3 py-2 text-xs text-foreground outline-none border border-border focus:border-primary/50 transition-colors"
                  placeholder="my-awesome-project"
                />
              </div>

              <div>
                <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-1 block">
                  Description
                </label>
                <input
                  type="text"
                  value={cloneForm.description}
                  onChange={(e) => setCloneForm({ ...cloneForm, description: e.target.value })}
                  className="w-full bg-input rounded-md px-3 py-2 text-xs text-foreground outline-none border border-border focus:border-primary/50 transition-colors"
                  placeholder="A brief description of the project..."
                />
              </div>

              <div>
                <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-1 block">
                  Repository URL *
                </label>
                <input
                  type="text"
                  required
                  value={cloneForm.repoUrl}
                  onChange={(e) => setCloneForm({ ...cloneForm, repoUrl: e.target.value })}
                  className="w-full bg-input rounded-md px-3 py-2 text-xs text-foreground font-mono outline-none border border-border focus:border-primary/50 transition-colors"
                  placeholder="https://github.com/user/repo.git"
                />
              </div>

              <div>
                <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-1 block">
                  Main Path *
                </label>
                <input
                  type="text"
                  required
                  value={cloneForm.mainPath}
                  onChange={(e) => setCloneForm({ ...cloneForm, mainPath: e.target.value })}
                  className="w-full bg-input rounded-md px-3 py-2 text-xs text-foreground font-mono outline-none border border-border focus:border-primary/50 transition-colors"
                  placeholder="/home/user/projects/my-repo"
                />
              </div>

              <div>
                <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-1 block">
                  Worktree Base *
                </label>
                <input
                  type="text"
                  required
                  value={cloneForm.worktreeBase}
                  onChange={(e) => setCloneForm({ ...cloneForm, worktreeBase: e.target.value })}
                  className="w-full bg-input rounded-md px-3 py-2 text-xs text-foreground font-mono outline-none border border-border focus:border-primary/50 transition-colors"
                  placeholder="/tmp/worktrees"
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  Paths are never inherited from the template — the new project needs its own.
                </p>
              </div>
            </div>

            <div className="px-5 py-3 border-t border-border flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCloneSource(null)}
                disabled={cloning}
                className="text-[11px] text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-md transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={cloning}
                className="text-[11px] px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {cloning ? 'Creating...' : 'Create project'}
              </button>
            </div>
          </form>
        </div>
      )}

      {deleting && (
        <ConfirmModal
          title="Delete Project"
          message={`Delete project "${deleting.name}"? Macro tasks, pipelines and sessions of this project will be removed from the orchestrator (the git repository on disk is NOT touched).`}
          confirmLabel="Delete"
          destructive
          onConfirm={confirmDelete}
          onCancel={() => setDeleting(null)}
        />
      )}
    </Shell>
  )
}
