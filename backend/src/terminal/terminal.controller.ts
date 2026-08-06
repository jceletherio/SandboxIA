import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Logger,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MASTER_TMUX_PREFIX } from '../master-agent/master-runtime.service';
import { ptyRegistry } from '../session-runtime/pty-session.registry';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface TmuxSessionInfo {
  /** Nome da sessão tmux no host. */
  name: string;
  /** Epoch (segundos) de criação reportado pelo tmux. */
  createdAt: string | null;
  attached: boolean;
  /** true se existe Session no banco com esse tmuxSession (ou é a tmux do Master). */
  managed: boolean;
  /** Preenchidos quando managed via Session do banco. */
  sessionId?: string;
  sessionStatus?: string;
  /** true quando é a tmux persistente do Master Agent. */
  isMaster?: boolean;
}

@Controller('terminal')
export class TerminalController {
  private readonly logger = new Logger(TerminalController.name);
  constructor(private prisma: PrismaService) {}

  /**
   * Lista os panes vivos do runtime, marcando cada um como managed (existe
   * Session no banco com `tmuxSession` igual, ou é o pane do Master).
   *
   * O `external` sumiu junto com o tmux: antes o `tmux list-sessions` enxergava
   * QUALQUER sessão do host, inclusive as criadas fora do orquestrador, e a
   * página Terminals sabia anexar nelas por `external:<nome>`. Um pane do
   * registry é um PTY interno ao processo do backend — não existe sessão de
   * fora para achar, então tudo o que aparece aqui é nosso. O campo `managed`
   * continua no contrato para a UI não precisar mudar.
   */
  @Get('tmux-sessions')
  async listTmuxSessions(): Promise<{ sessions: TmuxSessionInfo[] }> {
    const names = ptyRegistry.listNames();
    if (names.length === 0) return { sessions: [] };

    const dbSessions = await this.prisma.session.findMany({
      where: { tmuxSession: { in: names } },
      select: { id: true, status: true, tmuxSession: true },
    });
    const byTmux = new Map(dbSessions.map((s) => [s.tmuxSession as string, s]));

    const sessions: TmuxSessionInfo[] = names.map((name) => {
      const db = byTmux.get(name);
      const info = ptyRegistry.info(name);
      // MT-20: um pane de Master POR projeto (`orchestr-master-<id8>`), então o
      // critério é o prefixo — comparar com um nome fixo deixaria de reconhecer
      // os terminais de Master a partir do segundo projeto.
      const isMaster = name.startsWith(`${MASTER_TMUX_PREFIX}-`);
      return {
        name,
        createdAt: info ? new Date(info.createdAt).toISOString() : null,
        attached: info?.attached ?? false,
        managed: !!db || isMaster,
        sessionId: db?.id,
        sessionStatus: db?.status,
        ...(isMaster ? { isMaster: true } : {}),
      };
    });

    return { sessions };
  }

  /**
   * Execução de comando na worktree da sessão.
   * DESLIGADO por padrão (execução arbitrária) — habilite com ALLOW_TERMINAL_EXEC=1.
   */
  @Post(':sessionId/execute')
  async executeCommand(
    @Param('sessionId') sessionId: string,
    @Body() body: { command: string },
  ) {
    if (process.env.ALLOW_TERMINAL_EXEC !== '1') {
      throw new ForbiddenException(
        'Arbitrary command execution is disabled. Set ALLOW_TERMINAL_EXEC=1 to enable. Use the web terminal instead.',
      );
    }

    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
    });
    if (!session) throw new NotFoundException('Session not found');

    try {
      // Shell de login do host. Continua `execFile` com ARRAY de argumentos:
      // o comando é um argumento só, nunca concatenado numa linha — o shell é
      // quem interpreta, e nada aqui monta string de comando.
      const shell =
        process.platform === 'win32'
          ? { file: 'powershell.exe', args: ['-NoLogo', '-NoProfile', '-Command', body.command] }
          : { file: 'bash', args: ['-lc', body.command] };
      const { stdout, stderr } = await execFileAsync(shell.file, shell.args, {
        cwd: session.worktreePath,
        timeout: 30000,
        maxBuffer: 1024 * 1024,
      });
      return { success: true, stdout: stdout || '', stderr: stderr || '', exitCode: 0 };
    } catch (error: any) {
      return {
        success: false,
        stdout: error.stdout || '',
        stderr: error.stderr || error.message,
        exitCode: error.code || 1,
      };
    }
  }

  /**
   * Não abre mais terminal gráfico no host (gnome-terminal etc.).
   *
   * Sem tmux não existe mais attach externo: o pane é um PTY dentro do
   * processo do backend, não um socket que outro terminal possa abrir. O
   * terminal REAL é o web terminal (xterm + WebSocket) — este endpoint sobrou
   * como informação de worktree para a UI.
   */
  @Post(':sessionId/open')
  async openTerminal(@Param('sessionId') sessionId: string) {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
    });
    if (!session) throw new NotFoundException('Session not found');

    const tmuxSession = session.tmuxSession || `orchestr-${session.id.slice(0, 8)}`;

    return {
      success: true,
      path: session.worktreePath,
      tmuxSession,
      command: null,
      message: 'Use the web terminal — this session has no externally attachable terminal.',
    };
  }
}
