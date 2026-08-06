import { Injectable, Logger } from '@nestjs/common';
import simpleGit, { SimpleGit } from 'simple-git';
import * as path from 'path';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { trackedChangedFiles } from './git-dirty';
import { missingPackages, PackageManifestLike } from './node-modules-integrity';

const execFileAsync = promisify(execFile);

/** Padrões (pathspecs git) de configs não-versionadas copiadas do repo principal para o worktree. */
const WORKTREE_CONFIG_PATHSPECS = ['.mcp.json', '.claude'];

/** Permissão sempre presente: tools do orquestrador nunca podem travar em modo headless. */
// Formato documentado do Claude Code: "mcp__<server>" (todas as tools do
// servidor); mantém também a variante com sufixo por compatibilidade.
const ORCHESTRATOR_PERMISSIONS = ['mcp__orchestrator', 'mcp__orchestrator__*'];

/** Diretórios nunca varridos em busca de node_modules/.env no provisionamento. */
const PROVISION_SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', '.next', 'coverage']);

/** Arquivos de ambiente copiados (não linkados) do repo principal para o worktree. */
const PROVISION_ENV_FILES = ['.env'];

/**
 * Marca o `node_modules` que este serviço criou. Sem ele não dá para distinguir
 * a árvore provisionada de uma instalação real feita à mão — e a diferença
 * decide se pode ou não ser apagada e refeita.
 */
const PROVISION_MARKER = '.orchestr-provisioned';

@Injectable()
export class WorkspaceService {
  private readonly logger = new Logger(WorkspaceService.name);
  private isWindows = os.platform() === 'win32';

  /**
   * Dois caminhos apontam para o mesmo lugar?
   *
   * `path.resolve` uniformiza o separador e resolve `.`/`..`; no Windows a
   * comparação também ignora caixa, porque o filesystem ignora e o git às vezes
   * devolve a letra do drive em minúscula (`c:/Users/...`) mesmo tendo recebido
   * maiúscula.
   */
  samePath(a: string | undefined, b: string | undefined): boolean {
    if (!a || !b) return false;
    const norm = (p: string) =>
      process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p);
    return norm(a) === norm(b);
  }

  async createWorktree(repoPath: string, branchName: string, worktreeBase: string): Promise<string> {
    const git: SimpleGit = simpleGit(repoPath);
    const worktreePath = path.join(worktreeBase, branchName.replace(/[^\w./-]/g, '-'));

    // Idempotente: se o worktree já está registrado neste caminho, reutiliza.
    // A comparação é NORMALIZADA porque as duas pontas escrevem o caminho de
    // formas diferentes no Windows: `git worktree list` devolve com barra
    // normal (`C:/Users/.../task/x`) e o `path.join` acima produz barra
    // invertida (`C:\Users\...\task\x`). Comparando as strings cruas isto nunca
    // casava, o `worktree add` rodava de novo e o git recusava com "already
    // exists" — quebrando todo retry de estágio, que virou o caminho NORMAL
    // desde que a sessão passou a morrer junto com o backend.
    const existing = await this.listWorktrees(repoPath);
    if (existing.some((w) => this.samePath(w.worktree, worktreePath))) {
      this.logger.log(`Worktree already exists, reusing: ${worktreePath}`);
      // Reprovisiona: worktree reaproveitado pode ter perdido o symlink (repo
      // principal movido, node_modules reinstalado) e voltaria a não buildar.
      await this.provisionWorktree({ worktreePath, mainRepoPath: repoPath });
      return worktreePath;
    }

    fs.mkdirSync(path.dirname(worktreePath), { recursive: true });

    const branches = await git.branchLocal();
    if (branches.all.includes(branchName)) {
      await git.raw(['worktree', 'add', worktreePath, branchName]);
    } else {
      await git.raw(['worktree', 'add', worktreePath, '-b', branchName]);
    }

    await this.provisionWorktree({ worktreePath, mainRepoPath: repoPath });

    return worktreePath;
  }

  /**
   * Torna o worktree buildável sem intervenção manual: replica `node_modules`
   * do repo principal por hardlink e copia os `.env` (01-CONTRATOS §7).
   *
   * `pnpm install` por worktree custa ~1,3 GB e, com 4–5 sessões paralelas, é o
   * cenário que trava a máquina — por isso hardlink, que custa menos de 1s e
   * quase nada de disco. O `.env` é **copiado**, não linkado: ele carrega o
   * DATABASE_URL do banco real e cada worktree precisa poder divergir sem mexer
   * no arquivo do repo principal.
   *
   * Descobre os diretórios sozinho (raiz + 1 nível) para funcionar em qualquer
   * projeto cadastrado, não só neste monorepo. Nunca lança: o que falhou vira
   * warning, porque worktree sem dependência ainda serve para stages que não
   * buildam.
   */
  async provisionWorktree(opts: {
    worktreePath: string;
    mainRepoPath: string;
  }): Promise<{ linked: string[]; copied: string[]; warnings: string[] }> {
    const linked: string[] = [];
    const copied: string[] = [];
    const warnings: string[] = [];

    let candidates: string[];
    try {
      candidates = await this.listProvisionCandidates(opts.mainRepoPath);
    } catch (error) {
      warnings.push(`could not scan ${opts.mainRepoPath}: ${error.message}`);
      this.logger.warn(`provisionWorktree: ${warnings[warnings.length - 1]}`);
      return { linked, copied, warnings };
    }

    for (const relDir of candidates) {
      const srcDir = path.join(opts.mainRepoPath, relDir);
      const destDir = path.join(opts.worktreePath, relDir);

      // Diretório que existe no repo principal e não chegou ao worktree quase
      // sempre é fonte engolida pelo .gitignore (aconteceu com backend/src/logs
      // na Onda 0) — o build quebra por um motivo que não é da task.
      const destDirExists = await this.pathExists(destDir);
      if (!destDirExists) {
        warnings.push(
          `"${relDir || '.'}" exists in the main repo but not in the worktree — likely gitignored source; build may fail`,
        );
        continue;
      }

      const srcModules = path.join(srcDir, 'node_modules');
      if (await this.pathExists(srcModules)) {
        const destModules = path.join(destDir, 'node_modules');
        try {
          if (
            await this.linkNodeModules(
              srcModules,
              destModules,
              opts.worktreePath,
              await this.needsRealNodeModules(srcDir),
            )
          ) {
            linked.push(path.posix.join(relDir || '.', 'node_modules'));
          }
        } catch (error) {
          warnings.push(`failed to link node_modules in "${relDir || '.'}": ${error.message}`);
        }

        // Linkar com sucesso não significa que o node_modules de origem está
        // completo — ver node-modules-integrity.ts. Sem isso, um install
        // parcial no repo principal (ou numa onda paralela) só aparece como
        // "module not found" no meio de um build, sem pista da causa real.
        try {
          const missing = await this.checkNodeModulesIntegrity(destDir, destModules);
          if (missing.length > 0) {
            warnings.push(
              `node_modules em "${relDir || '.'}" está incompleto (compartilhado com o repo ` +
                `principal — não é bug deste worktree): pacote(s) declarado(s) em package.json ` +
                `mas ausente(s) em node_modules: ${missing.join(', ')}. Não rode "pnpm install" ` +
                `para corrigir (01-CONTRATOS §7) — reporte via submit_question.`,
            );
          }
        } catch (error) {
          this.logger.warn(
            `provisionWorktree: could not verify node_modules integrity in "${relDir || '.'}": ${error.message}`,
          );
        }
      }

      for (const envFile of PROVISION_ENV_FILES) {
        const srcEnv = path.join(srcDir, envFile);
        const destEnv = path.join(destDir, envFile);
        if (!(await this.pathExists(srcEnv))) continue;
        if (await this.pathExists(destEnv)) continue; // nunca sobrescreve o do worktree
        try {
          await fsp.copyFile(srcEnv, destEnv);
          copied.push(path.posix.join(relDir || '.', envFile));
        } catch (error) {
          warnings.push(`failed to copy ${envFile} to "${relDir || '.'}": ${error.message}`);
        }
      }
    }

    // Symlink apontando para fora do worktree não pode virar commit: se o
    // .gitignore do projeto não cobre node_modules, avisa em vez de deixar a
    // sessão commitar 1,3 GB de dependência.
    const leaked = await this.findUnignoredNodeModules(opts.worktreePath);
    if (leaked.length > 0) {
      warnings.push(
        `node_modules is not gitignored (${leaked.join(', ')}) — add it to .gitignore before committing`,
      );
    }

    const summary = `provisionWorktree: ${linked.length} linked, ${copied.length} copied in ${opts.worktreePath}`;
    if (warnings.length > 0) {
      this.logger.warn(`${summary} — ${warnings.length} warning(s): ${warnings.join('; ')}`);
    } else {
      this.logger.log(summary);
    }

    return { linked, copied, warnings };
  }

  /** Raiz + subdiretórios de 1 nível do repo principal que tenham node_modules ou .env. */
  private async listProvisionCandidates(mainRepoPath: string): Promise<string[]> {
    const entries = await fsp.readdir(mainRepoPath, { withFileTypes: true });
    const dirs = [''];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.') || PROVISION_SKIP_DIRS.has(entry.name)) continue;
      dirs.push(entry.name);
    }

    const relevant: string[] = [];
    for (const relDir of dirs) {
      const dir = path.join(mainRepoPath, relDir);
      const hasModules = await this.pathExists(path.join(dir, 'node_modules'));
      const hasEnv = await Promise.all(
        PROVISION_ENV_FILES.map((f) => this.pathExists(path.join(dir, f))),
      );
      if (hasModules || hasEnv.some(Boolean)) relevant.push(relDir);
    }
    return relevant;
  }

  /**
   * Um projeto Next precisa de `node_modules` como diretório REAL: o Turbopack
   * do Next 16 recusa symlink que aponte para fora da raiz do projeto ("points
   * out of the filesystem root") e o build não sai. Para os demais (Nest, jest,
   * libs) o symlink resolve e é preferível — ver `linkNodeModules`.
   */
  private async needsRealNodeModules(srcDir: string): Promise<boolean> {
    const configs = ['next.config.mjs', 'next.config.js', 'next.config.ts'];
    const found = await Promise.all(
      configs.map((f) => this.pathExists(path.join(srcDir, f))),
    );
    if (found.some(Boolean)) return true;
    try {
      const pkg = JSON.parse(await fsp.readFile(path.join(srcDir, 'package.json'), 'utf8'));
      return Boolean(pkg?.dependencies?.next || pkg?.devDependencies?.next);
    } catch {
      return false;
    }
  }

  /**
   * Provisiona o `node_modules` do worktree a partir do repo principal.
   *
   * Duas estratégias, porque nenhuma serve para os dois casos — ambas verificadas
   * na Onda 1, cada uma quebrando de um jeito diferente:
   *
   * - **symlink** (default): instantâneo e sem custo. `nest build` e `jest`
   *   funcionam. Mas o Turbopack recusa symlink para fora da raiz do projeto.
   * - **hardlink** (`cp -al`, só quando `needsReal`): diretório de verdade, ~1s,
   *   arquivos dividindo inode. Resolve o Turbopack, mas **bumpa o ctime de todo
   *   inode do original** — e o `tsc --watch` do backend acompanha os `.d.ts`
   *   resolvidos em `node_modules`. Enquanto o orquestrador se auto-hospeda com
   *   `nest start --watch`, hardlinkar o `node_modules` do backend faz o próprio
   *   backend reiniciar NO MEIO do boot da sessão, deixando tmux sem CLI e a
   *   sessão presa em `initializing`. Aconteceu 3 vezes seguidas na Onda 2.
   *
   * Daí a regra: hardlink **só** onde o symlink comprovadamente não serve (Next),
   * symlink em todo o resto. Os symlinks internos do pnpm são relativos
   * (`.pnpm/…`), então a árvore copiada continua se resolvendo sozinha.
   *
   * Instalação real feita à mão no destino é preservada — só a árvore marcada
   * como nossa é refeita. Retorna false quando nada foi provisionado.
   */
  private async linkNodeModules(
    srcModules: string,
    destModules: string,
    worktreePath: string,
    needsReal = false,
  ): Promise<boolean> {
    const current = await fsp.lstat(destModules).catch(() => undefined);
    if (current) {
      const ours = await this.pathExists(path.join(destModules, PROVISION_MARKER));
      if (current.isDirectory() && !current.isSymbolicLink() && !ours) {
        this.logger.log(
          `provisionWorktree: real node_modules already at ${destModules} — keeping it`,
        );
        return false;
      }
      // Guarda de segurança: só apaga dentro do worktree. Um caminho que escape
      // daqui apagaria o node_modules do repo principal, e com ele o original
      // dos hardlinks de todas as outras sessões.
      if (!path.resolve(destModules).startsWith(path.resolve(worktreePath) + path.sep)) {
        throw new Error(`refusing to replace ${destModules}: outside of ${worktreePath}`);
      }
      await fsp.rm(destModules, { recursive: true, force: true });
    }

    if (this.isWindows) {
      // Sem `cp -al` no Windows; junction é o equivalente aceito por lá.
      await fsp.symlink(srcModules, destModules, 'junction');
      return true;
    }

    // Caminho default: symlink. Não toca em nenhum inode do original, então não
    // acorda watcher nenhum no repo principal.
    if (!needsReal) {
      await fsp.symlink(srcModules, destModules, 'dir');
      return true;
    }

    try {
      await execFileAsync('cp', ['-al', srcModules, destModules]);
    } catch (error) {
      // Hardlink exige mesmo filesystem: worktreeBase em outro disco cai aqui.
      // Symlink volta a ser melhor que nada — o backend builda, o frontend não.
      this.logger.warn(
        `provisionWorktree: hardlink copy failed (${error.message}) — falling back to symlink; ` +
          'the Next.js build may fail in this worktree',
      );
      await fsp.symlink(srcModules, destModules, 'dir');
      return true;
    }

    await fsp
      .writeFile(
        path.join(destModules, PROVISION_MARKER),
        `hardlinked from ${srcModules}\n`,
        'utf8',
      )
      .catch(() => undefined);
    return true;
  }

  /**
   * Monta o snapshot de pacotes top-level de `node_modules` (lê disco) e
   * delega a comparação com `package.json` para `missingPackages`
   * (node-modules-integrity.ts, módulo puro). Usa o `package.json` do
   * WORKTREE (`destDir`), não o do repo principal — é o que aquela sessão
   * precisa ver satisfeito.
   */
  private async checkNodeModulesIntegrity(destDir: string, destModules: string): Promise<string[]> {
    const pkg: PackageManifestLike = JSON.parse(
      await fsp.readFile(path.join(destDir, 'package.json'), 'utf8'),
    );

    const entries = await fsp.readdir(destModules, { withFileTypes: true }).catch(() => []);
    const present: string[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (entry.name.startsWith('@')) {
        const scoped = await fsp
          .readdir(path.join(destModules, entry.name))
          .catch(() => [] as string[]);
        for (const name of scoped) present.push(`${entry.name}/${name}`);
        continue;
      }
      present.push(entry.name);
    }

    return missingPackages(pkg, { present });
  }

  /** Caminhos de node_modules que o git do worktree ainda enxerga como versionáveis. */
  private async findUnignoredNodeModules(worktreePath: string): Promise<string[]> {
    try {
      const git: SimpleGit = simpleGit(worktreePath);
      const status = await git.raw(['status', '--porcelain']);
      return status
        .split('\n')
        .map((line) => line.slice(3).trim())
        .filter((file) => file.includes('node_modules'));
    } catch (error) {
      this.logger.warn(`provisionWorktree: could not check git status in ${worktreePath}: ${error.message}`);
      return [];
    }
  }

  private async pathExists(target: string): Promise<boolean> {
    return fsp
      .access(target)
      .then(() => true)
      .catch(() => false);
  }

  /**
   * Semeia o worktree recém-criado com configs não-versionadas do repo principal
   * (.mcp.json, .claude/**) e com a allowlist de permissões do Claude Code em
   * .claude/settings.local.json — evitando que ferramentas MCP travem pedindo
   * aprovação em execução headless (`claude -p`).
   *
   * Chamado pelo session-runtime logo após createWorktree. Não lança exceção por
   * condição recuperável: loga warn e retorna o que conseguiu fazer.
   */
  async seedWorktreeConfig(opts: {
    worktreePath: string;
    mainRepoPath: string;
    permissions?: string[];
  }): Promise<{ copiedFiles: string[] }> {
    const copiedFiles: string[] = [];

    // 1. Copia configs não-versionadas (untracked + ignored) do repo principal
    try {
      const files = await this.listUnversionedConfigFiles(opts.mainRepoPath);
      for (const relPath of files) {
        try {
          const src = path.join(opts.mainRepoPath, relPath);
          const dest = path.join(opts.worktreePath, relPath);
          const stat = await fsp.stat(src).catch(() => undefined);
          if (!stat || !stat.isFile()) continue;
          const destExists = await fsp
            .access(dest)
            .then(() => true)
            .catch(() => false);
          if (destExists) continue; // nunca sobrescreve o que já existe no worktree
          await fsp.mkdir(path.dirname(dest), { recursive: true });
          await fsp.copyFile(src, dest);
          copiedFiles.push(relPath);
        } catch (error) {
          this.logger.warn(`seedWorktreeConfig: failed to copy "${relPath}": ${error.message}`);
        }
      }
      if (copiedFiles.length > 0) {
        this.logger.log(
          `seedWorktreeConfig: copied ${copiedFiles.length} unversioned config file(s) to ${opts.worktreePath}`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `seedWorktreeConfig: could not list unversioned configs in ${opts.mainRepoPath}: ${error.message}`,
      );
    }

    // 2. Semeia a allowlist de permissões em .claude/settings.local.json
    try {
      await this.seedPermissionAllowlist(opts.worktreePath, opts.permissions ?? []);
    } catch (error) {
      this.logger.warn(
        `seedWorktreeConfig: failed to seed permission allowlist in ${opts.worktreePath}: ${error.message}`,
      );
    }

    // 3. Marca o worktree como pasta confiável para o Claude Code
    try {
      await this.trustDirectoryForClaude(opts.worktreePath);
    } catch (error) {
      this.logger.warn(
        `seedWorktreeConfig: failed to pre-trust ${opts.worktreePath}: ${error.message}`,
      );
    }

    return { copiedFiles };
  }

  /**
   * Registra o diretório como confiável em `~/.claude.json`.
   *
   * Sem isto o CLI abre o diálogo "Do you trust this folder?" e FICA PARADO
   * esperando resposta — e como todo worktree é um caminho novo, isso acontece
   * em toda sessão. O prompt do estágio era colado dentro do diálogo em vez de
   * chegar ao agente: o Enter da colagem respondia o menu, o texto se perdia, e
   * a sessão morria ou seguia sem nunca ter recebido a tarefa. Era o "sempre
   * para em alguma etapa".
   *
   * `--permission-mode` NÃO cobre isto: permissão é sobre o que a ferramenta
   * pode fazer, confiança é sobre abrir o diretório. São diálogos diferentes.
   *
   * Mesma intenção do `seedPermissionAllowlist` logo acima — tirar da frente as
   * aprovações interativas que travam execução sem ninguém olhando a tela.
   *
   * Nunca sobrescreve entrada existente: se o usuário já respondeu por aquele
   * caminho, a resposta dele vale.
   */
  private async trustDirectoryForClaude(dirPath: string): Promise<void> {
    const configPath = path.join(os.homedir(), '.claude.json');

    let config: Record<string, any> = {};
    const raw = await fsp.readFile(configPath, 'utf8').catch(() => null);
    if (raw) {
      try {
        config = JSON.parse(raw);
      } catch {
        // Arquivo corrompido é do USUÁRIO, com histórico de todos os projetos
        // dele. Reescrever por cima trocaria um diálogo de confiança por perda
        // de dados — sai sem tocar.
        this.logger.warn(`trustDirectory: ${configPath} is not valid JSON — leaving it alone`);
        return;
      }
    }

    // A chave precisa bater EXATAMENTE com a que o CLI procura, senão o
    // registro existe e o diálogo aparece do mesmo jeito. Duas normalizações:
    //
    // - caminho REAL: o CLI resolve o diretório antes de indexar, então um
    //   nome curto 8.3 (`C:\Users\MAGNOR~1\...`) ou um symlink no caminho
    //   geram uma chave que ele nunca consulta;
    // - barra normal: é assim que ele grava, inclusive no Windows.
    const real = await fsp.realpath(dirPath).catch(() => dirPath);
    const key = real.replace(/\\/g, '/');
    config.projects ??= {};
    if (config.projects[key]?.hasTrustDialogAccepted === true) return;

    config.projects[key] = {
      allowedTools: [],
      mcpContextUris: [],
      mcpServers: {},
      enabledMcpjsonServers: [],
      disabledMcpjsonServers: [],
      ...(config.projects[key] ?? {}),
      hasTrustDialogAccepted: true,
      // 1 e não 0: zero faz o CLI rodar a tela de onboarding, que é outro
      // diálogo interativo parando o boot pelo mesmo motivo.
      projectOnboardingSeenCount: 1,
    };

    // Escrita atômica: o CLI do usuário lê este arquivo o tempo todo, e um
    // truncamento no meio da gravação levaria o histórico de todos os projetos.
    const tmp = `${configPath}.orchestr-tmp`;
    await fsp.writeFile(tmp, JSON.stringify(config, null, 2));
    await fsp.rename(tmp, configPath);
    this.logger.log(`Pre-trusted ${key} for Claude Code`);
  }

  /**
   * Lista arquivos não-versionados (untracked e ignorados) do repo principal
   * restritos aos padrões de config relevantes (.mcp.json, .claude/**).
   */
  private async listUnversionedConfigFiles(mainRepoPath: string): Promise<string[]> {
    const git: SimpleGit = simpleGit(mainRepoPath);
    const pathspecs = ['--', ...WORKTREE_CONFIG_PATHSPECS];
    const [untracked, ignored] = await Promise.all([
      git.raw(['ls-files', '--others', '--exclude-standard', '-z', ...pathspecs]),
      git.raw(['ls-files', '--others', '--ignored', '--exclude-standard', '-z', ...pathspecs]),
    ]);
    const files = new Set<string>();
    for (const output of [untracked, ignored]) {
      for (const entry of output.split('\0')) {
        if (entry.trim()) files.add(entry);
      }
    }
    return [...files].sort();
  }

  /**
   * Merge aditivo em permissions.allow do settings.local.json do worktree:
   * sempre inclui as tools do orquestrador + as permissões do pipeline.
   * Nunca remove regras existentes. JSON inválido é preservado em .bak.
   */
  private async seedPermissionAllowlist(worktreePath: string, permissions: string[]): Promise<void> {
    const settingsPath = path.join(worktreePath, '.claude', 'settings.local.json');
    let settings: Record<string, any> = {};

    const raw = await fsp.readFile(settingsPath, 'utf8').catch(() => undefined);
    if (raw !== undefined) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          settings = parsed;
        } else {
          throw new Error('settings.local.json is not a JSON object');
        }
      } catch (error) {
        const bakPath = `${settingsPath}.bak`;
        this.logger.warn(
          `seedWorktreeConfig: invalid JSON in ${settingsPath} (${error.message}) — preserving as ${bakPath} and recreating`,
        );
        await fsp.writeFile(bakPath, raw, 'utf8');
        settings = {};
      }
    }

    if (!settings.permissions || typeof settings.permissions !== 'object' || Array.isArray(settings.permissions)) {
      settings.permissions = {};
    }
    const existing: string[] = Array.isArray(settings.permissions.allow)
      ? settings.permissions.allow.filter((r: unknown) => typeof r === 'string')
      : [];

    const merged = new Set<string>(existing);
    for (const rule of ORCHESTRATOR_PERMISSIONS) merged.add(rule);
    for (const rule of permissions) {
      if (typeof rule === 'string' && rule.trim()) merged.add(rule);
    }
    settings.permissions.allow = [...merged];

    // Sem --strict-mcp-config a sessão herda o .mcp.json do projeto; este flag
    // evita o prompt de aprovação dos servidores do projeto no primeiro boot.
    if (settings.enableAllProjectMcpServers === undefined) {
      settings.enableAllProjectMcpServers = true;
    }

    const normalizedHooks = this.normalizeRelativeHookPaths(settings);

    await fsp.mkdir(path.dirname(settingsPath), { recursive: true });
    await fsp.writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
    this.logger.log(
      `seedWorktreeConfig: seeded ${settings.permissions.allow.length} permission rule(s) in ${settingsPath}` +
        (normalizedHooks > 0 ? ` (${normalizedHooks} hook command(s) normalized to $CLAUDE_PROJECT_DIR)` : ''),
    );
  }

  /**
   * Hooks com caminho relativo (`bash '.claude/x.sh'`) quebram quando o hook
   * roda com cwd fora da raiz do worktree ("Arquivo ou diretório inexistente").
   * Reescreve referências a `.claude/...` nos comandos de hook para o formato
   * recomendado pelo Claude Code: "$CLAUDE_PROJECT_DIR/.claude/...".
   * Retorna quantos comandos foram alterados.
   */
  private normalizeRelativeHookPaths(settings: Record<string, any>): number {
    const hooks = settings.hooks;
    if (!hooks || typeof hooks !== 'object') return 0;

    const rewrite = (command: string): string =>
      command
        .replace(/'(\.claude\/[^']+)'/g, '"$CLAUDE_PROJECT_DIR/$1"')
        .replace(/"(\.claude\/[^"]+)"/g, '"$CLAUDE_PROJECT_DIR/$1"')
        .replace(/(^|\s)(\.claude\/\S+)/g, '$1"$CLAUDE_PROJECT_DIR/$2"');

    let changed = 0;
    for (const matchers of Object.values(hooks)) {
      if (!Array.isArray(matchers)) continue;
      for (const matcher of matchers) {
        const entries = Array.isArray(matcher?.hooks) ? matcher.hooks : [];
        for (const entry of entries) {
          if (entry?.type === 'command' && typeof entry.command === 'string') {
            const next = rewrite(entry.command);
            if (next !== entry.command) {
              entry.command = next;
              changed++;
            }
          }
        }
      }
    }
    return changed;
  }

  async removeWorktree(repoPath: string, worktreePath: string): Promise<void> {
    const git: SimpleGit = simpleGit(repoPath);
    await git.raw(['worktree', 'remove', worktreePath]);
  }

  /** Remove metadados de worktrees cujo diretório já não existe no disco. */
  async pruneWorktrees(repoPath: string): Promise<void> {
    const git: SimpleGit = simpleGit(repoPath);
    await git.raw(['worktree', 'prune']);
  }

  async listWorktrees(repoPath: string): Promise<any[]> {
    const git: SimpleGit = simpleGit(repoPath);
    const output = await git.raw(['worktree', 'list', '--porcelain']);
    return this.parseWorktreeList(output);
  }

  private parseWorktreeList(output: string): any[] {
    const worktrees = [];
    const blocks = output.trim().split('\n\n');

    for (const block of blocks) {
      const lines = block.split('\n');
      const worktree: any = {};
      for (const line of lines) {
        const [key, ...value] = line.split(' ');
        worktree[key] = value.join(' ');
      }
      worktrees.push(worktree);
    }

    return worktrees;
  }

  async commitChanges(worktreePath: string, message: string): Promise<boolean> {
    const git: SimpleGit = simpleGit(worktreePath);
    const status = await git.status();
    if (status.files.length === 0) {
      this.logger.log(`Nothing to commit in ${worktreePath}`);
      return false;
    }
    await git.add('.');
    await git.commit(message);
    return true;
  }

  async pushChanges(worktreePath: string, branchName: string): Promise<void> {
    const git: SimpleGit = simpleGit(worktreePath);
    await git.push('origin', branchName);
  }

  async hasRemote(repoPath: string): Promise<boolean> {
    const git: SimpleGit = simpleGit(repoPath);
    const remotes = await git.getRemotes();
    return remotes.some((r) => r.name === 'origin');
  }

  async getMainBranch(repoPath: string): Promise<string> {
    const git: SimpleGit = simpleGit(repoPath);
    const branches = await git.branchLocal();
    if (branches.all.includes('main')) return 'main';
    if (branches.all.includes('master')) return 'master';
    return branches.current;
  }

  // ---------------------------------------------------------------- rebase

  /**
   * Rebase da branch do worktree sobre a branch base, no próprio worktree.
   *
   * Sem isso cada branch de sessão nasce de um `main` velho e nunca reaproxima:
   * quanto mais sessões em paralelo, mais conflito no merge. O rebase **não** é
   * abortado em caso de conflito — o worktree fica com o rebase em andamento
   * para o agente da sessão resolver o próprio diff (`abortRebase` desfaz).
   */
  async rebaseOnto(
    worktreePath: string,
    baseBranch: string,
  ): Promise<{ ok: boolean; conflicts: string[] }> {
    const git = this.gitForRebase(worktreePath);
    try {
      await git.raw(['rebase', baseBranch]);
      this.logger.log(`Rebased ${worktreePath} onto ${baseBranch}`);
      return { ok: true, conflicts: [] };
    } catch (error) {
      const state = await this.rebaseState(worktreePath);
      if (!state.inProgress) {
        // Rebase que nem começou (base inexistente, worktree sujo): não há o
        // que o agente resolver, o erro precisa subir.
        throw error;
      }
      this.logger.warn(
        `Rebase of ${worktreePath} onto ${baseBranch} stopped with ${state.conflicts.length} conflict(s)`,
      );
      return { ok: false, conflicts: state.conflicts };
    }
  }

  /** Retoma um rebase depois que os conflitos foram resolvidos e adicionados ao index. */
  async continueRebase(worktreePath: string): Promise<{ ok: boolean; conflicts: string[] }> {
    const git = this.gitForRebase(worktreePath);
    try {
      await git.raw(['rebase', '--continue']);
      return { ok: true, conflicts: [] };
    } catch (error) {
      const state = await this.rebaseState(worktreePath);
      if (!state.inProgress) return { ok: true, conflicts: [] };
      return { ok: false, conflicts: state.conflicts };
    }
  }

  /** Há rebase em andamento no worktree? Quais arquivos ainda estão em conflito? */
  async rebaseState(worktreePath: string): Promise<{ inProgress: boolean; conflicts: string[] }> {
    const git: SimpleGit = simpleGit(worktreePath);
    const inProgress = (
      await Promise.all(
        ['rebase-merge', 'rebase-apply'].map(async (dir) => {
          const gitPath = (await git.raw(['rev-parse', '--git-path', dir])).trim();
          return this.pathExists(path.resolve(worktreePath, gitPath));
        }),
      )
    ).some(Boolean);

    const status = await git.status();
    return { inProgress, conflicts: status.conflicted };
  }

  /**
   * Arquivos que a branch do worktree tocou em relação à base. É o que define,
   * na prática, o que é "da sessão" — conflito fora dessa lista é diff de outra
   * task e precisa de humano.
   */
  async changedFiles(worktreePath: string, baseBranch: string): Promise<string[]> {
    const git: SimpleGit = simpleGit(worktreePath);
    const output = await git.raw(['diff', '--name-only', `${baseBranch}...HEAD`]);
    return output
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  }

  async abortRebase(worktreePath: string): Promise<void> {
    await this.gitForRebase(worktreePath)
      .raw(['rebase', '--abort'])
      .catch(() => undefined);
  }

  /**
   * `git rebase --continue` abre editor por padrão e penduraria o processo em
   * execução headless; GIT_EDITOR=true faz o git aceitar a mensagem existente.
   *
   * O simple-git tem um guard (`blockUnsafeOperationsPlugin`) que rejeita env
   * explícito contendo variáveis capazes de fazer o git executar um programa —
   * e `GIT_EDITOR` está na lista. Verificado empiricamente: com `.env()`, tanto
   * `EDITOR`/`PAGER` herdados do shell quanto o `GIT_EDITOR` que nós mesmos
   * setamos disparam "Use of X is not permitted without enabling allowUnsafeX".
   * Só passam duas formas: não chamar `.env()`, ou habilitar o guard.
   *
   * Isso derrubou TODO merge minutos depois do código entrar no main: MT-1 e MT-4
   * falharam no stage Merge, primeiro por `PAGER` (o backend roda com `PAGER=less`
   * herdado do shell), depois por `GIT_EDITOR`.
   *
   * Escolha: habilitar o guard **só neste helper** e passar um env saneado.
   * `EDITOR`/`PAGER` do shell são removidos para que nada de fora decida qual
   * programa o git abre; os valores efetivos são literais nossos — `GIT_EDITOR=true`
   * (no-op, faz `rebase --continue` aceitar a mensagem existente em vez de pendurar
   * o processo esperando editor) e `GIT_PAGER=cat` (saída não paginada).
   */
  private gitForRebase(worktreePath: string): SimpleGit {
    const {
      PAGER: _pager,
      EDITOR: _editor,
      GIT_PAGER: _gitPager,
      GIT_EDITOR: _gitEditor,
      ...env
    } = process.env;
    return simpleGit(worktreePath, {
      unsafe: { allowUnsafeEditor: true, allowUnsafePager: true },
    }).env({ ...env, GIT_EDITOR: 'true', GIT_PAGER: 'cat' });
  }

  /**
   * Merge local da branch da sessão na branch principal do repo (local-first).
   * Retorna a lista de arquivos em conflito quando o merge não é possível.
   */
  async mergeToMain(
    mainPath: string,
    branchName: string,
    opts: { squash?: boolean; message?: string; fastForward?: boolean } = {},
  ): Promise<{ merged: boolean; conflicts?: string[]; mainBranch: string }> {
    const git: SimpleGit = simpleGit(mainPath);
    const mainBranch = await this.getMainBranch(mainPath);

    // Só mudança RASTREADA barra o merge. `status().files` inclui untracked, e
    // contá-los aqui fazia 5 arquivos soltos no repo principal derrubarem o
    // merge de todas as sessões — ver git-dirty.ts.
    const dirty = await git.status();
    const trackedDirty = trackedChangedFiles(dirty);
    if (trackedDirty.length > 0) {
      throw new Error(
        `Main repository at ${mainPath} has uncommitted changes — commit or stash them before merging` +
          ` (${trackedDirty.slice(0, 10).join(', ')}${trackedDirty.length > 10 ? ', …' : ''})`,
      );
    }

    const current = (await git.branchLocal()).current;
    if (current !== mainBranch) {
      await git.checkout(mainBranch);
    }

    try {
      if (opts.squash) {
        await git.raw(['merge', '--squash', branchName]);
        await git.commit(opts.message || `Merge (squash) ${branchName}`);
      } else if (opts.fastForward) {
        // Depois do rebase a branch está à frente do main: fast-forward mantém
        // o histórico linear. Se o main andou nesse meio-tempo, cai no merge
        // commit em vez de falhar.
        await git
          .raw(['merge', '--ff-only', branchName])
          .catch(() =>
            git.raw(['merge', '--no-ff', branchName, '-m', opts.message || `Merge ${branchName}`]),
          );
      } else {
        await git.raw([
          'merge',
          '--no-ff',
          branchName,
          '-m',
          opts.message || `Merge ${branchName}`,
        ]);
      }
      this.logger.log(`Merged ${branchName} into ${mainBranch} at ${mainPath}`);
      return { merged: true, mainBranch };
    } catch (error) {
      const status = await git.status();
      const conflicts = status.conflicted;
      await git.raw(['merge', '--abort']).catch(() => undefined);
      this.logger.warn(
        `Merge of ${branchName} into ${mainBranch} failed: ${conflicts.length} conflict(s)`,
      );
      return { merged: false, conflicts, mainBranch };
    }
  }

  async createPullRequest(
    repoPath: string,
    branchName: string,
    title: string,
    description: string,
    baseBranch: string = 'main',
  ): Promise<{ prNumber: number; prUrl: string }> {
    const git: SimpleGit = simpleGit(repoPath);

    const remoteUrl = await git.getConfig('remote.origin.url');
    const repoInfo = this.parseRepoUrl(remoteUrl.value || '');

    if (!repoInfo || repoInfo.provider !== 'github') {
      throw new Error(
        'Pull requests are only supported for GitHub remotes — use local merge instead',
      );
    }
    if (!process.env.GITHUB_TOKEN) {
      throw new Error('GITHUB_TOKEN is not configured — cannot create a pull request');
    }

    await git.push('origin', branchName);

    const response = await fetch(
      `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/pulls`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title, body: description, head: branchName, base: baseBranch }),
      },
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`GitHub API error: ${error.message}`);
    }

    const pr = await response.json();
    this.logger.log(`Created PR #${pr.number}: ${pr.html_url}`);

    return { prNumber: pr.number, prUrl: pr.html_url };
  }

  async mergePullRequest(
    repoPath: string,
    prNumber: number,
    mergeMethod: 'merge' | 'squash' | 'rebase' = 'squash',
  ): Promise<void> {
    const git: SimpleGit = simpleGit(repoPath);
    const remoteUrl = await git.getConfig('remote.origin.url');
    const repoInfo = this.parseRepoUrl(remoteUrl.value || '');

    if (!repoInfo) {
      throw new Error('Could not parse repository URL');
    }

    if (repoInfo.provider === 'github') {
      const response = await fetch(
        `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/pulls/${prNumber}/merge`,
        {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ merge_method: mergeMethod }),
        },
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`GitHub API error: ${error.message}`);
      }

      this.logger.log(`Merged PR #${prNumber} with method ${mergeMethod}`);
    } else {
      this.logger.warn(`Merge not implemented for provider: ${repoInfo.provider}`);
    }
  }

  async checkConflicts(repoPath: string, branchName: string, baseBranch: string = 'main'): Promise<boolean> {
    const git: SimpleGit = simpleGit(repoPath);

    try {
      await git.raw(['merge-tree', await git.raw(['rev-parse', baseBranch]), await git.raw(['rev-parse', branchName])]);
      return false;
    } catch (error) {
      return true;
    }
  }

  async resolveConflicts(worktreePath: string, strategy: 'ours' | 'theirs' = 'ours'): Promise<void> {
    const git: SimpleGit = simpleGit(worktreePath);

    const status = await git.status();
    const conflictedFiles = status.conflicted;

    for (const file of conflictedFiles) {
      await git.raw(['checkout', `--${strategy}`, file]);
    }

    await git.add('.');
  }

  private parseRepoUrl(url: string): { provider: string; owner: string; repo: string; baseUrl?: string } | null {
    const githubMatch = url.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
    if (githubMatch) {
      return {
        provider: 'github',
        owner: githubMatch[1],
        repo: githubMatch[2],
      };
    }

    const gitlabMatch = url.match(/gitlab\.com[:/]([^/]+)\/([^/.]+)/);
    if (gitlabMatch) {
      return {
        provider: 'gitlab',
        owner: gitlabMatch[1],
        repo: gitlabMatch[2],
        baseUrl: 'https://gitlab.com',
      };
    }

    return null;
  }
}
