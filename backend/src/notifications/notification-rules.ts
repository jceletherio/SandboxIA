import { CHANNELS } from '../redis/channels';
import type { NotificationPayload } from './notification.types';

/**
 * Canal Redis -> notificação. Função pura de propósito: é aqui que mora a
 * decisão de "isso merece o celular vibrar", e essa decisão precisa de teste
 * sem Redis, sem Prisma e sem HTTP no meio.
 *
 * Retornar `null` é o caso normal e mais comum: a maioria dos eventos do
 * orquestrador (log, chunk, stage-start) não é notificável.
 */
export const NOTIFIABLE_CHANNELS: string[] = [
  CHANNELS.QUESTION_CREATED,
  CHANNELS.MASTER_DECISION,
  CHANNELS.SESSION_STALLED,
  CHANNELS.STAGE_FAILED,
  CHANNELS.SESSION_COMPLETED,
  // `session:completed` só cobre o fim FELIZ (ver comentário em channels.ts).
  // failed/stopped/timeout saem por aqui — sem este canal, justamente a sessão
  // que quebrou às 3 da manhã seria a única que não avisaria ninguém.
  CHANNELS.SESSION_STATUS,
];

/** Status de `session:status` que valem notificação (os outros são ruído de transição). */
const FAILURE_STATUSES = new Set(['failed', 'timeout']);

function shortId(value: unknown): string {
  return String(value ?? '').slice(0, 8) || '?';
}

/** Uma linha só: título de notificação com quebra vira reticências no Android. */
function oneLine(value: unknown, max = 140): string {
  const text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

export function buildNotification(
  channel: string,
  data: any,
): NotificationPayload | null {
  if (!data || typeof data !== 'object') return null;

  switch (channel) {
    case CHANNELS.QUESTION_CREATED: {
      const id = data.id;
      if (!id) return null;
      return {
        event: 'question',
        title: 'Pergunta esperando resposta',
        // A pergunta em si no corpo: no celular, saber QUAL pergunta é o que
        // decide se vale abrir o app agora ou depois.
        body: oneLine(data.question) || `Sessão ${shortId(data.sessionId)}`,
        // Pergunta bloqueia a sessão — é o evento mais alto da lista.
        priority: 'high',
        tag: `question:${id}`,
        path: '/questions',
      };
    }

    case CHANNELS.MASTER_DECISION: {
      // O Master responde sozinho a maioria; só a escalada precisa de humano.
      if (data.action !== 'escalate') return null;
      return {
        event: 'escalation',
        title: 'Master escalou uma pergunta',
        body: oneLine(data.reason) || 'Precisa de decisão humana em Questions',
        priority: 'high',
        tag: `escalation:${data.questionId ?? 'unknown'}`,
        path: '/questions',
      };
    }

    case CHANNELS.SESSION_STALLED: {
      if (!data.sessionId) return null;
      return {
        event: 'stalled',
        title: `Sessão ${shortId(data.sessionId)} travada`,
        body: oneLine(data.reason) || 'Sem output há mais que o limite do watchdog',
        priority: 'high',
        tag: `stalled:${data.sessionId}`,
        path: '/sessions',
      };
    }

    case CHANNELS.STAGE_FAILED: {
      if (!data.sessionId) return null;
      return {
        event: 'stageFailed',
        title: `Stage "${data.stage ?? '?'}" falhou`,
        body:
          oneLine(data.error) ||
          `Sessão ${shortId(data.sessionId)} — veja o log do stage`,
        priority: 'high',
        // Tag por SESSÃO, não por stage: um stage que quebra publica
        // `stage-failed` e, logo depois, `session:status=failed`. Com tags
        // diferentes o celular vibraria duas vezes pela mesma falha.
        tag: `failure:${data.sessionId}`,
        path: '/sessions',
      };
    }

    case CHANNELS.SESSION_COMPLETED: {
      if (!data.sessionId) return null;
      return {
        event: 'sessionCompleted',
        title: `Sessão ${shortId(data.sessionId)} concluída`,
        body: 'Pipeline terminou sem erro',
        // `low` de propósito: sucesso é informação, não interrupção.
        priority: 'low',
        tag: `completed:${data.sessionId}`,
        path: '/sessions',
      };
    }

    case CHANNELS.SESSION_STATUS: {
      const status = String(data.status ?? '');
      if (!FAILURE_STATUSES.has(status)) return null;
      const sessionId = data.sessionId ?? data.id;
      if (!sessionId) return null;
      return {
        event: 'sessionFailed',
        title: `Sessão ${shortId(sessionId)} ${status === 'timeout' ? 'estourou o timeout' : 'falhou'}`,
        body: oneLine(data.reason) || 'Pipeline interrompido — veja o log da sessão',
        priority: 'high',
        // Mesma tag do stage-failed — ver comentário lá.
        tag: `failure:${sessionId}`,
        path: '/sessions',
      };
    }

    default:
      return null;
  }
}
