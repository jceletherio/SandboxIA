import { Module } from '@nestjs/common';
import { QuestionsController } from './questions.controller';
import { QuestionsGlobalController } from './questions-global.controller';
import { QuestionsService } from './questions.service';

@Module({
  controllers: [QuestionsController, QuestionsGlobalController],
  providers: [QuestionsService],
  exports: [QuestionsService],
})
export class QuestionsModule {}
