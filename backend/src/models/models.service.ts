import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateModelDto } from './dto/create-model.dto';
import { UpdateModelDto } from './dto/update-model.dto';
import { CreateAssignmentDto } from './dto/create-assignment.dto';

@Injectable()
export class ModelsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateModelDto) {
    return this.prisma.lLMModel.create({ data: dto });
  }

  async findAll() {
    return this.prisma.lLMModel.findMany({
      include: { assignments: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const model = await this.prisma.lLMModel.findUnique({
      where: { id },
      include: { assignments: true },
    });
    if (!model) throw new NotFoundException('Model not found');
    return model;
  }

  async update(id: string, dto: UpdateModelDto) {
    await this.findOne(id);
    return this.prisma.lLMModel.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.lLMModel.delete({ where: { id } });
  }

  async getAssignments() {
    return this.prisma.phaseModelAssignment.findMany({
      include: { model: true, cliProfile: true },
      orderBy: { phase: 'asc' },
    });
  }

  async createAssignment(dto: CreateAssignmentDto) {
    return this.prisma.phaseModelAssignment.create({ data: dto });
  }

  async removeAssignment(id: string) {
    return this.prisma.phaseModelAssignment.delete({ where: { id } });
  }
}
