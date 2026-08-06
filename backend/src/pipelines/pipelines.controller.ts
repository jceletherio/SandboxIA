import { Controller, Get, Post, Body, Param, Delete, Patch, Query } from '@nestjs/common';
import { PipelinesService } from './pipelines.service';
import { CreatePipelineDto } from './dto/create-pipeline.dto';
import { UpdatePipelineDto } from './dto/update-pipeline.dto';
import { ListPipelinesQueryDto } from './dto/list-pipelines.dto';

@Controller('projects/:projectId/pipelines')
export class PipelinesController {
  constructor(private readonly pipelinesService: PipelinesService) {}

  @Post()
  create(@Param('projectId') projectId: string, @Body() dto: CreatePipelineDto) {
    return this.pipelinesService.create(projectId, dto);
  }

  @Get()
  findAll(@Param('projectId') projectId: string, @Query() query: ListPipelinesQueryDto) {
    return this.pipelinesService.findAll(projectId, query);
  }

  /**
   * Opções dos filtros + contadores. Precisa vir ANTES do `@Get(':id')`,
   * senão "facets" é casado como um id de pipeline (mesmo motivo do
   * `templates` logo abaixo).
   */
  @Get('facets')
  facets(@Param('projectId') projectId: string, @Query() query: ListPipelinesQueryDto) {
    return this.pipelinesService.facets(projectId, query);
  }

  @Get('templates')
  getTemplates() {
    return [
      {
        name: 'SDD (Spec-Driven Development)',
        description: '8-stage pipeline: Discovery → Q&A → Spec → Tasks → Impl → Review → Tests → Merge',
        stages: [
          { name: 'Discovery', timeout: 30, onQuestion: 'continue', mode: 'interactive' },
          { name: 'Q&A', timeout: 60, onQuestion: 'pause', mode: 'interactive' },
          { name: 'Specification', timeout: 45, onQuestion: 'pause', mode: 'interactive' },
          { name: 'Task Breakdown', timeout: 20, onQuestion: 'continue', mode: 'interactive' },
          { name: 'Implementation', timeout: 120, onQuestion: 'pause', mode: 'interactive' },
          { name: 'Review', timeout: 30, onQuestion: 'continue', mode: 'interactive' },
          { name: 'Tests', timeout: 30, onQuestion: 'continue', mode: 'interactive' },
          { name: 'Merge', timeout: 10, onQuestion: 'continue', mode: 'engine' },
        ],
      },
      {
        name: 'Quick Fix',
        description: '4-stage pipeline for bug fixes: Analyze → Fix → Test → Merge',
        stages: [
          { name: 'Analyze', timeout: 15, onQuestion: 'continue', mode: 'interactive' },
          { name: 'Fix', timeout: 30, onQuestion: 'pause', mode: 'interactive' },
          { name: 'Test', timeout: 15, onQuestion: 'continue', mode: 'interactive' },
          { name: 'Merge', timeout: 10, onQuestion: 'continue', mode: 'engine' },
        ],
      },
      {
        name: 'Feature Development',
        description: '5-stage pipeline: Spec → Implement → Review → Tests → Merge',
        stages: [
          { name: 'Spec', timeout: 30, onQuestion: 'pause', mode: 'interactive' },
          { name: 'Implement', timeout: 90, onQuestion: 'pause', mode: 'interactive' },
          { name: 'Review', timeout: 30, onQuestion: 'continue', mode: 'interactive' },
          { name: 'Tests', timeout: 30, onQuestion: 'continue', mode: 'interactive' },
          { name: 'Merge', timeout: 10, onQuestion: 'continue', mode: 'engine' },
        ],
      },
    ];
  }

  @Get(':id')
  findOne(@Param('projectId') projectId: string, @Param('id') id: string) {
    return this.pipelinesService.findOne(projectId, id);
  }

  @Patch(':id')
  update(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @Body() dto: UpdatePipelineDto,
  ) {
    return this.pipelinesService.update(projectId, id, dto);
  }

  @Delete(':id')
  remove(@Param('projectId') projectId: string, @Param('id') id: string) {
    return this.pipelinesService.remove(projectId, id);
  }

  @Post(':id/duplicate')
  duplicate(@Param('projectId') projectId: string, @Param('id') id: string) {
    return this.pipelinesService.duplicateAsCustom(projectId, id);
  }
}
