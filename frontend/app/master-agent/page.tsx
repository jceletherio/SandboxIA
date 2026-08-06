'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Shell } from '@/components/shell'
import { MasterActivityFeed } from '@/components/master-activity-feed'
import { cn } from '@/lib/utils'
import { useProject } from '@/lib/project-context'
import { useGlobalSSE, type SseEvent } from '@/lib/use-sse'
import {
  masterAgentApi,
  cliProfilesApi,
  projectsApi,
  sessionsApi,
  questionsGlobalApi,
  type MasterAgentStats,
  type Decision,
  type ActiveTask,
  type CliProfile,
  type MasterScheduling,
  type MasterSchedulingFields,
  type MasterSchedulingSaveResult,
  type MasterChatSession,
  type Question,
} from '@/lib/api'
import { type ChatMessageView } from '@/components/chat'
import {
  MasterChatPanel,
  MasterStatusPanel,
  MasterKpiStrip,
  MasterLiveSessions,
  MasterPendingQuestions,
  MasterSection,
  MasterTabBar,
  MasterSchedulingCard,
  MasterDecisionsPanel,
  MasterQuickActions,
  MasterActiveTasks,
  isLiveSession,
  toLiveSessionView,
  type MasterStatusInfo,
  type LiveSessionView,
  type MasterTabItem,
} from '@/components/master-agent'
import { Activity, Bot, CalendarClock, ChevronRight, LayoutList } from 'lucide-react'
import { ConfirmModal } from '@/components/confirm-modal'

/** Alias local — a forma da mensagem agora vive no componente compartilhado. */
type Message = ChatMessageView

/**
 * Aba externa do mobile: painel de situação ou chat (padrão). No desktop as
 * duas colunas convivem e esta aba não aparece.
 */
type MobileTab = 'overview' | 'chat'

/**
 * Abas do painel de situação — valem para desktop e mobile. O antigo
 * status/decisions/scheduling virou aba em vez de pilha vertical: cada aba
 * responde uma pergunta ("o que está rodando", "o que o Master fez", "o que ele
 * faz sozinho"), e os contadores da barra evitam perder o que está fechado.
 */
type PanelTab = 'overview' | 'activity' | 'automation'

/**
 * Eventos SSE que mexem no painel de situação (sessões vivas + perguntas).
 * `session:log` e `session:chat` ficam de fora de propósito: são altíssima
 * frequência e não mudam nada do que o painel mostra.
 */
const OVERVIEW_SSE_EVENTS = new Set([
  'session:status',
  'session:created',
  'session:updated',
  'session:deleted',
  'session:paused',
  'session:resumed',
  'session:completed',
  'session:stage-start',
  'session:stage-complete',
  'session:stage-failed',
  'session:stalled',
  'question:created',
  'question:answered',
])

export default function MasterAgentPage() {
  const { currentProject } = useProject()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [mobileTab, setMobileTab] = useState<MobileTab>('chat')
  const [panelTab, setPanelTab] = useState<PanelTab>('overview')
  const [stats, setStats] = useState<MasterAgentStats | null>(null)
  const [decisions, setDecisions] = useState<Decision[]>([])
  const [activeTasks, setActiveTasks] = useState<ActiveTask[]>([])
  const [loading, setLoading] = useState(true)
  const [masterStatus, setMasterStatus] = useState<MasterStatusInfo>({
    isActive: false,
    projectId: null,
    cliProfileId: null,
  })
  const [cliProfiles, setCliProfiles] = useState<CliProfile[]>([])
  const [selectedProfileId, setSelectedProfileId] = useState<string>('')
  const [defaultProfileName, setDefaultProfileName] = useState<string>('')
  const [activating, setActivating] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [showClearMessagesConfirm, setShowClearMessagesConfirm] = useState(false)
  const [scheduling, setScheduling] = useState<MasterScheduling | null>(null)
  const [checkingNow, setCheckingNow] = useState(false)
  const [checkResult, setCheckResult] = useState<string | null>(null)
  const chatTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ------------------------------------------------- painel de situação (P3.4)
  // O redesign trocou os drawers por um painel central sempre visível: sessões
  // vivas e perguntas pendentes são o estado do orquestrador, não detalhe.
  const [liveSessions, setLiveSessions] = useState<LiveSessionView[]>([])
  const [pendingQuestions, setPendingQuestions] = useState<Question[]>([])
  const [overviewLoading, setOverviewLoading] = useState(true)

  // ------------------------------------------------- conversas (P3.2)
  // Cada conversa é só um agrupamento de mensagens (chatSessionId). Trocar de
  // conversa NÃO cria terminal nenhum — o Master do projeto continua sendo um
  // só (CA4).
  const [chatSessions, setChatSessions] = useState<MasterChatSession[]>([])
  const [currentChatSessionId, setCurrentChatSessionId] = useState<string | null>(null)
  /** A conversa aberta ainda não tem mensagem gravada (não está na listagem). */
  const [chatSessionIsDraft, setChatSessionIsDraft] = useState(false)
  const [loadingChatSessions, setLoadingChatSessions] = useState(true)
  const [creatingChatSession, setCreatingChatSession] = useState(false)
  /** Espelho da conversa aberta para closures assíncronas (SSE, timeout). */
  const currentChatSessionIdRef = useRef<string | null>(null)

  const selectChatSession = useCallback((id: string | null, draft = false) => {
    currentChatSessionIdRef.current = id
    setCurrentChatSessionId(id)
    setChatSessionIsDraft(draft)
  }, [])

  const fetchData = useCallback(async () => {
    try {
      const projectId = currentProject?.id
      const [s, d, t] = await Promise.all([
        masterAgentApi.getStats(projectId),
        masterAgentApi.getDecisions(projectId),
        masterAgentApi.getActiveTasks(projectId),
      ])
      setStats(s)
      setDecisions(d)
      setActiveTasks(t)
    } catch (error) {
      console.error('Failed to fetch master agent data:', error)
    } finally {
      setLoading(false)
    }
  }, [currentProject])

  /**
   * Sessões vivas + perguntas pendentes do projeto — o conteúdo do painel
   * central. Vai junto (e não dentro de `fetchData`) porque falha de um lado
   * não pode zerar o outro.
   */
  const fetchOverview = useCallback(async () => {
    const projectId = currentProject?.id
    try {
      const [sessionsRes, questionsRes] = await Promise.allSettled([
        sessionsApi.list(projectId ? { projectId, limit: 100 } : { limit: 100 }),
        questionsGlobalApi.list({ status: 'pending', ...(projectId ? { projectId } : {}) }),
      ])

      if (sessionsRes.status === 'fulfilled') {
        // Com `limit`, o client devolve o objeto paginado { data, nextCursor }.
        const raw: any[] = Array.isArray(sessionsRes.value)
          ? sessionsRes.value
          : (sessionsRes.value?.data ?? [])
        setLiveSessions(raw.filter(isLiveSession).map(toLiveSessionView))
      }
      if (questionsRes.status === 'fulfilled') {
        const raw: any = questionsRes.value
        setPendingQuestions(Array.isArray(raw) ? raw : (raw?.data ?? []))
      }
    } catch (error) {
      console.error('Failed to fetch master agent overview:', error)
    } finally {
      setOverviewLoading(false)
    }
  }, [currentProject])

  const fetchStatus = useCallback(async () => {
    try {
      const status = await masterAgentApi.getStatus(currentProject?.id)
      setMasterStatus(status)
    } catch (error) {
      console.error('Failed to fetch master agent status:', error)
    }
  }, [currentProject])

  useEffect(() => {
    fetchData()
    fetchOverview()
    fetchStatus()
    loadProfiles()
    loadScheduling()
    // fallback lento — o refresh principal vem por SSE
    const interval = setInterval(() => {
      fetchData()
      fetchOverview()
      fetchStatus()
    }, 30000)
    return () => {
      clearInterval(interval)
      if (chatTimeoutRef.current) clearTimeout(chatTimeoutRef.current)
    }
  }, [fetchData, fetchOverview, fetchStatus])

  // Entrar na página / trocar de projeto: lista as conversas e abre a mais
  // recente (CA2/CA3 — a conversa sintética do backfill entra na listagem).
  useEffect(() => {
    void initChatSessions()
  }, [currentProject?.id])

  // Tempo real: decisões do master e perguntas movimentam stats/decisions;
  // sessões e perguntas movimentam o painel de situação; a resposta do chat
  // chega via reply_chat → master:activity (kind=chat, end).
  useGlobalSSE((event: SseEvent) => {
    if (
      event.type === 'master:decision' ||
      event.type === 'question:created' ||
      event.type === 'question:answered' ||
      event.type === 'session:completed'
    ) {
      fetchData()
    }
    if (OVERVIEW_SSE_EVENTS.has(event.type)) {
      fetchOverview()
    }
    if (
      event.type === 'master:activity' &&
      event.data?.kind === 'chat' &&
      event.data?.phase === 'end'
    ) {
      if (chatTimeoutRef.current) {
        clearTimeout(chatTimeoutRef.current)
        chatTimeoutRef.current = null
      }
      // Recarrega a conversa aberta (o ref evita reabrir a antiga se o usuário
      // trocou de conversa enquanto o Master pensava).
      loadMessages(currentChatSessionIdRef.current)
      loadChatSessions()
      setSending(false)
    }
  }, true, currentProject?.id)

  async function loadProfiles() {
    try {
      const profiles = await cliProfilesApi.list()
      setCliProfiles(profiles)

      if (currentProject) {
        const settings = await projectsApi.getSettings(currentProject.id)
        let defaultProfile: CliProfile | undefined
        if (settings.masterAgentProfile) {
          defaultProfile = profiles.find(p => p.name === settings.masterAgentProfile)
        } else if (settings.defaultCliProfile) {
          defaultProfile = profiles.find(p => p.name === settings.defaultCliProfile)
        }
        if (!defaultProfile) {
          defaultProfile = profiles.find(p => p.isDefault) || profiles[0]
        }
        if (defaultProfile) {
          setDefaultProfileName(defaultProfile.name)
        }
      }
    } catch (error) {
      console.error('Failed to load CLI profiles:', error)
    }
  }

  /** Automação é por projeto (MT-2) — recarrega sozinho quando `currentProject` muda (via `fetchData`/`fetchOverview`). */
  async function loadScheduling() {
    try {
      setScheduling(await masterAgentApi.getScheduling(currentProject?.id))
    } catch (error) {
      console.error('Failed to load scheduling config:', error)
    }
  }

  /**
   * Save idempotente (MT-2): o card manda o rascunho inteiro de uma vez só
   * ao clicar "Salvar" — nada de PATCH por campo. O backend decide se algo
   * mudou de verdade (`changed`) e devolve a config efetiva + próximo
   * disparo, que o card usa para mostrar que o save pegou.
   */
  async function saveScheduling(patch: MasterSchedulingFields): Promise<MasterSchedulingSaveResult> {
    if (!currentProject) throw new Error('Select a project first')
    const result = await masterAgentApi.updateScheduling(currentProject.id, patch)
    // `result` já é a config efetiva inteira — não precisa (nem deve) fazer merge
    // com o `scheduling` anterior, que pode nem existir ainda (`current` null).
    setScheduling({
      ...result.config,
      lastSessionCheckAt: result.lastSessionCheckAt,
      nextTick: result.nextTick,
    })
    return result
  }

  async function handleCheckNow() {
    setCheckingNow(true)
    setCheckResult(null)
    try {
      const res = await masterAgentApi.triggerSessionCheck(currentProject?.id)
      setCheckResult(
        res.prompted
          ? `Inspecting ${res.checked} session(s) — ${res.stalled} stalled. Watch the terminal.`
          : res.checked === 0
            ? 'No active sessions to check.'
            : `${res.checked} session(s) healthy — Master not prompted.`,
      )
      loadScheduling()
    } catch (error: any) {
      setCheckResult(error?.message || 'Session check failed')
    } finally {
      setCheckingNow(false)
    }
  }

  async function handleReportNow() {
    try {
      await masterAgentApi.triggerStatusReport(currentProject?.id)
      setCheckResult('Status report requested — the reply will appear in the chat.')
    } catch (error: any) {
      setCheckResult(error?.message || 'Status report failed')
    }
  }

  /** Carrega as mensagens de UMA conversa. Sem conversa, a lista fica vazia. */
  async function loadMessages(chatSessionId: string | null) {
    if (!chatSessionId) {
      setMessages([])
      return
    }
    try {
      const savedMessages = await masterAgentApi.getMessages(currentProject?.id, chatSessionId)
      // Descarta a resposta se o usuário já trocou de conversa (corrida de rede).
      if (currentChatSessionIdRef.current !== chatSessionId) return
      const formattedMessages = savedMessages.map(msg => ({
        id: msg.id,
        role: msg.role as 'user' | 'agent',
        content: msg.content,
        time: new Date(msg.time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
        type: 'normal' as const,
      }))
      setMessages(formattedMessages)
    } catch (error) {
      console.error('Failed to load messages:', error)
    }
  }

  /** Só recarrega a listagem — não mexe na conversa aberta. */
  async function loadChatSessions(): Promise<MasterChatSession[]> {
    try {
      const list = await masterAgentApi.listChatSessions(currentProject?.id)
      setChatSessions(list)
      return list
    } catch (error) {
      console.error('Failed to load chat sessions:', error)
      return []
    }
  }

  /**
   * Estado inicial do chat: lista as conversas do projeto e abre a mais recente.
   * Projeto sem histórico começa num rascunho vazio — sem POST, o backend abre
   * a conversa sozinho na primeira mensagem.
   */
  async function initChatSessions() {
    setLoadingChatSessions(true)
    try {
      const list = await loadChatSessions()
      const mostRecent = list[0]?.chatSessionId ?? null
      selectChatSession(mostRecent, !mostRecent)
      await loadMessages(mostRecent)
    } finally {
      setLoadingChatSessions(false)
    }
  }

  /**
   * "Novo chat" (CA1): abre uma conversa vazia. Não apaga nada — a conversa
   * anterior continua na listagem e pode ser reaberta. Nenhum pane/processo é
   * criado: o POST só devolve um uuid (CA4).
   */
  async function handleNewChatSession() {
    if (creatingChatSession) return
    setCreatingChatSession(true)
    try {
      const { chatSessionId } = await masterAgentApi.createChatSession()
      // Garante que a conversa que estava aberta apareça na listagem antes de
      // sair dela.
      await loadChatSessions()
      selectChatSession(chatSessionId, true)
      setMessages([])
      setMobileTab('chat')
    } catch (error: any) {
      console.error('Failed to start a new chat session:', error)
      setActionError(error?.message || 'Failed to start a new conversation')
      // O erro mora no cabeçalho do painel de situação — no mobile ele está em
      // outra aba, então trazemos o usuário para ela.
      setMobileTab('overview')
    } finally {
      setCreatingChatSession(false)
    }
  }

  /** Trocar de conversa recarrega as mensagens daquela conversa (CA2). */
  async function handleSelectChatSession(chatSessionId: string) {
    if (chatSessionId === currentChatSessionId) return
    selectChatSession(chatSessionId, false)
    setMessages([])
    await loadMessages(chatSessionId)
  }

  const handleActivate = async () => {
    setActivating(true)
    setActionError(null)
    try {
      const result = await masterAgentApi.activate({
        projectId: currentProject?.id,
        cliProfileId: selectedProfileId || undefined,
      })
      if (result.success) {
        await fetchStatus()
        setMessages(prev => [...prev, {
          id: String(Date.now()),
          role: 'agent',
          content: `Master Agent activated${result.cliProfile ? ` using the "${result.cliProfile}" CLI` : ''}${currentProject ? ` on project "${currentProject.name}"` : ''}. I will now triage questions from sessions automatically.`,
          time: new Date().toTimeString().slice(0, 5),
          type: 'status',
        }])
      }
    } catch (error: any) {
      setActionError(error?.message || 'Failed to activate the Master Agent')
    } finally {
      setActivating(false)
    }
  }

  const handleDeactivate = async () => {
    setActionError(null)
    try {
      await masterAgentApi.deactivate(currentProject?.id)
      await fetchStatus()
      setMessages(prev => [...prev, {
        id: String(Date.now()),
        role: 'agent',
        content: 'Master Agent deactivated.',
        time: new Date().toTimeString().slice(0, 5),
        type: 'status',
      }])
    } catch (error: any) {
      setActionError(error?.message || 'Failed to deactivate the Master Agent')
    }
  }

  function handleClearMessages() {
    setShowClearMessagesConfirm(true)
  }

  /** Limpa SÓ a conversa aberta — as outras conversas ficam intactas. */
  async function confirmClearMessages() {
    try {
      await masterAgentApi.clearMessages(currentProject?.id, currentChatSessionId ?? undefined)
      setMessages([])
      // Sem mensagens a conversa some da listagem: continua aberta como rascunho.
      await loadChatSessions()
      if (currentChatSessionId) selectChatSession(currentChatSessionId, true)
      setShowClearMessagesConfirm(false)
    } catch (error) {
      console.error('Failed to clear messages:', error)
      setShowClearMessagesConfirm(false)
    }
  }

  const send = async (text?: string) => {
    const content = (text ?? input).trim()
    if (!content || sending) return
    const now = new Date().toTimeString().slice(0, 5)

    setMessages((prev) => [
      ...prev,
      { id: String(Date.now()), role: 'user', content, time: now },
    ])
    setInput('')
    setMobileTab('chat')
    setSending(true)

    try {
      const res = await masterAgentApi.chat(content, currentChatSessionId ?? undefined, currentProject?.id)
      // Sem conversa aberta, o backend abriu uma — adota o id que ele devolveu.
      if (res.chatSessionId && res.chatSessionId !== currentChatSessionIdRef.current) {
        selectChatSession(res.chatSessionId, false)
      } else if (chatSessionIsDraft) {
        // O rascunho virou conversa de verdade (já tem mensagem gravada).
        setChatSessionIsDraft(false)
      }
      void loadChatSessions()
      if (res.response) {
        // resposta imediata (ex.: master inativo)
        setMessages((prev) => [
          ...prev,
          { id: String(Date.now() + 1), role: 'agent', content: res.response!, time: new Date().toTimeString().slice(0, 5), type: 'normal' },
        ])
        setSending(false)
      } else {
        // enfileirado no terminal do Master — a resposta chega via SSE
        // (reply_chat). Timeout de segurança para não travar a UI.
        chatTimeoutRef.current = setTimeout(() => {
          chatTimeoutRef.current = null
          setSending(false)
          loadMessages(currentChatSessionIdRef.current)
          setMessages((prev) => [
            ...prev,
            {
              id: String(Date.now() + 2),
              role: 'agent',
              content:
                'The Master Agent is taking a while — watch it working in the Terminals page. The reply will appear here as soon as it calls reply_chat.',
              time: new Date().toTimeString().slice(0, 5),
              type: 'status',
            },
          ])
        }, 5 * 60 * 1000)
      }
    } catch (error: any) {
      setMessages((prev) => [
        ...prev,
        {
          id: String(Date.now() + 1),
          role: 'agent',
          content: `Error delivering the message: ${error?.message || 'unknown error'}. Check that the Master Agent is active.`,
          time: new Date().toTimeString().slice(0, 5),
          type: 'normal',
        },
      ])
      setSending(false)
    }
  }

  const masterActive = masterStatus.isActive
  const anyScheduleEnabled = !!scheduling && (
    scheduling.autoTriageEnabled || scheduling.sessionCheckEnabled || scheduling.statusReportEnabled
  )

  const header = (
    <MasterStatusPanel
      projectName={currentProject?.name}
      status={masterStatus}
      cliProfiles={cliProfiles}
      selectedProfileId={selectedProfileId}
      onSelectProfile={setSelectedProfileId}
      defaultProfileName={defaultProfileName}
      activating={activating}
      actionError={actionError}
      onActivate={handleActivate}
      onDeactivate={handleDeactivate}
    />
  )

  const activityMeta = (
    <div className="flex items-center gap-1.5">
      <div
        className={cn(
          'w-1.5 h-1.5 rounded-full',
          masterActive ? 'bg-status-running animate-pulse' : 'bg-muted-foreground',
        )}
      />
      <span className="text-[10px] font-mono text-muted-foreground">
        {masterActive ? 'streaming' : 'inactive'}
      </span>
    </div>
  )

  /** Aba externa do mobile — mesma barra, outro conjunto de itens. */
  const mobileTabs: MasterTabItem<MobileTab>[] = [
    {
      id: 'overview',
      label: 'Overview',
      icon: LayoutList,
      badge: liveSessions.length,
      alert: pendingQuestions.length,
    },
    { id: 'chat', label: 'Chat', icon: Bot },
  ]

  const panelTabs: MasterTabItem<PanelTab>[] = [
    {
      id: 'overview',
      label: 'Overview',
      icon: LayoutList,
      badge: liveSessions.length,
      alert: pendingQuestions.length,
      title: `${liveSessions.length} live session(s) · ${pendingQuestions.length} pending question(s)`,
    },
    {
      id: 'activity',
      label: 'Activity',
      icon: Activity,
      badge: decisions.length,
      title: `${decisions.length} recent decision(s)`,
    },
    {
      id: 'automation',
      label: 'Automation',
      icon: CalendarClock,
      dot: anyScheduleEnabled ? 'active' : 'idle',
      title: anyScheduleEnabled ? 'at least one schedule is on' : 'all schedules are off',
    },
  ]

  /**
   * Conteúdo do painel de situação, separado por aba.
   *
   * As três abas ficam montadas o tempo todo e alternam por `hidden`: o
   * `MasterActivityFeed` assina SSE e acumula os runs, então desmontá-lo ao
   * trocar de aba perderia o histórico ao vivo.
   */
  const panelContent = (
    <>
      {/* ------------------------------------------------------- Overview */}
      <div className={cn('p-4 lg:p-6 space-y-3', panelTab !== 'overview' && 'hidden')}>
        <MasterSection
          title="Live sessions"
          meta={
            <>
              <span className="text-[10px] font-mono text-muted-foreground">{liveSessions.length} live</span>
              <Link href="/sessions" className="text-[10px] text-primary hover:underline flex items-center gap-0.5">
                All <ChevronRight className="w-3 h-3" />
              </Link>
            </>
          }
        >
          <MasterLiveSessions sessions={liveSessions} loading={overviewLoading} />
        </MasterSection>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          <MasterSection
            title="Pending questions"
            meta={
              <>
                {pendingQuestions.length > 0 && (
                  <span className="text-[10px] font-mono bg-destructive/20 text-destructive px-1.5 rounded">
                    {pendingQuestions.length}
                  </span>
                )}
                <Link href="/questions" className="text-[10px] text-primary hover:underline flex items-center gap-0.5">
                  Answer <ChevronRight className="w-3 h-3" />
                </Link>
              </>
            }
          >
            <MasterPendingQuestions questions={pendingQuestions} loading={overviewLoading} />
          </MasterSection>

          <MasterSection
            title="Active macro tasks"
            meta={
              <>
                <span className="text-[10px] font-mono text-muted-foreground">{activeTasks.length}</span>
                <Link href="/macro-tasks" className="text-[10px] text-primary hover:underline flex items-center gap-0.5">
                  All <ChevronRight className="w-3 h-3" />
                </Link>
              </>
            }
          >
            <MasterActiveTasks tasks={activeTasks} />
          </MasterSection>
        </div>
      </div>

      {/* ------------------------------------------------------- Activity */}
      <div className={cn('p-4 lg:p-6 space-y-3', panelTab !== 'activity' && 'hidden')}>
        <MasterSection
          title="Recent decisions"
          meta={<span className="text-[10px] font-mono text-muted-foreground">last {decisions.length}</span>}
          bodyClassName="max-h-96 overflow-y-auto"
        >
          <MasterDecisionsPanel decisions={decisions} />
        </MasterSection>

        <MasterSection title="Live activity" meta={activityMeta} bodyClassName="h-80">
          <MasterActivityFeed className="h-full" />
        </MasterSection>
      </div>

      {/* ----------------------------------------------------- Automation */}
      <div className={cn('p-4 lg:p-6 space-y-3', panelTab !== 'automation' && 'hidden')}>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          <MasterSection
            title="Scheduling"
            meta={
              <span className="flex items-center gap-1.5">
                <span
                  className={cn(
                    'w-1.5 h-1.5 rounded-full',
                    anyScheduleEnabled ? 'bg-status-running' : 'bg-muted-foreground',
                  )}
                />
                <span className="text-[10px] font-mono text-muted-foreground">
                  {anyScheduleEnabled ? 'on' : 'off'}
                </span>
              </span>
            }
          >
            <MasterSchedulingCard
              scheduling={scheduling}
              projectId={currentProject?.id}
              onSave={saveScheduling}
              masterActive={masterActive}
              checkingNow={checkingNow}
              checkResult={checkResult}
              onCheckNow={handleCheckNow}
              onReportNow={handleReportNow}
            />
          </MasterSection>

          <MasterSection title="Quick actions">
            <MasterQuickActions />
          </MasterSection>
        </div>
      </div>
    </>
  )

  /**
   * `variant` aqui é densidade, não dispositivo: a coluna de chat do desktop
   * tem ~400px, então usa a densidade compacta (px-4, bolhas mais largas) —
   * a mesma da aba mobile.
   */
  const chatPanel = () => (
    <MasterChatPanel
      variant="mobile"
      projectId={currentProject?.id}
      messages={messages}
      input={input}
      onInputChange={setInput}
      onSend={() => send()}
      onQuickCommand={(text) => send(text)}
      sending={sending}
      masterActive={masterActive}
      cliProfileName={masterStatus.cliProfileName}
      chatSessions={chatSessions}
      currentChatSessionId={currentChatSessionId}
      chatSessionIsDraft={chatSessionIsDraft}
      loadingChatSessions={loadingChatSessions}
      creatingChatSession={creatingChatSession}
      onSelectChatSession={handleSelectChatSession}
      onNewChatSession={handleNewChatSession}
      onClearMessages={handleClearMessages}
    />
  )

  if (loading) {
    return (
      <Shell>
        <div className="flex items-center justify-center h-full">
          <div className="text-sm text-muted-foreground">Loading Master Agent...</div>
        </div>
      </Shell>
    )
  }

  return (
    <Shell>
      {/*
        Duas colunas apenas: painel de situação (flex-1) e chat (~400px).
        A navegação é a da `Shell` — a página não desenha rail nenhum.

        As mesmas duas colunas servem o mobile: viram abas empilhadas via CSS
        (`flex-col lg:flex-row`), sem duplicar árvore. Montar o chat duas vezes
        significaria dois textareas, dois autocompletes e dois feeds SSE.
      */}
      <div className="flex flex-col lg:flex-row h-full min-h-0 overflow-hidden">
        {/* Aba externa — só mobile. O chat continua sendo a padrão. */}
        <MasterTabBar
          className="lg:hidden"
          items={mobileTabs}
          current={mobileTab}
          onSelect={setMobileTab}
        />

        {/* ------------------------------------------- painel de situação */}
        <div
          className={cn(
            'flex-1 min-w-0 min-h-0 flex-col overflow-hidden lg:flex',
            mobileTab === 'overview' ? 'flex' : 'hidden',
          )}
        >
          {/* Fixo acima das abas: o estado do sistema não entra em aba. */}
          {header}
          <div className="px-4 lg:px-6 pt-3 pb-3 shrink-0">
            <MasterKpiStrip stats={stats} />
          </div>
          <MasterTabBar items={panelTabs} current={panelTab} onSelect={setPanelTab} />
          <div className="flex-1 min-h-0 overflow-y-auto">{panelContent}</div>
        </div>

        {/* ------------------------------------------- chat, coluna fixa */}
        <aside
          className={cn(
            'w-full flex-1 min-h-0 flex-col lg:flex lg:flex-none lg:w-[380px] xl:w-[400px] 2xl:w-[420px] lg:border-l lg:border-border',
            mobileTab === 'chat' ? 'flex' : 'hidden',
          )}
        >
          {chatPanel()}
        </aside>
      </div>

      {showClearMessagesConfirm && (
        <ConfirmModal
          title="Clear This Conversation"
          message="Permanently delete the messages of the conversation you have open? Your other conversations in this project are not affected — use “New chat” if you just want a fresh thread."
          confirmLabel="Clear conversation"
          destructive
          onConfirm={confirmClearMessages}
          onCancel={() => setShowClearMessagesConfirm(false)}
        />
      )}
    </Shell>
  )
}
