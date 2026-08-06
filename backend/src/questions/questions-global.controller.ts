import { Controller, Get, Param, Patch, Post, Body, Query } from '@nestjs/common';
import { QuestionsService } from './questions.service';
import { AnswerQuestionDto } from './dto/answer-question.dto';

/** Inbox global de perguntas (todas as sessões). */
@Controller('questions')
export class QuestionsGlobalController {
  constructor(private readonly questionsService: QuestionsService) {}

  @Get()
  findAll(
    @Query('status') status?: string,
    @Query('projectId') projectId?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = limit ? parseInt(limit, 10) : undefined;
    return this.questionsService.findAllGlobal({ status, projectId }, cursor, parsedLimit);
  }

  @Patch(':id/answer')
  answer(@Param('id') id: string, @Body() dto: AnswerQuestionDto) {
    return this.questionsService.answer(id, dto);
  }

  /** Descarta uma pergunta pendente (obsoleta) sem respondê-la. */
  @Post(':id/dismiss')
  dismiss(@Param('id') id: string, @Body() body: { reason: string }) {
    return this.questionsService.dismiss(id, body?.reason, 'human');
  }
}
