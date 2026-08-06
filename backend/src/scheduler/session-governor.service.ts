import { Inject, Injectable, Logger, OnModuleInit, forwardRef } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma, SessionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { CHANNELS } from '../redis/channels';
import {
  GOVERNOR_RESERVATION_PATTERN,
  GOVERNOR_RESERVE_LOCK_KEY,
  governorReservationKey,
} from '../redis/keys';
import { LockTimeoutError, withRedisLock } from '../redis/redis-lock';
import { PipelineEngineService } from '../pipeline-engine/pipeline-engine.service';
import { SessionRuntimeOverride } from '../session-runtime/session-runtime.service';
import { checkResourcePressure, sampleResources, ResourceThresholds } from './resource-guard';

/**
 * TTL da reserva em voo (MT-20, item 5). Cobre a janela entre o `evaluate` dizer
 * "pode subir" e a `Session` existir no banco (checks de tmux/CLI binary +
 * `session.create`, tudo em `pipeline-engine.service.ts`) — não precisa de
 * liberação explícita porque, quando a `Session` é criada, o `count()` real já
 * reflete o slot ocupado; a chave só existe para cobrir o intervalo até lá.
 */
const RESERVATION_TTL_MS = 15_000;

/** Sessão ainda pode estar viva no tmux — mesmo conjunto usado no resto do backend (sessions.service.ts, pipeline-engine.service.ts). */
const ACTIVE_SESSION_STATUSES: SessionStatus[] = ['running', 'waiting', 'initializing'];

/** Sessão que ainda não terminou — inclui `paused`, que ocupa a macro task sem ocupar slot. */
const LIVE_SESSION_STATUSES: SessionStatus[] = [...ACTIVE_SESSION_STATUSES, 'paused'];

/** Motivo de uma macro task não subir agora — mesmo vocabulário exposto na UI/logs. */
export type QueueReason = 'global' | 'project' | 'resource';

/** Retorno de `startPipeline` quando a macro task foi enfileirada em vez de subir. Não é uma Session — nenhum worktree/tmux foi criado. */
export interface QueuedStart {
  queued: true;
  position: number;
  reason: QueueReason;
  detail: string;
}

interface QueueableMacroTask {
  id: string;
  projectId: string;
  metadata: unknown;
}

interface QueueableProject {
  settings: unknown;
  maxSessions: number;
}

interface GovernorDecision {
  ok: boolean;
  reason?: QueueReason;
  detail?: string;
}

/** Entrada de fila gravada em `MacroTask.metadata.queue`. */
interface QueueEntry {
  reason: QueueReason;
  detail: string;
  queuedAt: string;
  agentId: string;
  runtimeOverride: SessionRuntimeOverride | null;
  /**
   * Promoções que ESTOURARAM (exceção no `startPipeline`). Não conta a espera
   * por slot: ficar na fila sem recurso é o funcionamento normal e não deve
   * consumir tentativa nenhuma.
   */
  attempts?: number;
  /** Mensagem da última promoção que estourou — é o que a UI mostra. */
  lastError?: string;
}

/** Macro task na fila, já com a entrada de `metadata.queue` extraída. */
interface QueuedMacroTask {
  id: string;
  title: string;
  projectId: string;
  entry: QueueEntry;
}

/**
 * Teto de uma varredura da fila. Não é um limite de fila: é quanto uma passada
 * lê do banco de uma vez, para a leitura não crescer junto com o backlog (a
 * MT-7 cria uma macro task por finding). Quem sobrar entra na passada
 * seguinte, e o poll de 30s garante que existe uma.
 */
const QUEUE_SCAN_LIMIT = 200;

/**
 * Tira a marca de fila (`metadata.queue`) de um metadata de macro task, sem
 * mutar a entrada. Devolve `wasQueued: false` quando não havia nada a limpar —
 * quem chama usa isso para não gastar um UPDATE à toa.
 *
 * Exportada como função PURA de propósito: quem sai de enfileirado não é só o
 * `reserveOrQueue` daqui, é também o `update_macro_task` do Master. Injetar o
 * `SessionGovernorService` no `McpServerService` fecharia um ciclo de módulos
 * (McpServer → Scheduler → SessionRuntime → McpServer), e a limpeza não precisa
 * de nada do governor além do formato do metadata.
 */
export function stripQueueMarker(metadata: unknown): {
  metadata: Record<string, any>;
  wasQueued: boolean;
} {
  const current =
    metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? (metadata as Record<string, any>)
      : {};
  if (!current.queue) return { metadata: current, wasQueued: false };
  const { queue: _queue, ...rest } = current;
  return { metadata: rest, wasQueued: true };
}

/**
 * Defaults se `GovernorSettings` não tiver linha (banco novo antes do
 * primeiro deploy) ou a leitura falhar. Um governor que trava sessão nenhuma
 * por falta de config é pior que um governor sem config nenhuma — por isso
 * a leitura nunca lança, só cai aqui com um `warn`.
 */
/**
 * Promoções que podem estourar antes da task ser dada por perdida. 5 porque a
 * falha transitória plausível aqui (tmux ainda subindo, disco momentaneamente
 * cheio) se resolve em um ou dois eventos; acima disso é falha permanente e
 * insistir a cada 30s só esconde o problema do humano.
 */
const MAX_PROMOTION_ATTEMPTS = 5;

const FALLBACK_THRESHOLDS: ResourceThresholds & { globalMaxSessions: number } = {
  globalMaxSessions: 4,
  cpuLoadThreshold: 1.5,
  minFreeMemMb: 1024,
};

/**
 * Governor de recursos (MT-10): teto GLOBAL de sessões simultâneas (soma de
 * todos os projetos) + guarda de CPU/memória, complementando o teto
 * per-projeto que já existia. Quem não tem slot agora não vira erro — fica
 * marcado em `MacroTask.metadata.queue` (status continua `pending`) e é
 * promovido automaticamente quando um slot libera.
 *
 * Não cria nenhum estado de sessão para quem está na fila — só a task real
 * (`startPipeline`) cria Session, worktree e tmux. Enfileirar sem isso evitaria
 * a sessão "zumbi" (nasce em `initializing` e nunca tem CLI) que apareceu na
 * Onda 2 quando o retorno de `start_macro_task` mentia sobre ter subido.
 */
@Injectable()
export class SessionGovernorService implements OnModuleInit {
  private readonly logger = new Logger(SessionGovernorService.name);
  /** Evita duas varreduras de promoção rodando ao mesmo tempo (evento + poll caindo juntos). */
  private promoting = false;
  /** Mesmo motivo, para o auto-start: dois ticks sobrepostos subiriam a mesma task duas vezes. */
  private autoStarting = false;

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    // forwardRef: startPipeline chama reserveOrQueue e a promoção da fila
    // chama startPipeline de volta — mesmo padrão do ciclo session-runtime
    // <-> pipeline-engine (ver session-runtime.module.ts).
    @Inject(forwardRef(() => PipelineEngineService))
    private pipelineEngine: PipelineEngineService,
  ) {}

  async onModuleInit() {
    // SESSION_COMPLETED só cobre o fim "feliz" do pipeline; failed/stopped/
    // timeout também liberam slot e saem em SESSION_STATUS — assinamos os dois
    // para não deixar a fila parada esperando um sinal que não vem.
    await this.redis.subscribe(CHANNELS.SESSION_COMPLETED, () => {
      void this.promoteQueue().catch((error) =>
        this.logger.error(`Falha ao promover fila após session:completed: ${error.message}`),
      );
    });
    await this.redis.subscribe(CHANNELS.SESSION_STATUS, (event: { status?: string }) => {
      if (!['completed', 'failed', 'stopped', 'timeout'].includes(event?.status || '')) return;
      void this.promoteQueue().catch((error) =>
        this.logger.error(`Falha ao promover fila após session:status(${event.status}): ${error.message}`),
      );
    });
    await this.redis.subscribe(
      CHANNELS.MASTER_AUTOSTART,
      (event: { projectId?: string; max?: number }) => {
        if (!event?.projectId) return;
        void this.autoStartPending(event.projectId, event.max ?? 1).catch((error) =>
          this.logger.error(`Falha no auto-start pedido pelo tick do Master: ${error.message}`),
        );
      },
    );
    this.logger.log(
      'Session governor assinado em session:completed, session:status e master:autostart',
    );
  }

  /**
   * Fallback do poll periódico: pressão de recurso some sozinha com o tempo
   * (sem nenhum SESSION_COMPLETED por trás), e um evento perdido (reconexão do
   * Redis, restart do backend) não pode deixar a fila parada para sempre.
   */
  @Cron(CronExpression.EVERY_30_SECONDS)
  async pollQueue() {
    await this.promoteQueue().catch((error) =>
      this.logger.error(`Falha no poll periódico da fila: ${error.message}`),
    );
  }

  /**
   * Ponto único chamado por `startPipeline` (pipeline-engine.service.ts).
   * Devolve `null` = pode subir agora (segue o fluxo normal de criar Session).
   * Devolve `QueuedStart` = sem slot agora; a macro task foi marcada em fila
   * e `startPipeline` deve devolver isso no lugar de uma Session.
   *
   * MT-20 (item 5): `evaluate` + a reserva do slot rodam sob `withRedisLock` —
   * sem isso, dois `startPipeline` verdadeiramente simultâneos podem ler o
   * MESMO `count()` (nenhum dos dois ainda criou a `Session`) e os dois
   * passarem, estourando o teto global. A reserva em voo (`governorReservationKey`)
   * é o que faz o SEGUNDO `evaluate` dentro da janela do lock enxergar o
   * primeiro mesmo sem lock nenhum protegendo os dois ao mesmo tempo (o lock
   * só serializa, não estende — quem cria a `Session` de fato é
   * `pipeline-engine.service.ts`, depois que este método já devolveu).
   */
  async reserveOrQueue(
    macroTask: QueueableMacroTask,
    project: QueueableProject,
    agentId: string,
    runtimeOverride?: SessionRuntimeOverride,
  ): Promise<QueuedStart | null> {
    let decision: GovernorDecision;
    try {
      decision = await withRedisLock(
        this.redis.getClient(),
        GOVERNOR_RESERVE_LOCK_KEY,
        {},
        async () => {
          const result = await this.evaluate(macroTask.projectId, project);
          if (result.ok) {
            await this.redis
              .getClient()
              .set(governorReservationKey(macroTask.id), macroTask.projectId, 'PX', RESERVATION_TTL_MS, 'NX')
              .catch((error) =>
                this.logger.warn(`Falha ao gravar a reserva em voo de ${macroTask.id}: ${error.message}`),
              );
          }
          return result;
        },
      );
    } catch (error) {
      // Contenção real no lock (várias macro tasks subindo ao mesmo tempo):
      // `reserveOrQueue` nunca lançou antes, então um timeout aqui vira fila em
      // vez de erro — `startPipeline` não trata rejeição deste método.
      if (!(error instanceof LockTimeoutError)) throw error;
      decision = { ok: false, reason: 'global', detail: 'disputa no lock do governor — tente de novo' };
    }
    const existingMeta = ((macroTask.metadata as Record<string, any>) || {}) as Record<string, any>;

    if (decision.ok) {
      // Estava na fila e agora tem slot: some com a marca antes de devolver
      // null, senão a UI continuaria mostrando "aguardando" com a Session já
      // subindo por baixo.
      const cleaned = stripQueueMarker(existingMeta);
      if (cleaned.wasQueued) {
        await this.prisma.macroTask
          .update({ where: { id: macroTask.id }, data: { metadata: cleaned.metadata } })
          .catch((error) => this.logger.warn(`Falha ao limpar metadata.queue de ${macroTask.id}: ${error.message}`));
      }
      return null;
    }

    // Preserva o `queuedAt` original se a task já estava na fila — senão cada
    // tentativa de promoção que falhar de novo reiniciaria a posição dela pro
    // fim da fila.
    const queuedAt = existingMeta.queue?.queuedAt || new Date().toISOString();
    const queueEntry: QueueEntry = {
      reason: decision.reason!,
      detail: decision.detail!,
      queuedAt,
      agentId,
      runtimeOverride: runtimeOverride ?? null,
    };
    // Contador de falhas sobrevive ao re-enfileiramento: é aqui que a task passa
    // a cada promoção sem slot, e zerar aqui deixaria o teto do `promoteQueue`
    // inalcançável para sempre.
    if (existingMeta.queue?.attempts) queueEntry.attempts = existingMeta.queue.attempts;
    if (existingMeta.queue?.lastError) queueEntry.lastError = existingMeta.queue.lastError;
    await this.prisma.macroTask.update({
      where: { id: macroTask.id },
      data: {
        status: 'pending',
        metadata: { ...existingMeta, queue: queueEntry } as unknown as Prisma.InputJsonValue,
      },
    });

    const position = await this.positionInQueue(macroTask.id);
    this.logger.log(
      `Macro task ${macroTask.id} enfileirada (posição ${position}, motivo: ${decision.reason}) — ${decision.detail}`,
    );
    return { queued: true, position, reason: decision.reason!, detail: decision.detail! };
  }

  /**
   * Snapshot pra `/sessions` (deliverable #4): slots usados/total, se há
   * pressão de recurso agora e quem está na fila + por quê. Sessão enfileirada
   * não pode parecer travada — é o retrato que a UI usa pra diferenciar as duas.
   */
  async getStatus(): Promise<{
    global: { active: number; max: number };
    resource: { ok: boolean; detail?: string; cpuLoadThreshold: number; minFreeMemMb: number };
    queue: Array<{
      macroTaskId: string;
      title: string;
      projectId: string;
      position: number;
      reason: QueueReason;
      detail: string;
      queuedAt: string;
    }>;
  }> {
    const thresholds = await this.getThresholds();
    const globalActive = await this.prisma.session.count({
      where: { status: { in: ACTIVE_SESSION_STATUSES } },
    });
    const resource = checkResourcePressure(sampleResources(), thresholds);

    const queue = (await this.scanQueue()).map((item, idx) => ({
      macroTaskId: item.id,
      title: item.title,
      projectId: item.projectId,
      position: idx + 1,
      reason: item.entry.reason,
      detail: item.entry.detail,
      queuedAt: item.entry.queuedAt,
    }));

    return {
      global: { active: globalActive, max: thresholds.globalMaxSessions },
      resource: {
        ok: resource.ok,
        detail: resource.detail,
        cpuLoadThreshold: thresholds.cpuLoadThreshold,
        minFreeMemMb: thresholds.minFreeMemMb,
      },
      queue,
    };
  }

  /**
   * Auto-start da próxima macro task pendente (MT-27), chamado pelo tick do
   * Master quando `autoStartEnabled` está ligado no projeto.
   *
   * O `promoteQueue` abaixo só enxerga quem tem `metadata.queue`, ou seja, quem
   * JÁ tentou subir e bateu no teto — task simplesmente `pending` não era
   * considerada por ninguém, e o orquestrador ficava parado com slot livre e
   * dezenas de tasks na fila de espera. Aqui a varredura é a das `pending` de
   * verdade, com três freios: `max` por chamada (13 pendentes não viram 13
   * sessões na primeira passada), `metadata.autoStart === false` como opt-out
   * por task, e o próprio governor decidindo o teto — a promoção passa por
   * `startPipeline` → `reserveOrQueue` como qualquer outra.
   */
  async autoStartPending(projectId: string, max: number): Promise<{ started: string[]; skipped: number }> {
    if (this.autoStarting) return { started: [], skipped: 0 };
    this.autoStarting = true;
    try {
      const pending = await this.prisma.macroTask.findMany({
        where: {
          projectId,
          status: 'pending',
          // Task com sessão viva já subiu — inclusive a `paused`, que precisa
          // de resume e não de uma segunda sessão em cima da primeira.
          sessions: { none: { status: { in: LIVE_SESSION_STATUSES } } },
        },
        orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
        select: { id: true, title: true, metadata: true },
      });

      const candidates = pending.filter((task) => {
        const meta = (task.metadata as Record<string, any>) || {};
        // Quem já está marcado em fila é assunto do `promoteQueue`: subir os
        // dois caminhos na mesma task duplicaria a tentativa.
        return meta.autoStart !== false && !meta.queue;
      });
      if (candidates.length === 0) return { started: [], skipped: 0 };

      const agent = await this.prisma.agent.findFirst({
        where: { projectId, cliProfileId: { not: null } },
        orderBy: { createdAt: 'asc' },
      });
      if (!agent) {
        this.logger.warn(
          `Auto-start: projeto ${projectId} não tem agente com CLI profile — nada a subir`,
        );
        return { started: [], skipped: candidates.length };
      }

      const started: string[] = [];
      for (const task of candidates.slice(0, Math.max(1, max))) {
        try {
          const result: any = await this.pipelineEngine.startPipeline(task.id, agent.id);
          if (result?.queued) {
            // Sem slot: as próximas da lista esbarrariam no mesmo teto.
            this.logger.log(
              `Auto-start: ${task.title} ficou na fila (${result.detail}) — parando a varredura`,
            );
            break;
          }
          started.push(task.id);
          this.logger.log(`Auto-start: macro task "${task.title}" iniciada automaticamente`);
        } catch (error) {
          this.logger.warn(`Auto-start: falha ao iniciar ${task.id}: ${error.message}`);
        }
      }
      return { started, skipped: candidates.length - started.length };
    } finally {
      this.autoStarting = false;
    }
  }

  /**
   * Avalia SEM gravar nada — usada pelo `reserveOrQueue` e reaproveitável se
   * algum dia a UI quiser um "dry run". Ordem: limite do projeto (mais
   * específico) < teto global < pressão de recurso.
   *
   * MT-20 (item 5): soma as reservas em voo (`countReservations`) ao `count()`
   * real — sem isso, a reserva gravada por `reserveOrQueue` não mudaria nada
   * aqui, e o lock estaria serializando chamadas que continuam vendo o mesmo
   * número.
   */
  private async evaluate(projectId: string, project: QueueableProject): Promise<GovernorDecision> {
    const settingsMax = (project.settings as any)?.maxSessions;
    const projectMaxSessions = typeof settingsMax === 'number' ? settingsMax : project.maxSessions || 3;
    const reservations = await this.countReservations(projectId);

    const projectActive =
      (await this.prisma.session.count({
        where: { macroTask: { projectId }, status: { in: ACTIVE_SESSION_STATUSES } },
      })) + reservations.project;
    if (projectActive >= projectMaxSessions) {
      return {
        ok: false,
        reason: 'project',
        detail: `limite do projeto atingido (${projectActive}/${projectMaxSessions} sessões ativas)`,
      };
    }

    const thresholds = await this.getThresholds();
    const globalActive =
      (await this.prisma.session.count({
        where: { status: { in: ACTIVE_SESSION_STATUSES } },
      })) + reservations.global;
    if (globalActive >= thresholds.globalMaxSessions) {
      return {
        ok: false,
        reason: 'global',
        detail: `teto global atingido (${globalActive}/${thresholds.globalMaxSessions} sessões ativas na máquina)`,
      };
    }

    const resource = checkResourcePressure(sampleResources(), thresholds);
    if (!resource.ok) {
      return { ok: false, reason: 'resource', detail: resource.detail! };
    }

    return { ok: true };
  }

  /**
   * Conta as reservas em voo (SCAN, nunca KEYS — o padrão pode crescer com o
   * número de macro tasks disputando slot ao mesmo tempo). O valor gravado em
   * cada chave é o `projectId` da reserva, o que permite contar o teto do
   * projeto e o teto global na mesma varredura.
   *
   * Fail-open no Redis fora do ar: antes da MT-20 este método não existia e o
   * governor era Prisma puro — deixar uma exceção de `scan`/`mget` subir
   * derrubaria TODO `startPipeline` (nem `LockTimeoutError` é, então
   * `reserveOrQueue` não a filtra) por causa de uma proteção extra contra uma
   * corrida rara. `withRedisLock` já assume esse mesmo trade-off para o lock em
   * si; aqui é a mesma lógica aplicada à contagem.
   */
  private async countReservations(projectId: string): Promise<{ global: number; project: number }> {
    const client = this.redis.getClient();
    let cursor = '0';
    let global = 0;
    let project = 0;
    try {
      do {
        const [next, keys]: [string, string[]] = await client.scan(
          cursor,
          'MATCH',
          GOVERNOR_RESERVATION_PATTERN,
          'COUNT',
          100,
        );
        cursor = next;
        if (keys.length > 0) {
          const values = await client.mget(...keys);
          for (const value of values) {
            if (value === null) continue;
            global++;
            if (value === projectId) project++;
          }
        }
      } while (cursor !== '0');
    } catch (error) {
      this.logger.warn(`Falha ao contar reservas em voo (Redis indisponível?) — seguindo sem elas: ${error.message}`);
      return { global: 0, project: 0 };
    }
    return { global, project };
  }

  /**
   * Lê `GovernorSettings` (singleton, ver schema.prisma) com fallback pros
   * defaults embutidos — nunca lança. `GOVERNOR_MAX_SESSIONS` é só uma
   * válvula de emergência lida por CIMA do banco (o usuário destrava a
   * máquina via env sem precisar abrir a UI se algo travar).
   */
  private async getThresholds(): Promise<ResourceThresholds & { globalMaxSessions: number }> {
    let stored: Partial<typeof FALLBACK_THRESHOLDS> = {};
    try {
      const row = await this.prisma.governorSettings.findUnique({ where: { id: 'global' } });
      if (row) stored = row;
    } catch (error) {
      this.logger.warn(`GovernorSettings ilegível (${error.message}) — usando defaults embutidos`);
    }

    const envMax = parseInt(process.env.GOVERNOR_MAX_SESSIONS || '', 10);
    return {
      globalMaxSessions: Number.isFinite(envMax) ? envMax : stored.globalMaxSessions ?? FALLBACK_THRESHOLDS.globalMaxSessions,
      cpuLoadThreshold: stored.cpuLoadThreshold ?? FALLBACK_THRESHOLDS.cpuLoadThreshold,
      minFreeMemMb: stored.minFreeMemMb ?? FALLBACK_THRESHOLDS.minFreeMemMb,
    };
  }

  /**
   * Varredura ÚNICA da fila — `positionInQueue`, `promoteQueue` e `getStatus`
   * liam cada um todas as `pending` sem limite e reordenavam em JS. Filtro,
   * ordenação e limite ficam no banco: `metadata` é `jsonb`, então
   * `metadata->'queue'->>'queuedAt'` ordena direto. É `$queryRaw` porque o
   * Prisma não faz `orderBy` em path de Json — o `where` daria, o `orderBy` não.
   *
   * `queuedAt` é ISO em UTC, então ordem de texto == ordem cronológica (era o
   * que o `localeCompare` já fazia). O `id` desempata para a ordem ser estável
   * entre duas chamadas quando dois `queuedAt` coincidem.
   *
   * Entrada de fila sem `queuedAt` — só acontece se alguém editar o `metadata`
   * à mão, `reserveOrQueue` sempre grava — cai no fim pelo NULLS LAST default
   * do ASC, em vez de ser descartada: task presa na fila para sempre é pior
   * que task fora de ordem.
   */
  private async scanQueue(limit = QUEUE_SCAN_LIMIT): Promise<QueuedMacroTask[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{ id: string; title: string; project_id: string; queue: QueueEntry }>
    >(Prisma.sql`
      SELECT id, title, project_id, metadata->'queue' AS queue
      FROM macro_tasks
      WHERE status = 'pending'
        AND jsonb_typeof(metadata->'queue') = 'object'
      ORDER BY metadata->'queue'->>'queuedAt' ASC, id ASC
      LIMIT ${limit}
    `);

    if (rows.length === limit) {
      // Truncar em silêncio faria a fila parecer menor do que é — quem lê o
      // log precisa saber que a posição e o status estão vendo só o começo.
      this.logger.warn(
        `Fila: varredura truncada em ${limit} macro tasks — o resto entra na próxima passada`,
      );
    }

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      projectId: row.project_id,
      entry: row.queue,
    }));
  }

  /**
   * 1-based, na ordem de chegada na fila (mais antigo primeiro). Chamada
   * DEPOIS do `update` que grava `metadata.queue` — a própria task já aparece
   * na varredura, sem precisar computar a posição "a priori".
   *
   * Fora das primeiras `QUEUE_SCAN_LIMIT` a posição sai como "fim da
   * varredura" em vez da real. É número de exibição: errar nele é mais barato
   * que uma segunda leitura sem limite só para acertar o rótulo.
   */
  private async positionInQueue(macroTaskId: string): Promise<number> {
    const queue = await this.scanQueue();
    const idx = queue.findIndex((item) => item.id === macroTaskId);
    return idx >= 0 ? idx + 1 : queue.length + 1;
  }

  /**
   * Tenta subir, em ordem de chegada, todas as macro tasks marcadas em fila.
   * Chamada tanto por evento (slot liberou agora) quanto pelo poll (pressão de
   * recurso pode ter cedido sem nenhum evento). Cada tentativa passa de novo
   * por `startPipeline` → `reserveOrQueue`: se ainda não houver slot, a task
   * só é re-marcada na fila (sem duplicar Session).
   *
   * Percorre a varredura INTEIRA a cada chamada em vez de parar na primeira
   * falha: o teto do projeto pode barrar a primeira da fila e liberar a
   * segunda, de outro projeto — parar cedo perderia essa promoção. "Inteira"
   * aqui é o que o `scanQueue` traz (`QUEUE_SCAN_LIMIT`); o que passar disso
   * entra na chamada seguinte, e o poll de 30s garante que existe uma.
   */
  private async promoteQueue(): Promise<void> {
    if (this.promoting) return;
    this.promoting = true;
    try {
      const queued = await this.scanQueue();
      if (queued.length === 0) return;

      for (const item of queued) {
        try {
          const result = await this.pipelineEngine.startPipeline(
            item.id,
            item.entry.agentId,
            item.entry.runtimeOverride ?? undefined,
          );
          if (!(result as any)?.queued) {
            this.logger.log(`Fila: macro task ${item.id} promovida — slot liberado`);
          }
        } catch (error) {
          // Task da fila com agente/CLI quebrado não pode travar quem vem
          // depois dela — registra a tentativa e segue para a próxima.
          this.logger.warn(`Fila: falha ao tentar promover ${item.id}: ${error.message}`);
          await this.recordPromotionFailure(item.id, item.entry, error.message);
        }
      }
    } finally {
      this.promoting = false;
    }
  }

  /**
   * Contabiliza uma promoção que estourou e, no teto, desiste da task.
   *
   * Sem isto o `promoteQueue` retentava para sempre: item com falha PERMANENTE
   * (agente deletado, CLI fora do PATH) só virava `warn` a cada 30s, a task
   * ficava `pending` para sempre e ninguém era avisado. Depois de
   * `MAX_PROMOTION_ATTEMPTS` a task vira `failed` com o motivo visível na
   * /macro-tasks e sai da fila — `metadata.queue` some, que é o que o
   * `promoteQueue` usa para enxergar a fila.
   */
  private async recordPromotionFailure(
    macroTaskId: string,
    entry: QueueEntry,
    message: string,
  ): Promise<void> {
    const attempts = (entry.attempts ?? 0) + 1;
    try {
      const task = await this.prisma.macroTask.findUnique({
        where: { id: macroTaskId },
        select: { projectId: true, metadata: true },
      });
      // Task apagada no meio da promoção: nada a marcar.
      if (!task) return;
      const meta = ((task.metadata as Record<string, any>) || {}) as Record<string, any>;

      if (attempts < MAX_PROMOTION_ATTEMPTS) {
        await this.prisma.macroTask.update({
          where: { id: macroTaskId },
          data: {
            metadata: {
              ...meta,
              queue: { ...(meta.queue || entry), attempts, lastError: message },
            } as unknown as Prisma.InputJsonValue,
          },
        });
        return;
      }

      const detail = `Falhou ao iniciar ${attempts} vezes seguidas: ${message}`;
      const { queue: _queue, ...rest } = meta;
      await this.prisma.macroTask.update({
        where: { id: macroTaskId },
        data: {
          status: 'failed',
          metadata: { ...rest, queueFailure: { attempts, detail, at: new Date().toISOString() } } as unknown as Prisma.InputJsonValue,
        },
      });
      await this.prisma.logEntry.create({
        data: {
          projectId: task.projectId,
          level: 'error',
          message: `Macro task ${macroTaskId} desistiu da fila: ${detail}`,
          metadata: { macroTaskId, attempts, agentId: entry.agentId },
        },
      });
      this.logger.error(`Fila: ${macroTaskId} marcada como failed — ${detail}`);
    } catch (error) {
      // Contabilizar a falha não pode virar uma segunda falha: o pior caso é a
      // task tentar de novo no próximo evento, que é o comportamento antigo.
      this.logger.warn(`Fila: falha ao contabilizar tentativa de ${macroTaskId}: ${error.message}`);
    }
  }
}
