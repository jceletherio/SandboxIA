import { readBacklogMetadata, readMacroTaskMetadata } from './backlog-ingest.service';

// `MacroTask.metadata` é Json livre e é lido em 4 pontos. Um valor podre aqui não
// pode derrubar a listagem do backlog nem virar spread de string dentro do Json.
describe('readMacroTaskMetadata', () => {
  it('devolve o objeto quando é objeto simples', () => {
    expect(readMacroTaskMetadata({ origin: { macroTaskId: 'x' } })).toEqual({
      origin: { macroTaskId: 'x' },
    });
  });

  it('devolve {} para null, array e escalar', () => {
    for (const value of [null, undefined, [], ['a'], 'texto', 42, true]) {
      expect(readMacroTaskMetadata(value)).toEqual({});
    }
  });
});

describe('readBacklogMetadata', () => {
  it('extrai o bloco backlog', () => {
    const metadata = { origin: { sessionId: 's' }, backlog: { kind: 'bug', score: 5 } };
    expect(readBacklogMetadata(metadata)).toEqual({ kind: 'bug', score: 5 });
  });

  it('devolve {} quando backlog falta ou não é objeto', () => {
    expect(readBacklogMetadata({ origin: {} })).toEqual({});
    expect(readBacklogMetadata({ backlog: 'quebrado' })).toEqual({});
    expect(readBacklogMetadata({ backlog: ['a'] })).toEqual({});
    expect(readBacklogMetadata({ backlog: null })).toEqual({});
    expect(readBacklogMetadata('nada disso')).toEqual({});
  });

  it('não inventa campo: item legado sem score/files vem vazio, não zerado', () => {
    const result = readBacklogMetadata({ backlog: { kind: 'debt' } });
    expect(result.score).toBeUndefined();
    expect(result.files).toBeUndefined();
  });
});
