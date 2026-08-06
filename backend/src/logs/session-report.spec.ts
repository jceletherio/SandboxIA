import {
  buildSessionReport,
  durationBetween,
  readMerge,
  SessionReportInput,
} from './session-report';

/**
 * O que estes testes protegem: a aritmética de duração e a classificação de
 * stage falham em SILÊNCIO. Um `undefined` numa data vira `NaN`, um stage
 * herdado contado como executado infla a duração, e a página mostra número
 * errado sem erro nenhum — ninguém descobre olhando a tela.
 */

const T0 = '2026-08-04T10:00:00.000Z';

/** Minutos depois de T0, em ISO. */
function at(minutes: number): string {
  return new Date(new Date(T0).getTime() + minutes * 60_000).toISOString();
}

function input(overrides: Partial<SessionReportInput> = {}): SessionReportInput {
  return {
    session: {
      id: 'sess-1',
      branchName: 'task/mt-8',
      status: 'completed',
      currentStage: 'Merge',
      startedAt: T0,
      completedAt: at(60),
      stageData: {},
      macroTask: { id: 'mt-8', title: 'MT-8', pipeline: { name: 'SDD Enxuto' } },
    },
    logs: [],
    questions: [],
    artifacts: [],
    ...overrides,
  };
}

describe('durationBetween', () => {
  it('devolve null — nunca 0 — quando falta uma ponta', () => {
    expect(durationBetween(null, T0)).toBeNull();
    expect(durationBetween(T0, null)).toBeNull();
  });

  it('devolve null para data inválida em vez de NaN', () => {
    expect(durationBetween('não é data', T0)).toBeNull();
  });

  it('devolve null quando o fim vem antes do início', () => {
    expect(durationBetween(at(10), at(5))).toBeNull();
  });

  it('mede em ms', () => {
    expect(durationBetween(T0, at(5))).toBe(5 * 60_000);
  });
});

describe('buildSessionReport — stages', () => {
  it('cronometra cada stage do "Starting stage" até o completedAt', () => {
    const report = buildSessionReport(
      input({
        session: {
          ...input().session,
          stageData: {
            Contexto: { completedAt: at(10), summary: 'ok', source: 'agent' },
            Implementação: { completedAt: at(40), summary: 'feito', source: 'agent' },
          },
        },
        logs: [
          { message: 'Starting stage: Contexto', createdAt: T0, metadata: { stage: 'Contexto' } },
          {
            message: 'Starting stage: Implementação',
            createdAt: at(10),
            metadata: { stage: 'Implementação' },
          },
        ],
        stageNames: ['Contexto', 'Implementação'],
      }),
    );

    expect(report.stages.map((s) => [s.name, s.status, s.durationMs])).toEqual([
      ['Contexto', 'completed', 10 * 60_000],
      ['Implementação', 'completed', 30 * 60_000],
    ]);
    expect(report.slowestStage).toEqual({ name: 'Implementação', durationMs: 30 * 60_000 });
  });

  it('conta attempts e marca o stage refeito', () => {
    const report = buildSessionReport(
      input({
        session: {
          ...input().session,
          stageData: { Review: { completedAt: at(30), source: 'agent' } },
        },
        logs: [
          { message: 'Starting stage: Review', createdAt: T0, metadata: { stage: 'Review' } },
          { message: 'Retrying stage: Review', createdAt: at(9), metadata: { stage: 'Review' } },
          { message: 'Starting stage: Review', createdAt: at(10), metadata: { stage: 'Review' } },
        ],
        stageNames: ['Review'],
      }),
    );

    expect(report.stages[0].attempts).toBe(2);
    expect(report.counts.retried).toBe(1);
    // Cronometra da PRIMEIRA tentativa: é o tempo que o stage custou de verdade.
    expect(report.stages[0].durationMs).toBe(30 * 60_000);
  });

  it('não cronometra stage herdado por resume — o tempo foi da sessão anterior', () => {
    const report = buildSessionReport(
      input({
        session: {
          ...input().session,
          stageData: {
            Contexto: { completedAt: at(5), source: 'agent', resumedFrom: 'sess-0' },
            Implementação: { completedAt: at(40), source: 'agent' },
            _resume: {
              fromSessionId: 'sess-0',
              fromStatus: 'failed',
              interruptedStage: 'Implementação',
              resumedAt: T0,
            },
          },
        },
        logs: [
          {
            message: 'Starting stage: Implementação',
            createdAt: at(10),
            metadata: { stage: 'Implementação' },
          },
        ],
        stageNames: ['Contexto', 'Implementação'],
      }),
    );

    const contexto = report.stages[0];
    expect(contexto.status).toBe('inherited');
    expect(contexto.durationMs).toBeNull();
    expect(report.counts.inherited).toBe(1);
    expect(report.resume).toMatchObject({
      fromSessionId: 'sess-0',
      interruptedStage: 'Implementação',
      inheritedStages: ['Contexto'],
    });
    // Só o stage que rodou aqui entra no mais lento.
    expect(report.slowestStage?.name).toBe('Implementação');
  });

  it('distingue skipped de completed pelo source, e failed de running pelo status', () => {
    const skipped = buildSessionReport(
      input({
        session: {
          ...input().session,
          status: 'failed',
          currentStage: 'Review',
          stageData: {
            Contexto: { completedAt: at(5), source: 'skip', summary: 'não se aplica' },
          },
        },
        stageNames: ['Contexto', 'Review', 'Merge'],
      }),
    );

    expect(skipped.stages.map((s) => s.status)).toEqual(['skipped', 'failed', 'pending']);
    expect(skipped.counts.skipped).toBe(1);
    expect(skipped.counts.completed).toBe(0);

    const live = buildSessionReport(
      input({
        session: { ...input().session, status: 'running', currentStage: 'Review', completedAt: null },
        stageNames: ['Review'],
      }),
    );
    expect(live.stages[0].status).toBe('running');
    // Sessão viva não tem duração final — `null`, não um número parcial.
    expect(live.durationMs).toBeNull();
  });

  it('não confunde chave de controle do stageData com stage', () => {
    const report = buildSessionReport(
      input({
        session: {
          ...input().session,
          stageData: {
            Contexto: { completedAt: at(5), source: 'agent' },
            _resume: { fromSessionId: 'x' },
            _runtime: { cliProfileId: 'p' },
            nextStage: 'Review',
            pauseReason: 'aguardando',
            progress: 50,
            Review_error: 'boom',
          },
        },
      }),
    );

    expect(report.stages.map((s) => s.name)).toEqual(['Contexto']);
  });

  it('mantém stage que rodou mas não está no pipeline, no fim da lista', () => {
    const report = buildSessionReport(
      input({
        session: {
          ...input().session,
          stageData: { Fantasma: { completedAt: at(5), source: 'agent' } },
        },
        stageNames: ['Contexto'],
      }),
    );

    expect(report.stages.map((s) => s.name)).toEqual(['Contexto', 'Fantasma']);
  });
});

describe('buildSessionReport — modelo/profile por stage', () => {
  it('usa o boot que declarou a fase', () => {
    const report = buildSessionReport(
      input({
        session: {
          ...input().session,
          stageData: { Implementação: { completedAt: at(40), source: 'agent' } },
        },
        logs: [
          {
            message: 'CLI boot: ...',
            createdAt: T0,
            metadata: {
              kind: 'runtime-profile',
              phase: 'Contexto',
              model: 'sonnet',
              cliProfileName: 'claude',
              provenance: 'model=sonnet (projectDefaults)',
            },
          },
          {
            message: 'CLI phase-switch: ...',
            createdAt: at(10),
            metadata: {
              kind: 'runtime-profile',
              phase: 'Implementação',
              model: 'opus',
              cliProfileName: 'claude',
              provenance: 'model=opus (stage)',
            },
          },
        ],
        stageNames: ['Implementação'],
      }),
    );

    expect(report.stages[0]).toMatchObject({
      model: 'opus',
      cliProfile: 'claude',
      provenance: 'model=opus (stage)',
    });
  });

  it('herda o último boot anterior quando o stage não reiniciou o CLI', () => {
    const report = buildSessionReport(
      input({
        session: {
          ...input().session,
          stageData: { Review: { completedAt: at(40), source: 'agent' } },
        },
        logs: [
          {
            message: 'CLI boot: ...',
            createdAt: T0,
            metadata: { kind: 'runtime-profile', phase: null, model: 'haiku', cliProfileName: 'claude' },
          },
          // Boot posterior ao fim do stage não pode ser atribuído a ele.
          {
            message: 'CLI restart: ...',
            createdAt: at(50),
            metadata: { kind: 'runtime-profile', phase: null, model: 'opus', cliProfileName: 'claude' },
          },
        ],
        stageNames: ['Review'],
      }),
    );

    expect(report.stages[0].model).toBe('haiku');
  });

  it('ignora log que não é runtime-profile', () => {
    const report = buildSessionReport(
      input({
        session: {
          ...input().session,
          stageData: { Review: { completedAt: at(40), source: 'agent' } },
        },
        logs: [{ message: 'Stage completed: Review', createdAt: at(40), metadata: { stage: 'Review' } }],
        stageNames: ['Review'],
      }),
    );

    expect(report.stages[0].model).toBeNull();
  });
});

describe('buildSessionReport — questions', () => {
  it('mede o tempo até a resposta e separa quem respondeu', () => {
    const report = buildSessionReport(
      input({
        questions: [
          {
            id: 'q1',
            question: 'onda?',
            status: 'answered',
            createdAt: T0,
            answeredAt: at(30),
            metadata: { answeredBy: 'human' },
          },
          {
            id: 'q2',
            question: 'modelo?',
            status: 'answered',
            createdAt: at(5),
            answeredAt: at(6),
            metadata: { answeredBy: 'master-agent' },
          },
          { id: 'q3', question: 'aberta', status: 'pending', createdAt: at(10), answeredAt: null },
        ],
      }),
    );

    expect(report.questions.map((q) => [q.id, q.waitMs])).toEqual([
      ['q1', 30 * 60_000],
      ['q2', 60_000],
      ['q3', null],
    ]);
    expect(report.counts).toMatchObject({
      questionsOpen: 1,
      questionsAnswered: 2,
      questionsHuman: 1,
    });
  });
});

describe('readMerge', () => {
  it('lê branch e data do content do artefato de merge', () => {
    const merge = readMerge(
      [
        {
          id: 'a1',
          type: 'merge',
          path: 'main',
          content: JSON.stringify({ mainBranch: 'main', mergedAt: at(59) }),
          createdAt: at(59),
        },
      ],
      [],
    );

    expect(merge).toEqual({
      status: 'merged',
      mainBranch: 'main',
      mergedAt: at(59),
      conflicts: [],
    });
  });

  it('content podre não apaga o fato de que o merge aconteceu', () => {
    const merge = readMerge(
      [{ id: 'a1', type: 'merge', path: 'main', content: 'não é json', createdAt: at(59) }],
      [],
    );

    expect(merge.status).toBe('merged');
    expect(merge.mainBranch).toBe('main');
  });

  it('sem artefato mas com question de conflito, reporta conflito', () => {
    const merge = readMerge(
      [],
      [
        {
          id: 'q1',
          question: 'conflito',
          status: 'pending',
          createdAt: at(50),
          metadata: { kind: 'merge-conflict', mainBranch: 'main', conflicts: ['a.ts', 'b.ts'] },
        },
      ],
    );

    expect(merge).toMatchObject({ status: 'conflict', conflicts: ['a.ts', 'b.ts'] });
  });

  it('sem nenhum dos dois, o merge está pendente — não falhou', () => {
    expect(readMerge([], []).status).toBe('pending');
  });
});
