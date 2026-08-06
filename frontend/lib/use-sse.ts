'use client';

import { useEffect, useRef, useState } from 'react';

import { getApiBaseUrl } from './api-base';

export interface SseEvent {
  type: string;
  data: any;
  id?: string;
}

/** Eventos nomeados emitidos pelo backend (ver backend/src/redis/channels.ts). */
export const SSE_EVENTS = [
  'session:log',
  'session:status',
  'session:created',
  'session:updated',
  'session:deleted',
  'session:paused',
  'session:resumed',
  'session:completed',
  'session:stage-start',
  'session:stage-complete',
  'session:stage-failed',
  'session:stalled',
  'session:chat',
  'question:created',
  'question:answered',
  'artifact:created',
  'master:decision',
  'master:activity',
  'git:changed',
] as const;

export type SseEventName = (typeof SSE_EVENTS)[number];

/**
 * Hook SSE com suporte a eventos nomeados (o Nest @Sse emite `event:` custom,
 * que NÃO dispara onmessage — precisa de addEventListener por tipo) e
 * reconexão que re-registra os handlers.
 */
export function useSSE(
  endpoint: string,
  onMessage?: (event: SseEvent) => void,
  enabled: boolean = true,
  events: readonly string[] = SSE_EVENTS,
) {
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const onMessageRef = useRef(onMessage);

  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    if (!enabled || !endpoint) {
      return;
    }

    const url = `${getApiBaseUrl()}${endpoint}`;
    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (disposed) return;
      const eventSource = new EventSource(url);
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        setConnected(true);
        setError(null);
      };

      const handler = (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data);
          onMessageRef.current?.({
            type: event.type || 'message',
            data,
            id: event.lastEventId,
          });
        } catch (err) {
          console.error('Failed to parse SSE event:', err);
        }
      };

      // evento default + todos os eventos nomeados
      eventSource.onmessage = handler;
      for (const name of events) {
        eventSource.addEventListener(name, handler as EventListener);
      }

      eventSource.onerror = () => {
        setConnected(false);
        setError('Connection lost');
        eventSource.close();
        if (!disposed) {
          reconnectTimer = setTimeout(connect, 5000);
        }
      };
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      setConnected(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint, enabled]);

  const close = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
      setConnected(false);
    }
  };

  return { connected, error, close };
}

export function useSessionSSE(
  sessionId: string | null,
  onMessage?: (event: SseEvent) => void,
) {
  const endpoint = sessionId ? `/sse/stream?sessionId=${sessionId}` : '';
  return useSSE(endpoint, onMessage, !!sessionId);
}

/**
 * Stream global de eventos. Passe `projectId` para o backend filtrar os
 * eventos de sessão pelo projeto selecionado (eventos master:* são globais e
 * sempre chegam).
 */
export function useGlobalSSE(
  onMessage?: (event: SseEvent) => void,
  enabled: boolean = true,
  projectId?: string,
) {
  const endpoint = projectId
    ? `/sse/stream?projectId=${encodeURIComponent(projectId)}`
    : '/sse/stream';
  return useSSE(endpoint, onMessage, enabled);
}
