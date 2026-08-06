import { CHANNELS } from '../redis/channels';
import { DEFAULT_SETTINGS, NotificationsService } from './notifications.service';

/**
 * Deixa a fila de microtasks drenar: o handler do Redis é sync e dispara
 * `void this.handle(...)`, então o efeito (o POST) acontece depois do invoke.
 */
async function flush() {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
}

function setup(settings: Partial<typeof DEFAULT_SETTINGS> = {}) {
  const handlers = new Map<string, (data: any) => void>();
  const fetchMock = jest.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => '',
  })) as unknown as typeof fetch;
  global.fetch = fetchMock;

  const prisma = {
    notificationSettings: {
      findUnique: jest.fn(async () => ({
        ...DEFAULT_SETTINGS,
        ntfyEnabled: true,
        ntfyTopic: 'orchestr-test',
        ...settings,
      })),
      upsert: jest.fn(async ({ create, update }: any) => ({
        ...DEFAULT_SETTINGS,
        ...create,
        ...update,
      })),
    },
    session: {
      findUnique: jest.fn(async () => ({
        macroTask: { project: { name: 'Orchestr' } },
      })),
    },
  };
  const redis = {
    subscribe: jest.fn(async (channel: string, callback: (data: any) => void) => {
      handlers.set(channel, callback);
    }),
  };

  const service = new NotificationsService(prisma as any, redis as any);
  return { service, handlers, prisma, redis, fetchMock: fetchMock as jest.Mock };
}

describe('NotificationsService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('assina os canais notificáveis e entrega no ntfy', async () => {
    const { service, handlers, fetchMock } = setup();
    await service.onModuleInit();

    handlers.get(CHANNELS.SESSION_STALLED)!({
      sessionId: 'abcdefgh1234',
      reason: 'sem output há 10min',
    });
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://ntfy.sh');
    const body = JSON.parse((init as any).body);
    expect(body).toMatchObject({
      topic: 'orchestr-test',
      // Prefixo do projeto: com várias sessões rodando, o título sem projeto
      // não diz qual repo travou.
      title: '[Orchestr] Sessão abcdefgh travada',
      message: 'sem output há 10min',
      priority: 5,
    });
  });

  it('dedup por tag: o mesmo travamento não notifica duas vezes na janela', async () => {
    const { service, handlers, fetchMock } = setup({ dedupeWindowSec: 300 });
    await service.onModuleInit();

    const event = { sessionId: 's1', reason: 'stalled' };
    handlers.get(CHANNELS.SESSION_STALLED)!(event);
    await flush();
    handlers.get(CHANNELS.SESSION_STALLED)!(event);
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('dedup zerado deixa passar tudo', async () => {
    const { service, handlers, fetchMock } = setup({ dedupeWindowSec: 0 });
    await service.onModuleInit();

    handlers.get(CHANNELS.SESSION_STALLED)!({ sessionId: 's1', reason: 'x' });
    await flush();
    handlers.get(CHANNELS.SESSION_STALLED)!({ sessionId: 's1', reason: 'x' });
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('evento desligado não notifica', async () => {
    const { service, handlers, fetchMock } = setup({ notifyStalled: false });
    await service.onModuleInit();

    handlers.get(CHANNELS.SESSION_STALLED)!({ sessionId: 's1', reason: 'x' });
    await flush();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('evento desligado não consome a janela de dedup do evento ligado', async () => {
    // stage-failed e session:status=failed compartilham a tag `failure:<id>`.
    // Se o gate do flag rodasse depois da dedup, desligar o stage-failed
    // silenciaria também a notificação de sessão falhada, que está ligada.
    const { service, handlers, fetchMock } = setup({
      notifyStageFailed: false,
      notifySessionFailed: true,
    });
    await service.onModuleInit();

    handlers.get(CHANNELS.STAGE_FAILED)!({ sessionId: 's1', stage: 'implement' });
    await flush();
    handlers.get(CHANNELS.SESSION_STATUS)!({ sessionId: 's1', status: 'failed' });
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    expect(body.title).toContain('falhou');
  });

  it('enabled=false mata tudo sem perder a config dos canais', async () => {
    const { service, handlers, fetchMock } = setup({ enabled: false });
    await service.onModuleInit();

    handlers.get(CHANNELS.SESSION_STALLED)!({ sessionId: 's1', reason: 'x' });
    await flush();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sem canal habilitado não faz request nenhuma', async () => {
    const { service, handlers, fetchMock } = setup({
      ntfyEnabled: false,
      webhookEnabled: false,
    });
    await service.onModuleInit();

    handlers.get(CHANNELS.SESSION_STALLED)!({ sessionId: 's1', reason: 'x' });
    await flush();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('publicBaseUrl vira o link clicável da notificação', async () => {
    const { service, handlers, fetchMock } = setup({
      publicBaseUrl: 'http://192.168.1.48:3000/',
    });
    await service.onModuleInit();

    handlers.get(CHANNELS.QUESTION_CREATED)!({
      id: 'q1',
      sessionId: 's1',
      question: 'posso mergear?',
    });
    await flush();

    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    // Sem barra dupla: publicBaseUrl com "/" no fim é o jeito natural de colar.
    expect(body.click).toBe('http://192.168.1.48:3000/questions');
  });

  it('sink que falha não propaga exceção', async () => {
    const { service, handlers } = setup();
    global.fetch = jest.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as any;
    await service.onModuleInit();

    handlers.get(CHANNELS.SESSION_STALLED)!({ sessionId: 's1', reason: 'x' });
    await expect(flush()).resolves.toBeUndefined();
  });

  it('sessionCompleted vem desligado por default — fila de tasks viraria spam', async () => {
    const { service, handlers, fetchMock } = setup();
    await service.onModuleInit();

    handlers.get(CHANNELS.SESSION_COMPLETED)!({ sessionId: 's1' });
    await flush();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('webhook recebe o payload cru e o segredo no header', async () => {
    const { service, handlers, fetchMock } = setup({
      ntfyEnabled: false,
      webhookEnabled: true,
      webhookUrl: 'http://localhost:9999/hook',
      webhookSecret: 's3cr3t',
    });
    await service.onModuleInit();

    handlers.get(CHANNELS.SESSION_STALLED)!({ sessionId: 's1', reason: 'travou' });
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:9999/hook');
    expect((init as any).headers['X-Orchestr-Secret']).toBe('s3cr3t');
    expect(JSON.parse((init as any).body)).toMatchObject({
      event: 'stalled',
      tag: 'stalled:s1',
      source: 'orchestr',
    });
  });

  it('sendTest reporta erro por canal quando não há nenhum configurado', async () => {
    const { service } = setup({ ntfyEnabled: false, webhookEnabled: false });
    const results = await service.sendTest();
    expect(results).toEqual([
      expect.objectContaining({ sink: 'none', ok: false }),
    ]);
  });

  it('updateSettings não deixa o cliente trocar o id do singleton', async () => {
    const { service, prisma } = setup();
    await service.updateSettings({ id: 'outro', enabled: false } as any);
    const call = (prisma.notificationSettings.upsert as jest.Mock).mock.calls[0][0];
    expect(call.where).toEqual({ id: 'global' });
    expect(call.update.id).toBeUndefined();
    expect(call.create.id).toBe('global');
  });
});
