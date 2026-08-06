import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateScheduledJobDto } from './dto/create-scheduled-job.dto';
import { UpdateScheduledJobDto } from './dto/update-scheduled-job.dto';
import { CreateMasterLoopDto } from './dto/create-master-loop.dto';
import {
  MASTER_LOOP_JOB_TYPE,
  MasterLoopInput,
  readMasterLoopPayload,
  validateMasterLoopPayload,
} from './master-loop';
import { ScheduledJobType, assertKnownJobType, projectIdFromPayload } from '../scheduler/job-types';

@Injectable()
export class ScheduledJobsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateScheduledJobDto) {
    const payload =
      dto.type === MASTER_LOOP_JOB_TYPE
        ? await this.buildMasterLoopPayload(dto.payload, 0)
        : (dto.payload ?? {});

    return this.prisma.scheduledJob.create({
      data: {
        type: this.assertType(dto.type),
        payload,
        projectId: projectIdFromPayload(payload),
        scheduledAt: dto.scheduledAt,
        notes: dto.notes,
      },
    });
  }

  /**
   * Cria um agendamento `master_loop` (instruções livres para o terminal do
   * Master + recorrência opcional com rate-limit). Reaproveitado pela UI
   * (`POST /scheduled-jobs/master-loop`) e pela MCP tool `schedule_loop`.
   */
  async createMasterLoop(input: MasterLoopInput & { scheduledAt: Date; notes?: string }) {
    const payload = await this.buildMasterLoopPayload(
      {
        instructions: input.instructions,
        projectId: input.projectId,
        repeatIntervalMinutes: input.repeatIntervalMinutes,
        maxRuns: input.maxRuns,
      },
      0,
    );

    return this.prisma.scheduledJob.create({
      data: {
        type: MASTER_LOOP_JOB_TYPE,
        payload,
        projectId: input.projectId,
        scheduledAt: input.scheduledAt,
        notes: input.notes,
      },
    });
  }

  /** Atalho para o controller: o DTO já veio validado pelo ValidationPipe. */
  async createMasterLoopFromDto(dto: CreateMasterLoopDto) {
    return this.createMasterLoop({
      instructions: dto.instructions,
      projectId: dto.projectId,
      scheduledAt: dto.scheduledAt,
      repeatIntervalMinutes: dto.repeatIntervalMinutes,
      maxRuns: dto.maxRuns,
      notes: dto.notes,
    });
  }

  async findAll() {
    return this.prisma.scheduledJob.findMany({
      orderBy: { scheduledAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const job = await this.prisma.scheduledJob.findUnique({
      where: { id },
    });
    if (!job) throw new NotFoundException('Scheduled job not found');
    return job;
  }

  async update(id: string, dto: UpdateScheduledJobDto) {
    const existing = await this.findOne(id);
    const type = dto.type ?? existing.type;

    const data: Record<string, any> = {};
    if (dto.type !== undefined) data.type = this.assertType(dto.type);
    if (dto.scheduledAt !== undefined) data.scheduledAt = dto.scheduledAt;
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.status !== undefined) data.status = dto.status;

    if (dto.payload !== undefined) {
      if (type === MASTER_LOOP_JOB_TYPE) {
        // Editar um master_loop preserva o runCount já consumido: o cliente pode
        // mudar instruções/recorrência, nunca o contador de execuções.
        const previousRunCount = readMasterLoopPayload(existing.payload).runCount;
        data.payload = await this.buildMasterLoopPayload(dto.payload, previousRunCount);
      } else {
        data.payload = dto.payload;
      }
      // Payload novo, coluna nova: sem isto, editar o projeto de um job na UI
      // deixaria `projectId` apontando para o projeto antigo — exatamente o
      // desencontro que a coluna existe para eliminar.
      data.projectId = projectIdFromPayload(data.payload);
    }

    return this.prisma.scheduledJob.update({ where: { id }, data });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.scheduledJob.delete({ where: { id } });
  }

  /**
   * Tipo desconhecido é rejeitado NA ESCRITA (MT-13). Antes, `type` era string
   * livre: um typo vindo da /scheduler só aparecia 30s depois como job `failed`
   * com `Unknown job type`, sem ninguém olhando.
   */
  private assertType(type: string): ScheduledJobType {
    try {
      return assertKnownJobType(type);
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  /**
   * Valida o payload de `master_loop` e confere que o projeto existe de verdade
   * (um `projectId` inválido faria o scheduler adiar o disparo para sempre).
   */
  private async buildMasterLoopPayload(
    raw: unknown,
    previousRunCount: number,
  ): Promise<Record<string, any>> {
    let payload;
    try {
      payload = validateMasterLoopPayload(raw, previousRunCount);
    } catch (error) {
      throw new BadRequestException(error.message);
    }

    const project = await this.prisma.project.findUnique({
      where: { id: payload.projectId },
      select: { id: true },
    });
    if (!project) {
      throw new BadRequestException(`Project ${payload.projectId} not found`);
    }
    return { ...payload };
  }
}
