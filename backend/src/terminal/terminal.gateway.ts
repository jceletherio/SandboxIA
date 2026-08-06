import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { corsOrigin } from '../common/cors';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { MASTER_ACTIVE_PROJECTS_KEY, masterStateKey } from '../redis/keys';
import { masterTmuxSession } from '../master-agent/master-runtime.service';
import { ptyRegistry } from '../session-runtime/pty-session.registry';

interface TerminalHandle {
  /** Desassina o stream do pane; NÃO mata o pane (o CLI segue rodando). */
  detach: () => void;
  sessionId: string;
  tmuxSession: string;
}

interface CreateTerminalPayload {
  terminalId: string;
  sessionId: string;
  cols?: number;
  rows?: number;
}

/** Nome de tmux session válido para attach externo (sem espaços/controle). */
const EXTERNAL_TMUX_NAME_RE = /^[\w@%+=:,.-]+$/;

/**
 * Terminal web multiplexado: um socket por aba, N terminais por socket,
 * identificados por terminalId em todos os payloads. Anexa SOMENTE a sessões
 * tmux existentes — nunca cria tmux novo aqui. Além das sessões do
 * session-runtime (por sessionId do banco), aceita sessionId "external:<nome>"
 * para anexar a uma tmux session criada fora do orquestrador.
 */
@WebSocketGateway({
  cors: {
    origin: corsOrigin,
  },
  namespace: '/terminal',
})
export class TerminalGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(TerminalGateway.name);
  // clientId -> terminalId -> handle
  private terminals: Map<string, Map<string, TerminalHandle>> = new Map();

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
    const handles = this.terminals.get(client.id);
    if (handles) {
      // Desanexa, NUNCA mata o pane: fechar a aba do navegador não pode
      // derrubar o CLI do agente. Antes isto matava o processo
      // `tmux attach-session`, que era só o cliente; `detach()` é o
      // equivalente exato agora que o pane é o processo de verdade.
      for (const handle of handles.values()) handle.detach();
      this.terminals.delete(client.id);
    }
  }

  private async tmuxSessionExists(name: string): Promise<boolean> {
    return ptyRegistry.exists(name);
  }

  /**
   * Master ativo → pseudo-sessão apontando para a tmux dele.
   *
   * MT-20: há um Master por projeto, então o id do terminal pode vir como
   * `master:<projectId>`. O `master` puro (que é o que a UI mandava antes)
   * continua valendo quando existe exatamente UM Master ativo — com dois,
   * escolher um deles abriria o terminal do projeto errado sem avisar.
   */
  private async resolveMasterSession(projectId?: string): Promise<{
    tmuxSession: string | null;
    worktreePath: string | null;
  } | null> {
    try {
      let target = projectId;
      if (!target) {
        const active = await this.redis.getClient().smembers(MASTER_ACTIVE_PROJECTS_KEY);
        if (active.length !== 1) return null;
        target = active[0];
      }
      const saved = await this.redis.getClient().get(masterStateKey(target));
      if (!saved) return null;
      return { tmuxSession: masterTmuxSession(target), worktreePath: null };
    } catch {
      return null;
    }
  }

  private killHandle(clientId: string, terminalId: string) {
    const handles = this.terminals.get(clientId);
    const handle = handles?.get(terminalId);
    if (handle) {
      handle.detach();
      handles.delete(terminalId);
    }
  }

  @SubscribeMessage('createTerminal')
  async handleCreateTerminal(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: CreateTerminalPayload,
  ) {
    const { terminalId, sessionId } = data;
    if (!terminalId || !sessionId) {
      return { success: false, terminalId, error: 'terminalId and sessionId are required' };
    }

    // Terminal do Master Agent: tmux persistente próprio, sem Session no banco.
    // "external:<nome>": tmux criada fora do orquestrador, attach por nome bruto.
    let dbSession: { tmuxSession: string | null; worktreePath: string | null } | null;
    if (sessionId === 'master' || sessionId.startsWith('master:')) {
      dbSession = await this.resolveMasterSession(sessionId.split(':')[1]);
    } else if (sessionId.startsWith('external:')) {
      const rawName = sessionId.slice('external:'.length);
      if (!rawName || !EXTERNAL_TMUX_NAME_RE.test(rawName)) {
        client.emit('terminalError', {
          terminalId,
          code: 'invalid_tmux_name',
          message: 'Invalid external tmux session name',
        });
        return { success: false, terminalId, error: 'invalid_tmux_name' };
      }
      dbSession = { tmuxSession: rawName, worktreePath: null };
    } else {
      dbSession = await this.prisma.session.findUnique({
        where: { id: sessionId },
        select: { tmuxSession: true, worktreePath: true },
      });
    }

    if (!dbSession) {
      client.emit('terminalError', {
        terminalId,
        code: 'session_not_found',
        message: 'Session not found',
      });
      return { success: false, terminalId, error: 'session_not_found' };
    }

    const tmuxSession = dbSession.tmuxSession;
    if (!tmuxSession || !(await this.tmuxSessionExists(tmuxSession))) {
      // Os dois casos são diagnósticos DIFERENTES e a mensagem antiga os
      // misturava num "tmux session is not running" — que, além de citar uma
      // dependência que o projeto não usa mais, mandava quem lesse investigar
      // o terminal quando a falha real tinha acontecido antes dele existir.
      const neverStarted = !tmuxSession;
      const message = neverStarted
        ? 'This session never opened a terminal — it failed before the CLI could start. Check the session logs for the stage error.'
        : 'The terminal for this session is no longer running — the backend restarted, or the CLI exited.';
      client.emit('terminalError', {
        terminalId,
        code: neverStarted ? 'terminal_never_started' : 'terminal_not_running',
        message,
      });
      return {
        success: false,
        terminalId,
        error: neverStarted ? 'terminal_never_started' : 'terminal_not_running',
      };
    }

    // Reconexão/StrictMode: recriar com o mesmo terminalId substitui o antigo
    this.killHandle(client.id, terminalId);

    this.logger.log(
      `Attaching terminal ${terminalId.slice(0, 8)} (session ${sessionId.slice(0, 8)}) → tmux ${tmuxSession}`,
    );

    // `replay: true`: o pane já está rodando há um tempo e esta aba acabou de
    // abrir. O snapshot da tela vem antes do primeiro chunk novo — é o redraw
    // que o `tmux attach-session` dava de graça; sem ele a aba abre em branco
    // até o CLI resolver escrever alguma coisa.
    const detach = ptyRegistry.attach(
      tmuxSession,
      (chunk) => {
        client.emit('terminalData', { terminalId, data: chunk });
      },
      {
        replay: true,
        onExit: (exitCode) => {
          client.emit('terminalExit', { terminalId, exitCode, signal: undefined });
          this.terminals.get(client.id)?.delete(terminalId);
        },
      },
    );

    // O mesmo pane pode estar aberto em mais de um tile/página: seguir o
    // tamanho do cliente mais recente é o que o `window-size latest` do tmux
    // fazia — sem isso o pane encolheria para o menor cliente anexado.
    ptyRegistry.resize(tmuxSession, data.cols ?? 120, data.rows ?? 30);

    let handles = this.terminals.get(client.id);
    if (!handles) {
      handles = new Map();
      this.terminals.set(client.id, handles);
    }
    handles.set(terminalId, { detach, sessionId, tmuxSession });

    client.emit('terminalReady', {
      terminalId,
      tmuxSession,
      worktreePath: dbSession.worktreePath,
    });

    return { success: true, terminalId, tmuxSession };
  }

  @SubscribeMessage('terminalInput')
  handleTerminalInput(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { terminalId: string; input: string },
  ) {
    const handle = this.terminals.get(client.id)?.get(data.terminalId);
    if (handle) {
      ptyRegistry.write(handle.tmuxSession, data.input);
    }
  }

  @SubscribeMessage('resizeTerminal')
  handleResizeTerminal(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { terminalId: string; cols: number; rows: number },
  ) {
    const handle = this.terminals.get(client.id)?.get(data.terminalId);
    if (handle && data.cols > 0 && data.rows > 0) {
      ptyRegistry.resize(handle.tmuxSession, data.cols, data.rows);
    }
  }

  @SubscribeMessage('closeTerminal')
  handleCloseTerminal(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { terminalId: string },
  ) {
    this.killHandle(client.id, data.terminalId);
    return { success: true, terminalId: data.terminalId };
  }
}
