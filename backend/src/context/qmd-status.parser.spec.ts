import * as fs from 'fs';
import * as path from 'path';
import { parseQmdStatus } from './qmd-status.parser';

/**
 * O fixture é a saída REAL de `qmd status` (v2.5.2), capturada com
 * `qmd status > __fixtures__/qmd-status-2.5.2.txt`. Não parafraseie o arquivo à
 * mão: o objetivo do teste é justamente pegar mudança de layout do CLI, e um
 * fixture editado por humano mede o parser contra a nossa memória do formato,
 * não contra o formato.
 *
 * Para atualizar depois de subir a versão do qmd: rode o mesmo redirect e ajuste
 * os números esperados. Se o parser passar a devolver 0 num campo que o arquivo
 * mostra preenchido, é o CLI que mudou de layout.
 */
const REAL_OUTPUT = fs.readFileSync(
  path.join(__dirname, '__fixtures__', 'qmd-status-2.5.2.txt'),
  'utf8',
);

describe('parseQmdStatus', () => {
  it('lê o bloco Documents da saída real do qmd 2.5.2', () => {
    const snapshot = parseQmdStatus(REAL_OUTPUT);

    expect(snapshot.documents).toBe(291);
    expect(snapshot.vectors).toBe(440);
    // `Pending` existe nesta versão — o parser antigo ignorava e a /context
    // mostrava índice completo com 80% dos docs sem embedding.
    expect(snapshot.pending).toBe(234);
    expect(snapshot.updatedLabel).toBe('1h ago');
  });

  it('lista só as coleções do bloco Collections, não os qmd:// dos exemplos', () => {
    const snapshot = parseQmdStatus(REAL_OUTPUT);

    expect(snapshot.collections).toEqual([
      'sdd',
      'todo-list-docs',
      'todo-list-code',
      'planning-development-orquestrator-docs',
      'planning-development-orquestrator-code',
    ]);
  });

  it('não confunde o "(updated 7d ago)" das coleções com o Updated do índice', () => {
    // O rótulo por coleção vem minúsculo e entre parênteses; o do índice é o
    // único `Updated:`. Um regex sem `:` casaria com o primeiro que aparecesse.
    expect(parseQmdStatus(REAL_OUTPUT).updatedLabel).not.toContain('7d');
  });

  it('devolve zeros em vez de lançar quando o layout muda', () => {
    const snapshot = parseQmdStatus('QMD Status\n\nDocuments\n  Indexed:  291 files\n');

    expect(snapshot).toEqual({
      collections: [],
      documents: 0,
      vectors: 0,
      pending: 0,
      updatedLabel: null,
    });
  });

  it('devolve zeros com stdout vazio (CLI ausente ou comando falhado)', () => {
    expect(parseQmdStatus('').documents).toBe(0);
    expect(parseQmdStatus('').collections).toEqual([]);
  });
});
