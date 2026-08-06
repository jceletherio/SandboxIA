'use client'

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { projectsApi, type Project } from '@/lib/api'

interface ProjectContextType {
  currentProject: Project | null
  projects: Project[]
  setCurrentProject: (project: Project) => void
  refreshProjects: () => Promise<void>
  loading: boolean
}

const ProjectContext = createContext<ProjectContextType | undefined>(undefined)

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([])
  const [currentProject, setCurrentProjectState] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)

  const refreshProjects = async () => {
    try {
      const data = await projectsApi.list()
      setProjects(data)
      // Updater funcional: evita closure stale de currentProject e restaura o
      // projeto salvo ANTES de defaultar para data[0] (sem flash de projeto errado)
      setCurrentProjectState(prev => {
        if (prev) return data.find(p => p.id === prev.id) ?? data[0] ?? null
        const savedId =
          typeof window !== 'undefined' ? localStorage.getItem('currentProjectId') : null
        return data.find(p => p.id === savedId) ?? data[0] ?? null
      })
    } catch (error) {
      console.error('Failed to fetch projects:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refreshProjects()
  }, [])

  const setCurrentProject = (project: Project) => {
    setCurrentProjectState(project)
    if (typeof window !== 'undefined') {
      localStorage.setItem('currentProjectId', project.id)
    }
  }

  return (
    <ProjectContext.Provider value={{
      currentProject,
      projects,
      setCurrentProject,
      refreshProjects,
      loading
    }}>
      {children}
    </ProjectContext.Provider>
  )
}

export function useProject() {
  const context = useContext(ProjectContext)
  if (context === undefined) {
    throw new Error('useProject must be used within a ProjectProvider')
  }
  return context
}
