/**
 * Registro dos tipos de `ScheduledJob` que existem de verdade.
 *
 * `ScheduledJob.type` é `String` no banco, então até a MT-13 qualquer texto era
 * aceito na escrita: um typo (`stage_timout`) só aparecia 30s depois, como job
 * `failed` com `Unknown job type` — sem ninguém olhando e sem forma de corrigir
 * o registro. Agora a escrita cobra este registro e o `switch` do
 * `SchedulerService.executeJob` sai da MESMA lista, para não existir tipo aceito
 * na criação que ninguém saiba executar.
 *
 * **Adicionou um handler novo no scheduler? Adicione o tipo aqui na mesma
 * mudança** — é o único lugar.
 */
export const SCHEDULED_JOB_TYPES = [
  'session_timeout',
  'stage_timeout',
  'cleanup_worktrees',
  'master_loop',
  'qmd_embed',
] as const;

export type ScheduledJobType = (typeof SCHEDULED_JOB_TYPES)[number];

export function isKnownJobType(type: unknown): type is ScheduledJobType {
  return typeof type === 'string' && (SCHEDULED_JOB_TYPES as readonly string[]).includes(type);
}

/**
 * Cobra o tipo na ESCRITA. Lança `Error` com a lista de válidos — quem chama
 * traduz para `BadRequestException`, no padrão de `validateMasterLoopPayload`.
 */
export function assertKnownJobType(type: unknown): ScheduledJobType {
  if (!isKnownJobType(type)) {
    throw new Error(
      `Unknown scheduled job type "${String(type)}". Valid types: ${SCHEDULED_JOB_TYPES.join(', ')}`,
    );
  }
  return type;
}

/**
 * Extrai o escopo de projeto do payload para gravar na coluna
 * `ScheduledJob.projectId`. `null` quando o job não é de projeto (os tipos de
 * escopo de sessão, `stage_timeout` e `cleanup_worktrees`, só carregam
 * `sessionId`) — a coluna é nullable exatamente por isso.
 *
 * Ponto único de tradução payload → coluna: enquanto os dois existirem, quem
 * grava um jeito e lê o outro reintroduz o bug do filtro em memória.
 */
export function projectIdFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const value = (payload as Record<string, unknown>).projectId;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}
