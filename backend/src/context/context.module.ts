import { Module } from '@nestjs/common';
import { ContextController } from './context.controller';
import { ContextService } from './context.service';
import { QmdEmbedService } from './qmd-embed.service';
import { MasterAgentModule } from '../master-agent/master-agent.module';

@Module({
  // O generate-rule despacha um prompt para o terminal do Master Agent.
  // Sem ciclo: MasterAgentModule só importa ProjectsModule.
  imports: [MasterAgentModule],
  controllers: [ContextController],
  providers: [ContextService, QmdEmbedService],
  // QmdEmbedService é exportado para o handler `qmd_embed` do SchedulerService e
  // para a tool `reindex_context` do MCP do Master.
  exports: [ContextService, QmdEmbedService],
})
export class ContextModule {}
