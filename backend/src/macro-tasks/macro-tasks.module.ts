import { Module } from '@nestjs/common';
import { MacroTasksController } from './macro-tasks.controller';
import { MacroTasksService } from './macro-tasks.service';
import { BacklogIngestService } from './backlog-ingest.service';
import { ArtifactsModule } from '../artifacts/artifacts.module';

@Module({
  imports: [ArtifactsModule],
  controllers: [MacroTasksController],
  providers: [MacroTasksService, BacklogIngestService],
  exports: [MacroTasksService, BacklogIngestService],
})
export class MacroTasksModule {}
