import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { CliFilesService } from './cli-files.service';

/**
 * Arquivos de agentes/commands/skills dos CLIs de IA no repo do projeto
 * selecionado. Agnóstico de CLI: o :target (claude|opencode) define o
 * diretório usado. As rotas de skills vêm ANTES das genéricas :kind para
 * terem precedência no roteamento.
 */
@Controller('projects/:projectId/cli-files')
export class CliFilesController {
  constructor(private readonly cliFiles: CliFilesService) {}

  // ------------------------------------------------------------- skills

  @Get('skills')
  listSkills(@Param('projectId') projectId: string) {
    return this.cliFiles.listProjectSkills(projectId);
  }

  @Get('skills/:target/:dirName/file')
  readSkillFile(
    @Param('projectId') projectId: string,
    @Param('target') target: string,
    @Param('dirName') dirName: string,
    @Query('path') relPath: string,
  ) {
    return this.cliFiles.readProjectSkillFile(projectId, target, dirName, relPath);
  }

  @Put('skills/:target/:dirName/file')
  writeSkillFile(
    @Param('projectId') projectId: string,
    @Param('target') target: string,
    @Param('dirName') dirName: string,
    @Body() body: { path: string; content: string },
  ) {
    return this.cliFiles.writeProjectSkillFile(
      projectId,
      target,
      dirName,
      body?.path,
      body?.content,
    );
  }

  @Put('skills/:target/:dirName')
  createSkill(
    @Param('projectId') projectId: string,
    @Param('target') target: string,
    @Param('dirName') dirName: string,
    @Body() body: { content: string },
  ) {
    return this.cliFiles.createProjectSkill(projectId, target, dirName, body?.content);
  }

  @Post('skills/:target/:dirName/inject')
  injectSkill(
    @Param('projectId') projectId: string,
    @Param('target') target: string,
    @Param('dirName') dirName: string,
    @Body() body: { overwrite?: boolean },
  ) {
    return this.cliFiles.injectSkill(projectId, target, dirName, body?.overwrite === true);
  }

  @Post('skills/:target/:dirName/save-to-library')
  saveSkillToLibrary(
    @Param('projectId') projectId: string,
    @Param('target') target: string,
    @Param('dirName') dirName: string,
    @Body() body: { overwrite?: boolean },
  ) {
    return this.cliFiles.saveSkillToLibrary(projectId, target, dirName, body?.overwrite === true);
  }

  @Delete('skills/:target/:dirName')
  deleteSkill(
    @Param('projectId') projectId: string,
    @Param('target') target: string,
    @Param('dirName') dirName: string,
  ) {
    return this.cliFiles.deleteProjectSkill(projectId, target, dirName);
  }

  // ---------------------------------------------------- agents / commands

  @Get(':kind')
  list(@Param('projectId') projectId: string, @Param('kind') kind: string) {
    return this.cliFiles.listProjectFiles(projectId, kind);
  }

  @Put(':kind/:target/:fileName')
  write(
    @Param('projectId') projectId: string,
    @Param('kind') kind: string,
    @Param('target') target: string,
    @Param('fileName') fileName: string,
    @Body() body: { content: string },
  ) {
    return this.cliFiles.writeProjectFile(projectId, kind, target, fileName, body?.content);
  }

  @Delete(':kind/:target/:fileName')
  remove(
    @Param('projectId') projectId: string,
    @Param('kind') kind: string,
    @Param('target') target: string,
    @Param('fileName') fileName: string,
  ) {
    return this.cliFiles.deleteProjectFile(projectId, kind, target, fileName);
  }
}

/** Biblioteca global (~/.orchestr/defaults), independente de CLI e de projeto. */
@Controller('cli-library')
export class CliLibraryController {
  constructor(private readonly cliFiles: CliFilesService) {}

  // ------------------------------------------------------------- skills

  @Get('skills')
  listSkills() {
    return this.cliFiles.listLibrarySkills();
  }

  @Get('skills/:dirName/file')
  readSkillFile(@Param('dirName') dirName: string, @Query('path') relPath: string) {
    return this.cliFiles.readLibrarySkillFile(dirName, relPath);
  }

  @Delete('skills/:dirName')
  deleteSkill(@Param('dirName') dirName: string) {
    return this.cliFiles.deleteLibrarySkill(dirName);
  }

  // ---------------------------------------------------- agents / commands

  @Get(':kind')
  list(@Param('kind') kind: string) {
    return this.cliFiles.listLibrary(kind);
  }

  @Put(':kind/:fileName')
  save(
    @Param('kind') kind: string,
    @Param('fileName') fileName: string,
    @Body() body: { content: string },
  ) {
    return this.cliFiles.saveToLibrary(kind, fileName, body?.content);
  }

  @Delete(':kind/:fileName')
  remove(@Param('kind') kind: string, @Param('fileName') fileName: string) {
    return this.cliFiles.deleteFromLibrary(kind, fileName);
  }
}
