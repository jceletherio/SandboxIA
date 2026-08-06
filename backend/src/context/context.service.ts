import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { MasterAgentService } from '../master-agent/master-agent.service';
import { MasterRuntimeService } from '../master-agent/master-runtime.service';
import { QmdEmbedService } from './qmd-embed.service';

const execFileAsync = promisify(execFile);

/**
 * Metadados de um arquivo de contexto. NÃO carrega `content` — a listagem é leve
 * e o conteúdo vem sob demanda em `GET /context/files/:fileId/content` (P1.2).
 */
export interface ContextFile {
  id: string; // caminho relativo em base64url (evita '/' na rota)
  name: string;
  relativePath: string;
  description: string;
  status: 'updated' | 'stale';
  updatedAt: string;
  size: string;
}

/** Um hit de busca. `collection`/`line`/`score` só existem no caminho do qmd. */
export interface ContextSearchHit {
  /** Path relativo à coleção (qmd) ou à raiz do projeto (grep). */
  file: string;
  collection?: string;
  line?: number;
  score?: number;
  snippet?: string;
}

export interface ContextSearchResponse {
  /**
   * `qmd` = híbrido lex+vec. `qmd-lexical` = BM25 só, ainda o índice, quando o
   * híbrido não respondeu no tempo. `grep` = índice inacessível, varredura no
   * disco. Quem lê precisa distinguir os três: a qualidade do resultado difere.
   */
  engine: 'qmd' | 'qmd-lexical' | 'grep';
  /** Por que o híbrido não respondeu. Vem em `qmd-lexical` e em `grep`. */
  fallbackReason?: string;
  results: ContextSearchHit[];
}

const SEARCH_LIMIT = 20;
/**
 * Teto do caminho híbrido. Medido em máquina livre: 3,2 s. Sob onda paralela
 * (load 35 em 12 cores) a MESMA query variou de 12 s a 138 s — o custo dominante
 * não é a busca, é carregar o modelo de embedding num processo novo a cada
 * chamada, disputando CPU com as sessões. Daí o teto: além disso não vale segurar
 * o request, e o degradê (BM25) continua sendo o índice, não o disco.
 */
const QMD_HYBRID_TIMEOUT_MS = 45_000;
/** BM25 puro não carrega modelo nenhum: 0,2 s medidos, mesmo com a máquina cheia. */
const QMD_LEXICAL_TIMEOUT_MS = 15_000;

const MAX_FILES = 200;
const MAX_CONTENT = 100_000;
/** Bytes lidos do início do arquivo só para extrair a descrição (1ª linha). */
const HEAD_BYTES = 4_096;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.next', 'build', 'coverage']);

/**
 * Contexto REAL do projeto: lê os .md do repositório (memória permanente,
 * conforme docs/product/projeto-ideia.md) e busca via CLI `qmd` quando disponível.
 */
@Injectable()
export class ContextService {
  private readonly logger = new Logger(ContextService.name);

  constructor(
    private prisma: PrismaService,
    private masterAgent: MasterAgentService,
    private masterRuntime: MasterRuntimeService,
    private qmdEmbed: QmdEmbedService,
  ) {}

  private async resolveProject(projectId?: string) {
    const project = projectId
      ? await this.prisma.project.findUnique({ where: { id: projectId } })
      : await this.prisma.project.findFirst({ orderBy: { createdAt: 'asc' } });
    if (!project) throw new NotFoundException('No project found');
    return project;
  }

  private encodeId(relativePath: string): string {
    return Buffer.from(relativePath).toString('base64url');
  }

  private decodeId(id: string): string {
    return Buffer.from(id, 'base64url').toString('utf8');
  }

  /** Resolve um caminho relativo dentro da raiz do projeto, bloqueando traversal. */
  private safeResolve(root: string, relativePath: string): string {
    const resolved = path.resolve(root, relativePath);
    if (!resolved.startsWith(path.resolve(root) + path.sep) && resolved !== path.resolve(root)) {
      throw new BadRequestException('Path escapes project root');
    }
    return resolved;
  }

  /**
   * Valida um fileId e devolve o caminho absoluto correspondente.
   * Fonte única da validação usada por `updateFile` e `getFileContent`
   * (extensão permitida + bloqueio de path traversal).
   */
  private resolveFileId(root: string, fileId: string): { relativePath: string; absolute: string } {
    const relativePath = this.decodeId(fileId);
    if (!/\.(md|mdx|rules)$/i.test(relativePath)) {
      throw new BadRequestException('Only markdown/rules files can be edited');
    }
    return { relativePath, absolute: this.safeResolve(root, relativePath) };
  }

  /** Lê só o início do arquivo (evita carregar arquivos grandes só pela descrição). */
  private async readHead(absolute: string, bytes = HEAD_BYTES): Promise<string> {
    const handle = await fs.open(absolute, 'r');
    try {
      const buffer = Buffer.alloc(bytes);
      const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
      return buffer.subarray(0, bytesRead).toString('utf8');
    } finally {
      await handle.close();
    }
  }

  private async walkMarkdown(root: string): Promise<string[]> {
    const found: string[] = [];
    const walk = async (dir: string, depth: number) => {
      if (found.length >= MAX_FILES || depth > 6) return;
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (found.length >= MAX_FILES) break;
        if (entry.isDirectory()) {
          if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.git')) {
            await walk(path.join(dir, entry.name), depth + 1);
          }
        } else if (/\.(md|mdx|rules)$/i.test(entry.name)) {
          found.push(path.relative(root, path.join(dir, entry.name)));
        }
      }
    };
    await walk(root, 0);
    return found;
  }

  private categorize(relativePath: string): 'qmd' | 'rules' | 'context' {
    const lower = relativePath.toLowerCase();
    const base = path.basename(lower);
    if (lower.includes('qmd')) return 'qmd';
    if (
      base.endsWith('.rules') ||
      ['claude.md', 'agents.md', 'rules.md', '.cursorrules'].includes(base) ||
      lower.includes('rules/')
    ) {
      return 'rules';
    }
    return 'context';
  }

  /**
   * Listagem LEVE (P1.2): só metadados, sem `content`.
   *
   * Decisão CA3 — a busca por texto é SERVER-SIDE. Como a listagem não carrega mais o
   * conteúdo, não existe cache client-side do texto de todos os arquivos para filtrar;
   * o parâmetro `search` filtra aqui (case-insensitive, no caminho e no conteúdo em disco)
   * e devolve só os metadados dos arquivos que casam. O conteúdo de UM arquivo continua
   * vindo sob demanda em `GET /context/files/:fileId/content`.
   */
  async getFiles(projectId?: string, search?: string) {
    const project = await this.resolveProject(projectId);
    const needle = (search || '').trim().toLowerCase();
    // Distinguir "mainPath inválido" de "projeto sem docs" para a UI avisar
    let rootExists = true;
    try {
      const rootStat = await fs.stat(project.mainPath);
      rootExists = rootStat.isDirectory();
    } catch {
      rootExists = false;
    }
    const relativePaths = rootExists ? await this.walkMarkdown(project.mainPath) : [];
    const staleThreshold = Date.now() - 30 * 24 * 60 * 60 * 1000;

    const groups: Record<'qmd' | 'context' | 'rules', ContextFile[]> = {
      qmd: [],
      context: [],
      rules: [],
    };

    for (const relativePath of relativePaths) {
      const absolute = path.join(project.mainPath, relativePath);
      try {
        const stat = await fs.stat(absolute);
        if (needle) {
          const matchesPath = relativePath.toLowerCase().includes(needle);
          if (!matchesPath) {
            const content = await fs.readFile(absolute, 'utf8');
            if (!content.toLowerCase().includes(needle)) continue;
          }
        }
        const head = await this.readHead(absolute);
        const firstLine = head.split('\n').find((l) => l.trim()) || '';
        groups[this.categorize(relativePath)].push({
          id: this.encodeId(relativePath),
          name: path.basename(relativePath),
          relativePath,
          description: firstLine.replace(/^#+\s*/, '').slice(0, 120),
          status: stat.mtimeMs < staleThreshold ? 'stale' : 'updated',
          updatedAt: stat.mtime.toISOString(),
          size: `${(stat.size / 1024).toFixed(1)} KB`,
        });
      } catch (error) {
        this.logger.warn(`Skipping ${relativePath}: ${error.message}`);
      }
    }

    return { ...groups, projectId: project.id, root: project.mainPath, rootExists, search: needle || undefined };
  }

  /** Conteúdo de UM arquivo, sob demanda (P1.2). Mesma validação de path do `updateFile`. */
  async getFileContent(fileId: string, projectId?: string) {
    const project = await this.resolveProject(projectId);
    const { relativePath, absolute } = this.resolveFileId(project.mainPath, fileId);
    let raw: string;
    try {
      raw = await fs.readFile(absolute, 'utf8');
    } catch {
      throw new NotFoundException(`File not found: ${relativePath}`);
    }
    return {
      fileId,
      relativePath,
      content: raw.slice(0, MAX_CONTENT),
      truncated: raw.length > MAX_CONTENT,
    };
  }

  async updateFile(fileId: string, content: string, projectId?: string) {
    const project = await this.resolveProject(projectId);
    const { relativePath, absolute } = this.resolveFileId(project.mainPath, fileId);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, content, 'utf8');
    return { success: true, fileId, relativePath, updated: true };
  }

  /**
   * Busca no contexto: qmd (se instalado) com fallback para grep.
   *
   * O caminho do binário vem do `QmdEmbedService` (`QMD_BIN` ou PATH) — fonte
   * única, para a busca e o embed nunca discordarem sobre qual CLI existe.
   * **Nunca** reindexa: índice velho/vazio cai no grep, e o reindex é operação
   * do orquestrador (job `qmd_embed`), jamais um efeito colateral de busca.
   *
   * Duas coisas saem do caminho síncrono, e nenhuma é opcional — medido, não
   * estimado (v2.5.2, 291 docs):
   *
   * 1. **Rerank** (`--no-rerank`): 411 s contra 3,2 s, dos quais 340 s só
   *    reordenando 20 chunks.
   * 2. **Expansão de query**: `--no-rerank` NÃO a desliga. Uma pergunta em
   *    linguagem natural gastou 35 s no modelo de expansão (1,7B) e mais 4
   *    embeddings, estourando qualquer teto razoável. A gramática do CLI resolve
   *    isso: passando um *query document* tipado (`lex:`/`vec:`), o chamador
   *    fornece as sub-queries e a expansão é pulada. A mesma pergunta caiu de
   *    110 s (falhou) para 11,8 s.
   *
   * Com o timeout antigo de 30 s e as duas ligadas, 100 % das buscas expiravam
   * e caíam no grep — o índice existia e ninguém usava. O que se perde sem
   * rerank/expansão é reordenamento e sinônimos gerados por LLM; o que fica é
   * busca híbrida lex+vec com RRF, que é o ponto do índice.
   */
  async search(query: string, projectId?: string): Promise<ContextSearchResponse> {
    const project = await this.resolveProject(projectId);
    const needle = (query || '').trim();
    // Sem termo não há o que buscar: evita gastar um processo `qmd` e um
    // `grep -r` no repo inteiro para devolver lista vazia. Checa depois de tirar
    // as aspas (mesma sanitização do `buildQueryDocument`): uma busca só de `"`
    // passaria no `!needle` mas viraria um query document vazio (`lex: \nvec: `).
    if (!needle.replace(/"/g, '').trim()) return { engine: 'qmd', results: [] };

    const qmdBin = await this.qmdEmbed.getQmdBin();
    let fallbackReason = 'qmd CLI unavailable (set QMD_BIN)';

    if (qmdBin) {
      const cwd = project.mainPath;
      // O índice é global e `cwd` NÃO escopa nada — sem `-c`, a busca varre as
      // coleções de TODOS os projetos já indexados na máquina. Achado no
      // review: rodando `qmd search` a partir daqui, os hits vieram de um
      // projeto (`todo-list-*`) completamente diferente. `-c` é o que faz a
      // busca deste projeto ver só os documentos deste projeto.
      const collections = await this.qmdEmbed.projectCollections(qmdBin, project.mainPath);
      const scope = collections.flatMap((name) => ['-c', name]);

      if (collections.length === 0) {
        // Nada registrado para este projeto: rodar sem `-c` vazaria os outros
        // projetos, e registrar aqui violaria "busca nunca reindexa". Direto pro grep.
        fallbackReason = 'no qmd collection registered for this project (search never registers — that is reindex_context\'s job)';
      } else {
        try {
          return {
            engine: 'qmd',
            results: await this.runQmd(
              qmdBin,
              ['query', this.buildQueryDocument(needle), '--no-rerank', ...scope],
              cwd,
              QMD_HYBRID_TIMEOUT_MS,
            ),
          };
        } catch (error) {
          fallbackReason = `qmd hybrid query failed: ${error.message}`;
          this.logger.warn(`qmd hybrid search failed, trying lexical: ${error.message}`);
        }

        // Degradê que ainda é o índice: `qmd search` é BM25 puro, não carrega
        // modelo nenhum e responde em 0,2 s. Só depois disso o disco entra.
        try {
          return {
            engine: 'qmd-lexical',
            fallbackReason,
            results: await this.runQmd(qmdBin, ['search', needle, ...scope], cwd, QMD_LEXICAL_TIMEOUT_MS),
          };
        } catch (error) {
          fallbackReason = `${fallbackReason}; qmd search failed: ${error.message}`;
          this.logger.warn(`qmd lexical search failed, falling back to grep: ${error.message}`);
        }
      }
    }

    try {
      const { stdout } = await execFileAsync(
        'grep',
        ['-ri', '-l', '--include=*.md', needle, '.'],
        { cwd: project.mainPath, timeout: 15_000 },
      );
      const files = stdout.trim().split('\n').filter(Boolean).slice(0, SEARCH_LIMIT);
      return {
        engine: 'grep',
        fallbackReason,
        results: files.map((f) => ({ file: f.replace(/^\.\//, '') })),
      };
    } catch {
      // grep sai com 1 quando não casa nada — indistinguível de erro real, e é
      // por isso que `fallbackReason` acompanha: lista vazia no grep depois de
      // o qmd falhar não é "não existe", é "não procuramos no índice".
      return { engine: 'grep', fallbackReason, results: [] };
    }
  }

  /**
   * Monta o *query document* que faz o CLI pular a expansão: uma linha `lex:`
   * (BM25) e uma `vec:` (semântica) com o mesmo termo, combinadas por RRF.
   *
   * A gramática do qmd exige linha única com quotes balanceadas, então o termo é
   * achatado e as `"` caem. Achatar também é o que impede o usuário de injetar
   * uma linha tipada a mais (um `\n` no meio da busca viraria outra sub-query).
   */
  private buildQueryDocument(needle: string): string {
    const safe = needle.replace(/\s+/g, ' ').replace(/"/g, '').trim();
    return `lex: ${safe}\nvec: ${safe}`;
  }

  /** Roda um subcomando de leitura do qmd e normaliza os hits. */
  private async runQmd(
    bin: string,
    args: string[],
    cwd: string,
    timeout: number,
  ): Promise<ContextSearchHit[]> {
    const { stdout } = await execFileAsync(bin, [...args, '--json', '-n', String(SEARCH_LIMIT)], {
      cwd,
      timeout,
    });
    const raw = JSON.parse(stdout);
    const items: any[] = Array.isArray(raw) ? raw : raw?.results || raw?.hits || [];
    return items.slice(0, SEARCH_LIMIT).map((item) => this.toHit(item));
  }

  /**
   * Normaliza um hit do `qmd --json`. O CLI devolve `file` como URI de coleção
   * (`qmd://<colecao>/<path>`); quebrar isso em `file` + `collection` é o que
   * torna o path clicável e igual ao do fallback grep, que devolve path relativo.
   */
  private toHit(item: any): ContextSearchHit {
    const raw = item?.file || item?.path || item?.docid || String(item);
    const uri = /^qmd:\/\/([^/]+)\/(.*)$/.exec(raw);
    return {
      file: uri ? uri[2] : raw,
      collection: uri ? uri[1] : undefined,
      line: typeof item?.line === 'number' ? item.line : undefined,
      score: typeof item?.score === 'number' ? item.score : undefined,
      snippet: item?.snippet || item?.text || item?.context || undefined,
    };
  }

  /**
   * Pede ao Master Agent que escreva uma nova regra de desenvolvimento no projeto.
   *
   * NÃO gera texto aqui: despacha um prompt para o terminal interativo do Master
   * (mesmo mecanismo do chat do dashboard) e retorna na hora. Quem cria o arquivo
   * markdown em `<mainPath>/rules/` é o próprio Master, que roda um CLI de código
   * com acesso ao filesystem do projeto e confirma via MCP tool `reply_chat`.
   */
  async generateRule(
    description: string,
    projectId?: string,
  ): Promise<{ queued: boolean; message: string }> {
    const text = (description || '').trim();
    if (!text) {
      return { queued: false, message: 'Describe the rule you want before asking the Master Agent to write it.' };
    }

    const project = await this.resolveProject(projectId);
    // MT-20: já se sabe o projeto — pedir o status DELE, e não do "único Master
    // ativo, se houver um só", que com dois Masters de pé devolveria isActive:
    // false mesmo com o Master deste projeto rodando.
    const status = await this.masterAgent.getStatus(project.id);

    // Terminal do Master DESTE projeto fora do ar — com um Master por projeto
    // (MT-20), não existe mais o caso "Master vivo em outro projeto": pedir o
    // status já escopado no projeto (acima) faz `isActive` responder por ele.
    if (!status.isActive || !status.tmuxRunning) {
      return {
        queued: false,
        message:
          'The Master Agent terminal is not running. Activate the Master Agent on the dashboard — the rule is written by its interactive CLI session.',
      };
    }

    const rulesDir = path.join(project.mainPath, 'rules');

    try {
      await this.masterRuntime.sendPrompt(
        project.id,
        `[ORCHESTRATOR RULE] The user requested a new development rule from the /context page of the dashboard. WRITE it yourself as a markdown file in the project — do NOT just answer in the terminal.

Project: ${project.name} — ${project.mainPath}
Rules directory (this is what the orchestrator scans as "rules" on the /context page): ${rulesDir}

Rule requested by the user:
"""
${text}
"""

What to do:
1. Create ${rulesDir} if it does not exist yet.
2. Write the rule as ONE markdown file at ${rulesDir}/<kebab-case-name>.md. First line must be an H1 with a short title; then the rule itself — concise, imperative and actionable, expanded from the user description with the real conventions of this project (read the code/docs if you need to).
3. Do NOT touch any other file and do NOT change project code.
4. When you are done, call the MCP tool reply_chat with a one-line confirmation containing the path of the file you created.`,
      );
    } catch (error) {
      this.logger.warn(`Failed to dispatch generate-rule prompt to the Master Agent: ${error.message}`);
      return {
        queued: false,
        message: `Could not send the prompt to the Master Agent terminal: ${error.message}`,
      };
    }

    return {
      queued: true,
      message: `Sent to the Master Agent — it will write the rule under ${rulesDir} and confirm in the dashboard chat.`,
    };
  }
}
