/**
 * Base da API usada pelo browser (REST, SSE e socket do terminal).
 *
 * NEXT_PUBLIC_API_URL continua mandando, mas quando ela aponta para loopback
 * (o default de dev, http://localhost:4000) e a página foi aberta por outro
 * host — o IP da máquina na LAN, ex. http://192.168.1.48:3000 pelo celular —
 * o loopback resolveria para o próprio celular. Nesse caso reaproveitamos o
 * host da URL acessada e trocamos só a porta.
 */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export function getApiBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

  if (typeof window === 'undefined') {
    return configured.replace(/\/$/, '');
  }

  let url: URL;
  try {
    url = new URL(configured, window.location.origin);
  } catch {
    return configured.replace(/\/$/, '');
  }

  if (LOOPBACK_HOSTS.has(url.hostname) && !LOOPBACK_HOSTS.has(window.location.hostname)) {
    url.protocol = window.location.protocol;
    url.hostname = window.location.hostname;
  }

  return url.origin;
}
