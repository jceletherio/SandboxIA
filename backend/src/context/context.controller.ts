import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { ContextService } from './context.service';
import { EmbedReason, QmdEmbedService } from './qmd-embed.service';

@Controller('context')
export class ContextController {
  constructor(
    private readonly contextService: ContextService,
    private readonly qmdEmbed: QmdEmbedService,
  ) {}

  /** Listagem leve: só metadados. `search` filtra server-side (path + conteúdo). */
  @Get('files')
  getContextFiles(
    @Query('projectId') projectId?: string,
    @Query('search') search?: string,
  ) {
    return this.contextService.getFiles(projectId, search);
  }

  /** Conteúdo de um arquivo, sob demanda. */
  @Get('files/:fileId/content')
  getFileContent(
    @Param('fileId') fileId: string,
    @Query('projectId') projectId?: string,
  ) {
    return this.contextService.getFileContent(fileId, projectId);
  }

  @Get('search')
  search(@Query('q') query: string, @Query('projectId') projectId?: string) {
    return this.contextService.search(query || '', projectId);
  }

  @Post('files/:fileId')
  updateFile(
    @Param('fileId') fileId: string,
    @Body() body: { content: string; projectId?: string },
  ) {
    return this.contextService.updateFile(fileId, body.content, body.projectId);
  }

  @Post('generate-rule')
  generateRule(@Body() body: { description: string; projectId?: string }) {
    return this.contextService.generateRule(body.description, body.projectId);
  }

  /** Estado do índice do qmd: frescor, último embed, embed rodando/na fila. */
  @Get('qmd-status')
  qmdStatus(@Query('projectId') projectId?: string) {
    return this.qmdEmbed.getStatus(projectId);
  }

  /**
   * Pede um reindex. Nunca roda inline nem com sessão viva: enfileira o job
   * `qmd_embed` e devolve quando ele vai rodar.
   */
  @Post('reindex')
  reindex(@Body() body: { projectId?: string; reason?: EmbedReason }) {
    return this.qmdEmbed.requestReindex(body?.projectId, body?.reason || 'manual');
  }
}
