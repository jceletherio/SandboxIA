import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { constants as fsConstants, promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Arquivos de configuração de agentes/commands dos CLIs de IA dentro do repo
 * do usuário. O orquestrador é agnóstico de CLI: cada "target" define onde o
 * respectivo CLI lê esses arquivos (1 arquivo markdown com frontmatter YAML
 * name/description + corpo — formato comum a Claude Code e OpenCode).
 *
 * A "biblioteca" (~/.orchestr/defaults/<kind>) guarda arquivos reutilizáveis
 * entre projetos e independentes de CLI: defaults sugeridos pelo orquestrador
 * + o que o usuário salvar a partir de um projeto.
 */
export type CliFileKind = 'agents' | 'commands';
export type CliFileTarget = 'claude' | 'opencode';

const TARGET_DIRS: Record<CliFileTarget, Record<CliFileKind, string>> = {
  claude: {
    agents: path.join('.claude', 'agents'),
    commands: path.join('.claude', 'commands'),
  },
  opencode: {
    agents: path.join('.opencode', 'agent'),
    commands: path.join('.opencode', 'command'),
  },
};

export const CLI_FILE_TARGETS = Object.keys(TARGET_DIRS) as CliFileTarget[];

// Skills são PASTAS (SKILL.md + scripts/templates/schemas). Nem todo CLI tem o
// conceito — só os targets mapeados aqui suportam skills.
const SKILL_TARGET_DIRS: Partial<Record<CliFileTarget, string>> = {
  claude: path.join('.claude', 'skills'),
};

// Nome de arquivo simples, sem path separators nem dotfiles — bloqueia traversal.
const FILE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/;
const DIR_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_SKILL_FILES = 300;
const MAX_SKILL_TREE_DEPTH = 5;
const SKILL_WALK_SKIP = new Set(['node_modules', '.git', '__pycache__', '.venv']);

export interface CliMdFile {
  fileName: string;
  /** name do frontmatter (fallback: nome do arquivo sem .md) */
  name: string;
  description: string | null;
  content: string;
  size: number;
  updatedAt: string;
  truncated: boolean;
}

export interface CliFileTargetListing {
  target: CliFileTarget;
  dir: string;
  exists: boolean;
  files: CliMdFile[];
}

export interface SkillFileEntry {
  path: string;
  size: number;
}

export interface CliSkill {
  dirName: string;
  /** name do frontmatter do SKILL.md (fallback: dirName) */
  name: string;
  description: string | null;
  files: SkillFileEntry[];
  fileCount: number;
  totalSize: number;
  updatedAt: string;
}

@Injectable()
export class CliFilesService {
  private readonly logger = new Logger(CliFilesService.name);

  constructor(private prisma: PrismaService) {}

  // ------------------------------------------------------------ validação

  private assertKind(kind: string): CliFileKind {
    if (kind !== 'agents' && kind !== 'commands') {
      throw new BadRequestException(`Unknown kind "${kind}" — use agents|commands`);
    }
    return kind;
  }

  private assertTarget(target: string): CliFileTarget {
    if (!CLI_FILE_TARGETS.includes(target as CliFileTarget)) {
      throw new BadRequestException(
        `Unknown target "${target}" — use ${CLI_FILE_TARGETS.join('|')}`,
      );
    }
    return target as CliFileTarget;
  }

  private assertFileName(fileName: string): string {
    if (!FILE_NAME_RE.test(fileName)) {
      throw new BadRequestException(
        'Invalid file name — use letters/numbers/._- and the .md extension',
      );
    }
    return fileName;
  }

  private assertContent(content: string): string {
    if (typeof content !== 'string' || !content.trim()) {
      throw new BadRequestException('content is required');
    }
    if (Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES) {
      throw new BadRequestException('content exceeds the 256KB limit');
    }
    return content;
  }

  private async resolveProjectRoot(projectId: string): Promise<string> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { mainPath: true },
    });
    if (!project) throw new NotFoundException('Project not found');
    const exists = await fs
      .stat(project.mainPath)
      .then((s) => s.isDirectory())
      .catch(() => false);
    if (!exists) {
      throw new BadRequestException(`Project mainPath does not exist: ${project.mainPath}`);
    }
    return project.mainPath;
  }

  private libraryDir(kind: CliFileKind): string {
    return path.join(os.homedir(), '.orchestr', 'defaults', kind);
  }

  // ----------------------------------------------------------- frontmatter

  /** Extrai name/description do frontmatter YAML (tolerante a YAML inválido). */
  private parseFrontmatter(content: string): { name?: string; description?: string } {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) return {};
    try {
      const data = yaml.load(match[1]);
      if (!data || typeof data !== 'object') return this.parseFrontmatterLoose(match[1]);
      const { name, description } = data as Record<string, unknown>;
      return {
        name: typeof name === 'string' ? name : undefined,
        description: typeof description === 'string' ? description : undefined,
      };
    } catch {
      // YAML estrito falha em frontmatters comuns na prática (ex.: description
      // com ": " no meio) que os CLIs aceitam — cai para extração por linha.
      return this.parseFrontmatterLoose(match[1]);
    }
  }

  private parseFrontmatterLoose(frontmatter: string): { name?: string; description?: string } {
    const pick = (key: string): string | undefined => {
      const m = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
      if (!m) return undefined;
      return m[1].trim().replace(/^["']|["']$/g, '') || undefined;
    };
    return { name: pick('name'), description: pick('description') };
  }

  private async readMdFile(dir: string, fileName: string): Promise<CliMdFile | null> {
    const filePath = path.join(dir, fileName);
    try {
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) return null;
      const truncated = stat.size > MAX_FILE_BYTES;
      const handle = await fs.open(filePath, 'r');
      let content: string;
      try {
        const buf = Buffer.alloc(Math.min(stat.size, MAX_FILE_BYTES));
        await handle.read(buf, 0, buf.length, 0);
        content = buf.toString('utf8');
      } finally {
        await handle.close();
      }
      const fm = this.parseFrontmatter(content);
      return {
        fileName,
        name: fm.name || fileName.replace(/\.md$/, ''),
        description: fm.description ?? null,
        content,
        size: stat.size,
        updatedAt: stat.mtime.toISOString(),
        truncated,
      };
    } catch {
      return null;
    }
  }

  private async listDir(dir: string): Promise<{ exists: boolean; files: CliMdFile[] }> {
    const entries = await fs.readdir(dir).catch(() => null);
    if (entries === null) return { exists: false, files: [] };
    const files: CliMdFile[] = [];
    for (const entry of entries.sort()) {
      if (!entry.endsWith('.md')) continue;
      const file = await this.readMdFile(dir, entry);
      if (file) files.push(file);
    }
    return { exists: true, files };
  }

  // -------------------------------------------------------- projeto (repo)

  /** Lista os arquivos do kind em TODOS os targets (o front decide o que exibir). */
  async listProjectFiles(projectId: string, kindRaw: string) {
    const kind = this.assertKind(kindRaw);
    const root = await this.resolveProjectRoot(projectId);
    const targets: CliFileTargetListing[] = [];
    for (const target of CLI_FILE_TARGETS) {
      const relDir = TARGET_DIRS[target][kind];
      const { exists, files } = await this.listDir(path.join(root, relDir));
      targets.push({ target, dir: relDir, exists, files });
    }
    return { kind, root, targets };
  }

  async writeProjectFile(
    projectId: string,
    kindRaw: string,
    targetRaw: string,
    fileNameRaw: string,
    content: string,
  ) {
    const kind = this.assertKind(kindRaw);
    const target = this.assertTarget(targetRaw);
    const fileName = this.assertFileName(fileNameRaw);
    this.assertContent(content);
    const root = await this.resolveProjectRoot(projectId);
    const dir = path.join(root, TARGET_DIRS[target][kind]);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, fileName), content, 'utf8');
    this.logger.log(`Wrote ${TARGET_DIRS[target][kind]}/${fileName} in project ${projectId}`);
    return this.readMdFile(dir, fileName);
  }

  async deleteProjectFile(
    projectId: string,
    kindRaw: string,
    targetRaw: string,
    fileNameRaw: string,
  ) {
    const kind = this.assertKind(kindRaw);
    const target = this.assertTarget(targetRaw);
    const fileName = this.assertFileName(fileNameRaw);
    const root = await this.resolveProjectRoot(projectId);
    const relDir = TARGET_DIRS[target][kind];
    try {
      await fs.unlink(path.join(root, relDir, fileName));
    } catch {
      throw new NotFoundException(`File not found: ${relDir}/${fileName}`);
    }
    return { deleted: fileName, target };
  }

  // ------------------------------------------------------------ biblioteca

  async listLibrary(kindRaw: string) {
    const kind = this.assertKind(kindRaw);
    const dir = this.libraryDir(kind);
    const { exists, files } = await this.listDir(dir);
    return { kind, dir, exists, files };
  }

  async saveToLibrary(kindRaw: string, fileNameRaw: string, content: string) {
    const kind = this.assertKind(kindRaw);
    const fileName = this.assertFileName(fileNameRaw);
    this.assertContent(content);
    const dir = this.libraryDir(kind);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, fileName), content, 'utf8');
    this.logger.log(`Saved ${fileName} to ${kind} library`);
    return this.readMdFile(dir, fileName);
  }

  async deleteFromLibrary(kindRaw: string, fileNameRaw: string) {
    const kind = this.assertKind(kindRaw);
    const fileName = this.assertFileName(fileNameRaw);
    try {
      await fs.unlink(path.join(this.libraryDir(kind), fileName));
    } catch {
      throw new NotFoundException(`Library file not found: ${fileName}`);
    }
    return { deleted: fileName };
  }

  // ------------------------------------------------------------------ skills

  private assertSkillTarget(target: string): CliFileTarget {
    const known = this.assertTarget(target);
    if (!SKILL_TARGET_DIRS[known]) {
      throw new BadRequestException(
        `Target "${known}" does not support skills — use ${Object.keys(SKILL_TARGET_DIRS).join('|')}`,
      );
    }
    return known;
  }

  private assertDirName(dirName: string): string {
    if (!DIR_NAME_RE.test(dirName)) {
      throw new BadRequestException('Invalid skill directory name — use letters/numbers/._-');
    }
    return dirName;
  }

  private skillsLibraryDir(): string {
    return path.join(os.homedir(), '.orchestr', 'defaults', 'skills');
  }

  /** Árvore de arquivos da skill (paths relativos, limitada em nº e profundidade). */
  private async walkSkillDir(root: string): Promise<SkillFileEntry[]> {
    const files: SkillFileEntry[] = [];
    const walk = async (dir: string, rel: string, depth: number) => {
      if (files.length >= MAX_SKILL_FILES || depth > MAX_SKILL_TREE_DEPTH) return;
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (files.length >= MAX_SKILL_FILES) break;
        const relPath = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          if (!SKILL_WALK_SKIP.has(entry.name)) await walk(path.join(dir, entry.name), relPath, depth + 1);
        } else if (entry.isFile()) {
          const stat = await fs.stat(path.join(dir, entry.name)).catch(() => null);
          if (stat) files.push({ path: relPath, size: stat.size });
        }
      }
    };
    await walk(root, '', 0);
    return files.sort((a, b) => a.path.localeCompare(b.path));
  }

  private async readSkillDir(parentDir: string, dirName: string): Promise<CliSkill | null> {
    const dir = path.join(parentDir, dirName);
    const stat = await fs.stat(dir).catch(() => null);
    if (!stat?.isDirectory()) return null;

    const files = await this.walkSkillDir(dir);
    // SKILL.md na raiz (padrão Claude Code); fallback: qualquer .md na raiz
    const mainMd =
      files.find((f) => f.path.toLowerCase() === 'skill.md') ||
      files.find((f) => !f.path.includes('/') && f.path.endsWith('.md'));
    let name = dirName;
    let description: string | null = null;
    if (mainMd) {
      const md = await this.readMdFile(dir, mainMd.path);
      if (md) {
        name = md.name === mainMd.path.replace(/\.md$/, '') ? dirName : md.name;
        description = md.description;
      }
    }
    return {
      dirName,
      name,
      description,
      files,
      fileCount: files.length,
      totalSize: files.reduce((sum, f) => sum + f.size, 0),
      updatedAt: stat.mtime.toISOString(),
    };
  }

  private async listSkillsIn(parentDir: string): Promise<{ exists: boolean; skills: CliSkill[] }> {
    const entries = await fs.readdir(parentDir, { withFileTypes: true }).catch(() => null);
    if (entries === null) return { exists: false, skills: [] };
    const skills: CliSkill[] = [];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory()) continue;
      const skill = await this.readSkillDir(parentDir, entry.name);
      if (skill) skills.push(skill);
    }
    return { exists: true, skills };
  }

  async listProjectSkills(projectId: string) {
    const root = await this.resolveProjectRoot(projectId);
    const targets: Array<{
      target: CliFileTarget;
      dir: string;
      exists: boolean;
      skills: CliSkill[];
    }> = [];
    for (const [target, relDir] of Object.entries(SKILL_TARGET_DIRS) as Array<
      [CliFileTarget, string]
    >) {
      const { exists, skills } = await this.listSkillsIn(path.join(root, relDir));
      targets.push({ target, dir: relDir, exists, skills });
    }
    return { root, targets };
  }

  async listLibrarySkills() {
    const dir = this.skillsLibraryDir();
    const { exists, skills } = await this.listSkillsIn(dir);
    return { dir, exists, skills };
  }

  /**
   * Resolve um path relativo DENTRO da pasta da skill. Única validação de
   * traversal usada tanto na leitura quanto na escrita: o caminho absoluto
   * resultante precisa ficar estritamente abaixo de <baseDir>/<dirName>.
   */
  private resolveSkillFilePath(baseDir: string, dirName: string, relPath: string) {
    if (typeof relPath !== 'string' || !relPath.trim()) {
      throw new BadRequestException('path is required');
    }
    if (relPath.includes('\0')) {
      throw new BadRequestException('Invalid path');
    }
    const skillDir = path.resolve(baseDir, dirName);
    const resolved = path.resolve(skillDir, relPath);
    if (!resolved.startsWith(skillDir + path.sep)) {
      throw new BadRequestException('Path escapes the skill directory');
    }
    return { skillDir, resolved };
  }

  /** Conteúdo de UM arquivo dentro de uma skill (projeto ou biblioteca). */
  private async readSkillFileFrom(baseDir: string, dirName: string, relPath: string) {
    const { skillDir, resolved } = this.resolveSkillFilePath(baseDir, dirName, relPath);
    const stat = await fs.stat(resolved).catch(() => null);
    if (!stat?.isFile()) throw new NotFoundException(`File not found: ${relPath}`);

    // Mesma defesa da escrita: o check lexical não vê symlink. Sem isto, um link
    // plantado dentro da skill (repo clonado, template) vazaria arquivo de fora
    // pelo GET .../file?path=.
    const realSkillDir = await fs.realpath(skillDir);
    const realResolved = await fs.realpath(resolved);
    if (!realResolved.startsWith(realSkillDir + path.sep)) {
      throw new BadRequestException('Path escapes the skill directory');
    }

    const truncated = stat.size > MAX_FILE_BYTES;
    const handle = await fs.open(resolved, 'r');
    try {
      const buf = Buffer.alloc(Math.min(stat.size, MAX_FILE_BYTES));
      await handle.read(buf, 0, buf.length, 0);
      return { path: relPath, size: stat.size, truncated, content: buf.toString('utf8') };
    } finally {
      await handle.close();
    }
  }

  /**
   * Sobrescreve UM arquivo já existente dentro de uma skill. Só edita o que já
   * está na pasta (não cria arquivo novo nem pasta) e nunca escreve através de
   * symlink — o arquivo é aberto com O_NOFOLLOW e o caminho real precisa
   * continuar dentro da pasta da skill.
   */
  private async writeSkillFileTo(
    baseDir: string,
    dirName: string,
    relPath: string,
    content: string,
  ) {
    const { skillDir, resolved } = this.resolveSkillFilePath(baseDir, dirName, relPath);
    this.assertContent(content);

    const lstat = await fs.lstat(resolved).catch(() => null);
    if (!lstat) throw new NotFoundException(`File not found: ${relPath}`);
    if (lstat.isSymbolicLink()) {
      throw new BadRequestException(`Refusing to write through a symlink: ${relPath}`);
    }
    if (!lstat.isFile()) throw new BadRequestException(`Not a regular file: ${relPath}`);

    // Path lexical já foi validado; realpath fecha o buraco dos symlinks em
    // QUALQUER componente do caminho (ex.: skills/foo/refs -> /etc).
    const realSkillDir = await fs.realpath(skillDir);
    const realResolved = await fs.realpath(resolved);
    if (!realResolved.startsWith(realSkillDir + path.sep)) {
      throw new BadRequestException('Path escapes the skill directory');
    }

    // O_NOFOLLOW (sem O_CREAT) → falha se o alvo virar symlink entre o check e
    // o open, e falha se o arquivo sumir. Nada de escrita fora da skill.
    let handle;
    try {
      handle = await fs.open(
        resolved,
        fsConstants.O_WRONLY | fsConstants.O_TRUNC | fsConstants.O_NOFOLLOW,
      );
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === 'ELOOP' || code === 'EMLINK') {
        throw new BadRequestException(`Refusing to write through a symlink: ${relPath}`);
      }
      if (code === 'ENOENT') throw new NotFoundException(`File not found: ${relPath}`);
      throw new BadRequestException(`Could not write ${relPath}`);
    }
    try {
      await handle.writeFile(content, 'utf8');
    } finally {
      await handle.close();
    }
    return this.readSkillFileFrom(baseDir, dirName, relPath);
  }

  async readProjectSkillFile(projectId: string, targetRaw: string, dirNameRaw: string, relPath: string) {
    const target = this.assertSkillTarget(targetRaw);
    const dirName = this.assertDirName(dirNameRaw);
    if (!relPath) throw new BadRequestException('path query param is required');
    const root = await this.resolveProjectRoot(projectId);
    return this.readSkillFileFrom(path.join(root, SKILL_TARGET_DIRS[target]!), dirName, relPath);
  }

  /** Edita UM arquivo dentro de uma skill do projeto (SKILL.md ou auxiliares). */
  async writeProjectSkillFile(
    projectId: string,
    targetRaw: string,
    dirNameRaw: string,
    relPath: string,
    content: string,
  ) {
    const target = this.assertSkillTarget(targetRaw);
    const dirName = this.assertDirName(dirNameRaw);
    if (!relPath) throw new BadRequestException('path is required');
    const root = await this.resolveProjectRoot(projectId);
    const baseDir = path.join(root, SKILL_TARGET_DIRS[target]!);
    const file = await this.writeSkillFileTo(baseDir, dirName, relPath, content);
    this.logger.log(
      `Wrote ${SKILL_TARGET_DIRS[target]}/${dirName}/${relPath} in project ${projectId}`,
    );
    return file;
  }

  async readLibrarySkillFile(dirNameRaw: string, relPath: string) {
    const dirName = this.assertDirName(dirNameRaw);
    if (!relPath) throw new BadRequestException('path query param is required');
    return this.readSkillFileFrom(this.skillsLibraryDir(), dirName, relPath);
  }

  /** Cria uma skill nova no projeto: pasta + SKILL.md. */
  async createProjectSkill(projectId: string, targetRaw: string, dirNameRaw: string, content: string) {
    const target = this.assertSkillTarget(targetRaw);
    const dirName = this.assertDirName(dirNameRaw);
    this.assertContent(content);
    const root = await this.resolveProjectRoot(projectId);
    const dir = path.join(root, SKILL_TARGET_DIRS[target]!, dirName);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'SKILL.md'), content, 'utf8');
    this.logger.log(`Created skill ${dirName} in project ${projectId} (${target})`);
    return this.readSkillDir(path.join(root, SKILL_TARGET_DIRS[target]!), dirName);
  }

  /** Copia uma skill inteira da biblioteca para o projeto. */
  async injectSkill(projectId: string, targetRaw: string, dirNameRaw: string, overwrite = false) {
    const target = this.assertSkillTarget(targetRaw);
    const dirName = this.assertDirName(dirNameRaw);
    const src = path.join(this.skillsLibraryDir(), dirName);
    const srcStat = await fs.stat(src).catch(() => null);
    if (!srcStat?.isDirectory()) {
      throw new NotFoundException(`Skill not found in library: ${dirName}`);
    }
    const root = await this.resolveProjectRoot(projectId);
    const destParent = path.join(root, SKILL_TARGET_DIRS[target]!);
    const dest = path.join(destParent, dirName);
    const destExists = await fs.stat(dest).then(() => true).catch(() => false);
    if (destExists && !overwrite) {
      throw new BadRequestException(
        `Skill "${dirName}" already exists in the project — pass overwrite to replace it`,
      );
    }
    if (destExists) await fs.rm(dest, { recursive: true, force: true });
    await fs.mkdir(destParent, { recursive: true });
    await fs.cp(src, dest, { recursive: true });
    this.logger.log(`Injected skill ${dirName} into project ${projectId} (${target})`);
    return this.readSkillDir(destParent, dirName);
  }

  /** Copia uma skill inteira do projeto para a biblioteca (reuso entre projetos). */
  async saveSkillToLibrary(projectId: string, targetRaw: string, dirNameRaw: string, overwrite = false) {
    const target = this.assertSkillTarget(targetRaw);
    const dirName = this.assertDirName(dirNameRaw);
    const root = await this.resolveProjectRoot(projectId);
    const src = path.join(root, SKILL_TARGET_DIRS[target]!, dirName);
    const srcStat = await fs.stat(src).catch(() => null);
    if (!srcStat?.isDirectory()) {
      throw new NotFoundException(`Skill not found in project: ${dirName}`);
    }
    const dest = path.join(this.skillsLibraryDir(), dirName);
    const destExists = await fs.stat(dest).then(() => true).catch(() => false);
    if (destExists && !overwrite) {
      throw new BadRequestException(
        `Skill "${dirName}" already exists in the library — pass overwrite to replace it`,
      );
    }
    if (destExists) await fs.rm(dest, { recursive: true, force: true });
    await fs.mkdir(this.skillsLibraryDir(), { recursive: true });
    await fs.cp(src, dest, { recursive: true });
    this.logger.log(`Saved skill ${dirName} to library`);
    return this.readSkillDir(this.skillsLibraryDir(), dirName);
  }

  async deleteProjectSkill(projectId: string, targetRaw: string, dirNameRaw: string) {
    const target = this.assertSkillTarget(targetRaw);
    const dirName = this.assertDirName(dirNameRaw);
    const root = await this.resolveProjectRoot(projectId);
    const dir = path.join(root, SKILL_TARGET_DIRS[target]!, dirName);
    const exists = await fs.stat(dir).then((s) => s.isDirectory()).catch(() => false);
    if (!exists) throw new NotFoundException(`Skill not found in project: ${dirName}`);
    await fs.rm(dir, { recursive: true, force: true });
    return { deleted: dirName, target };
  }

  async deleteLibrarySkill(dirNameRaw: string) {
    const dirName = this.assertDirName(dirNameRaw);
    const dir = path.join(this.skillsLibraryDir(), dirName);
    const exists = await fs.stat(dir).then((s) => s.isDirectory()).catch(() => false);
    if (!exists) throw new NotFoundException(`Skill not found in library: ${dirName}`);
    await fs.rm(dir, { recursive: true, force: true });
    return { deleted: dirName };
  }
}
