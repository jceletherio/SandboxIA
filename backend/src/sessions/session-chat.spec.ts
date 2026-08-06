import { NotFoundException } from '@nestjs/common';
import { SessionsService } from './sessions.service';
import { CHANNELS } from '../redis/channels';

/**
 * Chat por sessão (P3.1) com Prisma, Redis e runtime mockados — nenhuma sessão
 * real é iniciada, nenhum pane tmux é criado e nenhuma linha é escrita no banco.
 *
 * O que estes testes travam:
 * - CA2: a mensagem de chat de sessão nasce com `sessionId` e **`projectId`
 *   nulo**, para não se misturar com o chat do Master (que lista por projeto);
 * - sessão morta não é erro 500 — vira uma resposta explicativa, igual ao
 *   Master faz quando está desligado;
 * - sessão inexistente é 404 e **não escreve nada** antes de falhar.
 */

interface FakeMessage {
  id: string;
  role: string;
  content: string;
  projectId: string | null;
  sessionId: string | null;
  timestamp: Date;
}

function makeHarness(
  options: {
    session?: any;
    paneAlive?: boolean;
    messages?: FakeMessage[];
  } = {},
) {
  const messages = options.messages ?? [];
  const created: FakeMessage[] = [];
  const published: Array<{ channel: string; payload: any }> = [];
  let seq = 0;

  const session =
    options.session === undefined
      ? {
          id: 'session-1',
          status: 'running',
          currentStage: 'Implement',
          branchName: 'feat/x',
        }
      : options.session;

  const prisma = {
    session: {
      findUnique: jest.fn(async ({ where }: any) =>
        session && session.id === where.id ? session : null,
      ),
    },
    chatMessage: {
      create: jest.fn(async ({ data }: any) => {
        const msg: FakeMessage = {
          id: `created-${++seq}`,
          role: data.role,
          content: data.content,
          projectId: data.projectId ?? null,
          sessionId: data.sessionId ?? null,
          timestamp: new Date(),
        };
        created.push(msg);
        return msg;
      }),
      findMany: jest.fn(async ({ where, orderBy, take }: any) => {
        const rows = [...messages, ...created].filter((m) => m.sessionId === where.sessionId);
        const dir = orderBy?.timestamp === 'desc' ? -1 : 1;
        rows.sort((a, b) => dir * (a.timestamp.getTime() - b.timestamp.getTime()));
        return take ? rows.slice(0, take) : rows;
      }),
    },
  };

  const redis = {
    publish: jest.fn(async (channel: string, payload: any) => {
      published.push({ channel, payload });
    }),
  };

  const runtime = {
    sendPrompt: jest.fn(async () => undefined),
    resolveTmuxSession: jest.fn(async () => {
      if (options.paneAlive === false) throw new Error('no tmux session');
      return 'orch-session-1';
    }),
  };

  const service = new SessionsService(prisma as any, redis as any, runtime as any);
  return { service, prisma, redis, runtime, created, published };
}

function msg(partial: Partial<FakeMessage> & { id: string }): FakeMessage {
  return {
    role: 'user',
    content: 'oi',
    projectId: null,
    sessionId: 'session-1',
    timestamp: new Date('2026-08-01T10:00:00Z'),
    ...partial,
  };
}

describe('SessionsService — chat por sessão (P3.1)', () => {
  describe('getChat', () => {
    it('devolve só as mensagens daquela sessão, em ordem cronológica', async () => {
      const { service } = makeHarness({
        messages: [
          msg({ id: 'm2', content: 'segunda', timestamp: new Date('2026-08-01T10:05:00Z') }),
          msg({ id: 'm1', content: 'primeira', timestamp: new Date('2026-08-01T10:00:00Z') }),
          msg({ id: 'other', sessionId: 'session-2', content: 'de outra sessão' }),
        ],
      });

      const chat = await service.getChat('session-1');

      // CA2: nada da session-2 aparece aqui.
      expect(chat.map((m) => m.content)).toEqual(['primeira', 'segunda']);
      expect(chat[0].time).toBe(new Date('2026-08-01T10:00:00Z').toISOString());
    });

    it('sessão sem histórico devolve lista vazia (não lança)', async () => {
      const { service } = makeHarness();
      await expect(service.getChat('session-1')).resolves.toEqual([]);
    });
  });

  describe('sendChat', () => {
    it('sessão viva: grava a mensagem e cola o prompt no pane daquela sessão', async () => {
      const { service, created, runtime, published } = makeHarness();

      const result = await service.sendChat('session-1', 'como está indo?');

      expect(result).toEqual({ queued: true });
      expect(created).toHaveLength(1);
      expect(created[0]).toMatchObject({ role: 'user', content: 'como está indo?' });
      expect(runtime.sendPrompt).toHaveBeenCalledTimes(1);

      const [sessionId, prompt] = runtime.sendPrompt.mock.calls[0] as any;
      expect(sessionId).toBe('session-1');
      // O agente só é visto pelo usuário via reply_chat — o prompt tem que dizer isso.
      expect(prompt).toContain('reply_chat');
      expect(prompt).toContain('como está indo?');
      // Contexto do stage vai junto para a conversa não ficar cega.
      expect(prompt).toContain('Implement');

      expect(published[0].channel).toBe(CHANNELS.SESSION_CHAT);
      expect(published[0].payload).toMatchObject({ sessionId: 'session-1', role: 'user' });
    });

    it('grava com projectId NULO — é o que separa do chat do Master (CA2)', async () => {
      const { service, created } = makeHarness();

      await service.sendChat('session-1', 'oi');

      expect(created[0].sessionId).toBe('session-1');
      expect(created[0].projectId).toBeNull();
    });

    it('sessão com status morto: responde explicando, sem prompt e sem 500', async () => {
      const { service, created, runtime } = makeHarness({
        session: { id: 'session-1', status: 'completed', currentStage: 'Merge', branchName: 'b' },
      });

      const result = await service.sendChat('session-1', 'oi');

      expect(result.queued).toBe(false);
      expect(result.response).toContain('completed');
      expect(created.map((m) => m.role)).toEqual(['user', 'agent']);
      expect(runtime.sendPrompt).not.toHaveBeenCalled();
    });

    it('status vivo mas sem pane tmux também cai no caminho explicativo', async () => {
      const { service, runtime } = makeHarness({ paneAlive: false });

      const result = await service.sendChat('session-1', 'oi');

      expect(result.queued).toBe(false);
      expect(runtime.sendPrompt).not.toHaveBeenCalled();
    });

    it('sessão inexistente: 404 sem escrever nada', async () => {
      const { service, prisma, created } = makeHarness({ session: null });

      await expect(service.sendChat('sumida', 'oi')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.chatMessage.create).not.toHaveBeenCalled();
      expect(created).toHaveLength(0);
    });

    it('falha ao publicar no Redis não derruba o envio', async () => {
      const { service, redis, runtime } = makeHarness();
      redis.publish.mockRejectedValue(new Error('redis down'));

      await expect(service.sendChat('session-1', 'oi')).resolves.toEqual({ queued: true });
      expect(runtime.sendPrompt).toHaveBeenCalledTimes(1);
    });
  });
});
