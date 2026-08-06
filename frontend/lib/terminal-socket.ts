import { io, Socket } from 'socket.io-client';

import { getApiBaseUrl } from './api-base';

/**
 * Socket /terminal compartilhado por todos os componentes <Terminal> da aba,
 * com refcount: o último a desmontar fecha a conexão. Cada terminal se
 * distingue pelo terminalId presente em todos os payloads do protocolo.
 */
let socket: Socket | null = null;
let refs = 0;

export function acquireTerminalSocket(): Socket {
  if (!socket) {
    socket = io(`${getApiBaseUrl()}/terminal`, {
      transports: ['websocket'],
    });
  }
  refs++;
  return socket;
}

export function releaseTerminalSocket(): void {
  refs = Math.max(0, refs - 1);
  if (refs === 0 && socket) {
    socket.disconnect();
    socket = null;
  }
}
