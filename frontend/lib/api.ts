import { getApiBaseUrl } from './api-base';

export interface ApiOptions {
  method?: string;
  body?: any;
  headers?: Record<string, string>;
}

async function request<T>(endpoint: string, options: ApiOptions = {}): Promise<T> {
  const { method = 'GET', body, headers = {} } = options;

  const config: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  };

  if (body) {
    config.body = JSON.stringify(body);
  }

  const response = await fetch(`${getApiBaseUrl()}${endpoint}`, config);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }

  return response.json();
}

export const api = {
  get: <T>(endpoint: string) => request<T>(endpoint),
  post: <T>(endpoint: string, body: any) => request<T>(endpoint, { method: 'POST', body }),
  put: <T>(endpoint: string, body: any) => request<T>(endpoint, { method: 'PUT', body }),
  patch: <T>(endpoint: string, body: any) => request<T>(endpoint, { method: 'PATCH', body }),
  delete: <T>(endpoint: string) => request<T>(endpoint, { method: 'DELETE' }),
};

export interface Project {
  id: string;
  name: string;
  description?: string;
  repoUrl: string;
  mainPath: string;
  worktreeBase: string;
  maxSessions?: number;
  settings?: Record<string, any>;
  isTemplate: boolean;
  createdAt: string;
  updatedAt: string;
  pipelines?: any[];
  macroTasks?: any[];
  agents?: any[];
}

export interface CloneFromTemplateInput {
  name: string;
  repoUrl: string;
  mainPath: string;
  worktreeBase: string;
  description?: string;
}

export interface CloneFromTemplateResult {
  project: Project;
  templateId: string;
  templateName: string;
  cloned: { pipelines: number; agents: number; mcpLinks: number };
  warnings?: string[];
}

/** "fixed" = catálogo geral reusável; "custom" = fluxo específico de um projeto (01-CONTRATOS §2). */
export type PipelineKind = 'fixed' | 'custom';

/** Espelha `PipelineDefaults` de `backend/src/pipelines/pipeline-definition.ts` (MT-0). */
export interface PipelineDefaults {
  model?: string;
  cliProfile?: string;
  subagents?: string[];
  skills?: string[];
  timeout?: number;
}

export interface Pipeline {
  id: string;
  projectId: string;
  name: string;
  description?: string;
  /** `{ stages: PipelineStage[], kind?, category?, tags?, defaults?, ... }` — json solto do backend. */
  stages: any;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  macroTasks?: any[];
}

export interface MacroTask {
  id: string;
  projectId: string;
  pipelineId: string;
  title: string;
  description?: string;
  status: string;
  priority: number;
  metadata?: any;
  createdAt: string;
  updatedAt: string;
  sessions?: any[];
}

export interface Session {
  id: string;
  macroTaskId: string;
  agentId: string;
  branchName: string;
  worktreePath: string;
  status: string;
  currentStage: string;
  stageData?: any;
  context?: any;
  startedAt: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
  agent?: any;
  macroTask?: any;
  questions?: any[];
  artifacts?: any[];
  logs?: any[];
}

export interface Question {
  id: string;
  sessionId: string;
  agentId?: string | null;
  question: string;
  answer?: string;
  status: string;
  priority: string;
  metadata?: any;
  createdAt: string;
  answeredAt?: string;
  session?: {
    id: string;
    branchName: string;
    currentStage: string;
    macroTask?: { id: string; title: string; projectId: string };
    agent?: { id: string; name: string; type: string };
  };
}

export interface Agent {
  id: string;
  projectId: string;
  name: string;
  type: string;
  model: string;
  status: string;
  mcpEndpoint?: string;
  cliProfileId?: string | null;
  metadata?: any;
  createdAt: string;
  updatedAt: string;
  sessions?: any[];
}

export const healthApi = {
  check: () => api.get<{ status: string; database: string; uptime: number; timestamp: string }>('/health'),
  detailed: () =>
    api.get<{
      status: string;
      checks: Record<string, any>;
      uptime: number;
      timestamp: string;
    }>('/health/detailed'),
};

export const projectsApi = {
  list: () => api.get<Project[]>('/projects'),
  get: (id: string) => api.get<Project>(`/projects/${id}`),
  create: (data: Partial<Project>) => api.post<Project>('/projects', data),
  update: (id: string, data: Partial<Project>) => api.patch<Project>(`/projects/${id}`, data),
  delete: (id: string) => api.delete<void>(`/projects/${id}`),
  cloneFromTemplate: (templateId: string, data: CloneFromTemplateInput) =>
    api.post<CloneFromTemplateResult>(`/projects/${templateId}/clone`, data),
  getSettings: (projectId: string) => api.get<Record<string, any>>(`/projects/${projectId}/settings`),
  updateSettings: (projectId: string, settings: Record<string, any>) =>
    api.patch<Record<string, any>>(`/projects/${projectId}/settings`, settings),
  /** `settings.defaults` (01-CONTRATOS §4) — camada mais fraca da precedência do resolver. */
  getDefaults: (projectId: string) => api.get<ProjectDefaults>(`/projects/${projectId}/defaults`),
  /** `null` num campo REMOVE o default (01-CONTRATOS §4) — por isso não é `Partial<ProjectDefaults>`. */
  setDefaults: (projectId: string, patch: Record<string, any>) =>
    api.patch<ProjectDefaults>(`/projects/${projectId}/defaults`, patch),
  /**
   * Arquivos REAIS do repositório do projeto (código inteiro, não só os `.md`
   * do `/context`). Usado pelo `@arquivo` do chat.
   *
   * A busca é **server-side**: o repo pode ter milhares de arquivos, então não
   * dá para baixar a lista toda e filtrar no cliente. Chame de novo a cada
   * termo digitado (com debounce).
   */
  listFiles: (projectId: string, query?: string, limit?: number) => {
    const params = new URLSearchParams();
    if (query) params.set('query', query);
    if (limit !== undefined) params.set('limit', String(limit));
    const qs = params.toString();
    return api.get<ProjectFilesResult>(`/projects/${projectId}/files${qs ? `?${qs}` : ''}`);
  },
};

/** Espelha `ProjectDefaults` de `backend/src/config/project-defaults.ts`. */
export interface ProjectDefaults {
  model?: string
  masterModel?: string
  permissionMode?: string
  cliProfile?: string
  skills?: string[]
  subagents?: string[]
  timeout?: number
}

export interface ProjectFileEntry {
  /** Caminho relativo à raiz do projeto — é o que vai para o prompt. */
  path: string;
  name: string;
  /** Diretório relativo (vazio na raiz). */
  dir: string;
}

export interface ProjectFilesResult {
  projectId: string;
  root: string;
  rootExists: boolean;
  /** `git` respeita o .gitignore; `walk` é o fallback sem git; `none` = mainPath inválido. */
  source: 'git' | 'walk' | 'none';
  /** Quantos casaram antes do corte por `limit`. */
  total: number;
  truncated: boolean;
  files: ProjectFileEntry[];
  query?: string;
}

/**
 * Filtros da /pipelines, resolvidos no backend desde a MT-17 (antes o browser
 * carregava o projeto inteiro e filtrava em JS). Todos opcionais: `list(id)`
 * sem query continua devolvendo tudo, que é como as outras páginas chamam.
 */
export interface PipelineListQuery {
  search?: string;
  kind?: PipelineKind;
  category?: string;
  tag?: string;
  skip?: number;
  take?: number;
}

/** Contadores e opções de filtro — a UI derivava da lista inteira, que a paginação não tem mais. */
export interface PipelineFacets {
  /** Do projeto, ignorando filtros. */
  total: number;
  active: number;
  /** Com os filtros aplicados. */
  matching: number;
  categories: string[];
  tags: string[];
}

function pipelineQueryString(query?: PipelineListQuery): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    // String vazia e `undefined` são "sem filtro" — mandar `search=` faria o
    // backend rejeitar por `forbidNonWhitelisted`/tipo em alguns campos.
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export const pipelinesApi = {
  list: (projectId: string, query?: PipelineListQuery) =>
    api.get<Pipeline[]>(`/projects/${projectId}/pipelines${pipelineQueryString(query)}`),
  facets: (projectId: string, query?: PipelineListQuery) =>
    api.get<PipelineFacets>(`/projects/${projectId}/pipelines/facets${pipelineQueryString(query)}`),
  get: (projectId: string, id: string) => api.get<Pipeline>(`/projects/${projectId}/pipelines/${id}`),
  create: (projectId: string, data: Partial<Pipeline>) =>
    api.post<Pipeline>(`/projects/${projectId}/pipelines`, data),
  update: (projectId: string, id: string, data: Partial<Pipeline>) =>
    api.patch<Pipeline>(`/projects/${projectId}/pipelines/${id}`, data),
  delete: (projectId: string, id: string) =>
    api.delete<void>(`/projects/${projectId}/pipelines/${id}`),
  /** "Duplicar como customizada": cria uma cópia editável (kind: 'custom', isActive: false) de uma fixa. */
  duplicate: (projectId: string, id: string) =>
    api.post<Pipeline>(`/projects/${projectId}/pipelines/${id}/duplicate`, {}),
};

export interface PaginatedResponse<T> {
  data: T[];
  nextCursor: string | null;
}

export interface BatchCreateFailure {
  index: number;
  title: string;
  reason: string;
}

export interface BatchCreateResult<T = MacroTask> {
  summary: { total: number; succeeded: number; failed: number };
  created: T[];
  failed: BatchCreateFailure[];
}

export const macroTasksApi = {
  /**
   * Sempre `{ data, nextCursor }` — com ou sem paginação (MT-15). Antes o retorno
   * era polimórfico (array OU objeto) e todo chamador corrigia com `as Task[]`.
   * O backend já responde só o formato paginado; o normalize aqui é para backend
   * antigo, no mesmo espírito do `unwrapPage` de `app/questions/page.tsx`.
   */
  list: async (
    projectId: string,
    pagination?: { cursor?: string; limit?: number },
  ): Promise<PaginatedResponse<MacroTask>> => {
    const params = new URLSearchParams();
    if (pagination?.cursor) params.set('cursor', pagination.cursor);
    if (pagination?.limit !== undefined) params.set('limit', String(pagination.limit));
    const qs = params.toString();
    const result = await api.get<unknown>(`/projects/${projectId}/macro-tasks${qs ? `?${qs}` : ''}`)
    if (Array.isArray(result)) return { data: result as MacroTask[], nextCursor: null }
    const page = result as Partial<PaginatedResponse<MacroTask>> | null | undefined
    return {
      data: Array.isArray(page?.data) ? page.data : [],
      nextCursor: typeof page?.nextCursor === 'string' && page.nextCursor.length > 0 ? page.nextCursor : null,
    }
  },
  get: (projectId: string, id: string) => api.get<MacroTask>(`/projects/${projectId}/macro-tasks/${id}`),
  create: (projectId: string, data: Partial<MacroTask>) =>
    api.post<MacroTask>(`/projects/${projectId}/macro-tasks`, data),
  update: (projectId: string, id: string, data: Partial<MacroTask>) =>
    api.patch<MacroTask>(`/projects/${projectId}/macro-tasks/${id}`, data),
  delete: (projectId: string, id: string) =>
    api.delete<void>(`/projects/${projectId}/macro-tasks/${id}`),
  createBatch: (projectId: string, items: Array<Record<string, any>>) =>
    api.post<BatchCreateResult>(`/projects/${projectId}/macro-tasks/batch`, { items }),
  // --- backlog gerado pelos task-reports (MT-7) ---
  backlog: (projectId: string) =>
    api.get<BacklogItem[]>(`/projects/${projectId}/macro-tasks/backlog`),
  backlogSummary: (projectId: string) =>
    api.get<BacklogSummary>(`/projects/${projectId}/macro-tasks/backlog/summary`),
  ingestBacklog: (projectId: string, sessionId?: string) =>
    api.post<BacklogIngestSummary>(`/projects/${projectId}/macro-tasks/backlog/ingest`, sessionId ? { sessionId } : {}),
  promote: (projectId: string, id: string, pipelineId?: string) =>
    api.post<MacroTask>(`/projects/${projectId}/macro-tasks/${id}/promote`, pipelineId ? { pipelineId } : {}),
};

export interface BacklogItem extends MacroTask {
  pipeline?: { id: string; name: string };
  backlog: {
    kind: string;
    effort: string;
    /** Escala fina 0–9 que ordena a lista; `priority` é só o bucket 0–2. */
    score: number;
    files: string[];
    detail?: string;
    /** Quantas sessões independentes reportaram o mesmo item. */
    seenCount: number;
    parseErrors?: string[];
  };
  origin: { macroTaskId: string; title: string } | null;
  suggestedPipeline: string | null;
}

export interface BacklogSummary {
  total: number;
  byKind: Array<{ kind: string; count: number; score: number }>;
  byFile: Array<{ file: string; count: number; kinds: string[] }>;
  byOrigin: Array<{ macroTaskId: string; title: string; count: number }>;
}

export interface BacklogIngestSummary {
  sessions: number;
  created: number;
  merged: number;
  skipped: number;
}

export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  url: string;
  labels: string[];
  state: string;
}

export interface GitHubStatus {
  installed: boolean;
  authenticated: boolean;
  version?: string;
  account?: string;
  message?: string;
}

export const githubApi = {
  status: () => api.get<GitHubStatus>('/integrations/github/status'),
  listIssues: (params: { repo: string; state?: string; limit?: number; labels?: string }) => {
    const qs = new URLSearchParams({ repo: params.repo });
    if (params.state) qs.set('state', params.state);
    if (params.limit !== undefined) qs.set('limit', String(params.limit));
    if (params.labels) qs.set('labels', params.labels);
    return api.get<GitHubIssue[]>(`/integrations/github/issues?${qs.toString()}`);
  },
};

/** Espelha `SessionGovernorService.getStatus()` (MT-10). */
export interface GovernorStatus {
  global: { active: number; max: number };
  resource: { ok: boolean; detail?: string; cpuLoadThreshold: number; minFreeMemMb: number };
  queue: Array<{
    macroTaskId: string;
    title: string;
    projectId: string;
    position: number;
    reason: 'global' | 'project' | 'resource';
    detail: string;
    queuedAt: string;
  }>;
}

export interface SessionHistory {
  id: string;
  sessionId: string;
  macroTaskId: string | null;
  projectId: string;
  status: string;
  branch: string | null;
  startedAt: string;
  completedAt: string | null;
  artifactsCount: number;
  createdAt: string;
}

export const sessionsApi = {
  list: async (filters?: { projectId?: string; status?: string; cursor?: string; limit?: number }): Promise<any> => {
    const params = new URLSearchParams();
    if (filters?.projectId) params.set('projectId', filters.projectId);
    if (filters?.status) params.set('status', filters.status);
    if (filters?.cursor) params.set('cursor', filters.cursor);
    if (filters?.limit !== undefined) params.set('limit', String(filters.limit));
    const qs = params.toString();
    const result = await api.get<any>(`/sessions${qs ? `?${qs}` : ''}`);
    if (result?.data && Array.isArray(result.data)) {
      return filters?.cursor !== undefined || filters?.limit !== undefined ? result : result.data;
    }
    return Array.isArray(result) ? result : [];
  },
  get: (id: string) => api.get<any>(`/sessions/${id}`),
  create: (data: any) => api.post<any>('/sessions', data),
  update: (id: string, data: any) => api.patch<any>(`/sessions/${id}`, data),
  delete: (id: string) => api.delete<void>(`/sessions/${id}`),
  kill: (id: string) => api.post<any>(`/sessions/${id}/kill`, {}),
  restartCli: (id: string) => api.post<any>(`/sessions/${id}/restart-cli`, {}),
  resume: (id: string) => api.post<any>(`/sessions/${id}/resume`, {}),
  cleanup: (projectId: string, olderThanDays?: number) =>
    api.post<any>('/sessions/cleanup', { projectId, olderThanDays }),
  getHistory: (projectId: string, macroTaskId?: string) => {
    const params = new URLSearchParams({ projectId });
    if (macroTaskId) params.set('macroTaskId', macroTaskId);
    return api.get<SessionHistory[]>(`/sessions/history?${params.toString()}`);
  },
  /** Chat da sessão (P3.1). `time` vem ISO; a UI formata. */
  getChat: (sessionId: string) =>
    api.get<SessionChatMessage[]>(`/sessions/${sessionId}/chat`),
  /**
   * Envia a mensagem para o pane tmux da sessão. `queued: false` + `response`
   * quando a sessão não está viva (não é erro).
   */
  sendChat: (sessionId: string, message: string) =>
    api.post<{ queued: boolean; response?: string }>(`/sessions/${sessionId}/chat`, { message }),
  /** Governor de recursos (MT-10): slots usados/total + quem está na fila e por quê. */
  getGovernorStatus: () => api.get<GovernorStatus>('/sessions/governor'),
};

/** Mensagem do chat de uma Session do orquestrador (`GET /sessions/:id/chat`). */
export interface SessionChatMessage {
  id: string;
  role: 'user' | 'agent';
  content: string;
  /** ISO — formatar na UI. */
  time: string;
}

export const questionsApi = {
  list: (sessionId: string) => api.get<Question[]>(`/sessions/${sessionId}/questions`),
  get: (sessionId: string, id: string) => api.get<Question>(`/sessions/${sessionId}/questions/${id}`),
  create: (sessionId: string, data: Partial<Question>) =>
    api.post<Question>(`/sessions/${sessionId}/questions`, data),
  answer: (sessionId: string, id: string, answer: string) =>
    api.patch<Question>(`/sessions/${sessionId}/questions/${id}/answer`, { answer }),
  delete: (sessionId: string, id: string) =>
    api.delete<void>(`/sessions/${sessionId}/questions/${id}`),
};

/** Inbox global de perguntas (todas as sessões, com contexto). */
export const questionsGlobalApi = {
  list: async (filters: { status?: string; projectId?: string; cursor?: string; limit?: number } = {}) => {
    const params = new URLSearchParams();
    if (filters.status) params.set('status', filters.status);
    if (filters.projectId) params.set('projectId', filters.projectId);
    if (filters.cursor) params.set('cursor', filters.cursor);
    if (filters.limit !== undefined) params.set('limit', String(filters.limit));
    const query = params.toString();
    const result = await api.get<any>(`/questions${query ? `?${query}` : ''}`);
    if (result?.data && Array.isArray(result.data)) {
      return filters.cursor !== undefined || filters.limit !== undefined ? result : result.data;
    }
    return Array.isArray(result) ? result : [];
  },
  answer: (id: string, answer: string) =>
    api.patch<Question>(`/questions/${id}/answer`, { answer }),
  /** Descarta uma pergunta pendente obsoleta (status vira 'dismissed'). */
  dismiss: (id: string, reason: string) =>
    api.post<Question>(`/questions/${id}/dismiss`, { reason }),
};

export interface MCP {
  id: string;
  name: string;
  description?: string;
  endpoint?: string;
  connected: boolean;
  metadata?: any;
  createdAt: string;
  updatedAt: string;
}

export interface LLMModel {
  id: string;
  provider: string;
  name: string;
  contextSize?: number;
  notes?: string;
  enabled: boolean;
  assignments?: PhaseModelAssignment[];
  createdAt: string;
  updatedAt: string;
}

export interface PhaseModelAssignment {
  id: string;
  phase: string;
  modelId: string;
  cliProfileId?: string | null;
  reason?: string;
  model?: LLMModel;
  cliProfile?: any;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduledJob {
  id: string;
  type: string;
  payload: any;
  scheduledAt: string;
  status: string;
  result?: any;
  notes?: string;
  createdAt: string;
  executedAt?: string;
}

/** Tipo de ScheduledJob criado pelo usuário (instruções livres para o Master). */
export const MASTER_LOOP_JOB_TYPE = 'master_loop';

/** `payload` de um ScheduledJob `master_loop` (shape definido no backend). */
export interface MasterLoopPayload {
  instructions: string;
  projectId: string;
  /** Ausente = executa uma vez só. */
  repeatIntervalMinutes?: number;
  /** Ausente com recorrência = repete indefinidamente. */
  maxRuns?: number;
  runCount: number;
  lastRunAt?: string;
  lastError?: string;
  deferCount?: number;
}

export interface CreateMasterLoopInput {
  instructions: string;
  projectId: string;
  scheduledAt: string;
  repeatIntervalMinutes?: number;
  maxRuns?: number;
  notes?: string;
}

export interface SDDArtifact {
  id: string;
  sessionId: string;
  type: string;
  path: string;
  content?: string;
  metadata?: any;
  createdAt: string;
  updatedAt: string;
}

export interface PipelineTemplate {
  name: string;
  description: string;
  stages: any[];
}

export interface MCPScanResult {
  name: string;
  endpoint: string;
  type: string;
  source: string;
  /** Config file onde o server foi encontrado (ex. .mcp.json, .opencode.json) */
  file?: string;
}

export const agentsApi = {
  list: (projectId: string) => api.get<Agent[]>(`/projects/${projectId}/agents`),
  listAll: () => api.get<Agent[]>('/agents'),
  get: (projectId: string, id: string) => api.get<Agent>(`/projects/${projectId}/agents/${id}`),
  create: (projectId: string, data: Partial<Agent>) =>
    api.post<Agent>(`/projects/${projectId}/agents`, data),
  update: (projectId: string, id: string, data: Partial<Agent>) =>
    api.patch<Agent>(`/projects/${projectId}/agents/${id}`, data),
  delete: (projectId: string, id: string) =>
    api.delete<void>(`/projects/${projectId}/agents/${id}`),
};

export const scheduledJobsApi = {
  list: () => api.get<ScheduledJob[]>('/scheduled-jobs'),
  get: (id: string) => api.get<ScheduledJob>(`/scheduled-jobs/${id}`),
  create: (data: Partial<ScheduledJob>) => api.post<ScheduledJob>('/scheduled-jobs', data),
  /** Agendamento de instruções livres para o Master (uma vez ou em loop com rate-limit). */
  createMasterLoop: (data: CreateMasterLoopInput) =>
    api.post<ScheduledJob>('/scheduled-jobs/master-loop', data),
  update: (id: string, data: Partial<ScheduledJob>) => api.patch<ScheduledJob>(`/scheduled-jobs/${id}`, data),
  delete: (id: string) => api.delete<void>(`/scheduled-jobs/${id}`),
};

export const artifactsApi = {
  list: (sessionId: string) => api.get<SDDArtifact[]>(`/sessions/${sessionId}/artifacts`),
  get: (sessionId: string, id: string) => api.get<SDDArtifact>(`/sessions/${sessionId}/artifacts/${id}`),
  create: (sessionId: string, data: Partial<SDDArtifact>) =>
    api.post<SDDArtifact>(`/sessions/${sessionId}/artifacts`, data),
  delete: (sessionId: string, id: string) =>
    api.delete<void>(`/sessions/${sessionId}/artifacts/${id}`),
};

export interface McpTestResult {
  reachable: boolean;
  mode: 'http' | 'sse' | 'stdio';
  latencyMs?: number;
  serverInfo?: { name?: string; version?: string };
  resolvedPath?: string;
  error?: string;
}

export const mcpsApi = {
  list: () => api.get<MCP[]>('/mcps'),
  get: (id: string) => api.get<MCP>(`/mcps/${id}`),
  create: (data: Partial<MCP>, projectId?: string) => api.post<MCP>(`/mcps${projectId ? `?projectId=${projectId}` : ''}`, data),
  update: (id: string, data: Partial<MCP>) => api.patch<MCP>(`/mcps/${id}`, data),
  delete: (id: string) => api.delete<void>(`/mcps/${id}`),
  connect: (id: string) => api.post<MCP>(`/mcps/${id}/connect`, {}),
  disconnect: (id: string) => api.post<MCP>(`/mcps/${id}/disconnect`, {}),
  test: (id: string) => api.post<McpTestResult>(`/mcps/${id}/test`, {}),
  scan: (projectId: string) => api.get<MCPScanResult[]>(`/mcps/scan?projectId=${projectId}`),
  scanGlobal: () => api.get<(MCPScanResult & { global: boolean })[]>('/mcps/scan-global'),
  getProjectMCPs: (projectId: string) => api.get<MCP[]>(`/mcps/project/${projectId}`),
  inject: (id: string, projectId: string) =>
    api.post<{ injected: boolean; file: string; server: string }>(`/mcps/${id}/inject`, { projectId }),
  removeFromProject: (id: string, projectId: string) =>
    api.post<{ removed: boolean; file: string; server: string }>(`/mcps/${id}/remove`, { projectId }),
};

export const modelsApi = {
  list: () => api.get<LLMModel[]>('/models'),
  get: (id: string) => api.get<LLMModel>(`/models/${id}`),
  create: (data: Partial<LLMModel>) => api.post<LLMModel>('/models', data),
  update: (id: string, data: Partial<LLMModel>) => api.patch<LLMModel>(`/models/${id}`, data),
  delete: (id: string) => api.delete<void>(`/models/${id}`),
  getAssignments: () => api.get<PhaseModelAssignment[]>('/models/assignments/list'),
  createAssignment: (data: Partial<PhaseModelAssignment>) =>
    api.post<PhaseModelAssignment>('/models/assignments', data),
  deleteAssignment: (id: string) => api.delete<void>(`/models/assignments/${id}`),
};

export const pipelineTemplatesApi = {
  list: (projectId: string) => api.get<PipelineTemplate[]>(`/projects/${projectId}/pipelines/templates`),
};

export const pipelineExecutionApi = {
  start: (pipelineId: string, data: { macroTaskId: string; agentId: string }) =>
    api.post<Session>(`/pipelines/${pipelineId}/execute/start`, data),
  advance: (pipelineId: string, sessionId: string) =>
    api.post<void>(`/pipelines/${pipelineId}/execute/${sessionId}/advance`, {}),
  pause: (pipelineId: string, sessionId: string, reason: string) =>
    api.post<void>(`/pipelines/${pipelineId}/execute/${sessionId}/pause`, { reason }),
  resume: (pipelineId: string, sessionId: string) =>
    api.post<void>(`/pipelines/${pipelineId}/execute/${sessionId}/resume`, {}),
  retryStage: (pipelineId: string, sessionId: string) =>
    api.post<void>(`/pipelines/${pipelineId}/execute/${sessionId}/retry-stage`, {}),
  skipStage: (pipelineId: string, sessionId: string, reason?: string) =>
    api.post<{ skipped: string }>(`/pipelines/${pipelineId}/execute/${sessionId}/skip-stage`, { reason }),
  getStatus: (pipelineId: string, sessionId: string) =>
    api.get<any>(`/pipelines/${pipelineId}/execute/${sessionId}/status`),
};

export const logsApi = {
  list: async (sessionId?: string, projectId?: string, pagination?: { cursor?: string; limit?: number }) => {
    const params = new URLSearchParams();
    if (sessionId) params.set('sessionId', sessionId);
    if (projectId) params.set('projectId', projectId);
    if (pagination?.cursor) params.set('cursor', pagination.cursor);
    if (pagination?.limit !== undefined) params.set('limit', String(pagination.limit));
    const query = params.toString();
    const result = await api.get<any>(`/logs${query ? `?${query}` : ''}`);
    if (result?.data && Array.isArray(result.data)) {
      return pagination?.cursor !== undefined || pagination?.limit !== undefined ? result : result.data;
    }
    return Array.isArray(result) ? result : [];
  },
  get: (id: string) => api.get<any>(`/logs/${id}`),
  create: (data: { sessionId?: string; projectId?: string; level: string; message: string; metadata?: any }) =>
    api.post<any>('/logs', data),
  // Reports derivados (MT-8): montados no backend a partir do que o orquestrador
  // já persiste. Nada é instrumentado dentro da sessão.
  sessionReport: (sessionId: string) =>
    api.get<SessionReport>(`/logs/report/session/${sessionId}`),
  waveReport: (projectId: string, from?: string, to?: string) => {
    const params = new URLSearchParams({ projectId });
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    return api.get<WaveReport>(`/logs/report/wave?${params.toString()}`);
  },
};

/** Espelha `backend/src/logs/session-report.ts`. Duração `null` = não medida. */
export type StageReportStatus =
  | 'completed'
  | 'skipped'
  | 'inherited'
  | 'running'
  | 'failed'
  | 'pending';

export interface StageReport {
  name: string;
  status: StageReportStatus;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  attempts: number;
  summary: string | null;
  model: string | null;
  cliProfile: string | null;
  provenance: string | null;
}

export interface SessionReport {
  sessionId: string;
  macroTaskId: string | null;
  macroTaskTitle: string | null;
  pipelineName: string | null;
  branch: string;
  status: string;
  currentStage: string;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  stages: StageReport[];
  slowestStage: { name: string; durationMs: number } | null;
  counts: {
    stages: number;
    completed: number;
    skipped: number;
    inherited: number;
    retried: number;
    artifacts: number;
    questionsOpen: number;
    questionsAnswered: number;
    questionsHuman: number;
  };
  resume: {
    fromSessionId: string | null;
    fromStatus: string | null;
    interruptedStage: string | null;
    resumedAt: string | null;
    inheritedStages: string[];
  } | null;
  questions: Array<{
    id: string;
    question: string;
    status: string;
    answeredBy: string | null;
    createdAt: string;
    answeredAt: string | null;
    waitMs: number | null;
  }>;
  artifacts: Array<{ id: string; type: string; path: string; createdAt: string }>;
  merge: {
    status: 'merged' | 'conflict' | 'pending';
    mainBranch: string | null;
    mergedAt: string | null;
    conflicts: string[];
  };
}

/** Espelha `backend/src/logs/wave-report.ts`. */
export interface WaveReport {
  from: string | null;
  to: string | null;
  sessions: number;
  completed: number;
  failed: number;
  live: number;
  medianDurationMs: number | null;
  pipelines: Array<{
    pipelineName: string;
    stageCount: number;
    sessions: number;
    completed: number;
    failed: number;
    live: number;
    medianDurationMs: number | null;
    avgDurationMs: number | null;
    stages: Array<{
      name: string;
      samples: number;
      medianDurationMs: number | null;
      totalDurationMs: number;
      retries: number;
    }>;
    slowestStage: { name: string; medianDurationMs: number | null } | null;
    questionsTotal: number;
    questionsHuman: number;
  }>;
  stuck: Array<{
    sessionId: string;
    macroTaskTitle: string | null;
    pipelineName: string | null;
    status: string;
    stage: string;
    questionsOpen: number;
  }>;
  questionsTotal: number;
  questionsOpen: number;
  questionsHuman: number;
}

export interface MasterActivityRun {
  runId: string;
  kind: 'triage' | 'chat' | 'health';
  questionId?: string;
  promptPreview: string;
  startedAt: string;
  output: string;
  endedAt?: string;
  exitCode?: number;
  result?: string;
  action?: 'answer' | 'escalate';
  error?: string;
}

/**
 * Uma conversa (thread) do chat do Master — P3.2. É só agrupamento de
 * mensagens: continua havendo um único terminal do Master por projeto.
 */
export interface MasterChatSession {
  chatSessionId: string;
  title: string;
  messageCount: number;
  createdAt: string | null;
  lastMessageAt: string | null;
}

/** Querystring de projeto + conversa (ambos opcionais, compat com callers antigos). */
function masterChatQuery(projectId?: string, chatSessionId?: string): string {
  const params = new URLSearchParams();
  if (projectId) params.set('projectId', projectId);
  if (chatSessionId) params.set('chatSessionId', chatSessionId);
  const query = params.toString();
  return query ? `?${query}` : '';
}

export const masterAgentApi = {
  getStats: (projectId?: string) =>
    api.get<any>(`/master-agent/stats${projectId ? `?projectId=${projectId}` : ''}`),
  getDecisions: (projectId?: string) =>
    api.get<any[]>(`/master-agent/decisions${projectId ? `?projectId=${projectId}` : ''}`),
  chat: (message: string, chatSessionId?: string, projectId?: string) =>
    api.post<{ queued: boolean; response?: string; chatSessionId?: string }>(
      '/master-agent/chat',
      { message, ...(chatSessionId ? { chatSessionId } : {}), ...(projectId ? { projectId } : {}) },
    ),
  /** Conversas do projeto, mais recente primeiro. */
  listChatSessions: (projectId?: string) =>
    api.get<MasterChatSession[]>(`/master-agent/chat-sessions${masterChatQuery(projectId)}`),
  /** "Novo chat": só devolve um id — nada é persistido até a primeira mensagem. */
  createChatSession: () =>
    api.post<{ chatSessionId: string }>('/master-agent/chat-sessions', {}),
  getActiveTasks: (projectId?: string) =>
    api.get<any[]>(`/master-agent/active-tasks${projectId ? `?projectId=${projectId}` : ''}`),
  activate: (data: { projectId?: string; cliProfileId?: string } = {}) =>
    api.post<{ success: boolean; projectId?: string; cliProfile?: string }>('/master-agent/activate', data),
  /** Sem `projectId`, o backend só resolve sozinho quando há exatamente um Master ativo. */
  deactivate: (projectId?: string) =>
    api.post<{ success: boolean; projectId?: string }>(
      `/master-agent/deactivate${projectId ? `?projectId=${projectId}` : ''}`,
      {},
    ),
  getStatus: (projectId?: string) =>
    api.get<{
      isActive: boolean;
      projectId: string | null;
      cliProfileId: string | null;
      projectName?: string | null;
      cliProfileName?: string | null;
      tmuxRunning?: boolean;
      /** Todos os projetos com Master ativo agora (MT-20). */
      activeProjects?: Array<{ projectId: string; projectName: string; tmuxRunning: boolean }>;
    }>(`/master-agent/status${projectId ? `?projectId=${projectId}` : ''}`),
  getActivity: () => api.get<{ runs: MasterActivityRun[] }>('/master-agent/activity'),
  getMessages: (projectId?: string, chatSessionId?: string) =>
    api.get<any[]>(`/master-agent/messages${masterChatQuery(projectId, chatSessionId)}`),
  /** Com `chatSessionId` limpa só aquela conversa; sem ele, tudo do projeto. */
  clearMessages: (projectId?: string, chatSessionId?: string) =>
    api.post<{ success: boolean }>(
      `/master-agent/messages/clear${masterChatQuery(projectId, chatSessionId)}`,
      {},
    ),
  /** Automação é por projeto (MT-2) — sem `projectId`, o backend cai no projeto ativo do Master. */
  getScheduling: (projectId?: string) =>
    api.get<MasterScheduling>(`/master-agent/scheduling${projectId ? `?projectId=${projectId}` : ''}`),
  /** `projectId` é obrigatório: o backend rejeita PATCH sem saber de qual projeto. */
  updateScheduling: (projectId: string, data: Partial<MasterSchedulingFields>) =>
    api.patch<MasterSchedulingSaveResult>(`/master-agent/scheduling?projectId=${projectId}`, data),
  triggerSessionCheck: (projectId?: string) =>
    api.post<{ checked: number; stalled: number; prompted: boolean }>(
      `/master-agent/session-check${projectId ? `?projectId=${projectId}` : ''}`,
      {},
    ),
  triggerTriage: (projectId?: string) =>
    api.post<{ triggered: boolean; questionCount: number }>(
      `/master-agent/triage${projectId ? `?projectId=${projectId}` : ''}`,
      {},
    ),
  triggerStatusReport: (projectId?: string) =>
    api.post<{ sent: boolean }>(
      `/master-agent/status-report${projectId ? `?projectId=${projectId}` : ''}`,
      {},
    ),
};

/** Campos patcháveis da automação (MT-2) — mesmo shape do `SchedulingConfig` do backend. */
export interface MasterSchedulingFields {
  /** MT-28 — UM intervalo para as três partes do tick, no lugar de um por parte. */
  tickIntervalMinutes: number;
  autoTriageEnabled: boolean;
  repromptAfterMs: number;
  sessionCheckEnabled: boolean;
  stalledAfterMinutes: number;
  statusReportEnabled: boolean;
  /** MT-27 — auto-start da próxima macro task pendente e reciclagem do terminal do Master. */
  autoStartEnabled: boolean;
  autoStartMaxPerTick: number;
  contextRecycleEnabled: boolean;
  contextRecycleAfterTicks: number;
}

export interface MasterScheduling extends MasterSchedulingFields {
  lastSessionCheckAt?: string | null;
  /**
   * MT-28 — próximo tick, um horário só. Eram três (um por parte), todos
   * arredondados pra cima no múltiplo do tick porque cada parte esperava o
   * vencimento do intervalo dela. `null` = nenhuma parte ligada, nada a prometer.
   */
  nextTick?: string | null;
  /** Master DESTE projeto de pé agora? (MT-20) Automação continua valendo sem ele — só a parte de backend do tick roda. */
  masterActive?: boolean;
}

/** Resposta do PATCH — o usuário precisa ver que o save pegou (config efetiva + próximo tick). */
export interface MasterSchedulingSaveResult {
  config: MasterSchedulingFields;
  changed: boolean;
  lastSessionCheckAt: string | null;
  nextTick: string | null;
}

export interface GitBranchInfo {
  name: string;
  current: boolean;
  merged: boolean;
  lastCommit: { hash: string; message: string; author: string; date: string } | null;
  aheadBehind: { ahead: number; behind: number } | null;
}

export interface GitOverview {
  repoPath: string;
  currentBranch: string;
  mainBranch: string;
  branches: GitBranchInfo[];
  worktrees: Array<{ worktree: string; branch?: string; HEAD?: string }>;
  recentMerges: Array<{ hash: string; message: string; author: string; date: string }>;
}

// Arquivos de agentes/commands dos CLIs de IA no repo do projeto (agnóstico:
// target claude → .claude/agents|commands, opencode → .opencode/agent|command)
// + biblioteca global (~/.orchestr/defaults) reutilizável entre projetos.
export type CliFileKind = 'agents' | 'commands';
export type CliFileTarget = 'claude' | 'opencode';

export interface CliMdFile {
  fileName: string;
  name: string;
  description: string | null;
  content: string;
  size: number;
  updatedAt: string;
  truncated: boolean;
}

export interface CliFileTargetListing {
  target: CliFileTarget;
  dir: string;
  exists: boolean;
  files: CliMdFile[];
}

export interface CliFileProjectListing {
  kind: CliFileKind;
  root: string;
  targets: CliFileTargetListing[];
}

export interface CliLibraryListing {
  kind: CliFileKind;
  dir: string;
  exists: boolean;
  files: CliMdFile[];
}

export const cliFilesApi = {
  list: (projectId: string, kind: CliFileKind) =>
    api.get<CliFileProjectListing>(`/projects/${projectId}/cli-files/${kind}`),
  write: (
    projectId: string,
    kind: CliFileKind,
    target: CliFileTarget,
    fileName: string,
    content: string,
  ) =>
    api.put<CliMdFile>(
      `/projects/${projectId}/cli-files/${kind}/${target}/${encodeURIComponent(fileName)}`,
      { content },
    ),
  delete: (projectId: string, kind: CliFileKind, target: CliFileTarget, fileName: string) =>
    api.delete<{ deleted: string; target: CliFileTarget }>(
      `/projects/${projectId}/cli-files/${kind}/${target}/${encodeURIComponent(fileName)}`,
    ),
};

export const cliLibraryApi = {
  list: (kind: CliFileKind) => api.get<CliLibraryListing>(`/cli-library/${kind}`),
  save: (kind: CliFileKind, fileName: string, content: string) =>
    api.put<CliMdFile>(`/cli-library/${kind}/${encodeURIComponent(fileName)}`, { content }),
  delete: (kind: CliFileKind, fileName: string) =>
    api.delete<{ deleted: string }>(`/cli-library/${kind}/${encodeURIComponent(fileName)}`),
};

// Skills são pastas completas (SKILL.md + scripts/templates). Inject e
// save-to-library copiam a pasta inteira no servidor.
export interface SkillFileEntry {
  path: string;
  size: number;
}

export interface CliSkill {
  dirName: string;
  name: string;
  description: string | null;
  files: SkillFileEntry[];
  fileCount: number;
  totalSize: number;
  updatedAt: string;
}

export interface SkillProjectListing {
  root: string;
  targets: Array<{ target: CliFileTarget; dir: string; exists: boolean; skills: CliSkill[] }>;
}

export interface SkillFileContent {
  path: string;
  size: number;
  truncated: boolean;
  content: string;
}

export const cliSkillsApi = {
  list: (projectId: string) =>
    api.get<SkillProjectListing>(`/projects/${projectId}/cli-files/skills`),
  readFile: (projectId: string, target: CliFileTarget, dirName: string, path: string) =>
    api.get<SkillFileContent>(
      `/projects/${projectId}/cli-files/skills/${target}/${encodeURIComponent(dirName)}/file?path=${encodeURIComponent(path)}`,
    ),
  writeFile: (
    projectId: string,
    target: CliFileTarget,
    dirName: string,
    path: string,
    content: string,
  ) =>
    api.put<SkillFileContent>(
      `/projects/${projectId}/cli-files/skills/${target}/${encodeURIComponent(dirName)}/file`,
      { path, content },
    ),
  create: (projectId: string, target: CliFileTarget, dirName: string, content: string) =>
    api.put<CliSkill>(
      `/projects/${projectId}/cli-files/skills/${target}/${encodeURIComponent(dirName)}`,
      { content },
    ),
  inject: (projectId: string, target: CliFileTarget, dirName: string, overwrite = false) =>
    api.post<CliSkill>(
      `/projects/${projectId}/cli-files/skills/${target}/${encodeURIComponent(dirName)}/inject`,
      { overwrite },
    ),
  saveToLibrary: (projectId: string, target: CliFileTarget, dirName: string, overwrite = false) =>
    api.post<CliSkill>(
      `/projects/${projectId}/cli-files/skills/${target}/${encodeURIComponent(dirName)}/save-to-library`,
      { overwrite },
    ),
  delete: (projectId: string, target: CliFileTarget, dirName: string) =>
    api.delete<{ deleted: string }>(
      `/projects/${projectId}/cli-files/skills/${target}/${encodeURIComponent(dirName)}`,
    ),
};

export const cliSkillsLibraryApi = {
  list: () => api.get<{ dir: string; exists: boolean; skills: CliSkill[] }>(`/cli-library/skills`),
  readFile: (dirName: string, path: string) =>
    api.get<SkillFileContent>(
      `/cli-library/skills/${encodeURIComponent(dirName)}/file?path=${encodeURIComponent(path)}`,
    ),
  delete: (dirName: string) =>
    api.delete<{ deleted: string }>(`/cli-library/skills/${encodeURIComponent(dirName)}`),
};

export const gitApi = {
  overview: (projectId: string) => api.get<GitOverview>(`/git/overview?projectId=${projectId}`),
  log: (projectId: string, branch?: string, limit?: number) => {
    const params = new URLSearchParams({ projectId });
    if (branch) params.set('branch', branch);
    if (limit !== undefined) params.set('limit', String(limit));
    return api.get<Array<{ hash: string; message: string; author: string; date: string; refs: string }>>(
      `/git/log?${params}`,
    );
  },
  diff: (projectId: string, branch: string) =>
    api.get<{
      base: string;
      branch: string;
      shortstat: string;
      files: Array<{ status: string; path: string }>;
    }>(`/git/diff?projectId=${projectId}&branch=${encodeURIComponent(branch)}`),
};

export interface CliProfile {
  id: string;
  name: string;
  binary: string;
  interactiveArgs: string[];
  resumeArgs?: string[] | null;
  mcpConfigFile: string;
  mcpConfigTemplate: any;
  env?: Record<string, string> | null;
  defaultModel?: string | null;
  builtin: boolean;
  isDefault?: boolean;
  createdAt: string;
  updatedAt: string;
}

export const cliProfilesApi = {
  list: () => api.get<CliProfile[]>('/cli-profiles'),
  get: (id: string) => api.get<CliProfile>(`/cli-profiles/${id}`),
  create: (data: Partial<CliProfile>) => api.post<CliProfile>('/cli-profiles', data),
  update: (id: string, data: Partial<CliProfile>) =>
    api.patch<CliProfile>(`/cli-profiles/${id}`, data),
  setGlobalDefault: (id: string) => api.patch<CliProfile>(`/cli-profiles/${id}`, { isDefault: true }),
  delete: (id: string) => api.delete<void>(`/cli-profiles/${id}`),
};

/** Item da LISTAGEM de contexto: só metadados (sem `content` — vem sob demanda). */
export interface ContextFileMeta {
  id: string;
  name: string;
  relativePath: string;
  description: string;
  status: 'updated' | 'stale';
  updatedAt: string;
  size: string;
}

export interface ContextFilesResponse {
  qmd: ContextFileMeta[];
  context: ContextFileMeta[];
  rules: ContextFileMeta[];
  projectId: string;
  root: string;
  rootExists: boolean;
  search?: string;
}

export interface ContextFileContent {
  fileId: string;
  relativePath: string;
  content: string;
  truncated: boolean;
}

export const contextApi = {
  /** Só metadados. `search` filtra server-side (case-insensitive, path + conteúdo). */
  getFiles: (projectId?: string, search?: string) => {
    const params = new URLSearchParams();
    if (projectId) params.set('projectId', projectId);
    if (search) params.set('search', search);
    const qs = params.toString();
    return api.get<ContextFilesResponse>(`/context/files${qs ? `?${qs}` : ''}`);
  },
  /** Conteúdo de UM arquivo, sob demanda. */
  getFileContent: (fileId: string, projectId?: string) =>
    api.get<ContextFileContent>(
      `/context/files/${fileId}/content${projectId ? `?projectId=${projectId}` : ''}`
    ),
  search: (query: string, projectId?: string) => {
    const params = new URLSearchParams({ q: query });
    if (projectId) params.set('projectId', projectId);
    return api.get<any>(`/context/search?${params.toString()}`);
  },
  updateFile: (fileId: string, content: string, projectId?: string) =>
    api.post<any>(`/context/files/${fileId}`, { content, projectId }),
  /**
   * Enfileira a geração da regra no Master Agent — assíncrono: o Master escreve
   * o arquivo no projeto sozinho. `queued:false` vem com o motivo em `message`
   * (Master desligado, ou Master ativo em outro projeto).
   */
  generateRule: (description: string, projectId?: string) =>
    api.post<{ queued: boolean; message: string }>('/context/generate-rule', { description, projectId }),
  /** Estado do índice do qmd (MT-6): frescor, último embed, fila. */
  qmdStatus: (projectId?: string) =>
    api.get<QmdIndexStatus>(`/context/qmd-status${projectId ? `?projectId=${projectId}` : ''}`),
  /**
   * Pede um reindex. NUNCA roda com sessão viva — nesse caso volta `queued` com
   * `willRunAfter`, e o embed só começa depois da última sessão terminar.
   */
  reindex: (projectId?: string, reason: QmdEmbedReason = 'manual') =>
    api.post<QmdReindexOutcome>('/context/reindex', { projectId, reason }),
};

export type QmdEmbedReason = 'pre-wave' | 'post-wave' | 'manual';

/** Espelha `QmdIndexStatus` de `backend/src/context/qmd-embed.service.ts`. */
export interface QmdIndexStatus {
  cliAvailable: boolean;
  indexed: boolean;
  collections: string[];
  documents: number;
  vectors: number;
  /** Docs indexados ainda sem embedding — `vectors > 0` com `pending` alto é índice pela metade. */
  pending: number;
  indexUpdatedLabel: string | null;
  freshness: 'fresh' | 'stale' | 'unknown';
  lastEmbedAt: string | null;
  lastEmbedReason: QmdEmbedReason | null;
  lastEmbedOk: boolean | null;
  lastEmbedError: string | null;
  running: { since: string; reason: QmdEmbedReason } | null;
  queued: { jobId: string; scheduledAt: string; reason: QmdEmbedReason } | null;
  activeSessions: number;
}

export interface QmdReindexOutcome {
  status: 'started' | 'queued' | 'skipped';
  reason: string;
  willRunAfter?: string;
  jobId?: string;
}

export interface TmuxSessionInfo {
  name: string;
  createdAt: string | null;
  attached: boolean;
  /** true = tem Session no banco (ou é a tmux do Master); false = terminal externo. */
  managed: boolean;
  sessionId?: string;
  sessionStatus?: string;
  isMaster?: boolean;
}

export const terminalApi = {
  execute: (sessionId: string, command: string) =>
    api.post<{ success: boolean; stdout: string; stderr: string; exitCode: number }>(
      `/terminal/${sessionId}/execute`,
      { command }
    ),
  open: (sessionId: string) =>
    api.post<{
      success: boolean;
      path: string;
      tmuxSession?: string;
      command?: string;
      message?: string;
    }>(`/terminal/${sessionId}/open`, {}),
  /** Lista TODAS as tmux sessions da máquina (managed + externas). */
  listTmuxSessions: () => api.get<{ sessions: TmuxSessionInfo[] }>('/terminal/tmux-sessions'),
};

export interface MasterAgentStats {
  sessions: { total: number; active: number };
  tasks: number;
  questions: number;
  agents: number;
}

export interface Decision {
  id: string;
  type: string;
  text: string;
  time: string;
  sessionId?: string;
}

export interface ActiveTask {
  id: string;
  title: string;
  status: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Notificações
// ─────────────────────────────────────────────────────────────────────────────

export interface NotificationSettings {
  id: string;
  enabled: boolean;
  /** Base pública da UI usada no link da notificação (ex. http://192.168.1.48:3000). */
  publicBaseUrl: string | null;
  dedupeWindowSec: number;
  ntfyEnabled: boolean;
  ntfyServerUrl: string;
  ntfyTopic: string | null;
  ntfyToken: string | null;
  webhookEnabled: boolean;
  webhookUrl: string | null;
  webhookSecret: string | null;
  notifyQuestion: boolean;
  notifyEscalation: boolean;
  notifyStalled: boolean;
  notifyStageFailed: boolean;
  notifySessionFailed: boolean;
  notifySessionCompleted: boolean;
  updatedAt?: string;
}

export interface NotificationTestResult {
  sink: string;
  ok: boolean;
  error?: string;
}

export const notificationsApi = {
  getSettings: () => api.get<NotificationSettings>('/notifications/settings'),
  updateSettings: (patch: Partial<NotificationSettings>) =>
    api.put<NotificationSettings>('/notifications/settings', patch),
  /**
   * `ok: false` com `results` preenchido é o caso interessante: o canal
   * respondeu e recusou (tópico errado, token inválido), e o motivo está no
   * `error` de cada sink.
   */
  test: () =>
    api.post<{ ok: boolean; results: NotificationTestResult[] }>(
      '/notifications/test',
      {},
    ),
};
