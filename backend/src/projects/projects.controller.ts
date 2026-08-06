import { Controller, Get, Post, Body, Param, Delete, Patch, Query, Put } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { ProjectFilesService } from './project-files.service';
import { StackConfigService } from './stack-config.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { CloneProjectDto } from './dto/clone-project.dto';

@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly projectFilesService: ProjectFilesService,
    private readonly stackConfigService: StackConfigService,
  ) {}

  @Post()
  create(@Body() dto: CreateProjectDto) {
    return this.projectsService.create(dto);
  }

  /**
   * Cria um projeto a partir de um template, clonando só configuração.
   * Segmento estático depois do param — não colide com nenhuma rota `POST /projects/:id`
   * (não existe nenhuma outra neste controller).
   */
  @Post(':templateId/clone')
  clone(@Param('templateId') templateId: string, @Body() dto: CloneProjectDto) {
    return this.projectsService.createFromTemplate(templateId, dto);
  }

  @Get()
  findAll() {
    return this.projectsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.projectsService.findOne(id);
  }

  @Get(':id/settings')
  getSettings(@Param('id') id: string) {
    return this.projectsService.getSettings(id);
  }

  /**
   * `settings.defaults` (01-CONTRATOS §4) — camada mais fraca da precedência
   * do resolver, consumida pela `/settings` do frontend.
   */
  @Get(':id/defaults')
  getDefaults(@Param('id') id: string) {
    return this.projectsService.getDefaults(id);
  }

  /**
   * Arquivos REAIS do repositório do projeto, para referência por `@arquivo` no
   * chat. Só nomes — nenhum conteúdo é lido aqui.
   *
   * Segundo segmento estático, então não colide com `GET /projects/:id`.
   */
  @Get(':id/files')
  listFiles(
    @Param('id') id: string,
    @Query('query') query?: string,
    @Query('limit') limit?: string,
  ) {
    const parsed = limit ? parseInt(limit, 10) : undefined;
    return this.projectFilesService.listFiles(id, {
      query,
      limit: Number.isFinite(parsed) ? parsed : undefined,
    });
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateProjectDto) {
    return this.projectsService.update(id, dto);
  }

  @Patch(':id/settings')
  updateSettings(@Param('id') id: string, @Body() settings: Record<string, any>) {
    return this.projectsService.updateSettings(id, settings);
  }

  @Patch(':id/defaults')
  setDefaults(@Param('id') id: string, @Body() patch: Record<string, any>) {
    return this.projectsService.setDefaults(id, patch);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.projectsService.remove(id);
  }

  // === SandboxIA: Stack Config ===

  @Get(':id/stacks')
  getStacks(@Param('id') id: string) {
    return this.stackConfigService.getStacks(id);
  }

  @Put(':id/stacks')
  updateStacks(@Param('id') id: string, @Body() body: { stacks: { stack: string; isActive: boolean }[] }) {
    const stacks = Array.isArray(body) ? body : body.stacks;
    return this.stackConfigService.updateStacks(id, stacks);
  }

  // === SandboxIA: Project State ===

  @Get(':id/state')
  getProjectState(@Param('id') id: string) {
    return this.stackConfigService.getProjectState(id);
  }
}
