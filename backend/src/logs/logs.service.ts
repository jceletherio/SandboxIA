import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { buildSessionReport, SessionReport } from './session-report';
import { buildWaveReport, WaveReport } from './wave-report';
import { normalizePipelineDefinition } from '../pipelines/pipeline-definition';

/** Janela default do report de onda: cobre uma onda recém-rodada. */
const DEFAULT_WAVE_WINDOW_DAYS = 7;

@Injectable()
export class LogsService {
  constructor(private prisma: PrismaService) {}

  async findAll(sessionId?: string, projectId?: string, cursor?: string, limit: number = 50) {
    const where: any = {};
    if (sessionId) where.sessionId = sessionId;
    if (projectId) where.projectId = projectId;

    const effectiveLimit = Math.min(Math.max(limit, 1), 200);
    const items = await this.prisma.logEntry.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      cursor: cursor ? { id: cursor } : undefined,
      take: effectiveLimit + 1,
      skip: cursor ? 1 : 0,
    });
    const nextCursor = items.length > effectiveLimit ? items[effectiveLimit - 1].id : null;
    return { data: items.slice(0, effectiveLimit), nextCursor };
  }

  async findOne(id: string) {
    return this.prisma.logEntry.findUnique({
      where: { id },
    });
  }

  async create(data: { sessionId?: string; projectId?: string; level: string; message: string; metadata?: any }) {
    return this.prisma.logEntry.create({
      data,
    });
  }

  /**
   * Report de uma sessão, derivado do que o orquestrador já registrou de fora.
   * Zero instrumentação dentro da sessão — ver o cabeçalho de `session-report.ts`.
   */
  async getSessionReport(sessionId: string): Promise<SessionReport> {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: { macroTask: { include: { pipeline: true } } },
    });
    if (!session) throw new NotFoundException('Session not found');

    // Sem `take`: o report precisa do PRIMEIRO "Starting stage" de cada stage
    // para cronometrá-lo, e um limite cortaria justamente o começo da sessão.
    // O índice `[sessionId, createdAt]` de `log_entries` cobre esta query.
    const [logs, questions, artifacts] = await Promise.all([
      this.prisma.logEntry.findMany({
        where: { sessionId },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.question.findMany({ where: { sessionId } }),
      this.prisma.sDDArtifact.findMany({ where: { sessionId } }),
    ]);

    return buildSessionReport({
      session,
      logs,
      questions,
      artifacts,
      stageNames: this.stageNamesOf(session),
    });
  }

  /**
   * Report de onda: as sessões de um projeto numa janela, agregadas por
   * pipeline. `from`/`to` são ISO; sem eles, a janela default.
   */
  async getWaveReport(projectId: string, from?: string, to?: string): Promise<WaveReport> {
    const toDate = this.parseDate(to) ?? new Date();
    const fromDate =
      this.parseDate(from) ??
      new Date(toDate.getTime() - DEFAULT_WAVE_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const sessions = await this.prisma.session.findMany({
      where: {
        startedAt: { gte: fromDate, lte: toDate },
        macroTask: { projectId },
      },
      include: {
        macroTask: { include: { pipeline: true } },
        questions: true,
        artifacts: true,
        logs: { orderBy: { createdAt: 'asc' } },
      },
      orderBy: { startedAt: 'asc' },
    });

    const reports = sessions.map((session) =>
      buildSessionReport({
        session,
        logs: session.logs,
        questions: session.questions,
        artifacts: session.artifacts,
        stageNames: this.stageNamesOf(session),
      }),
    );

    return buildWaveReport(reports, {
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
    });
  }

  /**
   * Ordem dos stages a partir do snapshot gravado na sessão (§5 dos contratos),
   * caindo para o pipeline vivo. Snapshot primeiro de propósito: é o que a
   * sessão de fato executou, e um pipeline editado depois não deve reescrever o
   * passado do report.
   */
  private stageNamesOf(session: {
    context?: unknown;
    macroTask?: { pipeline?: { stages?: unknown } | null } | null;
  }): string[] | undefined {
    const context = session.context as Record<string, unknown> | null;
    const candidates = [context?.pipelineSnapshot, session.macroTask?.pipeline?.stages];
    for (const candidate of candidates) {
      if (!candidate) continue;
      try {
        // `normalizePipelineDefinition` já aceita tanto a definição inteira
        // (snapshot) quanto o array de stages cru (pipeline vivo).
        const names = normalizePipelineDefinition(candidate).stages.map((s) => s.name);
        if (names.length > 0) return names;
      } catch {
        // Snapshot inválido não pode derrubar o report: sem a ordem do pipeline,
        // `buildSessionReport` usa a ordem observada no stageData.
      }
    }
    return undefined;
  }

  /** Data ISO da query string, ou `undefined` se ausente/inválida. */
  private parseDate(value?: string): Date | undefined {
    if (!value) return undefined;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
}
