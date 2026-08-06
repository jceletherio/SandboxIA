import {
  SCHEDULED_JOB_TYPES,
  assertKnownJobType,
  isKnownJobType,
  projectIdFromPayload,
} from './job-types';

/**
 * Registro de tipos de job. Lógica pura e de falha silenciosa: um typo aceito na
 * escrita só aparecia 30s depois como job `failed`, e um `projectId` lido do
 * jeito errado volta a esconder o job das consultas por projeto.
 */

describe('assertKnownJobType', () => {
  it('aceita todo tipo do registro', () => {
    for (const type of SCHEDULED_JOB_TYPES) {
      expect(assertKnownJobType(type)).toBe(type);
    }
  });

  it('rejeita typo dizendo quais são os válidos — a mensagem é o valor da correção', () => {
    expect(() => assertKnownJobType('stage_timout')).toThrow(/Unknown scheduled job type "stage_timout"/);
    expect(() => assertKnownJobType('stage_timout')).toThrow(/stage_timeout/);
  });

  it('rejeita vazio, espaço e não-string em vez de gravar um tipo impossível', () => {
    for (const value of ['', '  ', 'MASTER_LOOP', null, undefined, 42, {}]) {
      expect(() => assertKnownJobType(value)).toThrow(/Unknown scheduled job type/);
      expect(isKnownJobType(value)).toBe(false);
    }
  });
});

describe('projectIdFromPayload', () => {
  it('extrai o projectId do payload para a coluna', () => {
    expect(projectIdFromPayload({ projectId: 'project-1', reason: 'manual' })).toBe('project-1');
    expect(projectIdFromPayload({ projectId: '  project-2  ' })).toBe('project-2');
  });

  it('devolve null no job de escopo de sessão — a coluna é nullable por isso', () => {
    expect(projectIdFromPayload({ sessionId: 'session-1', stageName: 'Contexto' })).toBeNull();
  });

  it('nunca lança com payload podre: o pior caso é job sem escopo, não escrita quebrada', () => {
    for (const value of [null, undefined, 'texto', 42, [], { projectId: 42 }, { projectId: '  ' }]) {
      expect(projectIdFromPayload(value)).toBeNull();
    }
  });
});
