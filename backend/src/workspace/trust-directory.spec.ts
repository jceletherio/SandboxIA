import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { WorkspaceService } from './workspace.service';

/**
 * O pré-registro de confiança mexe no `~/.claude.json` do USUÁRIO — o arquivo
 * que guarda o histórico de todos os projetos dele. Os testes aqui cobrem os
 * dois riscos: não conseguir tirar o diálogo da frente (sessão trava) e
 * estragar o arquivo (perda de dados alheios).
 */
describe('WorkspaceService.trustDirectoryForClaude', () => {
  let tmpHome: string;
  let configPath: string;
  let svc: any;
  let spyHome: jest.SpyInstance;

  beforeEach(async () => {
    tmpHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'trust-spec-'));
    configPath = path.join(tmpHome, '.claude.json');
    spyHome = jest.spyOn(os, 'homedir').mockReturnValue(tmpHome);
    svc = new (WorkspaceService as any)();
  });

  afterEach(async () => {
    spyHome.mockRestore();
    await fsp.rm(tmpHome, { recursive: true, force: true });
  });

  const ler = () => JSON.parse(fs.readFileSync(configPath, 'utf8'));
  // `.native`: no Windows o realpath comum NÃO expande nome curto 8.3
  // (`C:\Users\MAGNOR~1`), e o tmpdir vem justamente nessa forma. Sem isto o
  // teste compara contra uma chave que o CLI nunca consultaria.
  const chave = (p: string) => fs.realpathSync.native(p).replace(/\\/g, '/');

  it('cria o arquivo e marca a pasta como confiável quando não existe config', async () => {
    const dir = await fsp.mkdtemp(path.join(tmpHome, 'wt-'));
    await svc.trustDirectoryForClaude(dir);

    const cfg = ler();
    expect(cfg.projects[chave(dir)].hasTrustDialogAccepted).toBe(true);
    // 0 faria o CLI abrir a tela de onboarding — outro diálogo travando o boot.
    expect(cfg.projects[chave(dir)].projectOnboardingSeenCount).toBe(1);
  });

  it('preserva os outros projetos do usuário', async () => {
    await fsp.writeFile(
      configPath,
      JSON.stringify({
        numStartups: 42,
        projects: { '/outro/projeto': { hasTrustDialogAccepted: true, lastCost: 1.23 } },
      }),
    );
    const dir = await fsp.mkdtemp(path.join(tmpHome, 'wt-'));
    await svc.trustDirectoryForClaude(dir);

    const cfg = ler();
    expect(cfg.numStartups).toBe(42);
    expect(cfg.projects['/outro/projeto'].lastCost).toBe(1.23);
    expect(cfg.projects[chave(dir)].hasTrustDialogAccepted).toBe(true);
  });

  it('não sobrescreve uma decisão que o usuário já tomou', async () => {
    const dir = await fsp.mkdtemp(path.join(tmpHome, 'wt-'));
    const k = chave(dir);
    await fsp.writeFile(
      configPath,
      JSON.stringify({ projects: { [k]: { hasTrustDialogAccepted: true, lastCost: 9.99 } } }),
    );

    await svc.trustDirectoryForClaude(dir);

    // Já estava confiável: sai cedo e nada é reescrito.
    expect(ler().projects[k].lastCost).toBe(9.99);
  });

  it('config corrompido é deixado intacto em vez de sobrescrito', async () => {
    const lixo = '{ isto nao e json';
    await fsp.writeFile(configPath, lixo);
    const dir = await fsp.mkdtemp(path.join(tmpHome, 'wt-'));

    await expect(svc.trustDirectoryForClaude(dir)).resolves.toBeUndefined();

    // Perder o histórico do usuário seria pior que o diálogo que isto evita.
    expect(fs.readFileSync(configPath, 'utf8')).toBe(lixo);
  });

  it('grava a chave com barra normal, como o CLI indexa', async () => {
    const dir = await fsp.mkdtemp(path.join(tmpHome, 'wt-'));
    await svc.trustDirectoryForClaude(dir);

    const k = Object.keys(ler().projects)[0];
    expect(k).not.toContain('\\');
  });

  it('não deixa arquivo temporário para trás (escrita atômica)', async () => {
    const dir = await fsp.mkdtemp(path.join(tmpHome, 'wt-'));
    await svc.trustDirectoryForClaude(dir);

    expect(fs.existsSync(`${configPath}.orchestr-tmp`)).toBe(false);
  });
});
