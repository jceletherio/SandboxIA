import { MasterAgentService } from './master-agent.service';
import { DEFAULT_SCHEDULING_CONFIG } from './master-scheduling.config';

/**
 * Duas regressões de 04/08/2026, com Prisma/Redis/runtime mockados (nenhum tmux
 * real é criado):
 *
 * 1. O terminal do Master morria sozinho — o servidor tmux 3.2a segfaultou duas
 *    vezes (coredumps de `tmux: server` às 14:48:46 e 14:53:46) e leva TODAS as
 *    sessões com ele. O Master continuava marcado como ativo, com terminal
 *    morto, e o tick só logava "tick pulado" para sempre: quem consertava era um
 *    humano clicando Deactivate/Activate.
 *
 * 2. O `--permission-mode` das settings nunca chegava ao CLI do Master: o
 *    `RenderContext` do `MasterRuntimeService` não tinha `permissionMode`, então
 *    `renderArgs` descartava a flag inteira e o Master subia pedindo confirmação
 *    a cada tool call — o "não inicia no modo auto" relatado.
 */

interface Harness {
  service: MasterAgentService;
  runtime: {
    isRunning: jest.Mock;
    start: jest.Mock;
    sendPrompt: jest.Mock;
    recycle: jest.Mock;
  };
  logs: Array<{ level: string; message: string; metadata?: any }>;
}

function makeHarness(opts: { tmuxAlive: boolean; permissionMode?: string }): Harness {
  const logs: Harness['logs'] = [];

  const prisma = {
    project: {
      findUnique: jest.fn(async () => ({ id: 'project-1', name: 'OneQuest', mainPath: '/repo' })),
    },
    cliProfile: {
      findUnique: jest.fn(async () => ({
        id: 'profile-1',
        name: 'claude',
        binary: 'claude',
        interactiveArgs: ['--permission-mode', '{{permissionMode}}'],
        mcpConfigFile: '.orchestrator/mcp.json',
        mcpConfigTemplate: {},
        env: null,
        defaultModel: 'sonnet',
      })),
    },
    logEntry: {
      create: jest.fn(async ({ data }: any) => {
        logs.push({ level: data.level, message: data.message, metadata: data.metadata });
        return {};
      }),
    },
    chatMessage: { create: jest.fn(async () => ({})) },
    session: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []) },
    question: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []) },
    macroTask: { count: jest.fn(async () => 0) },
  } as any;

  const redis = {
    publish: jest.fn(async () => undefined),
    getClient: () => ({
      get: jest.fn(async () => null),
      set: jest.fn(async () => 'OK'),
      del: jest.fn(async () => 1),
      getdel: jest.fn(async () => null),
    }),
    subscribe: jest.fn(),
  } as any;

  const runtime = {
    isRunning: jest.fn(async () => opts.tmuxAlive),
    start: jest.fn(async () => ({ tmuxSession: 'orchestr-master', workDir: '/tmp/master' })),
    sendPrompt: jest.fn(async () => undefined),
    recycle: jest.fn(async () => undefined),
  };

  const projectsService = {
    getDefaults: jest.fn(async () => ({
      masterModel: 'sonnet',
      ...(opts.permissionMode ? { permissionMode: opts.permissionMode } : {}),
    })),
  } as any;

  const service = new MasterAgentService(prisma, redis, runtime as any, projectsService);
  // `activate` faria I/O de tmux de verdade; o estado ativo é montado à mão,
  // como nos outros specs deste módulo. MT-20: o estado escalar do serviço
  // virou `runtimes` (um Master por projeto).
  Object.assign(service as any, {
    runtimes: new Map([
      [
        'project-1',
        {
          projectId: 'project-1',
          cliProfileId: 'profile-1',
          mcpToken: 'token-abc',
          schedulingConfig: { ...DEFAULT_SCHEDULING_CONFIG },
          tickCount: 0,
          lastRecycleTick: 0,
          tickRunning: false,
          lastSessionCheckAt: null,
          promptedAt: new Map(),
          terminalBusy: false,
        },
      ],
    ]),
  });

  return { service, runtime, logs };
}

describe('terminal do Master morto — recuperação automática', () => {
  it('resobe o terminal com o MESMO token e registra o incidente como error', async () => {
    const { service, runtime, logs } = makeHarness({ tmuxAlive: false });

    const alive = await (service as any).ensureTerminal('project-1', 'watchdog');

    // false: o CLI acabou de nascer, então quem chamou NÃO deve colar prompt agora
    expect(alive).toBe(false);
    expect(runtime.start).toHaveBeenCalledTimes(1);
    // token reusado — o mcp config no workdir já tem esse bearer
    expect(runtime.start.mock.calls[0][2]).toBe('token-abc');
    const incident = logs.find((l) => l.metadata?.kind === 'master-terminal-restart');
    expect(incident?.level).toBe('error');
    expect(incident?.metadata?.reason).toBe('watchdog');
  });

  it('terminal vivo não é reiniciado nem gera log', async () => {
    const { service, runtime, logs } = makeHarness({ tmuxAlive: true });

    expect(await (service as any).ensureTerminal('project-1', 'watchdog')).toBe(true);
    expect(runtime.start).not.toHaveBeenCalled();
    expect(logs).toHaveLength(0);
  });

  it('não sobe um segundo terminal enquanto a reciclagem está no meio do caminho', async () => {
    const { service, runtime } = makeHarness({ tmuxAlive: false });
    (service as any).runtimes.get('project-1').terminalBusy = true;

    expect(await (service as any).ensureTerminal('project-1', 'watchdog')).toBe(false);
    expect(runtime.start).not.toHaveBeenCalled();
  });

  it('o tick não gasta estado no terminal morto — ele resobe e pula a passada', async () => {
    const { service, runtime } = makeHarness({ tmuxAlive: false });

    await service.runTickForProject('project-1');

    expect(runtime.start).toHaveBeenCalledTimes(1);
    expect(runtime.sendPrompt).not.toHaveBeenCalled();
  });

  it('chat com terminal morto explica o restart em vez de mandar ativar o Master', async () => {
    const { service, runtime } = makeHarness({ tmuxAlive: false });

    const result = await service.chat('e aí?');

    expect(result.queued).toBe(false);
    expect(result.response).toContain('restarted');
    expect(runtime.start).toHaveBeenCalledTimes(1);
    expect(runtime.sendPrompt).not.toHaveBeenCalled();
  });
});

describe('permissionMode do Master', () => {
  it('o valor das settings do projeto chega ao start do terminal', async () => {
    const { service, runtime } = makeHarness({ tmuxAlive: false, permissionMode: 'auto' });

    await (service as any).ensureTerminal('project-1', 'watchdog');

    expect(runtime.start.mock.calls[0][4]).toBe('auto');
  });

  it('sem valor gravado cai no mesmo default das sessões (acceptEdits), nunca em "sem flag"', async () => {
    const { service, runtime } = makeHarness({ tmuxAlive: false });

    await (service as any).ensureTerminal('project-1', 'watchdog');

    expect(runtime.start.mock.calls[0][4]).toBe('acceptEdits');
  });
});
