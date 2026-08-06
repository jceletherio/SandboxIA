'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { projectsApi } from '@/lib/api'
import { useProject } from '@/lib/project-context'
import { Shell } from '@/components/shell'
import { FolderGit2, ArrowLeft, Star } from 'lucide-react'

export default function NewProjectPage() {
  const router = useRouter()
  const { projects, refreshProjects, setCurrentProject } = useProject()
  const templateCount = projects.filter((p) => p.isTemplate).length
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    repoUrl: '',
    // Sem valor pré-preenchido: o `/tmp/worktrees` que ficava aqui é caminho
    // POSIX e o campo é obrigatório, então no Windows o formulário vinha
    // "válido" e já errado. O erro só aparecia lá na frente, no primeiro
    // estágio da sessão, como "Cannot use simple-git on a directory that does
    // not exist" — longe da causa. Campo vazio força a escolha consciente.
    mainPath: '',
    worktreeBase: ''
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const project = await projectsApi.create(formData)
      await refreshProjects()
      setCurrentProject(project)
      router.push('/')
    } catch (err: any) {
      setError(err.message || 'Failed to create project')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Shell>
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
        <header className="flex items-center gap-4 px-4 lg:px-6 py-3 border-b border-border bg-card/50 sticky top-0 z-10">
          <button
            onClick={() => router.back()}
            className="p-1.5 rounded-md hover:bg-muted/40 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="text-sm font-semibold text-foreground">New Project</h1>
            <p className="text-[11px] text-muted-foreground font-mono mt-0.5">
              Create a new development project
            </p>
          </div>
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto p-4 lg:p-6">
          <form onSubmit={handleSubmit} className="max-w-2xl space-y-6">
            {error && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-xs text-destructive">
                {error}
              </div>
            )}

            {templateCount > 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-4 py-3">
                <Star className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                <p className="text-[11px] text-muted-foreground">
                  {templateCount} project{templateCount === 1 ? '' : 's'} marked as template.{' '}
                  <Link href="/projects" className="text-primary hover:underline">
                    Create from a template
                  </Link>{' '}
                  to copy pipelines, agents and MCP links instead of configuring from scratch.
                </p>
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-1 block">
                  Project Name *
                </label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full bg-input rounded-md px-3 py-2 text-xs text-foreground outline-none border border-border focus:border-primary/50 transition-colors"
                  placeholder="my-awesome-project"
                />
              </div>

              <div>
                <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-1 block">
                  Description
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={3}
                  className="w-full bg-input rounded-md px-3 py-2 text-xs text-foreground outline-none border border-border focus:border-primary/50 transition-colors resize-none"
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
                  value={formData.repoUrl}
                  onChange={(e) => setFormData({ ...formData, repoUrl: e.target.value })}
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
                  value={formData.mainPath}
                  onChange={(e) => setFormData({ ...formData, mainPath: e.target.value })}
                  className="w-full bg-input rounded-md px-3 py-2 text-xs text-foreground font-mono outline-none border border-border focus:border-primary/50 transition-colors"
                  placeholder="C:\caminho\para\meu-repo (precisa ter .git)"
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  Absolute path to the main repository on your system
                </p>
              </div>

              <div>
                <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-1 block">
                  Worktree Base *
                </label>
                <input
                  type="text"
                  required
                  value={formData.worktreeBase}
                  onChange={(e) => setFormData({ ...formData, worktreeBase: e.target.value })}
                  className="w-full bg-input rounded-md px-3 py-2 text-xs text-foreground font-mono outline-none border border-border focus:border-primary/50 transition-colors"
                  placeholder="C:\caminho\para\.worktrees"
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  Directory where git worktrees will be created for sessions —
                  use an absolute path for this machine
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 pt-4">
              <button
                type="submit"
                disabled={loading}
                className="flex items-center gap-1.5 px-4 py-2 rounded-md text-xs bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
              >
                <FolderGit2 className="w-3.5 h-3.5" />
                {loading ? 'Creating...' : 'Create Project'}
              </button>
              <button
                type="button"
                onClick={() => router.back()}
                className="px-4 py-2 rounded-md text-xs border border-border hover:bg-muted/40 transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>
    </Shell>
  )
}
