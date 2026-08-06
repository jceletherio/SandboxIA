/**
 * Espelho do vocabulário de estado do backend (MT-15).
 *
 * O canônico é `backend/src/domain/` — `macro-task-status.ts` e
 * `session-status.ts`. Não há pacote compartilhado entre os dois projetos, então
 * a única forma de "fonte única" possível hoje é esta cópia declarada. **Mudou
 * lá? Mude aqui.** Divergir em silêncio é exatamente o bug que a MT-15 fechou:
 * status que o engine escrevia sumia da tela porque a página filtrava por outra
 * lista.
 */

export type MacroTaskStatus =
  | 'backlog'
  | 'pending'
  | 'planned'
  | 'running'
  | 'review'
  | 'done'
  | 'failed'
  | 'cancelled'

/** Os 8 canônicos, na ordem do ciclo de vida. */
export const MACRO_TASK_STATUSES: readonly MacroTaskStatus[] = [
  'backlog',
  'pending',
  'planned',
  'running',
  'review',
  'done',
  'failed',
  'cancelled',
] as const

export function isMacroTaskStatus(value: unknown): value is MacroTaskStatus {
  return typeof value === 'string' && (MACRO_TASK_STATUSES as readonly string[]).includes(value)
}

/**
 * Status de sessão, o mesmo enum `SessionStatus` do Prisma.
 *
 * `paused` é o ponto onde as listas divergiam, e são DUAS perguntas diferentes:
 * - `isSessionAlive('paused') === true` — não terminou; ainda ocupa a macro
 *   task e a UI tem de mostrar.
 * - `isSessionActive('paused') === false` — sem CLI de pé; não consome slot.
 *
 * Escolha pelo que a resposta comanda: ocupação de recurso → `isSessionActive`;
 * existência/ciclo de vida → `isSessionAlive`.
 */
export const ACTIVE_SESSION_STATUSES = ['initializing', 'running', 'waiting'] as const

export const LIVE_SESSION_STATUSES = [...ACTIVE_SESSION_STATUSES, 'paused'] as const

export function isSessionAlive(status: string | null | undefined): boolean {
  return (LIVE_SESSION_STATUSES as readonly string[]).includes(status ?? '')
}

export function isSessionActive(status: string | null | undefined): boolean {
  return (ACTIVE_SESSION_STATUSES as readonly string[]).includes(status ?? '')
}
