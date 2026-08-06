import { Module, forwardRef } from '@nestjs/common';
import { PipelineEngineService } from './pipeline-engine.service';
import { PipelineExecutionController } from './pipeline-execution.controller';
import { SessionRuntimeModule } from '../session-runtime/session-runtime.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { GitModule } from '../git/git.module';
import { SchedulerModule } from '../scheduler/scheduler.module';

@Module({
  // forwardRef: ciclo com o session-runtime, que consome `loadSessionPipeline`,
  // e com o scheduler (MT-10), dono do SessionGovernorService que decide o
  // limite/fila dentro de startPipeline.
  imports: [
    forwardRef(() => SessionRuntimeModule),
    WorkspaceModule,
    GitModule,
    forwardRef(() => SchedulerModule),
  ],
  controllers: [PipelineExecutionController],
  providers: [PipelineEngineService],
  exports: [PipelineEngineService],
})
export class PipelineEngineModule {}
