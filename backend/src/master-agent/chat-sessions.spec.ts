import { MasterAgentService } from './master-agent.service';

/**
 * Conversas do chat do Master (P3.2) com Prisma, Redis e runtime mockados —
 * nenhum prompt real é enviado a nenhum terminal, nenhuma linha é escrita no
 * banco e nenhum pane tmux é criado.
 *
 * O ponto central destes testes é a invariante do CA4: `chatSessionId` é só
 * agrupamento de mensagens. Não existe runtime por conversa — o `sendPrompt`
 * continua indo para o pane único do projeto.
 */

interface FakeMessage {
  id: string;
  role: string;
  content: string;
  projectId: string | null;
  sessionId: string | null;
  chatSessionId: string | null;
  timestamp: Date;
}

function makeHarness(
  messages: FakeMessage[],
  options: { active?: boolean; running?: boolean; redisDown?: boolean } = {},
) {
  const created: FakeMessage[] = [];
  const redisStore = new Map<string, string>();
  const prompts: string[] = [];
  const published: Array<{ channel: string; payload: any }> = [];
  let seq = 0;

  const matches = (msg: FakeMessage, where: any = {}): boolean => {
    if (where.projectId !== undefined && msg.projectId !== where.projectId) return false;
    if (where.role !== undefined && msg.role !== where.role) return false;
    if (where.chatSessionId !== undefined) {
      const cond = where.chatSessionId;
      if (cond === null && msg.chatSessionId !== null) return false;
      if (typeof cond === 'string' && msg.chatSessionId !== cond) return false;
      if (cond && typeof cond === 'object') {
        if ('not' in cond && cond.not === null && msg.chatSessionId === null) return false;
        if ('in' in cond && !cond.in.includes(msg.chatSessionId)) return false;
      }
    }
    return true;
  };

  const all = () => [...messages, ...created];

  const prisma = {
    chatMessage: {
      create: jest.fn(async ({ data }: any) => {
        const msg: FakeMessage = {
          id: `created-${++seq}`,
          role: data.role,
          content: data.content,
          projectId: data.projectId ?? null,
          sessionId: data.sessionId ?? null,
          chatSessionId: data.chatSessionId ?? null,
          timestamp: new Date(),
        };
        created.push(msg);
        return msg;
      }),
      findMany: jest.fn(async ({ where, orderBy }: any) => {
        const rows = all().filter((m) => matches(m, where));
        const dir = orderBy?.timestamp === 'desc' ? -1 : 1;
        return rows.sort((a, b) => dir * (a.timestamp.getTime() - b.timestamp.getTime()));
      }),
      findFirst: jest.fn(async ({ where, orderBy }: any) => {
        const rows = all().filter((m) => matches(m, where));
        const dir = orderBy?.timestamp === 'desc' ? -1 : 1;
        rows.sort((a, b) => dir * (a.timestamp.getTime() - b.timestamp.getTime()));
        return rows[0] ?? null;
      }),
      groupBy: jest.fn(async ({ where }: any) => {
        const rows = all().filter((m) => matches(m, where));
        const buckets = new Map<string, FakeMessage[]>();
        for (const row of rows) {
          const key = row.chatSessionId ?? '__null__';
          if (!buckets.has(key)) buckets.set(key, []);
          buckets.get(key)!.push(row);
        }
        return [...buckets.entries()].map(([key, rows]) => {
          const times = rows.map((r) => r.timestamp.getTime());
          return {
            chatSessionId: key === '__null__' ? null : key,
            _count: { _all: rows.length },
            _min: { timestamp: new Date(Math.min(...times)) },
            _max: { timestamp: new Date(Math.max(...times)) },
          };
        });
      }),
    },
    session: { count: jest.fn(async () => 0) },
    question: { count: jest.fn(async () => 0) },
    macroTask: { count: jest.fn(async () => 0) },
  };

  const redisClient = {
    set: jest.fn(async (key: string, value: string) => {
      if (options.redisDown) throw new Error('redis down');
      redisStore.set(key, value);
      return 'OK';
    }),
    get: jest.fn(async (key: string) => {
      if (options.redisDown) throw new Error('redis down');
      return redisStore.get(key) ?? null;
    }),
    getdel: jest.fn(async (key: string) => {
      const value = redisStore.get(key) ?? null;
      redisStore.delete(key);
      return value;
    }),
  };

  const redis = {
    getClient: () => redisClient,
    publish: jest.fn(async (channel: string, payload: any) => {
      published.push({ channel, payload });
    }),
    subscribe: jest.fn(async () => undefined),
  };

  const masterRuntime = {
    isRunning: jest.fn(async () => options.running ?? true),
    sendPrompt: jest.fn(async (_projectId: string, prompt: string) => {
      prompts.push(prompt);
    }),
  };

  const service = new MasterAgentService(
    prisma as any,
    redis as any,
    masterRuntime as any,
    {} as any,
  );
  // Estado que normalmente vem do Redis no activate(). MT-20: virou um mapa
  // `runtimes` (um Master por projeto) — `active: false` simula projeto SEM
  // Master ativo, não mais um `isActive` escalar do serviço inteiro.
  if (options.active ?? true) {
    (service as any).runtimes = new Map([
      [
        'project-1',
        {
          projectId: 'project-1',
          cliProfileId: 'cli-1',
          mcpToken: 'token-1',
          schedulingConfig: {},
          tickCount: 0,
          lastRecycleTick: 0,
          tickRunning: false,
          lastSessionCheckAt: null,
          promptedAt: new Map(),
        },
      ],
    ]);
  }

  return { service, prisma, redisStore, redisClient, masterRuntime, prompts, created, published };
}

function msg(partial: Partial<FakeMessage> & { id: string }): FakeMessage {
  return {
    role: 'user',
    content: 'hello',
    projectId: 'project-1',
    sessionId: null,
    chatSessionId: 'conv-a',
    timestamp: new Date('2026-08-01T10:00:00Z'),
    ...partial,
  };
}

describe('MasterAgentService — conversas do chat (P3.2)', () => {
  describe('createChatSession', () => {
    it('devolve um id novo sem persistir nada nem tocar o runtime (CA4)', () => {
      const { service, prisma, masterRuntime } = makeHarness([]);

      const first = service.createChatSession();
      const second = service.createChatSession();

      expect(first.chatSessionId).toEqual(expect.any(String));
      expect(first.chatSessionId).not.toEqual(second.chatSessionId);
      // "Novo chat" não escreve no banco: a conversa nasce na 1ª mensagem.
      expect(prisma.chatMessage.create).not.toHaveBeenCalled();
      // E, acima de tudo, não sobe processo/pane nenhum.
      expect(masterRuntime.sendPrompt).not.toHaveBeenCalled();
    });
  });

  describe('listChatSessions', () => {
    it('agrupa por conversa, titula pela 1ª mensagem do usuário e ordena por mais recente', async () => {
      const { service } = makeHarness([
        msg({
          id: 'a1',
          chatSessionId: 'conv-a',
          content: 'Primeira da conversa A',
          timestamp: new Date('2026-08-01T10:00:00Z'),
        }),
        msg({
          id: 'a2',
          chatSessionId: 'conv-a',
          role: 'agent',
          content: 'resposta',
          timestamp: new Date('2026-08-01T10:01:00Z'),
        }),
        msg({
          id: 'b1',
          chatSessionId: 'conv-b',
          content: 'Primeira da conversa B',
          timestamp: new Date('2026-08-02T09:00:00Z'),
        }),
      ]);

      const list = await service.listChatSessions('project-1');

      expect(list).toHaveLength(2);
      // conv-b tem a mensagem mais recente, então vem primeiro.
      expect(list[0]).toMatchObject({
        chatSessionId: 'conv-b',
        title: 'Primeira da conversa B',
        messageCount: 1,
      });
      expect(list[1]).toMatchObject({
        chatSessionId: 'conv-a',
        title: 'Primeira da conversa A',
        messageCount: 2,
      });
      expect(list[1].createdAt).toBe(new Date('2026-08-01T10:00:00Z').toISOString());
      expect(list[1].lastMessageAt).toBe(new Date('2026-08-01T10:01:00Z').toISOString());
    });

    it('trunca título longo e colapsa quebras de linha', async () => {
      const { service } = makeHarness([
        msg({ id: 'a1', content: `${'x'.repeat(200)}\n\nmais texto` }),
      ]);

      const [conv] = await service.listChatSessions('project-1');

      expect(conv.title.length).toBeLessThanOrEqual(60);
      expect(conv.title.endsWith('…')).toBe(true);
      expect(conv.title).not.toContain('\n');
    });

    it('usa o fallback quando a conversa só tem mensagem do agente', async () => {
      const { service } = makeHarness([
        msg({ id: 'a1', role: 'agent', content: 'status report automático' }),
      ]);

      const [conv] = await service.listChatSessions('project-1');

      expect(conv.title).toBe('Conversation');
    });

    it('não vaza conversa de outro projeto', async () => {
      const { service } = makeHarness([
        msg({ id: 'a1', chatSessionId: 'conv-a', projectId: 'project-1' }),
        msg({ id: 'z1', chatSessionId: 'conv-z', projectId: 'project-2' }),
      ]);

      const list = await service.listChatSessions('project-1');

      expect(list.map((c) => c.chatSessionId)).toEqual(['conv-a']);
    });

    it('ignora mensagens de chat de SESSÃO (P3.1), que não têm conversa', async () => {
      const { service } = makeHarness([
        msg({ id: 'a1', chatSessionId: 'conv-a' }),
        // Chat de Session: sessionId preenchido, chatSessionId e projectId nulos.
        msg({ id: 's1', chatSessionId: null, projectId: null, sessionId: 'session-1' }),
      ]);

      const list = await service.listChatSessions('project-1');

      expect(list.map((c) => c.chatSessionId)).toEqual(['conv-a']);
    });

    it('devolve lista vazia quando o projeto não tem histórico', async () => {
      const { service } = makeHarness([]);
      expect(await service.listChatSessions('project-1')).toEqual([]);
    });
  });

  describe('chat', () => {
    it('grava a mensagem na conversa recebida e manda o prompt para o pane único', async () => {
      const { service, created, masterRuntime, redisStore } = makeHarness([]);

      const result = await service.chat('e aí?', 'conv-a');

      expect(result).toMatchObject({ queued: true, chatSessionId: 'conv-a' });
      expect(created).toHaveLength(1);
      expect(created[0]).toMatchObject({
        role: 'user',
        content: 'e aí?',
        chatSessionId: 'conv-a',
        projectId: 'project-1',
      });
      // CA4: um único sendPrompt, no runtime do projeto — não um por conversa.
      expect(masterRuntime.sendPrompt).toHaveBeenCalledTimes(1);
      // A conversa ativa fica no Redis para o reply_chat correlacionar.
      expect([...redisStore.values()]).toContain('conv-a');
    });

    it('abre uma conversa quando não recebe chatSessionId (nenhuma mensagem fica órfã)', async () => {
      const { service, created } = makeHarness([]);

      const result = await service.chat('sem conversa');

      expect(result.chatSessionId).toEqual(expect.any(String));
      expect(created[0].chatSessionId).toBe(result.chatSessionId);
    });

    it('com o Master desligado grava pergunta E resposta na mesma conversa, sem prompt', async () => {
      const { service, created, masterRuntime } = makeHarness([], {
        active: false,
        running: false,
      });

      const result = await service.chat('oi', 'conv-a');

      expect(result.queued).toBe(false);
      expect(result.response).toContain('not running');
      expect(created).toHaveLength(2);
      expect(created.map((m) => m.role)).toEqual(['user', 'agent']);
      expect(created.every((m) => m.chatSessionId === 'conv-a')).toBe(true);
      expect(masterRuntime.sendPrompt).not.toHaveBeenCalled();
    });

    /**
     * Master ATIVO com terminal morto é outro caso: o tmux caiu sozinho (o
     * servidor tmux 3.2a segfaultou em produção) e mandar "ative o Master" para
     * quem já o tem ativo não dizia nada. A resposta gravada agora explica o
     * restart automático — e continua sendo uma resposta na mesma conversa.
     */
    it('com o Master ativo e o terminal morto, a resposta explica o restart', async () => {
      const { service, created, masterRuntime } = makeHarness([], { running: false });

      const result = await service.chat('oi', 'conv-a');

      expect(result.queued).toBe(false);
      expect(result.response).toContain('restarted');
      expect(created.map((m) => m.role)).toEqual(['user', 'agent']);
      expect(masterRuntime.sendPrompt).not.toHaveBeenCalled();
    });

    it('Redis fora do ar não derruba o chat', async () => {
      const { service, masterRuntime } = makeHarness([], { redisDown: true });

      await expect(service.chat('oi', 'conv-a')).resolves.toMatchObject({ queued: true });
      expect(masterRuntime.sendPrompt).toHaveBeenCalledTimes(1);
    });
  });
});
