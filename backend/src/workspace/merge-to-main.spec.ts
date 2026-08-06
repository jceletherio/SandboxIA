import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import simpleGit from 'simple-git';
import { WorkspaceService } from './workspace.service';

/**
 * Gate de dirty do `mergeToMain` contra git DE VERDADE, em repo temporário.
 *
 * O helper puro (`git-dirty.spec.ts`) cobre a classificação dos códigos do
 * porcelain; aqui o que se prova é o comportamento de ponta a ponta que a MT-21
 * precisa garantir: untracked no repo principal não barra merge nenhum, e
 * arquivo rastreado modificado continua barrando. Sem rede, sem config global
 * (`user.name`/`user.email` são setados no próprio repo).
 */
describe('WorkspaceService.mergeToMain — gate de dirty', () => {
  let repoPath: string;
  let service: WorkspaceService;

  const git = () => simpleGit(repoPath);

  /** Commit numa branch de "sessão", como o worktree faria. */
  async function makeSessionBranch(branch: string, file: string): Promise<void> {
    await git().checkoutLocalBranch(branch);
    await fs.writeFile(path.join(repoPath, file), `conteúdo de ${branch}\n`);
    await git().add(file);
    await git().commit(`feat: ${branch}`);
    await git().checkout('main');
  }

  beforeEach(async () => {
    repoPath = await fs.mkdtemp(path.join(os.tmpdir(), 'mt21-merge-'));
    service = new WorkspaceService();

    await git().init(['--initial-branch=main']);
    await git().addConfig('user.name', 'MT-21 Test');
    await git().addConfig('user.email', 'mt21@example.test');
    await git().addConfig('commit.gpgsign', 'false');

    await fs.writeFile(path.join(repoPath, 'README.md'), '# base\n');
    await git().add('README.md');
    await git().commit('chore: commit inicial');
  });

  afterEach(async () => {
    await fs.rm(repoPath, { recursive: true, force: true });
  });

  it('mergeia duas sessões consecutivas com arquivo não rastreado no repo principal', async () => {
    await makeSessionBranch('task/sessao-a', 'a.txt');
    await makeSessionBranch('task/sessao-b', 'b.txt');

    // O resíduo que quebrava tudo: untracked no repo principal, sem relação
    // alguma com o que as sessões tocaram.
    await fs.mkdir(path.join(repoPath, '.opencode/agent'), { recursive: true });
    await fs.writeFile(path.join(repoPath, '.opencode/agent/qmd-curator.md'), 'agente\n');
    await fs.writeFile(path.join(repoPath, '.opencode/agent/sdd-reviewer.md'), 'agente\n');
    expect((await git().status()).not_added.length).toBeGreaterThan(0);

    const first = await service.mergeToMain(repoPath, 'task/sessao-a', {
      message: 'Merge sessao-a',
    });
    const second = await service.mergeToMain(repoPath, 'task/sessao-b', {
      message: 'Merge sessao-b',
    });

    expect(first).toEqual({ merged: true, mainBranch: 'main' });
    expect(second).toEqual({ merged: true, mainBranch: 'main' });

    // Os dois merges chegaram ao main e o untracked segue intocado no disco.
    const tracked = (await git().raw(['ls-tree', '-r', '--name-only', 'main'])).split('\n');
    expect(tracked).toContain('a.txt');
    expect(tracked).toContain('b.txt');
    expect((await git().status()).not_added).toContain('.opencode/agent/qmd-curator.md');
  });

  it('barra o merge quando há arquivo RASTREADO modificado no repo principal', async () => {
    await makeSessionBranch('task/sessao-c', 'c.txt');

    await fs.writeFile(path.join(repoPath, 'README.md'), '# base suja\n');

    await expect(service.mergeToMain(repoPath, 'task/sessao-c')).rejects.toThrow(
      /has uncommitted changes.*README\.md/s,
    );

    // Nada foi mergeado: o gate roda antes de qualquer operação de merge.
    const tracked = await git().raw(['ls-tree', '-r', '--name-only', 'main']);
    expect(tracked).not.toContain('c.txt');
  });

  it('barra o merge quando há arquivo rastreado deletado, mesmo com untracked ao lado', async () => {
    await makeSessionBranch('task/sessao-d', 'd.txt');

    await fs.rm(path.join(repoPath, 'README.md'));
    await fs.writeFile(path.join(repoPath, 'solto.txt'), 'untracked\n');

    await expect(service.mergeToMain(repoPath, 'task/sessao-d')).rejects.toThrow(
      /has uncommitted changes/,
    );
  });
});
