import {
  assertMacroTaskStatus,
  isMacroTaskStatus,
  normalizeMacroTaskStatus,
  MACRO_TASK_STATUSES,
} from './macro-task-status';
import { isSessionActive, isSessionAlive, isSessionFinished } from './session-status';

describe('normalizeMacroTaskStatus', () => {
  it('aceita os 8 canônicos sem alterar', () => {
    for (const status of MACRO_TASK_STATUSES) {
      expect(normalizeMacroTaskStatus(status)).toBe(status);
    }
  });

  it('traduz os aliases que a descrição antiga da tool prometia ao Master', () => {
    expect(normalizeMacroTaskStatus('in_progress')).toBe('running');
    expect(normalizeMacroTaskStatus('completed')).toBe('done');
  });

  it('tolera espaço em volta — o Master monta o argumento como texto', () => {
    expect(normalizeMacroTaskStatus('  done  ')).toBe('done');
  });

  it('devolve null para desconhecido, vazio, tipo errado e caixa trocada', () => {
    // É case-sensitive de propósito: 'DONE' vindo de um call site é sinal de
    // origem errada, não de digitação — melhor falhar que gravar às cegas.
    for (const invalid of ['DONE', 'IN_PROGRESS', 'archived', '', '   ', null, undefined, 3, {}]) {
      expect(normalizeMacroTaskStatus(invalid)).toBeNull();
    }
  });
});

describe('assertMacroTaskStatus', () => {
  it('lança com a lista dos válidos junto', () => {
    expect(() => assertMacroTaskStatus('archived')).toThrow(/Invalid macro task status "archived"/);
    expect(() => assertMacroTaskStatus('archived')).toThrow(/backlog \| pending/);
  });

  it('devolve o canônico do alias', () => {
    expect(assertMacroTaskStatus('completed')).toBe('done');
  });
});

describe('isMacroTaskStatus', () => {
  it('não considera alias como canônico — alias entra por normalize, não por type guard', () => {
    expect(isMacroTaskStatus('done')).toBe(true);
    expect(isMacroTaskStatus('completed')).toBe(false);
  });
});

describe('predicates de sessão', () => {
  it('paused conta como viva mas não como ativa — a distinção que estava divergindo', () => {
    expect(isSessionAlive('paused')).toBe(true);
    expect(isSessionActive('paused')).toBe(false);
    expect(isSessionFinished('paused')).toBe(false);
  });

  it('initializing/running/waiting são vivas e ativas', () => {
    for (const status of ['initializing', 'running', 'waiting'] as const) {
      expect(isSessionAlive(status)).toBe(true);
      expect(isSessionActive(status)).toBe(true);
    }
  });

  it('completed/stopped/failed/timeout não são vivas nem ativas', () => {
    for (const status of ['completed', 'stopped', 'failed', 'timeout'] as const) {
      expect(isSessionAlive(status)).toBe(false);
      expect(isSessionActive(status)).toBe(false);
      expect(isSessionFinished(status)).toBe(true);
    }
  });

  it('null/undefined/lixo não são vivos — status ausente nunca segura recurso', () => {
    for (const status of [null, undefined, '', 'zombie']) {
      expect(isSessionAlive(status)).toBe(false);
      expect(isSessionActive(status)).toBe(false);
    }
  });
});
