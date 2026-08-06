import { SchedulerService } from './scheduler.service';
import { MASTER_LOOP_JOB_TYPE, MasterLoopPayload } from '../scheduled-jobs/master-loop';
import { QMD_EMBED_JOB_TYPE } from '../context/qmd-embed.service';

/**
 * Recorrência do `master_loop` com Prisma e Master mockados — nenhum prompt real
 * é enviado a nenhum terminal, nenhuma linha é escrita no banco.
 *
 * O fake de Prisma simula a fila: `findMany` devolve os jobs pendentes com
 * `scheduledAt <= now` e `update`/`updateMany` mutam o registro em memória, o que
 * permite rodar `processScheduledJobs()` várias vezes e observar o ciclo
 * pending → running → pending → ... → completed.
 */

interface FakeJob {
  id: string;
  type: string;
  payload: any;
  notes?: string | null;
  scheduledAt: Date;
  status: string;
  result?: any;
  executedAt?: Date | null;
}

/**
 * `masterStatus` pode ser um status fixo (compat com os testes de sempre) ou um
 * mapa `projectId -> status`, para os cenários que precisam de dois projetos
 * com Masters em situações diferentes (MT-20).
 */
function makeHarness(jobs: FakeJob[], masterStatus: any | Record<string, any>) {
  const logEntries: any[] = [];
  const prompts: string[] = [];
  const promptedProjects: string[] = [];

  const prisma = {
    scheduledJob: {
      findMany: jest.fn(async ({ where }: any) => {
        const now: Date = where.scheduledAt.lte;
        return jobs
          .filter((job) => job.status === where.status && job.scheduledAt.getTime() <= now.getTime())
          .map((job) => ({ ...job }));
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const job = jobs.find((j) => j.id === where.id && j.status === where.status);
        if (!job) return { count: 0 };
        Object.assign(job, data);
        return { count: 1 };
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const job = jobs.find((j) => j.id === where.id);
        if (job) Object.assign(job, data);
        return job;
      }),
    },
    project: {
      findUnique: jest.fn(async () => ({
        id: 'project-1',
        name: 'Orchestr',
        mainPath: '/tmp/project-1',
      })),
    },
    logEntry: {
      create: jest.fn(async ({ data }: any) => {
        logEntries.push(data);
        return data;
      }),
    },
  };

  const service = new SchedulerService(
    prisma as any,
    { publish: jest.fn() } as any,
    {} as any,
    {} as any,
    {
      // MT-20: `getStatus` é chamado com o `projectId` do job — um mapa por
      // projeto deixa o fake responder por projeto; um status fixo (como os
      // testes de sempre passam) responde igual para qualquer um.
      getStatus: jest.fn(async (projectId?: string) =>
        projectId && masterStatus[projectId] !== undefined ? masterStatus[projectId] : masterStatus,
      ),
    } as any,
    {
      sendPrompt: jest.fn(async (projectId: string, text: string) => {
        promptedProjects.push(projectId);
        prompts.push(text);
      }),
    } as any,
    // QmdEmbedService: nenhum teste daqui exercita o job `qmd_embed` (MT-6).
    {} as any,
  );

  return { service, prisma, prompts, promptedProjects, logEntries };
}

const activeMaster = {
  isActive: true,
  tmuxRunning: true,
  projectId: 'project-1',
  projectName: 'Orchestr',
};

function masterLoopJob(payload: Partial<MasterLoopPayload>): FakeJob {
  return {
    id: 'job-1',
    type: MASTER_LOOP_JOB_TYPE,
    payload: {
      instructions: 'Check the stalled sessions and report in the chat',
      projectId: 'project-1',
      runCount: 0,
      ...payload,
    },
    scheduledAt: new Date(Date.now() - 1000),
    status: 'pending',
  };
}

describe('SchedulerService — master_loop', () => {
  it('CA1: maxRuns=3 com recorrência dispara exatamente 3 vezes e depois marca completed', async () => {
    const job = masterLoopJob({ repeatIntervalMinutes: 60, maxRuns: 3 });
    const { service, prompts } = makeHarness([job], activeMaster);

    for (let tick = 0; tick < 6; tick++) {
      // Simula a passagem do tempo: cada tick "atrasa" o scheduledAt para o passado.
      job.scheduledAt = new Date(Date.now() - 1000);
      await service.processScheduledJobs();
    }

    expect(prompts).toHaveLength(3);
    expect(job.payload.runCount).toBe(3);
    expect(job.status).toBe('completed');
    expect(prompts[0]).toContain('[ORCHESTRATOR SCHEDULED LOOP job-1 run 1/3]');
    expect(prompts[2]).toContain('run 3/3');
    expect(prompts[0]).toContain('Check the stalled sessions and report in the chat');
  });

  it('CA2: sem recorrência dispara uma vez e marca completed (igual aos jobs de hoje)', async () => {
    const job = masterLoopJob({});
    const { service, prompts } = makeHarness([job], activeMaster);

    await service.processScheduledJobs();
    job.scheduledAt = new Date(Date.now() - 1000);
    await service.processScheduledJobs();

    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('run 1/1');
    expect(job.payload.runCount).toBe(1);
    expect(job.status).toBe('completed');
    expect(job.result.finished).toBe(true);
  });

  it('recorrência sem maxRuns segue reagendando (não marca completed)', async () => {
    const job = masterLoopJob({ repeatIntervalMinutes: 30 });
    const { service, prompts } = makeHarness([job], activeMaster);

    for (let tick = 0; tick < 4; tick++) {
      job.scheduledAt = new Date(Date.now() - 1000);
      await service.processScheduledJobs();
    }

    expect(prompts).toHaveLength(4);
    expect(prompts[0]).toContain('run 1/∞');
    expect(job.status).toBe('pending');
    expect(job.payload.runCount).toBe(4);
  });

  it('Master desligado: não dispara, não consome execução e reagenda com o motivo', async () => {
    const job = masterLoopJob({ repeatIntervalMinutes: 60, maxRuns: 3 });
    const { service, prompts, logEntries } = makeHarness([job], {
      ...activeMaster,
      isActive: false,
      tmuxRunning: false,
    });

    await service.processScheduledJobs();

    expect(prompts).toHaveLength(0);
    expect(job.payload.runCount).toBe(0);
    expect(job.payload.deferCount).toBe(1);
    expect(job.payload.lastError).toContain('Master Agent terminal is not running');
    expect(job.status).toBe('pending');
    expect(job.scheduledAt.getTime()).toBeGreaterThan(Date.now());
    expect(logEntries.some((entry) => entry.level === 'warn')).toBe(true);
  });

  it('MT-20: Master ativo só em OUTRO projeto não trava o loop deste projeto (Masters são independentes)', async () => {
    const job = masterLoopJob({ repeatIntervalMinutes: 15 });
    // Antes da MT-20 havia um Master só, e "ativo em outro projeto" adiava o
    // loop. Com um Master por projeto, o status relevante é o do PRÓPRIO
    // projeto do job — o de "project-2" nem é consultado.
    const { service, prompts, promptedProjects } = makeHarness([job], {
      'project-1': activeMaster,
      'project-2': { isActive: false, tmuxRunning: false, projectId: null },
    });

    await service.processScheduledJobs();

    expect(prompts).toHaveLength(1);
    expect(promptedProjects).toEqual(['project-1']);
    expect(job.payload.runCount).toBe(1);
  });

  it('MT-20: Master INATIVO no próprio projeto adia o loop, mesmo com outro projeto ativo', async () => {
    const job = masterLoopJob({ repeatIntervalMinutes: 15 });
    const { service, prompts } = makeHarness([job], {
      'project-1': { isActive: false, tmuxRunning: false, projectId: null },
      'project-2': activeMaster,
    });

    await service.processScheduledJobs();

    expect(prompts).toHaveLength(0);
    expect(job.payload.lastError).toContain('Master Agent terminal is not running');
    expect(job.status).toBe('pending');
  });

  it('payload sem instructions vira failed (erro permanente)', async () => {
    const job = masterLoopJob({});
    job.payload.instructions = '   ';
    const { service, prompts } = makeHarness([job], activeMaster);

    await service.processScheduledJobs();

    expect(prompts).toHaveLength(0);
    expect(job.status).toBe('failed');
    expect(job.result.error).toContain('no instructions');
  });

  it('adiado além do teto vira failed em vez de ficar pendente para sempre', async () => {
    const job = masterLoopJob({ repeatIntervalMinutes: 60, maxRuns: 3 });
    job.payload.deferCount = 24;
    const { service } = makeHarness([job], { ...activeMaster, tmuxRunning: false });

    await service.processScheduledJobs();

    expect(job.status).toBe('failed');
    expect(job.result.error).toContain('skipped 24 times');
  });

  it('reativar um loop já concluído não dispara execução extra (teto duro do maxRuns)', async () => {
    const job = masterLoopJob({ repeatIntervalMinutes: 60, maxRuns: 3 });
    job.payload.runCount = 3;
    const { service, prompts } = makeHarness([job], activeMaster);

    await service.processScheduledJobs();

    expect(prompts).toHaveLength(0);
    expect(job.payload.runCount).toBe(3);
    expect(job.status).toBe('completed');
    expect(job.result.skipped).toContain('already reached');
  });
});

/**
 * O aceite da MT-13: o tick não é mais serial.
 *
 * O `qmd_embed` roda um processo externo de até 30 min. Em série, todo o resto do
 * tick esperava por ele — sessão travada só detectada 30 min depois e `master_loop`
 * de 5 min perdendo execuções. Aqui o embed é um promise que NÃO resolve até o
 * teste liberar: se os jobs curtos só terminassem depois dele, o `await` do
 * primeiro `expect` estouraria o timeout do jest em vez de passar.
 */
function makeConcurrencyHarness() {
  const jobs: FakeJob[] = [
    {
      id: 'embed-longo',
      type: QMD_EMBED_JOB_TYPE,
      payload: { projectId: 'project-1', reason: 'post-wave' },
      scheduledAt: new Date(Date.now() - 3000),
      status: 'pending',
    },
    {
      id: 'session-timeout-curto',
      type: 'session_timeout',
      payload: { sessionId: 'session-travada' },
      scheduledAt: new Date(Date.now() - 2000),
      status: 'pending',
    },
    {
      id: 'stage-timeout-curto',
      type: 'stage_timeout',
      payload: { sessionId: 'session-sumida', stageName: 'Contexto' },
      scheduledAt: new Date(Date.now() - 1000),
      status: 'pending',
    },
  ];

  const prisma = {
    scheduledJob: {
      findMany: jest.fn(async ({ where }: any) =>
        jobs
          .filter((job) => job.status === where.status && job.scheduledAt.getTime() <= where.scheduledAt.lte.getTime())
          .map((job) => ({ ...job })),
      ),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const job = jobs.find((j) => j.id === where.id && j.status === where.status);
        if (!job) return { count: 0 };
        Object.assign(job, data);
        return { count: 1 };
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const job = jobs.find((j) => j.id === where.id);
        if (job) Object.assign(job, data);
        return job;
      }),
    },
    session: {
      update: jest.fn(async () => ({})),
      // `stage_timeout` de sessão que já sumiu: encerra em 'skipped', sem escrita.
      findUnique: jest.fn(async () => null),
    },
  };

  // O embed só resolve quando o teste chamar `releaseEmbed()`.
  let releaseEmbed: () => void = () => undefined;
  const embedFinished = new Promise<void>((resolve) => {
    releaseEmbed = resolve;
  });
  const qmdEmbed = {
    readReason: (value: unknown) => (typeof value === 'string' ? value : 'manual'),
    runEmbedNow: jest.fn(async () => {
      await embedFinished;
      return { status: 'started', reason: 'terminou quando o teste deixou' };
    }),
  };

  const service = new SchedulerService(
    prisma as any,
    { publish: jest.fn() } as any,
    {} as any,
    {} as any,
    { getStatus: jest.fn(async () => activeMaster) } as any,
    { sendPrompt: jest.fn() } as any,
    qmdEmbed as any,
  );

  const byId = (id: string) => jobs.find((job) => job.id === id)!;
  return { service, jobs, byId, releaseEmbed: () => releaseEmbed() };
}

/** Espera uma condição virar verdadeira sem prender o event loop. */
async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(`Timeout esperando: ${label}`);
}

describe('SchedulerService — tick concorrente (MT-13)', () => {
  it('job longo não atrasa os outros do mesmo tick', async () => {
    const { service, byId, releaseEmbed } = makeConcurrencyHarness();

    const tick = service.processScheduledJobs();

    // Os curtos terminam com o embed AINDA rodando: é isso que era impossível
    // no laço serial, onde nenhum job começava antes do anterior terminar.
    await waitFor(
      () => byId('session-timeout-curto').status === 'completed' && byId('stage-timeout-curto').status === 'completed',
      'os dois jobs curtos concluírem enquanto o embed roda',
    );
    expect(byId('embed-longo').status).toBe('running');

    releaseEmbed();
    await tick;

    expect(byId('embed-longo').status).toBe('completed');
  });

  it('um job que estoura não impede o resto do tick de ser gravado', async () => {
    const { service, byId, releaseEmbed } = makeConcurrencyHarness();
    // Sessão que não existe mais: o `session_timeout` estoura no update.
    (service as any).prisma.session.update = jest.fn(async () => {
      throw new Error('Record to update not found');
    });

    releaseEmbed();
    await service.processScheduledJobs();

    expect(byId('session-timeout-curto').status).toBe('failed');
    expect(byId('session-timeout-curto').result.error).toContain('not found');
    expect(byId('stage-timeout-curto').status).toBe('completed');
    expect(byId('embed-longo').status).toBe('completed');
  });
});
