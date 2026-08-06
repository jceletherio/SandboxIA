import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMacroTaskDto } from './dto/create-macro-task.dto';
import { UpdateMacroTaskDto } from './dto/update-macro-task.dto';
import {
  BatchCreateMacroTaskDto,
  BatchCreateFailure,
  BatchCreateResult,
} from './dto/batch-create-macro-task.dto';
import {
  BACKLOG_STATUS,
  readBacklogMetadata,
  readMacroTaskMetadata,
} from './backlog-ingest.service';

@Injectable()
export class MacroTasksService {
  constructor(private prisma: PrismaService) {}

  async create(projectId: string, dto: CreateMacroTaskDto) {
    return this.prisma.macroTask.create({
      data: {
        ...dto,
        projectId,
      },
    });
  }

  /**
   * Best-effort batch creation. Every item is validated and created on its own — an invalid
   * item never aborts the rest of the batch (no `$transaction` here, on purpose). The caller
   * gets a per-item report of what failed and why.
   */
  async createBatch(
    projectId: string,
    dto: BatchCreateMacroTaskDto,
  ): Promise<BatchCreateResult> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    });
    if (!project) throw new NotFoundException('Project not found');

    // One query for the whole batch instead of N lookups inside the loop.
    const pipelines = await this.prisma.pipeline.findMany({
      where: { projectId },
      select: { id: true },
    });
    const pipelineIds = new Set(pipelines.map((p) => p.id));

    const items = dto.items ?? [];
    const created: any[] = [];
    const failed: BatchCreateFailure[] = [];

    for (let index = 0; index < items.length; index++) {
      const raw = items[index];
      const rawTitle =
        raw && typeof raw === 'object' && typeof (raw as any).title === 'string'
          ? ((raw as any).title as string).trim()
          : '';

      try {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
          failed.push({ index, title: rawTitle, reason: 'Item is not an object.' });
          continue;
        }

        const candidate: Record<string, any> = { ...raw };
        // Pasted JSON often carries priority as a string ("1"); accept it.
        if (typeof candidate.priority === 'string' && candidate.priority.trim() !== '') {
          const parsed = Number(candidate.priority);
          if (Number.isInteger(parsed)) candidate.priority = parsed;
        }
        if (candidate.description === null) delete candidate.description;
        if (candidate.metadata === null) delete candidate.metadata;

        const instance = plainToInstance(CreateMacroTaskDto, candidate);
        // `whitelist: true` (without `forbidNonWhitelisted`) drops unknown keys instead of
        // rejecting the item — imports frequently carry extra fields we simply ignore.
        const errors = await validate(instance, { whitelist: true });
        if (errors.length > 0) {
          failed.push({
            index,
            title: rawTitle,
            reason: errors
              .map((e) => Object.values(e.constraints ?? {}).join('; '))
              .filter(Boolean)
              .join('; ') || 'Invalid macro task payload.',
          });
          continue;
        }

        const title = (instance.title ?? '').trim();
        if (!title) {
          failed.push({ index, title: rawTitle, reason: 'title must not be empty.' });
          continue;
        }

        if (!pipelineIds.has(instance.pipelineId)) {
          failed.push({
            index,
            title: rawTitle || title,
            reason: `pipelineId "${instance.pipelineId}" does not belong to this project.`,
          });
          continue;
        }

        const task = await this.prisma.macroTask.create({
          data: {
            projectId,
            pipelineId: instance.pipelineId,
            title,
            description: instance.description,
            priority: instance.priority,
            metadata: instance.metadata,
          },
        });
        created.push(task);
      } catch (error) {
        failed.push({
          index,
          title: rawTitle,
          reason: error instanceof Error ? error.message : 'Unknown error.',
        });
      }
    }

    return {
      summary: { total: items.length, succeeded: created.length, failed: failed.length },
      created,
      failed,
    };
  }

  async findAll(projectId: string, cursor?: string, limit: number = 50) {
    const effectiveLimit = Math.min(Math.max(limit, 1), 200);
    const items = await this.prisma.macroTask.findMany({
      // `cancelled` é o soft-delete (ver `remove`) — some da listagem padrão,
      // mas continua no banco, recuperável por filtro direto de status.
      where: { projectId, status: { not: 'cancelled' } },
      include: { sessions: true },
      // Cursor SEM `orderBy` é paginação quebrada: o Postgres não promete ordem
      // estável entre duas queries, então a página 2 podia repetir ou perder
      // item. O `id` como desempate não é enfeite — `createdAt` não é único e
      // duas tasks criadas no mesmo milissegundo (ingestão de backlog cria em
      // lote) empatariam sem ele.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      cursor: cursor ? { id: cursor } : undefined,
      take: effectiveLimit + 1,
      skip: cursor ? 1 : 0,
    });
    const nextCursor = items.length > effectiveLimit ? items[effectiveLimit - 1].id : null;
    return { data: items.slice(0, effectiveLimit), nextCursor };
  }

  async findOne(id: string) {
    const task = await this.prisma.macroTask.findUnique({
      where: { id },
      include: { sessions: true },
    });
    if (!task) throw new NotFoundException('MacroTask not found');
    return task;
  }

  async update(id: string, dto: UpdateMacroTaskDto) {
    await this.findOne(id);
    return this.prisma.macroTask.update({
      where: { id },
      data: dto,
    });
  }

  // ------------------------------------------------------------------ backlog

  /**
   * Itens de backlog do projeto, já ordenados pelo score fino de
   * `metadata.backlog.score` (desc). A ordenação é feita em memória porque o
   * score vive dentro do Json — e o volume é o do backlog de um projeto, não da
   * tabela inteira.
   */
  async listBacklog(projectId: string) {
    const items = await this.prisma.macroTask.findMany({
      where: { projectId, status: BACKLOG_STATUS },
      include: { pipeline: { select: { id: true, name: true } } },
    });

    // Um único lookup dos títulos de origem: sem isso a tabela mostraria uuid.
    const originIds = [
      ...new Set(
        items
          .map((item) => readMacroTaskMetadata(item.metadata).origin?.macroTaskId)
          .filter((id): id is string => typeof id === 'string'),
      ),
    ];
    const origins = originIds.length
      ? await this.prisma.macroTask.findMany({
          where: { id: { in: originIds } },
          select: { id: true, title: true },
        })
      : [];
    const originTitles = new Map(origins.map((origin) => [origin.id, origin.title]));

    const decorated = items.map((item) => {
      const metadata = readMacroTaskMetadata(item.metadata);
      const backlog = readBacklogMetadata(item.metadata);
      const originId = metadata.origin?.macroTaskId as string | undefined;
      return {
        ...item,
        backlog: {
          kind: backlog.kind ?? 'improvement',
          effort: backlog.effort ?? 'm',
          score: typeof backlog.score === 'number' ? backlog.score : 0,
          files: Array.isArray(backlog.files) ? backlog.files : [],
          detail: backlog.detail,
          seenCount: Array.isArray(backlog.seenIn) ? backlog.seenIn.length : 1,
          parseErrors: backlog.parseErrors,
        },
        origin: originId
          ? { macroTaskId: originId, title: originTitles.get(originId) ?? '(task removida)' }
          : null,
        suggestedPipeline: metadata.suggestedPipeline ?? null,
      };
    });

    decorated.sort((a, b) => b.backlog.score - a.backlog.score || a.title.localeCompare(b.title));
    return decorated;
  }

  /**
   * Onde a dívida se concentra (melhorias.md #5, entrega 5). Agrupa por `kind` e
   * por arquivo citado — é o agregado que revela padrão quando várias sessões
   * rodam em paralelo, coisa que o item isolado não mostra.
   */
  async backlogSummary(projectId: string) {
    const items = await this.listBacklog(projectId);

    const byKind = new Map<string, { kind: string; count: number; score: number }>();
    const byFile = new Map<string, { file: string; count: number; kinds: string[] }>();
    const byOrigin = new Map<string, { macroTaskId: string; title: string; count: number }>();

    for (const item of items) {
      const kind = byKind.get(item.backlog.kind) ?? { kind: item.backlog.kind, count: 0, score: 0 };
      kind.count += 1;
      kind.score += item.backlog.score;
      byKind.set(kind.kind, kind);

      for (const file of item.backlog.files) {
        const entry = byFile.get(file) ?? { file, count: 0, kinds: [] };
        entry.count += 1;
        if (!entry.kinds.includes(item.backlog.kind)) entry.kinds.push(item.backlog.kind);
        byFile.set(file, entry);
      }

      if (item.origin) {
        const entry =
          byOrigin.get(item.origin.macroTaskId) ??
          { macroTaskId: item.origin.macroTaskId, title: item.origin.title, count: 0 };
        entry.count += 1;
        byOrigin.set(entry.macroTaskId, entry);
      }
    }

    return {
      total: items.length,
      byKind: [...byKind.values()].sort((a, b) => b.count - a.count),
      byFile: [...byFile.values()].sort((a, b) => b.count - a.count),
      byOrigin: [...byOrigin.values()].sort((a, b) => b.count - a.count),
    };
  }

  /**
   * Promove um item de backlog para task executável. Endpoint próprio em vez de
   * abrir `status` no `UpdateMacroTaskDto`: assim ninguém escreve status
   * arbitrário por PATCH, e o `metadata.origin` é preservado — é a rastreabilidade
   * de onde a task veio.
   */
  async promote(id: string, pipelineId?: string) {
    const task = await this.findOne(id);
    if (task.status !== BACKLOG_STATUS) {
      throw new ConflictException('Only backlog items can be promoted');
    }

    if (pipelineId && pipelineId !== task.pipelineId) {
      const pipeline = await this.prisma.pipeline.findFirst({
        where: { id: pipelineId, projectId: task.projectId },
        select: { id: true },
      });
      if (!pipeline) {
        throw new NotFoundException('Pipeline not found in this project');
      }
    }

    const metadata = readMacroTaskMetadata(task.metadata);
    return this.prisma.macroTask.update({
      where: { id },
      data: {
        status: 'pending',
        pipelineId: pipelineId ?? task.pipelineId,
        metadata: { ...metadata, promotedAt: new Date().toISOString() },
      },
    });
  }

  /**
   * Soft-delete: "deletar" nunca remove a linha. Um DELETE físico aqui já
   * causou perda de item de backlog numa limpeza manual — só foi recuperado
   * porque o conteúdo ainda estava no chat. Agora é só arquivar (status
   * `cancelled`, já aceito por `update`): some da listagem padrão (`findAll`
   * filtra `cancelled`), mas segue no Postgres, recuperável por status.
   */
  async remove(id: string) {
    await this.findOne(id);
    const activeSession = await this.prisma.session.findFirst({
      where: {
        macroTaskId: id,
        status: { in: ['running', 'waiting'] },
      },
    });
    if (activeSession) {
      throw new ConflictException('Cannot delete macro task with active sessions');
    }
    return this.prisma.macroTask.update({
      where: { id },
      data: { status: 'cancelled' },
    });
  }
}
