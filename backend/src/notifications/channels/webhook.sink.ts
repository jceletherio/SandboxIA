import { Logger } from '@nestjs/common';
import type {
  NotificationPayload,
  NotificationSink,
  SinkResult,
} from '../notification.types';

export interface WebhookConfig {
  url: string;
  /** Vai em `X-Orchestr-Secret` para o outro lado descartar request de terceiro. */
  secret?: string | null;
}

/**
 * Escape hatch: entrega o payload cru num POST JSON.
 *
 * Existe para não ter que escrever um sink por serviço — Telegram, Slack,
 * Gotify, Home Assistant e n8n todos aceitam um webhook, e quem quiser um
 * formato específico põe o adaptador do lado de fora.
 */
export class WebhookSink implements NotificationSink {
  readonly name = 'webhook';
  private readonly logger = new Logger(WebhookSink.name);

  constructor(private readonly config: WebhookConfig) {}

  async send(payload: NotificationPayload, link?: string): Promise<SinkResult> {
    if (!this.config.url) {
      return { sink: this.name, ok: false, error: 'webhook sem url' };
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.config.secret) headers['X-Orchestr-Secret'] = this.config.secret;

    try {
      const response = await fetch(this.config.url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...payload, link: link ?? null, source: 'orchestr' }),
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) {
        return { sink: this.name, ok: false, error: `HTTP ${response.status}` };
      }
      return { sink: this.name, ok: true };
    } catch (error: any) {
      this.logger.warn(`webhook falhou: ${error?.message ?? error}`);
      return { sink: this.name, ok: false, error: String(error?.message ?? error) };
    }
  }
}
