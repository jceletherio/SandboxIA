'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useProject } from '@/lib/project-context'
import {
  macroTasksApi,
  sessionsApi,
  questionsGlobalApi,
  pipelinesApi,
  cliFilesApi,
  cliSkillsApi,
  mcpsApi,
  scheduledJobsApi,
  modelsApi,
  type CliFileProjectListing,
  type SkillProjectListing,
} from '@/lib/api'

/** Status em que a sessão ainda está de pé — o alerta de travada só vale nesses. */
const LIVE_STATUSES = ['initializing', 'running', 'waiting', 'paused']

export type NavCounts = Record<string, number>

/**
 * Contadores dos badges da navegação. Vive num provider, e não dentro da
 * `Sidebar`, porque agora há DOIS consumidores — a sidebar do desktop e a barra
 * inferior do mobile. Cada um com seu próprio `useEffect` faria as mesmas 9
 * chamadas duplicadas a cada 15s.
 */
const NavCountsContext = createContext<NavCounts>({})

export function useNavCounts(): NavCounts {
  return useContext(NavCountsContext)
}

export function NavCountsProvider({ children }: { children: ReactNode }) {
  const [counts, setCounts] = useState<NavCounts>({})
  const { currentProject } = useProject()

  useEffect(() => {
    if (!currentProject) return
    const projectId = currentProject.id

    async function fetchCounts() {
      try {
        const [pipelines, macroTasks, sessions, skillsListing, mcps, jobs, agentFiles, pendingQs, models] = await Promise.all([
          pipelinesApi.list(projectId),
          macroTasksApi.list(projectId),
          sessionsApi.list({ projectId }),
          cliSkillsApi.list(projectId).catch((): SkillProjectListing => ({ root: '', targets: [] })),
          mcpsApi.list(),
          scheduledJobsApi.list(),
          cliFilesApi.list(projectId, 'agents').catch((): CliFileProjectListing => ({ kind: 'agents', root: '', targets: [] })),
          questionsGlobalApi.list({ status: 'pending', projectId }),
          modelsApi.list(),
        ])

        setCounts({
          pipelines: pipelines.length,
          macroTasks: macroTasks.data.length,
          sessions: sessions.filter((s: any) => s.status === 'running').length,
          // `stalledAt` vem do mesmo GET que já é feito aqui: nenhum request
          // novo. Só sessão viva conta — o campo não é limpo quando a sessão
          // termina, então contar tudo deixaria o alerta âmbar aceso para sempre
          // por causa de uma sessão que já morreu há dias.
          stalledSessions: sessions.filter(
            (s: any) => s.stalledAt && LIVE_STATUSES.includes(s.status)
          ).length,
          questions: pendingQs.length,
          scheduler: jobs.filter((j: any) => j.status === 'pending' || j.status === 'running').length,
          // arquivos .md de agentes e pastas de skills reais no repo do projeto
          agents: agentFiles.targets.reduce((sum, t) => sum + t.files.length, 0),
          skills: skillsListing.targets.reduce((sum, t) => sum + t.skills.length, 0),
          mcps: mcps.length,
          models: models.length,
        })
      } catch (error) {
        console.error('Failed to fetch nav counts:', error)
      }
    }

    fetchCounts()
    const interval = setInterval(fetchCounts, 15000)
    return () => clearInterval(interval)
  }, [currentProject])

  return <NavCountsContext.Provider value={counts}>{children}</NavCountsContext.Provider>
}
