import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import {
  SessionLiveness,
  SessionRuntimeService,
} from '../session-runtime/session-runtime.service';
import { CHANNELS } from '../redis/channels';
import { CreateSessionDto } from './dto/create-session.dto';
import { UpdateSessionDto } from './dto/update-session.dto';

/** Status em que o CLI da sessão ainda pode estar vivo no tmux. */
const LIVE_SESSION_STATUSES = ['initializing', 'running', 'waiting', 'paused'];

/**
 * Janela do cache de liveness. Curta o bastante para `link lost` e `silent`
 * aparecerem no refresh seguinte da UI, longa o bastante para absorver os
 * pollings simultâneos (a página de sessões e o contador do sidebar batem no
 * mesmo endpoint).
 */
const LIVENESS_TTL_MS = 5_000;

@Injectable()
export class SessionsService {
  /** sessionId → liveness em voo ou recém-resolvido. Ver `cachedLiveness`. */
  private readonly livenessCache = new Map<
    string,
    { at: number; value: Promise<SessionLiveness> }
  >();

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private runtime: SessionRuntimeService,
  ) {}

  async create(dto: CreateSessionDto) {
    const session = await this.prisma.session.create({
      data: dto,
    });
    await this.redis.publish(CHANNELS.SESSION_CREATED, session);
    return session;
  }

  async findAll(filters: { projectId?: string; status?: string } = {}, cursor?: string, limit: number = 50) {
    const effectiveLimit = Math.min(Math.max(limit, 1), 200);
    const items = await this.prisma.session.findMany({
      where: {
        ...(filters.projectId ? { macroTask: { projectId: filters.projectId } } : {}),
        ...(filters.status ? { status: filters.status as any } : {}),
      },
      include: {
        agent: true,
        macroTask: true,
        questions: true,
        artifacts: true,
      },
      orderBy: { createdAt: 'desc' },
      cursor: cursor ? { id: cursor } : undefined,
      take: effectiveLimit + 1,
      skip: cursor ? 1 : 0,
    });
    const nextCursor = items.length > effectiveLimit ? items[effectiveLimit - 1].id : null;
    return { data: await this.withLiveness(items.slice(0, effectiveLimit)), nextCursor };
  }

  /**
   * Anexa o estado do vínculo com o CLI (`linkLost`, `lastActivityAt`) nas
   * sessões que ainda podem estar vivas. Só nelas: cada uma custa uma chamada
   * ao tmux, e sessão encerrada não tem vínculo a perder.
   */
  private async withLiveness<T extends { id: string; status: string }>(sessions: T[]) {
    return Promise.all(
      sessions.map(async (session) => {
        if (!LIVE_SESSION_STATUSES.includes(session.status)) return session;
        try {
          const { hasPty, tmuxAlive, linkLost, lastActivityAt, activitySource } =
            await this.cachedLiveness(session.id);
          return { ...session, hasPty, tmuxAlive, linkLost, lastActivityAt, activitySource };
        } catch {
          // Telemetria é enfeite da listagem: nunca derruba o GET /sessions.
          return session;
        }
      }),
    );
  }

  /**
   * `getLiveness` com cache de `LIVENESS_TTL_MS` por sessão.
   *
   * O custo caiu bastante com a saída do tmux: as consultas de pane viraram
   * lookup em Map, e sobrou o `findFirst` em `log_entries` — que é justamente
   * a parte cara, e a que roda por sessão viva a cada refresh da UI em polling.
   *
   * O que fica guardado é a **promise**, não o valor: dois pollings que chegam
   * juntos (lista + sidebar) compartilham a mesma resolução em vez de disparar
   * duas queries. Promise rejeitada é descartada na hora — servir a falha por
   * 5s deixaria a UI sem telemetria por um ciclo inteiro.
   */
  private async cachedLiveness(sessionId: string): Promise<SessionLiveness> {
    const now = Date.now();
    const hit = this.livenessCache.get(sessionId);
    if (hit && now - hit.at < LIVENESS_TTL_MS) return hit.value;

    const value = this.runtime.getLiveness(sessionId);
    this.livenessCache.set(sessionId, { at: now, value });
    // Só remove a própria entrada: se o TTL já venceu e outra chamada
    // sobrescreveu o Map antes desta promise rejeitar (tmux lento sob carga),
    // o `delete` incondicional apagaria a entrada nova e válida da chamada
    // seguinte — o oposto do que o cache existe para evitar.
    value.catch(() => {
      if (this.livenessCache.get(sessionId)?.value === value) this.livenessCache.delete(sessionId);
    });

    // Poda o que já venceu: sem isto o Map cresceria com toda sessão já listada
    // no processo. O `delete` explícito das ações de vínculo não cobre sessão
    // que simplesmente terminou.
    if (this.livenessCache.size > 50) {
      for (const [id, entry] of this.livenessCache) {
        if (now - entry.at >= LIVENESS_TTL_MS) this.livenessCache.delete(id);
      }
    }
    return value;
  }

  /**
   * Invalida o cache de liveness da sessão. Chamado pelas ações que mudam o
   * vínculo com o CLI: deixar a UI 5s mostrando o estado anterior a um restart
   * ou reattach faria a ação parecer que não funcionou.
   */
  private invalidateLiveness(sessionId: string) {
    this.livenessCache.delete(sessionId);
  }

  async findOne(id: string) {
    const session = await this.prisma.session.findUnique({
      where: { id },
      include: {
        agent: true,
        macroTask: true,
        questions: {
          orderBy: { createdAt: 'desc' },
        },
        artifacts: true,
        logs: {
          orderBy: { createdAt: 'desc' },
          take: 100,
        },
      },
    });
    if (!session) throw new NotFoundException('Session not found');
    const [enriched] = await this.withLiveness([session]);
    return enriched;
  }

  /** Telemetria de runtime da sessão (vínculo + último sinal de vida + tela). */
  async getRuntime(id: string) {
    const session = await this.prisma.session.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!session) throw new NotFoundException('Session not found');
    return this.runtime.getRuntimeTelemetry(id);
  }

  private async findOptional(id: string) {
    return this.prisma.session.findUnique({
      where: { id },
      include: {
        agent: true,
        macroTask: true,
      },
    });
  }

  async update(id: string, dto: UpdateSessionDto) {
    await this.findOne(id);
    const session = await this.prisma.session.update({
      where: { id },
      data: dto as any,
    });
    await this.redis.publish(CHANNELS.SESSION_UPDATED, session);
    return session;
  }

  async remove(id: string) {
    const session = await this.findOptional(id);

    // Encerra runtime (PTY/tmux) e remove o worktree
    await this.runtime.stop(id, { removeWorktree: true }).catch(() => undefined);
    this.invalidateLiveness(id);

    if (!session) {
      return { id, message: 'Session not found in database, but runtime cleanup completed' };
    }

    // Filhos (questions/artifacts/logs) caem via onDelete: Cascade
    const deleted = await this.prisma.session.delete({ where: { id } });

    await this.redis.publish(CHANNELS.SESSION_DELETED, deleted);
    return deleted;
  }

  /**
   * Aborta uma sessão viva: mata o runtime e marca como 'stopped' (não
   * 'completed' — abortada ≠ terminou o pipeline).
   */
  async kill(id: string) {
    const session = await this.findOptional(id);

    await this.runtime.stop(id).catch(() => undefined);
    this.invalidateLiveness(id);

    // sessão interrompida não deve deixar stage_timeouts pendentes no Scheduler
    await this.prisma.scheduledJob
      .updateMany({
        where: {
          type: 'stage_timeout',
          status: 'pending',
          payload: { path: ['sessionId'], equals: id },
        },
        data: { status: 'cancelled', result: { cancelled: 'session stopped' } },
      })
      .catch(() => undefined);

    if (!session) {
      return {
        id,
        status: 'stopped',
        message: 'Session not found in database, but runtime cleanup completed',
      };
    }

    const updated = await this.prisma.session.update({
      where: { id },
      data: {
        status: 'stopped',
        completedAt: new Date(),
      },
    });

    await this.redis.publish(CHANNELS.SESSION_STATUS, { sessionId: id, status: 'stopped' });
    await this.redis.publish(CHANNELS.SESSION_UPDATED, updated);
    return updated;
  }

  async restartCli(id: string) {
    await this.runtime.restartCli(id);
    this.invalidateLiveness(id);
    return this.prisma.session.findUnique({ where: { id } });
  }

  async resume(id: string) {
    const session = await this.findOptional(id);
    if (!session) throw new NotFoundException('Session not found');
    if (!['running', 'waiting', 'paused'].includes(session.status)) {
      throw new Error(`Cannot resume session in status ${session.status}`);
    }
    await this.runtime.resumeSession(id);
    this.invalidateLiveness(id);
    return this.prisma.session.findUnique({ where: { id } });
  }

  // --------------------------------------------------------------- chat

  /**
   * Histórico de chat de UMA sessão. `sessionId` é o único filtro: mensagens do
   * Master têm `sessionId: null`, então nunca aparecem aqui (CA2).
   * Últimas 100 (desc + reverse): asc + take cortava as mensagens NOVAS quando
   * o histórico passava de 100 — mesmo padrão do chat do Master.
   */
  async getChat(sessionId: string) {
    const messages = (
      await this.prisma.chatMessage.findMany({
        where: { sessionId },
        orderBy: { timestamp: 'desc' },
        take: 100,
      })
    ).reverse();

    return messages.map((msg) => ({
      id: msg.id,
      role: msg.role,
      content: msg.content,
      time: msg.timestamp.toISOString(),
    }));
  }

  /**
   * Chat do usuário com o agente de uma sessão: o prompt entra no pane tmux da
   * sessão e a resposta volta pela MCP tool `reply_chat` (assíncrono — a UI
   * recebe via SSE `session:chat` e recarrega o histórico).
   *
   * Sessão morta não é erro: grava uma mensagem de agente explicando e devolve
   * `{ queued: false }`, igual ao Master faz quando está desligado.
   */
  async sendChat(id: string, message: string): Promise<{ queued: boolean; response?: string }> {
    const session = await this.findOptional(id);
    if (!session) throw new NotFoundException('Session not found');

    const userMessage = await this.prisma.chatMessage.create({
      // projectId fica NULO de propósito: o chat do Master lista por projectId,
      // e preencher aqui misturaria os dois históricos (CA2).
      data: { role: 'user', content: message, sessionId: id },
    });
    await this.publishChat(id, userMessage.id, 'user', message);

    const alive =
      LIVE_SESSION_STATUSES.includes(session.status) && (await this.hasLivePane(id));

    if (!alive) {
      const response = `This session is not running (status: ${session.status}). Chat only reaches the agent while its CLI is alive in tmux — resume or restart the session to talk to it.`;
      const agentMessage = await this.prisma.chatMessage.create({
        data: { role: 'agent', content: response, sessionId: id },
      });
      await this.publishChat(id, agentMessage.id, 'agent', response);
      return { queued: false, response };
    }

    await this.runtime.sendPrompt(id, this.buildChatPrompt(session, message));
    return { queued: true };
  }

  /** O pane existe? `resolveTmuxSession` lança quando não há tmux vivo. */
  private async hasLivePane(sessionId: string): Promise<boolean> {
    try {
      await this.runtime.resolveTmuxSession(sessionId);
      return true;
    } catch {
      return false;
    }
  }

  private async publishChat(
    sessionId: string,
    messageId: string,
    role: 'user' | 'agent',
    content: string,
  ) {
    await this.redis
      .publish(CHANNELS.SESSION_CHAT, {
        sessionId,
        messageId,
        role,
        preview: content.slice(0, 500),
        ts: new Date().toISOString(),
      })
      .catch(() => undefined);
  }

  /**
   * O agente só é visto pelo usuário através do `reply_chat` — o que ele digita
   * no terminal não chega ao chat. O prompt deixa isso explícito, no mesmo
   * espírito do `[ORCHESTRATOR CHAT]` do Master.
   */
  private buildChatPrompt(
    session: { currentStage?: string | null; branchName?: string | null },
    message: string,
  ): string {
    return `[SESSION CHAT] The user sent you a message from the orchestrator dashboard. Reply by calling the MCP tool reply_chat with your answer (plain text, concise and practical). Do NOT just answer in the terminal — the user only sees what you send via reply_chat.

Keep working on your current task; this is a side conversation about it. Current stage: ${session.currentStage || 'unknown'}. Branch: ${session.branchName || 'unknown'}.

User message:
"""
${message}
"""`;
  }

  async archiveToHistory(sessionId: string) {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        macroTask: { select: { projectId: true } },
        artifacts: true,
      },
    });
    if (!session) throw new NotFoundException('Session not found');

    return this.prisma.sessionHistory.create({
      data: {
        sessionId: session.id,
        macroTaskId: session.macroTaskId,
        projectId: session.macroTask.projectId,
        status: session.status,
        branch: session.branchName,
        startedAt: session.createdAt,
        completedAt: session.completedAt,
        artifactsCount: session.artifacts.length,
      },
    });
  }

  async cleanupOldSessions(projectId: string, olderThanDays: number = 7) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - olderThanDays);

    const sessions = await this.prisma.session.findMany({
      where: {
        macroTask: { projectId },
        status: { in: ['completed', 'stopped', 'failed', 'timeout'] },
        OR: [
          { completedAt: { lt: cutoff } },
          { completedAt: null, createdAt: { lt: cutoff } },
        ],
      },
    });

    let count = 0;
    for (const session of sessions) {
      await this.archiveToHistory(session.id);
      await this.remove(session.id);
      count++;
    }

    return { cleaned: count };
  }

  async getSessionHistory(projectId: string, macroTaskId?: string) {
    return this.prisma.sessionHistory.findMany({
      where: {
        projectId,
        ...(macroTaskId ? { macroTaskId } : {}),
      },
      orderBy: { startedAt: 'desc' },
    });
  }
}
