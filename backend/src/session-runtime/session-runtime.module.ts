import { Module, forwardRef } from '@nestjs/common';
import { WorkspaceModule } from '../workspace/workspace.module';
import { SessionRuntimeService } from './session-runtime.service';
import { PipelineEngineModule } from '../pipeline-engine/pipeline-engine.module';

@Module({
  // forwardRef: o engine importa este módulo e este serviço precisa do
  // `loadSessionPipeline` do engine (snapshot da sessão, contratos §5).
  imports: [WorkspaceModule, forwardRef(() => PipelineEngineModule)],
  providers: [SessionRuntimeService],
  exports: [SessionRuntimeService],
})
export class SessionRuntimeModule {}
