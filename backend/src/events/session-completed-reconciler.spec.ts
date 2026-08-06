import { advanceWatermark, sessionsSinceWatermark } from './session-completed-reconciler';

describe('sessionsSinceWatermark', () => {
  it('sem marca d\'água, todas as sessões contam (primeiro sweep)', () => {
    const sessions = [
      { id: 'a', completedAt: new Date('2026-08-03T20:00:00Z') },
      { id: 'b', completedAt: new Date('2026-08-03T21:00:00Z') },
    ];
    expect(sessionsSinceWatermark(sessions, null).map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('só as sessões concluídas DEPOIS da marca entram — a da marca não reentra', () => {
    const watermark = new Date('2026-08-03T20:00:00Z').toISOString();
    const sessions = [
      { id: 'na-marca', completedAt: new Date('2026-08-03T20:00:00Z') },
      { id: 'antes', completedAt: new Date('2026-08-03T19:00:00Z') },
      { id: 'depois', completedAt: new Date('2026-08-03T20:30:00Z') },
    ];
    // `>=` reprocessaria "na-marca" para sempre — é exatamente o que este teste tranca.
    expect(sessionsSinceWatermark(sessions, watermark).map((s) => s.id)).toEqual(['depois']);
  });

  it('devolve em ordem de conclusão, mesmo que a entrada venha embaralhada', () => {
    const sessions = [
      { id: 'terceira', completedAt: new Date('2026-08-03T22:00:00Z') },
      { id: 'primeira', completedAt: new Date('2026-08-03T20:00:00Z') },
      { id: 'segunda', completedAt: new Date('2026-08-03T21:00:00Z') },
    ];
    expect(sessionsSinceWatermark(sessions, null).map((s) => s.id)).toEqual([
      'primeira',
      'segunda',
      'terceira',
    ]);
  });
});

describe('advanceWatermark', () => {
  it('sem sessões vistas, a marca fica parada', () => {
    const current = new Date('2026-08-03T20:00:00Z').toISOString();
    expect(advanceWatermark(current, [])).toBe(current);
  });

  it('avança para o completedAt mais recente do lote', () => {
    const sessions = [
      { id: 'a', completedAt: new Date('2026-08-03T20:00:00Z') },
      { id: 'b', completedAt: new Date('2026-08-03T22:00:00Z') },
      { id: 'c', completedAt: new Date('2026-08-03T21:00:00Z') },
    ];
    expect(advanceWatermark(null, sessions)).toBe(new Date('2026-08-03T22:00:00Z').toISOString());
  });

  it('nunca regride: um evento reentregue fora de ordem não empurra a marca pra trás', () => {
    const current = new Date('2026-08-03T22:00:00Z').toISOString();
    const late = [{ id: 'atrasado', completedAt: new Date('2026-08-03T20:00:00Z') }];
    expect(advanceWatermark(current, late)).toBe(current);
  });
});
