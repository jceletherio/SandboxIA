import {
  MASTER_TICK_JOB_TYPE,
  readMasterTickPayload,
  readNextTickAt,
  syncMasterTickJob,
} from './master-tick';
import { DEFAULT_SCHEDULING_CONFIG, SchedulingConfig } from '../master-agent/master-scheduling.config';

/**
 * `syncMasterTickJob`/`readNextTickAt` são o desenho que fecha a causa raiz #1
 * da MT-2: o job em banco (não um timer em memória do projeto ativo) é o dono
 * do agendamento, então dois projetos com automação ligada têm cada um o seu
 * `master_tick`, disparando independentemente. O teste central desta suíte
 * ("dois projetos, dois jobs independentes") é a prova direta do aceite da
 * MT-20 — "automação disparando para 2 projetos ao mesmo tempo".
 */

interface FakeJob {
  id: string;
  type: string;
  payload: any;
  scheduledAt: Date;
  status: string;
  notes?: string;
}

function fakeJobsDelegate(seed: FakeJob[] = []) {
  const jobs = [...seed];
  let seq = 0;
  return {
    jobs,
    findMany: jest.fn(async ({ where }: any) => {
      return jobs.filter(
        (job) => job.type === where.type && where.status.in.includes(job.status),
      );
    }),
    create: jest.fn(async ({ data }: any) => {
      const job: FakeJob = { id: `job-${++seq}`, status: 'pending', ...data };
      jobs.push(job);
      return job;
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const job = jobs.find((j) => j.id === where.id);
      Object.assign(job, data);
      return job;
    }),
    delete: jest.fn(async ({ where }: any) => {
      const idx = jobs.findIndex((j) => j.id === where.id);
      if (idx >= 0) jobs.splice(idx, 1);
    }),
  } as any;
}

function configWith(patch: Partial<SchedulingConfig>): SchedulingConfig {
  return { ...DEFAULT_SCHEDULING_CONFIG, ...patch };
}

const now = new Date('2026-08-04T12:00:00.000Z');

describe('syncMasterTickJob — reconciliação do job com a config', () => {
  it('cria o job quando nenhuma automação estava habilitada antes', async () => {
    const jobs = fakeJobsDelegate();
    const result = await syncMasterTickJob(jobs, 'proj-a', configWith({ tickIntervalMinutes: 10 }), now);

    expect(result.action).toBe('created');
    expect(result.scheduledAt).toBe(new Date('2026-08-04T12:10:00.000Z').toISOString());
    expect(jobs.jobs).toHaveLength(1);
    expect(readMasterTickPayload(jobs.jobs[0].payload).projectId).toBe('proj-a');
  });

  it('nenhuma parte habilitada: não cria job (e remove o que já existia)', async () => {
    const jobs = fakeJobsDelegate([
      {
        id: 'job-1',
        type: MASTER_TICK_JOB_TYPE,
        payload: { projectId: 'proj-a', runCount: 3 },
        scheduledAt: new Date('2026-08-04T12:05:00.000Z'),
        status: 'pending',
      },
    ]);
    const off = configWith({
      autoTriageEnabled: false,
      sessionCheckEnabled: false,
      statusReportEnabled: false,
      autoStartEnabled: false,
      contextRecycleEnabled: false,
    });

    const result = await syncMasterTickJob(jobs, 'proj-a', off, now);

    expect(result.action).toBe('removed');
    expect(result.scheduledAt).toBeNull();
    expect(jobs.jobs).toHaveLength(0);
  });

  it('já dentro da nova cadência: mantém o horário (save sem mudança não reinicia o relógio)', async () => {
    const jobs = fakeJobsDelegate([
      {
        id: 'job-1',
        type: MASTER_TICK_JOB_TYPE,
        payload: { projectId: 'proj-a', runCount: 1 },
        scheduledAt: new Date('2026-08-04T12:03:00.000Z'),
        status: 'pending',
      },
    ]);

    const result = await syncMasterTickJob(jobs, 'proj-a', configWith({ tickIntervalMinutes: 10 }), now);

    expect(result.action).toBe('kept');
    expect(result.scheduledAt).toBe(new Date('2026-08-04T12:03:00.000Z').toISOString());
  });

  it('intervalo encurtado antecipa o próximo disparo em vez de esperar a cadência antiga', async () => {
    const jobs = fakeJobsDelegate([
      {
        id: 'job-1',
        type: MASTER_TICK_JOB_TYPE,
        payload: { projectId: 'proj-a', runCount: 1 },
        scheduledAt: new Date('2026-08-04T12:55:00.000Z'), // cadência antiga de 60min
        status: 'pending',
      },
    ]);

    const result = await syncMasterTickJob(jobs, 'proj-a', configWith({ tickIntervalMinutes: 5 }), now);

    expect(result.action).toBe('rescheduled');
    expect(result.scheduledAt).toBe(new Date('2026-08-04T12:05:00.000Z').toISOString());
  });

  it('duplicata pendente (dois saves correndo juntos) é limpa no primeiro sync seguinte', async () => {
    const jobs = fakeJobsDelegate([
      {
        id: 'job-1',
        type: MASTER_TICK_JOB_TYPE,
        payload: { projectId: 'proj-a', runCount: 0 },
        scheduledAt: new Date('2026-08-04T12:10:00.000Z'),
        status: 'pending',
      },
      {
        id: 'job-2',
        type: MASTER_TICK_JOB_TYPE,
        payload: { projectId: 'proj-a', runCount: 0 },
        scheduledAt: new Date('2026-08-04T12:11:00.000Z'),
        status: 'pending',
      },
    ]);

    await syncMasterTickJob(jobs, 'proj-a', configWith({ tickIntervalMinutes: 10 }), now);

    expect(jobs.jobs).toHaveLength(1);
  });
});

describe('MT-20 — dois projetos, dois jobs independentes (prova do aceite)', () => {
  it('sincronizar a config de um projeto não cria, altera nem remove o job do outro', async () => {
    const jobs = fakeJobsDelegate();

    await syncMasterTickJob(jobs, 'proj-a', configWith({ tickIntervalMinutes: 10 }), now);
    await syncMasterTickJob(jobs, 'proj-b', configWith({ tickIntervalMinutes: 30 }), now);

    expect(jobs.jobs).toHaveLength(2);
    const byProject = new Map<string, FakeJob>(
      jobs.jobs.map((job: FakeJob) => [readMasterTickPayload(job.payload).projectId, job]),
    );
    expect(byProject.get('proj-a')!.scheduledAt).toEqual(new Date('2026-08-04T12:10:00.000Z'));
    expect(byProject.get('proj-b')!.scheduledAt).toEqual(new Date('2026-08-04T12:30:00.000Z'));

    // Desligar a automação do projeto A não mexe no job do projeto B.
    await syncMasterTickJob(
      jobs,
      'proj-a',
      configWith({
        autoTriageEnabled: false,
        sessionCheckEnabled: false,
        statusReportEnabled: false,
        autoStartEnabled: false,
        contextRecycleEnabled: false,
      }),
      now,
    );

    expect(jobs.jobs).toHaveLength(1);
    expect(readMasterTickPayload(jobs.jobs[0].payload).projectId).toBe('proj-b');
  });

  it('readNextTickAt responde por projeto — cada um lê o próprio job, nunca o do outro', async () => {
    const jobs = fakeJobsDelegate();
    await syncMasterTickJob(jobs, 'proj-a', configWith({ tickIntervalMinutes: 10 }), now);
    await syncMasterTickJob(jobs, 'proj-b', configWith({ tickIntervalMinutes: 45 }), now);

    const nextA = await readNextTickAt(jobs, 'proj-a');
    const nextB = await readNextTickAt(jobs, 'proj-b');
    const nextC = await readNextTickAt(jobs, 'proj-sem-automacao');

    expect(nextA).toBe(new Date('2026-08-04T12:10:00.000Z').toISOString());
    expect(nextB).toBe(new Date('2026-08-04T12:45:00.000Z').toISOString());
    expect(nextC).toBeNull();
  });
});
