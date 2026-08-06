/** Chaves Redis compartilhadas entre módulos (estado, correlação). */

/**
 * Estado do Master — chave GLOBAL legada (pré-MT-20), de quando havia um Master
 * único para o backend inteiro. Mantida só para a migração one-shot em
 * `MasterAgentService.onModuleInit`; o estado corrente é por projeto, ver
 * `masterStateKey`.
 */
export const MASTER_STATE_KEY = 'master-agent:state';

/** Estado do Master DAQUELE projeto (MT-20: um Master por projeto). */
export function masterStateKey(projectId: string): string {
  return `${MASTER_STATE_KEY}:${projectId}`;
}

/**
 * Índice token → projectId. Existe porque o `/mcp` recebe só o Bearer token e
 * precisa achar de qual Master ele é sem varrer as chaves de estado de todos os
 * projetos (`resolveMasterToken` roda em toda chamada de tool).
 */
export function masterTokenIndexKey(token: string): string {
  return `master-agent:token:${token}`;
}

/** SET dos projetos com Master ativo — é o que o boot reativa (MT-20). */
export const MASTER_ACTIVE_PROJECTS_KEY = 'master-agent:active-projects';
export const MASTER_CHAT_RUN_KEY = 'master-agent:chat-run';
/**
 * Conversa (thread) ativa do chat do Master — P3.2.
 *
 * O `chat()` grava aqui o `chatSessionId` da conversa em que o usuário falou,
 * logo antes de mandar o prompt para o pane tmux. O `reply_chat` (MCP) lê essa
 * chave para gravar a resposta do agente na MESMA conversa.
 *
 * É só correlação de exibição: continua existindo **um único** runtime/pane do
 * Master por projeto, independente de quantas conversas existam (CA4). Por isso
 * a chave é global e única, no mesmo espírito do `MASTER_CHAT_RUN_KEY`.
 */
export const MASTER_CHAT_SESSION_KEY = 'master-agent:chat-session';
/** TTL da conversa ativa (segundos). Mesmo horizonte do MASTER_CHAT_RUN_KEY. */
export const MASTER_CHAT_SESSION_TTL_SECONDS = 3600;
/**
 * Config de scheduling do Master — chave GLOBAL legada (pré-MT-2), quando só
 * existia uma automação para o backend inteiro. Mantida só para a migração
 * one-shot em `loadSchedulingConfig`; o cache corrente é por projeto, ver
 * `masterSchedulingCacheKey`.
 */
export const MASTER_SCHEDULING_KEY = 'master-agent:scheduling';

/** Cache quente por-projeto da config de automação (MT-2). A verdade é `Project.settings.automation`. */
export function masterSchedulingCacheKey(projectId: string): string {
  return `${MASTER_SCHEDULING_KEY}:${projectId}`;
}

/**
 * Lock que serializa a decisão do governor (MT-20, item 5). Uma chave só, e não
 * uma por projeto: o teto que não pode ter furo é o GLOBAL, então dois starts de
 * projetos diferentes também precisam ser serializados entre si.
 */
export const GOVERNOR_RESERVE_LOCK_KEY = 'governor:lock:reserve';

/**
 * Reserva em voo: o governor decidiu "pode subir" mas a `Session` ainda não
 * existe no banco. Sem isso, a segunda chamada dentro dessa janela recontaria a
 * mesma situação e passaria também — o lock sozinho não resolve, porque o
 * `count()` das duas leituras seria idêntico.
 */
export function governorReservationKey(macroTaskId: string): string {
  return `governor:reservation:${macroTaskId}`;
}

/** Padrão de varredura das reservas em voo (SCAN, nunca KEYS). */
export const GOVERNOR_RESERVATION_PATTERN = 'governor:reservation:*';

/**
 * Marca d'água da reconciliação de `SESSION_COMPLETED` (MT-20, item 6): ISO do
 * último `completedAt` já processado. O pub/sub é fire-and-forget, então é essa
 * chave que diz de onde retomar quando o backend volta.
 */
export const SESSION_COMPLETED_WATERMARK_KEY = 'events:reconcile:session-completed';

export interface MasterState {
  projectId: string;
  cliProfileId: string;
  /** Bearer token do Master no /mcp (identidade das master tools). */
  token: string;
}
