import { Controller, Get, Post, Body, Param, Delete, Patch, Query } from '@nestjs/common';
import { MacroTasksService } from './macro-tasks.service';
import { CreateMacroTaskDto } from './dto/create-macro-task.dto';
import { UpdateMacroTaskDto } from './dto/update-macro-task.dto';
import { BatchCreateMacroTaskDto } from './dto/batch-create-macro-task.dto';
import { IngestBacklogDto, PromoteMacroTaskDto } from './dto/promote-macro-task.dto';
import { BacklogIngestService } from './backlog-ingest.service';

@Controller('projects/:projectId/macro-tasks')
export class MacroTasksController {
  constructor(
    private readonly macroTasksService: MacroTasksService,
    private readonly backlogIngest: BacklogIngestService,
  ) {}

  @Post()
  create(@Param('projectId') projectId: string, @Body() dto: CreateMacroTaskDto) {
    return this.macroTasksService.create(projectId, dto);
  }

  @Post('batch')
  createBatch(
    @Param('projectId') projectId: string,
    @Body() dto: BatchCreateMacroTaskDto,
  ) {
    return this.macroTasksService.createBatch(projectId, dto);
  }

  @Get()
  findAll(
    @Param('projectId') projectId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = limit ? parseInt(limit, 10) : undefined;
    return this.macroTasksService.findAll(projectId, cursor, parsedLimit);
  }

  // As rotas literais de backlog vêm ANTES de `:id` — o Nest casa por ordem de
  // declaração e `@Get(':id')` engoliria `/backlog`.

  @Get('backlog')
  listBacklog(@Param('projectId') projectId: string) {
    return this.macroTasksService.listBacklog(projectId);
  }

  @Get('backlog/summary')
  backlogSummary(@Param('projectId') projectId: string) {
    return this.macroTasksService.backlogSummary(projectId);
  }

  /** Ingestão manual — usada para o backfill dos reports que ninguém consumiu. */
  @Post('backlog/ingest')
  async ingestBacklog(
    @Param('projectId') projectId: string,
    @Body() dto: IngestBacklogDto,
  ) {
    if (dto.sessionId) {
      return this.backlogIngest.ingestSession(dto.sessionId);
    }
    const results = await this.backlogIngest.ingestProject(projectId);
    return {
      sessions: results.length,
      created: results.reduce((sum, r) => sum + r.created, 0),
      merged: results.reduce((sum, r) => sum + r.merged, 0),
      skipped: results.reduce((sum, r) => sum + r.skipped, 0),
      results: results.filter((r) => r.created || r.merged || r.errors.length),
    };
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.macroTasksService.findOne(id);
  }

  @Post(':id/promote')
  promote(@Param('id') id: string, @Body() dto: PromoteMacroTaskDto) {
    return this.macroTasksService.promote(id, dto.pipelineId);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateMacroTaskDto) {
    return this.macroTasksService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.macroTasksService.remove(id);
  }
}
