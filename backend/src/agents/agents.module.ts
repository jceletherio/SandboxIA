import { Module } from '@nestjs/common';
import { AgentsController, GlobalAgentsController } from './agents.controller';
import { AgentsService } from './agents.service';

@Module({
  controllers: [AgentsController, GlobalAgentsController],
  providers: [AgentsService],
  exports: [AgentsService],
})
export class AgentsModule {}
