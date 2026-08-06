import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { CHANNELS } from '../redis/channels';
import { parseQmdStatus, QmdStatusSnapshot } from './qmd-status.parser';
import { isWindows, lowPriorityWrap } from '../common/host-tools';

const execFileAsync = promisify(execFile);

/** Por que o reindex foi pedido — vai no payload do job e no status da /context. */
export type EmbedReason = 'pre-wave' | 'post-wave' | 'manual';

/** Registrado em `scheduler/job-types.ts` — a escrita cobra o tipo (MT-13). */
export const QMD_EMBED_JOB_TYPE = 'qmd_embed';

export interface QmdEmbedPayload {
  projectId: string;
  reason: EmbedReason;
  /** Quantas vezes o job já foi adiado por sessão viva. */
  deferCount?: number;
  /**
   * Tentativas que FALHARAM (embed estourou). Distinto de `deferCount`, que é
   * adiamento por sessão viva e não é erro nenhum.
   */
  attempts?: number;
}

export interface QmdIndexStatus {
  /** CLI `qmd` resolvido (QMD_BIN ou PATH). Sem ele nada de busca semântica. */
  cliAvailable: boolean;
  /** O projeto tem coleção registrada no índice do qmd. */
  indexed: boolean;
  collections: string[];
  documents: number;
  vectors: number;
  /**
   * Docs indexados ainda sem embedding. `vectors > 0` com `pending` alto é
   * índice pela metade: a busca semântica responde, só não vê 80% do repo.
   */
  pending: number;
  /** Rótulo cru do `qmd status` ("6d ago") — o CLI não expõe timestamp. */
  indexUpdatedLabel: string | null;
  freshness: 'fresh' | 'stale' | 'unknown';
  lastEmbedAt: string | null;
  lastEmbedReason: EmbedReason | null;
  lastEmbedOk: boolean | null;
  lastEmbedError: string | null;
  running: { since: string; reason: EmbedReason } | null;
  queued: { jobId: string; scheduledAt: string; reason: EmbedReason } | null;
  /** > 0 é o motivo de recusa mais comum: embed não roda com sessão viva. */
  activeSessions: number;
}

export interface ReindexOutcome {
  status: 'started' | 'queued' | 'skipped';
  /** Texto honesto para o Master e para a UI — sempre diz o porquê. */
  reason: string;
  /** ISO de quando o embed deve rodar, quando `queued`. */
  willRunAfter?: string;
  jobId?: string;
  /** Só no caminho do job (`status: 'started'`), depois do processo terminar. */
  durationMs?: number;
  vectors?: number;
}

/**
 * Sessão viva o bastante para o embed atrapalhar. `paused` de propósito NÃO
 * entra: sessão parada esperando humano não consome CPU e pode ficar horas
 * assim — se contasse, o embed nunca rodaria.
 */
const ACTIVE_SESSION_STATUSES = ['running', 'waiting', 'initializing'] as const;

const LOCK_KEY = 'qmd:embed:lock';
const LAST_RUN_KEY = 'qmd:embed:last-run';
/** Generoso mas finito: embed de repositório grande em CPU passa de 10 min. */
const EMBED_TIMEOUT_MS = 30 * 60_000;
/**
 * TTL do lock maior que o timeout do processo: a liberação normal é no
 * `finally`, o TTL só existe para o caso de o backend morrer no meio e deixar
 * o lock órfão — sem ele, um restart proibiria embed para sempre.
 */
const LOCK_TTL_SECONDS = 40 * 60;
/**
 * Debounce do pós-onda: uma onda de 5 sessões termina quase junto e cada
 * `SESSION_COMPLETED` empurra o mesmo job para frente — resultado, UM embed.
 */
const POST_WAVE_DEBOUNCE_MINUTES = 2;
/** Teto de adiamentos (~16 h a 2 min) para o job não ficar pendente eterno. */
const MAX_DEFERRALS = 480;
/**
 * Tentativas de embed que podem FALHAR antes do job virar `failed`. Baixo de
 * propósito: a falha típica é permanente (coleção removida, disco cheio) e
 * retentar um processo de 30 min é caro. 3 cobre a falha transitória — máquina
 * momentaneamente sem memória durante uma onda — sem insistir no resto.
 */
const MAX_EMBED_ATTEMPTS = 3;
/** Backoff entre tentativas: 5, 10, 20 min. */
const RETRY_BACKOFF_MINUTES = 5;
/** Caps de memória do embed: é o que impede o processo de engolir a máquina. */
const EMBED_MAX_DOCS_PER_BATCH = '32';
const EMBED_MAX_BATCH_MB = '16';
/** Índice mais velho que isso conta como defasado na /context. */
const STALE_AFTER_HOURS = 24;

const CODE_MASK = '**/*.{ts,tsx,js,jsx,py,go,rs}';
const DOCS_MASK = '**/*.md';

/** Cache do `qmd status` — a /context faz poll, o CLI não precisa. */
const INDEX_CACHE_MS = 10_000;

/** O shape vem do parser: `qmd status` é a única fonte desses números. */
type QmdIndexSnapshot = QmdStatusSnapshot;

interface LastRun {
  at: string;
  reason: EmbedReason;
  ok: boolean;
  error?: string;
  durationMs?: number;
}

/**
 * Embed do qmd serializado e fora do caminho do usuário (melhorias.md #2 parte B).
 *
 * Três garantias, nesta ordem de importância:
 * 1. NUNCA roda com sessão ativa — o pedido vira job agendado, não erro.
 * 2. Um embed por máquina (lock global em Redis com TTL).
 * 3. Prioridade baixa (`nice`/`ionice`) e timeout com kill.
 *
 * **Todo** embed passa pelo `ScheduledJob` `qmd_embed`, mesmo o "agora": um
 * caminho de execução só, dono único da serialização. Por isso `requestReindex`
 * devolve `queued`, não `started` — quem devolve `started` é o job.
 */
@Injectable()
export class QmdEmbedService implements OnModuleInit {
  private readonly logger = new Logger(QmdEmbedService.name);
  private binPromise: Promise<string | null> | null = null;
  private ioniceAvailable: boolean | null = null;
  private indexCache: { at: number; snapshot: QmdIndexSnapshot } | null = null;

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  async onModuleInit() {
    // Pós-onda automático: o engine publica SESSION_COMPLETED com { sessionId }
    // e SEM projectId, então o projeto é resolvido aqui pela sessão.
    try {
      await this.redis.subscribe(CHANNELS.SESSION_COMPLETED, (message) => {
        void this.onSessionCompleted(message?.sessionId);
      });
    } catch (error) {
      this.logger.warn(`Failed to subscribe to ${CHANNELS.SESSION_COMPLETED}: ${error.message}`);
    }
  }

  // ------------------------------------------------------------------ binário

  /**
   * Caminho do CLI `qmd`. `QMD_BIN` vence para o caso de o backend subir com um
   * PATH mais pobre que o do terminal do usuário (nvm, bun). Cacheia o
   * resultado — inclusive o negativo, como o `hasQmd` do ContextService.
   */
  async getQmdBin(): Promise<string | null> {
    if (!this.binPromise) {
      this.binPromise = this.resolveQmdBin();
    }
    return this.binPromise;
  }

  private async resolveQmdBin(): Promise<string | null> {
    const candidates = [process.env.QMD_BIN, 'qmd'].filter(Boolean) as string[];
    for (const candidate of candidates) {
      try {
        await execFileAsync(candidate, ['--version'], { timeout: 5_000 });
        return candidate;
      } catch {
        // tenta o próximo
      }
    }
    return null;
  }

  // ------------------------------------------------------------------- status

  async getStatus(projectId?: string): Promise<QmdIndexStatus> {
    const project = await this.resolveProject(projectId);
    const bin = await this.getQmdBin();
    const [activeSessions, lastRun, running, queued] = await Promise.all([
      this.countActiveSessions(),
      this.readLastRun(),
      this.readLock(),
      project ? this.findPendingJob(project.id) : Promise.resolve(null),
    ]);

    const base: QmdIndexStatus = {
      cliAvailable: !!bin,
      indexed: false,
      collections: [],
      documents: 0,
      vectors: 0,
      pending: 0,
      indexUpdatedLabel: null,
      freshness: 'unknown',
      lastEmbedAt: lastRun?.at ?? null,
      lastEmbedReason: lastRun?.reason ?? null,
      lastEmbedOk: lastRun ? lastRun.ok : null,
      lastEmbedError: lastRun?.error ?? null,
      running,
      queued: queued
        ? {
            jobId: queued.id,
            scheduledAt: queued.scheduledAt.toISOString(),
            reason: this.readReason((queued.payload as any)?.reason),
          }
        : null,
      activeSessions,
    };

    if (!bin || !project) return base;

    // Sequencial de propósito: `projectCollections` chama `readIndex` de novo,
    // e rodar as duas em paralelo faria duas chamadas concorrentes ao `qmd
    // status` no primeiro request (cache ainda vazio) em vez de uma.
    const index = await this.readIndex(bin);
    const collections = await this.projectCollections(bin, project.mainPath);

    return {
      ...base,
      indexed: collections.length > 0,
      collections,
      documents: index.documents,
      vectors: index.vectors,
      pending: index.pending,
      indexUpdatedLabel: index.updatedLabel,
      freshness: this.freshnessOf(collections.length > 0, index.vectors, lastRun),
    };
  }

  /**
   * Defasado é o default honesto: sem vetores, sem embed nosso registrado, com
   * o último embed falhado ou com mais de um dia, a busca semântica não merece
   * confiança — e é justamente isso que o usuário precisa ver antes de confiar.
   */
  private freshnessOf(indexed: boolean, vectors: number, lastRun: LastRun | null): QmdIndexStatus['freshness'] {
    if (!indexed) return 'unknown';
    if (vectors === 0) return 'stale';
    if (!lastRun || !lastRun.ok) return 'stale';
    const ageHours = (Date.now() - new Date(lastRun.at).getTime()) / 3_600_000;
    return ageHours <= STALE_AFTER_HOURS ? 'fresh' : 'stale';
  }

  /**
   * `qmd status` é texto puro (não tem `--json` nesta versão) — o parse fica em
   * `qmd-status.parser.ts`, coberto por teste sobre a saída real do CLI. Aqui
   * ficam só o processo e o cache.
   *
   * Cache curto porque a /context faz poll de 5 s enquanto há embed na fila: sem
   * ele, cada aba aberta viraria um processo `qmd` a cada 5 s, o oposto do que
   * esta task existe para resolver.
   */
  /**
   * Coleções DESTE projeto que já existem no índice — nunca registra. O índice
   * é global (~/.cache/qmd): uma `qmd query`/`qmd search` sem `-c` varre TODOS
   * os projetos já indexados na máquina, não só o `cwd` do processo (`cwd` não
   * escopa nada, é só o diretório de trabalho). Quem chama `qmd` sem passar
   * `-c` com o resultado disto vaza documentos de outros projetos na busca.
   */
  async projectCollections(bin: string, mainPath: string): Promise<string[]> {
    const mine = this.collectionNames(mainPath);
    const existing = (await this.readIndex(bin)).collections;
    return mine.filter((name) => existing.includes(name));
  }

  private async readIndex(bin: string): Promise<QmdIndexSnapshot> {
    if (this.indexCache && Date.now() - this.indexCache.at < INDEX_CACHE_MS) {
      return this.indexCache.snapshot;
    }
    try {
      const { stdout } = await execFileAsync(bin, ['status'], { timeout: 20_000 });
      const snapshot = parseQmdStatus(stdout);
      this.indexCache = { at: Date.now(), snapshot };
      return snapshot;
    } catch (error) {
      this.logger.warn(`qmd status failed: ${error.message}`);
      return { collections: [], documents: 0, vectors: 0, pending: 0, updatedLabel: null };
    }
  }

  // ------------------------------------------------------------------ pedidos

  /**
   * Enfileira um reindex. Nunca roda inline: quem executa é o handler do job
   * `qmd_embed` no SchedulerService. Desde a MT-13 o tick do scheduler é
   * CONCORRENTE — a serialização do embed não vem mais dele, e sim do lock
   * global em Redis somado à guarda de sessão ativa, ambos aqui dentro.
   *
   * `queued` com sessão viva é resposta esperada, não falha — o job se adia
   * sozinho até a última sessão terminar.
   */
  async requestReindex(projectId: string | undefined, reason: EmbedReason = 'manual'): Promise<ReindexOutcome> {
    const project = await this.resolveProject(projectId);
    if (!project) {
      return { status: 'skipped', reason: 'No project found to reindex' };
    }
    if (!(await this.getQmdBin())) {
      return {
        status: 'skipped',
        reason: 'The qmd CLI is not available to the backend — install it or set QMD_BIN. Search falls back to grep meanwhile.',
      };
    }

    const activeSessions = await this.countActiveSessions();
    const delayMinutes = activeSessions > 0 ? POST_WAVE_DEBOUNCE_MINUTES : 0;
    const scheduledAt = new Date(Date.now() + delayMinutes * 60_000);
    const job = await this.upsertJob(project.id, reason, scheduledAt);

    const reasonText =
      activeSessions > 0
        ? `${activeSessions} session(s) still active (running/waiting/initializing) — the embed is queued and will only start after the last one finishes. It never competes with a live wave.`
        : 'No active session — the embed starts on the next scheduler tick (under 30s).';

    this.logger.log(`qmd embed queued for ${project.name} (${reason}): ${reasonText}`);
    return {
      status: 'queued',
      reason: reasonText,
      willRunAfter: job.scheduledAt.toISOString(),
      jobId: job.id,
    };
  }

  /**
   * Execução real, chamada SÓ pelo handler do job. Devolve `queued` quando
   * ainda há sessão viva (o handler reagenda) e `started` quando o processo
   * rodou até o fim.
   */
  async runEmbedNow(payload: QmdEmbedPayload): Promise<ReindexOutcome> {
    const project = await this.resolveProject(payload.projectId);
    if (!project) {
      return { status: 'skipped', reason: `Project ${payload.projectId} no longer exists` };
    }

    const activeSessions = await this.countActiveSessions();
    if (activeSessions > 0) {
      return {
        status: 'queued',
        reason: `${activeSessions} active session(s) — embed postponed to keep the machine usable`,
      };
    }

    const bin = await this.getQmdBin();
    if (!bin) {
      return { status: 'skipped', reason: 'qmd CLI unavailable (set QMD_BIN)' };
    }

    const token = `${process.pid}-${payload.reason}-${Date.now()}`;
    if (!(await this.acquireLock(token, payload.reason))) {
      const holder = await this.readLock();
      return {
        status: 'queued',
        reason: `Another embed is already running${holder ? ` since ${holder.since}` : ''} — one embed per machine, never two`,
      };
    }

    const startedAt = Date.now();
    try {
      const collections = await this.ensureCollections(bin, project.mainPath);
      if (collections.length === 0) {
        // Sem coleção deste projeto, um `qmd embed` sem `-c` reindexaria as
        // coleções dos OUTROS projetos da máquina: todo o custo, zero benefício.
        // Melhor não rodar e dizer o porquê.
        return {
          status: 'skipped',
          reason: `No qmd collection registered for ${project.name}. Nothing to embed — an unscoped embed would reindex other projects instead. Register ${this.collectionNames(project.mainPath).join(' / ')} (or unset QMD_AUTO_REGISTER_COLLECTIONS=false).`,
        };
      }
      // `update` só re-indexa arquivos (barato); o peso está no `embed`, e é
      // ele que escopamos por coleção para não reindexar outros projetos.
      await this.runQmd(bin, ['update'], project.mainPath);
      const embedArgs = ['embed', '--max-docs-per-batch', EMBED_MAX_DOCS_PER_BATCH, '--max-batch-mb', EMBED_MAX_BATCH_MB];
      for (const name of collections) embedArgs.push('-c', name);
      await this.runQmd(bin, embedArgs, project.mainPath);

      const durationMs = Date.now() - startedAt;
      this.indexCache = null; // acabou de reindexar: o número de vetores mudou
      const index = await this.readIndex(bin);
      await this.writeLastRun({ at: new Date().toISOString(), reason: payload.reason, ok: true, durationMs });
      this.logger.log(
        `qmd embed done for ${project.name} (${payload.reason}) in ${Math.round(durationMs / 1000)}s — ${index.vectors} vectors`,
      );
      return {
        status: 'started',
        reason: `Embed finished in ${Math.round(durationMs / 1000)}s over [${collections.join(', ') || 'all collections'}]`,
        durationMs,
        vectors: index.vectors,
      };
    } catch (error) {
      await this.writeLastRun({
        at: new Date().toISOString(),
        reason: payload.reason,
        ok: false,
        error: error.message,
        durationMs: Date.now() - startedAt,
      });
      throw error;
    } finally {
      await this.releaseLock(token);
    }
  }

  // -------------------------------------------------------------------- fila

  /**
   * Um job pendente por projeto. Quando já existe, o `scheduledAt` é EMPURRADO
   * para frente — é o debounce: 5 sessões terminando junto adiam o mesmo job em
   * vez de criarem 5 embeds.
   */
  private async upsertJob(projectId: string, reason: EmbedReason, scheduledAt: Date) {
    const existing = await this.findPendingJob(projectId);
    if (existing) {
      const payload = (existing.payload as any) ?? {};
      return this.prisma.scheduledJob.update({
        where: { id: existing.id },
        data: {
          scheduledAt,
          payload: { ...payload, projectId, reason },
          // Reafirma a coluna: job criado antes da migration pode ter chegado
          // aqui com `project_id` nulo, e é a coluna que o debounce consulta.
          projectId,
        },
      });
    }
    return this.prisma.scheduledJob.create({
      data: {
        type: QMD_EMBED_JOB_TYPE,
        payload: { projectId, reason } satisfies QmdEmbedPayload,
        projectId,
        scheduledAt,
        notes: `qmd embed (${reason})`,
      },
    });
  }

  /**
   * O escopo de projeto é COLUNA indexada desde a MT-13, então o filtro vai no
   * `where`. Antes era `take: 20` + `.filter` do payload em memória: com mais de
   * 20 jobs pendentes de outros projetos, o job deste projeto caía fora da página
   * e o `upsertJob` criava um SEGUNDO embed em vez de fazer o debounce.
   */
  private async findPendingJob(projectId: string) {
    return this.prisma.scheduledJob.findFirst({
      where: { type: QMD_EMBED_JOB_TYPE, status: 'pending', projectId },
      orderBy: { scheduledAt: 'asc' },
    });
  }

  /** Adiamento por sessão viva. Estoura o teto → o caller marca o job 'failed'. */
  nextDeferral(payload: QmdEmbedPayload): { scheduledAt: Date; payload: QmdEmbedPayload } {
    const deferCount = (payload.deferCount ?? 0) + 1;
    if (deferCount > MAX_DEFERRALS) {
      throw new Error(`qmd_embed postponed ${MAX_DEFERRALS} times in a row — sessions never went idle`);
    }
    return {
      scheduledAt: new Date(Date.now() + POST_WAVE_DEBOUNCE_MINUTES * 60_000),
      payload: { ...payload, deferCount },
    };
  }

  /**
   * Retentativa depois de um embed que FALHOU (MT-13). `null` = teto atingido,
   * aí o caller deixa o erro subir e o job vira `failed` com o motivo real.
   *
   * Existe porque, sem retry, uma falha transitória no fim da onda deixava o
   * índice defasado até alguém clicar em Reindex na /context — e ninguém olha.
   * `deferCount` é zerado: adiamento por sessão viva e falha de execução são
   * contadores independentes, e o job vai voltar a disputar a fila do zero.
   */
  nextRetry(
    payload: QmdEmbedPayload,
    error: string,
  ): { scheduledAt: Date; payload: QmdEmbedPayload } | null {
    const attempts = (payload.attempts ?? 0) + 1;
    if (attempts >= MAX_EMBED_ATTEMPTS) return null;

    const backoffMinutes = RETRY_BACKOFF_MINUTES * 2 ** (attempts - 1);
    this.logger.warn(
      `qmd embed failed (attempt ${attempts}/${MAX_EMBED_ATTEMPTS}): ${error} — retrying in ${backoffMinutes} min`,
    );
    return {
      scheduledAt: new Date(Date.now() + backoffMinutes * 60_000),
      payload: { ...payload, attempts, deferCount: 0 },
    };
  }

  /**
   * Fim de sessão: agenda/empurra o embed pós-onda. Só agenda se a sessão que
   * terminou pertence a um projeto conhecido — e mesmo com outras sessões
   * vivas, porque o job se adia sozinho até todas terminarem.
   */
  private async onSessionCompleted(sessionId?: string): Promise<void> {
    if (!sessionId) return;
    try {
      const session = await this.prisma.session.findUnique({
        where: { id: sessionId },
        select: { macroTask: { select: { projectId: true } } },
      });
      const projectId = session?.macroTask?.projectId;
      if (!projectId) return;
      const scheduledAt = new Date(Date.now() + POST_WAVE_DEBOUNCE_MINUTES * 60_000);
      await this.upsertJob(projectId, 'post-wave', scheduledAt);
    } catch (error) {
      this.logger.warn(`Failed to schedule post-wave embed for session ${sessionId}: ${error.message}`);
    }
  }

  // -------------------------------------------------------------------- lock

  private async acquireLock(token: string, reason: EmbedReason): Promise<boolean> {
    const value = JSON.stringify({ token, since: new Date().toISOString(), reason });
    const result = await this.redis.getClient().set(LOCK_KEY, value, 'EX', LOCK_TTL_SECONDS, 'NX');
    return result === 'OK';
  }

  /** Só libera o próprio lock: um TTL vencido pode já ter dado a vez a outro. */
  private async releaseLock(token: string): Promise<void> {
    try {
      const raw = await this.redis.getClient().get(LOCK_KEY);
      if (raw && JSON.parse(raw)?.token === token) {
        await this.redis.getClient().del(LOCK_KEY);
      }
    } catch (error) {
      this.logger.warn(`Failed to release qmd embed lock: ${error.message}`);
    }
  }

  private async readLock(): Promise<{ since: string; reason: EmbedReason } | null> {
    try {
      const raw = await this.redis.getClient().get(LOCK_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return { since: parsed.since, reason: parsed.reason };
    } catch {
      return null;
    }
  }

  private async writeLastRun(run: LastRun): Promise<void> {
    try {
      await this.redis.getClient().set(LAST_RUN_KEY, JSON.stringify(run));
    } catch (error) {
      this.logger.warn(`Failed to record last qmd embed: ${error.message}`);
    }
  }

  /**
   * Último embed. Redis é o caminho quente, mas o Redis daqui pode ser efêmero:
   * sem o fallback no banco, um restart faria a /context esquecer que o embed
   * rodou e reportar "índice defasado" para um índice fresco.
   */
  private async readLastRun(): Promise<LastRun | null> {
    try {
      const raw = await this.redis.getClient().get(LAST_RUN_KEY);
      if (raw) return JSON.parse(raw) as LastRun;
    } catch {
      // cai no banco
    }
    return this.readLastRunFromJobs();
  }

  /** Reconstrói o último embed a partir do job — `executedAt` + `result` são duráveis. */
  private async readLastRunFromJobs(): Promise<LastRun | null> {
    try {
      const jobs = await this.prisma.scheduledJob.findMany({
        where: { type: QMD_EMBED_JOB_TYPE, status: { in: ['completed', 'failed'] } },
        orderBy: { executedAt: 'desc' },
        take: 10,
      });
      for (const job of jobs) {
        if (!job.executedAt) continue;
        const result = (job.result as any) || {};
        // Só `started` significa que o processo rodou de fato: um job concluído
        // com `skipped` (CLI ausente, projeto sumido) não é um embed.
        if (job.status === 'completed' && result.status !== 'started') continue;
        return {
          at: job.executedAt.toISOString(),
          reason: this.readReason((job.payload as any)?.reason),
          ok: job.status === 'completed',
          error: job.status === 'failed' ? result.error : undefined,
          durationMs: result.durationMs,
        };
      }
      return null;
    } catch (error) {
      this.logger.warn(`Failed to read last qmd embed from jobs: ${error.message}`);
      return null;
    }
  }

  /** Payload cru (job criado à mão na /scheduler) não deve virar `reason: undefined`. */
  readReason(value: unknown): EmbedReason {
    return value === 'pre-wave' || value === 'post-wave' || value === 'manual' ? value : 'manual';
  }

  // ---------------------------------------------------------------- processo

  /**
   * Roda o qmd com prioridade baixa. `nice -n 19` sempre; `ionice -c3` quando o
   * binário existir — é o I/O do embed que trava mais a máquina que a CPU.
   * Timeout finito com SIGTERM e, se ignorar, SIGKILL.
   */
  private async runQmd(bin: string, args: string[], cwd: string): Promise<void> {
    const command = await this.lowPriorityCommand(bin, args);
    await new Promise<void>((resolve, reject) => {
      const child = spawn(command.file, command.args, { cwd, env: process.env });
      let stderr = '';
      let timedOut = false;
      let exited = false;
      let sigkill: NodeJS.Timeout | undefined;

      const timer = setTimeout(() => {
        timedOut = true;
        this.logger.warn(`qmd ${args[0]} exceeded ${EMBED_TIMEOUT_MS / 60_000}min — killing it`);
        child.kill('SIGTERM');
        // NÃO dá para checar `child.killed` aqui: ele só registra que um sinal
        // FOI ENVIADO, não que o processo morreu — usá-lo cancelaria o SIGKILL
        // justamente no caso que ele existe para cobrir (qmd ignorando SIGTERM).
        sigkill = setTimeout(() => {
          if (!exited) {
            this.logger.warn(`qmd ${args[0]} ignored SIGTERM — sending SIGKILL`);
            child.kill('SIGKILL');
          }
        }, 10_000);
      }, EMBED_TIMEOUT_MS);

      const done = () => {
        exited = true;
        clearTimeout(timer);
        if (sigkill) clearTimeout(sigkill);
      };

      child.stderr?.on('data', (chunk) => {
        stderr = (stderr + chunk.toString()).slice(-2_000);
      });
      child.on('error', (error) => {
        done();
        reject(error);
      });
      child.on('close', (code) => {
        done();
        if (timedOut) return reject(new Error(`qmd ${args[0]} timed out after ${EMBED_TIMEOUT_MS / 60_000}min`));
        if (code === 0) return resolve();
        reject(new Error(`qmd ${args[0]} exited with ${code}: ${stderr.trim().slice(-500)}`));
      });
    });
  }

  private async lowPriorityCommand(bin: string, args: string[]): Promise<{ file: string; args: string[] }> {
    if (isWindows) return { file: bin, args };
    if (this.ioniceAvailable === null) {
      this.ioniceAvailable = await execFileAsync('ionice', ['-V'], { timeout: 3_000 })
        .then(() => true)
        .catch(() => false);
    }
    return lowPriorityWrap(bin, args, this.ioniceAvailable);
  }

  // ------------------------------------------------------------------- apoio

  /**
   * Coleções deste projeto no índice do qmd. O índice é GLOBAL
   * (`~/.config/qmd`), não local por projeto — por isso o embed é escopado por
   * `-c` e o lock é da máquina inteira, não por projeto.
   *
   * Registrar as coleções na primeira vez é o que faz o RAG do projeto existir;
   * `QMD_AUTO_REGISTER_COLLECTIONS=false` desliga (o embed passa a rodar sem
   * escopo de coleção, sobre o que já estiver no índice).
   */
  private async ensureCollections(bin: string, mainPath: string): Promise<string[]> {
    const wanted = this.collectionNames(mainPath);
    const existing = (await this.readIndex(bin)).collections;
    const missing = wanted.filter((name) => !existing.includes(name));
    if (missing.length === 0) return wanted;
    if (process.env.QMD_AUTO_REGISTER_COLLECTIONS === 'false') {
      return wanted.filter((name) => existing.includes(name));
    }

    for (const name of missing) {
      const mask = name.endsWith('-docs') ? DOCS_MASK : CODE_MASK;
      try {
        await execFileAsync(bin, ['collection', 'add', mainPath, '--name', name, '--mask', mask], {
          cwd: mainPath,
          timeout: 30_000,
        });
        this.logger.log(`Registered qmd collection ${name} -> ${mainPath}`);
      } catch (error) {
        this.logger.warn(`Failed to register qmd collection ${name}: ${error.message}`);
      }
    }
    // O índice mudou: o cache de 10 s esconderia as coleções recém-criadas e o
    // embed rodaria sem escopo `-c`.
    this.indexCache = null;
    return (await this.readIndex(bin)).collections.filter((name) => wanted.includes(name));
  }

  /** `<slug>-docs` / `<slug>-code`, a mesma convenção do `rag-conventions.md`. */
  private collectionNames(mainPath: string): string[] {
    const slug = path
      .basename(mainPath)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    return [`${slug}-docs`, `${slug}-code`];
  }

  private async resolveProject(projectId?: string) {
    return projectId
      ? this.prisma.project.findUnique({ where: { id: projectId } })
      : this.prisma.project.findFirst({ orderBy: { createdAt: 'asc' } });
  }

  private countActiveSessions(): Promise<number> {
    return this.prisma.session.count({ where: { status: { in: [...ACTIVE_SESSION_STATUSES] } } });
  }
}
