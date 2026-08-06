import { BadRequestException, Controller, Get, Post, Patch, Body, Query } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MasterAgentService, SchedulingConfig } from './master-agent.service';

@Controller('master-agent')
export class MasterAgentController {
  constructor(
    private prisma: PrismaService,
    private masterAgentService: MasterAgentService,
  ) {}

  @Get('stats')
  async getStats(@Query('projectId') projectId?: string) {
    const sessionScope = projectId ? { macroTask: { projectId } } : {};
    const [sessions, tasks, questions, agents] = await Promise.all([
      this.prisma.session.count({ where: sessionScope }),
      this.prisma.macroTask.count({ where: projectId ? { projectId } : {} }),
      this.prisma.question.count({
        where: { status: 'pending', ...(projectId ? { session: sessionScope } : {}) },
      }),
      this.prisma.agent.count({ where: projectId ? { projectId } : {} }),
    ]);

    const activeSessions = await this.prisma.session.count({
      where: { status: { in: ['running', 'waiting'] }, ...sessionScope },
    });

    return {
      sessions: { total: sessions, active: activeSessions },
      tasks,
      questions,
      agents,
    };
  }

  @Get('decisions')
  async getDecisions(@Query('projectId') projectId?: string) {
    const logs = await this.prisma.logEntry.findMany({
      where: projectId ? { projectId } : {},
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    return logs.map((log) => ({
      id: log.id,
      type: this.mapLogToDecisionType(log.level, log.message),
      text: log.message,
      time: log.createdAt.toISOString(),
      sessionId: log.sessionId,
    }));
  }

  // ------------------------------------------------- conversas (P3.2)
  // Declaradas ANTES de qualquer rota curinga de 1 segmento (hoje não há
  // nenhuma neste controller — mas `GET /models/assignments` já virou 404 por
  // causa de um `@Get(':id')` declarado antes; a ordem fica explícita aqui).

  /**
   * Conversas do chat do Master no projeto, mais recente primeiro. Derivadas
   * das próprias mensagens — não existe tabela de conversa.
   */
  @Get('chat-sessions')
  async listChatSessions(@Query('projectId') projectId?: string) {
    return this.masterAgentService.listChatSessions(projectId);
  }

  /**
   * "Novo chat": devolve um `chatSessionId` novo e **não persiste nada** — a
   * conversa nasce junto com a primeira mensagem. Não cria pane/processo
   * nenhum: o runtime do Master continua sendo um só por projeto (CA4).
   */
  @Post('chat-sessions')
  createChatSession() {
    return this.masterAgentService.createChatSession();
  }

  @Post('chat')
  async chat(@Body() body: { message: string; chatSessionId?: string; projectId?: string }) {
    return this.masterAgentService.chat(body.message, body.chatSessionId, body.projectId);
  }

  @Get('messages')
  async getMessages(
    @Query('projectId') projectId?: string,
    @Query('chatSessionId') chatSessionId?: string,
  ) {
    // Sem chatSessionId o comportamento é o antigo (tudo do projeto).
    // `sessionId: null` é obrigatório: o chat de Session (P3.1) grava com
    // `projectId` nulo, então sem esse filtro uma chamada sem projectId
    // devolveria mensagens de sessão misturadas no chat do Master.
    const where = {
      sessionId: null,
      ...(projectId ? { projectId } : {}),
      ...(chatSessionId ? { chatSessionId } : {}),
    };
    // Últimas 100 (desc + reverse): asc+take cortava as mensagens NOVAS quando
    // o histórico passava de 100.
    const messages = (
      await this.prisma.chatMessage.findMany({
        where,
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
   * Com `chatSessionId` apaga só aquela conversa; sem ele, tudo do projeto.
   * `sessionId: null` protege o chat de Session (P3.1): sem ele, uma chamada
   * sem query nenhuma viraria um `deleteMany({})` que levaria junto o
   * histórico de chat de todas as sessões.
   */
  @Post('messages/clear')
  async clearMessages(
    @Query('projectId') projectId?: string,
    @Query('chatSessionId') chatSessionId?: string,
  ) {
    const where = {
      sessionId: null,
      ...(projectId ? { projectId } : {}),
      ...(chatSessionId ? { chatSessionId } : {}),
    };
    await this.prisma.chatMessage.deleteMany({ where });
    return { success: true };
  }

  @Get('active-tasks')
  async getActiveTasks(@Query('projectId') projectId?: string) {
    const tasks = await this.prisma.macroTask.findMany({
      where: {
        status: { in: ['pending', 'running', 'planned'] },
        ...(projectId ? { projectId } : {}),
      },
      include: {
        sessions: {
          where: { status: { in: ['running', 'waiting'] } },
        },
      },
      take: 10,
    });

    return tasks.map((task) => ({
      id: task.id,
      title: task.title,
      status: task.sessions.length > 0 ? 'running' : 'planned',
    }));
  }

  @Post('activate')
  async activate(@Body() body: { projectId?: string; cliProfileId?: string } = {}) {
    return this.masterAgentService.activate(body || {});
  }

  /**
   * MT-20: sem `projectId`, o serviço só resolve sozinho quando há exatamente
   * um Master ativo — com dois, desligar "o primeiro" mataria o terminal de
   * quem não pediu nada.
   */
  @Post('deactivate')
  async deactivate(@Query('projectId') projectId?: string) {
    return this.masterAgentService.deactivate(projectId);
  }

  /** Sem `projectId`, cai no mesmo fallback do `deactivate` (único Master ativo, se houver). */
  @Get('status')
  async getStatus(@Query('projectId') projectId?: string) {
    return this.masterAgentService.getStatus(projectId);
  }

  @Get('activity')
  getActivity() {
    return { runs: this.masterAgentService.getActivity() };
  }

  /**
   * A automação é por projeto (`Project.settings.automation`, MT-2) — sem
   * `projectId`, cai no projeto ativo do Master, se houver um.
   */
  @Get('scheduling')
  async getScheduling(@Query('projectId') projectId?: string) {
    return this.masterAgentService.getSchedulingConfig(projectId);
  }

  /** `projectId` é obrigatório aqui: escrever automação sem saber de qual projeto não faz sentido. */
  @Patch('scheduling')
  async updateScheduling(
    @Query('projectId') projectId: string,
    @Body() body: Partial<SchedulingConfig>,
  ) {
    if (!projectId) throw new BadRequestException('projectId query param is required');
    try {
      return await this.masterAgentService.updateSchedulingConfig(projectId, body || {});
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  /** Dispara o health-check de sessões agora (force: prompta mesmo sem travadas). */
  @Post('session-check')
  async triggerSessionCheck(@Query('projectId') projectId?: string) {
    return this.masterAgentService.checkSessionsHealth(true, projectId);
  }

  /** Dispara a triagem manual das perguntas pendentes agora. */
  @Post('triage')
  async triggerTriage(@Query('projectId') projectId?: string) {
    return this.masterAgentService.triggerManualTriage(projectId);
  }

  /** Pede um relatório de status agora (resposta chega no chat via reply_chat). */
  @Post('status-report')
  async triggerStatusReport(@Query('projectId') projectId?: string) {
    return this.masterAgentService.sendStatusReport(true, projectId);
  }

  private mapLogToDecisionType(level: string, message: string): string {
    const msg = message.toLowerCase();
    if (msg.includes('merge') || msg.includes('merged')) return 'MERGED';
    if (msg.includes('auto-answer')) return 'AUTO_ANSWERED';
    if (msg.includes('escalat')) return 'ESCALATED';
    if (msg.includes('create') || msg.includes('created')) return 'CREATED';
    if (msg.includes('delegate') || msg.includes('assign')) return 'DELEGATED';
    if (msg.includes('answer')) return 'ANSWERED';
    if (msg.includes('retry') || msg.includes('retried')) return 'RETRIED';
    if (msg.includes('activated')) return 'ACTIVATED';
    if (msg.includes('deactivated')) return 'DEACTIVATED';
    if (level === 'error') return 'ERROR';
    if (level === 'warn') return 'WARNING';
    return 'INFO';
  }
}
