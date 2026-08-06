import { Controller, Get, Post, Body, Param, Delete, Patch, Query } from '@nestjs/common';
import { SessionsService } from './sessions.service';
import { SessionGovernorService } from '../scheduler/session-governor.service';
import { CreateSessionDto } from './dto/create-session.dto';
import { UpdateSessionDto } from './dto/update-session.dto';
import { SendSessionChatDto } from './dto/session-chat.dto';

@Controller('sessions')
export class SessionsController {
  constructor(
    private readonly sessionsService: SessionsService,
    private readonly sessionGovernor: SessionGovernorService,
  ) {}

  @Post()
  create(@Body() dto: CreateSessionDto) {
    return this.sessionsService.create(dto);
  }

  @Post('cleanup')
  cleanup(@Body() body: { projectId: string; olderThanDays?: number }) {
    return this.sessionsService.cleanupOldSessions(body.projectId, body.olderThanDays);
  }

  @Get('history')
  getSessionHistory(
    @Query('projectId') projectId: string,
    @Query('macroTaskId') macroTaskId?: string,
  ) {
    return this.sessionsService.getSessionHistory(projectId, macroTaskId);
  }

  /**
   * MT-10 — slots usados/total (teto global) + fila (quem espera e por quê).
   * Precisa vir ANTES de `@Get(':id')` (rota fixa, senão o Nest lê "governor"
   * como um `:id`), mesmo precedente de `history` acima.
   */
  @Get('governor')
  getGovernorStatus() {
    return this.sessionGovernor.getStatus();
  }

  @Get()
  findAll(
    @Query('projectId') projectId?: string,
    @Query('status') status?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = limit ? parseInt(limit, 10) : undefined;
    return this.sessionsService.findAll({ projectId, status }, cursor, parsedLimit);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.sessionsService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateSessionDto) {
    return this.sessionsService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.sessionsService.remove(id);
  }

  @Post(':id/kill')
  kill(@Param('id') id: string) {
    return this.sessionsService.kill(id);
  }

  @Post(':id/restart-cli')
  async restartCli(@Param('id') id: string) {
    return this.sessionsService.restartCli(id);
  }

  @Post(':id/resume')
  async resume(@Param('id') id: string) {
    return this.sessionsService.resume(id);
  }

  /**
   * Telemetria de runtime: vínculo com o CLI, último sinal de vida e tela.
   * Até a MT-11 isso existia só no MCP — a UI não tinha como saber que o
   * backend havia perdido o PTY de uma sessão que segue viva no tmux.
   */
  @Get(':id/runtime')
  getRuntime(@Param('id') id: string) {
    return this.sessionsService.getRuntime(id);
  }

  /** Histórico de chat da sessão (P3.1). Não colide com `@Get(':id')`. */
  @Get(':id/chat')
  getChat(@Param('id') id: string) {
    return this.sessionsService.getChat(id);
  }

  @Post(':id/chat')
  sendChat(@Param('id') id: string, @Body() dto: SendSessionChatDto) {
    return this.sessionsService.sendChat(id, dto.message);
  }
}
