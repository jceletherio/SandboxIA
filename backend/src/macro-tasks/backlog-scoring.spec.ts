import { bucketPriority, pipelineNameForEffort, scoreFinding, scoreWithRepeats } from './backlog-scoring';
import type { TaskReportFinding } from './task-report.contract';

const finding = (over: Partial<TaskReportFinding> = {}): TaskReportFinding => ({
  kind: 'improvement',
  title: 'x',
  files: [],
  effort: 'm',
  priority: 0,
  ...over,
});

describe('scoreFinding', () => {
  // O caso que o usuário deu no pedido: é o teste que não pode quebrar.
  it('coloca bug de esforço s acima de otimização de esforço l', () => {
    const bug = scoreFinding(finding({ kind: 'bug', effort: 's' }));
    const opt = scoreFinding(finding({ kind: 'optimization', effort: 'l' }));
    expect(bug.score).toBeGreaterThan(opt.score);
    expect(bug.priority).toBe(2);
    expect(opt.priority).toBe(0);
  });

  it('soma as três parcelas', () => {
    expect(scoreFinding(finding({ kind: 'debt', effort: 'm', priority: 1 })).score).toBe(4);
  });

  it('clampa priority podre do finding em vez de propagar', () => {
    expect(scoreFinding(finding({ priority: 99 })).score).toBe(scoreFinding(finding({ priority: 2 })).score);
    // improvement (1) + effort m (1) + priority clampada em 0
    expect(scoreFinding(finding({ priority: -5 })).score).toBe(2);
  });

  it('docs de esforço l é o piso da fila', () => {
    expect(scoreFinding(finding({ kind: 'docs', effort: 'l' })).score).toBe(0);
  });
});

describe('bucketPriority', () => {
  it('mapeia a escala fina nos 3 buckets que a UI sabe colorir', () => {
    expect([0, 1, 2, 3, 4, 5, 7].map(bucketPriority)).toEqual([0, 0, 0, 1, 1, 2, 2]);
  });
});

describe('scoreWithRepeats', () => {
  it('dá +1 por sessão extra que viu o mesmo item, com teto', () => {
    expect(scoreWithRepeats(2, 1).score).toBe(2);
    expect(scoreWithRepeats(2, 2).score).toBe(3);
    expect(scoreWithRepeats(2, 10).score).toBe(4);
  });

  it('não deixa seenCount zerado ou negativo baixar o score', () => {
    expect(scoreWithRepeats(3, 0).score).toBe(3);
  });
});

describe('pipelineNameForEffort', () => {
  it('mapeia esforço para o pipeline do plano', () => {
    expect(pipelineNameForEffort('s')).toBe('Fix Rápido');
    expect(pipelineNameForEffort('m')).toBe('Feature Simples');
    expect(pipelineNameForEffort('l')).toBe('SDD Enxuto');
    expect(pipelineNameForEffort(undefined)).toBe('Feature Simples');
  });
});
