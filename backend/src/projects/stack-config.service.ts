import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as fs from 'fs';
import * as path from 'path';

const SUPPORTED_STACKS = ['angular', 'nodejs', 'spring', 'go', 'postgres'] as const;
type StackId = typeof SUPPORTED_STACKS[number];

const STACK_AGENTS: Record<StackId, string[]> = {
  angular:  ['angular-arquiteto', 'angular-seguranca', 'angular-implementador'],
  nodejs:   ['nodejs-arquiteto', 'nodejs-seguranca', 'nodejs-implementador'],
  spring:   ['spring-arquiteto', 'spring-seguranca', 'spring-implementador'],
  go:       ['go-arquiteto', 'go-seguranca', 'go-implementador'],
  postgres: ['postgres-arquiteto', 'postgres-seguranca', 'postgres-implementador'],
};

const STACK_SKILLS: Record<StackId, string> = {
  angular:  'skills/stacks/angular',
  nodejs:   'skills/stacks/nodejs',
  spring:   'skills/stacks/spring',
  go:       'skills/stacks/go',
  postgres: 'skills/stacks/postgres',
};

@Injectable()
export class StackConfigService {
  private readonly logger = new Logger(StackConfigService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Lista todas as stacks suportadas com status ativo/inativo para um projeto.
   */
  async getStacks(projectId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException(`Project ${projectId} not found`);

    const configs = await this.prisma.stackConfig.findMany({ where: { projectId } });
    const configMap = new Map(configs.map(c => [c.stack, c]));

    return SUPPORTED_STACKS.map(stack => ({
      stack,
      isActive: configMap.get(stack)?.isActive ?? false,
      agentCount: STACK_AGENTS[stack].length,
      agents: STACK_AGENTS[stack],
      skillPath: STACK_SKILLS[stack],
    }));
  }

  /**
   * Ativa/desativa stacks para um projeto. Quando ativa, copia os agents/commands/skills
   * correspondentes para o worktree do projeto e atualiza STACK.md.
   */
  async updateStacks(projectId: string, stacks: { stack: string; isActive: boolean }[]) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException(`Project ${projectId} not found`);

    const results: { stack: string; isActive: boolean; agentCount: number; copied: boolean }[] = [];

    for (const { stack, isActive } of stacks) {
      if (!SUPPORTED_STACKS.includes(stack as StackId)) {
        this.logger.warn(`Unknown stack: ${stack}, skipping`);
        continue;
      }

      const config = await this.prisma.stackConfig.upsert({
        where: { projectId_stack: { projectId, stack } },
        update: { isActive, agentCount: isActive ? STACK_AGENTS[stack as StackId].length : 0 },
        create: { projectId, stack, isActive, agentCount: isActive ? STACK_AGENTS[stack as StackId].length : 0 },
      });

      results.push({
        stack,
        isActive: config.isActive,
        agentCount: config.agentCount,
        copied: false,
      });
    }

    // Atualiza STACK.md no worktree do projeto
    await this.writeStackMd(project, stacks);

    // Copia agents das stacks ativas para o worktree
    const worktreePath = project.worktreeBase;
    if (worktreePath && fs.existsSync(worktreePath)) {
      await this.copyAgentsToWorktree(worktreePath, stacks);
      // Mark copied=true for activated stacks
      for (const r of results) {
        if (r.isActive) r.copied = true;
      }
    }

    return results;
  }

  /**
   * Retorna diagnóstico completo do estado do projeto (para endpoint /state).
   */
  async getProjectState(projectId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException(`Project ${projectId} not found`);

    const stacks = await this.getStacks(projectId);
    const activeStacks = stacks.filter(s => s.isActive);

    const worktreeExists = project.worktreeBase ? fs.existsSync(project.worktreeBase) : false;
    const projectSddExists = worktreeExists ? fs.existsSync(path.join(project.worktreeBase, 'project_sdd', '01-context')) : false;

    // Count SDD specs
    const specCount = await this.prisma.sddSpec.count({ where: { projectId } });
    const openCount = await this.prisma.sddSpec.count({ where: { projectId, status: 'open' } });
    const blockedCount = await this.prisma.sddSpec.count({ where: { projectId, status: 'blocked' } });
    const readyCount = await this.prisma.sddSpec.count({ where: { projectId, status: 'ready' } });

    // Check requirements
    const requirementsPath = worktreeExists
      ? path.join(project.worktreeBase, 'project_sdd', '01-context', 'requirements.md')
      : null;
    const requirementsExists = requirementsPath ? fs.existsSync(requirementsPath) : false;

    // Check health checks
    const lastHealthCheck = await this.prisma.requirementsHealthCheck.findFirst({
      where: { projectId },
      orderBy: { version: 'desc' },
    });

    // Screens
    const screenCount = await this.prisma.screenDescription.count({ where: { projectId } });

    // Architecture docs
    const archPath = worktreeExists ? path.join(project.worktreeBase, 'docs', 'architecture') : null;
    const archFiles = archPath && fs.existsSync(archPath)
      ? fs.readdirSync(archPath).filter(f => f.endsWith('.md'))
      : [];

    // Test plans
    const testPlanCount = await this.prisma.testPlan.count({ where: { projectId } });

    // Terminal/ferramental
    const iaFrameworkExists = fs.existsSync(path.resolve(project.worktreeBase || '', 'ia-framework', 'STACK.md'));
    const gitignoreExists = worktreeExists ? fs.existsSync(path.join(project.worktreeBase, '.gitignore')) : false;

    return {
      project: {
        id: project.id,
        name: project.name,
        repoUrl: project.repoUrl,
        worktreeBase: project.worktreeBase,
        worktreeExists,
        iaFrameworkExists,
        gitignoreExists,
      },
      stacks: {
        active: activeStacks.map(s => s.stack),
        all: stacks,
      },
      sdd: {
        projectSddExists,
        specs: { total: specCount, open: openCount, blocked: blockedCount, ready: readyCount },
      },
      requirements: {
        requirementsExists,
        lastHealthCheck: lastHealthCheck ? {
          version: lastHealthCheck.version,
          score: lastHealthCheck.score,
          verdict: lastHealthCheck.verdict,
          checkedAt: lastHealthCheck.checkedAt,
        } : null,
      },
      screens: { count: screenCount },
      architecture: { files: archFiles },
      testing: { testPlanCount },
    };
  }

  /**
   * Escreve o STACK.md no worktree do projeto com as stacks ativas.
   */
  private async writeStackMd(project: any, stacks: { stack: string; isActive: boolean }[]) {
    const worktreePath = project.worktreeBase;
    if (!worktreePath || !fs.existsSync(worktreePath)) {
      this.logger.warn(`Worktree path not found: ${worktreePath}, skipping STACK.md write`);
      return;
    }

    const stackMdPath = path.join(worktreePath, 'ia-framework', 'STACK.md');
    const activeStacks = stacks.filter(s => s.isActive).map(s => s.stack);

    const lines: string[] = [
      '---',
      'purpose: Manifesto de stacks ativas neste monorepo. Lido pelos agentes/commands da ia-framework.',
      `updated: ${new Date().toISOString().split('T')[0]}`,
      '---',
      '',
      '# Manifesto de Stacks',
      '',
    ];

    if (activeStacks.includes('angular')) {
      lines.push('## Frontend', '', '- **angular** - Angular 22 (standalone, signals, zoneless)');
      lines.push('  - Raiz do codigo: `frontend/`');
      lines.push('  - Skill: `skills/stacks/angular/SKILL.md`', '');
    }
    lines.push('## Backend (escolha um ou mais)', '');
    if (activeStacks.includes('nodejs')) {
      lines.push('', '- **nodejs** - Node.js 22+ (ESM, Fastify/Express5/NestJS)');
      lines.push('  - Raiz do codigo: `backend/nodejs/`');
      lines.push('  - Skill: `skills/stacks/nodejs/SKILL.md`');
    }
    if (activeStacks.includes('spring')) {
      lines.push('', '- **spring** - Java 21+ / Spring Boot 3.5 (virtual threads, Jakarta, Spring Security 6)');
      lines.push('  - Raiz do codigo: `backend/spring/`');
      lines.push('  - Skill: `skills/stacks/spring/SKILL.md`');
    }
    if (activeStacks.includes('go')) {
      lines.push('', '- **go** - Go 1.23+ (modulos, context-first, interfaces no consumer-side)');
      lines.push('  - Raiz do codigo: `backend/go/`');
      lines.push('  - Skill: `skills/stacks/go/SKILL.md`');
    }
    lines.push('', '## Banco de Dados', '');
    if (activeStacks.includes('postgres')) {
      lines.push('', '- **postgres** - PostgreSQL 16+ (RLS, particionamento declarativo, JSONB+GIN, Flyway)');
      lines.push('  - Raiz do codigo: `BD/`');
      lines.push('  - Skill: `skills/stacks/postgres/SKILL.md`');
    }
    lines.push('', '## Convencoes', '',
      '- Stack ausente neste manifesto = agente recusa a tarefa e pede para o usuario escolher.',
      '- Mais de uma stack de backend ativa e valido - cada agente fica restrito a sua raiz.',
      '- Quando o chamador passa `--stack=<id>` num comando, esta lista e ignorada para aquela',
      '  invocacao (escolha explicita vence inferencia).', '');

    fs.mkdirSync(path.dirname(stackMdPath), { recursive: true });
    fs.writeFileSync(stackMdPath, lines.join('\n'), 'utf-8');
    this.logger.log(`STACK.md updated at ${stackMdPath} with stacks: ${activeStacks.join(', ')}`);
  }

  /**
   * Copia agents/commands/skills das stacks ativas para o worktree do projeto.
   */
  private async copyAgentsToWorktree(worktreePath: string, stacks: { stack: string; isActive: boolean }[]) {
    const iaFrameworkPath = path.resolve(worktreePath, 'ia-framework');
    if (!fs.existsSync(iaFrameworkPath)) {
      this.logger.warn(`ia-framework not found in worktree: ${iaFrameworkPath}`);
      return;
    }

    const activeStacks = stacks.filter(s => s.isActive).map(s => s.stack);

    // Copy agents for active stacks
    for (const stack of activeStacks) {
      if (!SUPPORTED_STACKS.includes(stack as StackId)) continue;
      const agents = STACK_AGENTS[stack as StackId];

      for (const agentName of agents) {
        const src = path.join(iaFrameworkPath, 'agents', `${agentName}.md`);
        const destDir = path.join(worktreePath, '.claude', 'agents');
        const dest = path.join(destDir, `${agentName}.md`);

        if (fs.existsSync(src)) {
          fs.mkdirSync(destDir, { recursive: true });
          fs.copyFileSync(src, dest);
          this.logger.log(`Copied agent: ${agentName}.md -> ${dest}`);
        }
      }

      // Copy stack-specific skills references
      const skillSrc = path.join(iaFrameworkPath, 'skills', 'stacks', stack);
      const skillDest = path.join(worktreePath, '.claude', 'skills', 'stacks', stack);
      if (fs.existsSync(skillSrc)) {
        this.copyDirRecursive(skillSrc, skillDest);
        this.logger.log(`Copied skill: stacks/${stack} -> ${skillDest}`);
      }
    }

    // Always copy cross-stack agents
    const crossStackAgents = [
      'context-curator', 'reviewer', 'memory-curator',
      'requirements-reader', 'requirements-doctor', 'sdd-planner',
      'architecture-writer', 'screens-reader', 'test-setup', 'test-author',
      'regression-author', 'contract-checker',
    ];
    for (const agentName of crossStackAgents) {
      const src = path.join(iaFrameworkPath, 'agents', `${agentName}.md`);
      const destDir = path.join(worktreePath, '.claude', 'agents');
      const dest = path.join(destDir, `${agentName}.md`);
      if (fs.existsSync(src)) {
        fs.mkdirSync(destDir, { recursive: true });
        fs.copyFileSync(src, dest);
      }
    }

    // Always copy shared skills
    const sharedSrc = path.join(iaFrameworkPath, 'skills', 'shared');
    const sharedDest = path.join(worktreePath, '.claude', 'skills', 'shared');
    if (fs.existsSync(sharedSrc)) {
      this.copyDirRecursive(sharedSrc, sharedDest);
    }

    // Always copy commands
    const commandsSrc = path.join(iaFrameworkPath, 'commands');
    const commandsDest = path.join(worktreePath, '.claude', 'commands');
    if (fs.existsSync(commandsSrc)) {
      this.copyDirRecursive(commandsSrc, commandsDest);
    }

    // Always copy requirements/architecture/testing/memory/protocol/screens skills
    for (const skill of ['requirements', 'architecture', 'testing', 'memory', 'protocol', 'screens']) {
      const s = path.join(iaFrameworkPath, 'skills', skill);
      const d = path.join(worktreePath, '.claude', 'skills', skill);
      if (fs.existsSync(s)) {
        this.copyDirRecursive(s, d);
      }
    }

    // Copy scaffold scripts
    for (const script of ['scaffold.ps1', 'scaffold.sh']) {
      const s = path.join(iaFrameworkPath, 'skills', script);
      if (fs.existsSync(s)) {
        fs.mkdirSync(path.join(worktreePath, '.claude', 'skills'), { recursive: true });
        fs.copyFileSync(s, path.join(worktreePath, '.claude', 'skills', script));
      }
    }

    this.logger.log(`Agent copy complete for stacks: ${activeStacks.join(', ')}`);
  }

  private copyDirRecursive(src: string, dest: string) {
    fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        this.copyDirRecursive(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }
}