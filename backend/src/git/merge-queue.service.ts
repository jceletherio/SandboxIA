import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { RedisService } from '../redis/redis.service';

/** Prefixo das chaves da fila. Fica aqui e não em redis/keys.ts: é estado interno deste módulo. */
const MERGE_QUEUE_PREFIX = 'merge-queue';

/**
 * Teto de espera na fila. Deliberadamente abaixo dos 10 min do stall check do
 * session-runtime: sessão parada esperando merge não pode ser confundida com
 * sessão travada.
 */
const DEFAULT_MAX_WAIT_MS = 8 * 60_000;

/** TTL do lock. Curto o bastante para um crash não pendurar a fila, renovado enquanto o merge roda. */
const DEFAULT_TTL_MS = 60_000;

/** Intervalo entre tentativas de aquisição do lock. */
const DEFAULT_POLL_INTERVAL_MS = 1_000;

export interface MergeQueueWait {
  /** 1 = próximo a entrar. */
  position: number;
  waitedMs: number;
}

export interface MergeQueueOptions {
  /** Recurso disputado: um merge por vez por repositório principal. */
  mainPath: string;
  /** Quem segura o lock (sessionId) — só o dono pode liberar. */
  holderId: string;
  maxWaitMs?: number;
  ttlMs?: number;
  pollIntervalMs?: number;
  /** Chamado a cada tentativa frustrada, para a sessão não parecer travada. */
  onWait?: (wait: MergeQueueWait) => void | Promise<void>;
}

export class MergeQueueTimeoutError extends Error {
  constructor(mainPath: string, waitedMs: number) {
    super(
      `Timed out after ${Math.round(waitedMs / 1000)}s waiting for the merge queue of ${mainPath}`,
    );
    this.name = 'MergeQueueTimeoutError';
  }
}

/**
 * Serializa os merges por repositório principal.
 *
 * Dois merges concorrentes no mesmo `mainPath` disputam index e HEAD do repo —
 * o resultado não é conflito, é estado corrompido. O lock vive no Redis (e não
 * em memória) com TTL e liberação em `finally`: reinício do backend no meio de
 * um merge expira o lock em vez de deixá-lo órfão para sempre.
 */
@Injectable()
export class MergeQueueService {
  private readonly logger = new Logger(MergeQueueService.name);

  constructor(private readonly redis: RedisService) {}

  /**
   * Roda `fn` com exclusividade sobre `mainPath`. Quem não consegue o lock
   * espera na fila e recebe posição/tempo por `onWait`; estourou `maxWaitMs`,
   * lança `MergeQueueTimeoutError` em vez de tentar mergear em paralelo.
   */
  async runExclusive<T>(opts: MergeQueueOptions, fn: () => Promise<T>): Promise<T> {
    const maxWaitMs = opts.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
    const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

    const lockKey = this.lockKey(opts.mainPath);
    const queueKey = this.queueKey(opts.mainPath);
    const client = this.redis.getClient();
    const startedAt = Date.now();

    // Entra na fila antes de disputar o lock: a posição só é informativa, mas
    // sem o registro toda sessão em espera se veria como "próxima". O TTL da
    // fila cobre o processo que morrer antes do `finally`: sem ele, a entrada
    // órfã ficaria para sempre inflando a posição de quem vier depois.
    await client.zadd(queueKey, startedAt, opts.holderId);
    await client.pexpire(queueKey, Math.max(maxWaitMs, ttlMs) * 4).catch(() => undefined);

    let renewal: NodeJS.Timeout | undefined;
    try {
      while (true) {
        const acquired = await client.set(lockKey, opts.holderId, 'PX', ttlMs, 'NX');
        if (acquired) break;

        const waitedMs = Date.now() - startedAt;
        if (waitedMs >= maxWaitMs) throw new MergeQueueTimeoutError(opts.mainPath, waitedMs);

        const position = await this.position(queueKey, opts.holderId);
        await opts.onWait?.({ position, waitedMs });
        await this.sleep(Math.min(pollIntervalMs, maxWaitMs - waitedMs));
      }

      // Merge com rebase e resolução de conflito pode passar do TTL; enquanto
      // este processo está vivo, o lock não pode expirar debaixo dele.
      renewal = setInterval(() => {
        client.pexpire(lockKey, ttlMs).catch((error) => {
          this.logger.warn(`Failed to renew merge lock for ${opts.mainPath}: ${error.message}`);
        });
      }, Math.max(1, Math.floor(ttlMs / 3)));
      renewal.unref?.();

      const waitedMs = Date.now() - startedAt;
      this.logger.log(`Merge lock acquired for ${opts.mainPath} by ${opts.holderId} after ${waitedMs}ms`);

      return await fn();
    } finally {
      if (renewal) clearInterval(renewal);
      await this.release(lockKey, opts.holderId);
      await client.zrem(queueKey, opts.holderId).catch(() => undefined);
    }
  }

  /** Posição atual de uma sessão na fila daquele repositório (1 = próxima). */
  async positionFor(mainPath: string, holderId: string): Promise<number> {
    return this.position(this.queueKey(mainPath), holderId);
  }

  private async position(queueKey: string, holderId: string): Promise<number> {
    const rank = await this.redis.getClient().zrank(queueKey, holderId);
    return (rank ?? 0) + 1;
  }

  /**
   * Libera só se o lock ainda for nosso: um lock que expirou e foi tomado por
   * outra sessão não pode ser apagado por quem chegou atrasado ao `finally`.
   */
  private async release(lockKey: string, holderId: string): Promise<void> {
    try {
      await this.redis
        .getClient()
        .eval(
          'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end',
          1,
          lockKey,
          holderId,
        );
    } catch (error) {
      this.logger.warn(`Failed to release merge lock ${lockKey}: ${error.message}`);
    }
  }

  /** Hash do caminho: `mainPath` tem barras e tamanho variável, chave precisa ser estável. */
  private lockKey(mainPath: string): string {
    return `${MERGE_QUEUE_PREFIX}:lock:${this.resourceId(mainPath)}`;
  }

  private queueKey(mainPath: string): string {
    return `${MERGE_QUEUE_PREFIX}:waiting:${this.resourceId(mainPath)}`;
  }

  private resourceId(mainPath: string): string {
    return createHash('sha1').update(mainPath).digest('hex').slice(0, 12);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
  }
}
