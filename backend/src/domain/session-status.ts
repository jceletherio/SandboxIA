/**
 * "Sessão viva" em um só lugar (MT-15) — módulo PURO.
 *
 * O conceito estava escrito à mão em 10 lugares com DUAS semânticas que
 * ninguém tinha nomeado: metade das listas contava `paused` como viva, metade
 * não. Isso decide coisas diferentes — se o governor libera slot, se o watchdog
 * mata, se a UI mostra a sessão — e divergir em silêncio é o bug.
 *
 * `session-governor.service.ts` já tinha acertado a distinção; os nomes daqui
 * são os dele.
 *
 * O que acontece com `paused`, explicitamente:
 * - `isSessionAlive('paused') === true`  — a sessão NÃO terminou. Ela ainda
 *   ocupa a macro task, ainda pode ser retomada, e a UI tem de mostrá-la. Quem
 *   decide "posso deletar/recriar isto?" usa este predicate.
 * - `isSessionActive('paused') === false` — uma sessão pausada não tem CLI
 *   rodando, não consome slot nem CPU. Quem decide "cabe mais uma sessão?" ou
 *   "posso rodar o embed agora?" usa este.
 *
 * Regra prática: escolha pelo que a resposta vai comandar. Ocupação de recurso
 * → `isSessionActive`. Existência/ciclo de vida → `isSessionAlive`.
 */
import { SessionStatus } from '@prisma/client';

/** Sessão com CLI de pé: ocupa slot e CPU. Exclui `paused`. */
export const ACTIVE_SESSION_STATUSES: readonly SessionStatus[] = [
  'initializing',
  'running',
  'waiting',
] as const;

/** Sessão que ainda não terminou. Inclui `paused`, que ocupa a macro task sem ocupar slot. */
export const LIVE_SESSION_STATUSES: readonly SessionStatus[] = [
  ...ACTIVE_SESSION_STATUSES,
  'paused',
] as const;

/** Sessão que chegou ao fim, de qualquer jeito. Complemento exato de `isSessionAlive`. */
export const FINISHED_SESSION_STATUSES: readonly SessionStatus[] = [
  'completed',
  'stopped',
  'failed',
  'timeout',
] as const;

/**
 * A sessão ainda não terminou (inclui `paused`).
 * Aceita `string` porque parte dos call sites lê status de payload de evento ou
 * de `select` sem tipo do Prisma.
 */
export function isSessionAlive(status: SessionStatus | string | null | undefined): boolean {
  return LIVE_SESSION_STATUSES.includes(status as SessionStatus);
}

/** A sessão está consumindo slot/CPU agora (exclui `paused`). */
export function isSessionActive(status: SessionStatus | string | null | undefined): boolean {
  return ACTIVE_SESSION_STATUSES.includes(status as SessionStatus);
}

/** Terminou — negação de `isSessionAlive`, exposta com nome próprio para o call site ficar legível. */
export function isSessionFinished(status: SessionStatus | string | null | undefined): boolean {
  return !isSessionAlive(status);
}
