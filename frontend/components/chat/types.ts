/**
 * Tipos compartilhados do chat.
 *
 * O mesmo componente serve dois contextos diferentes (ver a nota de
 * nomenclatura da spec):
 * - chat com o **Master Agent** de um projeto (agrupado por `chatSessionId`);
 * - chat com o agente de uma **Session** do orquestrador (`sessionId`).
 *
 * A camada visual é agnóstica aos dois — quem busca/envia mensagem é a página.
 */

export type ChatRole = 'user' | 'agent'

/** Mensagem já formatada para exibição (o `time` vem pronto, não é Date). */
export interface ChatMessageView {
  id: string
  role: ChatRole
  content: string
  /** Hora já formatada para exibição (ex.: "14:03"). */
  time: string
  type?: 'status' | 'tasks' | 'question' | 'normal'
}

/**
 * Densidade do layout. Mantém a distinção de padding que a página master-agent
 * já fazia entre a coluna desktop e a aba mobile.
 */
export type ChatVariant = 'mobile' | 'desktop'
