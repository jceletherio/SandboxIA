/**
 * Contrato do `ScheduledJob` de tipo `master_loop`.
 *
 * `master_loop` é o agendamento "de usuário": um texto livre de instruções que o
 * orquestrador cola no terminal interativo do Master Agent na hora marcada,
 * opcionalmente em loop com rate-limit (`repeatIntervalMinutes` + `maxRuns`).
 *
 * NÃO existe coluna nova no banco: `ScheduledJob.type` é string livre e
 * `ScheduledJob.payload` é `Json`. Todo o shape abaixo mora dentro do `payload`.
 *
 * ```jsonc
 * {
 *   "type": "master_loop",
 *   "scheduledAt": "2026-08-01T12:00:00.000Z",  // primeira execução
 *   "status": "pending",                        // 'disabled' = pausado pelo humano
 *   "payload": {
 *     "instructions": "Revise as sessões travadas e me avise no chat",
 *     "projectId": "uuid-do-projeto",   // OBRIGATÓRIO — evita disparar no projeto errado
 *     "repeatIntervalMinutes": 60,      // ausente = executa uma única vez
 *     "maxRuns": 3,                     // ausente + repeat presente = repete indefinidamente
 *     "runCount": 0,                    // o scheduler incrementa a cada disparo
 *     "lastRunAt": "2026-08-01T12:00:03.000Z",
 *     "lastError": "Master Agent terminal is not running",  // motivo do último adiamento
 *     "deferCount": 0                   // adiamentos consecutivos (Master fora do ar)
 *   }
 * }
 * ```
 *
 * Ciclo de vida (ver `SchedulerService.handleMasterLoop`):
 * - disparo OK + ainda há execuções → volta para `pending` com `scheduledAt = agora + repeatIntervalMinutes`
 * - disparo OK + `runCount >= maxRuns` (ou sem recorrência) → `completed`
 * - Master desligado / em outro projeto → **não** consome execução: reagenda com
 *   backoff e grava o motivo em `payload.lastError`
 * - payload inválido, ou adiado mais de `MASTER_LOOP_MAX_DEFERRALS` vezes seguidas → `failed`
 */
export const MASTER_LOOP_JOB_TYPE = 'master_loop';

/** Backoff quando o Master está fora do ar e o job não é recorrente. */
export const MASTER_LOOP_DEFER_BACKOFF_MINUTES = 5;

/**
 * Teto de adiamentos consecutivos. Evita um job pendente eternamente quando o
 * Master nunca volta (24 × 5 min ≈ 2 h de tolerância no caso não recorrente).
 */
export const MASTER_LOOP_MAX_DEFERRALS = 24;

export interface MasterLoopPayload {
  /** Texto livre do usuário — vai como prompt para o terminal do Master. */
  instructions: string;
  /** Projeto dono do agendamento. O disparo é abortado se o Master estiver em outro. */
  projectId: string;
  /** Intervalo entre execuções. Ausente = executa uma única vez. */
  repeatIntervalMinutes?: number;
  /** Limite de execuções (rate-limit). Ausente com recorrência = indefinido. */
  maxRuns?: number;
  /** Quantas execuções já foram disparadas com sucesso. Começa em 0. */
  runCount: number;
  /** ISO do último disparo bem-sucedido. */
  lastRunAt?: string;
  /** Motivo do último adiamento/erro não fatal. */
  lastError?: string;
  /** Adiamentos consecutivos (zerado a cada disparo bem-sucedido). */
  deferCount?: number;
}

export interface MasterLoopInput {
  instructions: string;
  projectId: string;
  repeatIntervalMinutes?: number;
  maxRuns?: number;
}

function asPositiveInt(value: unknown, field: string, problems: string[]): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    problems.push(`${field} must be an integer >= 1`);
    return undefined;
  }
  return parsed;
}

/**
 * Valida o payload de um `master_loop` vindo do cliente (UI, HTTP ou MCP) e
 * devolve a versão normalizada. `runCount` NUNCA vem do cliente: é forçado a
 * partir de `previousRunCount` (0 na criação).
 *
 * Lança `Error` com todos os problemas concatenados — quem chama traduz para
 * `BadRequestException`.
 */
export function validateMasterLoopPayload(
  raw: unknown,
  previousRunCount = 0,
): MasterLoopPayload {
  const problems: string[] = [];
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

  const instructions = typeof source.instructions === 'string' ? source.instructions.trim() : '';
  if (!instructions) problems.push('instructions is required and cannot be empty');

  const projectId = typeof source.projectId === 'string' ? source.projectId.trim() : '';
  if (!projectId) problems.push('projectId is required');

  const repeatIntervalMinutes = asPositiveInt(
    source.repeatIntervalMinutes,
    'repeatIntervalMinutes',
    problems,
  );
  const maxRuns = asPositiveInt(source.maxRuns, 'maxRuns', problems);

  if (problems.length > 0) {
    throw new Error(`Invalid master_loop payload: ${problems.join('; ')}`);
  }

  const payload: MasterLoopPayload = {
    instructions,
    projectId,
    runCount: Number.isInteger(previousRunCount) && previousRunCount > 0 ? previousRunCount : 0,
  };
  if (repeatIntervalMinutes !== undefined) payload.repeatIntervalMinutes = repeatIntervalMinutes;
  if (maxRuns !== undefined) payload.maxRuns = maxRuns;
  if (typeof source.lastRunAt === 'string') payload.lastRunAt = source.lastRunAt;
  return payload;
}

/**
 * Leitura tolerante do payload já persistido (uso do scheduler). Não valida —
 * só normaliza tipos; a validação de execução é feita pelo próprio handler.
 */
export function readMasterLoopPayload(raw: unknown): MasterLoopPayload {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const runCount = Number(source.runCount);
  return {
    instructions: typeof source.instructions === 'string' ? source.instructions : '',
    projectId: typeof source.projectId === 'string' ? source.projectId : '',
    repeatIntervalMinutes:
      typeof source.repeatIntervalMinutes === 'number' ? source.repeatIntervalMinutes : undefined,
    maxRuns: typeof source.maxRuns === 'number' ? source.maxRuns : undefined,
    runCount: Number.isInteger(runCount) && runCount > 0 ? runCount : 0,
    lastRunAt: typeof source.lastRunAt === 'string' ? source.lastRunAt : undefined,
    lastError: typeof source.lastError === 'string' ? source.lastError : undefined,
    deferCount: typeof source.deferCount === 'number' ? source.deferCount : 0,
  };
}

/** Rótulo do total de execuções para logs e prompts: `3`, `∞` ou `1`. */
export function masterLoopRunsLabel(payload: MasterLoopPayload): string {
  if (payload.maxRuns) return String(payload.maxRuns);
  return payload.repeatIntervalMinutes ? '∞' : '1';
}
