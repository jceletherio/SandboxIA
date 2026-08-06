import { BadRequestException, Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { LogsService } from './logs.service';

@Controller('logs')
export class LogsController {
  constructor(private readonly logsService: LogsService) {}

  @Get()
  findAll(
    @Query('sessionId') sessionId?: string,
    @Query('projectId') projectId?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = limit ? parseInt(limit, 10) : undefined;
    return this.logsService.findAll(sessionId, projectId, cursor, parsedLimit);
  }

  /**
   * Report derivado de UMA sessão. Declarado ANTES de `@Get(':id')` de propósito:
   * o Nest casa rotas na ordem de declaração e `:id` engoliria `report/...`.
   */
  @Get('report/session/:sessionId')
  sessionReport(@Param('sessionId') sessionId: string) {
    return this.logsService.getSessionReport(sessionId);
  }

  /** Report de onda: sessões do projeto na janela, agregadas por pipeline. */
  @Get('report/wave')
  waveReport(
    @Query('projectId') projectId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    if (!projectId) throw new BadRequestException('projectId is required');
    return this.logsService.getWaveReport(projectId, from, to);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.logsService.findOne(id);
  }

  @Post()
  create(@Body() data: { sessionId?: string; projectId?: string; level: string; message: string; metadata?: any }) {
    return this.logsService.create(data);
  }
}
