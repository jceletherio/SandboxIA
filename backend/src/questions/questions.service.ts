import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { CHANNELS } from '../redis/channels';
import { CreateQuestionDto } from './dto/create-question.dto';
import { AnswerQuestionDto } from './dto/answer-question.dto';

@Injectable()
export class QuestionsService {
  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  async create(sessionId: string, dto: CreateQuestionDto) {
    const question = await this.prisma.question.create({
      data: {
        ...dto,
        sessionId,
      },
    });
    await this.redis.publish(CHANNELS.QUESTION_CREATED, question);
    return question;
  }

  async findAll(sessionId: string) {
    return this.prisma.question.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findAllGlobal(filters: { status?: string; projectId?: string } = {}, cursor?: string, limit: number = 50) {
    const effectiveLimit = Math.min(Math.max(limit, 1), 200);
    const items = await this.prisma.question.findMany({
      where: {
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.projectId
          ? { session: { macroTask: { projectId: filters.projectId } } }
          : {}),
      },
      include: {
        session: {
          select: {
            id: true,
            branchName: true,
            currentStage: true,
            macroTask: { select: { id: true, title: true, projectId: true } },
            agent: { select: { id: true, name: true, type: true } },
          },
        },
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      cursor: cursor ? { id: cursor } : undefined,
      take: effectiveLimit + 1,
      skip: cursor ? 1 : 0,
    });
    const nextCursor = items.length > effectiveLimit ? items[effectiveLimit - 1].id : null;
    return { data: items.slice(0, effectiveLimit), nextCursor };
  }

  async findOne(id: string) {
    const question = await this.prisma.question.findUnique({
      where: { id },
    });
    if (!question) throw new NotFoundException('Question not found');
    return question;
  }

  async answer(id: string, dto: AnswerQuestionDto) {
    const existing = await this.findOne(id);
    const question = await this.prisma.question.update({
      where: { id },
      data: {
        answer: dto.answer,
        status: 'answered',
        answeredAt: new Date(),
        metadata: {
          ...((existing.metadata as any) || {}),
          answeredBy: 'human',
        },
      },
    });
    await this.redis.publish(CHANNELS.QUESTION_ANSWERED, question);
    await this.redis.publish(`question:${id}:answered`, {
      questionId: id,
      answer: question.answer,
      answeredAt: question.answeredAt,
    });
    return question;
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.question.delete({ where: { id } });
  }

  /**
   * Descarta uma pergunta pendente (obsoleta/irrelevante) sem respondê-la.
   * Marca status 'dismissed' com auditoria, registra LogEntry na sessão e
   * publica no canal QUESTION_ANSWERED (o pipeline-engine escuta esse canal
   * para retomar sessões waiting quando não restam perguntas pendentes).
   */
  async dismiss(id: string, reason: string, dismissedBy: 'human' | 'master-agent' = 'human') {
    const trimmedReason = (reason || '').trim();
    if (!trimmedReason) {
      throw new BadRequestException('A reason is required to dismiss a question');
    }
    const existing = await this.findOne(id);
    if (existing.status !== 'pending') {
      throw new BadRequestException(
        `Only pending questions can be dismissed (current status: ${existing.status})`,
      );
    }

    const meta = (existing.metadata as any) || {};
    const answer = `DISMISSED: ${trimmedReason}`;
    const question = await this.prisma.question.update({
      where: { id },
      data: {
        status: 'dismissed',
        answer,
        answeredAt: new Date(),
        metadata: {
          ...meta,
          audit: { dismissedBy, reason: trimmedReason, at: new Date().toISOString() },
        },
      },
    });

    // Auditoria na sessão
    await this.prisma.logEntry.create({
      data: {
        sessionId: existing.sessionId,
        level: 'info',
        message: `Question ${id.slice(0, 8)} dismissed by ${dismissedBy}: ${trimmedReason}`,
        metadata: { questionId: id, action: 'dismiss', dismissedBy, reason: trimmedReason },
      },
    });

    await this.redis.publish(CHANNELS.QUESTION_ANSWERED, question);
    await this.redis.publish(`question:${id}:answered`, {
      questionId: id,
      answer,
      answeredAt: question.answeredAt,
    });
    return question;
  }
}
