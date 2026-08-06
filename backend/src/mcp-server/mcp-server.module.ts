import { Module } from '@nestjs/common';
import { McpServerService } from './mcp-server.service';
import { McpToolsFactory } from './mcp-tools.factory';
import { McpHttpController } from './mcp-http.controller';
import { ContextModule } from '../context/context.module';
import { PipelineEngineModule } from '../pipeline-engine/pipeline-engine.module';
import { SessionsModule } from '../sessions/sessions.module';
import { QuestionsModule } from '../questions/questions.module';
import { SessionRuntimeModule } from '../session-runtime/session-runtime.module';
import { ScheduledJobsModule } from '../scheduled-jobs/scheduled-jobs.module';
import { CliFilesModule } from '../cli-files/cli-files.module';

@Module({
  imports: [
    ContextModule,
    PipelineEngineModule,
    SessionsModule,
    QuestionsModule,
    SessionRuntimeModule,
    // schedule_loop / cancel_scheduled_loop. Sem ciclo: ScheduledJobsModule não
    // importa nenhum outro módulo.
    ScheduledJobsModule,
    // list_cli_capabilities + validação de skills/subagentes do runtime override.
    CliFilesModule,
  ],
  controllers: [McpHttpController],
  providers: [McpServerService, McpToolsFactory],
  exports: [McpServerService],
})
export class McpServerModule {}
