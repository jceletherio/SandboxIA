import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { ProjectFilesService } from './project-files.service';

@Module({
  controllers: [ProjectsController],
  providers: [ProjectsService, ProjectFilesService],
  exports: [ProjectsService, ProjectFilesService],
})
export class ProjectsModule {}
