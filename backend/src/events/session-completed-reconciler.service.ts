import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { CHANNELS } from '../redis/channels';
import { SESSION_COMPLETED_WATERMARK_KEY } from '../redis/keys';
import { BacklogIngestService } from '../macro-tasks/backlog-ingest.service';
import { advanceWatermark, sessionsSinceWatermark } from './session-completed-reconciler';

/**
 * Reconciliação de `session:completed` na subida (MT-20, item 6) — ver o
 * cabeçalho de `session-completed-reconciler.ts` para o porquê.
 */
@Injectable()
export class SessionCompletedReconcilerService implements OnModuleInit {
  private readonly logger = new Logger(SessionCompletedReconcilerService.name);

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private backlogIngest: BacklogIngestService,
  ) {}

  async onModuleInit() {
    await this.reconcile().catch((error) =>
      this.logger.error(`Reconciliação de session:completed falhou na subida: ${error.message}`),
    );
    // Mantém a marca andando durante a operação normal — sem isso, o sweep do
    // PRÓXIMO boot reprocessaria tudo desde ESTE boot, e não só o gap real. O
    // `ingestSession` é idempotente, mas reprocessar semanas de sessões a cada
    // restart é trabalho jogado fora.
    await this.redis.subscribe(CHANNELS.SESSION_COMPLETED, (event: { sessionId?: string }) => {
      if (typeof event?.sessionId !== 'string' || !event.sessionId) return;
      void this.markSeen(event.sessionId).catch((error) =>
        this.logger.warn(`Falha ao avançar a marca d'água em ${event.sessionId}: ${error.message}`),
      );
    });
  }

  private async markSeen(sessionId: string): Promise<void> {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: { completedAt: true },
    });
    if (!session?.completedAt) return;
    const current = await this.redis.getClient().get(SESSION_COMPLETED_WATERMARK_KEY);
    const next = advanceWatermark(current, [{ id: sessionId, completedAt: session.completedAt }]);
    if (next && next !== current) {
      await this.redis.getClient().set(SESSION_COMPLETED_WATERMARK_KEY, next);
    }
  }

  /**
   * Varre as sessões concluídas desde a marca d'água e reingere o backlog de
   * cada uma — o "evento se perdeu com o backend fora do ar" virando
   * "reprocessado quando ele volta".
   */
  async reconcile(): Promise<{ processed: number }> {
    const client = this.redis.getClient();
    const watermark = await client.get(SESSION_COMPLETED_WATERMARK_KEY);

    if (!watermark) {
      // Primeiro boot com este mecanismo: não há gap conhecido para varrer.
      // Reprocessar TODO o histórico já concluído é assunto do backfill manual
      // (`BacklogIngestService.ingestProject`), não deste sweep automático.
      const latest = await this.prisma.session.findFirst({
        where: { status: 'completed', completedAt: { not: null } },
        orderBy: { completedAt: 'desc' },
        select: { completedAt: true },
      });
      await client.set(
        SESSION_COMPLETED_WATERMARK_KEY,
        (latest?.completedAt ?? new Date()).toISOString(),
      );
      return { processed: 0 };
    }

    const candidates = await this.prisma.session.findMany({
      where: { status: 'completed', completedAt: { gt: new Date(watermark) } },
      select: { id: true, completedAt: true },
    });
    const pending = sessionsSinceWatermark(
      candidates.map((session) => ({ id: session.id, completedAt: session.completedAt! })),
      watermark,
    );
    if (pending.length === 0) return { processed: 0 };

    this.logger.warn(
      `Reconciliação de session:completed: ${pending.length} sessão(ões) concluída(s) sem confirmação de processamento — reingerindo o backlog delas`,
    );
    for (const session of pending) {
      await this.backlogIngest
        .ingestSession(session.id)
        .catch((error) =>
          this.logger.error(`Reconciliação falhou para a sessão ${session.id}: ${error.message}`),
        );
    }

    const next = advanceWatermark(watermark, pending);
    if (next) await client.set(SESSION_COMPLETED_WATERMARK_KEY, next);
    return { processed: pending.length };
  }
}
