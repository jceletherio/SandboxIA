import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

@Injectable()
export class SddPlannerService {
  private readonly logger = new Logger(SddPlannerService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Reads requirements.md, opens SDD trilhas via scaffold, and writes plan.md.
   * Creates SddSpec records in the database.
   */
  async plan(
    projectId: string,
    options: { epic?: string; prioridade?: string } = {},
  ): Promise<{ trilhas: string[]; planMdPath: string }> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException(`Project ${projectId} not found`);

    const worktreePath = project.worktreeBase;
    if (!worktreePath || !fs.existsSync(worktreePath)) {
      throw new BadRequestException('Worktree not found');
    }

    const requirementsPath = path.join(worktreePath, 'project_sdd', '01-context', 'requirements.md');
    if (!fs.existsSync(requirementsPath)) {
      throw new BadRequestException('requirements.md not found');
    }

    // Read requirements and parse basic structure
    const content = fs.readFileSync(requirementsPath, 'utf-8');
    const epics = this.extractEpics(content, options.epic);
    const stacks = await this.getActiveStacks(projectId);

    // Get next NNN from existing specs
    const existingSpecs = await this.prisma.sddSpec.findMany({ where: { projectId } });
    let nextNnn = existingSpecs.length + 1;

    const trilhas: string[] = [];
    const planEntries: { nnn: string; slug: string; stack: string; depends: string[] }[] = [];

    // For each epic, create a trilha per relevant stack (simplified planner)
    for (const epic of epics) {
      const slug = epic.slug;
      const nnn = String(nextNnn).padStart(3, '0');

      // Determine primary stack for this epic (simplified: first active stack)
      const primaryStack = stacks[0] || 'multi';

      // Create spec via scaffold
      await this.runScaffold(worktreePath, 'feature', slug);

      // Register in DB
      await this.prisma.sddSpec.create({
        data: {
          projectId,
          nnn,
          slug,
          variant: 'feature',
          stack: primaryStack,
          status: 'open',
        },
      });

      trilhas.push(`02-specs/${nnn}-${slug}/spec.md`);
      planEntries.push({ nnn, slug, stack: primaryStack, depends: [] });
      nextNnn++;
    }

    // Write plan.md
    const planMdPath = path.join(worktreePath, 'project_sdd', '01-context', 'plan.md');
    const lines = [
      '---',
      `title: Plano de desenvolvimento`,
      `updated: ${new Date().toISOString().split('T')[0]}`,
      '---',
      '',
      '# Plano de desenvolvimento',
      '',
      '## Trilhas em ordem sugerida',
      '',
      '| NN | slug | stack | depende de |',
      '|---|---|---|---|',
    ];
    for (const e of planEntries) {
      lines.push(`| ${e.nnn} | ${e.slug} | ${e.stack} | ${e.depends.join(', ') || '—'} |`);
    }
    lines.push('', '## Premissas assumidas', '', '- (preencher após revisão)', '');

    fs.writeFileSync(planMdPath, lines.join('\n'), 'utf-8');

    this.logger.log(`Plano gerado: ${trilhas.length} trilhas para ${projectId}`);
    return { trilhas, planMdPath };
  }

  private extractEpics(content: string, filterEpic?: string): { id: string; title: string; slug: string }[] {
    const epics: { id: string; title: string; slug: string }[] = [];
    const epicRegex = /\*\*(EPIC-\d+)\s*[—-]\s*(.+?)\*\*/g;
    let match: RegExpExecArray | null;
    while ((match = epicRegex.exec(content)) !== null) {
      const id = match[1];
      const title = match[2].trim();
      if (filterEpic && id !== filterEpic) continue;
      const slug = title.toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
        .slice(0, 40);
      epics.push({ id, title, slug });
    }
    return epics;
  }

  private async getActiveStacks(projectId: string): Promise<string[]> {
    const configs = await this.prisma.stackConfig.findMany({ where: { projectId, isActive: true } });
    return configs.map(c => c.stack);
  }

  private async runScaffold(worktreePath: string, tipo: string, slug: string): Promise<void> {
    const iaFrameworkPath = process.env.IA_FRAMEWORK_PATH || '../ia-framework';
    const scaffoldScript = path.resolve(iaFrameworkPath, 'skills', 'scaffold.ps1');
    if (!fs.existsSync(scaffoldScript)) {
      throw new Error(`scaffold script not found at ${scaffoldScript}`);
    }

    return new Promise((resolve, reject) => {
      const child = spawn('powershell', [
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scaffoldScript,
        'new', tipo, '', slug,
      ], { cwd: worktreePath, stdio: ['ignore', 'pipe', 'pipe'] });

      let stderr = '';
      child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
      child.on('close', (code: number) => {
        if (code === 0) resolve();
        else reject(new Error(`scaffold failed: ${stderr}`));
      });
    });
  }
}