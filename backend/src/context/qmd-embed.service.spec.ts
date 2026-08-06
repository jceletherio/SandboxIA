import { QmdEmbedService, QMD_EMBED_JOB_TYPE } from './qmd-embed.service';

/**
 * Serialização do embed com Prisma e Redis mockados — nenhum processo `qmd` é
 * disparado, nenhuma linha é escrita no banco.
 *
 * O que está sob teste é só a lógica que falha em silêncio: a guarda de sessão
 * ativa, o lock global (SET NX) e o debounce/adiamento da fila. O processo em si
 * (nice/ionice/timeout) é I/O e fica de fora.
 */

interface FakeJob {
  id: string;
  type: string;
  payload: any;
  /** Coluna indexada (MT-13) — é por ela que a fila é consultada, não pelo payload. */
  projectId?: string | null;
  scheduledAt: Date;
  status: string;
  notes?: string | null;
}

function makeHarness(options: { sessions?: string[]; jobs?: FakeJob[]; qmd?: boolean } = {}) {
  const sessions = options.sessions ?? [];
  const jobs = options.jobs ?? [];
  const store = new Map<string, string>();
  let nextId = 1;

  const prisma = {
    project: {
      findUnique: jest.fn(async ({ where }: any) => ({ id: where.id, name: 'OneQuest', mainPath: '/tmp/onequest' })),
      findFirst: jest.fn(async () => ({ id: 'project-1', name: 'OneQuest', mainPath: '/tmp/onequest' })),
    },
    session: {
      count: jest.fn(async ({ where }: any) => sessions.filter((status) => where.status.in.includes(status)).length),
      findUnique: jest.fn(async () => ({ macroTask: { projectId: 'project-1' } })),
    },
    scheduledJob: {
      // `status` vem como string (fila pendente) ou como `{ in: [...] }`
      // (histórico do último embed) — o fake aceita as duas formas.
      findMany: jest.fn(async ({ where }: any) =>
        jobs
          .filter((job) => job.type === where.type)
          .filter((job) => (where.status?.in ? where.status.in.includes(job.status) : job.status === where.status))
          .map((job) => ({ ...job })),
      ),
      // `findPendingJob` filtra pela COLUNA `projectId` (MT-13). O fake cobra a
      // coluna de propósito: com o filtro em memória do payload que existia
      // antes, o job do projeto alvo caía fora da página e o debounce sumia.
      findFirst: jest.fn(
        async ({ where }: any) =>
          jobs.find(
            (job) =>
              job.type === where.type && job.status === where.status && job.projectId === where.projectId,
          ) ?? null,
      ),
      create: jest.fn(async ({ data }: any) => {
        // `status` vem do default do schema — o fake precisa imitar isso, senão
        // o próximo `findPendingJob` não acha o job e o debounce não acontece.
        const job = { id: `job-${nextId++}`, status: 'pending', ...data };
        jobs.push(job);
        return job;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const job = jobs.find((j) => j.id === where.id);
        if (job) Object.assign(job, data);
        return job;
      }),
    },
  };

  // ioredis parcial: só o que o lock usa. `set` respeita o NX.
  const client = {
    set: jest.fn(async (key: string, value: string, ...args: any[]) => {
      if (args.includes('NX') && store.has(key)) return null;
      store.set(key, value);
      return 'OK';
    }),
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    del: jest.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
  };
  const redis = { getClient: () => client, subscribe: jest.fn(async () => undefined) };

  const service = new QmdEmbedService(prisma as any, redis as any);
  // O CLI não existe no ambiente de teste: resolve-se o binário na marra.
  jest.spyOn(service as any, 'getQmdBin').mockResolvedValue(options.qmd === false ? null : '/fake/qmd');
  return { service, prisma, jobs, store };
}

describe('QmdEmbedService', () => {
  describe('requestReindex', () => {
    it('enfileira para depois da onda quando há sessão ativa', async () => {
      const { service, jobs } = makeHarness({ sessions: ['running', 'waiting', 'initializing'] });

      const outcome = await service.requestReindex('project-1', 'pre-wave');

      expect(outcome.status).toBe('queued');
      expect(outcome.reason).toContain('3 session(s) still active');
      expect(outcome.willRunAfter).toBeDefined();
      expect(jobs).toHaveLength(1);
      expect(jobs[0].type).toBe(QMD_EMBED_JOB_TYPE);
      expect(jobs[0].payload).toEqual({ projectId: 'project-1', reason: 'pre-wave' });
    });

    it('agenda para agora quando a máquina está livre', async () => {
      const { service, jobs } = makeHarness({ sessions: ['paused', 'completed'] });

      const outcome = await service.requestReindex('project-1', 'manual');

      expect(outcome.status).toBe('queued');
      expect(outcome.reason).toContain('No active session');
      // `paused` não bloqueia de propósito: sessão esperando humano ficaria
      // horas assim e o embed nunca rodaria.
      expect(new Date(outcome.willRunAfter!).getTime()).toBeLessThanOrEqual(Date.now() + 1_000);
      expect(jobs).toHaveLength(1);
    });

    it('empurra o job existente em vez de criar um segundo (debounce da onda)', async () => {
      const { service, jobs } = makeHarness({ sessions: ['running'] });

      await service.requestReindex('project-1', 'post-wave');
      const first = jobs[0].scheduledAt.getTime();
      await service.requestReindex('project-1', 'post-wave');
      await service.requestReindex('project-1', 'post-wave');

      expect(jobs).toHaveLength(1);
      expect(jobs[0].scheduledAt.getTime()).toBeGreaterThanOrEqual(first);
    });

    it('acha o job do projeto com a fila cheia de outros projetos (era o `take: 20`)', async () => {
      // 25 jobs pendentes de OUTROS projetos: com o filtro em memória depois do
      // take, o job deste projeto ficava invisível e cada pedido criava um embed
      // novo em vez de empurrar o que já existia.
      const outros: FakeJob[] = Array.from({ length: 25 }, (_, i) => ({
        id: `outro-${i}`,
        type: QMD_EMBED_JOB_TYPE,
        payload: { projectId: `outro-${i}`, reason: 'post-wave' },
        projectId: `outro-${i}`,
        scheduledAt: new Date(Date.now() - 60_000),
        status: 'pending',
      }));
      const { service, jobs } = makeHarness({ sessions: ['running'], jobs: outros });

      await service.requestReindex('project-1', 'post-wave');
      await service.requestReindex('project-1', 'post-wave');

      expect(jobs.filter((job) => job.projectId === 'project-1')).toHaveLength(1);
      expect(jobs).toHaveLength(26);
    });

    it('recusa com motivo honesto quando o CLI não está disponível', async () => {
      const { service, jobs } = makeHarness({ qmd: false });

      const outcome = await service.requestReindex('project-1', 'manual');

      expect(outcome.status).toBe('skipped');
      expect(outcome.reason).toContain('qmd CLI is not available');
      expect(jobs).toHaveLength(0);
    });
  });

  describe('runEmbedNow', () => {
    it('não roda com sessão ativa — este é o coração do pedido', async () => {
      const { service } = makeHarness({ sessions: ['running'] });
      const spawned = jest.spyOn(service as any, 'runQmd');

      const outcome = await service.runEmbedNow({ projectId: 'project-1', reason: 'post-wave' });

      expect(outcome.status).toBe('queued');
      expect(outcome.reason).toContain('1 active session(s)');
      expect(spawned).not.toHaveBeenCalled();
    });

    it('um embed por máquina: com o lock tomado, nenhum processo é disparado', async () => {
      const { service } = makeHarness();
      const runQmd = jest.spyOn(service as any, 'runQmd').mockResolvedValue(undefined);
      // Lock de outro dono (outro backend, ou um embed manual na mão do usuário).
      await (service as any).acquireLock('outro-processo', 'manual');

      const outcome = await service.runEmbedNow({ projectId: 'project-1', reason: 'manual' });

      expect(outcome.status).toBe('queued');
      expect(outcome.reason).toContain('one embed per machine');
      expect(runQmd).not.toHaveBeenCalled();
    });

    it('não roda embed sem escopo quando o projeto não tem coleção', async () => {
      const { service } = makeHarness();
      jest.spyOn(service as any, 'ensureCollections').mockResolvedValue([]);
      const runQmd = jest.spyOn(service as any, 'runQmd').mockResolvedValue(undefined);

      const outcome = await service.runEmbedNow({ projectId: 'project-1', reason: 'manual' });

      // Sem `-c`, o embed reindexaria as coleções dos outros projetos da máquina.
      expect(outcome.status).toBe('skipped');
      expect(outcome.reason).toContain('No qmd collection registered');
      expect(runQmd).not.toHaveBeenCalled();
    });

    it('libera o lock no finally, mesmo quando o processo falha', async () => {
      const { service, store } = makeHarness();
      jest.spyOn(service as any, 'ensureCollections').mockResolvedValue(['onequest-docs']);
      jest.spyOn(service as any, 'runQmd').mockRejectedValue(new Error('qmd embed exited with 1'));

      await expect(service.runEmbedNow({ projectId: 'project-1', reason: 'manual' })).rejects.toThrow('exited with 1');

      expect(store.has('qmd:embed:lock')).toBe(false);
      // O status seguinte tem de contar a falha, não fingir índice fresco.
      expect(JSON.parse(store.get('qmd:embed:last-run')!)).toMatchObject({ ok: false, reason: 'manual' });
    });
  });

  describe('readLastRun', () => {
    it('reconstrói o último embed pelo job quando o Redis esqueceu (restart)', async () => {
      const executedAt = new Date(Date.now() - 60_000);
      const { service } = makeHarness({
        jobs: [
          {
            id: 'job-old',
            type: QMD_EMBED_JOB_TYPE,
            status: 'completed',
            scheduledAt: executedAt,
            payload: { projectId: 'project-1', reason: 'post-wave' },
            executedAt,
            result: { status: 'started', durationMs: 120_000 },
          } as any,
        ],
      });

      const lastRun = await (service as any).readLastRun();

      expect(lastRun).toMatchObject({ ok: true, reason: 'post-wave', durationMs: 120_000 });
      expect(lastRun.at).toBe(executedAt.toISOString());
    });

    it('não conta job concluído sem embed real (skipped) como último embed', async () => {
      const executedAt = new Date();
      const { service } = makeHarness({
        jobs: [
          {
            id: 'job-skip',
            type: QMD_EMBED_JOB_TYPE,
            status: 'completed',
            scheduledAt: executedAt,
            payload: { projectId: 'project-1' },
            executedAt,
            result: { status: 'skipped', reason: 'qmd CLI unavailable' },
          } as any,
        ],
      });

      expect(await (service as any).readLastRun()).toBeNull();
    });
  });

  describe('readReason', () => {
    it('normaliza payload cru em vez de deixar undefined vazar para o status', () => {
      const { service } = makeHarness();

      expect(service.readReason('pre-wave')).toBe('pre-wave');
      expect(service.readReason(undefined)).toBe('manual');
      expect(service.readReason('lixo')).toBe('manual');
    });
  });

  describe('nextDeferral', () => {
    it('adia contando os adiamentos', () => {
      const { service } = makeHarness();

      const next = service.nextDeferral({ projectId: 'project-1', reason: 'post-wave', deferCount: 3 });

      expect(next.payload.deferCount).toBe(4);
      expect(next.scheduledAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('desiste depois do teto para não deixar job pendente eterno', () => {
      const { service } = makeHarness();

      expect(() =>
        service.nextDeferral({ projectId: 'project-1', reason: 'post-wave', deferCount: 480 }),
      ).toThrow(/postponed 480 times/);
    });
  });

  describe('nextRetry', () => {
    it('retenta com backoff crescente em vez de deixar o índice defasado', () => {
      const { service } = makeHarness();

      const first = service.nextRetry({ projectId: 'project-1', reason: 'post-wave' }, 'sem memória')!;
      const second = service.nextRetry(first.payload, 'sem memória')!;

      expect(first.payload.attempts).toBe(1);
      expect(second.payload.attempts).toBe(2);
      // 5 min e depois 10 min: a segunda espera mais que a primeira.
      expect(second.scheduledAt.getTime()).toBeGreaterThan(first.scheduledAt.getTime());
    });

    it('zera os adiamentos: falhar não é a mesma coisa que esperar sessão terminar', () => {
      const { service } = makeHarness();

      const retry = service.nextRetry(
        { projectId: 'project-1', reason: 'post-wave', deferCount: 12 },
        'disco cheio',
      )!;

      expect(retry.payload.deferCount).toBe(0);
    });

    it('devolve null no teto para o job virar failed com o erro real', () => {
      const { service } = makeHarness();

      expect(service.nextRetry({ projectId: 'project-1', reason: 'post-wave', attempts: 2 }, 'x')).toBeNull();
    });
  });
});
