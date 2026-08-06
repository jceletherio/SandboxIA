import type { SessionReport, StageReport } from './session-report';
import { buildWaveReport, median } from './wave-report';

/**
 * O erro que estes testes existem para pegar: tratar `null` de duração como 0.
 * Isso puxa a mediana para baixo e faz um pipeline parecer mais rápido do que é
 * — justamente a conclusão que a comparação "SDD Enxuto vs fluxo de 8 stages"
 * precisa acertar. Um número errado aqui não quebra nada, só engana a decisão.
 */

function stage(name: string, durationMs: number | null, attempts = 1): StageReport {
  return {
    name,
    status: durationMs === null ? 'pending' : 'completed',
    startedAt: null,
    completedAt: null,
    durationMs,
    attempts,
    summary: null,
    model: null,
    cliProfile: null,
    provenance: null,
  };
}

function report(overrides: Partial<SessionReport> = {}): SessionReport {
  const stages = overrides.stages ?? [];
  return {
    sessionId: 's1',
    macroTaskId: 'mt',
    macroTaskTitle: 'MT',
    pipelineName: 'SDD Enxuto',
    branch: 'task/x',
    status: 'completed',
    currentStage: 'Merge',
    startedAt: '2026-08-04T10:00:00.000Z',
    completedAt: '2026-08-04T11:00:00.000Z',
    durationMs: 60 * 60_000,
    stages,
    slowestStage: null,
    counts: {
      stages: stages.length,
      completed: 0,
      skipped: 0,
      inherited: 0,
      retried: 0,
      artifacts: 0,
      questionsOpen: 0,
      questionsAnswered: 0,
      questionsHuman: 0,
      ...overrides.counts,
    },
    resume: null,
    questions: [],
    artifacts: [],
    merge: { status: 'merged', mainBranch: 'main', mergedAt: null, conflicts: [] },
    ...overrides,
  };
}

describe('median', () => {
  it('devolve null para amostra vazia em vez de 0', () => {
    expect(median([])).toBeNull();
  });

  it('ímpar pega o do meio, par tira a média dos dois', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(3);
  });
});

describe('buildWaveReport', () => {
  it('agrupa por pipeline e compara a mediana das sessões concluídas', () => {
    const wave = buildWaveReport([
      report({ sessionId: 's1', pipelineName: 'SDD Enxuto', durationMs: 30 * 60_000 }),
      report({ sessionId: 's2', pipelineName: 'SDD Enxuto', durationMs: 50 * 60_000 }),
      report({ sessionId: 's3', pipelineName: 'SDD Completo', durationMs: 120 * 60_000 }),
    ]);

    // Ordenado do mais rápido para o mais lento: é a leitura de 10 segundos.
    expect(wave.pipelines.map((p) => [p.pipelineName, p.medianDurationMs])).toEqual([
      ['SDD Enxuto', 40 * 60_000],
      ['SDD Completo', 120 * 60_000],
    ]);
    expect(wave.sessions).toBe(3);
    expect(wave.completed).toBe(3);
  });

  it('sessão não concluída não entra na mediana de duração', () => {
    const wave = buildWaveReport([
      report({ sessionId: 's1', durationMs: 40 * 60_000 }),
      // Falhou rápido: contar os 2min como "duração do fluxo" faria o pipeline
      // parecer duas vezes mais rápido do que é.
      report({ sessionId: 's2', status: 'failed', durationMs: 2 * 60_000 }),
    ]);

    expect(wave.pipelines[0].medianDurationMs).toBe(40 * 60_000);
    expect(wave.completed).toBe(1);
    expect(wave.failed).toBe(1);
  });

  it('stage sem duração medida não conta como amostra zero', () => {
    const wave = buildWaveReport([
      report({ stages: [stage('Contexto', 10 * 60_000), stage('Review', null)] }),
      report({ sessionId: 's2', stages: [stage('Contexto', 20 * 60_000), stage('Review', null)] }),
    ]);

    const stages = wave.pipelines[0].stages;
    expect(stages.find((s) => s.name === 'Contexto')).toMatchObject({
      samples: 2,
      medianDurationMs: 15 * 60_000,
    });
    expect(stages.find((s) => s.name === 'Review')).toMatchObject({
      samples: 0,
      medianDurationMs: null,
      totalDurationMs: 0,
    });
  });

  it('aponta o stage que consome mais tempo somado', () => {
    const wave = buildWaveReport([
      report({ stages: [stage('Contexto', 5 * 60_000), stage('Implementação', 40 * 60_000)] }),
      report({
        sessionId: 's2',
        stages: [stage('Contexto', 5 * 60_000), stage('Implementação', 30 * 60_000)],
      }),
    ]);

    expect(wave.pipelines[0].slowestStage?.name).toBe('Implementação');
  });

  it('soma as tentativas extras como retries do stage', () => {
    const wave = buildWaveReport([
      report({ stages: [stage('Review', 10 * 60_000, 3)] }),
      report({ sessionId: 's2', stages: [stage('Review', 10 * 60_000, 2)] }),
    ]);

    expect(wave.pipelines[0].stages[0].retries).toBe(3);
  });

  it('lista onde as sessões travaram, com as questions abertas', () => {
    const wave = buildWaveReport([
      report({ sessionId: 's1' }),
      report({
        sessionId: 's2',
        status: 'paused',
        currentStage: 'Implementação',
        completedAt: null,
        durationMs: null,
        counts: { ...report().counts, questionsOpen: 2 },
      }),
    ]);

    expect(wave.stuck).toEqual([
      {
        sessionId: 's2',
        macroTaskTitle: 'MT',
        pipelineName: 'SDD Enxuto',
        status: 'paused',
        stage: 'Implementação',
        questionsOpen: 2,
      },
    ]);
    expect(wave.live).toBe(1);
  });

  it('conta quantas questions precisaram de humano', () => {
    const wave = buildWaveReport([
      report({
        counts: { ...report().counts, questionsAnswered: 3, questionsHuman: 1 },
      }),
      report({
        sessionId: 's2',
        counts: { ...report().counts, questionsOpen: 1, questionsHuman: 0 },
      }),
    ]);

    expect(wave.questionsTotal).toBe(4);
    expect(wave.questionsOpen).toBe(1);
    expect(wave.questionsHuman).toBe(1);
  });

  it('pipeline sem sessão concluída vai para o fim, não para o topo', () => {
    const wave = buildWaveReport([
      report({ sessionId: 's1', pipelineName: 'Lento', durationMs: 90 * 60_000 }),
      report({
        sessionId: 's2',
        pipelineName: 'Sem dado',
        status: 'failed',
        durationMs: null,
      }),
    ]);

    expect(wave.pipelines.map((p) => p.pipelineName)).toEqual(['Lento', 'Sem dado']);
  });

  it('sessão sem pipeline ainda aparece, para a soma fechar com o total', () => {
    const wave = buildWaveReport([report({ pipelineName: null })]);

    expect(wave.pipelines[0].pipelineName).toBe('(sem pipeline)');
    expect(wave.pipelines[0].sessions).toBe(1);
    expect(wave.sessions).toBe(1);
  });

  it('onda vazia não quebra e não inventa número', () => {
    const wave = buildWaveReport([], { from: 'a', to: 'b' });

    expect(wave).toMatchObject({
      from: 'a',
      to: 'b',
      sessions: 0,
      medianDurationMs: null,
      pipelines: [],
      stuck: [],
    });
  });
});
