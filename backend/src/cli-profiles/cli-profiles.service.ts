import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCliProfileDto } from './dto/create-cli-profile.dto';
import { UpdateCliProfileDto } from './dto/update-cli-profile.dto';

const DEFAULT_MCP_TEMPLATE = {
  mcpServers: {
    orchestrator: {
      type: 'http',
      url: '{{url}}',
      headers: { Authorization: 'Bearer {{token}}' },
    },
  },
};

@Injectable()
export class CliProfilesService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateCliProfileDto) {
    const existing = await this.prisma.cliProfile.findUnique({ where: { name: dto.name } });
    if (existing) {
      throw new BadRequestException(`A CLI profile named "${dto.name}" already exists`);
    }
    if (dto.isDefault) {
      await this.prisma.cliProfile.updateMany({ where: {}, data: { isDefault: false } });
    }
    return this.prisma.cliProfile.create({
      data: {
        name: dto.name,
        binary: dto.binary,
        interactiveArgs: dto.interactiveArgs ?? [],
        resumeArgs: dto.resumeArgs ?? undefined,
        mcpConfigFile: dto.mcpConfigFile ?? '.orchestrator/mcp.json',
        mcpConfigTemplate: (dto.mcpConfigTemplate as any) ?? DEFAULT_MCP_TEMPLATE,
        env: (dto.env as any) ?? undefined,
        defaultModel: dto.defaultModel,
        builtin: false,
        isDefault: dto.isDefault ?? false,
      },
    });
  }

  async findAll() {
    return this.prisma.cliProfile.findMany({ orderBy: [{ isDefault: 'desc' }, { builtin: 'desc' }, { name: 'asc' }] });
  }

  async findOne(id: string) {
    const profile = await this.prisma.cliProfile.findUnique({ where: { id } });
    if (!profile) throw new NotFoundException('CLI profile not found');
    return profile;
  }

  async update(id: string, dto: UpdateCliProfileDto) {
    await this.findOne(id);
    if (dto.name) {
      const clash = await this.prisma.cliProfile.findUnique({ where: { name: dto.name } });
      if (clash && clash.id !== id) {
        throw new BadRequestException(`A CLI profile named "${dto.name}" already exists`);
      }
    }
    if (dto.isDefault) {
      await this.prisma.cliProfile.updateMany({ where: { id: { not: id } }, data: { isDefault: false } });
    }
    return this.prisma.cliProfile.update({
      where: { id },
      data: {
        ...dto,
        mcpConfigTemplate: dto.mcpConfigTemplate as any,
        env: dto.env as any,
      },
    });
  }

  async remove(id: string) {
    const profile = await this.findOne(id);
    if (profile.builtin) {
      throw new BadRequestException('Built-in profiles cannot be deleted (you can edit them instead)');
    }
    const agentsUsing = await this.prisma.agent.count({ where: { cliProfileId: id } });
    if (agentsUsing > 0) {
      throw new BadRequestException(
        `This profile is used by ${agentsUsing} agent(s) — reassign them before deleting`,
      );
    }
    return this.prisma.cliProfile.delete({ where: { id } });
  }
}
