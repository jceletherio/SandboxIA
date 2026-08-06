import { randomUUID } from 'crypto';
import { Logger } from '@nestjs/common';

/**
 * Lock distribuído simples sobre o Redis que já está no stack (MT-20, item 5).
 * `SET NX PX` para adquirir, delete comparando o dono para liberar — sem
 * Redlock e sem dependência nova: há UM Redis, então o algoritmo multi-nó não
 * compraria nada além de complexidade.
 */

const logger = new Logger('RedisLock');

/** Subconjunto do ioredis usado aqui — permite testar sem subir Redis. */
export interface LockableRedis {
  set(
    key: string,
    value: string,
    mode: 'PX',
    ttl: number,
    nx: 'NX',
  ): Promise<string | null>;
  eval(script: string, numKeys: number, ...args: string[]): Promise<unknown>;
}

export class LockTimeoutError extends Error {
  constructor(
    readonly key: string,
    readonly waitedMs: number,
  ) {
    super(`Timeout de ${waitedMs}ms esperando o lock "${key}"`);
    this.name = 'LockTimeoutError';
  }
}

export interface RedisLockOptions {
  /** Validade da trava. Segura contra dono que morreu sem liberar. */
  ttlMs?: number;
  /** Tempo máximo esperando a trava de outro dono antes de desistir. */
  waitMs?: number;
  /** Intervalo entre tentativas. */
  retryMs?: number;
}

const DEFAULT_TTL_MS = 10_000;
const DEFAULT_WAIT_MS = 5_000;
const DEFAULT_RETRY_MS = 50;

/**
 * Libera só se o valor ainda for o nosso: um `DEL` cru apagaria a trava de
 * OUTRO dono no caso em que a nossa já expirou por TTL — que é exatamente
 * quando a exclusão mútua importa.
 */
const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
end
return 0
`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Roda `fn` com a trava `key` adquirida, liberando no fim mesmo em caso de erro.
 *
 * Duas bordas, assimétricas de propósito:
 * - **Trava ocupada** até o fim do `waitMs` → lança `LockTimeoutError`. Quem
 *   chama decide o que fazer (o governor enfileira, em vez de estourar o teto).
 * - **Redis inacessível** (o `set` em si falhou) → `warn` e roda `fn` SEM trava.
 *   Fail-open porque a alternativa é não subir sessão nenhuma enquanto o Redis
 *   estiver fora — trocar uma corrida raríssima por uma parada total do
 *   orquestrador é o pior negócio dos dois.
 */
export async function withRedisLock<T>(
  redis: LockableRedis,
  key: string,
  options: RedisLockOptions,
  fn: () => Promise<T>,
): Promise<T> {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const waitMs = options.waitMs ?? DEFAULT_WAIT_MS;
  const retryMs = options.retryMs ?? DEFAULT_RETRY_MS;
  const owner = randomUUID();
  const deadline = Date.now() + waitMs;

  for (;;) {
    let acquired: string | null;
    try {
      acquired = await redis.set(key, owner, 'PX', ttlMs, 'NX');
    } catch (error) {
      logger.warn(`Redis indisponível para o lock "${key}" (${error.message}) — seguindo sem trava`);
      return fn();
    }

    if (acquired) {
      try {
        return await fn();
      } finally {
        await Promise.resolve(redis.eval(RELEASE_SCRIPT, 1, key, owner)).catch((error) =>
          logger.warn(`Falha ao liberar o lock "${key}": ${error.message}`),
        );
      }
    }

    if (Date.now() >= deadline) throw new LockTimeoutError(key, waitMs);
    await sleep(retryMs);
  }
}
