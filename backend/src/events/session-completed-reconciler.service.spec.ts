import { SessionCompletedReconcilerService } from './session-completed-reconciler.service';
import { SESSION_COMPLETED_WATERMARK_KEY } from '../redis/keys';

/**
 * Cenário do item 6 (MT-20): o Redis é fire-and-forget, então um `SESSION_COMPLETED`
 * publicado com o `BacklogIngestService` fora do ar (ou o subscriber ainda não
 * registrado, ou o processo reiniciando) é perdido para sempre — sem a
 * reconciliação, o backlog daquela sessão nunca nasce, em silêncio.
 */

interface FakeSession {
  id: string;
  status: string;
  completedAt: Date | null;
}

function makeHarness(sessions: FakeSession[], initialWatermark: string | null) {
  const store = new Map<string, string>();
  if (initialWatermark) store.set(SESSION_COMPLETED_WATERMARK_KEY, initialWatermark);
  const ingested: string[] = [];

  const prisma = {
    session: {
      findFirst: jest.fn(async ({ where, orderBy }: any) => {
        const rows = sessions.filter((s) => s.status === where.status && s.completedAt);
        rows.sort((a, b) => {
          const dir = orderBy?.completedAt === 'desc' ? -1 : 1;
          return dir * (a.completedAt!.getTime() - b.completedAt!.getTime());
        });
        return rows[0] ?? null;
      }),
      findMany: jest.fn(async ({ where }: any) => {
        const min: Date = where.completedAt.gt;
        return sessions.filter(
          (s) => s.status === where.status && s.completedAt && s.completedAt.getTime() > min.getTime(),
        );
      }),
      findUnique: jest.fn(async ({ where }: any) => {
        const session = sessions.find((s) => s.id === where.id);
        return session ? { completedAt: session.completedAt } : null;
      }),
    },
  } as any;

  const redisClient = {
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    }),
  };
  const redis = {
    getClient: () => redisClient,
    subscribe: jest.fn(async () => undefined),
  } as any;

  const backlogIngest = {
    ingestSession: jest.fn(async (sessionId: string) => {
      ingested.push(sessionId);
      return { sessionId, created: 1, merged: 0, skipped: 0, errors: [] };
    }),
  } as any;

  const service = new SessionCompletedReconcilerService(prisma, redis, backlogIngest);
  return { service, store, ingested, backlogIngest };
}

describe('SessionCompletedReconcilerService — reconciliação na subida', () => {
  it('sessão concluída enquanto o backend estava fora (evento perdido) é reprocessada no boot seguinte', async () => {
    const watermark = new Date('2026-08-03T20:00:00Z').toISOString();
    const { service, ingested, store } = makeHarness(
      [
        // "perdida": completou DEPOIS da marca, mas o SESSION_COMPLETED nunca
        // chegou a ninguém porque o backend caiu nessa janela (MT-11, 03/08).
        { id: 'sessao-perdida', status: 'completed', completedAt: new Date('2026-08-03T20:15:00Z') },
      ],
      watermark,
    );

    const result = await service.reconcile();

    expect(result.processed).toBe(1);
    expect(ingested).toEqual(['sessao-perdida']);
    expect(store.get(SESSION_COMPLETED_WATERMARK_KEY)).toBe(
      new Date('2026-08-03T20:15:00Z').toISOString(),
    );
  });

  it('nada perdido: reconcile não reingere o que já está antes da marca', async () => {
    const watermark = new Date('2026-08-03T20:00:00Z').toISOString();
    const { service, ingested } = makeHarness(
      [{ id: 'ja-vista', status: 'completed', completedAt: new Date('2026-08-03T19:00:00Z') }],
      watermark,
    );

    const result = await service.reconcile();

    expect(result.processed).toBe(0);
    expect(ingested).toEqual([]);
  });

  it('primeiro boot (sem marca d\'água): não reprocessa histórico, só grava o ponto de partida', async () => {
    const { service, ingested, store } = makeHarness(
      [{ id: 'antiga', status: 'completed', completedAt: new Date('2026-08-01T00:00:00Z') }],
      null,
    );

    const result = await service.reconcile();

    expect(result.processed).toBe(0);
    expect(ingested).toEqual([]);
    expect(store.get(SESSION_COMPLETED_WATERMARK_KEY)).toBe(
      new Date('2026-08-01T00:00:00Z').toISOString(),
    );
  });

  it('falha ao reingerir uma sessão não impede as outras nem trava a marca antes delas', async () => {
    const watermark = new Date('2026-08-03T20:00:00Z').toISOString();
    const { service, backlogIngest, store } = makeHarness(
      [
        { id: 'falha', status: 'completed', completedAt: new Date('2026-08-03T20:10:00Z') },
        { id: 'ok', status: 'completed', completedAt: new Date('2026-08-03T20:20:00Z') },
      ],
      watermark,
    );
    backlogIngest.ingestSession.mockImplementationOnce(async () => {
      throw new Error('boom');
    });

    const result = await service.reconcile();

    expect(result.processed).toBe(2);
    expect(backlogIngest.ingestSession).toHaveBeenCalledTimes(2);
    expect(store.get(SESSION_COMPLETED_WATERMARK_KEY)).toBe(
      new Date('2026-08-03T20:20:00Z').toISOString(),
    );
  });
});
