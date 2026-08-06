import { Module } from '@nestjs/common';
import { GitController } from './git.controller';
import { GitService } from './git.service';
import { MergeQueueService } from './merge-queue.service';
import { WorkspaceModule } from '../workspace/workspace.module';

@Module({
  imports: [WorkspaceModule],
  controllers: [GitController],
  providers: [GitService, MergeQueueService],
  exports: [GitService, MergeQueueService],
})
export class GitModule {}
