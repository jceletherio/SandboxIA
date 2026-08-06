import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { CHANNELS } from '../redis/channels';
import {
  MASTER_CHAT_RUN_KEY,
  MASTER_CHAT_SESSION_KEY,
  MasterState,
  masterStateKey,
  masterTokenIndexKey,
} from '../redis/keys';
import { ContextService } from '../context/context.service';
import { PipelineEngineService } from '../pipeline-engine/pipeline-engine.service';
import { QueuedStart, stripQueueMarker } from '../scheduler/session-governor.service';
import { SessionsService } from '../sessions/sessions.service';
import { QuestionsService } from '../questions/questions.service';
import {
  SessionRuntimeService,
  SessionRuntimeOverride,
} from '../session-runtime/session-runtime.service';
import { CliFilesService } from '../cli-files/cli-files.service';
import { ScheduledJobsService } from '../scheduled-jobs/scheduled-jobs.service';
import { MASTER_LOOP_JOB_TYPE } from '../scheduled-jobs/master-loop';
import {
  PipelineDefaults,
  PipelineDefinition,
  PipelineKind,
  PipelineStage,
  normalizePipelineDefinition,
  validatePipelineDefinition,
} from '../pipelines/pipeline-definition';
import {
  invalidMacroTaskStatusMessage,
  normalizeMacroTaskStatus,
  type MacroTaskStatus,
} from '../domain';
import { randomUUID } from 'crypto';

/** Telemetria de runtime de uma sessão (contrato do SessionRuntimeService). */
interface RuntimeTelemetry {
  hasPty: boolean;
  tmuxAlive: boolean;
  lastOutputAt: string | null;
  lastScreen?: string;
}

/** Status considerados "vivos" para fins de telemetria. */
const ACTIVE_SESSION_STATUSES = ['initializing', 'running', 'waiting', 'paused'];

/**
 * Teto do `await_answer` (MT-26): o transporte do cliente MCP corta a chamada
 * em ~900s não importa o `timeoutSeconds` pedido. 800s fica com folga real
 * antes desse corte, para a função devolver `{timeout:true}` de propósito em
 * vez de a chamada morrer sem resposta nenhuma.
 */
export const MAX_AWAIT_ANSWER_SECONDS = 800;

/**
 * Implementação das operações expostas como MCP tools.
 * A identidade (sessionId) já chega resolvida pelo controller via Bearer token.
 */
@Injectable()
export class McpServerService {
  private readonly logger = new Logger(McpServerService.name);
  private readonly rateLimits = new Map<string, { count: number; resetAt: number }>();
  private readonly maxCallsPerMinute = parseInt(process.env.MCP_MAX_CALLS_PER_MINUTE || '60', 10);

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    @Optional() private contextService?: ContextService,
    @Optional() private pipelineEngine?: PipelineEngineService,
    @Optional() private sessionsService?: SessionsService,
    @Optional() private questionsService?: QuestionsService,
    @Optional() private sessionRuntime?: SessionRuntimeService,
    @Optional() private scheduledJobs?: ScheduledJobsService,
    @Optional() private cliFiles?: CliFilesService,
  ) {}

  /**
   * Telemetria real do runtime (PTY/tmux) de uma sessão. Tolerante: retorna
   * null se o serviço/método ainda não estiver disponível.
   */
  private async getRuntimeTelemetry(sessionId: string): Promise<RuntimeTelemetry | null> {
    const runtime = this.sessionRuntime as unknown as
      | { getRuntimeTelemetry?: (id: string) => Promise<RuntimeTelemetry> }
      | undefined;
    if (!runtime?.getRuntimeTelemetry) return null;
    try {
      return await runtime.getRuntimeTelemetry(sessionId);
    } catch {
      return null;
    }
  }

  /** Telemetria sem o lastScreen (para listagens — screen só no get_session_screen). */
  private async getRuntimeSummary(sessionId: string) {
    const telemetry = await this.getRuntimeTelemetry(sessionId);
    if (!telemetry) return null;
    return {
      hasPty: telemetry.hasPty,
      tmuxAlive: telemetry.tmuxAlive,
      lastOutputAt: telemetry.lastOutputAt,
    };
  }

  private checkRateLimit(token: string): boolean {
    const now = Date.now();
    const entry = this.rateLimits.get(token);

    if (!entry || now >= entry.resetAt) {
      this.rateLimits.set(token, { count: 1, resetAt: now + 60_000 });
      return true;
    }

    if (entry.count >= this.maxCallsPerMinute) {
      return false;
    }

    entry.count++;
    return true;
  }

  /** Resolve o Bearer token para uma sessão. Retorna null se inválido. */
  async resolveToken(token: string) {
    if (!token) return null;
    if (!this.checkRateLimit(token)) {
      this.logger.warn(`Rate limit exceeded for token ${token.slice(0, 8)}...`);
      throw new Error(`Rate limit exceeded (${this.maxCallsPerMinute} calls/min). Wait before making more requests.`);
    }
    return this.prisma.session.findUnique({
      where: { mcpToken: token },
      select: { id: true, status: true },
    });
  }

  async getTask(sessionId: string) {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        macroTask: { include: { project: true, pipeline: true } },
        artifacts: { orderBy: { createdAt: 'asc' } },
        questions: { where: { status: 'answered' }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!session) return { error: 'session not found' };
    return {
      macroTask: {
        title: session.macroTask.title,
        description: session.macroTask.description,
      },
      project: {
        name: session.macroTask.project.name,
        description: session.macroTask.project.description,
      },
      currentStage: session.currentStage,
      branchName: session.branchName,
      artifacts: session.artifacts.map((a) => ({
        id: a.id,
        type: a.type,
        path: a.path,
        content: a.content?.slice(0, 4000),
      })),
      answeredQuestions: session.questions.map((q) => ({
        question: q.question,
        answer: q.answer,
      })),
    };
  }

  async submitQuestion(
    sessionId: string,
    question: string,
    priority: string = 'normal',
    metadata?: Record<string, unknown>,
  ) {
    const created = await this.prisma.question.create({
      data: {
        sessionId,
        question,
        priority,
        status: 'pending',
        metadata: (metadata as any) ?? undefined,
      },
    });
    await this.redis.publish(CHANNELS.QUESTION_CREATED, {
      id: created.id,
      sessionId,
      question: created.question,
      priority: created.priority,
      status: created.status,
      metadata: created.metadata,
    });
    return created;
  }

  /**
   * Aguarda a resposta da pergunta via Redis pub/sub (sem polling no banco).
   * Subscreve ao canal `question:{id}:answered` e espera notificação ou timeout.
   * Quando notificado, busca a resposta no banco uma única vez.
   *
   * MT-26: o cliente MCP/harness que hospeda a sessão corta a chamada em
   * ~900s independente do `timeoutSeconds` pedido (confirmado: 900/1800/3300
   * voltaram "The operation timed out" em ~15min todas as vezes, sem esse
   * transporte estar sob controle deste backend). Capar em
   * `MAX_AWAIT_ANSWER_SECONDS` aqui garante que a função SEMPRE retorna
   * `{timeout:true}` antes do transporte matar a chamada, para o agente poder
   * decidir o próximo passo (checar `get_task`, chamar de novo) em vez de
   * receber um erro de transporte sem contexto.
   */
  async awaitAnswer(sessionId: string, questionId: string, timeoutSeconds: number) {
    const cappedSeconds = Math.min(timeoutSeconds, MAX_AWAIT_ANSWER_SECONDS);
    const deadline = Date.now() + cappedSeconds * 1000;

    await this.setAwaitingFlag(sessionId, questionId);
    
    const channel = `question:${questionId}:answered`;
    let answered = false;
    let answerData: { answer: string | null; answeredAt: Date | null } | null = null;

    const handler = (message: any) => {
      if (message.questionId === questionId) {
        answered = true;
        answerData = { answer: message.answer, answeredAt: message.answeredAt };
      }
    };

    try {
      await this.redis.subscribe(channel, handler);

      while (!answered && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(5000, deadline - Date.now())));
      }

      if (answered && answerData) {
        return { answer: answerData.answer, answeredAt: answerData.answeredAt };
      }

      return { timeout: true, message: 'Not answered yet — call await_answer again to keep waiting' };
    } finally {
      await this.redis.unsubscribe(channel, handler);
      await this.clearAwaitingFlag(sessionId, questionId);
    }
  }

  private async setAwaitingFlag(sessionId: string, questionId: string) {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: { stageData: true },
    });
    const stageData = (session?.stageData as any) || {};
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { stageData: { ...stageData, awaiting: questionId } },
    });
  }

  private async clearAwaitingFlag(sessionId: string, questionId: string) {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: { stageData: true },
    });
    const stageData = (session?.stageData as any) || {};
    if (stageData.awaiting === questionId) {
      delete stageData.awaiting;
      await this.prisma.session.update({
        where: { id: sessionId },
        data: { stageData },
      });
    }
  }

  async reportProgress(sessionId: string, progress: { summary: string; percent?: number }) {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: { stageData: true, currentStage: true },
    });
    const stageData = (session?.stageData as any) || {};
    stageData.progress = {
      ...progress,
      stage: session?.currentStage,
      at: new Date().toISOString(),
    };
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { stageData },
    });
    await this.redis.publish(CHANNELS.SESSION_STATUS, {
      sessionId,
      status: 'running',
      progress: stageData.progress,
    });
    return { ok: true };
  }

  async completeStage(sessionId: string, stage: string, summary: string) {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: { currentStage: true, status: true },
    });
    if (!session) return { error: 'session not found' };
    if (session.currentStage !== stage) {
      return {
        error: `Current stage is "${session.currentStage}", not "${stage}". Call complete_stage with the current stage name.`,
      };
    }
    await this.redis.publish(CHANNELS.STAGE_COMPLETE, {
      sessionId,
      stage,
      summary,
      source: 'mcp',
    });
    this.logger.log(`Session ${sessionId}: stage ${stage} completed via MCP`);
    return { ok: true, message: `Stage "${stage}" marked as complete. The orchestrator will send the next stage instructions.` };
  }

  async saveArtifact(sessionId: string, type: string, path: string, content: string, metadata?: any) {
    const artifact = await this.prisma.sDDArtifact.create({
      data: { sessionId, type, path, content, metadata },
    });
    await this.redis.publish(CHANNELS.ARTIFACT_CREATED, {
      sessionId,
      id: artifact.id,
      type: artifact.type,
      path: artifact.path,
    });
    return artifact;
  }

  async requestApproval(sessionId: string, summary: string, diff?: string) {
    const question = await this.prisma.question.create({
      data: {
        sessionId,
        question: `[APPROVAL] ${summary}`,
        priority: 'high',
        status: 'pending',
        metadata: { kind: 'approval', diff },
      },
    });
    await this.redis.publish(CHANNELS.QUESTION_CREATED, {
      id: question.id,
      sessionId,
      question: question.question,
      priority: question.priority,
      status: question.status,
    });
    return question;
  }

  /**
   * `session.context` sem o que só interessa ao orquestrador. Desde a MT-0 o
   * `PipelineDefinition` inteiro mora ali (contratos §5) e devolvê-lo verbatim
   * despejava o pipeline no contexto do agente a cada `get_context`.
   */
  private agentVisibleContext(context: unknown): Record<string, unknown> {
    if (!context || typeof context !== 'object' || Array.isArray(context)) return {};
    const { pipelineSnapshot, snapshotAt, ...visible } = context as Record<string, unknown>;
    return visible;
  }

  async getContext(sessionId: string, query?: string) {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: { macroTask: { include: { project: true } } },
    });
    if (!session) return { error: 'session not found' };
    const projectId = session.macroTask.project.id;

    if (query && this.contextService) {
      const search = await this.contextService.search(query, projectId);
      return { project: session.macroTask.project.name, query, ...search };
    }
    if (this.contextService) {
      const files = await this.contextService.getFiles(projectId);
      // só o índice (sem conteúdo integral) para não estourar o contexto do agente
      const index = (['qmd', 'context', 'rules'] as const).flatMap((group) =>
        (files[group] || []).map((f: any) => ({
          group,
          path: f.relativePath,
          description: f.description,
        })),
      );
      return {
        project: session.macroTask.project.name,
        context: this.agentVisibleContext(session.context),
        docs: index,
        hint: 'Pass a query to search inside the docs',
      };
    }
    return {
      project: session.macroTask.project.name,
      context: this.agentVisibleContext(session.context),
    };
  }

  async log(sessionId: string, level: string, message: string, metadata?: any) {
    return this.prisma.logEntry.create({
      data: { sessionId, level, message, metadata: { ...metadata, source: 'mcp' } },
    });
  }

  /**
   * Resposta do agente da SESSÃO ao chat do dashboard (P3.1).
   * Equivalente ao `masterReplyChat`, mas escopado por `sessionId` — é o que
   * mantém o histórico de cada sessão separado do Master e das demais (CA2).
   * `projectId` fica nulo de propósito (o chat do Master lista por projectId).
   */
  async sessionReplyChat(sessionId: string, message: string) {
    const created = await this.prisma.chatMessage.create({
      data: { role: 'agent', content: message, sessionId },
    });
    await this.redis
      .publish(CHANNELS.SESSION_CHAT, {
        sessionId,
        messageId: created.id,
        role: 'agent',
        preview: message.slice(0, 500),
        ts: new Date().toISOString(),
      })
      .catch(() => undefined);
    return { ok: true, message: 'Reply delivered to the session chat in the dashboard.' };
  }

  // ================================================================ MASTER
  // Tools do Master Agent interativo: o CLI do Master roda numa tmux
  // persistente e responde/escalada/conversa por aqui (nada de parse de
  // stdout). Identidade = token no estado Redis do Master.

  /**
   * Resolve o Bearer token do Master. Retorna o estado ou null.
   *
   * MT-20: há um Master por projeto, então o token não aponta mais para um
   * estado global — o índice `masterTokenIndexKey` diz de qual projeto ele é,
   * e é o estado DAQUELE projeto que é lido e comparado.
   */
  async resolveMasterToken(token: string): Promise<MasterState | null> {
    if (!token) return null;
    if (!this.checkRateLimit(token)) {
      this.logger.warn(`Rate limit exceeded for master token`);
      throw new Error(`Rate limit exceeded (${this.maxCallsPerMinute} calls/min). Wait before making more requests.`);
    }
    try {
      const projectId = await this.redis.getClient().get(masterTokenIndexKey(token));
      if (!projectId) return null;
      const saved = await this.redis.getClient().get(masterStateKey(projectId));
      if (!saved) return null;
      const state = JSON.parse(saved) as MasterState;
      return state.token === token ? state : null;
    } catch {
      return null;
    }
  }

  async masterStatus(state: MasterState) {
    const [project, activeSessions, pendingQuestions, tasks, activeList] = await Promise.all([
      this.prisma.project.findUnique({ where: { id: state.projectId } }),
      this.prisma.session.count({
        where: {
          macroTask: { projectId: state.projectId },
          status: { in: ['running', 'waiting'] },
        },
      }),
      this.prisma.question.count({
        where: {
          status: 'pending',
          session: { macroTask: { projectId: state.projectId } },
        },
      }),
      this.prisma.macroTask.count({ where: { projectId: state.projectId } }),
      this.prisma.session.findMany({
        where: {
          macroTask: { projectId: state.projectId },
          status: { in: ACTIVE_SESSION_STATUSES as any },
        },
        select: {
          id: true,
          status: true,
          currentStage: true,
          macroTask: { select: { title: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    const sessions = await Promise.all(
      activeList.map(async (s) => ({
        sessionId: s.id,
        task: s.macroTask?.title,
        status: s.status,
        stage: s.currentStage,
        // Telemetria real: tmuxAlive=false ou lastOutputAt antigo = sessão travada
        runtime: await this.getRuntimeSummary(s.id),
      })),
    );
    return {
      project: project ? { name: project.name, description: project.description } : null,
      activeSessions,
      pendingQuestions,
      macroTasks: tasks,
      sessions,
    };
  }

  async masterListPendingQuestions(state: MasterState) {
    const questions = await this.prisma.question.findMany({
      where: {
        status: 'pending',
        session: { macroTask: { projectId: state.projectId } },
      },
      include: {
        session: {
          select: {
            id: true,
            currentStage: true,
            macroTask: { select: { title: true, projectId: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: 20,
    });
    return questions.map((q) => this.mapMasterQuestion(q));
  }

  async masterGetQuestion(questionId: string) {
    const question = await this.prisma.question.findUnique({
      where: { id: questionId },
      include: {
        session: {
          select: {
            id: true,
            status: true,
            currentStage: true,
            branchName: true,
            macroTask: { select: { title: true, description: true, projectId: true } },
          },
        },
      },
    });
    if (!question) return { error: 'question not found' };
    const mapped = this.mapMasterQuestion(question);
    const sessionStatus = (question.session as any)?.status as string | undefined;
    const runtime =
      question.session && sessionStatus && ACTIVE_SESSION_STATUSES.includes(sessionStatus)
        ? await this.getRuntimeSummary(question.session.id)
        : null;
    return { ...mapped, sessionId: question.session?.id, sessionStatus, runtime };
  }

  private mapMasterQuestion(q: any) {
    const meta = (q.metadata as any) || {};
    return {
      questionId: q.id,
      question: q.question,
      status: q.status,
      priority: q.priority,
      kind: meta.kind,
      options: meta.options,
      recommended: meta.recommended,
      context: meta.context,
      task: q.session?.macroTask?.title,
      stage: q.session?.currentStage,
      createdAt: q.createdAt,
      // MT-27: merge-conflict nasce `priority: 'high'` mas NÃO é mais sempre-humano
      // — o Master tenta resolver primeiro e só escala se não conseguir. Deixar
      // `requiresHuman: true` aqui faria o Master pular a tentativa que ele
      // acabou de ser mandado fazer.
      requiresHuman:
        meta.kind === 'approval' || (q.priority === 'high' && meta.kind !== 'merge-conflict'),
    };
  }

  /**
   * Master responde uma pergunta (regras sempre-humano são reforçadas aqui).
   * `humanDirective` (texto da instrução explícita do humano) libera perguntas
   * high-priority — EXCETO kind 'approval', sempre humana.
   *
   * MT-27: 'merge-conflict' saiu da lista de sempre-humanas, mas só é
   * respondível depois que o tick registrou a tentativa (`masterMergeAttempt`).
   * Sem essa marca o Master estaria resolvendo um conflito que ninguém pediu
   * pra ele olhar — e é a mesma marca que faz o tick seguinte escalar.
   */
  async masterAnswerQuestion(
    state: MasterState,
    questionId: string,
    answer: string,
    confidence?: number,
    humanDirective?: string,
  ) {
    const question = await this.prisma.question.findUnique({ where: { id: questionId } });
    if (!question) return { error: 'question not found' };
    if (question.status !== 'pending') {
      return { error: `question is already ${question.status}` };
    }
    const meta = (question.metadata as any) || {};
    const directive = humanDirective?.trim() || undefined;
    if (meta.kind === 'approval') {
      return {
        error:
          'This question ALWAYS requires the human (kind approval), even with a humanDirective. Use escalate_question instead.',
      };
    }
    const isMergeConflict = meta.kind === 'merge-conflict';
    if (isMergeConflict && !meta.masterMergeAttempt) {
      return {
        error:
          'Merge-conflict questions are only answerable after the orchestrator health tick hands them to you. Wait for that prompt (or use escalate_question).',
      };
    }
    // merge-conflict já passou pelo filtro acima; exigir `humanDirective` dele
    // aqui anularia a tentativa automática, que é o ponto da MT-27.
    if (question.priority === 'high' && !directive && !isMergeConflict) {
      return {
        error:
          'High-priority questions require HUMAN approval. If the human EXPLICITLY instructed you to resolve it, call answer_question again passing that instruction in humanDirective. Otherwise use escalate_question.',
      };
    }
    if (confidence !== undefined && confidence < 0.7) {
      return {
        error: `Confidence ${confidence} is below the 0.7 auto-answer threshold. Use escalate_question with a suggestedAnswer instead.`,
      };
    }

    const updated = await this.prisma.question.update({
      where: { id: questionId },
      data: {
        status: 'answered',
        answer,
        answeredAt: new Date(),
        metadata: {
          ...meta,
          answeredBy: 'master-agent',
          confidence,
          audit: {
            answeredBy: 'master-agent',
            ...(directive ? { humanDirective: directive } : {}),
            confidence,
            at: new Date().toISOString(),
          },
        },
      },
    });
    await this.redis.publish(CHANNELS.QUESTION_ANSWERED, updated);
    await this.redis.publish(`question:${questionId}:answered`, {
      questionId,
      answer,
      answeredAt: updated.answeredAt,
    });
    await this.redis.publish(CHANNELS.MASTER_DECISION, {
      questionId,
      action: 'answer',
      confidence,
    });
    await this.redis.publish(CHANNELS.MASTER_ACTIVITY, {
      runId: `triage:${questionId}`,
      kind: 'triage',
      phase: 'end',
      ts: new Date().toISOString(),
      questionId,
      action: 'answer',
      result: answer.slice(0, 500),
    });
    await this.prisma.logEntry.create({
      data: {
        projectId: state.projectId,
        level: 'info',
        message: `Master Agent auto-answered question ${questionId.slice(0, 8)}${directive ? ' (under explicit human directive)' : ''}`,
        metadata: { questionId, action: 'answer', confidence, humanDirective: directive },
      },
    });
    return { ok: true, message: 'Question answered — the waiting session will resume.' };
  }

  /**
   * Master descarta uma pergunta pendente obsoleta (ex.: sessão já respondeu
   * de outra forma, pergunta duplicada). Sem aprovação humana redundante.
   */
  async masterDismissQuestion(state: MasterState, questionId: string, reason: string) {
    if (!this.questionsService) return { error: 'Questions service unavailable' };
    const question = await this.prisma.question.findUnique({ where: { id: questionId } });
    if (!question) return { error: 'question not found' };
    if (question.status !== 'pending') {
      return { error: `question is already ${question.status}` };
    }
    try {
      await this.questionsService.dismiss(questionId, reason, 'master-agent');
    } catch (error) {
      return { error: `Failed to dismiss: ${error.message}` };
    }
    await this.redis.publish(CHANNELS.MASTER_DECISION, {
      questionId,
      action: 'dismiss',
      reason,
    });
    await this.redis.publish(CHANNELS.MASTER_ACTIVITY, {
      runId: `triage:${questionId}`,
      kind: 'triage',
      phase: 'end',
      ts: new Date().toISOString(),
      questionId,
      action: 'dismiss',
      result: (reason || '').slice(0, 500),
    });
    await this.prisma.logEntry.create({
      data: {
        projectId: state.projectId,
        level: 'info',
        message: `Master Agent dismissed question ${questionId.slice(0, 8)}: ${reason}`,
        metadata: { questionId, action: 'dismiss', reason },
      },
    });
    return {
      ok: true,
      message:
        'Question dismissed — the session is notified (answer "DISMISSED: <reason>") and waiting sessions resume when no pending questions remain.',
    };
  }

  /** Master escala para o humano, opcionalmente com sugestão de resposta. */
  async masterEscalateQuestion(
    state: MasterState,
    questionId: string,
    reason: string,
    suggestedAnswer?: string,
    confidence?: number,
  ) {
    const question = await this.prisma.question.findUnique({ where: { id: questionId } });
    if (!question) return { error: 'question not found' };
    if (question.status !== 'pending') {
      return { error: `question is already ${question.status}` };
    }
    const meta = (question.metadata as any) || {};
    if (suggestedAnswer) {
      await this.prisma.question.update({
        where: { id: questionId },
        data: {
          metadata: {
            ...meta,
            suggestion: { answer: suggestedAnswer, confidence, reason },
          },
        },
      });
    }
    await this.redis.publish(CHANNELS.MASTER_DECISION, {
      questionId,
      action: 'escalate',
      reason,
      confidence,
    });
    await this.redis.publish(CHANNELS.MASTER_ACTIVITY, {
      runId: `triage:${questionId}`,
      kind: 'triage',
      phase: 'end',
      ts: new Date().toISOString(),
      questionId,
      action: 'escalate',
      result: (suggestedAnswer || reason || '').slice(0, 500),
    });
    await this.prisma.logEntry.create({
      data: {
        projectId: state.projectId,
        level: 'info',
        message: `Master Agent escalated question ${questionId.slice(0, 8)} to human${reason ? `: ${reason}` : ''}`,
        metadata: { questionId, action: 'escalate', reason, suggestedAnswer },
      },
    });
    return { ok: true, message: 'Escalated — the question stays in the human inbox (with your suggestion, if any).' };
  }

  /** Resposta do Master ao chat do dashboard. */
  async masterReplyChat(state: MasterState, message: string) {
    // Conversa ativa (P3.2): o chat() grava o chatSessionId no Redis antes de
    // mandar o prompt, para a resposta cair na mesma thread. Tolerante — se o
    // Redis falhar ou a chave tiver expirado, grava sem conversa em vez de
    // perder a resposta. Não cria pane nenhum: é só agrupamento (CA4).
    let chatSessionId: string | null = null;
    try {
      chatSessionId = await this.redis.getClient().get(MASTER_CHAT_SESSION_KEY);
    } catch {
      chatSessionId = null;
    }
    await this.prisma.chatMessage.create({
      data: {
        role: 'agent',
        content: message,
        projectId: state.projectId,
        chatSessionId: chatSessionId || null,
      },
    });

    // Correlaciona com o run aberto pelo chat() (se houver)
    let runId: string | null = null;
    try {
      runId = await this.redis.getClient().getdel(MASTER_CHAT_RUN_KEY);
    } catch {
      runId = null;
    }
    await this.redis.publish(CHANNELS.MASTER_ACTIVITY, {
      runId: runId || randomUUID(),
      kind: 'chat',
      phase: 'end',
      ts: new Date().toISOString(),
      result: message.slice(0, 500),
    });
    return { ok: true, message: 'Reply delivered to the dashboard chat.' };
  }

  async masterLog(state: MasterState, level: string, message: string) {
    // Relatório final do health-check ("[health <runId>] ...") fecha o run no feed.
    const healthMatch = message.match(/^\[(health:[a-f0-9]+)\]/i);
    if (healthMatch) {
      await this.redis
        .publish(CHANNELS.MASTER_ACTIVITY, {
          runId: healthMatch[1],
          kind: 'health',
          phase: 'end',
          ts: new Date().toISOString(),
          result: message.slice(0, 500),
        })
        .catch(() => undefined);
    }
    return this.prisma.logEntry.create({
      data: {
        projectId: state.projectId,
        level,
        message,
        metadata: { source: 'master-agent' },
      },
    });
  }

  // ------- gestão do orquestrador pelo Master (macro tasks / pipelines / sessões)

  async masterListPipelines(state: MasterState) {
    const pipelines = await this.prisma.pipeline.findMany({
      where: { projectId: state.projectId },
      orderBy: { createdAt: 'asc' },
    });
    return pipelines.map((p) => {
      const raw = p.stages as any;
      const def = Array.isArray(raw) ? { stages: raw } : raw || {};
      return {
        pipelineId: p.id,
        name: p.name,
        description: p.description,
        isActive: p.isActive,
        kind: def.kind,
        category: def.category,
        tags: def.tags,
        // Runtime já configurado por stage (contratos §1/§2): sem isto o Master
        // escolheria o override do `start_macro_task` no escuro.
        defaults: def.defaults,
        permissionMode: def.permissionMode,
        stages:
          (def.stages as any[])?.map?.((s: any) => ({
            name: s.name,
            mode: s.mode,
            timeout: s.timeout,
            model: s.model,
            cliProfile: s.cliProfile,
            subagents: s.subagents,
            skills: s.skills,
            permissionMode: s.permissionMode,
          })) ?? [],
        permissions: def.permissions,
        extraMcpServers: def.extraMcpServers ? Object.keys(def.extraMcpServers) : undefined,
      };
    });
  }

  /**
   * Subagentes e skills disponíveis no projeto — o vocabulário válido para o
   * `runtime` do `start_macro_task`. Só leitura; a edição continua na /agents.
   */
  async masterListCliCapabilities(state: MasterState) {
    if (!this.cliFiles) return { error: 'CLI files service unavailable' };
    let agents: Awaited<ReturnType<CliFilesService['listProjectFiles']>>;
    let skills: Awaited<ReturnType<CliFilesService['listProjectSkills']>>;
    try {
      [agents, skills] = await Promise.all([
        this.cliFiles.listProjectFiles(state.projectId, 'agents'),
        this.cliFiles.listProjectSkills(state.projectId),
      ]);
    } catch (error) {
      // mainPath inexistente é o caso comum aqui — erro legível, não stack
      return { error: `Failed to read the project repo: ${error.message}` };
    }
    return {
      root: agents.root,
      subagents: agents.targets.flatMap((t) =>
        t.files.map((f) => ({
          name: f.fileName.replace(/\.md$/, ''),
          description: f.description,
          dir: t.dir,
        })),
      ),
      skills: skills.targets.flatMap((t) =>
        t.skills.map((s) => ({ name: s.dirName, description: s.description, dir: t.dir })),
      ),
      hint: 'Use these exact names in start_macro_task runtime.skills / runtime.subagents',
    };
  }

  async masterListAgents(state: MasterState) {
    const agents = await this.prisma.agent.findMany({
      where: { projectId: state.projectId },
      include: { cliProfile: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return agents.map((a) => ({
      agentId: a.id,
      name: a.name,
      type: a.type,
      model: a.model,
      cliProfile: a.cliProfile?.name ?? null,
      canRunSessions: !!a.cliProfileId,
    }));
  }

  async masterListMacroTasks(state: MasterState) {
    const tasks = await this.prisma.macroTask.findMany({
      // `cancelled` é soft-delete (ver masterDeleteMacroTask) — fica fora da
      // listagem padrão, mas continua no banco.
      where: { projectId: state.projectId, status: { not: 'cancelled' } },
      include: {
        pipeline: { select: { name: true } },
        sessions: { select: { id: true, status: true, currentStage: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return tasks.map((t) => ({
      macroTaskId: t.id,
      title: t.title,
      description: t.description,
      status: t.status,
      pipeline: t.pipeline?.name,
      sessions: t.sessions.map((s) => ({
        sessionId: s.id,
        status: s.status,
        stage: s.currentStage,
      })),
    }));
  }

  /** Cria uma macro task REAL no orquestrador (aparece em /macro-tasks). */
  async masterCreateMacroTask(
    state: MasterState,
    input: { title: string; description?: string; pipeline?: string; priority?: number },
  ) {
    const pipeline = input.pipeline
      ? await this.prisma.pipeline.findFirst({
          where: {
            projectId: state.projectId,
            OR: [{ id: input.pipeline }, { name: input.pipeline }],
          },
        })
      : await this.prisma.pipeline.findFirst({
          where: { projectId: state.projectId, isActive: true },
          orderBy: { createdAt: 'asc' },
        });
    if (!pipeline) {
      return {
        error: input.pipeline
          ? `Pipeline "${input.pipeline}" not found in this project — call list_pipelines`
          : 'No active pipeline in this project — create one first (UI → Pipelines) or call list_pipelines',
      };
    }

    const task = await this.prisma.macroTask.create({
      data: {
        projectId: state.projectId,
        pipelineId: pipeline.id,
        title: input.title,
        description: input.description,
        priority: input.priority ?? 0,
        metadata: { createdBy: 'master-agent' },
      },
    });
    await this.prisma.logEntry.create({
      data: {
        projectId: state.projectId,
        level: 'info',
        message: `Master Agent created macro task "${task.title}"`,
        metadata: { macroTaskId: task.id },
      },
    });
    return {
      ok: true,
      macroTaskId: task.id,
      title: task.title,
      pipeline: pipeline.name,
      status: task.status,
      hint: 'Use start_macro_task to launch a coding session for it.',
    };
  }

  /**
   * Subagentes e skills que existem de fato no repositório do projeto, por
   * nome. Mesma fonte da página /agents (`cli-files`), só leitura.
   *
   * Nunca lança: `resolveProjectRoot` estoura se o `mainPath` do projeto sumiu,
   * e isso não pode virar exceção crua no retorno da tool. Sem listagem,
   * `available: false` faz a validação pular skills/subagentes em vez de
   * recusar tudo — o filtro de `executeStage` ainda derruba nome inexistente
   * antes de ele chegar ao prompt.
   */
  private async listProjectCliFiles(projectId: string) {
    const empty = { subagents: [] as string[], skills: [] as string[], available: false };
    if (!this.cliFiles) return empty;
    try {
      const [agents, skills] = await Promise.all([
        this.cliFiles.listProjectFiles(projectId, 'agents'),
        this.cliFiles.listProjectSkills(projectId),
      ]);
      const dedup = (names: string[]) => [...new Set(names)];
      return {
        subagents: dedup(
          agents.targets.flatMap((t) => t.files.map((f) => f.fileName.replace(/\.md$/, ''))),
        ),
        skills: dedup(skills.targets.flatMap((t) => t.skills.map((s) => s.dirName))),
        available: true,
      };
    } catch (error) {
      this.logger.warn(`Failed to list CLI files of project ${projectId}: ${error.message}`);
      return empty;
    }
  }

  /**
   * Confronta o `runtime` do `start_macro_task` com a realidade: modelo
   * habilitado em `llm_models`, CliProfile existente, skill/subagente em disco,
   * nome de stage presente no pipeline da task. Devolve a lista de problemas —
   * a tool recusa a chamada em vez de deixar a sessão falhar 20 min depois.
   */
  private async validateRuntimeOverride(
    projectId: string,
    override: SessionRuntimeOverride,
    stageNames: string[],
  ): Promise<string[]> {
    const errors: string[] = [];
    const [models, profiles, cliFiles] = await Promise.all([
      this.prisma.lLMModel.findMany({ where: { enabled: true }, select: { name: true } }),
      this.prisma.cliProfile.findMany({ select: { id: true, name: true } }),
      this.listProjectCliFiles(projectId),
    ]);
    const enabledModels = models.map((m) => m.name);
    const profileNames = profiles.map((p) => p.name);

    const check = (scope: string, layer: Omit<SessionRuntimeOverride, 'stages'>) => {
      if (layer.model && !enabledModels.includes(layer.model)) {
        errors.push(
          `${scope}: model "${layer.model}" is not enabled in llm_models (available: ${enabledModels.join(', ') || 'none'})`,
        );
      }
      if (
        layer.cliProfile &&
        !profileNames.includes(layer.cliProfile) &&
        !profiles.some((p) => p.id === layer.cliProfile)
      ) {
        errors.push(
          `${scope}: CLI profile "${layer.cliProfile}" does not exist (available: ${profileNames.join(', ') || 'none'})`,
        );
      }
      if (!cliFiles.available) return;
      for (const skill of layer.skills ?? []) {
        if (!cliFiles.skills.includes(skill)) {
          errors.push(
            `${scope}: skill "${skill}" not found in the project (available: ${cliFiles.skills.join(', ') || 'none'})`,
          );
        }
      }
      for (const subagent of layer.subagents ?? []) {
        if (!cliFiles.subagents.includes(subagent)) {
          errors.push(
            `${scope}: subagent "${subagent}" not found in the project (available: ${cliFiles.subagents.join(', ') || 'none'})`,
          );
        }
      }
    };

    const { stages, ...sessionScalars } = override;
    check('runtime', sessionScalars);
    for (const [stageName, layer] of Object.entries(stages ?? {})) {
      if (!stageNames.includes(stageName)) {
        errors.push(
          `runtime.stages: "${stageName}" is not a stage of this task's pipeline (stages: ${stageNames.join(', ')})`,
        );
        continue;
      }
      check(`runtime.stages["${stageName}"]`, layer);
    }
    return errors;
  }

  async masterStartMacroTask(
    state: MasterState,
    macroTaskId: string,
    agent?: string,
    runtime?: SessionRuntimeOverride,
  ) {
    if (!this.pipelineEngine) {
      return { error: 'Pipeline engine unavailable' };
    }
    const task = await this.prisma.macroTask.findFirst({
      where: { id: macroTaskId, projectId: state.projectId },
      include: {
        pipeline: true,
        sessions: { where: { status: { in: ['initializing', 'running', 'waiting', 'paused'] } } },
      },
    });
    if (!task) return { error: 'Macro task not found in this project — call list_macro_tasks' };
    if (task.sessions.length > 0) {
      return {
        error: `Macro task already has a live session (${task.sessions[0].id}, ${task.sessions[0].status})`,
      };
    }

    // MT-10: o teto (per-projeto + global + recurso) é decidido dentro de
    // `pipelineEngine.startPipeline` (session-governor.service.ts). Um
    // pré-check duplicado aqui bloqueava o Master ANTES de chegar lá — como o
    // duplicado só sabia do limite do projeto, o Master via erro mesmo quando
    // o caso certo era enfileirar. Uma fonte de verdade só; ver o `try` abaixo.
    const resolvedAgent = agent
      ? await this.prisma.agent.findFirst({
          where: { projectId: state.projectId, OR: [{ id: agent }, { name: agent }] },
        })
      : await this.prisma.agent.findFirst({
          where: { projectId: state.projectId, cliProfileId: { not: null } },
          orderBy: { createdAt: 'asc' },
        });
    if (!resolvedAgent) {
      return {
        error: agent
          ? `Agent "${agent}" not found in this project — call list_agents`
          : 'No agent with a CLI profile in this project — call list_agents',
      };
    }
    if (!resolvedAgent.cliProfileId) {
      return { error: `Agent "${resolvedAgent.name}" has no CLI profile assigned` };
    }

    if (runtime) {
      let stageNames: string[] = [];
      try {
        stageNames = normalizePipelineDefinition(task.pipeline.stages).stages.map((s) => s.name);
      } catch {
        // pipeline ilegível: a validação de stage não tem como acontecer, mas o
        // resto do override ainda vale a pena conferir
      }
      const errors = await this.validateRuntimeOverride(state.projectId, runtime, stageNames);
      if (errors.length > 0) {
        return {
          error: `Invalid runtime override — nothing was started. ${errors.join(' | ')}`,
        };
      }
    }

    try {
      // Tipado como `any` de propósito: `startPipeline` devolve uma Session OU
      // um `QueuedStart` (MT-10) — dois formatos bem diferentes, e o
      // `in`-narrowing do TS não atravessa o `Promise<Session | null>` que o
      // engine também pode devolver. Mais simples checar o formato na mão do
      // que lutar com a união aqui, num arquivo que não é desta task.
      const result: any = await this.pipelineEngine.startPipeline(
        macroTaskId,
        resolvedAgent.id,
        runtime,
      );

      // MT-10: sem slot agora, `startPipeline` NÃO cria Session — devolve a
      // marca de fila. Dizer "Session started" aqui seria mentir: nasceram 3
      // sessões-zumbi na Onda 2 (status `initializing`, CLI nenhum) por causa
      // exatamente desse tipo de retorno otimista demais.
      if (result?.queued) {
        const queueResult = result as QueuedStart;
        await this.prisma.logEntry.create({
          data: {
            projectId: state.projectId,
            level: 'info',
            message: `Master Agent's macro task "${task.title}" was queued (position ${queueResult.position}, reason: ${queueResult.reason})`,
            metadata: { macroTaskId, position: queueResult.position, reason: queueResult.reason, detail: queueResult.detail },
          },
        });
        return {
          ok: true,
          queued: true,
          position: queueResult.position,
          reason: queueResult.reason,
          message: `Enfileirada — posição ${queueResult.position} (${queueResult.detail}). Sobe sozinha quando um slot libera; não repita a chamada.`,
        };
      }

      // `session` pode ser `null` em teoria (o `startPipeline` refaz um
      // `findUnique` no fim, depois do `executeStage` — se a sessão for
      // apagada nessa janela, ele devolve null). Preservado o mesmo
      // optional-chaining defensivo que já existia aqui antes da MT-10: sem
      // isso, esse caso raro vira `{error: "Cannot read properties of
      // null..."}` em vez do "ok mas sem detalhe" que o código original dava.
      const session = result;
      await this.prisma.logEntry.create({
        data: {
          projectId: state.projectId,
          level: 'info',
          message: `Master Agent started macro task "${task.title}" (session ${session?.id?.slice(0, 8)})`,
          metadata: { macroTaskId, sessionId: session?.id },
        },
      });
      return {
        ok: true,
        sessionId: session?.id,
        branch: session?.branchName,
        firstStage: session?.currentStage,
        ...(runtime ? { runtimeOverride: runtime } : {}),
        message: 'Session started — watch it in the Terminals page. Questions it raises will come to you for triage.',
      };
    } catch (error) {
      const detail = error?.message || String(error);
      this.logger.warn(`start_macro_task failed for macro task ${macroTaskId}: ${detail}`);
      return { error: `Failed to start: ${detail}` };
    }
  }

  async masterUpdateMacroTask(
    state: MasterState,
    input: {
      macroTaskId: string;
      title?: string;
      description?: string;
      status?: string;
      priority?: number;
      pipeline?: string;
    },
  ) {
    const task = await this.prisma.macroTask.findFirst({
      where: { id: input.macroTaskId, projectId: state.projectId },
    });
    if (!task) return { error: 'Macro task not found in this project — call list_macro_tasks' };

    // Status livre aqui gravava sem erro e sumia da UI (a página filtra por
    // outra lista) — é a origem da fila stale registrada pela MT-10. Normaliza
    // os aliases da descrição antiga da tool e recusa o resto (MT-15).
    let status: MacroTaskStatus | undefined;
    if (input.status !== undefined) {
      const normalized = normalizeMacroTaskStatus(input.status);
      if (!normalized) return { error: invalidMacroTaskStatusMessage(input.status) };
      status = normalized;
    }

    let pipelineId: string | undefined;
    if (input.pipeline) {
      const pipeline = await this.prisma.pipeline.findFirst({
        where: { projectId: state.projectId, OR: [{ id: input.pipeline }, { name: input.pipeline }] },
      });
      if (!pipeline) return { error: `Pipeline "${input.pipeline}" not found — call list_pipelines` };
      pipelineId = pipeline.id;
    }

    // Mexer no status na mão invalida a reserva de fila: uma task enfileirada
    // que foi cancelada e voltou para `pending` por aqui NÃO passou por
    // `start_macro_task`, então ninguém pediu o slot que o `metadata.queue`
    // antigo diz estar aguardando — e ela reaparecia na fila e na UI como
    // "aguardando slot" sem ninguém ter pedido. Vale para qualquer status
    // informado, `pending` incluído: quem quer a fila de volta chama
    // `start_macro_task`, que re-enfileira com um `queuedAt` honesto.
    const queueCleanup = input.status !== undefined ? stripQueueMarker(task.metadata) : null;

    const updated = await this.prisma.macroTask.update({
      where: { id: task.id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(status !== undefined ? { status } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(pipelineId ? { pipelineId } : {}),
        ...(queueCleanup?.wasQueued ? { metadata: queueCleanup.metadata as any } : {}),
      },
    });
    await this.prisma.logEntry.create({
      data: {
        projectId: state.projectId,
        level: 'info',
        message: `Master Agent updated macro task "${updated.title}"`,
        metadata: { macroTaskId: updated.id, changes: input as any },
      },
    });
    return { ok: true, macroTaskId: updated.id, title: updated.title, status: updated.status };
  }

  /**
   * Arquiva uma macro task (soft-delete: status `cancelled`) e remove as
   * sessões FINALIZADAS dela. Sessão viva bloqueia. NUNCA apaga a linha da
   * macro task — um DELETE físico aqui já causou perda de item de backlog
   * numa limpeza manual, recuperado só porque o conteúdo ainda estava no
   * chat. `cancelled` some da listagem padrão (`masterListMacroTasks`
   * filtra) mas segue no Postgres, recuperável por status.
   */
  async masterDeleteMacroTask(state: MasterState, macroTaskId: string) {
    const task = await this.prisma.macroTask.findFirst({
      where: { id: macroTaskId, projectId: state.projectId },
      include: { sessions: { select: { id: true, status: true } } },
    });
    if (!task) return { error: 'Macro task not found in this project — call list_macro_tasks' };

    const live = task.sessions.filter((s) =>
      ['initializing', 'running', 'waiting', 'paused'].includes(s.status as string),
    );
    if (live.length > 0) {
      return {
        error: `Macro task has a live session (${live[0].id}, ${live[0].status}). Call stop_session first, then delete again.`,
      };
    }

    // Sessões finalizadas: remove via SessionsService (limpa runtime/worktree e cascateia filhos)
    for (const s of task.sessions) {
      if (this.sessionsService) {
        await this.sessionsService.remove(s.id).catch(() => undefined);
      } else {
        await this.prisma.session.delete({ where: { id: s.id } }).catch(() => undefined);
      }
    }
    await this.prisma.macroTask.update({ where: { id: task.id }, data: { status: 'cancelled' } });
    await this.prisma.logEntry.create({
      data: {
        projectId: state.projectId,
        level: 'info',
        message: `Master Agent archived macro task "${task.title}" (status: cancelled, not deleted)`,
        metadata: { macroTaskId: task.id, deletedSessions: task.sessions.length },
      },
    });
    return {
      ok: true,
      archived: task.title,
      note: 'Macro task was archived (status: cancelled), not deleted — the row is still in the database.',
      deletedSessions: task.sessions.length,
    };
  }

  /** Encerra uma sessão viva: mata tmux/PTY e marca como 'stopped' (abortada). */
  async masterStopSession(state: MasterState, sessionId: string) {
    if (!this.sessionsService) return { error: 'Sessions service unavailable' };
    const session = await this.prisma.session.findFirst({
      where: { id: sessionId, macroTask: { projectId: state.projectId } },
      include: { macroTask: { select: { title: true } } },
    });
    if (!session) return { error: 'Session not found in this project — call list_sessions' };
    await this.sessionsService.kill(sessionId);
    await this.prisma.logEntry.create({
      data: {
        projectId: state.projectId,
        level: 'info',
        message: `Master Agent stopped session ${sessionId.slice(0, 8)} (${session.macroTask?.title})`,
        metadata: { sessionId },
      },
    });
    return {
      ok: true,
      sessionId,
      message: 'Session stopped (tmux killed, status=stopped — aborted, NOT completed).',
    };
  }

  /**
   * Destrava uma sessão pausada (MT-27). `PipelineEngineService.resumeSession`
   * já existia e já reanexa ao tmux vivo em vez de recolar o boot — só não
   * estava exposta ao Master, que por isso só tinha `stop_session` como saída
   * para uma sessão travada.
   *
   * Só `paused`: `resumeSession` termina chamando `executeStage`, então rodar
   * isso numa sessão `running`/`waiting` (que é o que uma travada continua
   * sendo no banco) dispararia o MESMO stage uma segunda vez, em paralelo com
   * o que já estava lá. Para essas, o caminho continua sendo log + stop_session.
   */
  async masterResumeSession(state: MasterState, sessionId: string) {
    if (!this.pipelineEngine) return { error: 'Pipeline engine unavailable' };
    const session = await this.findMasterSession(state, sessionId);
    if ('error' in session) return session;
    if (session.status !== 'paused') {
      return {
        error: `Cannot resume a ${session.status} session — resume only applies to paused. Re-running the current stage of a live session would execute it twice; use retry_stage (failed/paused) or stop_session instead.`,
      };
    }
    try {
      await this.pipelineEngine.resumeSession(sessionId);
    } catch (error) {
      return { error: `Failed to resume: ${error.message}` };
    }
    await this.logMasterSessionAction(state, sessionId, session.title, 'resumed');
    return {
      ok: true,
      sessionId,
      message: 'Session resumed — the current stage is running again.',
    };
  }

  /**
   * Reexecuta o stage atual de uma sessão `failed` ou `paused` (MT-27). É a
   * saída para quando o resume não basta porque o stage em si morreu no meio.
   */
  async masterRetryStage(state: MasterState, sessionId: string) {
    if (!this.pipelineEngine) return { error: 'Pipeline engine unavailable' };
    const session = await this.findMasterSession(state, sessionId);
    if ('error' in session) return session;
    if (!['failed', 'paused'].includes(session.status)) {
      return {
        error: `Cannot retry the stage of a ${session.status} session — retry only applies to failed/paused.`,
      };
    }
    try {
      await this.pipelineEngine.retryStage(sessionId, session.pipelineId);
    } catch (error) {
      return { error: `Failed to retry stage: ${error.message}` };
    }
    await this.logMasterSessionAction(state, sessionId, session.title, 'retried the current stage of');
    return {
      ok: true,
      sessionId,
      stage: session.currentStage,
      message: 'Stage retried — the session is running again from the same stage.',
    };
  }

  /** Sessão do projeto do Master + os campos que resume/retry precisam conferir. */
  private async findMasterSession(state: MasterState, sessionId: string) {
    const session = await this.prisma.session.findFirst({
      where: { id: sessionId, macroTask: { projectId: state.projectId } },
      include: { macroTask: { select: { title: true, pipelineId: true } } },
    });
    if (!session) {
      return { error: 'Session not found in this project — call list_sessions' } as const;
    }
    return {
      status: session.status,
      currentStage: session.currentStage,
      title: session.macroTask?.title ?? 'unknown',
      pipelineId: session.macroTask?.pipelineId ?? '',
    };
  }

  private async logMasterSessionAction(
    state: MasterState,
    sessionId: string,
    title: string,
    action: string,
  ) {
    await this.prisma.logEntry.create({
      data: {
        projectId: state.projectId,
        level: 'info',
        message: `Master Agent ${action} session ${sessionId.slice(0, 8)} (${title})`,
        metadata: { sessionId, action },
      },
    });
  }

  /**
   * Monta o Json de stages do pipeline: `{ stages, permissions?, extraMcpServers? }`.
   * Campos ausentes ficam de fora (compatível com leitores que esperam só stages).
   */
  /**
   * Monta o Json da coluna `stages` a partir da definição, descartando só as
   * chaves `undefined`.
   *
   * MT-18: era uma lista fixa de 3 campos (`permissions`, `extraMcpServers`,
   * `permissionMode`) e por isso o `update_pipeline` APAGAVA `kind`/`category`/
   * `tags`/`defaults` das 4 pipelines fixas em qualquer update — os campos
   * vinham do banco no `nextDef` e não eram copiados de volta. Copiar tudo o que
   * está definido resolve os campos da MT-0 e também os que uma onda futura
   * adicionar ao contrato sem passar por aqui.
   */
  private buildPipelineStagesJson(def: PipelineDefinition) {
    const json: Record<string, unknown> = { stages: def.stages };
    for (const [key, value] of Object.entries(def)) {
      if (key !== 'stages' && value !== undefined) json[key] = value;
    }
    return json;
  }

  async masterCreatePipeline(
    state: MasterState,
    input: {
      name: string;
      description?: string;
      stages: PipelineStage[];
      activate?: boolean;
      permissions?: string[];
      extraMcpServers?: Record<string, unknown>;
      permissionMode?: string;
      kind?: PipelineKind;
      category?: string;
      tags?: string[];
      defaults?: PipelineDefaults;
    },
  ) {
    // `name`/`description`/`activate` moram em colunas próprias; o resto é a
    // definição que vai para o Json. Lista explícita (e não `...rest`) para que
    // um campo novo da tool não vaze para dentro do Json sem alguém decidir.
    const definition: PipelineDefinition = {
      stages: input.stages,
      permissions: input.permissions,
      extraMcpServers: input.extraMcpServers,
      permissionMode: input.permissionMode,
      kind: input.kind,
      category: input.category,
      tags: input.tags,
      defaults: input.defaults,
    };
    try {
      validatePipelineDefinition(definition);
    } catch (error) {
      return { error: `Invalid pipeline definition: ${error.message}` };
    }
    const pipeline = await this.prisma.pipeline.create({
      data: {
        projectId: state.projectId,
        name: input.name,
        description: input.description,
        stages: this.buildPipelineStagesJson(definition) as any,
        isActive: input.activate ?? true,
      },
    });
    await this.prisma.logEntry.create({
      data: {
        projectId: state.projectId,
        level: 'info',
        message: `Master Agent created pipeline "${pipeline.name}" (${input.stages.length} stages)`,
        metadata: { pipelineId: pipeline.id },
      },
    });
    return {
      ok: true,
      pipelineId: pipeline.id,
      name: pipeline.name,
      // Ecoa o que foi GRAVADO, não o que foi pedido: é como o Master confere
      // que o catálogo e os defaults entraram, sem um list_pipelines a mais.
      kind: definition.kind,
      category: definition.category,
      tags: definition.tags,
      defaults: definition.defaults,
      stages: input.stages.map((s) => s.name),
    };
  }

  async masterUpdatePipeline(
    state: MasterState,
    input: {
      pipelineId: string;
      name?: string;
      description?: string;
      isActive?: boolean;
      stages?: PipelineStage[];
      permissions?: string[];
      extraMcpServers?: Record<string, unknown>;
      permissionMode?: string;
      kind?: PipelineKind;
      category?: string;
      tags?: string[];
      defaults?: PipelineDefaults;
    },
  ) {
    const pipeline = await this.prisma.pipeline.findFirst({
      where: { projectId: state.projectId, OR: [{ id: input.pipelineId }, { name: input.pipelineId }] },
    });
    if (!pipeline) return { error: 'Pipeline not found in this project — call list_pipelines' };

    // Campos que vivem DENTRO do Json `stages` — mexer em qualquer um exige
    // reescrever o Json inteiro (a coluna não tem merge parcial).
    const DEFINITION_FIELDS = [
      'stages',
      'permissions',
      'extraMcpServers',
      'permissionMode',
      'kind',
      'category',
      'tags',
      'defaults',
    ] as const;
    const touchesDefinition = DEFINITION_FIELDS.some((field) => input[field] !== undefined);

    let stagesJson: Record<string, unknown> | undefined;
    if (touchesDefinition) {
      // Preserva campos existentes do Json (compatível com formato antigo = array puro)
      const current = pipeline.stages as any;
      const currentDef: PipelineDefinition = Array.isArray(current)
        ? { stages: current as PipelineStage[] }
        : { ...(current || {}) };
      // Merge campo a campo: só o que veio no input sobrescreve. Preserva a
      // allowlist de 17-21 regras das pipelines fixas quando o Master está
      // mexendo em outra coisa.
      const patch = Object.fromEntries(
        DEFINITION_FIELDS.filter((field) => input[field] !== undefined).map((field) => [field, input[field]]),
      );
      const nextDef: PipelineDefinition = { ...currentDef, ...patch };
      try {
        validatePipelineDefinition(nextDef);
      } catch (error) {
        return { error: `Invalid pipeline definition: ${error.message}` };
      }
      stagesJson = this.buildPipelineStagesJson(nextDef);
    }

    const updated = await this.prisma.pipeline.update({
      where: { id: pipeline.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(stagesJson ? { stages: stagesJson as any } : {}),
      },
    });
    return { ok: true, pipelineId: updated.id, name: updated.name, isActive: updated.isActive };
  }

  async masterDeletePipeline(state: MasterState, pipelineRef: string) {
    const pipeline = await this.prisma.pipeline.findFirst({
      where: { projectId: state.projectId, OR: [{ id: pipelineRef }, { name: pipelineRef }] },
      include: { _count: { select: { macroTasks: true } } },
    });
    if (!pipeline) return { error: 'Pipeline not found in this project — call list_pipelines' };
    if (pipeline._count.macroTasks > 0) {
      return {
        error: `Pipeline "${pipeline.name}" is used by ${pipeline._count.macroTasks} macro task(s). Delete or move those tasks first (update_macro_task with another pipeline).`,
      };
    }
    await this.prisma.pipeline.delete({ where: { id: pipeline.id } });
    return { ok: true, deleted: pipeline.name };
  }

  async masterCreateAgent(
    state: MasterState,
    input: { name: string; cliProfile?: string; model?: string; type?: string },
  ) {
    let cliProfileId: string | null = null;
    if (input.cliProfile) {
      const profile = await this.prisma.cliProfile.findFirst({
        where: { OR: [{ id: input.cliProfile }, { name: input.cliProfile }] },
      });
      if (!profile) return { error: `CLI profile "${input.cliProfile}" not found` };
      cliProfileId = profile.id;
    } else {
      const first = await this.prisma.cliProfile.findFirst({ orderBy: { createdAt: 'asc' } });
      cliProfileId = first?.id ?? null;
    }
    const agent = await this.prisma.agent.create({
      data: {
        projectId: state.projectId,
        name: input.name,
        type: input.type ?? 'cli',
        model: input.model ?? 'sonnet',
        cliProfileId,
      },
      include: { cliProfile: { select: { name: true } } },
    });
    return {
      ok: true,
      agentId: agent.id,
      name: agent.name,
      cliProfile: agent.cliProfile?.name ?? null,
    };
  }

  async masterUpdateAgent(
    state: MasterState,
    input: { agentId: string; name?: string; model?: string; cliProfile?: string },
  ) {
    const agent = await this.prisma.agent.findFirst({
      where: { projectId: state.projectId, OR: [{ id: input.agentId }, { name: input.agentId }] },
    });
    if (!agent) return { error: 'Agent not found in this project — call list_agents' };
    let cliProfileId: string | undefined;
    if (input.cliProfile) {
      const profile = await this.prisma.cliProfile.findFirst({
        where: { OR: [{ id: input.cliProfile }, { name: input.cliProfile }] },
      });
      if (!profile) return { error: `CLI profile "${input.cliProfile}" not found` };
      cliProfileId = profile.id;
    }
    const updated = await this.prisma.agent.update({
      where: { id: agent.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.model !== undefined ? { model: input.model } : {}),
        ...(cliProfileId ? { cliProfileId } : {}),
      },
      include: { cliProfile: { select: { name: true } } },
    });
    return { ok: true, agentId: updated.id, name: updated.name, model: updated.model, cliProfile: updated.cliProfile?.name ?? null };
  }

  async masterDeleteAgent(state: MasterState, agentRef: string) {
    const agent = await this.prisma.agent.findFirst({
      where: { projectId: state.projectId, OR: [{ id: agentRef }, { name: agentRef }] },
      include: { _count: { select: { sessions: true } } },
    });
    if (!agent) return { error: 'Agent not found in this project — call list_agents' };
    if (agent._count.sessions > 0) {
      return {
        error: `Agent "${agent.name}" has ${agent._count.sessions} session(s) in history. Delete those sessions/macro tasks first.`,
      };
    }
    await this.prisma.agent.delete({ where: { id: agent.id } });
    return { ok: true, deleted: agent.name };
  }

  // ------- gestão de CLI profiles (como cada agente CLI é lançado)

  async masterListCliProfiles(_state: MasterState) {
    const profiles = await this.prisma.cliProfile.findMany({ orderBy: { createdAt: 'asc' } });
    return profiles.map((p) => ({
      cliProfileId: p.id,
      name: p.name,
      binary: p.binary,
      defaultModel: p.defaultModel,
      mcpConfigFile: p.mcpConfigFile,
      interactiveArgs: p.interactiveArgs,
      env: p.env,
      builtin: p.builtin,
      isDefault: p.isDefault,
    }));
  }

  async masterCreateCliProfile(
    state: MasterState,
    input: {
      name: string;
      binary: string;
      interactiveArgs?: string[];
      mcpConfigFile?: string;
      mcpConfigTemplate?: Record<string, unknown>;
      env?: Record<string, string>;
      defaultModel?: string;
    },
  ) {
    const existing = await this.prisma.cliProfile.findUnique({ where: { name: input.name } });
    if (existing) {
      return { error: `CLI profile "${input.name}" already exists — use update_cli_profile` };
    }
    const profile = await this.prisma.cliProfile.create({
      data: {
        name: input.name,
        binary: input.binary,
        interactiveArgs: (input.interactiveArgs ?? []) as any,
        mcpConfigFile: input.mcpConfigFile ?? '.orchestrator/mcp.json',
        // Default: MCP do orquestrador via HTTP (placeholders renderizados por sessão)
        mcpConfigTemplate: (input.mcpConfigTemplate ?? {
          mcpServers: {
            orchestrator: {
              type: 'http',
              url: '{{url}}',
              headers: { Authorization: 'Bearer {{token}}' },
            },
          },
        }) as any,
        env: (input.env as any) ?? undefined,
        defaultModel: input.defaultModel,
      },
    });
    await this.prisma.logEntry.create({
      data: {
        projectId: state.projectId,
        level: 'info',
        message: `Master Agent created CLI profile "${profile.name}" (${profile.binary})`,
        metadata: { cliProfileId: profile.id },
      },
    });
    return {
      ok: true,
      cliProfileId: profile.id,
      name: profile.name,
      binary: profile.binary,
      hint: 'Bind it to an agent with create_agent/update_agent (cliProfile).',
    };
  }

  async masterUpdateCliProfile(
    state: MasterState,
    input: {
      cliProfile: string; // id ou name
      name?: string;
      binary?: string;
      interactiveArgs?: string[];
      mcpConfigFile?: string;
      mcpConfigTemplate?: Record<string, unknown>;
      env?: Record<string, string>;
      defaultModel?: string;
    },
  ) {
    const profile = await this.prisma.cliProfile.findFirst({
      where: { OR: [{ id: input.cliProfile }, { name: input.cliProfile }] },
    });
    if (!profile) {
      return { error: `CLI profile "${input.cliProfile}" not found — call list_cli_profiles` };
    }
    if (input.name && input.name !== profile.name) {
      const clash = await this.prisma.cliProfile.findUnique({ where: { name: input.name } });
      if (clash) return { error: `A CLI profile named "${input.name}" already exists` };
    }
    const updated = await this.prisma.cliProfile.update({
      where: { id: profile.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.binary !== undefined ? { binary: input.binary } : {}),
        ...(input.interactiveArgs !== undefined
          ? { interactiveArgs: input.interactiveArgs as any }
          : {}),
        ...(input.mcpConfigFile !== undefined ? { mcpConfigFile: input.mcpConfigFile } : {}),
        ...(input.mcpConfigTemplate !== undefined
          ? { mcpConfigTemplate: input.mcpConfigTemplate as any }
          : {}),
        ...(input.env !== undefined ? { env: input.env as any } : {}),
        ...(input.defaultModel !== undefined ? { defaultModel: input.defaultModel } : {}),
      },
    });
    await this.prisma.logEntry.create({
      data: {
        projectId: state.projectId,
        level: 'info',
        message: `Master Agent updated CLI profile "${updated.name}"`,
        metadata: { cliProfileId: updated.id, changes: Object.keys(input).filter((k) => k !== 'cliProfile') },
      },
    });
    return {
      ok: true,
      cliProfileId: updated.id,
      name: updated.name,
      binary: updated.binary,
      ...(profile.builtin ? { warning: 'This is a BUILTIN profile — changes affect every agent using it.' } : {}),
    };
  }

  /**
   * Consulta SQL somente-leitura (SELECT/WITH) direto no banco do orquestrador.
   * Escritas são bloqueadas: mutações devem passar pelas tools próprias, que
   * disparam eventos Redis e limpeza de runtime (tmux/worktree).
   */
  async masterQueryDb(state: MasterState, sql: string, limit?: number) {
    const cleaned = sql.trim().replace(/;\s*$/, '');
    if (cleaned.includes(';')) {
      return { error: 'Only a single statement is allowed' };
    }
    if (!/^(select|with)\b/i.test(cleaned)) {
      return { error: 'Only read-only queries (SELECT / WITH ... SELECT) are allowed' };
    }
    if (/\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|vacuum|call|do|execute)\b/i.test(cleaned)) {
      return {
        error:
          'Write/DDL keywords are not allowed here. Use the dedicated tools (create/update/delete_macro_task, *_pipeline, *_agent, stop_session...) so events and cleanup fire correctly.',
      };
    }
    const max = Math.min(Math.max(limit ?? 100, 1), 500);
    try {
      const rows = (await this.prisma.$queryRawUnsafe(cleaned)) as unknown[];
      const sliced = Array.isArray(rows) ? rows.slice(0, max) : rows;
      // BigInt (COUNT etc.) não serializa em JSON
      return JSON.parse(
        JSON.stringify(
          { rows: sliced, rowCount: Array.isArray(rows) ? rows.length : undefined, truncatedTo: Array.isArray(rows) && rows.length > max ? max : undefined },
          (_k, v) => (typeof v === 'bigint' ? Number(v) : v),
        ),
      );
    } catch (error) {
      return { error: `Query failed: ${error.message}` };
    }
  }

  async masterListSessions(state: MasterState) {
    const sessions = await this.prisma.session.findMany({
      where: { macroTask: { projectId: state.projectId } },
      include: { macroTask: { select: { title: true } } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return Promise.all(
      sessions.map(async (s) => ({
        sessionId: s.id,
        task: s.macroTask?.title,
        status: s.status,
        stage: s.currentStage,
        branch: s.branchName,
        startedAt: s.startedAt,
        // Só sessões vivas têm runtime; null = telemetria indisponível
        runtime: ACTIVE_SESSION_STATUSES.includes(s.status as string)
          ? await this.getRuntimeSummary(s.id)
          : undefined,
      })),
    );
  }

  /**
   * Agenda um `master_loop`: o orquestrador vai colar `instructions` de volta no
   * terminal do Master na hora marcada (uma vez, ou em loop com rate-limit).
   *
   * O `projectId` vem SEMPRE de `state` — o Master está escopado no projeto e
   * nunca escolhe o alvo pelo input.
   */
  async masterScheduleLoop(
    state: MasterState,
    input: {
      instructions: string;
      startInMinutes?: number;
      repeatIntervalMinutes?: number;
      maxRuns?: number;
      notes?: string;
    },
  ) {
    if (!this.scheduledJobs) {
      return { error: 'Scheduled jobs service unavailable' };
    }
    const instructions = (input.instructions || '').trim();
    if (!instructions) {
      return { error: 'instructions is required — write what should be done when the schedule fires' };
    }

    const startInMinutes = Math.max(0, Math.round(input.startInMinutes ?? 0));
    const scheduledAt = new Date(Date.now() + startInMinutes * 60_000);

    try {
      const job = await this.scheduledJobs.createMasterLoop({
        instructions,
        projectId: state.projectId,
        scheduledAt,
        repeatIntervalMinutes: input.repeatIntervalMinutes,
        maxRuns: input.maxRuns,
        notes: input.notes?.trim() || 'Created by the Master Agent (schedule_loop)',
      });

      await this.prisma.logEntry.create({
        data: {
          projectId: state.projectId,
          level: 'info',
          message: 'Master Agent scheduled a loop of instructions',
          metadata: {
            jobId: job.id,
            scheduledAt: scheduledAt.toISOString(),
            repeatIntervalMinutes: input.repeatIntervalMinutes ?? null,
            maxRuns: input.maxRuns ?? null,
          },
        },
      });

      return {
        ok: true,
        jobId: job.id,
        scheduledAt: scheduledAt.toISOString(),
        repeatIntervalMinutes: input.repeatIntervalMinutes ?? null,
        maxRuns: input.maxRuns ?? null,
        hint: input.repeatIntervalMinutes
          ? `The instructions will be sent to your terminal every ${input.repeatIntervalMinutes} min${input.maxRuns ? `, ${input.maxRuns} time(s) in total` : ' until cancelled'}. Use cancel_scheduled_loop to stop it.`
          : 'The instructions will be sent to your terminal once, at scheduledAt.',
      };
    } catch (error) {
      return { error: error.message };
    }
  }

  /**
   * Cancela (pausa) agendamentos `master_loop` do projeto. Sem `jobId` cancela
   * todos os ativos — é o caminho para "pare de me lembrar disso".
   */
  async masterCancelScheduledLoop(state: MasterState, jobId?: string) {
    // Escopo de projeto no `where`, pela coluna indexada (MT-13). Era `.filter`
    // do payload em memória, e "pare de me lembrar disso" não cancelava nada
    // quando a página vinha cheia de jobs de outros projetos.
    const owned = await this.prisma.scheduledJob.findMany({
      where: {
        type: MASTER_LOOP_JOB_TYPE,
        status: { in: ['pending', 'running'] },
        projectId: state.projectId,
        ...(jobId ? { id: jobId } : {}),
      },
      select: { id: true, payload: true, scheduledAt: true },
    });
    if (owned.length === 0) {
      return {
        ok: false,
        cancelled: 0,
        message: jobId
          ? 'No active scheduled loop with that id in this project'
          : 'No active scheduled loop in this project',
      };
    }

    await this.prisma.scheduledJob.updateMany({
      where: { id: { in: owned.map((job) => job.id) } },
      data: { status: 'disabled' },
    });
    await this.prisma.logEntry.create({
      data: {
        projectId: state.projectId,
        level: 'info',
        message: `Master Agent cancelled ${owned.length} scheduled loop(s)`,
        metadata: { jobIds: owned.map((job) => job.id) },
      },
    });
    return { ok: true, cancelled: owned.length, jobIds: owned.map((job) => job.id) };
  }

  /**
   * "Olho" do Master no terminal: últimas linhas da tela do tmux da sessão,
   * mais a telemetria de runtime — sem precisar de Bash.
   */
  async masterGetSessionScreen(state: MasterState, sessionId: string) {
    const session = await this.prisma.session.findFirst({
      where: { id: sessionId, macroTask: { projectId: state.projectId } },
      select: { id: true, status: true, currentStage: true, macroTask: { select: { title: true } } },
    });
    if (!session) return { error: 'Session not found in this project — call list_sessions' };
    const telemetry = await this.getRuntimeTelemetry(sessionId);
    if (!telemetry) {
      return {
        error:
          'Runtime telemetry unavailable for this session (no live runtime or telemetry service not ready)',
      };
    }
    return {
      sessionId,
      task: session.macroTask?.title,
      status: session.status,
      stage: session.currentStage,
      runtime: {
        hasPty: telemetry.hasPty,
        tmuxAlive: telemetry.tmuxAlive,
        lastOutputAt: telemetry.lastOutputAt,
      },
      screen: telemetry.lastScreen ?? null,
    };
  }
}
