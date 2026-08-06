/**
 * Lógica pura do watchdog de sessão travada (MT-11). Testada porque a falha é
 * silenciosa nas duas direções: orçamento de reprompt lido errado faz o
 * watchdog empurrar a sessão para sempre ou nunca; `mode` do stage lido errado
 * manda reprompt para um stage que não tem agente para receber.
 * Prisma mockado — nenhum pane, CLI ou sessão real é tocado aqui.
 */
import { SessionRuntimeService } from './session-runtime.service';
import { ptyRegistry } from './pty-session.registry';

afterEach(() => {
  jest.restoreAllMocks();
});

function makeService(pipeline?: any) {
  const prisma: any = {
    session: {
      findUnique: jest.fn().mockResolvedValue({ stageData: null }),
      update: jest.fn().mockResolvedValue({}),
    },
    logEntry: { create: jest.fn().mockResolvedValue({}) },
  };
  const engine: any = pipeline ? { loadSessionPipeline: () => pipeline } : undefined;
  const service = new SessionRuntimeService(prisma, {} as any, {} as any, engine);
  return { service: service as any, prisma };
}

describe('readWatchdogState', () => {
  const { service } = makeService();

  it('devolve orçamento cheio quando não há estado gravado', () => {
    expect(service.readWatchdogState(null, 'Review')).toEqual({
      repromptCount: 0,
      lastRepromptAt: '',
      stage: 'Review',
      paneHash: '',
    });
  });

  it('lê a contagem do stage corrente', () => {
    const stageData = {
      _watchdog: { repromptCount: 2, lastRepromptAt: '2026-08-04T01:00:00.000Z', stage: 'Review' },
    };
    expect(service.readWatchdogState(stageData, 'Review').repromptCount).toBe(2);
  });

  it('zera a contagem quando o stage mudou — cada stage tem seu orçamento', () => {
    const stageData = {
      _watchdog: { repromptCount: 2, lastRepromptAt: '2026-08-04T01:00:00.000Z', stage: 'Contexto' },
    };
    expect(service.readWatchdogState(stageData, 'Review').repromptCount).toBe(0);
  });

  it('ignora estado corrompido em vez de propagar NaN para a comparação de teto', () => {
    const stageData = { _watchdog: { repromptCount: 'muitos', stage: 'Review' } };
    expect(service.readWatchdogState(stageData, 'Review').repromptCount).toBe(0);
    expect(service.readWatchdogState({ _watchdog: 'lixo' }, 'Review').repromptCount).toBe(0);
    expect(service.readWatchdogState([], 'Review').repromptCount).toBe(0);
  });
});

describe('isEngineStage', () => {
  const session = { id: 's1', context: null, macroTask: null };

  it('sem pipeline carregado, só Merge é engine (mesmo default do executeStage)', () => {
    const { service } = makeService();
    expect(service.isEngineStage(session, 'Merge')).toBe(true);
    expect(service.isEngineStage(session, 'Review')).toBe(false);
  });

  it('respeita o mode declarado no pipeline da sessão', () => {
    const pipeline = {
      stages: [
        { name: 'Review', mode: 'engine' },
        { name: 'Merge', mode: 'interactive' },
      ],
    };
    const { service } = makeService(pipeline);
    const withPipeline = { ...session, macroTask: { pipeline: { stages: pipeline.stages } } };
    expect(service.isEngineStage(withPipeline, 'Review')).toBe(true);
    // Pipeline que declara Merge interativo ganha do default por nome.
    expect(service.isEngineStage(withPipeline, 'Merge')).toBe(false);
  });
});

describe('isPaneIdle', () => {
  const { service } = makeService();

  it('sem tmux, assume idle', async () => {
    await expect(service.isPaneIdle(null, '')).resolves.toEqual({ idle: true, paneHash: '' });
  });

  it('primeira rodada do stage (sem hash anterior): cai no desempate por spinner/vocabulário', async () => {
    service.capturePane = jest.fn().mockResolvedValue('⠹ Thinking… (esc to interrupt)\n');
    const result = await service.isPaneIdle('orchestr-abc', '');
    expect(result.idle).toBe(false);
    expect(result.paneHash).not.toBe('');
  });

  it('primeira rodada sem spinner nem vocabulário de progresso = turno encerrado', async () => {
    service.capturePane = jest.fn().mockResolvedValue('Pronto, terminei o stage.\n\n> \n');
    const result = await service.isPaneIdle('orchestr-abc', '');
    expect(result.idle).toBe(true);
  });

  it('tela igual à rodada anterior = ninguém escrevendo ali, mesmo com "running" no texto', async () => {
    service.capturePane = jest.fn().mockResolvedValue('rodando testes... running\n> \n');
    const first = await service.isPaneIdle('orchestr-abc', '');
    const second = await service.isPaneIdle('orchestr-abc', first.paneHash);
    expect(second.idle).toBe(true);
  });

  it('tela mudou desde a rodada anterior = trabalho em curso', async () => {
    service.capturePane = jest.fn().mockResolvedValue('primeira tela\n> \n');
    const first = await service.isPaneIdle('orchestr-abc', '');
    service.capturePane = jest.fn().mockResolvedValue('segunda tela, diferente\n> \n');
    const second = await service.isPaneIdle('orchestr-abc', first.paneHash);
    expect(second.idle).toBe(false);
  });
});

/**
 * A varredura de sessão travada roda em cima das linhas `running`/`waiting` do
 * BANCO, então ela consulta rotineiramente panes que já morreram — e agora que
 * o pane morre junto com o backend, linha viva no banco com pane morto é o
 * caminho NORMAL depois de todo restart, não a exceção.
 *
 * Contrato que importa: pane morto devolve `null` (e não zero, nem erro), para
 * o `resolveLastActivity` cair no `createdAt` do último LogEntry em vez de
 * concluir "sem atividade" e marcar a sessão como travada na hora errada.
 * `null` também não pode virar exceção: isto roda dentro do intervalo do stall
 * check, e propagar erro dali mataria a varredura inteira (MT-11).
 */
describe('readWindowActivity', () => {
  it('converte o epoch em ms do registry para os segundos que o chamador espera', async () => {
    const { service } = makeService();
    jest.spyOn(ptyRegistry, 'lastActivity').mockReturnValue(1785868816_000);

    await expect(service.readWindowActivity('orchestr-abc')).resolves.toBe(1785868816);
  });

  it('trunca para baixo, nunca arredonda para o futuro', async () => {
    const { service } = makeService();
    jest.spyOn(ptyRegistry, 'lastActivity').mockReturnValue(1785868816_999);

    // Arredondar para cima faria a sessão parecer ativa 1s depois do último
    // byte real — do lado errado para quem decide se ela travou.
    await expect(service.readWindowActivity('orchestr-abc')).resolves.toBe(1785868816);
  });

  it('pane inexistente devolve null em vez de 0 ou exceção', async () => {
    const { service } = makeService();
    jest.spyOn(ptyRegistry, 'lastActivity').mockReturnValue(null);

    await expect(service.readWindowActivity('orchestr-morta')).resolves.toBeNull();
  });
});

describe('resolveLastActivity', () => {
  function withLog(lastLog: { createdAt: Date } | null) {
    const { service, prisma } = makeService();
    prisma.logEntry.findFirst = jest.fn().mockResolvedValue(lastLog);
    return { service, prisma };
  }

  it('tmux vivo ganha e marca a fonte', async () => {
    const { service } = withLog(null);
    service.readWindowActivity = jest.fn().mockResolvedValue(1785868816);
    await expect(service.resolveLastActivity('s1', 'orchestr-abc')).resolves.toEqual({
      at: new Date(1785868816 * 1000),
      source: 'tmux',
    });
  });

  it('tmux morto cai para o último log em vez de derrubar a varredura', async () => {
    const createdAt = new Date('2026-08-04T18:00:00.000Z');
    const { service } = withLog({ createdAt });
    service.readWindowActivity = jest.fn().mockResolvedValue(null);
    await expect(service.resolveLastActivity('s1', 'orchestr-morta')).resolves.toEqual({
      at: createdAt,
      source: 'log',
    });
  });

  it('sem tmux nem log, não inventa atividade', async () => {
    const { service } = withLog(null);
    await expect(service.resolveLastActivity('s1', null)).resolves.toEqual({
      at: null,
      source: 'none',
    });
  });
});
