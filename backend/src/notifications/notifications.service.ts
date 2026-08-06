import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { NOTIFIABLE_CHANNELS, buildNotification } from './notification-rules';
import { NtfySink } from './channels/ntfy.sink';
import { WebhookSink } from './channels/webhook.sink';
import type {
  NotificationEventKey,
  NotificationPayload,
  NotificationSink,
  SinkResult,
} from './notification.types';

/** Flag de `notification_settings` que liga cada tipo de evento. */
const EVENT_FLAG: Record<NotificationEventKey, string> = {
  question: 'notifyQuestion',
  escalation: 'notifyEscalation',
  stalled: 'notifyStalled',
  stageFailed: 'notifyStageFailed',
  sessionFailed: 'notifySessionFailed',
  sessionCompleted: 'notifySessionCompleted',
  // Teste sempre passa: ele existe justamente para provar o caminho de entrega.
  test: '',
};

/** Usado quando a linha do singleton ainda não existe (banco novo). */
export const DEFAULT_SETTINGS = {
  id: 'global',
  enabled: true,
  publicBaseUrl: null as string | null,
  dedupeWindowSec: 300,
  ntfyEnabled: false,
  ntfyServerUrl: 'https://ntfy.sh',
  ntfyTopic: null as string | null,
  ntfyToken: null as string | null,
  webhookEnabled: false,
  webhookUrl: null as string | null,
  webhookSecret: null as string | null,
  notifyQuestion: true,
  notifyEscalation: true,
  notifyStalled: true,
  notifyStageFailed: true,
  notifySessionFailed: true,
  notifySessionCompleted: false,
};

export type NotificationSettings = typeof DEFAULT_SETTINGS & {
  updatedAt?: Date;
};

@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);
  /** tag -> epoch ms do último envio, para a janela de dedup. */
  private readonly lastSent = new Map<string, number>();
  /** sessionId -> nome do projeto, para o prefixo `[projeto]` do título. */
  private readonly projectNameCache = new Map<string, string | null>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async onModuleInit() {
    for (const channel of NOTIFIABLE_CHANNELS) {
      await this.redis.subscribe(channel, (data) => {
        // `void`: o handler do Redis é sync e não espera ninguém — um await aqui
        // seguraria a entrega dos outros assinantes do mesmo canal.
        void this.handle(channel, data);
      });
    }
    this.logger.log(
      `Notificações assinando ${NOTIFIABLE_CHANNELS.length} canais`,
    );
  }

  async getSettings(): Promise<NotificationSettings> {
    try {
      const row = await this.prisma.notificationSettings.findUnique({
        where: { id: 'global' },
      });
      return (row as NotificationSettings) ?? { ...DEFAULT_SETTINGS };
    } catch (error: any) {
      this.logger.warn(
        `Falha lendo notification_settings, usando defaults: ${error?.message}`,
      );
      return { ...DEFAULT_SETTINGS };
    }
  }

  async updateSettings(
    patch: Partial<NotificationSettings>,
  ): Promise<NotificationSettings> {
    const data = { ...patch };
    delete (data as any).id;
    delete (data as any).updatedAt;
    const row = await this.prisma.notificationSettings.upsert({
      where: { id: 'global' },
      create: { id: 'global', ...data },
      update: data,
    });
    return row as NotificationSettings;
  }

  /** Dispara uma notificação de teste pelos canais ligados e devolve o resultado de cada um. */
  async sendTest(): Promise<SinkResult[]> {
    const settings = await this.getSettings();
    const sinks = this.buildSinks(settings);
    if (sinks.length === 0) {
      return [
        {
          sink: 'none',
          ok: false,
          error: 'Nenhum canal habilitado — configure ntfy ou webhook.',
        },
      ];
    }
    return this.dispatch(
      {
        event: 'test',
        title: 'Notificação de teste',
        body: 'Se chegou até aqui, o caminho de entrega está de pé.',
        priority: 'default',
        tag: `test:${Date.now()}`,
        path: '/settings',
      },
      settings,
      sinks,
    );
  }

  private async handle(channel: string, data: any): Promise<void> {
    try {
      const payload = buildNotification(channel, data);
      if (!payload) return;

      const settings = await this.getSettings();
      if (!settings.enabled) return;

      const flag = EVENT_FLAG[payload.event];
      if (flag && (settings as any)[flag] !== true) return;

      if (!this.allowedByDedupe(payload.tag, settings.dedupeWindowSec)) return;

      const sinks = this.buildSinks(settings);
      if (sinks.length === 0) return;

      payload.projectName =
        (await this.projectNameOf(data?.sessionId ?? data?.id)) ?? undefined;

      await this.dispatch(payload, settings, sinks);
    } catch (error: any) {
      // Falha de notificação nunca sobe: este handler roda no fluxo do publish
      // que a sessão fez, e derrubar o pipeline por causa de um push é pior que
      // não notificar.
      this.logger.warn(
        `Falha notificando ${channel}: ${error?.message ?? error}`,
      );
    }
  }

  private async dispatch(
    payload: NotificationPayload,
    settings: NotificationSettings,
    sinks: NotificationSink[],
  ): Promise<SinkResult[]> {
    const link = this.linkFor(payload, settings);
    const results = await Promise.all(
      sinks.map((sink) => sink.send(payload, link)),
    );
    for (const result of results) {
      if (!result.ok) {
        this.logger.warn(`Sink ${result.sink} falhou: ${result.error}`);
      }
    }
    return results;
  }

  private buildSinks(settings: NotificationSettings): NotificationSink[] {
    const sinks: NotificationSink[] = [];
    if (settings.ntfyEnabled && settings.ntfyTopic) {
      sinks.push(
        new NtfySink({
          serverUrl: settings.ntfyServerUrl,
          topic: settings.ntfyTopic,
          token: settings.ntfyToken,
        }),
      );
    }
    if (settings.webhookEnabled && settings.webhookUrl) {
      sinks.push(
        new WebhookSink({
          url: settings.webhookUrl,
          secret: settings.webhookSecret,
        }),
      );
    }
    return sinks;
  }

  private linkFor(
    payload: NotificationPayload,
    settings: NotificationSettings,
  ): string | undefined {
    if (!settings.publicBaseUrl || !payload.path) return undefined;
    return `${settings.publicBaseUrl.replace(/\/+$/, '')}${payload.path}`;
  }

  /**
   * `true` só na primeira vez que a tag aparece dentro da janela. O watchdog
   * republica `session:stalled` a cada ciclo de avaliação — sem isso, uma sessão
   * travada de madrugada renderia dezenas de notificações iguais.
   */
  private allowedByDedupe(tag: string, windowSec: number): boolean {
    const now = Date.now();
    const window = Math.max(0, windowSec) * 1000;
    const last = this.lastSent.get(tag);
    if (last !== undefined && now - last < window) return false;
    this.lastSent.set(tag, now);
    if (this.lastSent.size > 2000) {
      const oldest = this.lastSent.keys().next().value;
      if (oldest) this.lastSent.delete(oldest);
    }
    return true;
  }

  private async projectNameOf(
    sessionId: unknown,
  ): Promise<string | null | undefined> {
    if (typeof sessionId !== 'string' || !sessionId) return undefined;
    if (this.projectNameCache.has(sessionId)) {
      return this.projectNameCache.get(sessionId);
    }
    let name: string | null = null;
    try {
      const session = await this.prisma.session.findUnique({
        where: { id: sessionId },
        select: { macroTask: { select: { project: { select: { name: true } } } } },
      });
      name = session?.macroTask?.project?.name ?? null;
    } catch {
      name = null;
    }
    this.projectNameCache.set(sessionId, name);
    if (this.projectNameCache.size > 2000) {
      const oldest = this.projectNameCache.keys().next().value;
      if (oldest) this.projectNameCache.delete(oldest);
    }
    return name;
  }
}
