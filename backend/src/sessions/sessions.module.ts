import { Module } from '@nestjs/common';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';
import { SessionRuntimeModule } from '../session-runtime/session-runtime.module';
import { SchedulerModule } from '../scheduler/scheduler.module';

@Module({
  // SchedulerModule: expõe o SessionGovernorService (MT-10) — o endpoint
  // GET /sessions/governor lê o status da fila/teto direto dele.
  imports: [SessionRuntimeModule, SchedulerModule],
  controllers: [SessionsController],
  providers: [SessionsService],
  exports: [SessionsService],
})
export class SessionsModule {}
