import { Logger } from '@nestjs/common';
import type {
  NotificationPayload,
  NotificationSink,
  SinkResult,
} from '../notification.types';

export interface NtfyConfig {
  /** Base do servidor — `https://ntfy.sh` ou uma instância própria. */
  serverUrl: string;
  topic: string;
  /** Token de acesso (`tk_...`) para tópicos protegidos. Opcional. */
  token?: string | null;
}

/** ntfy: 1=min 2=low 3=default 4=high 5=max. */
const PRIORITY: Record<NotificationPayload['priority'], number> = {
  low: 2,
  default: 3,
  // 5 (max) e não 4: é o único nível que o app do ntfy toca com insistência —
  // e "sessão travada" só serve se me tirar de onde eu estiver.
  high: 5,
};

const EMOJI: Partial<Record<NotificationPayload['event'], string>> = {
  question: 'question',
  escalation: 'raising_hand',
  stalled: 'warning',
  stageFailed: 'x',
  sessionCompleted: 'white_check_mark',
  sessionFailed: 'rotating_light',
  test: 'bell',
};

/**
 * Push pelo ntfy.
 *
 * É o caminho que funciona no celular sem HTTPS no orquestrador: quem entrega a
 * notificação é o app do ntfy, então o backend só precisa de saída HTTP. Web
 * Push do navegador exige origem segura, e pelo IP da LAN em http isso não
 * existe — ver docs/guides/mobile-e-notificacoes.md.
 */
export class NtfySink implements NotificationSink {
  readonly name = 'ntfy';
  private readonly logger = new Logger(NtfySink.name);

  constructor(private readonly config: NtfyConfig) {}

  async send(payload: NotificationPayload, link?: string): Promise<SinkResult> {
    const base = this.config.serverUrl?.replace(/\/+$/, '');
    if (!base || !this.config.topic) {
      return { sink: this.name, ok: false, error: 'ntfy sem serverUrl ou topic' };
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.config.token) headers.Authorization = `Bearer ${this.config.token}`;

    // Endpoint JSON, e não os headers X-Title/X-Message: header de ntfy é
    // ASCII-only, e "Sessão"/"Pergunta não respondida" perderiam os acentos.
    const body: Record<string, unknown> = {
      topic: this.config.topic,
      title: payload.projectName
        ? `[${payload.projectName}] ${payload.title}`
        : payload.title,
      message: payload.body,
      priority: PRIORITY[payload.priority],
      tags: [EMOJI[payload.event] ?? 'bell'],
    };
    if (link) body.click = link;

    try {
      const response = await fetch(base, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        return {
          sink: this.name,
          ok: false,
          error: `HTTP ${response.status} ${text.slice(0, 200)}`.trim(),
        };
      }
      return { sink: this.name, ok: true };
    } catch (error: any) {
      // Nunca propaga: notificação que falha não pode derrubar o pipeline que a
      // originou (o publish do Redis acontece dentro do fluxo da sessão).
      this.logger.warn(`ntfy falhou: ${error?.message ?? error}`);
      return { sink: this.name, ok: false, error: String(error?.message ?? error) };
    }
  }
}
