import { createHash } from 'crypto';
import { MergeQueueService, MergeQueueTimeoutError } from './merge-queue.service';

/**
 * Fila de merge com Redis em memória — nenhum git roda aqui.
 *
 * O fake cobre só o que o serviço usa: `set` com NX/PX (aquisição), `eval` com o
 * script de compare-and-delete (liberação), `pexpire` (renovação) e o ZSET da
 * fila de espera. TTL é avaliado contra um relógio manual (`clock`), então
 * expiração de lock órfão é determinística, sem `sleep` real.
 */
function makeRedis() {
  const clock = { now: 0 };
  const values = new Map<string, { value: string; expiresAt: number }>();
  const zsets = new Map<string, Map<string, number>>();

  const alive = (key: string) => {
    const entry = values.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= clock.now) {
      values.delete(key);
      return undefined;
    }
    return entry;
  };

  const client = {
    set: jest.fn(async (key: string, value: string, _px: string, ttlMs: number, _nx: string) => {
      if (alive(key)) return null;
      values.set(key, { value, expiresAt: clock.now + ttlMs });
      return 'OK';
    }),
    pexpire: jest.fn(async (key: string, ttlMs: number) => {
      const entry = alive(key);
      if (!entry) return 0;
      entry.expiresAt = clock.now + ttlMs;
      return 1;
    }),
    eval: jest.fn(async (_script: string, _numKeys: number, key: string, holderId: string) => {
      if (alive(key)?.value !== holderId) return 0;
      values.delete(key);
      return 1;
    }),
    zadd: jest.fn(async (key: string, score: number, member: string) => {
      if (!zsets.has(key)) zsets.set(key, new Map());
      zsets.get(key)!.set(member, score);
      return 1;
    }),
    zrem: jest.fn(async (key: string, member: string) => {
      zsets.get(key)?.delete(member);
      return 1;
    }),
    zrank: jest.fn(async (key: string, member: string) => {
      const entries = [...(zsets.get(key)?.entries() ?? [])].sort((a, b) => a[1] - b[1]);
      const index = entries.findIndex(([m]) => m === member);
      return index < 0 ? null : index;
    }),
  };

  const service = new MergeQueueService({ getClient: () => client } as any);
  return { service, client, clock, values, zsets };
}

const OPTS = { mainPath: '/repo', ttlMs: 1_000, pollIntervalMs: 1, maxWaitMs: 200 };

/** Mesma derivação do serviço: sha1 do mainPath truncado. */
const LOCK_KEY = `merge-queue:lock:${createHash('sha1').update(OPTS.mainPath).digest('hex').slice(0, 12)}`;

describe('MergeQueueService', () => {
  it('serializa dois merges concorrentes no mesmo mainPath', async () => {
    const { service } = makeRedis();
    const events: string[] = [];

    const first = service.runExclusive({ ...OPTS, holderId: 's1' }, async () => {
      events.push('s1:start');
      await new Promise((resolve) => setTimeout(resolve, 20));
      events.push('s1:end');
    });
    const second = service.runExclusive({ ...OPTS, holderId: 's2' }, async () => {
      events.push('s2:start');
      events.push('s2:end');
    });

    await Promise.all([first, second]);

    // s2 só pode ter começado depois de s1 terminar — nunca intercalado.
    expect(events).toEqual(['s1:start', 's1:end', 's2:start', 's2:end']);
  });

  it('libera o lock em finally mesmo quando o merge falha', async () => {
    const { service, values } = makeRedis();

    await expect(
      service.runExclusive({ ...OPTS, holderId: 's1' }, async () => {
        throw new Error('merge falhou');
      }),
    ).rejects.toThrow('merge falhou');

    expect([...values.keys()]).toHaveLength(0);

    // Lock liberado: a próxima sessão entra sem esperar.
    await expect(
      service.runExclusive({ ...OPTS, holderId: 's2' }, async () => 'ok'),
    ).resolves.toBe('ok');
  });

  it('sai da fila de espera ao terminar', async () => {
    const { service, zsets } = makeRedis();

    await service.runExclusive({ ...OPTS, holderId: 's1' }, async () => undefined);

    const waiting = [...zsets.values()].flatMap((set) => [...set.keys()]);
    expect(waiting).toEqual([]);
  });

  it('estoura timeout em vez de mergear em paralelo, e reporta posição na espera', async () => {
    const { service } = makeRedis();
    const waits: { position: number; waitedMs: number }[] = [];

    // s0 segura o lock por mais tempo do que s1 está disposta a esperar.
    const holding = service.runExclusive(
      { ...OPTS, holderId: 's0' },
      () => new Promise((resolve) => setTimeout(resolve, 120)),
    );
    await new Promise((resolve) => setImmediate(resolve));

    await expect(
      service.runExclusive(
        { ...OPTS, holderId: 's1', maxWaitMs: 40, onWait: (w) => void waits.push(w) },
        async () => 'nunca',
      ),
    ).rejects.toBeInstanceOf(MergeQueueTimeoutError);

    // Esperar precisa ser visível: sem isso a sessão fica `running` sem output
    // e o stall check a marca como travada.
    expect(waits.length).toBeGreaterThan(0);
    expect(waits[0].position).toBe(2);
    await holding;
  });

  it('assume lock órfão depois do TTL (restart do backend não pendura a fila)', async () => {
    const { service, values, clock } = makeRedis();

    // Processo anterior morreu segurando o lock: sobrou a chave, sem ninguém renovando.
    values.set(LOCK_KEY, { value: 'sessao-morta', expiresAt: clock.now + 100 });

    await expect(
      service.runExclusive({ ...OPTS, holderId: 's1', maxWaitMs: 10 }, async () => 'ok'),
    ).rejects.toBeInstanceOf(MergeQueueTimeoutError);

    clock.now += 200; // TTL passou
    await expect(
      service.runExclusive({ ...OPTS, holderId: 's1' }, async () => 'ok'),
    ).resolves.toBe('ok');
  });
});
