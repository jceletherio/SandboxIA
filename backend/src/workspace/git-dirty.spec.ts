import { GitFileStatus, hasTrackedChanges, trackedChangedFiles } from './git-dirty';

/**
 * Os códigos vêm do porcelain do git, na forma como o simple-git os expõe em
 * `StatusResult.files`. Untracked é `?` nas DUAS colunas — é justamente esse o
 * caso que o gate antigo contava como sujo.
 */
const untracked = (path: string): GitFileStatus => ({ path, index: '?', working_dir: '?' });
const ignored = (path: string): GitFileStatus => ({ path, index: '!', working_dir: '!' });
const modified = (path: string): GitFileStatus => ({ path, index: ' ', working_dir: 'M' });
const staged = (path: string): GitFileStatus => ({ path, index: 'M', working_dir: ' ' });
const added = (path: string): GitFileStatus => ({ path, index: 'A', working_dir: ' ' });
const deleted = (path: string): GitFileStatus => ({ path, index: ' ', working_dir: 'D' });
const renamed = (path: string): GitFileStatus => ({ path, index: 'R', working_dir: ' ' });
const conflicted = (path: string): GitFileStatus => ({ path, index: 'U', working_dir: 'U' });

describe('trackedChangedFiles / hasTrackedChanges', () => {
  it('considera limpo o repo que só tem arquivo não rastreado', () => {
    // Caso real que derrubou o merge de todas as sessões (MT-21).
    const status = {
      files: [
        untracked('.opencode/agent/frontend-designer.md'),
        untracked('.opencode/agent/qmd-curator.md'),
        untracked('.opencode/agent/sdd-context-reviewer.md'),
        untracked('.opencode/agent/sdd-implementer.md'),
        untracked('.opencode/agent/sdd-reviewer.md'),
      ],
    };

    expect(trackedChangedFiles(status)).toEqual([]);
    expect(hasTrackedChanges(status)).toBe(false);
  });

  it('considera limpo o repo que só tem arquivo ignorado', () => {
    const status = { files: [ignored('.claude/skills/sdd/telemetry/events/a.jsonl')] };

    expect(hasTrackedChanges(status)).toBe(false);
  });

  it('considera sujo cada tipo de mudança rastreada', () => {
    const cases: GitFileStatus[] = [
      modified('frontend/next-env.d.ts'),
      staged('backend/src/app.module.ts'),
      added('backend/src/novo.ts'),
      deleted('docs/antigo.md'),
      renamed('docs/novo.md'),
      conflicted('backend/src/conflito.ts'),
    ];

    for (const file of cases) {
      expect(hasTrackedChanges({ files: [file] })).toBe(true);
    }
  });

  it('separa rastreado de untracked no mesmo status e preserva a ordem', () => {
    const status = {
      files: [
        untracked('.opencode/agent/qmd-curator.md'),
        modified('frontend/next-env.d.ts'),
        untracked('logs/session.log'),
        deleted('docs/antigo.md'),
      ],
    };

    expect(trackedChangedFiles(status)).toEqual(['frontend/next-env.d.ts', 'docs/antigo.md']);
    expect(hasTrackedChanges(status)).toBe(true);
  });

  it('trata entrada de arquivo malformada como RASTREADA (barrar é o erro reversível)', () => {
    // Assimetria proposital com o caso abaixo: o git reportou um arquivo, então
    // não sabemos classificá-lo — barrar o merge é preferível a sobrescrever
    // trabalho não commitado. Ver comentário em git-dirty.ts.
    const status = { files: [{ path: 'misterioso.ts' } as GitFileStatus] };

    expect(trackedChangedFiles(status)).toEqual(['misterioso.ts']);
    expect(hasTrackedChanges(status)).toBe(true);
  });

  it('trata status vazio ou sem `files` como limpo (gate não derruba merge por status podre)', () => {
    expect(hasTrackedChanges({ files: [] })).toBe(false);
    expect(hasTrackedChanges(null)).toBe(false);
    expect(hasTrackedChanges(undefined)).toBe(false);
    expect(hasTrackedChanges({} as never)).toBe(false);
    expect(hasTrackedChanges({ files: null } as never)).toBe(false);
  });
});
