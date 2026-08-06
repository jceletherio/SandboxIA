/**
 * Origens aceitas pelo backend (REST e gateway /terminal).
 *
 * Em dev o frontend é aberto tanto por http://localhost:3000 quanto pelo IP da
 * máquina na LAN (celular/tablet na mesma rede, ex. http://192.168.1.48:3000).
 * FRONTEND_URL continua valendo — aceita uma lista separada por vírgula — e
 * além dela liberamos loopback e faixas privadas de IP em qualquer porta.
 */
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function isPrivateHost(hostname: string): boolean {
  if (LOOPBACK.has(hostname)) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  return hostname.endsWith('.local');
}

const explicitOrigins = (process.env.FRONTEND_URL || 'http://localhost:3000')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

export function isAllowedOrigin(origin: string | undefined): boolean {
  // Sem Origin: curl, health check, EventSource same-origin — libera.
  if (!origin) return true;
  if (explicitOrigins.includes(origin)) return true;
  try {
    return isPrivateHost(new URL(origin).hostname);
  } catch {
    return false;
  }
}

/** Callback de origin no formato que o Nest/Express e o socket.io esperam. */
export const corsOrigin = (
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void,
): void => {
  callback(null, isAllowedOrigin(origin));
};
