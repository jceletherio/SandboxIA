/**
 * Contrato de notificação do orquestrador.
 *
 * O ponto todo é o celular: as sessões rodam por dezenas de minutos e o que
 * precisa de mim (pergunta bloqueando, sessão travada, stage falhado) não pode
 * depender de eu estar com a aba aberta. Daí o alvo ser push de verdade e não
 * só o toast que já existe na UI.
 */

/** Chave estável de cada tipo de notificação — é o que liga/desliga em Settings. */
export type NotificationEventKey =
  | 'question'
  | 'escalation'
  | 'stalled'
  | 'stageFailed'
  | 'sessionCompleted'
  | 'sessionFailed'
  | 'test';

/**
 * `high` é o que vale acordar alguém: no ntfy vira prioridade 5 (som/vibração
 * mesmo com o celular no silencioso configurado para isso). `low` não vibra.
 */
export type NotificationPriority = 'low' | 'default' | 'high';

export interface NotificationPayload {
  event: NotificationEventKey;
  title: string;
  body: string;
  priority: NotificationPriority;
  /**
   * Chave de deduplicação. Dois eventos com a mesma tag dentro da janela
   * configurada rendem UMA notificação — sem isso, uma sessão travada que o
   * watchdog reavalia a cada minuto vira um alarme por minuto.
   */
  tag: string;
  /** Caminho relativo na UI para onde a notificação leva (ex. `/questions`). */
  path?: string;
  /** Preenchido pelo service quando dá para resolver o projeto do evento. */
  projectName?: string;
}

/** Um destino de entrega (ntfy, webhook, …). */
export interface NotificationSink {
  readonly name: string;
  /** Deve resolver mesmo em falha — quem chama trata o retorno, nunca o throw. */
  send(payload: NotificationPayload, link?: string): Promise<SinkResult>;
}

export interface SinkResult {
  sink: string;
  ok: boolean;
  error?: string;
}
