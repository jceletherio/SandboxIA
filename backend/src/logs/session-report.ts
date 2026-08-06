/**
 * Report de sessão DERIVADO — nada aqui é instrumentado de dentro da sessão.
 *
 * Motivo de existir: a telemetria antiga (`.claude/skills/sdd/telemetry/`, hook
 * `PostToolUse` + `analyze.py`) media a sessão de dentro, custando token e um
 * gate a mais em cada tool call. Tudo o que ela produzia de útil o orquestrador
 * já registra de fora, de graça, em 4 lugares:
 *
 * - `session.stageData[stage]` → `completedAt`, `summary`, `source`, `resumedFrom`
 *   (gravado em `pipeline-engine.service.ts:583` e `:712`)
 * - `session.stageData._resume` → herança de uma sessão anterior (`:329`)
 * - `log_entries` com `metadata.kind = 'runtime-profile'` → model/cliProfile/
 *   provenance de cada boot do CLI (`session-runtime.service.ts:803`)
 * - `questions` e `sdd_artifacts` → decisões e produto da sessão
 *
 * Módulo PURO de propósito (sem Nest, sem Prisma em runtime): a aritmética de
 * duração e a classificação de stage são exatamente o tipo de lógica que falha
 * em silêncio — um `undefined` numa data vira `NaN` e a página mostra número
 * errado sem erro nenhum. É o que os testes cobrem.
 */

/** Subconjunto de `LogEntry` que este módulo lê. Estruturalmente compatível. */
export interface LogEntryLike {
  message: string;
  level?: string;
  createdAt: Date | string;
  metadata?: unknown;
}

/** Subconjunto de `Question`. */
export interface QuestionLike {
  id: string;
  question: string;
  status: string;
  createdAt: Date | string;
  answeredAt?: Date | string | null;
  metadata?: unknown;
}

/** Subconjunto de `SDDArtifact`. */
export interface ArtifactLike {
  id: string;
  type: string;
  path: string;
  content?: string | null;
  createdAt: Date | string;
}

/** Subconjunto de `Session` + relações que o report precisa. */
export interface SessionLike {
  id: string;
  branchName: string;
  status: string;
  currentStage: string;
  stageData?: unknown;
  startedAt: Date | string;
  completedAt?: Date | string | null;
  macroTask?: {
    id?: string;
    title?: string;
    pipeline?: { name?: string | null } | null;
  } | null;
}

export interface SessionReportInput {
  session: SessionLike;
  /** Ordem irrelevante: o módulo ordena o que precisa. */
  logs: LogEntryLike[];
  questions: QuestionLike[];
  artifacts: ArtifactLike[];
  /** Nomes de stage na ordem do pipeline. Vazio = deriva do que foi observado. */
  stageNames?: string[];
}

/**
 * `completed` o agente fechou; `skipped` humano pulou; `inherited` veio pronto de
 * uma sessão anterior via resume; `running` é o stage atual de sessão viva;
 * `failed` a sessão morreu nele; `pending` nunca começou.
 */
export type StageStatus =
  | 'completed'
  | 'skipped'
  | 'inherited'
  | 'running'
  | 'failed'
  | 'pending';

export interface StageReport {
  name: string;
  status: StageStatus;
  startedAt: string | null;
  completedAt: string | null;
  /** `null` quando falta uma das duas pontas — nunca 0 ou NaN por chute. */
  durationMs: number | null;
  /** Quantas vezes o stage começou. > 1 = foi refeito (retry). */
  attempts: number;
  summary: string | null;
  model: string | null;
  cliProfile: string | null;
  /** `describeProvenance()` do boot que atendeu este stage (§3 dos contratos). */
  provenance: string | null;
}

export interface QuestionReport {
  id: string;
  question: string;
  status: string;
  /** `human` | `master-agent` | `null` se ainda aberta ou sem registro. */
  answeredBy: string | null;
  createdAt: string;
  answeredAt: string | null;
  /** Tempo até a resposta. `null` enquanto aberta. */
  waitMs: number | null;
}

export interface MergeReport {
  status: 'merged' | 'conflict' | 'pending';
  mainBranch: string | null;
  mergedAt: string | null;
  conflicts: string[];
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
  /** Sessão viva não tem duração final: `null`, e a UI mostra "em curso". */
  durationMs: number | null;
  stages: StageReport[];
  /** O stage que mais consumiu tempo nesta sessão. */
  slowestStage: { name: string; durationMs: number } | null;
  counts: {
    stages: number;
    completed: number;
    skipped: number;
    inherited: number;
    /** Stages que rodaram mais de uma vez. */
    retried: number;
    artifacts: number;
    questionsOpen: number;
    questionsAnswered: number;
    /** Respondidas por humano — o custo que a onda impôs a uma pessoa. */
    questionsHuman: number;
  };
  resume: {
    fromSessionId: string | null;
    fromStatus: string | null;
    interruptedStage: string | null;
    resumedAt: string | null;
    inheritedStages: string[];
  } | null;
  questions: QuestionReport[];
  artifacts: Array<{ id: string; type: string; path: string; createdAt: string }>;
  merge: MergeReport;
}

/**
 * Prefixo da mensagem de início de stage (`pipeline-engine.service.ts:358`).
 *
 * É o ÚNICO ponto onde este módulo depende do texto de um log em vez de
 * `metadata` — e depende porque não há alternativa: `metadata` do "Starting
 * stage" e do "Stage completed" é o mesmo `{ stage }`, então só a mensagem
 * distingue os dois. Se aquela linha mudar, o report perde `startedAt` e
 * `attempts` (cai para `null`/1), não quebra. Mudou? Ajuste aqui.
 */
const STAGE_START_PREFIX = 'Starting stage: ';

/** Status de sessão em que ela ainda pode andar. */
const LIVE_STATUSES = ['initializing', 'running', 'waiting', 'paused'];

/** Datas vêm como `Date` do Prisma e como string do JSON. Normaliza as duas. */
function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Duração entre duas pontas. Devolve `null` — não 0 — quando falta uma ponta ou
 * a ordem está invertida: um número inventado ali contamina a mediana da onda
 * inteira sem deixar rastro.
 */
export function durationBetween(
  start: string | null,
  end: string | null,
): number | null {
  if (!start || !end) return null;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

/** Objeto simples ou nada. `Json` do Prisma não é tipado — trate como hostil. */
function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/**
 * Chaves de `stageData` que NÃO são stage: o Json mistura os stages com estado
 * de controle do engine. Sem esta lista, `_resume` viraria um stage no report.
 */
const STAGE_DATA_CONTROL_KEYS = [
  '_resume',
  '_runtime',
  'nextStage',
  'pauseReason',
  'pausedAt',
  'progress',
  'awaiting',
];

function isControlKey(key: string): boolean {
  return STAGE_DATA_CONTROL_KEYS.includes(key) || key.endsWith('_error');
}

/** Boot de CLI extraído de `log_entries` (`metadata.kind = 'runtime-profile'`). */
interface RuntimeBoot {
  at: string;
  phase: string | null;
  model: string | null;
  cliProfile: string | null;
  provenance: string | null;
}

function readRuntimeBoots(logs: LogEntryLike[]): RuntimeBoot[] {
  const boots: RuntimeBoot[] = [];
  for (const entry of logs) {
    const metadata = asRecord(entry.metadata);
    if (!metadata || metadata.kind !== 'runtime-profile') continue;
    const at = toIso(entry.createdAt);
    if (!at) continue;
    boots.push({
      at,
      phase: asString(metadata.phase),
      model: asString(metadata.model),
      cliProfile: asString(metadata.cliProfileName),
      provenance: asString(metadata.provenance),
    });
  }
  return boots.sort((a, b) => a.at.localeCompare(b.at));
}

/**
 * Qual CLI atendeu um stage. Prefere o boot que declarou a fase (`phase`, que a
 * MT-4 grava no stamp); sem isso, cai no último boot que aconteceu ANTES do
 * stage terminar — um stage que não reiniciou o CLI herda o boot anterior, que
 * é justamente o CLI que o executou.
 */
function bootForStage(
  boots: RuntimeBoot[],
  stageName: string,
  startedAt: string | null,
  completedAt: string | null,
): RuntimeBoot | null {
  const byPhase = boots.filter((boot) => boot.phase === stageName);
  if (byPhase.length > 0) return byPhase[byPhase.length - 1];

  const limit = completedAt ?? startedAt;
  if (!limit) return null;
  const before = boots.filter((boot) => boot.at <= limit);
  return before.length > 0 ? before[before.length - 1] : null;
}

/** Início e nº de tentativas de cada stage, lidos dos logs de "Starting stage". */
function readStageStarts(logs: LogEntryLike[]): Map<string, string[]> {
  const starts = new Map<string, string[]>();
  for (const entry of logs) {
    if (typeof entry.message !== 'string') continue;
    if (!entry.message.startsWith(STAGE_START_PREFIX)) continue;
    // `metadata.stage` é a fonte preferida; a mensagem é o fallback para log
    // gravado antes de o metadata existir.
    const stage =
      asString(asRecord(entry.metadata)?.stage) ??
      asString(entry.message.slice(STAGE_START_PREFIX.length).trim());
    const at = toIso(entry.createdAt);
    if (!stage || !at) continue;
    const list = starts.get(stage) ?? [];
    list.push(at);
    starts.set(stage, list);
  }
  for (const list of starts.values()) list.sort((a, b) => a.localeCompare(b));
  return starts;
}

/**
 * Resultado do merge. Sucesso deixa um artefato `type: 'merge'`
 * (`pipeline-engine.service.ts:962`); conflito não deixa artefato nenhum, ele
 * escala uma `Question`. Então "sem artefato + question de conflito aberta" é
 * conflito, e "sem nenhum dos dois" é simplesmente que a sessão não chegou lá.
 */
export function readMerge(
  artifacts: ArtifactLike[],
  questions: QuestionLike[],
): MergeReport {
  const mergeArtifact = artifacts
    .filter((artifact) => artifact.type === 'merge')
    .sort((a, b) => (toIso(a.createdAt) ?? '').localeCompare(toIso(b.createdAt) ?? ''))
    .pop();

  if (mergeArtifact) {
    let mergedAt = toIso(mergeArtifact.createdAt);
    let mainBranch: string | null = asString(mergeArtifact.path);
    // O `content` é o JSON gravado pelo engine; se estiver podre, o artefato
    // ainda prova que o merge aconteceu — não descarte o report por isso.
    try {
      const content = asRecord(JSON.parse(mergeArtifact.content ?? ''));
      mainBranch = asString(content?.mainBranch) ?? mainBranch;
      mergedAt = asString(content?.mergedAt) ?? mergedAt;
    } catch {
      // formato inesperado: fica com path/createdAt
    }
    return { status: 'merged', mainBranch, mergedAt, conflicts: [] };
  }

  const conflictQuestion = questions.find((question) => {
    const metadata = asRecord(question.metadata);
    return metadata?.kind === 'merge-conflict' || metadata?.stage === 'Merge';
  });
  if (conflictQuestion) {
    const metadata = asRecord(conflictQuestion.metadata);
    const conflicts = Array.isArray(metadata?.conflicts)
      ? (metadata.conflicts as unknown[]).filter((c): c is string => typeof c === 'string')
      : [];
    return {
      status: 'conflict',
      mainBranch: asString(metadata?.mainBranch),
      mergedAt: null,
      conflicts,
    };
  }

  return { status: 'pending', mainBranch: null, mergedAt: null, conflicts: [] };
}

/**
 * Ordem dos stages: a do pipeline quando ela vem; senão a ordem em que os
 * stages terminaram, para uma sessão cujo pipeline mudou ou sumiu. Stage
 * observado no `stageData` mas ausente do pipeline entra no fim em vez de
 * desaparecer — perder um stage que rodou de fato é pior que mostrar um extra.
 */
function orderStageNames(
  stageNames: string[] | undefined,
  stageData: Record<string, unknown>,
  starts: Map<string, string[]>,
): string[] {
  const observed = [
    ...Object.keys(stageData).filter((key) => !isControlKey(key)),
    ...starts.keys(),
  ];
  const ordered = [...(stageNames ?? [])];
  for (const name of observed) {
    if (!ordered.includes(name)) ordered.push(name);
  }
  return ordered;
}

/** Monta o report de UMA sessão. Não lança e não muta a entrada. */
export function buildSessionReport(input: SessionReportInput): SessionReport {
  const { session, logs, questions, artifacts } = input;
  const stageData = asRecord(session.stageData) ?? {};
  const starts = readStageStarts(logs);
  const boots = readRuntimeBoots(logs);

  const startedAt = toIso(session.startedAt) ?? new Date(0).toISOString();
  const completedAt = toIso(session.completedAt);
  const isLive = LIVE_STATUSES.includes(session.status);

  const resumeRaw = asRecord(stageData._resume);
  const inheritedStages = Object.entries(stageData)
    .filter(([key, value]) => !isControlKey(key) && asRecord(value)?.resumedFrom)
    .map(([key]) => key);
  const resume = resumeRaw
    ? {
        fromSessionId: asString(resumeRaw.fromSessionId),
        fromStatus: asString(resumeRaw.fromStatus),
        interruptedStage: asString(resumeRaw.interruptedStage),
        resumedAt: asString(resumeRaw.resumedAt),
        inheritedStages,
      }
    : null;

  const stages: StageReport[] = orderStageNames(input.stageNames, stageData, starts).map(
    (name) => {
      const data = asRecord(stageData[name]);
      const stageStarts = starts.get(name) ?? [];
      const stageCompletedAt = asString(data?.completedAt);
      const source = asString(data?.source);
      const inherited = !!asString(data?.resumedFrom);

      // Stage herdado não rodou nesta sessão: seu `startedAt` é da sessão
      // anterior e cronometrá-lo aqui inflaria a duração desta.
      const stageStartedAt = inherited ? null : (stageStarts[0] ?? null);

      let status: StageStatus;
      if (inherited) status = 'inherited';
      else if (source === 'skip') status = 'skipped';
      else if (stageCompletedAt) status = 'completed';
      else if (name === session.currentStage) status = isLive ? 'running' : 'failed';
      else status = 'pending';

      const boot = bootForStage(boots, name, stageStartedAt, stageCompletedAt);
      return {
        name,
        status,
        startedAt: stageStartedAt,
        completedAt: stageCompletedAt,
        durationMs: inherited
          ? null
          : durationBetween(stageStartedAt, stageCompletedAt),
        attempts: stageStarts.length,
        summary: asString(data?.summary),
        model: boot?.model ?? null,
        cliProfile: boot?.cliProfile ?? null,
        provenance: boot?.provenance ?? null,
      };
    },
  );

  const timedStages = stages.filter(
    (stage): stage is StageReport & { durationMs: number } => stage.durationMs !== null,
  );
  const slowest = timedStages.reduce<(StageReport & { durationMs: number }) | null>(
    (worst, stage) => (!worst || stage.durationMs > worst.durationMs ? stage : worst),
    null,
  );

  const questionReports: QuestionReport[] = questions
    .map((question) => {
      const createdAt = toIso(question.createdAt);
      const answeredAt = toIso(question.answeredAt);
      return {
        id: question.id,
        question: question.question,
        status: question.status,
        answeredBy: asString(asRecord(question.metadata)?.answeredBy),
        createdAt: createdAt ?? startedAt,
        answeredAt,
        waitMs: durationBetween(createdAt, answeredAt),
      };
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return {
    sessionId: session.id,
    macroTaskId: session.macroTask?.id ?? null,
    macroTaskTitle: asString(session.macroTask?.title),
    pipelineName: asString(session.macroTask?.pipeline?.name),
    branch: session.branchName,
    status: session.status,
    currentStage: session.currentStage,
    startedAt,
    completedAt,
    durationMs: durationBetween(startedAt, completedAt),
    stages,
    slowestStage: slowest ? { name: slowest.name, durationMs: slowest.durationMs } : null,
    counts: {
      stages: stages.length,
      completed: stages.filter((stage) => stage.status === 'completed').length,
      skipped: stages.filter((stage) => stage.status === 'skipped').length,
      inherited: stages.filter((stage) => stage.status === 'inherited').length,
      retried: stages.filter((stage) => stage.attempts > 1).length,
      artifacts: artifacts.length,
      questionsOpen: questionReports.filter((q) => q.status === 'pending').length,
      questionsAnswered: questionReports.filter((q) => q.status === 'answered').length,
      questionsHuman: questionReports.filter((q) => q.answeredBy === 'human').length,
    },
    resume,
    questions: questionReports,
    artifacts: artifacts
      .map((artifact) => ({
        id: artifact.id,
        type: artifact.type,
        path: artifact.path,
        createdAt: toIso(artifact.createdAt) ?? startedAt,
      }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    merge: readMerge(artifacts, questions),
  };
}
