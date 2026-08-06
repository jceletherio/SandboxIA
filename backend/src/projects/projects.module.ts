import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { ProjectFilesService } from './project-files.service';
import { StackConfigService } from './stack-config.service';

@Module({
  controllers: [ProjectsController],
  providers: [ProjectsService, ProjectFilesService, StackConfigService],
  exports: [ProjectsService, ProjectFilesService, StackConfigService],
})
export class ProjectsModule {}
