import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class SddSpecsService {
  private readonly logger = new Logger(SddSpecsService.name);

  constructor(private prisma: PrismaService) {}

  async getWorktreePath(projectId: string): Promise<string> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException(`Project ${projectId} not found`);
    const wt = project.worktreeBase;
    if (!wt || !fs.existsSync(wt)) throw new BadRequestException('Worktree not found');
    return wt;
  }

  async listSpecs(projectId: string) {
    const specs = await this.prisma.sddSpec.findMany({
      where: { projectId },
      orderBy: { nnn: 'asc' },
    });
    return specs.map(s => ({ ...s, dependsOn: s.dependsOn || [] }));
  }

  async getSpec(projectId: string, nnn: string) {
    const spec = await this.prisma.sddSpec.findUnique({
      where: { projectId_nnn: { projectId, nnn } },
    });
    if (!spec) throw new NotFoundException(`Spec ${nnn} not found`);

    const wt = await this.getWorktreePath(projectId);
    const specDir = path.join(wt, 'project_sdd', '02-specs', `${nnn}-${spec.slug}`);
    const specFile = path.join(specDir, 'spec.md');

    let content = '';
    if (fs.existsSync(specFile)) {
      content = fs.readFileSync(specFile, 'utf-8');
    }

    return { ...spec, content, dependsOn: spec.dependsOn || [] };
  }

  async updateStatus(projectId: string, nnn: string, status: string) {
    if (!['open', 'blocked', 'ready'].includes(status)) {
      throw new BadRequestException(`Invalid status: ${status}`);
    }
    const spec = await this.prisma.sddSpec.update({
      where: { projectId_nnn: { projectId, nnn } },
      data: { status },
    });
    return { ...spec, dependsOn: spec.dependsOn || [] };
  }

  async createSpec(projectId: string, dto: { slug: string; variant: string; stack: string }) {
    const wt = await this.getWorktreePath(projectId);
    const specs = await this.prisma.sddSpec.findMany({ where: { projectId }, orderBy: { nnn: 'desc' }, take: 1 });
    const nnn = String((parseInt(specs[0]?.nnn || '0', 10) + 1)).padStart(3, '0');

    const spec = await this.prisma.sddSpec.create({
      data: { projectId, nnn, slug: dto.slug, variant: dto.variant || 'feature', stack: dto.stack || 'multi', status: 'open' },
    });

    // Create spec.md from template via scaffold
    // (simplified: just create the file if scaffold not available)
    return { ...spec, dependsOn: [] };
  }
}
