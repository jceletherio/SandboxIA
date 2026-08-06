/**
 * Resolução de runtime por stage (P2.2 + MT-4): a camada do PhaseModelAssignment
 * continua valendo sobre a config do Agent, agora dentro da precedência do
 * contrato §3. Prisma mockado — nenhum CLI, tmux ou sessão real é tocado aqui.
 */
import { SessionRuntimeService } from './session-runtime.service';

const profileAgent: any = {
  id: 'profile-agent',
  name: 'claude-default',
  binary: 'claude',
  interactiveArgs: ['--model', '{{model}}'],
  mcpConfigFile: '.mcp-session.json',
  mcpConfigTemplate: {},
  defaultModel: 'sonnet',
  env: null,
};

const profileAssigned: any = {
  ...profileAgent,
  id: 'profile-assigned',
  name: 'opencode',
  binary: 'opencode',
};

function makeService(overrides: {
  assignmentExact?: any;
  assignmentLoose?: any;
  cliProfile?: any;
  pipeline?: any;
} = {}) {
  const findFirst = jest.fn(({ where }: any) => {
    if (typeof where.phase === 'string') {
      return Promise.resolve(overrides.assignmentExact ?? null);
    }
    return Promise.resolve(overrides.assignmentLoose ?? null);
  });
  const prisma: any = {
    phaseModelAssignment: { findFirst },
    cliProfile: { findFirst: jest.fn().mockResolvedValue(overrides.cliProfile ?? null) },
    logEntry: { create: jest.fn().mockResolvedValue({}) },
    session: {
      findUnique: jest.fn().mockResolvedValue({ stageData: null }),
      update: jest.fn().mockResolvedValue({}),
    },
    $executeRaw: jest.fn().mockResolvedValue(0),
  };
  // Engine só é consultado para o snapshot do pipeline (contratos §5).
  const engine: any = overrides.pipeline
    ? { loadSessionPipeline: () => overrides.pipeline }
    : undefined;
  const service = new SessionRuntimeService(prisma, {} as any, {} as any, engine);
  return { service: service as any, prisma, findFirst };
}

const sessionWith = (agentModel: string, extra: Record<string, unknown> = {}) => ({
  id: 'session-1',
  agentId: 'agent-1',
  agent: { model: agentModel, cliProfile: profileAgent },
  ...extra,
});

describe('resolveStageRuntime', () => {
  it('sem assignment usa o profile/model do agente (regressão, CA2)', async () => {
    const { service } = makeService();
    const resolved = await service.resolveStageRuntime(sessionWith('opus'), 'Spec');
    expect(resolved.source).toBe('agent');
    expect(resolved.profile.id).toBe('profile-agent');
    expect(resolved.config.model).toBe('opus');
    expect(resolved.warnings).toEqual([]);
  });

  it('agent.model = "default" cai no defaultModel do profile', async () => {
    const { service } = makeService();
    const resolved = await service.resolveStageRuntime(sessionWith('default'), null);
    expect(resolved.config.model).toBe('sonnet');
  });

  it('fase sem nome não consulta assignment', async () => {
    const { service, findFirst } = makeService();
    await service.resolveStageRuntime(sessionWith('opus'), '   ');
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('assignment com model habilitado e profile válido sobrepõe o agente (CA1)', async () => {
    const { service } = makeService({
      assignmentExact: {
        id: 'assign-1',
        phase: 'Spec',
        modelId: 'm1',
        cliProfileId: 'profile-assigned',
        model: { id: 'm1', name: 'opus', enabled: true },
        cliProfile: profileAssigned,
      },
    });
    const resolved = await service.resolveStageRuntime(sessionWith('sonnet'), 'Spec');
    expect(resolved.source).toBe('phase-assignment');
    expect(resolved.assignmentId).toBe('assign-1');
    expect(resolved.profile.id).toBe('profile-assigned');
    expect(resolved.config.model).toBe('opus');
    expect(resolved.warnings).toEqual([]);
  });

  it('model desabilitado → fallback no model do agente + warning (CA3)', async () => {
    const { service } = makeService({
      assignmentExact: {
        id: 'assign-2',
        phase: 'Spec',
        modelId: 'm1',
        cliProfileId: null,
        model: { id: 'm1', name: 'opus', enabled: false },
        cliProfile: null,
      },
    });
    const resolved = await service.resolveStageRuntime(sessionWith('sonnet'), 'Spec');
    expect(resolved.source).toBe('agent');
    expect(resolved.config.model).toBe('sonnet');
    expect(resolved.warnings).toHaveLength(1);
    expect(resolved.warnings[0]).toContain('disabled');
  });

  it('cliProfile inexistente → fallback no profile do agente + warning (CA3)', async () => {
    const { service } = makeService({
      assignmentExact: {
        id: 'assign-3',
        phase: 'Spec',
        modelId: 'm1',
        cliProfileId: 'ghost-profile',
        model: { id: 'm1', name: 'opus', enabled: true },
        cliProfile: null,
      },
    });
    const resolved = await service.resolveStageRuntime(sessionWith('sonnet'), 'Spec');
    // o model ainda se aplica; só o profile cai no default do agente
    expect(resolved.profile.id).toBe('profile-agent');
    expect(resolved.config.model).toBe('opus');
    expect(resolved.source).toBe('phase-assignment');
    expect(resolved.warnings[0]).toContain('no longer exists');
  });

  it('falha de query não lança — cai no agente com warning', async () => {
    const { service, prisma } = makeService();
    prisma.phaseModelAssignment.findFirst = jest.fn().mockRejectedValue(new Error('db down'));
    const resolved = await service.resolveStageRuntime(sessionWith('sonnet'), 'Spec');
    expect(resolved.source).toBe('agent');
    expect(resolved.warnings[0]).toContain('db down');
  });

  it('match case-insensitive como fallback, com warning explicando', async () => {
    const { service } = makeService({
      assignmentLoose: {
        id: 'assign-4',
        phase: 'spec',
        modelId: 'm1',
        cliProfileId: null,
        model: { id: 'm1', name: 'haiku', enabled: true },
        cliProfile: null,
      },
    });
    const resolved = await service.resolveStageRuntime(sessionWith('sonnet'), 'Spec');
    expect(resolved.config.model).toBe('haiku');
    expect(resolved.warnings[0]).toContain('case-insensitively');
  });

  it('agente sem CliProfile continua lançando', async () => {
    const { service } = makeService();
    await expect(
      service.resolveStageRuntime({ id: 's', agentId: 'a', agent: { model: 'x', cliProfile: null } }, null),
    ).rejects.toThrow('no CLI profile');
  });
});

/**
 * Precedência do contrato §3 plugada no runtime (MT-4). O resolver em si já tem
 * teste unitário próprio; aqui o que se cobre é a MONTAGEM das camadas — errar a
 * ordem ou esquecer uma camada falha em silêncio, 20 min depois, no CLI errado.
 */
describe('resolveStageRuntime · camadas', () => {
  const pipeline = {
    stages: [
      { name: 'Implementação', model: 'haiku', skills: ['tdd'] },
      { name: 'Review' },
    ],
    defaults: { model: 'sonnet', skills: ['revisao'] },
    permissionMode: 'plan',
  };
  const fullSession = (context: unknown, phase = 'Implementação') => ({
    ...sessionWith('opus', {
      context,
      macroTask: {
        project: { settings: { defaults: { model: 'gpt', skills: ['projeto'] } } },
        pipeline: { stages: pipeline },
      },
    }),
    phase,
  });

  it('stage do pipeline vence defaults do pipeline e do projeto', async () => {
    const { service } = makeService({ pipeline });
    const s = fullSession(null);
    const resolved = await service.resolveStageRuntime(s, s.phase);
    expect(resolved.config.model).toBe('haiku');
    expect(resolved.provenance).toContain('model=haiku (stage)');
  });

  it('sessionOverride vence tudo e o override do stage vence o da sessão', async () => {
    const { service } = makeService({ pipeline });
    const context = {
      runtimeOverride: { model: 'opus', stages: { Implementação: { model: 'sonnet' } } },
    };
    const impl = fullSession(context);
    expect((await service.resolveStageRuntime(impl, 'Implementação')).config.model).toBe('sonnet');
    // fase sem entrada em `stages` fica com o override global da sessão
    expect((await service.resolveStageRuntime(impl, 'Review')).config.model).toBe('opus');
  });

  it('skills são união de todas as camadas, não substituição', async () => {
    const { service } = makeService({ pipeline });
    const s = fullSession({ runtimeOverride: { skills: ['sdd'] } });
    const resolved = await service.resolveStageRuntime(s, s.phase);
    expect(resolved.config.skills).toEqual(['projeto', 'revisao', 'tdd', 'sdd']);
  });

  it('PhaseModelAssignment continua valendo, mas perde para o campo do stage', async () => {
    const { service } = makeService({
      pipeline,
      assignmentExact: {
        id: 'assign-9',
        phase: 'Review',
        modelId: 'm1',
        cliProfileId: null,
        model: { id: 'm1', name: 'opus', enabled: true },
        cliProfile: null,
      },
    });
    const s = fullSession(null);
    // "Review" não declara model: o assignment se aplica
    const review = await service.resolveStageRuntime(s, 'Review');
    expect(review.config.model).toBe('opus');
    expect(review.source).toBe('phase-assignment');
    // "Implementação" declara model: o stage é mais específico e ganha
    const impl = await service.resolveStageRuntime(s, 'Implementação');
    expect(impl.config.model).toBe('haiku');
  });

  it('cliProfile inexistente cai no profile do agente com warning', async () => {
    const { service } = makeService({ pipeline, cliProfile: null });
    const s = fullSession({ runtimeOverride: { cliProfile: 'fantasma' } });
    const resolved = await service.resolveStageRuntime(s, s.phase);
    expect(resolved.profile.id).toBe('profile-agent');
    expect(resolved.warnings[0]).toContain('does not exist');
  });

  it('permissionMode do pipeline entra na resolução', async () => {
    const { service } = makeService({ pipeline });
    const s = fullSession(null);
    const resolved = await service.resolveStageRuntime(s, s.phase);
    expect(resolved.config.permissionMode).toBe('plan');
  });
});

describe('applyPhaseRuntime', () => {
  it('no-op quando o runtime da fase é igual ao que subiu', async () => {
    const { service, prisma } = makeService();
    prisma.session.findUnique = jest.fn().mockResolvedValue(
      sessionWith('opus', {
        stageData: {
          Spec: { completedAt: 'x' },
          _runtime: { cliProfileId: 'profile-agent', cliProfileName: 'claude-default', model: 'opus' },
        },
      }),
    );
    const result = await service.applyPhaseRuntime('session-1', 'Implement');
    expect(result).toEqual({ restarted: false, reason: 'unchanged' });
    expect(prisma.session.update).not.toHaveBeenCalled();
  });

  it('CLI parado não é rebootado — só registra o runtime esperado', async () => {
    const { service, prisma } = makeService({
      assignmentExact: {
        id: 'assign-5',
        phase: 'Review',
        modelId: 'm1',
        cliProfileId: null,
        model: { id: 'm1', name: 'opus', enabled: true },
        cliProfile: null,
      },
    });
    prisma.session.findUnique = jest.fn().mockResolvedValue(
      sessionWith('sonnet', {
        stageData: {
          Spec: { completedAt: 'x' },
          _runtime: { cliProfileId: 'profile-agent', cliProfileName: 'claude-default', model: 'sonnet' },
        },
      }),
    );
    const result = await service.applyPhaseRuntime('session-1', 'Review');
    expect(result.restarted).toBe(false);
    expect(result.reason).toContain('cli-not-running');
    // stampRuntime grava só a chave `_runtime` via merge atômico (jsonb `||`),
    // nunca lê nem regrava `stageData` inteiro — é o que evita a corrida com
    // um `complete_stage` concorrente (ver teste de corrida abaixo).
    expect(prisma.session.update).not.toHaveBeenCalled();
    const [, mergeJson] = prisma.$executeRaw.mock.calls[0];
    const written = JSON.parse(mergeJson);
    expect(Object.keys(written)).toEqual(['_runtime']);
    expect(written._runtime.model).toBe('opus');
    expect(written._runtime.source).toBe('phase-assignment');
  });

  it('regressão de corrida: complete_stage concorrente não é apagado pelo stampRuntime', async () => {
    // Simula o merge atômico `jsonb ||` do Postgres num objeto em memória: cada
    // `$executeRaw` funde só as chaves do seu próprio payload, nunca reescreve
    // o documento inteiro. Reproduz o bug relatado — o agente chama
    // `complete_stage` (grava `stageData.Implementação.completedAt`) enquanto
    // o `stampRuntime` do boot da fase seguinte está em voo.
    const row: Record<string, unknown> = {};
    const { service, prisma } = makeService({
      assignmentExact: {
        id: 'assign-5',
        phase: 'Review',
        modelId: 'm1',
        cliProfileId: null,
        model: { id: 'm1', name: 'opus', enabled: true },
        cliProfile: null,
      },
    });
    prisma.$executeRaw = jest.fn(async (_strings: TemplateStringsArray, mergeJson: string) => {
      Object.assign(row, JSON.parse(mergeJson));
    });
    prisma.session.findUnique = jest.fn().mockResolvedValue(sessionWith('sonnet', { stageData: row }));

    // "complete_stage" grava primeiro (mesmo merge atômico usado por outras
    // gravações de stageData) — o completedAt do stage anterior já está lá
    // quando o stampRuntime do boot da fase seguinte roda.
    await prisma.$executeRaw`irrelevant${JSON.stringify({ Implementação: { completedAt: 't1' } })}irrelevant`;

    const result = await service.applyPhaseRuntime('session-1', 'Review');
    expect(result.reason).toContain('cli-not-running');
    // Nem a chave gravada pelo complete_stage nem o novo `_runtime` se perdem.
    expect(row.Implementação).toEqual({ completedAt: 't1' });
    expect((row._runtime as any).model).toBe('opus');
  });

  it('stamp anterior à MT-4 (sem permissionMode) não provoca reboot sozinho', async () => {
    // pipeline com permissionMode: se o campo ausente no stamp valesse como
    // null, toda sessão viva antiga reiniciaria o CLI no próximo stage.
    const { service, prisma } = makeService({
      pipeline: { stages: [{ name: 'Review' }], permissionMode: 'plan' },
    });
    prisma.session.findUnique = jest.fn().mockResolvedValue(
      sessionWith('opus', {
        macroTask: { project: null, pipeline: { stages: [] } },
        stageData: {
          _runtime: { cliProfileId: 'profile-agent', cliProfileName: 'claude-default', model: 'opus' },
        },
      }),
    );
    const result = await service.applyPhaseRuntime('session-1', 'Review');
    expect(result).toEqual({ restarted: false, reason: 'unchanged' });
  });

  it('sessão inexistente não lança', async () => {
    const { service, prisma } = makeService();
    prisma.session.findUnique = jest.fn().mockResolvedValue(null);
    await expect(service.applyPhaseRuntime('nope', 'Spec')).resolves.toEqual({
      restarted: false,
      reason: 'session-not-found',
    });
  });
});
