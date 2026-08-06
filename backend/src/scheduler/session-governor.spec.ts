import { SessionGovernorService } from './session-governor.service';

/**
 * Auto-start da próxima macro task pendente (MT-27) com Prisma e engine
 * mockados — nenhuma sessão real sobe, nenhum worktree é criado.
 *
 * O cenário que motivou a task é o do primeiro teste: 13 pendentes e slot
 * livre. Puxar todas de uma vez era o risco óbvio da correção, e é o que o
 * teto por chamada impede.
 */

interface FakeTask {
  id: string;
  title: string;
  priority: number;
  metadata: unknown;
  liveSessions?: number;
}

function makeHarness(tasks: FakeTask[], opts: { agent?: boolean; queuedFrom?: number } = {}) {
  const started: string[] = [];

  const prisma = {
    macroTask: {
      findMany: jest.fn(async ({ orderBy }: any) => {
        // O fake aplica a MESMA ordenação que o serviço pede ao Prisma, senão
        // o teste de prioridade estaria validando a ordem do array de entrada.
        expect(orderBy).toEqual([{ priority: 'desc' }, { createdAt: 'asc' }]);
        return tasks
          .filter((task) => !task.liveSessions)
          .slice()
          .sort((a, b) => b.priority - a.priority)
          .map((task) => ({ id: task.id, title: task.title, metadata: task.metadata }));
      }),
    },
    agent: {
      findFirst: jest.fn(async () =>
        opts.agent === false ? null : { id: 'agent-1', cliProfileId: 'cli-1' },
      ),
    },
  } as any;

  const pipelineEngine = {
    startPipeline: jest.fn(async (macroTaskId: string) => {
      if (opts.queuedFrom !== undefined && started.length >= opts.queuedFrom) {
        return { queued: true, position: 1, reason: 'global', detail: 'teto global atingido' };
      }
      started.push(macroTaskId);
      return { id: `session-${macroTaskId}` };
    }),
  } as any;

  const redis = { subscribe: jest.fn(), publish: jest.fn() } as any;
  const governor = new SessionGovernorService(prisma, redis, pipelineEngine);
  return { governor, prisma, pipelineEngine, started };
}

function pendingTasks(count: number): FakeTask[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `mt-${i + 1}`,
    title: `Macro task ${i + 1}`,
    priority: 0,
    metadata: null,
  }));
}

describe('autoStartPending — teto por chamada', () => {
  it('13 pendentes com slot livre sobem UMA por tick, não 13', async () => {
    const { governor, started } = makeHarness(pendingTasks(13));
    const result = await governor.autoStartPending('project-1', 1);
    expect(result.started).toHaveLength(1);
    expect(started).toEqual(['mt-1']);
    expect(result.skipped).toBe(12);
  });

  it('respeita um teto maior sem passar dele', async () => {
    const { governor, started } = makeHarness(pendingTasks(13));
    await governor.autoStartPending('project-1', 3);
    expect(started).toHaveLength(3);
  });

  it('teto zero ou negativo ainda sobe uma só — nunca a fila inteira', async () => {
    const { governor, started } = makeHarness(pendingTasks(13));
    await governor.autoStartPending('project-1', 0);
    expect(started).toHaveLength(1);
  });
});

describe('autoStartPending — quem entra na varredura', () => {
  it('sobe por prioridade desc', async () => {
    const tasks: FakeTask[] = [
      { id: 'baixa', title: 'baixa', priority: 1, metadata: null },
      { id: 'alta', title: 'alta', priority: 9, metadata: null },
      { id: 'media', title: 'media', priority: 5, metadata: null },
    ];
    const { governor, started } = makeHarness(tasks);
    await governor.autoStartPending('project-1', 2);
    expect(started).toEqual(['alta', 'media']);
  });

  it('pula task com opt-out (metadata.autoStart === false)', async () => {
    const tasks: FakeTask[] = [
      { id: 'manual', title: 'manual', priority: 9, metadata: { autoStart: false } },
      { id: 'auto', title: 'auto', priority: 1, metadata: null },
    ];
    const { governor, started } = makeHarness(tasks);
    await governor.autoStartPending('project-1', 5);
    expect(started).toEqual(['auto']);
  });

  it('pula quem já está marcado em fila — isso é assunto do promoteQueue', async () => {
    const tasks: FakeTask[] = [
      { id: 'na-fila', title: 'na-fila', priority: 9, metadata: { queue: { queuedAt: 'x' } } },
      { id: 'nova', title: 'nova', priority: 1, metadata: null },
    ];
    const { governor, started } = makeHarness(tasks);
    await governor.autoStartPending('project-1', 5);
    expect(started).toEqual(['nova']);
  });

  it('ignora task que já tem sessão viva', async () => {
    const tasks: FakeTask[] = [
      { id: 'rodando', title: 'rodando', priority: 9, metadata: null, liveSessions: 1 },
      { id: 'parada', title: 'parada', priority: 1, metadata: null },
    ];
    const { governor, started } = makeHarness(tasks);
    await governor.autoStartPending('project-1', 5);
    expect(started).toEqual(['parada']);
  });
});

describe('autoStartPending — freios', () => {
  it('para a varredura quando o governor enfileira: as próximas batem no mesmo teto', async () => {
    const { governor, pipelineEngine } = makeHarness(pendingTasks(13), { queuedFrom: 2 });
    const result = await governor.autoStartPending('project-1', 6);
    expect(result.started).toHaveLength(2);
    // 2 promoções + a tentativa que voltou enfileirada, e nada além disso.
    expect(pipelineEngine.startPipeline).toHaveBeenCalledTimes(3);
  });

  it('projeto sem agente com CLI profile não sobe nada', async () => {
    const { governor, pipelineEngine } = makeHarness(pendingTasks(3), { agent: false });
    const result = await governor.autoStartPending('project-1', 1);
    expect(result.started).toEqual([]);
    expect(result.skipped).toBe(3);
    expect(pipelineEngine.startPipeline).not.toHaveBeenCalled();
  });

  it('sem candidata elegível não chama o engine', async () => {
    const { governor, pipelineEngine } = makeHarness([]);
    const result = await governor.autoStartPending('project-1', 1);
    expect(result.started).toEqual([]);
    expect(pipelineEngine.startPipeline).not.toHaveBeenCalled();
  });
});

/**
 * Fila que desiste de item quebrado (MT-13). Antes, item com falha PERMANENTE
 * (agente deletado, CLI fora do PATH) só virava `warn` a cada evento/poll e a
 * macro task ficava `pending` para sempre, sem ninguém ser avisado.
 */
function makeQueueHarness(failure: string) {
  const task: any = {
    id: 'mt-quebrada',
    title: 'Macro task quebrada',
    projectId: 'project-1',
    status: 'pending',
    metadata: { queue: { reason: 'global', detail: 'teto', queuedAt: '2026-08-04T10:00:00.000Z', agentId: 'agent-1', runtimeOverride: null } },
  };
  const logs: any[] = [];

  const prisma = {
    // `promoteQueue` varre a fila via `$queryRaw` (MT-17, ordenação por path de
    // Json que o Prisma não faz em `orderBy`) — sem esse mock ele quebra antes
    // de chegar em qualquer asserção do teste.
    $queryRaw: jest.fn(async () =>
      task.status === 'pending' && task.metadata?.queue
        ? [{ id: task.id, title: task.title, project_id: task.projectId, queue: task.metadata.queue }]
        : [],
    ),
    macroTask: {
      findUnique: jest.fn(async () => ({ projectId: task.projectId, metadata: task.metadata })),
      update: jest.fn(async ({ data }: any) => {
        Object.assign(task, data);
        return task;
      }),
    },
    logEntry: { create: jest.fn(async ({ data }: any) => void logs.push(data)) },
  } as any;

  const pipelineEngine = {
    startPipeline: jest.fn(async () => {
      throw new Error(failure);
    }),
  } as any;

  const governor = new SessionGovernorService(prisma, { subscribe: jest.fn(), publish: jest.fn() } as any, pipelineEngine);
  return { governor, task, logs, pipelineEngine };
}

describe('promoteQueue — teto de tentativas', () => {
  it('conta as falhas sem desistir cedo e guarda o motivo', async () => {
    const { governor, task } = makeQueueHarness('Agent agent-1 not found');

    await governor.pollQueue();
    await governor.pollQueue();

    expect(task.status).toBe('pending');
    expect(task.metadata.queue.attempts).toBe(2);
    expect(task.metadata.queue.lastError).toContain('not found');
    // A posição na fila não pode ser perdida por causa de uma falha.
    expect(task.metadata.queue.queuedAt).toBe('2026-08-04T10:00:00.000Z');
  });

  it('na 5ª falha marca failed com motivo visível e sai da fila', async () => {
    const { governor, task, logs, pipelineEngine } = makeQueueHarness('claude: command not found');

    for (let i = 0; i < 5; i++) await governor.pollQueue();

    expect(task.status).toBe('failed');
    expect(task.metadata.queueFailure.attempts).toBe(5);
    expect(task.metadata.queueFailure.detail).toContain('command not found');
    // `metadata.queue` é o que o promoteQueue enxerga: sem ele, saiu da fila.
    expect(task.metadata.queue).toBeUndefined();
    expect(logs).toHaveLength(1);
    expect(logs[0].level).toBe('error');

    // E não retenta mais, nem no próximo evento.
    await governor.pollQueue();
    expect(pipelineEngine.startPipeline).toHaveBeenCalledTimes(5);
  });
});
