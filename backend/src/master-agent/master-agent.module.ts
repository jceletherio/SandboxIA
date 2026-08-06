import { Module } from '@nestjs/common';
import { MasterAgentService } from './master-agent.service';
import { MasterRuntimeService } from './master-runtime.service';
import { MasterAgentController } from './master-agent.controller';
import { ProjectsModule } from '../projects/projects.module';

@Module({
  imports: [ProjectsModule],
  controllers: [MasterAgentController],
  providers: [MasterAgentService, MasterRuntimeService],
  exports: [MasterAgentService, MasterRuntimeService],
})
export class MasterAgentModule {}
