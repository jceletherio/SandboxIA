import { Module } from '@nestjs/common';
import { ScheduledJobsController } from './scheduled-jobs.controller';
import { ScheduledJobsService } from './scheduled-jobs.service';

@Module({
  controllers: [ScheduledJobsController],
  providers: [ScheduledJobsService],
  exports: [ScheduledJobsService],
})
export class ScheduledJobsModule {}
