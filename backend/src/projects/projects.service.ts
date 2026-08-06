import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  assertValidProjectDefaults,
  normalizeProjectDefaults,
  PROJECT_DEFAULTS_KEY,
  type ProjectDefaults,
} from '../config/project-defaults';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { CloneProjectDto } from './dto/clone-project.dto';

const ENV_FALLBACKS: Record<string, () => any> = {
  defaultCliProfile: () => process.env.MASTER_AGENT_PROFILE,
  masterAgentProfile: () => process.env.MASTER_AGENT_PROFILE,
  maxSessions: () => {
    const v = process.env.MAX_SESSIONS_GLOBAL;
    return v ? parseInt(v, 10) : undefined;
  },
  autoTriageEnabled: () => true,
  sweepIntervalMinutes: () => 10,
  stallTimeoutMinutes: () => {
    const v = process.env.STALL_TIMEOUT_MINUTES;
    return v ? parseInt(v, 10) : 10;
  },
};

@Injectable()
export class ProjectsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateProjectDto) {
    return this.prisma.project.create({
      data: dto,
    });
  }

  async findAll() {
    return this.prisma.project.findMany({
      include: {
        pipelines: true,
        macroTasks: true,
        agents: true,
      },
    });
  }

  async findOne(id: string) {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: {
        pipelines: true,
        macroTasks: {
          include: {
            sessions: true,
          },
        },
        agents: true,
      },
    });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  async update(id: string, dto: UpdateProjectDto) {
    await this.findOne(id);
    return this.prisma.project.update({
      where: { id },
      data: dto,
    });
  }

  /**
   * Apaga o projeto e a configuração que só existe por causa dele.
   *
   * `pipelines`, `agents` e `macro_tasks` apontam para `projects` com RESTRICT,
   * então o `project.delete` cru estourava violação de chave estrangeira e o
   * controller devolvia 500 genérico — sem dizer o que segurava. Qualquer
   * projeto com pipeline (ou seja: todo projeto clonado de um molde) era
   * indeletável pela UI.
   *
   * A divisão segue o critério que o delete de pipeline já usa: configuração do
   * projeto (pipelines, agentes) morre junto porque não significa nada sem ele;
   * macro task é TRABALHO e bloqueia com mensagem explícita, porque apagar em
   * cascata levaria junto sessões, logs e histórico que o usuário não pediu
   * para perder.
   */
  async remove(id: string) {
    await this.findOne(id);

    const macroTasks = await this.prisma.macroTask.count({ where: { projectId: id } });
    if (macroTasks > 0) {
      throw new BadRequestException(
        `This project has ${macroTasks} macro task(s) — delete them first. ` +
          `Deleting the project would take their sessions, logs and history with it.`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.pipeline.deleteMany({ where: { projectId: id } });
      await tx.agent.deleteMany({ where: { projectId: id } });
      return tx.project.delete({ where: { id } });
    });
  }

  /**
   * Cria um projeto novo a partir de um projeto marcado como template,
   * clonando **somente configuração**.
   *
   * Copiado:
   * - `settings` (Json) e `maxSessions` do template;
   * - `Pipeline`s (linhas novas com o `projectId` novo);
   * - `Agent`s (linhas novas, **preservando `cliProfileId`**);
   * - vínculos `ProjectMCP` (apontando para os mesmos `MCP` globais).
   *
   * NÃO copiado (por decisão fechada com o usuário): `Session`, `MacroTask`,
   * `SessionHistory`, `LogEntry`, `SDDArtifact`, `Question`, `ChatMessage`.
   *
   * Por que `CliProfile` e `MCP` não são duplicados: nenhuma das duas entidades tem
   * `projectId` — são **globais**. `CliProfile.name` é `@unique` (duplicar quebraria a
   * constraint) e `MCP` se liga a projeto pela tabela de junção `ProjectMCP`. Ou seja,
   * a configuração desses dois "vem junto" por referência: o `Agent` clonado aponta para
   * o mesmo `cliProfileId`, e o projeto novo ganha vínculos para os mesmos `mcpId`.
   *
   * Tudo-ou-nada via `$transaction`: um projeto meio-clonado é pior que nenhum.
   */
  async createFromTemplate(templateId: string, dto: CloneProjectDto) {
    const template = await this.prisma.project.findUnique({
      where: { id: templateId },
      include: {
        pipelines: true,
        agents: true,
        mcps: true,
      },
    });
    if (!template) throw new NotFoundException('Template project not found');
    if (!template.isTemplate) {
      throw new BadRequestException(
        `Project "${template.name}" is not marked as a template. ` +
          `Mark it first with PATCH /projects/${template.id} { "isTemplate": true }.`,
      );
    }

    // Um Agent do template pode referenciar um CliProfile que foi removido desde então.
    // Nesse caso o clone fica com cliProfileId = null em vez de estourar FK.
    const referencedProfileIds = [
      ...new Set(
        template.agents
          .map((a) => a.cliProfileId)
          .filter((id): id is string => typeof id === 'string' && id.length > 0),
      ),
    ];
    const existingProfiles = referencedProfileIds.length
      ? await this.prisma.cliProfile.findMany({
          where: { id: { in: referencedProfileIds } },
          select: { id: true },
        })
      : [];
    const validProfileIds = new Set(existingProfiles.map((p) => p.id));
    const droppedProfileIds = referencedProfileIds.filter((id) => !validProfileIds.has(id));

    return this.prisma.$transaction(async (tx) => {
      const projectData: Prisma.ProjectCreateInput = {
        name: dto.name,
        description: dto.description ?? template.description ?? null,
        // Caminhos NUNCA herdados do template — o projeto novo tem os seus.
        repoUrl: dto.repoUrl,
        mainPath: dto.mainPath,
        worktreeBase: dto.worktreeBase,
        maxSessions: template.maxSessions,
        isTemplate: false,
      };
      if (template.settings !== null && template.settings !== undefined) {
        projectData.settings = template.settings as Prisma.InputJsonValue;
      }

      const created = await tx.project.create({ data: projectData });

      let pipelines = 0;
      if (template.pipelines.length) {
        const result = await tx.pipeline.createMany({
          data: template.pipelines.map((p) => ({
            projectId: created.id,
            name: p.name,
            description: p.description,
            stages: p.stages as Prisma.InputJsonValue,
            isActive: p.isActive,
          })),
        });
        pipelines = result.count;
      }

      let agents = 0;
      if (template.agents.length) {
        const result = await tx.agent.createMany({
          data: template.agents.map((a) => ({
            projectId: created.id,
            name: a.name,
            type: a.type,
            model: a.model,
            // Agente clonado nasce parado; `status` do template é estado de runtime.
            status: 'idle',
            // `mcpEndpoint` NÃO é copiado: é endpoint da instância antiga.
            cliProfileId:
              a.cliProfileId && validProfileIds.has(a.cliProfileId) ? a.cliProfileId : null,
            ...(a.metadata !== null && a.metadata !== undefined
              ? { metadata: a.metadata as Prisma.InputJsonValue }
              : {}),
          })),
        });
        agents = result.count;
      }

      let mcpLinks = 0;
      if (template.mcps.length) {
        const result = await tx.projectMCP.createMany({
          data: template.mcps.map((link) => ({
            projectId: created.id,
            mcpId: link.mcpId,
          })),
        });
        mcpLinks = result.count;
      }

      const project = await tx.project.findUnique({
        where: { id: created.id },
        include: {
          pipelines: true,
          macroTasks: true,
          agents: true,
        },
      });

      return {
        project,
        templateId: template.id,
        templateName: template.name,
        cloned: { pipelines, agents, mcpLinks },
        ...(droppedProfileIds.length
          ? {
              warnings: [
                `${droppedProfileIds.length} agent(s) referenciavam CLI profile(s) inexistente(s); ` +
                  `cliProfileId ficou null nesses clones.`,
              ],
            }
          : {}),
      };
    });
  }

  async getSettings(projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { settings: true, maxSessions: true },
    });
    if (!project) throw new NotFoundException('Project not found');

    const dbSettings = (project.settings as Record<string, any>) ?? {};
    const merged: Record<string, any> = { ...dbSettings };

    for (const [key, fallbackFn] of Object.entries(ENV_FALLBACKS)) {
      if (merged[key] === undefined || merged[key] === null) {
        const envVal = fallbackFn();
        if (envVal !== undefined) {
          merged[key] = envVal;
        }
      }
    }

    if (merged.maxSessions === undefined || merged.maxSessions === null) {
      merged.maxSessions = project.maxSessions ?? undefined;
    }

    return merged;
  }

  async updateSettings(projectId: string, settings: Record<string, any>) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { settings: true },
    });
    if (!project) throw new NotFoundException('Project not found');

    const existing = (project.settings as Record<string, any>) ?? {};
    const merged = { ...existing, ...settings };

    return this.prisma.project.update({
      where: { id: projectId },
      data: { settings: merged },
      select: { settings: true },
    });
  }

  async getSetting(projectId: string, key: string, defaultValue?: any) {
    const settings = await this.getSettings(projectId);
    if (settings[key] !== undefined && settings[key] !== null) {
      return settings[key];
    }
    return defaultValue;
  }

  // ------------------------------------------------- settings.defaults (MT-0)
  // Bloco do contrato §4: leitura/escrita do objeto ANINHADO
  // `settings.defaults`, que `updateSettings` (merge raso) sobrescreveria
  // inteiro. A tipagem e a validação vivem em `../config/project-defaults`
  // (módulo puro) — aqui fica só o acesso ao banco. MT-1 constrói a UI.

  /** Defaults de runtime do projeto, já normalizados. `{}` quando não há nada gravado. */
  async getDefaults(projectId: string): Promise<ProjectDefaults> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { settings: true },
    });
    if (!project) throw new NotFoundException('Project not found');
    return normalizeProjectDefaults(project.settings);
  }

  /**
   * Merge RASO dentro de `settings.defaults`, preservando as outras chaves de
   * `settings`. Campo com valor `null` no patch é REMOVIDO — é como a UI apaga
   * um default sem ter que reenviar o objeto inteiro.
   */
  async setDefaults(projectId: string, patch: Record<string, any>): Promise<ProjectDefaults> {
    try {
      assertValidProjectDefaults(patch);
    } catch (error) {
      throw new BadRequestException(error.message);
    }

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { settings: true },
    });
    if (!project) throw new NotFoundException('Project not found');

    const settings = (project.settings as Record<string, any>) ?? {};
    // Parte do objeto CRU gravado, não do normalizado: normalizar aqui apagaria
    // silenciosamente qualquer campo que outra onda tenha adicionado a
    // `defaults` e que o normalizador desta versão ainda não conheça. A leitura
    // já filtra o que não é válido; a escrita só precisa não destruir dado.
    const stored = settings[PROJECT_DEFAULTS_KEY];
    const merged: Record<string, any> = {
      ...(stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {}),
      ...patch,
    };
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) delete merged[key];
    }

    const updated = await this.prisma.project.update({
      where: { id: projectId },
      data: { settings: { ...settings, [PROJECT_DEFAULTS_KEY]: merged } },
      select: { settings: true },
    });
    return normalizeProjectDefaults(updated.settings);
  }
}
