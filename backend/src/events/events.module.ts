import { Module } from '@nestjs/common';
import { MacroTasksModule } from '../macro-tasks/macro-tasks.module';
import { SessionCompletedReconcilerService } from './session-completed-reconciler.service';

/** Reconciliação de eventos Redis perdidos (MT-20, item 6). */
@Module({
  imports: [MacroTasksModule],
  providers: [SessionCompletedReconcilerService],
})
export class EventsModule {}
