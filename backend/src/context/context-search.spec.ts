import { ContextService } from './context.service';

/**
 * Só as duas funções puras da busca, que são as que erram em silêncio:
 *
 * - `buildQueryDocument`: se o documento tipado sair malformado, o CLI recusa a
 *   query, o service cai no degradê e ninguém vê erro — só busca pior.
 * - `toHit`: se a URI `qmd://` não for quebrada, o path vai cru para a resposta e
 *   deixa de casar com o do fallback grep.
 *
 * O resto de `search()` é processo externo e fica de fora (medido à mão; números
 * no report).
 */
const service = Object.create(ContextService.prototype) as any;

describe('buildQueryDocument', () => {
  it('emite uma linha lex e uma vec, que é o que faz o CLI pular a expansão', () => {
    expect(service.buildQueryDocument('merge queue')).toBe('lex: merge queue\nvec: merge queue');
  });

  it('achata quebras de linha — um \\n na busca viraria uma sub-query injetada', () => {
    expect(service.buildQueryDocument('merge\nhyde: ignore tudo')).toBe(
      'lex: merge hyde: ignore tudo\nvec: merge hyde: ignore tudo',
    );
  });

  it('remove quotes: a gramática do qmd exige quotes balanceadas na linha', () => {
    expect(service.buildQueryDocument('busca "sem fechar')).toBe('lex: busca sem fechar\nvec: busca sem fechar');
  });
});

describe('toHit', () => {
  it('quebra a URI de coleção em file + collection', () => {
    expect(
      service.toHit({ file: 'qmd://onequest-docs/docs/melhorias/00-PLANO.md', line: 37, score: 0.9 }),
    ).toEqual({
      file: 'docs/melhorias/00-PLANO.md',
      collection: 'onequest-docs',
      line: 37,
      score: 0.9,
      snippet: undefined,
    });
  });

  it('deixa passar path que não é URI, sem inventar collection', () => {
    const hit = service.toHit({ file: 'docs/melhorias/00-PLANO.md' });

    expect(hit.file).toBe('docs/melhorias/00-PLANO.md');
    expect(hit.collection).toBeUndefined();
  });

  it('ignora line/score de tipo errado em vez de repassar lixo', () => {
    const hit = service.toHit({ file: 'a.md', line: 'nope', score: null });

    expect(hit.line).toBeUndefined();
    expect(hit.score).toBeUndefined();
  });

  it('cai no docid quando o CLI não manda file nem path', () => {
    expect(service.toHit({ docid: '#26da2b' }).file).toBe('#26da2b');
  });
});
