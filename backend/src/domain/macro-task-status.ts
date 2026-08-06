/**
 * Vocabulário canônico de `MacroTask.status` (MT-15) — módulo PURO.
 *
 * Antes da MT-15 o status era String livre com TRÊS listas divergentes: o que o
 * engine escreve (`pending`/`running`/`done`/`backlog`), o que a página filtra
 * (`pending|planned|running|review|done`) e o que a tool `update_macro_task`
 * prometia na descrição (`pending|in_progress|completed|cancelled` — nenhum
 * desses três últimos era escrito por ninguém). Status fora da lista da UI
 * gravava sem erro e a macro task sumia da tela — origem da fila stale que a
 * MT-10 registrou.
 *
 * É union TS e não enum Prisma de propósito: a coluna é String com dados
 * legados de valor desconhecido, e a migration só é segura depois deste
 * validador provar em produção que só os 8 entram. Ver `decisoes/mt-15.md`.
 */

export type MacroTaskStatus =
  | 'backlog'
  | 'pending'
  | 'planned'
  | 'running'
  | 'review'
  | 'done'
  | 'failed'
  | 'cancelled';

/** Os 8 canônicos, na ordem do ciclo de vida. Use para montar filtro/UI. */
export const MACRO_TASK_STATUSES: readonly MacroTaskStatus[] = [
  'backlog',
  'pending',
  'planned',
  'running',
  'review',
  'done',
  'failed',
  'cancelled',
] as const;

/**
 * Valores que a descrição antiga da tool `update_macro_task` prometia ao Master.
 * Traduzimos em vez de rejeitar: o Master pode já estar escrevendo `completed`
 * há ondas, e derrubar a escrita no meio de uma onda viva é pior que aceitar o
 * sinônimo. Alias novo aqui é sempre tradução para um dos 8 — nunca um status a
 * mais.
 */
export const MACRO_TASK_STATUS_ALIASES: Readonly<Record<string, MacroTaskStatus>> = {
  in_progress: 'running',
  completed: 'done',
};

export function isMacroTaskStatus(value: unknown): value is MacroTaskStatus {
  return typeof value === 'string' && MACRO_TASK_STATUSES.includes(value as MacroTaskStatus);
}

/**
 * Canoniza um status vindo de fora (MCP tool, import, payload de API).
 * Devolve `null` quando o valor não é canônico nem alias — quem chama decide se
 * isso vira erro 400, `{ error }` de tool ou descarte.
 */
export function normalizeMacroTaskStatus(value: unknown): MacroTaskStatus | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (isMacroTaskStatus(trimmed)) return trimmed;
  return MACRO_TASK_STATUS_ALIASES[trimmed] ?? null;
}

/** Mensagem única de status inválido — a lista dos válidos vai junto, sempre. */
export function invalidMacroTaskStatusMessage(value: unknown): string {
  const received = typeof value === 'string' ? `"${value}"` : String(value);
  return `Invalid macro task status ${received}. Valid: ${MACRO_TASK_STATUSES.join(' | ')}.`;
}

/** Versão que lança — para caminho de escrita onde seguir com lixo é pior que falhar. */
export function assertMacroTaskStatus(value: unknown): MacroTaskStatus {
  const normalized = normalizeMacroTaskStatus(value);
  if (!normalized) throw new Error(invalidMacroTaskStatusMessage(value));
  return normalized;
}
