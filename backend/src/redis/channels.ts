/**
 * Canais Redis pub/sub canônicos do orquestrador.
 * Todo publish/subscribe deve usar estas constantes — nomes divergentes foram
 * a causa de eventos nunca chegarem ao SSE.
 */
export const CHANNELS = {
  SESSION_LOG: 'session:log',
  SESSION_STATUS: 'session:status',
  SESSION_CREATED: 'session:created',
  SESSION_UPDATED: 'session:updated',
  SESSION_DELETED: 'session:deleted',
  SESSION_PAUSED: 'session:paused',
  SESSION_RESUMED: 'session:resumed',
  SESSION_COMPLETED: 'session:completed',
  STAGE_START: 'session:stage-start',
  STAGE_COMPLETE: 'session:stage-complete',
  STAGE_FAILED: 'session:stage-failed',
  QUESTION_CREATED: 'question:created',
  QUESTION_ANSWERED: 'question:answered',
  /** Canal dinâmico por pergunta: `question:{id}:answered` — usado pelo await_answer */
  QUESTION_ANSWERED_NOTIFY: 'question:answered:notify',
  ARTIFACT_CREATED: 'artifact:created',
  SESSION_STALLED: 'session:stalled',
  MASTER_DECISION: 'master:decision',
  MASTER_ACTIVITY: 'master:activity',
  /**
   * Tick do Master pedindo ao governor que suba a próxima macro task pendente
   * (MT-27). É evento, e não chamada direta, porque `MasterAgentModule` e
   * `SchedulerModule` ficariam num ciclo de importação — e o tick não precisa
   * do resultado, só do disparo.
   */
  MASTER_AUTOSTART: 'master:autostart',
  /** Estado git do projeto mudou (merge, commit, worktree criado/removido). */
  GIT_CHANGED: 'git:changed',
  /** Nova mensagem no chat de uma sessão (P3.1) — user enviou ou agente respondeu. */
  SESSION_CHAT: 'session:chat',
} as const;

export type Channel = (typeof CHANNELS)[keyof typeof CHANNELS];

/** Lista completa — usada pelo SSE para assinar tudo. */
export const ALL_CHANNELS: Channel[] = Object.values(CHANNELS);

export interface SessionLogEvent {
  sessionId: string;
  stream: 'pty' | 'engine';
  chunk: string;
  ts: string;
}

export interface StageEvent {
  sessionId: string;
  stage: string;
  summary?: string;
  error?: string;
  source?: 'mcp' | 'exit' | 'engine' | 'timeout';
}

/**
 * Sessão chegou ao fim FELIZ do pipeline — publicado por
 * `pipeline-engine.service.ts:completeSession`. Só `sessionId`: quem precisa de
 * projeto ou de status resolve pela sessão (ver `qmd-embed.service.ts`).
 *
 * Cuidado ao assinar: este canal cobre apenas o caminho de sucesso.
 * `failed`/`stopped`/`timeout` saem em `SESSION_STATUS` — quem libera recurso
 * precisa dos dois, ou fica esperando um sinal que não vem
 * (`session-governor.service.ts:onModuleInit`).
 */
export interface SessionCompletedEvent {
  sessionId: string;
}

export interface QuestionEvent {
  id: string;
  sessionId: string;
  question: string;
  answer?: string | null;
  priority: string;
  status: string;
  metadata?: Record<string, unknown> | null;
}

export interface MasterDecisionEvent {
  questionId: string;
  action: 'answer' | 'escalate';
  reason?: string;
  confidence?: number;
}

/**
 * Mudança no estado git de um projeto — consumido pela página `/git` via SSE
 * para refetch sob demanda (substitui o antigo poll de 30s).
 * `projectId` é obrigatório: é o campo que o filtro por projeto do SSE usa.
 */
export interface GitChangedEvent {
  projectId: string;
  reason: 'merge' | 'worktree-created' | 'worktree-removed' | 'commit';
  ts: string;
  /** Sessão que originou a mudança, quando houver. */
  sessionId?: string;
  /** Branch envolvida (worktree criado/removido, merge). */
  branch?: string;
}

/**
 * Nova mensagem no chat de uma Session do orquestrador (P3.1).
 * `sessionId` é obrigatório: é por ele que o filtro do SSE
 * (`sse.service.ts:matches()`) roteia o evento para o cliente certo — e é o que
 * mantém o histórico de cada sessão separado (CA2).
 */
export interface SessionChatEvent {
  sessionId: string;
  /** Id da linha em `chat_messages`. */
  messageId: string;
  role: 'user' | 'agent';
  /** Conteúdo truncado — a UI recarrega o histórico completo pelo endpoint. */
  preview: string;
  ts: string;
}

/** Feed em tempo real das execuções do Master Agent (triagem/chat/health-check). */
export interface MasterActivityEvent {
  runId: string;
  /** Projeto do Master que produziu o run (MT-20: há um Master por projeto). */
  projectId?: string;
  kind: 'triage' | 'chat' | 'health';
  phase: 'start' | 'chunk' | 'end';
  ts: string;
  questionId?: string;
  promptPreview?: string;
  stream?: 'stdout' | 'stderr';
  chunk?: string;
  exitCode?: number;
  result?: string;
  action?: 'answer' | 'escalate';
  error?: string;
}
