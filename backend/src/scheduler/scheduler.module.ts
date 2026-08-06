import { Module, forwardRef } from '@nestjs/common';
import { SchedulerService } from './scheduler.service';
import { SessionGovernorService } from './session-governor.service';
import { WorkspaceModule } from '../workspace/workspace.module';
import { SessionRuntimeModule } from '../session-runtime/session-runtime.module';
import { MasterAgentModule } from '../master-agent/master-agent.module';
import { ContextModule } from '../context/context.module';
import { PipelineEngineModule } from '../pipeline-engine/pipeline-engine.module';

@Module({
  // MasterAgentModule: os jobs `master_loop` despacham prompt no terminal do
  // Master. Sem ciclo — MasterAgentModule só importa ProjectsModule (mesmo
  // precedente do ContextModule).
  // ContextModule: handler do job `qmd_embed` (MT-6). Sem ciclo — ContextModule
  // só importa MasterAgentModule.
  // SessionRuntimeModule e PipelineEngineModule aqui viraram um ciclo de 3
  // (SchedulerModule <-> PipelineEngineModule <-> SessionRuntimeModule) com o
  // novo SessionGovernorService (MT-10). Os DOIS precisam de forwardRef agora:
  // sem isso, o `require()` do Node pode entregar a classe ainda `undefined`
  // dependendo da ordem de carregamento (deu exatamente esse erro sem o
  // forwardRef em SessionRuntimeModule, mesmo ele não sendo o módulo novo).
  imports: [
    WorkspaceModule,
    forwardRef(() => SessionRuntimeModule),
    MasterAgentModule,
    ContextModule,
    forwardRef(() => PipelineEngineModule),
  ],
  providers: [SchedulerService, SessionGovernorService],
  exports: [SchedulerService, SessionGovernorService],
})
export class SchedulerModule {}
