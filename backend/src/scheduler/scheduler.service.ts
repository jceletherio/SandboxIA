import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { promises as fsp } from 'fs';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { CHANNELS, GitChangedEvent } from '../redis/channels';
import { WorkspaceService } from '../workspace/workspace.service';
import { SessionRuntimeService } from '../session-runtime/session-runtime.service';
import { MasterAgentService } from '../master-agent/master-agent.service';
import { MasterRuntimeService } from '../master-agent/master-runtime.service';
import {
  MASTER_LOOP_DEFER_BACKOFF_MINUTES,
  MASTER_LOOP_JOB_TYPE,
  MASTER_LOOP_MAX_DEFERRALS,
  MasterLoopPayload,
  masterLoopRunsLabel,
  readMasterLoopPayload,
} from '../scheduled-jobs/master-loop';
import {
  MASTER_TICK_JOB_TYPE,
  MasterTickPayload,
  readMasterTickPayload,
} from '../scheduled-jobs/master-tick';
import { computeTickIntervalMinutes } from '../master-agent/master-scheduling.config';
import { QMD_EMBED_JOB_TYPE, QmdEmbedPayload, QmdEmbedService } from '../context/qmd-embed.service';
import { ScheduledJobType, assertKnownJobType, projectIdFromPayload } from './job-types';

/**
 * Resultado de um job para o gravador de status do `processScheduledJobs`.
 *
 * - `nextRunAt` presente → o job volta para `pending` com esse `scheduledAt`
 *   (é assim que a recorrência do `master_loop` funciona, sem cron por job).
 * - `nextRunAt` ausente → `completed`, exatamente como antes.
 * - `payload` presente → substitui o `payload` persistido (contadores do loop).
 */
interface JobOutcome {
  result?: any;
  nextRunAt?: Date;
  payload?: Record<string, any>;
}

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private workspace: WorkspaceService,
    private sessionRuntime: SessionRuntimeService,
    private masterAgent: MasterAgentService,
    private masterRuntime: MasterRuntimeService,
    private qmdEmbed: QmdEmbedService,
  ) {}

  @Cron(CronExpression.EVERY_30_SECONDS)
  async processScheduledJobs() {
    const pendingJobs = await this.prisma.scheduledJob.findMany({
      where: {
        status: 'pending',
        scheduledAt: {
          lte: new Date(),
        },
      },
      // Sem `orderBy`, o `take: 10` pegava uma página arbitrária: com fila cheia,
      // o job mais atrasado podia nunca entrar. Quem esperou mais vai primeiro.
      orderBy: { scheduledAt: 'asc' },
      take: 10,
    });

    // CONCORRENTE de propósito (MT-13). Em série, o `qmd_embed` — processo
    // externo de até 30 min — atrasava na mesma medida o `session_timeout` da
    // sessão travada e o `master_loop` de 5 min, que perdia execuções. O claim
    // otimista dentro de `claimAndRunJob` é o que mantém isso seguro: dois ticks
    // concorrentes nunca executam o mesmo job porque só um consegue a transição
    // pending → running, e um job já `running` sai do `where` do próximo tick.
    await Promise.allSettled(pendingJobs.map((job) => this.claimAndRunJob(job)));
  }

  /**
   * Executa UM job e grava seu destino. Nunca rejeita: erro do handler vira job
   * `failed`, e erro de contabilidade vira `warn`. É o que permite rodar os jobs
   * do tick em paralelo sem que um deles derrube os outros.
   */
  private async claimAndRunJob(job: any): Promise<void> {
    try {
      // lock otimista: só executa se conseguir a transição pending → running
      const claimed = await this.prisma.scheduledJob.updateMany({
        where: { id: job.id, status: 'pending' },
        data: { status: 'running' },
      });
      if (claimed.count === 0) return;

      try {
        const outcome = await this.executeJob(job);
        const data: Record<string, any> = {
          executedAt: new Date(),
          result: outcome.result ?? undefined,
        };
        if (outcome.payload !== undefined) data.payload = outcome.payload;
        if (outcome.nextRunAt) {
          // Recorrência: volta para a fila em vez de encerrar.
          data.status = 'pending';
          data.scheduledAt = outcome.nextRunAt;
        } else {
          data.status = 'completed';
        }
        await this.prisma.scheduledJob.update({
          where: { id: job.id },
          data,
        });
      } catch (error) {
        await this.prisma.scheduledJob.update({
          where: { id: job.id },
          data: {
            status: 'failed',
            result: { error: error.message },
          },
        });
      }
    } catch (error) {
      // Falha no claim ou na gravação do status (banco fora, job apagado no meio
      // da execução): não pode derrubar os outros jobs do tick, mas silenciar
      // deixaria um job preso em `running` sem rastro nenhum no log.
      this.logger.warn(`Failed to bookkeep scheduled job ${job.id}: ${error.message}`);
    }
  }

  private async executeJob(job: any): Promise<JobOutcome> {
    switch (job.type) {
      case 'session_timeout':
        return { result: await this.handleSessionTimeout(job.payload) };
      case 'stage_timeout':
        return { result: await this.handleStageTimeout(job.payload) };
      case 'cleanup_worktrees':
        return { result: await this.handleCleanupWorktrees(job.payload) };
      case MASTER_LOOP_JOB_TYPE:
        return this.handleMasterLoop(job);
      case MASTER_TICK_JOB_TYPE:
        return this.handleMasterTick(job);
      case QMD_EMBED_JOB_TYPE:
        return this.handleQmdEmbed(job);
      default:
        // Tipo fora do registro: a mensagem sai de `assertKnownJobType`, com a
        // lista de válidos. Tipo REGISTRADO caindo aqui é handler esquecido no
        // switch — erro de programação, não de dado.
        assertKnownJobType(job.type);
        throw new Error(`No handler registered for job type: ${job.type}`);
    }
  }

  // ------------------------------------------------------------ qmd_embed
  //
  // Embed do qmd serializado (MT-6). A lógica toda — lock global, guarda de
  // sessão ativa, prioridade baixa, timeout — vive no QmdEmbedService; aqui só
  // se traduz o resultado para o `JobOutcome`.

  /**
   * `queued` do serviço significa "ainda tem sessão viva (ou embed rodando)":
   * o job volta para a fila com o debounce, sem consumir nada. É esse
   * reagendamento que garante um único embed depois da última sessão terminar.
   */
  private async handleQmdEmbed(job: { id: string; payload: any }): Promise<JobOutcome> {
    const raw = (job.payload || {}) as Record<string, unknown>;
    if (typeof raw.projectId !== 'string' || !raw.projectId) {
      throw new Error('qmd_embed payload has no projectId');
    }
    // `reason` normalizado: um job criado à mão na /scheduler pode vir só com o
    // projectId, e `reason: undefined` sujaria o log e o status da /context.
    const payload: QmdEmbedPayload = {
      projectId: raw.projectId,
      reason: this.qmdEmbed.readReason(raw.reason),
      deferCount: typeof raw.deferCount === 'number' ? raw.deferCount : undefined,
      attempts: typeof raw.attempts === 'number' ? raw.attempts : undefined,
    };

    let outcome;
    try {
      outcome = await this.qmdEmbed.runEmbedNow(payload);
    } catch (error) {
      // Embed que estourou não pode virar `failed` de primeira: se a onda já
      // acabou, o índice fica defasado até alguém clicar em Reindex na /context.
      // `nextRetry` devolve null no teto — aí o erro sobe e o job falha de fato,
      // com a mensagem real do processo.
      const retry = this.qmdEmbed.nextRetry(payload, error.message);
      if (!retry) throw error;
      return {
        result: {
          status: 'failed',
          reason: error.message,
          attempts: retry.payload.attempts,
          retryAt: retry.scheduledAt.toISOString(),
        },
        payload: { ...retry.payload },
        nextRunAt: retry.scheduledAt,
      };
    }

    if (outcome.status !== 'queued') {
      return { result: outcome, payload: { ...payload } };
    }

    const deferral = this.qmdEmbed.nextDeferral(payload);
    this.logger.log(`qmd_embed ${job.id} postponed to ${deferral.scheduledAt.toISOString()}: ${outcome.reason}`);
    return {
      result: { ...outcome, deferredTo: deferral.scheduledAt.toISOString() },
      payload: { ...deferral.payload },
      nextRunAt: deferral.scheduledAt,
    };
  }

  // ----------------------------------------------------------- master_tick
  //
  // Tick periódico da automação de um projeto (MT-20). O `ScheduledJob` é o
  // ÚNICO agendador do orquestrador: o `setInterval` que vivia no
  // `MasterAgentService` saiu, e com ele a limitação de a automação só valer
  // para o projeto ativo do Master. A cadência vem de
  // `Project.settings.automation.tickIntervalMinutes` e é reaplicada aqui a cada
  // disparo, então mudar a config na UI vale a partir do tick seguinte.

  /**
   * Executa o tick do projeto e o reagenda SEMPRE — tick é recorrente por
   * natureza, não tem `maxRuns`. Tick que rodou só a parte de backend (Master
   * daquele projeto desligado) não é falha: grava o motivo em `payload.lastError`
   * e continua na cadência normal, porque a automação é do projeto e o terminal
   * pode voltar a qualquer momento.
   */
  private async handleMasterTick(job: { id: string; payload: any }): Promise<JobOutcome> {
    const payload = readMasterTickPayload(job.payload);
    if (!payload.projectId) {
      throw new Error('master_tick payload has no projectId');
    }

    const config = await this.masterAgent.getSchedulingConfig(payload.projectId);
    const tickMinutes = computeTickIntervalMinutes(config);
    if (tickMinutes === null) {
      // Automação desligada enquanto o job estava na fila: encerra em vez de
      // ficar reagendando um tick que não tem nenhuma parte para rodar.
      return {
        result: { dispatched: false, skipped: 'nenhuma automação habilitada neste projeto' },
        payload: { ...payload },
      };
    }

    const outcome = await this.masterAgent.runTickForProject(payload.projectId);
    const now = new Date();
    const nextPayload: MasterTickPayload = {
      ...payload,
      runCount: payload.runCount + 1,
      lastRunAt: now.toISOString(),
    };
    const notRun = outcome.deferred ?? outcome.skipped;
    if (notRun) nextPayload.lastError = notRun;
    else delete nextPayload.lastError;

    if (outcome.deferred) {
      this.logger.warn(
        `master_tick ${job.id} (projeto ${payload.projectId}): partes de CLI não rodaram — ${outcome.deferred}`,
      );
    }

    return {
      result: {
        dispatched: outcome.ran.length > 0,
        ran: outcome.ran,
        deferred: outcome.deferred ?? null,
        nextRunAt: new Date(now.getTime() + tickMinutes * 60_000).toISOString(),
      },
      payload: { ...nextPayload },
      nextRunAt: new Date(now.getTime() + tickMinutes * 60_000),
    };
  }

  // ---------------------------------------------------------- master_loop
  //
  // Agendamento "de usuário": manda as `instructions` (texto livre) para o
  // terminal interativo do Master Agent na hora marcada, opcionalmente em loop
  // com rate-limit. Shape completo do payload: `scheduled-jobs/master-loop.ts`.

  /**
   * Dispara UMA execução de um `master_loop` e decide o destino do job.
   *
   * Guardas: se o Master DO PROJETO do loop está inativo ou sem tmux no ar, o
   * prompt NÃO é enviado — e a execução **não é consumida** (`runCount` intacto):
   * o job é reagendado com backoff e o motivo fica em `payload.lastError`. Um
   * Master desligado não queima as N execuções que o usuário pediu.
   */
  private async handleMasterLoop(job: {
    id: string;
    payload: any;
    notes?: string | null;
  }): Promise<JobOutcome> {
    const payload = readMasterLoopPayload(job.payload);

    // Payload inválido é erro permanente → o catch do caller marca 'failed'.
    if (!payload.instructions.trim()) {
      throw new Error('master_loop payload has no instructions');
    }
    if (!payload.projectId) {
      throw new Error('master_loop payload has no projectId');
    }

    const project = await this.prisma.project.findUnique({
      where: { id: payload.projectId },
      select: { id: true, name: true, mainPath: true },
    });
    if (!project) {
      throw new Error(`master_loop points to a project that no longer exists (${payload.projectId})`);
    }

    // Teto duro: se o rate-limit já foi atingido (ex.: o humano reativou um loop
    // concluído com o botão Play), encerra sem disparar mais nada.
    if (payload.maxRuns !== undefined && payload.runCount >= payload.maxRuns) {
      return {
        result: {
          dispatched: false,
          skipped: `maxRuns (${payload.maxRuns}) already reached — raise it to run again`,
          runCount: payload.runCount,
        },
        payload: { ...payload },
      };
    }

    // MT-20: a checagem é do Master DAQUELE projeto. Antes o loop era adiado
    // quando "o Master está em outro projeto" — o que, com um Master por
    // projeto, deixaria de fazer sentido: o loop do projeto B não depende mais
    // do que está ativo no projeto A.
    const status = await this.masterAgent.getStatus(payload.projectId);
    if (!status.isActive || !status.tmuxRunning) {
      return this.deferMasterLoop(
        job.id,
        payload,
        `Master Agent terminal is not running for "${project.name}" — activate it on the dashboard`,
      );
    }

    const runNumber = payload.runCount + 1;
    const runsLabel = masterLoopRunsLabel(payload);

    try {
      await this.masterRuntime.sendPrompt(
        payload.projectId,
        this.buildMasterLoopPrompt(job.id, runNumber, runsLabel, payload, project.name, project.mainPath),
      );
    } catch (error) {
      // tmux morreu entre o getStatus e o envio: mesmo tratamento do Master fora
      // do ar — não consome execução.
      return this.deferMasterLoop(
        job.id,
        payload,
        `Failed to send the prompt to the Master Agent terminal: ${error.message}`,
      );
    }

    const now = new Date();
    const nextPayload: MasterLoopPayload = {
      ...payload,
      runCount: runNumber,
      lastRunAt: now.toISOString(),
      deferCount: 0,
    };
    delete nextPayload.lastError;

    const reachedLimit = payload.maxRuns !== undefined && runNumber >= payload.maxRuns;
    const nextRunAt =
      !reachedLimit && payload.repeatIntervalMinutes
        ? new Date(now.getTime() + payload.repeatIntervalMinutes * 60_000)
        : undefined;

    await this.logMasterLoop(payload.projectId, 'info', `Scheduled loop run ${runNumber}/${runsLabel} sent to the Master Agent`, {
      jobId: job.id,
      runCount: runNumber,
      maxRuns: payload.maxRuns,
      repeatIntervalMinutes: payload.repeatIntervalMinutes,
      nextRunAt: nextRunAt?.toISOString() ?? null,
      instructionsPreview: payload.instructions.slice(0, 200),
    });

    this.logger.log(
      `master_loop ${job.id}: run ${runNumber}/${runsLabel} dispatched` +
        (nextRunAt ? ` — next at ${nextRunAt.toISOString()}` : ' — finished'),
    );

    return {
      result: {
        dispatched: true,
        runCount: runNumber,
        maxRuns: payload.maxRuns ?? null,
        nextRunAt: nextRunAt?.toISOString() ?? null,
        finished: !nextRunAt,
      },
      payload: { ...nextPayload },
      nextRunAt,
    };
  }

  /**
   * Adia um `master_loop` sem consumir execução. Recorrente adia pelo próprio
   * intervalo; não recorrente usa um backoff curto. Depois de
   * `MASTER_LOOP_MAX_DEFERRALS` adiamentos seguidos desiste (job → 'failed'),
   * para não ficar pendente para sempre com o Master desligado.
   */
  private async deferMasterLoop(
    jobId: string,
    payload: MasterLoopPayload,
    reason: string,
  ): Promise<JobOutcome> {
    const deferCount = (payload.deferCount ?? 0) + 1;
    if (deferCount > MASTER_LOOP_MAX_DEFERRALS) {
      throw new Error(`master_loop skipped ${MASTER_LOOP_MAX_DEFERRALS} times in a row: ${reason}`);
    }

    const backoffMinutes = payload.repeatIntervalMinutes ?? MASTER_LOOP_DEFER_BACKOFF_MINUTES;
    const nextRunAt = new Date(Date.now() + backoffMinutes * 60_000);

    await this.logMasterLoop(payload.projectId, 'warn', `Scheduled loop postponed: ${reason}`, {
      jobId,
      deferCount,
      runCount: payload.runCount,
      nextRunAt: nextRunAt.toISOString(),
    });
    this.logger.warn(`master_loop ${jobId} postponed to ${nextRunAt.toISOString()}: ${reason}`);

    return {
      result: { dispatched: false, skipped: reason, deferredTo: nextRunAt.toISOString() },
      payload: { ...payload, lastError: reason, deferCount },
      nextRunAt,
    };
  }

  /** Prompt do disparo. Marcador no padrão dos outros prompts internos. */
  private buildMasterLoopPrompt(
    jobId: string,
    runNumber: number,
    runsLabel: string,
    payload: MasterLoopPayload,
    projectName: string,
    mainPath: string,
  ): string {
    const cadence = payload.repeatIntervalMinutes
      ? `every ${payload.repeatIntervalMinutes} min, ${payload.maxRuns ? `${payload.maxRuns} run(s) total` : 'until cancelled'}`
      : 'one-off (this is the only run)';

    return `[ORCHESTRATOR SCHEDULED LOOP ${jobId} run ${runNumber}/${runsLabel}] Scheduled instruction created by the ORCHESTRATOR, not a live user message — nobody is typing in the terminal right now.

Project: ${projectName} — ${mainPath}
Schedule: ${cadence}

Instructions the user saved for this schedule:
"""
${payload.instructions}
"""

How to handle it:
1. Do the work using the orchestrator MCP tools (get_status, list_sessions, list_macro_tasks, get_session_screen, ...) — do not guess state.
2. Deliver the answer through MCP: call reply_chat when the user should see it in the dashboard chat, or log (level info/warn) when it is just an internal note. Text typed in the terminal is NOT visible to anyone.
3. Keep it short and stop when the instruction above is fulfilled — this prompt will fire again on the schedule.`;
  }

  /** Rastro na página de logs. Nunca quebra o disparo. */
  private async logMasterLoop(
    projectId: string,
    level: 'info' | 'warn',
    message: string,
    metadata: Record<string, any>,
  ): Promise<void> {
    try {
      await this.prisma.logEntry.create({
        data: { projectId, level, message, metadata },
      });
    } catch (error) {
      this.logger.warn(`Failed to write master_loop log entry: ${error.message}`);
    }
  }

  private async handleSessionTimeout(payload: any) {
    const { sessionId } = payload;
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { status: 'timeout' },
    });
    await this.redis.publish(CHANNELS.SESSION_STATUS, { sessionId, status: 'timeout' });
    return { sessionId, action: 'timed out' };
  }

  /**
   * Timeout de stage: se a sessão ainda está no mesmo stage e rodando,
   * PAUSA (não mata) — CLIs interativos podem demorar; humano decide no inbox.
   */
  private async handleStageTimeout(payload: any) {
    const { sessionId, stageName } = payload;
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: { currentStage: true, status: true, stageData: true },
    });
    if (!session) return { skipped: 'session gone' };
    if (session.currentStage !== stageName || session.status !== 'running') {
      return { skipped: `stage moved on (${session.currentStage}/${session.status})` };
    }

    const stageData = (session.stageData as any) || {};
    await this.prisma.session.update({
      where: { id: sessionId },
      data: {
        status: 'paused',
        stageData: {
          ...stageData,
          pauseReason: `Stage "${stageName}" timed out — human intervention required`,
          pausedAt: new Date().toISOString(),
        },
      },
    });
    await this.redis.publish(CHANNELS.SESSION_PAUSED, {
      sessionId,
      reason: `Stage "${stageName}" timed out`,
    });
    this.logger.warn(`Session ${sessionId} paused: stage ${stageName} timeout`);
    return { sessionId, action: 'paused on timeout' };
  }

  /**
   * Remove worktrees de sessões finalizadas.
   * payload.sessionId limpa uma sessão específica; sem payload, varre todas
   * as completadas que ainda têm worktreePath.
   */
  private async handleCleanupWorktrees(payload: any) {
    const where: any = {
      status: { in: ['completed', 'failed', 'stopped', 'timeout'] },
      worktreePath: { not: '' },
    };
    if (payload?.sessionId) where.id = payload.sessionId;

    const sessions = await this.prisma.session.findMany({
      where,
      include: { macroTask: { include: { project: true } } },
      take: 20,
    });

    const cleaned: string[] = [];
    for (const session of sessions) {
      const project = session.macroTask?.project;
      if (!project) continue;
      try {
        await this.sessionRuntime.stop(session.id).catch(() => undefined);
        const exists = await fsp
          .access(session.worktreePath)
          .then(() => true)
          .catch(() => false);
        if (exists) {
          await this.workspace.removeWorktree(project.mainPath, session.worktreePath);
        } else {
          // Worktree já removido fora do scheduler (merge, limpeza manual):
          // só poda metadados órfãos do git e zera o registro — idempotente.
          await this.workspace.pruneWorktrees(project.mainPath).catch(() => undefined);
        }
        await this.prisma.session.update({
          where: { id: session.id },
          data: { worktreePath: '' },
        });
        await this.publishGitChanged({
          projectId: project.id,
          reason: 'worktree-removed',
          ts: new Date().toISOString(),
          sessionId: session.id,
          branch: session.branchName,
        });
        cleaned.push(session.id);
        this.logger.log(
          exists
            ? `Cleaned worktree of session ${session.id}`
            : `Worktree of session ${session.id} was already gone — record cleared`,
        );
      } catch (error) {
        this.logger.warn(`Cleanup failed for ${session.id}: ${error.message}`);
      }
    }
    return { cleaned };
  }

  /** Notifica a UI (/git) que o estado git do projeto mudou. Nunca quebra o cleanup. */
  private async publishGitChanged(event: GitChangedEvent): Promise<void> {
    try {
      await this.redis.publish(CHANNELS.GIT_CHANGED, event);
    } catch (error) {
      this.logger.warn(`Failed to publish git:changed (${event.reason}): ${error.message}`);
    }
  }

  async scheduleJob(type: ScheduledJobType, payload: any, scheduledAt: Date) {
    // `projectId` também é COLUNA desde a MT-13: quem consulta por projeto usa a
    // coluna, então gravar só no payload deixaria o job invisível para o filtro.
    return this.prisma.scheduledJob.create({
      data: {
        type: assertKnownJobType(type),
        payload,
        projectId: projectIdFromPayload(payload),
        scheduledAt,
      },
    });
  }
}
