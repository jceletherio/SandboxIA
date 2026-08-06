import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  forwardRef,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as fs from 'fs/promises';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { CHANNELS, GitChangedEvent, QuestionEvent, SessionLogEvent, StageEvent } from '../redis/channels';
import {
  SessionRuntimeService,
  SessionRuntimeOverride,
} from '../session-runtime/session-runtime.service';
import { WorkspaceService } from '../workspace/workspace.service';
import { MergeQueueService } from '../git/merge-queue.service';
import { SessionGovernorService, QueuedStart } from '../scheduler/session-governor.service';
import * as yaml from 'js-yaml';
import { binaryExists } from '../common/host-tools';
import {
  PipelineDefinition,
  PipelineStage,
  normalizePipelineDefinition,
  validatePipelineDefinition,
} from '../pipelines/pipeline-definition';

export { PipelineDefinition, PipelineStage } from '../pipelines/pipeline-definition';

@Injectable()
export class PipelineEngineService implements OnModuleInit {
  private readonly logger = new Logger(PipelineEngineService.name);

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    // forwardRef: ciclo com o session-runtime (ver session-runtime.module.ts).
    @Inject(forwardRef(() => SessionRuntimeService))
    private sessionRuntime: SessionRuntimeService,
    private workspace: WorkspaceService,
    private mergeQueue: MergeQueueService,
    // forwardRef: ciclo com o scheduler — reserveOrQueue chama startPipeline
    // de volta pra promover a fila (session-governor.service.ts).
    @Inject(forwardRef(() => SessionGovernorService))
    private sessionGovernor: SessionGovernorService,
  ) {}

  async onModuleInit() {
    await this.redis.subscribe(CHANNELS.STAGE_COMPLETE, (event: StageEvent) => {
      void this.onStageComplete(event).catch((error) =>
        this.logger.error(`stage-complete handler failed: ${error.message}`),
      );
    });
    await this.redis.subscribe(CHANNELS.STAGE_FAILED, (event: StageEvent) => {
      void this.onStageFailed(event).catch((error) =>
        this.logger.error(`stage-failed handler failed: ${error.message}`),
      );
    });
    await this.redis.subscribe(CHANNELS.QUESTION_CREATED, (event: QuestionEvent) => {
      void this.onQuestionCreated(event).catch((error) =>
        this.logger.error(`question-created handler failed: ${error.message}`),
      );
    });
    await this.redis.subscribe(CHANNELS.QUESTION_ANSWERED, (event: QuestionEvent) => {
      void this.onQuestionAnswered(event).catch((error) =>
        this.logger.error(`question-answered handler failed: ${error.message}`),
      );
    });
    this.logger.log('Pipeline engine subscribed to orchestration channels');
  }

  // ---------------------------------------------------------------- pipeline

  parseYaml(yamlContent: string): PipelineDefinition {
    try {
      const parsed = yaml.load(yamlContent) as PipelineDefinition;
      this.validatePipeline(parsed);
      return parsed;
    } catch (error) {
      throw new Error(`Invalid pipeline YAML: ${error.message}`);
    }
  }

  validatePipeline(pipeline: PipelineDefinition): void {
    validatePipelineDefinition(pipeline);
  }

  toYaml(pipeline: PipelineDefinition): string {
    return yaml.dump(pipeline);
  }

  /** Aceita tanto `{ stages: [...] }` quanto `[...]` vindos do Json do banco. */
  normalizePipeline(stagesJson: unknown): PipelineDefinition {
    return normalizePipelineDefinition(stagesJson);
  }

  getNextStage(pipeline: PipelineDefinition, currentStage: string): PipelineStage | null {
    const currentIndex = pipeline.stages.findIndex((s) => s.name === currentStage);
    if (currentIndex === -1 || currentIndex >= pipeline.stages.length - 1) {
      return null;
    }
    return pipeline.stages[currentIndex + 1];
  }

  getStage(pipeline: PipelineDefinition, stageName: string): PipelineStage | null {
    return pipeline.stages.find((s) => s.name === stageName) || null;
  }

  isLastStage(pipeline: PipelineDefinition, stageName: string): boolean {
    return pipeline.stages[pipeline.stages.length - 1].name === stageName;
  }

  /**
   * Pipeline EFETIVO de uma sessão (MT-0, contratos §5).
   *
   * Toda leitura de pipeline durante a execução passa por aqui, em vez de ir
   * direto no `macroTask.pipeline.stages`: o snapshot é congelado no
   * `startPipeline` e editar o pipeline no meio do voo (ou com 5 sessões
   * paralelas rodando) não muda mais o fluxo de quem já começou.
   *
   * Fallback para o pipeline ao vivo quando não há snapshot — sessões criadas
   * antes desta mudança — ou quando o snapshot gravado não valida mais, caso em
   * que perder a sessão seria pior do que voltar ao comportamento antigo.
   *
   * Público desde a MT-4: o `session-runtime` também precisa do pipeline
   * efetivo (para `permissions`/`extraMcpServers`/`defaults` no boot) e lia o
   * pipeline ao vivo, o que deixava o snapshot parcial.
   */
  loadSessionPipeline(session: {
    id: string;
    context?: unknown;
    macroTask: { pipeline: { stages: unknown } };
  }): PipelineDefinition {
    const snapshot = (session.context as Record<string, any> | null)?.pipelineSnapshot;
    if (snapshot) {
      try {
        return this.normalizePipeline(snapshot);
      } catch (error) {
        this.logger.warn(
          `Session ${session.id}: invalid pipelineSnapshot (${error.message}) — falling back to the live pipeline`,
        );
      }
    }
    return this.normalizePipeline(session.macroTask.pipeline.stages);
  }

  // --------------------------------------------------------------- execução

  /**
   * Ponto de entrada: cria a Session, sobe o runtime (worktree+tmux+CLI) e
   * dispara o primeiro stage. Retorna imediatamente — o avanço é event-driven.
   *
   * `runtimeOverride` (o que o Master escolheu no `start_macro_task`) precisa
   * chegar aqui e não num update posterior: o CLI sobe e o primeiro stage roda
   * antes desta função retornar, então gravar depois já seria tarde.
   */
  async startPipeline(
    macroTaskId: string,
    agentId: string,
    runtimeOverride?: SessionRuntimeOverride,
  ) {
    const macroTask = await this.prisma.macroTask.findUnique({
      where: { id: macroTaskId },
      include: { pipeline: true, project: true },
    });
    if (!macroTask) throw new NotFoundException('Macro task not found');

    const existingSession = await this.prisma.session.findFirst({
      where: {
        macroTaskId,
        status: { in: ['running', 'waiting', 'initializing'] },
      },
    });
    if (existingSession) {
      this.logger.warn(`Returning existing session ${existingSession.id} for macro task ${macroTaskId}`);
      return existingSession;
    }

    const agent = await this.prisma.agent.findUnique({
      where: { id: agentId },
      include: { cliProfile: true },
    });
    if (!agent) throw new NotFoundException('Agent not found');
    if (!agent.cliProfile) {
      throw new BadRequestException(`Agent ${agent.name} has no CLI profile — assign one first`);
    }

    if (!(await binaryExists(agent.cliProfile.binary))) {
      throw new BadRequestException(
        `Health check failed: CLI binary "${agent.cliProfile.binary}" for profile "${agent.cliProfile.name}" not found in PATH`,
      );
    }

    // MT-10: teto per-projeto + teto global da máquina + guarda de CPU/memória,
    // tudo decidido em session-governor.service.ts (scheduler/). Sem slot agora
    // não é mais erro: a macro task fica marcada em fila (metadata.queue) e
    // volta aqui sozinha quando um slot libera — ver reserveOrQueue.
    const queued: QueuedStart | null = await this.sessionGovernor.reserveOrQueue(
      macroTask,
      macroTask.project,
      agentId,
      runtimeOverride,
    );
    if (queued) return queued;

    const pipeline = this.normalizePipeline(macroTask.pipeline.stages);
    const slug = macroTask.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 40);
    const branchName = `task/${slug}-${macroTaskId.slice(0, 6)}`;

    // RESUME: se uma sessão anterior desta task morreu no meio (failed/stopped/
    // timeout), os stages que ela já completou são herdados — a nova sessão
    // começa do primeiro stage incompleto em vez de refazer o pipeline inteiro
    // sobre trabalho já commitado no worktree.
    const { stageData: seededStageData, startStage } = await this.buildResumeState(
      macroTaskId,
      pipeline,
    );

    const session = await this.prisma.session.create({
      data: {
        macroTaskId,
        agentId,
        branchName,
        worktreePath: '', // preenchido pelo runtime ao criar o worktree
        currentStage: startStage,
        status: 'initializing',
        ...(seededStageData ? { stageData: seededStageData } : {}),
        // Congela o pipeline no start (contratos §5). Gravado junto do create
        // para não existir janela em que a sessão roda sem snapshot. Guarda a
        // definição normalizada INTEIRA — inclusive `defaults` — para o
        // resolver de config ainda distinguir a camada do pipeline da do stage.
        context: {
          pipelineSnapshot: pipeline as unknown as Prisma.InputJsonValue,
          snapshotAt: new Date().toISOString(),
          pipelineId: macroTask.pipelineId,
          ...(runtimeOverride
            ? { runtimeOverride: runtimeOverride as unknown as Prisma.InputJsonValue }
            : {}),
        },
      },
    });
    await this.redis.publish(CHANNELS.SESSION_CREATED, session);

    if (seededStageData) {
      const carried = Object.keys(seededStageData).filter((k) => !k.startsWith('_'));
      this.logger.log(
        `Session ${session.id} resumes task ${macroTaskId} at stage "${startStage}" ` +
          `(${carried.length} completed stage(s) carried over from session ${seededStageData._resume?.fromSessionId})`,
      );
      await this.log(
        session.id,
        `Resuming pipeline at stage "${startStage}" — ${carried.length} stage(s) already completed in a previous session: ${carried.join(', ')}`,
        { stage: startStage, resumedFrom: seededStageData._resume?.fromSessionId },
      );
    }

    await this.prisma.macroTask.update({
      where: { id: macroTaskId },
      data: { status: 'running' },
    });

    try {
      await this.sessionRuntime.startSession(session.id);
    } catch (error) {
      await this.handleStageFailure(session.id, startStage, error);
      throw error;
    }

    await this.executeStage(session.id, startStage);
    return this.prisma.session.findUnique({ where: { id: session.id } });
  }

  /**
   * Monta o estado de retomada de uma task: herda os stages já completados da
   * sessão anterior mais recente que morreu no meio (failed/stopped/timeout) e
   * aponta o stage inicial para o primeiro incompleto. Se não há sessão
   * anterior aproveitável, começa do stage 1 sem herança.
   */
  private async buildResumeState(
    macroTaskId: string,
    pipeline: PipelineDefinition,
  ): Promise<{ stageData: Record<string, any> | null; startStage: string }> {
    const stageNames = pipeline.stages.map((s) => s.name);
    const firstStage = stageNames[0];

    const prior = await this.prisma.session.findFirst({
      where: { macroTaskId, status: { in: ['failed', 'stopped', 'timeout'] } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true, currentStage: true, stageData: true },
    });
    if (!prior?.stageData) return { stageData: null, startStage: firstStage };

    const priorData = prior.stageData as Record<string, any>;
    const carried: Record<string, any> = {};
    for (const name of stageNames) {
      if (priorData[name]?.completedAt) {
        carried[name] = { ...priorData[name], resumedFrom: prior.id };
      }
    }
    if (Object.keys(carried).length === 0) {
      return { stageData: null, startStage: firstStage };
    }

    // Primeiro stage sem completedAt; se tudo estava completo (morreu depois do
    // último stage, ex.: merge), reexecuta o último.
    const startStage =
      stageNames.find((name) => !carried[name]?.completedAt) ??
      stageNames[stageNames.length - 1];

    carried._resume = {
      fromSessionId: prior.id,
      fromStatus: prior.status,
      interruptedStage: prior.currentStage,
      lastProgress: priorData.progress ?? null,
      resumedAt: new Date().toISOString(),
    };
    return { stageData: carried, startStage };
  }

  async executeStage(sessionId: string, stageName: string): Promise<void> {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        macroTask: { include: { pipeline: true, project: true } },
        agent: { include: { cliProfile: true } },
      },
    });
    if (!session) throw new NotFoundException('Session not found');

    const pipeline = this.loadSessionPipeline(session);
    const stage = this.getStage(pipeline, stageName);
    if (!stage) throw new Error(`Stage ${stageName} not found in pipeline`);

    await this.prisma.session.update({
      where: { id: sessionId },
      data: { currentStage: stageName, status: 'running' },
    });

    await this.log(sessionId, `Starting stage: ${stageName}`, { stage: stageName });
    await this.redis.publish(CHANNELS.STAGE_START, { sessionId, stage: stageName });

    if (stage.timeout) {
      await this.scheduleTimeout(sessionId, stageName, stage.timeout);
    } else {
      await this.scheduleTimeout(sessionId, stageName, 30);
    }

    // Só existem dois modos: "engine" (orquestrador) e "interactive" (default).
    // O antigo modo headless foi removido; pipelines legados que ainda o tenham
    // gravado chegam aqui já convertidos para "interactive" pelo fallback de
    // normalizePipelineDefinition (pipelines/pipeline-definition.ts).
    const mode = stage.mode || (stageName === 'Merge' ? 'engine' : 'interactive');

    if (mode === 'engine') {
      // Executado pelo orquestrador (Merge) — roda async para não travar chamador
      void this.handleMergeStage(sessionId).catch((error) =>
        this.handleStageFailure(sessionId, stageName, error),
      );
      return;
    }

    // Runtime da fase (contratos §3): se o stage pede um profile/model/
    // permissionMode diferente do que o CLI subiu, o runtime reinicia o CLI com
    // os args novos. Nunca derruba o stage.
    try {
      const applied = await this.sessionRuntime.applyPhaseRuntime(sessionId, stageName);
      if (applied.restarted) {
        await this.log(sessionId, `CLI restarted for stage "${stageName}": ${applied.reason}`, {
          stage: stageName,
        });
      }
    } catch (error) {
      this.logger.warn(
        `applyPhaseRuntime failed for ${sessionId}/${stageName}: ${error.message}`,
      );
    }

    // Mesma resolução que subiu o CLI, agora para o prompt: skills e subagentes
    // não viram args do processo, só instrução no texto do stage. Só entra no
    // prompt o que existe no disco — citar subagente inexistente faz o agente
    // inventar um.
    let capabilities: { skills: string[]; subagents: string[] } | undefined;
    try {
      const { config } = await this.sessionRuntime.resolveStageRuntime(session, stageName);
      const available = await this.sessionRuntime.filterAvailableCliFiles(session.worktreePath, {
        skills: config.skills,
        subagents: config.subagents,
      });
      capabilities = { skills: available.skills, subagents: available.subagents };
      if (available.missing.length > 0) {
        await this.log(
          sessionId,
          `Stage "${stageName}": ignoring ${available.missing.join(', ')} — not found in the worktree`,
          { stage: stageName },
        );
      }
    } catch (error) {
      this.logger.warn(
        `Failed to resolve stage runtime for ${sessionId}/${stageName}: ${error.message}`,
      );
    }

    const prompt = this.buildStagePrompt(session, stage, capabilities);

    // interactive (default): prompt na sessão CLI viva
    await this.sessionRuntime.sendPrompt(sessionId, prompt);
  }

  buildStagePrompt(
    session: any,
    stage: PipelineStage,
    capabilities?: { skills: string[]; subagents: string[] },
  ): string {
    const macroTask = session.macroTask;
    const stageData = (session.stageData as any) || {};
    const previousStages = Object.entries(stageData)
      .filter(([key, value]: [string, any]) => value?.completedAt)
      .map(([key, value]: [string, any]) => `- ${key}: ${value.summary || 'completed'}`)
      .join('\n');

    const body =
      stage.promptTemplate ||
      `You are executing the "${stage.name}" stage of a development pipeline.`;

    // Mini-contexto de retomada: sessão nova continuando o trabalho de uma
    // sessão anterior interrompida — orienta o agente a se situar no worktree
    // e a NÃO refazer o que já está pronto.
    const resume = stageData._resume;
    const resumeBlock = resume
      ? `## Resuming an interrupted session
A previous session (${resume.fromSessionId}) for this same task ended with status "${resume.fromStatus}" while at stage "${resume.interruptedStage}". This session CONTINUES that work in the SAME worktree/branch — the stages under "Previous stages" are already done and committed. Do NOT redo them.
- Start by running \`git status\` and \`git log --oneline -10\` to see what already exists.
- If you find the work of the CURRENT stage already (partially) done, verify it briefly, fix only what is missing, and call \`complete_stage\` — do not recreate existing files from scratch.
${resume.lastProgress?.summary ? `- Last progress reported before the interruption (stage "${resume.lastProgress.stage}"): ${resume.lastProgress.summary}\n` : ''}
`
      : '';

    // Skills e subagentes resolvidos para este stage (contratos §1/§3). Só
    // chegam aqui os que existem no disco, filtrados em `executeStage`.
    const skills = capabilities?.skills ?? [];
    const subagents = capabilities?.subagents ?? [];
    const capabilitiesBlock =
      skills.length || subagents.length
        ? `\n## Skills and subagents for this stage
${skills.length ? `- Load these skills BEFORE starting the work and follow them: ${skills.map((s) => `\`${s}\``).join(', ')}. Use the Skill tool with the exact name.\n` : ''}${subagents.length ? `- Delegate to these subagents whenever the work matches what they are for: ${subagents.map((s) => `\`${s}\``).join(', ')}. Launch them with the Agent/Task tool (subagent_type = the name). Independent work goes to parallel subagents; you stay responsible for the final result.\n` : ''}`
        : '';

    return `${body}

## Task
${macroTask.title}
${macroTask.description || ''}

${resumeBlock}${previousStages ? `## Previous stages\n${previousStages}\n` : ''}${capabilitiesBlock}
## Rules for this stage
- Work ONLY on the scope of the "${stage.name}" stage. Do not advance beyond it.
- You have MCP tools from the "orchestrator" server. Use them:
  - \`get_task\` to fetch full task context, previous artifacts and answered questions.
  - \`report_progress\` to report progress as you work.
  - \`submit_question\` + \`await_answer\` when you need a decision or information you cannot infer. \`await_answer\` waits up to ~800s per call (the MCP transport can drop longer calls even though the question gets answered — MT-26) — if it returns {timeout:true} or the call itself errors out, call \`get_task\` first (the answer may already be there) before calling \`await_answer\` again.
  - \`save_artifact\` to persist stage outputs (spec, task breakdown, review notes, test reports).
  - \`log\` for relevant progress notes.
- When the stage is fully done, you MUST call \`complete_stage\` with stage="${stage.name}" and a short summary of what was done. This is how the pipeline advances.`;
  }

  // ------------------------------------------------------------- handlers

  private async onStageComplete(event: StageEvent) {
    const { sessionId, stage } = event;
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: { id: true, currentStage: true, status: true },
    });
    if (!session) return;
    // dedup: sinal atrasado/duplicado (MCP + exit) ou sessão já finalizada
    if (session.currentStage !== stage) {
      this.logger.warn(
        `Ignoring stage-complete for ${stage} (session ${sessionId} is at ${session.currentStage})`,
      );
      return;
    }
    if (['completed', 'failed', 'timeout'].includes(session.status)) return;

    await this.handleStageCompletion(sessionId, stage, {
      summary: event.summary,
      source: event.source || 'mcp',
    });
  }

  private async onStageFailed(event: StageEvent) {
    const session = await this.prisma.session.findUnique({
      where: { id: event.sessionId },
      select: { currentStage: true, status: true },
    });
    if (!session || session.currentStage !== event.stage) return;
    if (['completed', 'failed', 'timeout'].includes(session.status)) return;
    await this.handleStageFailure(event.sessionId, event.stage, new Error(event.error || 'unknown'));
  }

  private async onQuestionCreated(event: QuestionEvent) {
    const session = await this.prisma.session.findUnique({
      where: { id: event.sessionId },
      select: { status: true },
    });
    if (!session || session.status !== 'running') return;
    await this.prisma.session.update({
      where: { id: event.sessionId },
      data: { status: 'waiting' },
    });
    await this.redis.publish(CHANNELS.SESSION_PAUSED, {
      sessionId: event.sessionId,
      reason: `Waiting for question: ${event.question?.slice(0, 120)}`,
    });
  }

  private async onQuestionAnswered(event: QuestionEvent) {
    const session = await this.prisma.session.findUnique({
      where: { id: event.sessionId },
      select: { id: true, status: true, stageData: true },
    });
    if (!session) return;

    const pending = await this.prisma.question.count({
      where: { sessionId: event.sessionId, status: 'pending' },
    });
    if (pending > 0) return;

    const stageData = (session.stageData as any) || {};

    // Sessão pausada entre stages (onQuestion: pause) com próximo stage
    // agendado: retomar executa o nextStage armazenado.
    if (session.status === 'paused' && stageData.nextStage) {
      await this.resumeSession(event.sessionId);
      return;
    }

    if (session.status === 'waiting' || session.status === 'paused') {
      await this.prisma.session.update({
        where: { id: event.sessionId },
        data: { status: 'running' },
      });
      await this.redis.publish(CHANNELS.SESSION_RESUMED, { sessionId: event.sessionId });
    }

    // Se o agente está bloqueado em await_answer, a resposta chega por lá.
    // Caso contrário, entrega via terminal.
    if (!stageData.awaiting && this.sessionRuntime.isRunning(event.sessionId)) {
      await this.sessionRuntime.sendPrompt(
        event.sessionId,
        `Answer to your question "${event.question?.slice(0, 200)}": ${event.answer}`,
      );
    }
  }

  // --------------------------------------------------------------- estados

  async handleStageCompletion(sessionId: string, stageName: string, result: any): Promise<void> {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: { macroTask: { include: { pipeline: true } } },
    });
    if (!session) throw new NotFoundException('Session not found');

    const currentStageData = (session.stageData as any) || {};
    currentStageData[stageName] = {
      completedAt: new Date().toISOString(),
      summary: result?.summary,
      source: result?.source,
    };

    await this.prisma.session.update({
      where: { id: sessionId },
      data: { stageData: currentStageData },
    });

    await this.log(sessionId, `Stage completed: ${stageName}`, { stage: stageName });
    await this.advanceToNextStage(sessionId);
  }

  async advanceToNextStage(sessionId: string): Promise<void> {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: { macroTask: { include: { pipeline: true } } },
    });
    if (!session) throw new NotFoundException('Session not found');

    const pipeline = this.loadSessionPipeline(session);
    const currentStage = session.currentStage;

    if (this.isLastStage(pipeline, currentStage)) {
      await this.completeSession(sessionId);
      return;
    }

    // Pula stages já completados (herdados de uma sessão anterior via resume)
    const advanceStageData = (session.stageData as any) || {};
    let nextStage = this.getNextStage(pipeline, currentStage);
    while (nextStage && advanceStageData[nextStage.name]?.completedAt) {
      await this.log(
        sessionId,
        `Stage already completed in a previous session — skipping: ${nextStage.name}`,
        { stage: nextStage.name, source: 'resume' },
      );
      nextStage = this.getNextStage(pipeline, nextStage.name);
    }
    if (!nextStage) {
      await this.completeSession(sessionId);
      return;
    }

    if (nextStage.onQuestion === 'pause') {
      const pendingQuestions = await this.prisma.question.count({
        where: { sessionId, status: 'pending' },
      });
      if (pendingQuestions > 0) {
        await this.pauseSession(
          sessionId,
          `Waiting for ${pendingQuestions} question(s) before stage ${nextStage.name}`,
        );
        // guarda o próximo stage para retomar depois
        const stageData = ((await this.prisma.session.findUnique({
          where: { id: sessionId },
          select: { stageData: true },
        }))?.stageData as any) || {};
        await this.prisma.session.update({
          where: { id: sessionId },
          data: { stageData: { ...stageData, nextStage: nextStage.name } },
        });
        return;
      }
    }

    await this.executeStage(sessionId, nextStage.name);
  }

  async handleStageFailure(sessionId: string, stageName: string, error: Error): Promise<void> {
    await this.cancelPendingStageTimeouts(sessionId, `stage "${stageName}" failed`);
    await this.log(sessionId, `Stage failed: ${stageName} - ${error.message}`, {
      stage: stageName,
      error: error.message,
    }, 'error');

    await this.prisma.session.update({
      where: { id: sessionId },
      data: { status: 'failed' },
    });

    await this.redis.publish(CHANNELS.STAGE_FAILED, {
      sessionId,
      stage: stageName,
      error: error.message,
      source: 'engine',
    });
    await this.redis.publish(CHANNELS.SESSION_STATUS, { sessionId, status: 'failed' });
  }

  async pauseSession(sessionId: string, reason: string): Promise<void> {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    const currentStageData = (session?.stageData as any) || {};

    await this.prisma.session.update({
      where: { id: sessionId },
      data: {
        status: 'paused',
        stageData: {
          ...currentStageData,
          pauseReason: reason,
          pausedAt: new Date().toISOString(),
        },
      },
    });

    await this.log(sessionId, `Session paused: ${reason}`);
    await this.redis.publish(CHANNELS.SESSION_PAUSED, { sessionId, reason });
  }

  /**
   * Pula o stage atual manualmente (humano decide que ele não se aplica):
   * marca como skipped no stageData e avança o pipeline. Só para sessões
   * ainda vivas (running/waiting/paused).
   */
  async skipStage(sessionId: string, reason?: string): Promise<{ skipped: string }> {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Session not found');
    if (!['running', 'waiting', 'paused'].includes(session.status)) {
      throw new BadRequestException(
        `Cannot skip stage of a ${session.status} session — only running/waiting/paused`,
      );
    }

    const skipped = session.currentStage;
    const stageData = (session.stageData as any) || {};
    stageData[skipped] = {
      completedAt: new Date().toISOString(),
      summary: reason || 'Skipped manually by the user',
      source: 'skip',
    };
    // nextStage pendente não faz mais sentido: o avanço parte do stage atual
    delete stageData.nextStage;
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { stageData, status: 'running' },
    });

    await this.log(sessionId, `Stage skipped: ${skipped}${reason ? ` — ${reason}` : ''}`, {
      stage: skipped,
      source: 'skip',
    });
    await this.redis.publish(CHANNELS.STAGE_COMPLETE, {
      sessionId,
      stage: skipped,
      summary: reason || 'Skipped manually',
      source: 'engine',
    });
    await this.advanceToNextStage(sessionId);
    return { skipped };
  }

  async resumeSession(sessionId: string): Promise<void> {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Session not found');

    await this.prisma.session.update({
      where: { id: sessionId },
      data: { status: 'running' },
    });
    await this.log(sessionId, 'Session resumed');
    await this.redis.publish(CHANNELS.SESSION_RESUMED, { sessionId });

    const stageData = (session.stageData as any) || {};
    const targetStage = stageData.nextStage || session.currentStage;

    if (!this.sessionRuntime.isRunning(sessionId)) {
      // runtime morreu (restart do backend) — resumeSession REANEXA ao tmux
      // vivo; startSession aqui colaria o comando de boot dentro do CLI já
      // rodando (viraria um prompt lixo).
      await this.sessionRuntime.resumeSession(sessionId);
    }
    if (stageData.nextStage) {
      const cleaned = { ...stageData };
      delete cleaned.nextStage;
      await this.prisma.session.update({
        where: { id: sessionId },
        data: { stageData: cleaned },
      });
    }
    await this.executeStage(sessionId, targetStage);
  }

  async retryStage(sessionId: string, pipelineId: string): Promise<void> {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: { macroTask: { include: { pipeline: true } } },
    });
    if (!session) throw new NotFoundException('Session not found');
    if (!['failed', 'paused'].includes(session.status)) {
      throw new Error(`Cannot retry stage: session status is ${session.status} (must be failed or paused)`);
    }

    const currentStage = session.currentStage;
    const stageData = (session.stageData as any) || {};
    delete stageData[`${currentStage}_error`];

    await this.prisma.session.update({
      where: { id: sessionId },
      data: { status: 'running', stageData: stageData },
    });

    await this.log(sessionId, `Retrying stage: ${currentStage}`, { stage: currentStage });
    await this.redis.publish(CHANNELS.SESSION_STATUS, { sessionId, status: 'running' });

    if (!this.sessionRuntime.isRunning(sessionId)) {
      // reanexa ao tmux vivo em vez de colar o boot num CLI já rodando
      await this.sessionRuntime.resumeSession(sessionId);
    }

    await this.executeStage(sessionId, currentStage);
  }

  private async completeSession(sessionId: string): Promise<void> {
    await this.cancelPendingStageTimeouts(sessionId, 'session completed');
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { status: 'completed', completedAt: new Date() },
    });

    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: { macroTaskId: true },
    });
    if (session) {
      await this.prisma.macroTask.update({
        where: { id: session.macroTaskId },
        data: { status: 'done' },
      });
    }

    await this.log(sessionId, 'Session completed successfully');
    await this.redis.publish(CHANNELS.SESSION_COMPLETED, { sessionId });

    // encerra CLI/tmux; worktree fica para o job de cleanup
    await this.sessionRuntime.stop(sessionId).catch(() => undefined);
    await this.prisma.scheduledJob.create({
      data: {
        type: 'cleanup_worktrees',
        payload: { sessionId },
        scheduledAt: new Date(Date.now() + 5 * 60_000),
      },
    });
  }

  // ----------------------------------------------------------------- merge

  /** Notifica a UI (/git) que o estado git do projeto mudou. Nunca quebra o merge. */
  private async publishGitChanged(event: GitChangedEvent): Promise<void> {
    try {
      await this.redis.publish(CHANNELS.GIT_CHANGED, event);
    } catch (error) {
      this.logger.warn(`Failed to publish git:changed (${event.reason}): ${error.message}`);
    }
  }

  /** Tentativas de rebase+merge antes de escalar o conflito para um humano. */
  private static readonly MERGE_ATTEMPTS = 3;

  /** Quanto o agente da sessão tem para resolver os conflitos de um rebase. */
  private static readonly CONFLICT_RESOLUTION_TIMEOUT_MS = 5 * 60_000;

  /** Intervalo do polling que observa o agente resolvendo o rebase. */
  private static readonly CONFLICT_POLL_INTERVAL_MS = 15_000;

  private async handleMergeStage(sessionId: string): Promise<void> {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: { macroTask: { include: { project: true } } },
    });
    if (!session) throw new NotFoundException('Session not found');
    const project = session.macroTask.project;

    await this.log(sessionId, 'Starting merge stage', { stage: 'Merge' });

    // Restart do backend no meio da resolução de um conflito deixa o worktree
    // com rebase pendente e ninguém observando: commitar por cima disso criaria
    // commit no meio da sequência do rebase.
    const pending = await this.workspace
      .rebaseState(session.worktreePath)
      .catch(() => ({ inProgress: false, conflicts: [] }));
    if (pending.inProgress) {
      await this.log(sessionId, 'Aborting a rebase left in progress by a previous run', {
        stage: 'Merge',
      });
      await this.workspace.abortRebase(session.worktreePath);
    }

    const committed = await this.workspace.commitChanges(
      session.worktreePath,
      `Complete: ${session.macroTask.title}`,
    );
    if (committed) {
      await this.publishGitChanged({
        projectId: project.id,
        reason: 'commit',
        ts: new Date().toISOString(),
        sessionId,
        branch: session.branchName,
      });
    }

    const mainBranch = await this.workspace.getMainBranch(project.mainPath);
    let mergeResult: { merged: boolean; conflicts?: string[]; mainBranch: string } | undefined;

    for (let attempt = 1; attempt <= PipelineEngineService.MERGE_ATTEMPTS; attempt++) {
      // Rebase fora do lock: pode demorar minutos (agente resolvendo conflito) e
      // não toca o repositório principal — segurar a fila aqui atrasaria todo mundo.
      const rebase = await this.rebaseWithAgentHelp(sessionId, session, mainBranch, attempt);
      if (!rebase.ok) {
        await this.escalateMergeConflict(sessionId, session.branchName, mainBranch, rebase);
        return;
      }

      // Dentro do lock só entra o merge, que é rápido: um merge por vez por
      // mainPath, senão dois processos disputam index e HEAD do repo principal.
      const outcome = await this.mergeQueue.runExclusive(
        {
          mainPath: project.mainPath,
          holderId: sessionId,
          // Falha ao logar não pode derrubar um merge que está só esperando a vez.
          onWait: ({ position, waitedMs }) =>
            this.log(
              sessionId,
              `Waiting for the merge queue of ${project.mainPath}: position ${position}, ${Math.round(waitedMs / 1000)}s elapsed`,
              { stage: 'Merge' },
            ).catch(() => undefined),
        },
        async () => {
          // `main` pode ter andado enquanto o agente resolvia: um último rebase,
          // barato quando não há nada novo para replicar.
          const recheck = await this.workspace.rebaseOnto(session.worktreePath, mainBranch);
          if (!recheck.ok) {
            await this.workspace.abortRebase(session.worktreePath);
            return { retry: true as const, conflicts: recheck.conflicts };
          }
          return {
            retry: false as const,
            merge: await this.workspace.mergeToMain(project.mainPath, session.branchName, {
              message: `Merge ${session.branchName}: ${session.macroTask.title}`,
              fastForward: true,
            }),
          };
        },
      );

      if (!outcome.retry) {
        mergeResult = outcome.merge;
        break;
      }

      await this.log(
        sessionId,
        `${mainBranch} moved while conflicts were being resolved — rebasing again (attempt ${attempt}/${PipelineEngineService.MERGE_ATTEMPTS})`,
        { stage: 'Merge' },
      );
    }

    if (!mergeResult || !mergeResult.merged) {
      await this.escalateMergeConflict(sessionId, session.branchName, mainBranch, {
        conflicts: mergeResult?.conflicts || [],
        // Sem `mergeResult` o loop esgotou as tentativas; com ele, o merge em si
        // conflitou mesmo depois do rebase ter passado.
        reason: mergeResult ? 'merge-conflict' : 'attempts-exhausted',
      });
      return;
    }

    await this.publishGitChanged({
      projectId: project.id,
      reason: 'merge',
      ts: new Date().toISOString(),
      sessionId,
      branch: session.branchName,
    });

    const artifact = await this.prisma.sDDArtifact.create({
      data: {
        sessionId,
        type: 'merge',
        path: `${mergeResult.mainBranch}`,
        content: JSON.stringify({
          branch: session.branchName,
          mainBranch: mergeResult.mainBranch,
          mergedAt: new Date().toISOString(),
        }),
        metadata: { stage: 'Merge' },
      },
    });
    await this.redis.publish(CHANNELS.ARTIFACT_CREATED, {
      sessionId,
      id: artifact.id,
      type: artifact.type,
      path: artifact.path,
    });

    // PR opcional: apenas remote GitHub + token
    if (process.env.GITHUB_TOKEN && (await this.workspace.hasRemote(project.mainPath))) {
      try {
        const pr = await this.workspace.createPullRequest(
          project.mainPath,
          session.branchName,
          session.macroTask.title,
          session.macroTask.description || '',
        );
        await this.prisma.sDDArtifact.create({
          data: {
            sessionId,
            type: 'pull-request',
            path: pr.prUrl,
            content: JSON.stringify(pr),
            metadata: { stage: 'Merge' },
          },
        });
      } catch (error) {
        await this.log(sessionId, `PR creation skipped: ${error.message}`, {}, 'warn');
      }
    }

    await this.log(sessionId, `Merged ${session.branchName} into ${mergeResult.mainBranch}`);
    await this.handleStageCompletion(sessionId, session.currentStage, {
      summary: `Merged into ${mergeResult.mainBranch}`,
      source: 'engine',
    });
  }

  /**
   * Rebase da branch da sessão sobre `main`, devolvendo o conflito ao agente
   * antes de chamar um humano: ele conhece o próprio diff e resolve em segundos
   * o que a fila de perguntas levaria horas para desbloquear.
   *
   * Só escala quando o conflito é em arquivo que a branch nunca tocou (diff de
   * outra task), quando o agente não resolve dentro do tempo, ou quando o CLI da
   * sessão já não está de pé.
   */
  private async rebaseWithAgentHelp(
    sessionId: string,
    session: { worktreePath: string; branchName: string },
    mainBranch: string,
    attempt: number,
  ): Promise<{ ok: boolean; conflicts?: string[]; reason?: string }> {
    // Calculado antes do rebase: durante o rebase o HEAD fica destacado.
    const ownedFiles = await this.workspace
      .changedFiles(session.worktreePath, mainBranch)
      .catch(() => [] as string[]);

    const rebase = await this.workspace.rebaseOnto(session.worktreePath, mainBranch);
    if (rebase.ok) {
      await this.log(sessionId, `Rebased ${session.branchName} onto ${mainBranch}`, {
        stage: 'Merge',
      });
      return { ok: true };
    }

    const foreign = rebase.conflicts.filter((file) => !ownedFiles.includes(file));
    if (foreign.length > 0) {
      await this.workspace.abortRebase(session.worktreePath);
      return { ok: false, conflicts: rebase.conflicts, reason: 'foreign-files' };
    }

    if (!this.sessionRuntime.isRunning(sessionId)) {
      await this.workspace.abortRebase(session.worktreePath);
      return { ok: false, conflicts: rebase.conflicts, reason: 'cli-not-running' };
    }

    await this.log(
      sessionId,
      `Rebase onto ${mainBranch} hit ${rebase.conflicts.length} conflict(s) — asking the session agent to resolve (attempt ${attempt}/${PipelineEngineService.MERGE_ATTEMPTS})`,
      { stage: 'Merge' },
    );

    await this.sessionRuntime.sendPrompt(
      sessionId,
      [
        `O rebase da sua branch \`${session.branchName}\` sobre \`${mainBranch}\` parou com conflito.`,
        '',
        `Arquivos em conflito: ${rebase.conflicts.join(', ')}`,
        '',
        'Resolva os conflitos no worktree, faça `git add` dos arquivos resolvidos e rode',
        '`git rebase --continue`. Mantenha as duas intenções quando fizer sentido — o outro',
        'lado é trabalho de outra task, não descarte por descarte. Não rode `git rebase --abort`.',
        'Não responda nada por aqui: o orquestrador está observando o estado do rebase e segue',
        'sozinho assim que ele terminar.',
      ].join('\n'),
    );

    const resolved = await this.waitForConflictResolution(sessionId, session.worktreePath);
    if (!resolved) {
      await this.workspace.abortRebase(session.worktreePath);
      return { ok: false, conflicts: rebase.conflicts, reason: 'agent-timeout' };
    }

    await this.log(sessionId, `Conflicts resolved by the session agent on ${mainBranch}`, {
      stage: 'Merge',
    });
    return { ok: true };
  }

  /**
   * Observa o rebase até o agente terminar. Loga a cada ciclo: a sessão está
   * `running` sem produzir output no terminal e não pode parecer travada.
   */
  private async waitForConflictResolution(
    sessionId: string,
    worktreePath: string,
  ): Promise<boolean> {
    const deadline = Date.now() + PipelineEngineService.CONFLICT_RESOLUTION_TIMEOUT_MS;

    while (Date.now() < deadline) {
      await new Promise((resolve) =>
        setTimeout(resolve, PipelineEngineService.CONFLICT_POLL_INTERVAL_MS),
      );

      const state = await this.workspace.rebaseState(worktreePath);
      if (!state.inProgress) return true;

      if (state.conflicts.length === 0) {
        // Agente resolveu e deu `git add`, mas não continuou o rebase.
        const continued = await this.workspace.continueRebase(worktreePath);
        if (continued.ok) return true;
      }

      await this.log(
        sessionId,
        `Waiting for the session agent to resolve ${state.conflicts.length} rebase conflict(s)`,
        { stage: 'Merge' },
      );
    }

    return false;
  }

  /** Último recurso: conflito que o agente não resolveu vira pergunta humana. */
  private async escalateMergeConflict(
    sessionId: string,
    branchName: string,
    mainBranch: string,
    failure: { conflicts?: string[]; reason?: string },
  ): Promise<void> {
    const why =
      {
        'foreign-files': 'the conflict touches files this task does not own',
        'agent-timeout': 'the session agent did not resolve them in time',
        'cli-not-running': 'the session CLI is no longer running',
        'merge-conflict': 'the merge still conflicts after a clean rebase',
        'attempts-exhausted': `${PipelineEngineService.MERGE_ATTEMPTS} rebase+merge attempts failed`,
      }[failure.reason] || failure.reason;

    const question = await this.prisma.question.create({
      data: {
        sessionId,
        question: `Merge of ${branchName} into ${mainBranch} has conflicts in: ${(failure.conflicts || []).join(', ')} — escalated because ${why}. Resolve manually and answer "done" to retry, or answer "abort" to fail the session.`,
        priority: 'high',
        metadata: {
          kind: 'merge-conflict',
          conflicts: failure.conflicts || [],
          reason: failure.reason,
        },
      },
    });
    await this.redis.publish(CHANNELS.QUESTION_CREATED, {
      id: question.id,
      sessionId,
      question: question.question,
      priority: question.priority,
      status: question.status,
    });
    await this.pauseSession(sessionId, 'Merge conflicts require human resolution');
  }

  // ------------------------------------------------------------------ misc

  /**
   * Cancela stage_timeouts pendentes da sessão. Sem isso, cada estágio novo
   * (ou retry) empilha jobs obsoletos que poluem o Scheduler e disparam horas
   * depois contra sessões que já avançaram/morreram.
   */
  private async cancelPendingStageTimeouts(sessionId: string, reason: string): Promise<void> {
    await this.prisma.scheduledJob
      .updateMany({
        where: {
          type: 'stage_timeout',
          status: 'pending',
          payload: { path: ['sessionId'], equals: sessionId },
        },
        data: { status: 'cancelled', result: { cancelled: reason } },
      })
      .catch((error) =>
        this.logger.warn(`Failed to cancel stage timeouts for ${sessionId}: ${error.message}`),
      );
  }

  private async scheduleTimeout(
    sessionId: string,
    stageName: string,
    timeoutMinutes: number,
  ): Promise<void> {
    // no máximo UM stage_timeout ativo por sessão
    await this.cancelPendingStageTimeouts(sessionId, `superseded by stage "${stageName}"`);

    const scheduledAt = new Date();
    scheduledAt.setMinutes(scheduledAt.getMinutes() + timeoutMinutes);

    await this.prisma.scheduledJob.create({
      data: {
        type: 'stage_timeout',
        payload: { sessionId, stageName },
        scheduledAt,
      },
    });
  }

  private async log(
    sessionId: string,
    message: string,
    metadata: Record<string, any> = {},
    level: 'info' | 'warn' | 'error' = 'info',
  ) {
    await this.prisma.logEntry.create({
      data: { sessionId, level, message, metadata },
    });
  }

  async getExecutionStatus(sessionId: string): Promise<any> {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        macroTask: { include: { pipeline: true } },
        questions: true,
        artifacts: true,
        logs: { orderBy: { createdAt: 'desc' }, take: 50 },
      },
    });
    if (!session) throw new NotFoundException('Session not found');

    const pipeline = this.loadSessionPipeline(session);
    const stageData = (session.stageData as any) || {};

    const stages = pipeline.stages.map((stage) => ({
      name: stage.name,
      status: stageData[stage.name]?.completedAt
        ? 'completed'
        : session.currentStage === stage.name
          ? session.status === 'failed'
            ? 'failed'
            : 'running'
          : 'pending',
      completedAt: stageData[stage.name]?.completedAt,
      summary: stageData[stage.name]?.summary,
    }));

    return {
      sessionId,
      status: session.status,
      currentStage: session.currentStage,
      stages,
      questions: {
        total: session.questions.length,
        pending: session.questions.filter((q) => q.status === 'pending').length,
        answered: session.questions.filter((q) => q.status === 'answered').length,
      },
      artifacts: session.artifacts.length,
      logs: session.logs,
      pauseReason: stageData.pauseReason,
    };
  }
}
