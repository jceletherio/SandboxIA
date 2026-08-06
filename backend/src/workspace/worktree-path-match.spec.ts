import { WorkspaceService } from './workspace.service';

/**
 * O `createWorktree` só é idempotente se conseguir reconhecer que o worktree
 * que o git lista é o mesmo que ele ia criar. As duas pontas escrevem o caminho
 * diferente no Windows: `git worktree list --porcelain` devolve com barra
 * normal, `path.join` produz barra invertida.
 *
 * Comparando string crua, a checagem nunca casava e o `worktree add` rodava de
 * novo, falhando com "already exists" — foi o que quebrou o retry de estágio da
 * sessão do TaskFlow. E retry deixou de ser exceção: sem tmux, toda sessão
 * morre junto com o backend e é retomada assim.
 */
describe('WorkspaceService.samePath', () => {
  // `samePath` é função pura sobre strings — não toca em nenhuma dependência,
  // então o construtor pode receber undefined em vez de mocks.
  const svc = new (WorkspaceService as any)() as any;
  const isWin = process.platform === 'win32';

  it('reconhece o mesmo caminho escrito com separadores diferentes', () => {
    const doGit = 'C:/Users/Magno R/Projetos/Pessoais/task/taskflow-pwa-mvp-a0b54c';
    const doJoin = 'C:\\Users\\Magno R\\Projetos\\Pessoais\\task\\taskflow-pwa-mvp-a0b54c';
    // No Linux a barra invertida é caractere de nome válido, então os dois
    // formatos são caminhos DIFERENTES ali — a equivalência só vale no Windows.
    expect(svc.samePath(doGit, doJoin)).toBe(isWin);
  });

  it('caminhos iguais casam em qualquer plataforma', () => {
    const p = isWin ? 'C:\\a\\b\\c' : '/a/b/c';
    expect(svc.samePath(p, p)).toBe(true);
  });

  it('resolve segmentos relativos antes de comparar', () => {
    const base = isWin ? 'C:\\a\\b' : '/a/b';
    const rodeio = isWin ? 'C:\\a\\x\\..\\b' : '/a/x/../b';
    expect(svc.samePath(base, rodeio)).toBe(true);
  });

  it('caminhos realmente diferentes não casam', () => {
    const a = isWin ? 'C:\\a\\b' : '/a/b';
    const b = isWin ? 'C:\\a\\c' : '/a/c';
    expect(svc.samePath(a, b)).toBe(false);
  });

  it('undefined nunca casa — worktree sem o campo no porcelain', () => {
    expect(svc.samePath(undefined, 'C:\\a')).toBe(false);
    expect(svc.samePath('C:\\a', undefined)).toBe(false);
    expect(svc.samePath(undefined, undefined)).toBe(false);
  });

  if (isWin) {
    it('Windows: ignora caixa, porque o git às vezes devolve o drive minúsculo', () => {
      expect(svc.samePath('c:/users/magno r/x', 'C:\\Users\\Magno R\\x')).toBe(true);
    });
  }
});
