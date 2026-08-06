import { MasterAgentService } from './master-agent.service';
import { DEFAULT_SCHEDULING_CONFIG } from './master-scheduling.config';

/**
 * Avaliação de sessões do health-check (MT-27, MT-23) com Prisma, Redis e
 * runtime mockados — nenhum prompt real vai para nenhum terminal.
 *
 * Regressões que estes testes travam: sessão `paused` era buscada no banco e
 * excluída de propósito da lista de travadas (`s.status !== 'paused'`), então
 * nunca virava prompt e nunca era tocada. Junto disso, o prompt só sabia
 * mandar parar a sessão — não havia como retomá-la. Depois da MT-23, o Master
 * também não tem mais relógio próprio: uma `running` só entra na lista de
 * travadas por `stalledAt` gravado pelo watchdog do runtime, nunca mais por
 * `updatedAt` comparado a `stalledAfterMinutes`.
 */

interface FakeSession {
  id: string;
  status: string;
  currentStage: string | null;
  updatedAt: Date;
  stalledAt?: Date | null;
  stageData?: unknown;
}

function makeHarness(sessions: FakeSession[]) {
  const prompts: string[] = [];
  const published: Array<{ channel: string; payload: any }> = [];

  const prisma = {
    session: {
      findMany: jest.fn(async ({ where }: any) =>
        sessions
          .filter((s) => where.status.in.includes(s.status))
          .map((s) => ({
            ...s,
            stageData: s.stageData ?? null,
            macroTask: { title: `Task ${s.id}`, project: { name: 'OneQuest' } },
          })),
      ),
    },
    logEntry: { create: jest.fn(async () => ({})) },
  } as any;

  const redis = {
    publish: jest.fn(async (channel: string, payload: any) => {
      published.push({ channel, payload });
    }),
    getClient: () => ({ get: jest.fn(), set: jest.fn(), getdel: jest.fn() }),
    subscribe: jest.fn(),
  } as any;

  const masterRuntime = {
    isRunning: jest.fn(async () => true),
    sendPrompt: jest.fn(async (_projectId: string, text: string) => void prompts.push(text)),
  } as any;

  const service = new MasterAgentService(prisma, redis, masterRuntime, {} as any);
  // O Master só age ativo e com projeto; `activate` faria I/O real de tmux.
  // MT-20: o estado escalar do serviço virou `runtimes` (um Master por
  // projeto) — o harness monta a entrada do projeto único que os testes usam.
  Object.assign(service as any, {
    runtimes: new Map([
      [
        'project-1',
        {
          projectId: 'project-1',
          cliProfileId: 'cli-1',
          mcpToken: 'token-1',
          schedulingConfig: { ...DEFAULT_SCHEDULING_CONFIG, stalledAfterMinutes: 10 },
          tickCount: 0,
          lastRecycleTick: 0,
          tickRunning: false,
          lastSessionCheckAt: null,
          promptedAt: new Map(),
        },
      ],
    ]),
  });

  return { service, prompts, published, prisma };
}

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);

describe('checkSessionsHealth — sessão pausada entra na avaliação', () => {
  it('sessão paused recém-atualizada é tratada como travada (pausa não passa com o tempo)', async () => {
    const { service, prompts, published } = makeHarness([
      { id: 's-paused', status: 'paused', currentStage: 'Merge', updatedAt: minutesAgo(1) },
    ]);

    const result = await service.checkSessionsHealth();

    expect(result.stalled).toBe(1);
    expect(result.prompted).toBe(true);
    expect(published.map((p) => p.channel)).toContain('session:stalled');
    expect(prompts[0]).toContain('⏸ PAUSED');
  });

  it('o motivo da pausa vai no prompt, quando o engine gravou um', async () => {
    const { service, prompts } = makeHarness([
      {
        id: 's-paused',
        status: 'paused',
        currentStage: 'Merge',
        updatedAt: minutesAgo(1),
        stageData: { pauseReason: 'Merge conflicts require human resolution' },
      },
    ]);

    await service.checkSessionsHealth();
    expect(prompts[0]).toContain('Merge conflicts require human resolution');
  });

  it('running sem stalledAt fica fora da lista mesmo com updatedAt antigo — o relógio não é mais do Master', async () => {
    const { service, prompts } = makeHarness([
      { id: 's-ok', status: 'running', currentStage: 'Implementação', updatedAt: minutesAgo(999) },
    ]);

    const result = await service.checkSessionsHealth();

    expect(result.stalled).toBe(0);
    expect(result.prompted).toBe(false);
    expect(prompts).toHaveLength(0);
  });

  it('running com stalledAt gravado pelo watchdog do runtime é travada, mesmo com updatedAt recente', async () => {
    const { service, prompts } = makeHarness([
      {
        id: 's-stalled',
        status: 'running',
        currentStage: 'Testes',
        updatedAt: minutesAgo(1),
        stalledAt: minutesAgo(45),
      },
    ]);

    const result = await service.checkSessionsHealth();

    expect(result.stalled).toBe(1);
    expect(prompts[0]).toContain('⚠ STALLED');
  });
});

describe('prompt de health — retomar antes de escalar ou parar', () => {
  it('oferece resume_session e retry_stage, e marca stop_session como último recurso', async () => {
    const { service, prompts } = makeHarness([
      { id: 's-paused', status: 'paused', currentStage: 'Merge', updatedAt: minutesAgo(1) },
    ]);

    await service.checkSessionsHealth();
    const prompt = prompts[0];

    expect(prompt).toContain('resume_session');
    expect(prompt).toContain('retry_stage');
    // A ordem no texto é o que ensina a precedência ao Master.
    expect(prompt.indexOf('resume_session')).toBeLessThan(prompt.indexOf('stop_session'));
  });

  it('avisa que resume/retry não valem para uma running travada (rodaria o stage duas vezes)', async () => {
    const { service, prompts } = makeHarness([
      {
        id: 's-stalled',
        status: 'running',
        currentStage: 'Testes',
        updatedAt: minutesAgo(1),
        stalledAt: minutesAgo(45),
      },
    ]);

    await service.checkSessionsHealth();
    expect(prompts[0]).toContain('do NOT apply');
  });
});
