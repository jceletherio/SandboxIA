import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { promises as fs } from 'fs';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';

const execFileAsync = promisify(execFile);

/** Diretórios que nunca entram na listagem (mesma lista do `/context`). */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  '.next',
  'build',
  'coverage',
  '.turbo',
  '.venv',
  '__pycache__',
]);

/** Teto de arquivos que o walk manual visita antes de desistir. */
const WALK_MAX_ENTRIES = 20_000;
const WALK_MAX_DEPTH = 12;
/** Resultados devolvidos por chamada. */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export interface ProjectFileEntry {
  /** Caminho relativo à raiz do projeto — é o que vai para o prompt. */
  path: string;
  /** Nome do arquivo, para a UI destacar. */
  name: string;
  /** Diretório relativo (vazio na raiz). */
  dir: string;
}

export interface ProjectFilesResult {
  projectId: string;
  root: string;
  rootExists: boolean;
  /** `git` = veio de `git ls-files` (respeita .gitignore); `walk` = varredura manual. */
  source: 'git' | 'walk' | 'none';
  /** Quantos casaram com a busca antes do corte por `limit`. */
  total: number;
  truncated: boolean;
  files: ProjectFileEntry[];
  query?: string;
}

/**
 * Lista os arquivos REAIS do repositório de um projeto, para referência por
 * `@arquivo` no chat.
 *
 * Diferente de `ContextService.getFiles()`, que só enxerga `.md/.mdx/.rules`:
 * aqui vem o código todo.
 *
 * Fonte preferida é `git ls-files`, que já respeita o `.gitignore` do projeto e
 * é ordens de grandeza mais rápido que varrer o disco. Projeto sem git (ou com
 * git quebrado) cai num walk manual com lista de diretórios ignorados.
 *
 * SEGURANÇA: o git roda com `execFile` e ARRAY de argumentos, nunca com
 * `shell: true` — `mainPath` vem do banco e não pode virar comando. Nada aqui
 * lê conteúdo de arquivo: só nomes.
 */
@Injectable()
export class ProjectFilesService {
  private readonly logger = new Logger(ProjectFilesService.name);

  constructor(private prisma: PrismaService) {}

  async listFiles(
    projectId: string,
    options: { query?: string; limit?: number } = {},
  ): Promise<ProjectFilesResult> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project not found');

    const root = project.mainPath;
    const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const query = options.query?.trim() ?? '';

    const rootExists = await fs
      .stat(root)
      .then((s) => s.isDirectory())
      .catch(() => false);

    if (!rootExists) {
      return {
        projectId,
        root,
        rootExists: false,
        source: 'none',
        total: 0,
        truncated: false,
        files: [],
        query: query || undefined,
      };
    }

    let paths = await this.listWithGit(root);
    let source: ProjectFilesResult['source'] = 'git';
    if (paths === null) {
      paths = await this.walk(root);
      source = 'walk';
    }

    const matched = this.rank(paths, query);

    return {
      projectId,
      root,
      rootExists: true,
      source,
      total: matched.length,
      truncated: matched.length > limit,
      files: matched.slice(0, limit).map((relativePath) => ({
        path: relativePath,
        name: path.basename(relativePath),
        dir: path.dirname(relativePath) === '.' ? '' : path.dirname(relativePath),
      })),
      query: query || undefined,
    };
  }

  /**
   * `git ls-files` com rastreados + não rastreados que o .gitignore não exclui.
   * Devolve `null` quando não há git utilizável, sinalizando fallback.
   */
  private async listWithGit(root: string): Promise<string[] | null> {
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
        { cwd: root, timeout: 15_000, maxBuffer: 32 * 1024 * 1024 },
      );
      // -z separa por NUL: caminho com espaço ou acento não quebra nem vem escapado.
      const files = stdout.split('\0').filter(Boolean);
      // `git ls-files` já ignora node_modules via .gitignore na maioria dos
      // repos, mas não em todos — a lista dura vale para os dois caminhos.
      return files.filter((file) => !this.isSkipped(file));
    } catch (error: any) {
      this.logger.debug(`git ls-files falhou em ${root}, usando walk: ${error.message}`);
      return null;
    }
  }

  private isSkipped(relativePath: string): boolean {
    return relativePath.split('/').some((segment) => SKIP_DIRS.has(segment));
  }

  private async walk(root: string): Promise<string[]> {
    const found: string[] = [];
    let visited = 0;

    const step = async (dir: string, depth: number) => {
      if (visited >= WALK_MAX_ENTRIES || depth > WALK_MAX_DEPTH) return;
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (visited >= WALK_MAX_ENTRIES) break;
        visited++;
        if (entry.isDirectory()) {
          if (SKIP_DIRS.has(entry.name)) continue;
          await step(path.join(dir, entry.name), depth + 1);
        } else if (entry.isFile()) {
          found.push(path.relative(root, path.join(dir, entry.name)));
        }
      }
    };

    await step(root, 0);
    return found;
  }

  /**
   * Ordena por relevância para o autocomplete: quem começa com o termo no NOME
   * do arquivo vem antes de quem só o tem no meio do caminho. Sem termo, ordem
   * alfabética — previsível para quem só abriu a lista.
   */
  private rank(paths: string[], query: string): string[] {
    if (!query) return [...paths].sort((a, b) => a.localeCompare(b));

    const needle = query.toLowerCase();
    const scored: Array<{ relativePath: string; score: number }> = [];

    for (const relativePath of paths) {
      const lower = relativePath.toLowerCase();
      const base = path.basename(lower);
      let score: number;
      if (base.startsWith(needle)) score = 0;
      else if (base.includes(needle)) score = 1;
      else if (lower.includes(needle)) score = 2;
      else continue;
      scored.push({ relativePath, score });
    }

    return scored
      .sort(
        (a, b) =>
          a.score - b.score ||
          a.relativePath.length - b.relativePath.length ||
          a.relativePath.localeCompare(b.relativePath),
      )
      .map((entry) => entry.relativePath);
  }
}
