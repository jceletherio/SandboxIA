import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { ProjectsModule } from './projects/projects.module';
import { PipelinesModule } from './pipelines/pipelines.module';
import { MacroTasksModule } from './macro-tasks/macro-tasks.module';
import { SessionsModule } from './sessions/sessions.module';
import { QuestionsModule } from './questions/questions.module';
import { WorkspaceModule } from './workspace/workspace.module';
import { McpServerModule } from './mcp-server/mcp-server.module';
import { MasterAgentModule } from './master-agent/master-agent.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { LogsModule } from './logs/logs.module';
import { PipelineEngineModule } from './pipeline-engine/pipeline-engine.module';
import { AgentsModule } from './agents/agents.module';
import { ScheduledJobsModule } from './scheduled-jobs/scheduled-jobs.module';
import { ArtifactsModule } from './artifacts/artifacts.module';
import { McpsModule } from './mcps/mcps.module';
import { ModelsModule } from './models/models.module';
import { ContextModule } from './context/context.module';
import { TerminalModule } from './terminal/terminal.module';
import { TerminalGatewayModule } from './terminal/terminal.gateway.module';
import { SessionRuntimeModule } from './session-runtime/session-runtime.module';
import { SseModule } from './sse/sse.module';
import { HealthModule } from './health/health.module';
import { CliProfilesModule } from './cli-profiles/cli-profiles.module';
import { GitModule } from './git/git.module';
import { CliFilesModule } from './cli-files/cli-files.module';
import { GithubModule } from './integrations/github/github.module';
import { EventsModule } from './events/events.module';
import { NotificationsModule } from './notifications/notifications.module';
import { RequirementsModule } from './requirements/requirements.module';
import { SddSpecsModule } from './sdd-specs/sdd-specs.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    RedisModule,
    ProjectsModule,
    PipelinesModule,
    MacroTasksModule,
    SessionsModule,
    QuestionsModule,
    WorkspaceModule,
    McpServerModule,
    MasterAgentModule,
    SchedulerModule,
    LogsModule,
    PipelineEngineModule,
    AgentsModule,
    ScheduledJobsModule,
    ArtifactsModule,
    McpsModule,
    ModelsModule,
    ContextModule,
    TerminalModule,
    TerminalGatewayModule,
    SessionRuntimeModule,
    SseModule,
    HealthModule,
    CliProfilesModule,
    GitModule,
    CliFilesModule,
    GithubModule,
    EventsModule,
    NotificationsModule,
    RequirementsModule,
    SddSpecsModule,
  ],
})
export class AppModule {}
