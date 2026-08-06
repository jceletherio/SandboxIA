import { SessionGovernorService } from './session-governor.service';
import { GOVERNOR_RESERVATION_PATTERN } from '../redis/keys';

/**
 * `reserveOrQueue` sob disputa de verdade (MT-20, item 5). Antes do lock, a
 * decisão era um `count()` otimista sem trava: duas chamadas concorrentes
 * liam o MESMO número de sessões ativas (nenhuma das duas tinha criado a
 * `Session` ainda) e as duas passavam — o teto global furava em silêncio, sem
 * exceção nem log de erro. É exatamente esse cenário que o teste reproduz.
 */

/** Redis de mentira com SET NX/PX, o script de release e SCAN+MGET das reservas em voo. */
function fakeRedis() {
  const store = new Map<string, string>();
  return {
    getClient: () => ({
      set: jest.fn(async (key: string, value: string, _mode: string, _ttl: number, _nx: string) => {
        if (store.has(key)) return null;
        store.set(key, value);
        return 'OK';
      }),
      eval: jest.fn(async (_script: string, _numKeys: number, key: string, owner: string) => {
        if (store.get(key) === owner) {
          store.delete(key);
          return 1;
        }
        return 0;
      }),
      scan: jest.fn(async (_cursor: string, _match: string, _pattern: string, _count: string, _n: number) => {
        const prefix = GOVERNOR_RESERVATION_PATTERN.replace('*', '');
        const keys = [...store.keys()].filter((k) => k.startsWith(prefix));
        return ['0', keys];
      }),
      mget: jest.fn(async (...keys: string[]) => keys.map((k) => store.get(k) ?? null)),
    }),
  } as any;
}

/** Prisma de mentira: `count()` fixo (simula sessões já persistidas) + governor lenientíssimo em recurso. */
function fakePrisma(activeSessions: number) {
  return {
    session: { count: jest.fn(async () => activeSessions) },
    macroTask: {
      update: jest.fn(async () => ({})),
    },
    // `positionInQueue` varre a fila via `scanQueue` ($queryRaw) — vazio é
    // suficiente aqui, o teste não valida a posição na fila.
    $queryRaw: jest.fn(async () => []),
    governorSettings: {
      findUnique: jest.fn(async () => ({
        globalMaxSessions: 1,
        cpuLoadThreshold: 999,
        minFreeMemMb: 0,
      })),
    },
  } as any;
}

const project = { settings: {}, maxSessions: 10 };

describe('reserveOrQueue — disputa concorrente pelo teto global', () => {
  it('duas macro tasks disputando o último slot: só uma passa, a outra fica em fila', async () => {
    const redis = fakeRedis();
    const prisma = fakePrisma(0); // nenhuma Session real ainda — as duas chamadas partem do mesmo retrato
    const governor = new SessionGovernorService(prisma, redis, {} as any);

    const [a, b] = await Promise.all([
      governor.reserveOrQueue({ id: 'mt-a', projectId: 'p1', metadata: null }, project, 'agent-1'),
      governor.reserveOrQueue({ id: 'mt-b', projectId: 'p1', metadata: null }, project, 'agent-1'),
    ]);

    const passed = [a, b].filter((r) => r === null);
    const queued = [a, b].filter((r) => r !== null);
    expect(passed).toHaveLength(1);
    expect(queued).toHaveLength(1);
    expect((queued[0] as any).reason).toBe('global');
  });

  it('sem disputa (só uma chamada), o slot livre passa normalmente', async () => {
    const redis = fakeRedis();
    const prisma = fakePrisma(0);
    const governor = new SessionGovernorService(prisma, redis, {} as any);

    const result = await governor.reserveOrQueue(
      { id: 'mt-a', projectId: 'p1', metadata: null },
      project,
      'agent-1',
    );
    expect(result).toBeNull();
  });

  it('teto já ocupado por Session real: a reserva nem chega a ser preciso — enfileira de cara', async () => {
    const redis = fakeRedis();
    const prisma = fakePrisma(1); // já há 1 sessão ativa, e o teto global é 1
    const governor = new SessionGovernorService(prisma, redis, {} as any);

    const result = await governor.reserveOrQueue(
      { id: 'mt-a', projectId: 'p1', metadata: null },
      project,
      'agent-1',
    );
    expect(result).not.toBeNull();
    expect((result as any).reason).toBe('global');
  });
});
