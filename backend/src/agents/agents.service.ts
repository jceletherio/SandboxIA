import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAgentDto } from './dto/create-agent.dto';
import { UpdateAgentDto } from './dto/update-agent.dto';

@Injectable()
export class AgentsService {
  constructor(private prisma: PrismaService) {}

  async create(projectId: string, dto: CreateAgentDto) {
    return this.prisma.agent.create({
      data: {
        ...dto,
        projectId,
      },
    });
  }

  async findAll(projectId: string) {
    return this.prisma.agent.findMany({
      where: { projectId },
      include: { sessions: true },
    });
  }

  async findAllGlobal() {
    return this.prisma.agent.findMany({
      include: { sessions: true },
    });
  }

  async findOne(id: string) {
    const agent = await this.prisma.agent.findUnique({
      where: { id },
      include: { sessions: true },
    });
    if (!agent) throw new NotFoundException('Agent not found');
    return agent;
  }

  async update(id: string, dto: UpdateAgentDto) {
    await this.findOne(id);
    return this.prisma.agent.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.agent.delete({ where: { id } });
  }
}
