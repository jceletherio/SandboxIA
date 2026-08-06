import { Controller, Get, Post, Body, Param, Delete, Patch } from '@nestjs/common';
import { QuestionsService } from './questions.service';
import { CreateQuestionDto } from './dto/create-question.dto';
import { AnswerQuestionDto } from './dto/answer-question.dto';

@Controller('sessions/:sessionId/questions')
export class QuestionsController {
  constructor(private readonly questionsService: QuestionsService) {}

  @Post()
  create(@Param('sessionId') sessionId: string, @Body() dto: CreateQuestionDto) {
    return this.questionsService.create(sessionId, dto);
  }

  @Get()
  findAll(@Param('sessionId') sessionId: string) {
    return this.questionsService.findAll(sessionId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.questionsService.findOne(id);
  }

  @Patch(':id/answer')
  answer(@Param('id') id: string, @Body() dto: AnswerQuestionDto) {
    return this.questionsService.answer(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.questionsService.remove(id);
  }
}
