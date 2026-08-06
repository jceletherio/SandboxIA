import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePipelineDto } from './dto/create-pipeline.dto';
import { UpdatePipelineDto } from './dto/update-pipeline.dto';
import { ListPipelinesQueryDto } from './dto/list-pipelines.dto';
import { PipelineDefinition, normalizePipelineDefinition } from './pipeline-definition';
import { parseLegacyFixedMetadata } from './legacy-fixed-metadata';
import { detectPromptDrift } from './prompt-drift';
import { applyFixedStageRuntime } from './fixed-stage-runtime';

@Injectable()
export class PipelinesService implements OnModuleInit {
  private readonly logger = new Logger(PipelinesService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Roda uma vez a cada boot do backend. Idempotente: depois da primeira
   * passada a description já não tem mais o prefixo `[fixed · ...]`, então o
   * regex simplesmente não casa mais e a query devolve 0 linhas. Não lança —
   * um erro aqui não pode derrubar o start do Nest, só fica sem migrar.
   */
  async onModuleInit() {
    try {
      await this.migrateLegacyFixedMetadata();
    } catch (error) {
      this.logger.warn(`Falha ao migrar metadados legados de pipelines fixas: ${error.message}`);
    }
    try {
      await this.migrateStageRuntimeAndKind();
    } catch (error) {
      this.logger.warn(`Falha ao semear runtime/kind das pipelines: ${error.message}`);
    }
  }

  /** Aceita `{ stages: [...], ... }` ou o formato legado `[...]` puro. */
  private asPipelineObject(stages: unknown): Record<string, unknown> {
    if (Array.isArray(stages)) return { stages };
    return (stages as Record<string, unknown>) ?? {};
  }

  /**
   * MT-3: migra os 4 pipelines fixos desta iniciativa do prefixo
   * `[fixed · <category>]` na description para os campos reais `kind`/
   * `category` do contrato MT-0 (01-CONTRATOS.md §2). Roda em TODOS os
   * projetos — a convenção é global, não só do projeto onde foram criados.
   */
  private async migrateLegacyFixedMetadata() {
    const candidates = await this.prisma.pipeline.findMany({
      where: { description: { contains: '[fixed', mode: 'insensitive' } },
    });
    for (const row of candidates) {
      const parsed = parseLegacyFixedMetadata(row.description);
      if (!parsed) continue;
      const stages = this.asPipelineObject(row.stages);
      if (stages.kind) continue; // já migrada — não sobrescreve category manual
      await this.prisma.pipeline.update({
        where: { id: row.id },
        data: {
          description: parsed.description,
          stages: { ...stages, kind: 'fixed', category: parsed.category },
        },
      });
      this.logger.log(`Migrado pipeline "${row.name}" para kind=fixed, category=${parsed.category}`);
    }
  }

  /**
   * MT-18: duas correções de DADO que fechavam o gap do contrato da MT-0, em
   * uma passada por pipeline.
   *
   * 1. `subagents`/`skills` por estágio nas pipelines **fixas** — o binding da
   *    MT-4 existia mas não tinha nada para injetar (ver `fixed-stage-runtime.ts`).
   * 2. `kind` explícito em quem não tem — pipeline sem `kind` já era lida como
   *    `custom` pela /pipelines e pela `list_pipelines`, mas só implicitamente;
   *    gravar o valor deixa o filtro do catálogo honesto e é o que a decisão do
   *    item 7 pediu para a "E2E Mini".
   *
   * Idempotente: depois da primeira passada `applyFixedStageRuntime` vê os
   * campos preenchidos e `kind` existe, então nenhum pipeline entra no UPDATE.
   * Escreve pelo mesmo caminho de validação do CRUD (`validateStages`) — nunca
   * um UPDATE cru que pularia o contrato.
   */
  private async migrateStageRuntimeAndKind() {
    const pipelines = await this.prisma.pipeline.findMany();
    for (const row of pipelines) {
      const current = this.asPipelineObject(row.stages) as unknown as PipelineDefinition;
      const isFixed = current.kind === 'fixed';
      const { definition, changed } = isFixed
        ? applyFixedStageRuntime(current)
        : { definition: current, changed: false };
      const needsKind = current.kind === undefined;
      if (!changed && !needsKind) continue;

      const next: PipelineDefinition = {
        ...definition,
        ...(needsKind ? { kind: 'custom' as const } : {}),
      };
      try {
        this.validateStages(next);
      } catch (error) {
        // Pipeline que já não valida não é problema desta migração — o engine
        // loga e cai no fallback. Semear em cima só trocaria a causa do erro.
        this.logger.warn(`Pipeline "${row.name}" não valida, seed ignorado: ${error.message}`);
        continue;
      }
      await this.prisma.pipeline.update({ where: { id: row.id }, data: { stages: next as any } });
      this.logger.log(
        `Pipeline "${row.name}" semeada: ${changed ? 'subagents/skills por estágio' : ''}${
          changed && needsKind ? ' + ' : ''
        }${needsKind ? 'kind=custom' : ''}`,
      );
    }
  }

  private validateStages(stages: unknown) {
    try {
      const normalized = normalizePipelineDefinition(stages);
      this.warnPromptDrift(normalized);
    } catch (error) {
      throw new BadRequestException(`Invalid pipeline stages: ${error.message}`);
    }
  }

  /**
   * Lint de write-time (MT-26): `promptTemplate` que cita caminho aposentado
   * não bloqueia o save — não é validação de contrato, é aviso — mas fica no
   * log em vez de só ser descoberto meses depois por quem executar o stage.
   * É a detecção que faltava: prompt gravado em `Json` de coluna não passa
   * por `grep` no repo.
   */
  private warnPromptDrift(pipeline: Parameters<typeof detectPromptDrift>[0]) {
    const matches = detectPromptDrift(pipeline);
    for (const m of matches) {
      this.logger.warn(
        `Pipeline stage "${m.stage}": promptTemplate cita "${m.needle}" (${m.reason})`,
      );
    }
  }

  async create(projectId: string, dto: CreatePipelineDto) {
    this.validateStages(dto.stages);
    return this.prisma.pipeline.create({
      data: {
        ...dto,
        projectId,
      },
    });
  }

  /**
   * `kind`/`category`/`tags` (MT-0) moram DENTRO do Json `stages`, não em
   * colunas próprias — daí o SQL cru em vez dos filtros de Json do Prisma.
   * Dois motivos concretos:
   *
   * 1. `kind` ausente conta como `custom` (toda pipeline criada antes da MT-3).
   *    Em SQL isso é `coalesce(stages->>'kind','custom')`, uma expressão só e
   *    com a MESMA regra do `pipelineMeta` da UI. Escrito como filtro do Prisma
   *    viraria `NOT { path:['kind'], equals:'fixed' }`, e `NOT (NULL='fixed')`
   *    é NULL em SQL — o row sem `kind` seria excluído de `kind=custom`, ou
   *    seja, o filtro perderia justamente as 11 pipelines antigas.
   * 2. `orderBy` em path de Json o Prisma não faz.
   *
   * `->>` em `stages` no formato legado (array puro, sem objeto em volta)
   * devolve NULL em vez de estourar — verificado no banco, junto com o
   * `@>` do filtro de tag.
   */
  private pipelineFilters(projectId: string, query: ListPipelinesQueryDto): Prisma.Sql {
    const conditions: Prisma.Sql[] = [Prisma.sql`project_id = ${projectId}`];

    const search = query.search?.trim();
    if (search) {
      // `%` e `_` do usuário são literais, não curinga: o filtro antigo era um
      // `includes()` no browser, e sem escapar uma busca por "%" passaria a
      // casar com TODAS as pipelines. `\` é o escape default do LIKE no
      // Postgres, então não precisa de cláusula `ESCAPE`.
      const escaped = search.replace(/[\\%_]/g, (char) => `\\${char}`);
      conditions.push(Prisma.sql`name ILIKE ${`%${escaped}%`}`);
    }
    if (query.kind) {
      conditions.push(Prisma.sql`coalesce(stages->>'kind', 'custom') = ${query.kind}`);
    }
    if (query.category) {
      conditions.push(Prisma.sql`stages->>'category' = ${query.category}`);
    }
    if (query.tag) {
      // `@>` com NULL à esquerda dá NULL, então pipeline sem `tags` já não casa
      // — o `jsonb_typeof` é para `tags` gravado com tipo errado não estourar.
      conditions.push(
        Prisma.sql`jsonb_typeof(stages->'tags') = 'array' AND stages->'tags' @> to_jsonb(${query.tag}::text)`,
      );
    }

    return Prisma.join(conditions, ' AND ');
  }

  /**
   * Filtro, ordenação e paginação no banco (MT-17). Sem nenhum filtro o
   * comportamento é o de antes — projeto inteiro, com `macroTasks` incluído.
   *
   * Duas etapas de propósito: o SQL resolve QUAIS pipelines entram (é onde a
   * regra do `coalesce` e o `LIMIT` vivem) e o Prisma hidrata as linhas, para
   * a resposta continuar sendo o mesmo objeto de sempre, `macroTasks` incluído.
   * Montar o include à mão no SQL duplicaria o mapeamento do Prisma.
   */
  async findAll(projectId: string, query: ListPipelinesQueryDto = {}) {
    const where = this.pipelineFilters(projectId, query);
    const limit = query.take ? Prisma.sql`LIMIT ${query.take}` : Prisma.empty;
    const offset = query.skip ? Prisma.sql`OFFSET ${query.skip}` : Prisma.empty;

    const ordered = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM pipelines
      WHERE ${where}
      ORDER BY name ASC, id ASC
      ${limit} ${offset}
    `);
    if (ordered.length === 0) return [];

    const ids = ordered.map((row) => row.id);
    const rows = await this.prisma.pipeline.findMany({
      where: { id: { in: ids } },
      include: { macroTasks: true },
    });

    // `where id in (...)` não preserva a ordem do array — reindexa pela ordem
    // que o SQL definiu, senão a paginação devolveria páginas embaralhadas.
    const byId = new Map(rows.map((row) => [row.id, row]));
    return ids.map((id) => byId.get(id)).filter((row): row is (typeof rows)[number] => !!row);
  }

  /**
   * Opções dos selects de filtro + contadores, que a UI derivava da lista
   * inteira. Com a lista paginada isso deixou de ser possível: filtrar por uma
   * categoria que só aparece na página 3 é exatamente o caso que a paginação
   * quebraria.
   *
   * `categories`/`tags` saem do projeto TODO (ignoram os filtros) — opção que
   * desaparece do select conforme você filtra deixa o filtro sem volta.
   * `matching` respeita os filtros, `total`/`active` não: são o "X de Y · N
   * active" do cabeçalho, que a UI contava sobre a lista inteira e passaria a
   * contar só a página se saísse daqui.
   */
  async facets(
    projectId: string,
    query: ListPipelinesQueryDto = {},
  ): Promise<{
    total: number;
    active: number;
    matching: number;
    categories: string[];
    tags: string[];
  }> {
    const where = this.pipelineFilters(projectId, query);

    const [[{ total, active }], [{ matching }], categories, tags] = await Promise.all([
      this.prisma.$queryRaw<Array<{ total: number; active: number }>>(Prisma.sql`
        SELECT count(*)::int AS total, count(*) FILTER (WHERE is_active)::int AS active
        FROM pipelines WHERE project_id = ${projectId}
      `),
      this.prisma.$queryRaw<Array<{ matching: number }>>(
        Prisma.sql`SELECT count(*)::int AS matching FROM pipelines WHERE ${where}`,
      ),
      this.prisma.$queryRaw<Array<{ category: string }>>(Prisma.sql`
        SELECT DISTINCT stages->>'category' AS category FROM pipelines
        WHERE project_id = ${projectId} AND nullif(trim(coalesce(stages->>'category', '')), '') IS NOT NULL
        ORDER BY category ASC
      `),
      this.prisma.$queryRaw<Array<{ tag: string }>>(Prisma.sql`
        SELECT DISTINCT tag FROM pipelines
        CROSS JOIN LATERAL jsonb_array_elements_text(
          CASE WHEN jsonb_typeof(stages->'tags') = 'array' THEN stages->'tags' ELSE '[]'::jsonb END
        ) AS tag
        WHERE project_id = ${projectId} AND nullif(trim(tag), '') IS NOT NULL
        ORDER BY tag ASC
      `),
    ]);

    return {
      total,
      active,
      matching,
      categories: categories.map((row) => row.category),
      tags: tags.map((row) => row.tag),
    };
  }

  async findOne(projectId: string, id: string) {
    const pipeline = await this.prisma.pipeline.findFirst({
      where: { id, projectId },
      include: { macroTasks: true },
    });
    if (!pipeline) throw new NotFoundException('Pipeline not found');
    return pipeline;
  }

  async update(projectId: string, id: string, dto: UpdatePipelineDto) {
    // `kind: 'fixed'` é metadado de catálogo, não permissão — o Master edita
    // as 4 pipelines fixas via MCP tool (`update_pipeline`) por necessidade
    // operacional (ex.: corrigir `permissionMode`/allowlist nas 4 de uma vez).
    // Bloquear aqui quebraria esse caminho. A guarda fica só na UI: banner
    // quantificado (quantas macro tasks usam) antes de salvar, ver
    // `pipeline-editor.tsx`.
    await this.findOne(projectId, id);
    if (dto.stages !== undefined) {
      this.validateStages(dto.stages);
    }
    return this.prisma.pipeline.update({
      where: { id },
      data: dto,
    });
  }

  async remove(projectId: string, id: string) {
    const pipeline = await this.findOne(projectId, id);
    // MT-18: `MacroTask.pipeline` não declara `onDelete`, então o default do
    // Prisma é RESTRICT: o Postgres recusa o delete e sobe P2003, que sem
    // tratamento vira um 500 "Internal server error" — na tela o usuário só via
    // o modal fechar sem nada acontecer.
    //
    // A mensagem NÃO oferece "delete a macro task" como saída (a
    // `masterDeletePipeline` da MCP oferece, e está desatualizada): desde o
    // soft-delete de macro task (`status: 'cancelled'`, a linha continua no
    // Postgres), cancelar não solta a FK — só reatribuir `pipelineId` solta.
    const taskCount = pipeline.macroTasks?.length ?? 0;
    if (taskCount > 0) {
      throw new BadRequestException(
        `This pipeline is used by ${taskCount} macro task(s) — reassign them to another pipeline before deleting it (cancelling a macro task keeps it referencing this pipeline)`,
      );
    }
    return this.prisma.pipeline.delete({ where: { id } });
  }

  /**
   * "Duplicar como customizada" (entrega #2): cria uma cópia editável a
   * partir de uma pipeline fixa, com `kind: 'custom'` e inativa por padrão —
   * o usuário revisa antes de ativar, em vez de duas pipelines ativas
   * fazendo a mesma coisa silenciosamente.
   */
  async duplicateAsCustom(projectId: string, id: string) {
    const original = await this.findOne(projectId, id);
    const stages = this.asPipelineObject(original.stages);
    const { kind: _kind, ...rest } = stages;
    return this.prisma.pipeline.create({
      data: {
        projectId,
        name: `${original.name} (cópia)`,
        description: original.description ?? undefined,
        stages: { ...rest, kind: 'custom' },
        isActive: false,
      },
    });
  }
}
