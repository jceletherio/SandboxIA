import { Injectable, Logger } from '@nestjs/common';
import * as os from 'os';
import * as pty from 'node-pty';
import { Terminal } from '@xterm/headless';
import { SerializeAddon } from '@xterm/addon-serialize';

/**
 * Registro de sessões PTY nomeadas — o substituto do servidor tmux.
 *
 * O runtime antes delegava tudo ao tmux: `new-session -d` criava o processo,
 * `attach-session` dava a visão ao vivo, `capture-pane` lia a tela e
 * `paste-buffer` injetava prompt. tmux não existe no Windows e não tem
 * equivalente, então cada uma dessas peças vive aqui:
 *
 * - o processo é um ConPTY/PTY do node-pty, guardado neste Map;
 * - a "tela" é um `@xterm/headless` alimentado pelo `onData` do PTY — é ele que
 *   resolve os escapes ANSI e permite `capturePane()` devolver texto renderizado,
 *   idêntico ao `capture-pane -p`. Stream cru não serve: CLI em TUI reescreve
 *   linha o tempo todo e duas leituras nunca "estabilizam";
 * - o attach é fan-out do `onData` para N assinantes, com replay do estado da
 *   tela (`serialize()`) para quem chega no meio — é o redraw que o
 *   `tmux attach-session` fazia.
 *
 * ponytail: sessão morre junto com o backend. O tmux era um daemon separado, e
 * era por isso que a sessão do agente sobrevivia ao restart do backend e o
 * `recoverOrphanedSessions` conseguia reanexar. Aqui o PTY é filho do processo:
 * restart do backend derruba todas as sessões, que voltam marcadas `stalled`
 * para o usuário retomar. Se a persistência entre restarts voltar a importar, o
 * upgrade é hospedar este registry num processo destacado
 * (`detached: true, stdio: 'ignore'`) falando com o backend por named pipe /
 * unix socket — a API pública desta classe não muda.
 */

/** Assinante do stream de um pane. */
type DataListener = (data: string) => void;

interface PtySession {
  name: string;
  ptyProcess: pty.IPty;
  /** Espelho da tela: resolve escapes para `capturePane` e `serialize`. */
  term: Terminal;
  serializer: SerializeAddon;
  listeners: Set<DataListener>;
  exitListeners: Set<(exitCode: number) => void>;
  /** Epoch ms do último byte vindo do PTY — substitui `#{window_activity}`. */
  lastActivityAt: number;
  /** Epoch ms de criação — substitui `#{session_created}`. */
  createdAt: number;
  cwd: string;
  /**
   * Env extra do create. Guardado porque o node-pty não devolve o env do
   * processo e o `respawn` precisa recriar o pane com as MESMAS variáveis
   * (ORCHESTRATOR_SESSION_ID/TOKEN/URL) — sem elas o CLI relançado perde o
   * vínculo com o orquestrador.
   */
  env: Record<string, string>;
  cols: number;
  rows: number;
  alive: boolean;
}

export interface CreateSessionOptions {
  cwd: string;
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
}

/** Shell interativo do host onde os CLIs de agente são lançados. */
export function defaultShell(): { file: string; args: string[] } {
  if (process.platform === 'win32') {
    // -NoExit: o pane tem que continuar vivo depois do CLI sair, igual ao
    // shell que o `tmux new-session` deixava. -NoLogo tira o banner que
    // poluiria a primeira captura de tela.
    return { file: 'powershell.exe', args: ['-NoLogo', '-NoExit'] };
  }
  return { file: process.env.SHELL || '/bin/bash', args: ['-l'] };
}

@Injectable()
export class PtySessionRegistry {
  private readonly logger = new Logger(PtySessionRegistry.name);
  private readonly sessions = new Map<string, PtySession>();

  /** Scrollback do espelho: o suficiente para `capture-pane` e replay. */
  private static readonly SCROLLBACK = 5_000;

  // ------------------------------------------------------------ ciclo de vida

  /** Equivale a `tmux new-session -d -s <name> -c <cwd> -x -y -e ENV=...`. */
  create(name: string, opts: CreateSessionOptions): void {
    if (this.sessions.has(name)) return;

    const cols = opts.cols ?? 200;
    const rows = opts.rows ?? 50;
    const shell = defaultShell();

    const ptyProcess = pty.spawn(shell.file, shell.args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: opts.cwd,
      env: { ...(process.env as Record<string, string>), ...(opts.env ?? {}) },
      // Windows: usa a conpty.dll que vem no prebuild em vez do ConPTY do SO.
      // Não é preferência de versão — é o caminho de `kill()` que interessa.
      // Sem ela o node-pty derruba o pane enumerando o console com um processo
      // auxiliar (`conpty_console_list_agent.js`), que faz `AttachConsole` e
      // falha em todo backend rodando sem console anexado (nohup, serviço,
      // worker do jest), cuspindo stack trace a cada sessão encerrada. Com a
      // DLL o kill fecha o handle direto, sem processo auxiliar.
      ...(process.platform === 'win32' ? { useConptyDll: true } : {}),
    });

    const term = new Terminal({
      cols,
      rows,
      allowProposedApi: true,
      scrollback: PtySessionRegistry.SCROLLBACK,
    });
    const serializer = new SerializeAddon();
    term.loadAddon(serializer);

    const session: PtySession = {
      name,
      ptyProcess,
      term,
      serializer,
      listeners: new Set(),
      exitListeners: new Set(),
      lastActivityAt: Date.now(),
      createdAt: Date.now(),
      cwd: opts.cwd,
      env: opts.env ?? {},
      cols,
      rows,
      alive: true,
    };

    ptyProcess.onData((data) => {
      session.lastActivityAt = Date.now();
      session.term.write(data);
      for (const listener of session.listeners) {
        // Um assinante que lança não pode derrubar os outros nem o PTY.
        try {
          listener(data);
        } catch (error) {
          this.logger.warn(`Listener of pane ${name} threw: ${error.message}`);
        }
      }
    });

    ptyProcess.onExit(({ exitCode }) => {
      session.alive = false;
      for (const listener of session.exitListeners) {
        try {
          listener(exitCode);
        } catch {
          // idem
        }
      }
      // Só remove do Map se a entrada ainda for ESTA sessão. O `onExit` chega
      // depois do `kill()`, e no `respawn` já existe um pane novo com o mesmo
      // nome nesse ponto — um delete cego aqui apagaria o pane recém-criado.
      if (this.sessions.get(name) === session) this.sessions.delete(name);
      session.term.dispose();
      this.logger.log(`Pane ${name} exited (${exitCode})`);
    });

    this.sessions.set(name, session);
    this.logger.log(`Pane ${name} created at ${opts.cwd} (${cols}x${rows})`);
  }

  /** Equivale a `tmux has-session -t <name>`. */
  exists(name: string): boolean {
    const session = this.sessions.get(name);
    return !!session && session.alive;
  }

  /** Equivale a `tmux kill-session -t <name>` (o detach-client é implícito). */
  kill(name: string): void {
    const session = this.sessions.get(name);
    if (!session) return;
    session.listeners.clear();
    session.exitListeners.clear();
    try {
      session.ptyProcess.kill();
    } catch {
      // já morto
    }
    this.sessions.delete(name);
  }

  /**
   * Equivale a `tmux respawn-pane -k`: mata o processo do pane e devolve um
   * shell limpo com o MESMO nome, preservando os assinantes — a UI anexada
   * continua vendo o pane em vez de precisar reconectar.
   */
  respawn(name: string, cwd?: string): void {
    const old = this.sessions.get(name);
    if (!old) return;

    const listeners = new Set(old.listeners);
    const exitListeners = new Set(old.exitListeners);
    // Limpa os assinantes ANTES do kill: senão o onExit do PTY velho avisa
    // "saiu" para quem na verdade continua anexado ao pane recriado.
    old.listeners.clear();
    old.exitListeners.clear();
    this.kill(name);

    this.create(name, {
      cwd: cwd || old.cwd,
      env: old.env,
      cols: old.cols,
      rows: old.rows,
    });

    const fresh = this.sessions.get(name);
    if (fresh) {
      for (const listener of listeners) fresh.listeners.add(listener);
      for (const listener of exitListeners) fresh.exitListeners.add(listener);
    }
  }

  // ------------------------------------------------------------------ leitura

  /**
   * Equivale a `tmux capture-pane -p`: a tela VISÍVEL em texto puro, sem
   * escapes. É o oráculo de estado usado pelo `waitForPaneReady`, pela
   * verificação de paste e pelo stall check.
   */
  capturePane(name: string): string {
    const session = this.sessions.get(name);
    if (!session) return '';
    const buffer = session.term.buffer.active;
    const lines: string[] = [];
    for (let i = buffer.viewportY; i < buffer.viewportY + session.term.rows; i++) {
      const line = buffer.getLine(i);
      lines.push(line ? line.translateToString(true) : '');
    }
    return lines.join('\n').replace(/\n+$/, '');
  }

  /**
   * Estado da tela COM escapes, para redesenhar quem acabou de anexar — é o
   * redraw que o `tmux attach-session` entregava de graça.
   */
  serialize(name: string): string {
    const session = this.sessions.get(name);
    if (!session) return '';
    try {
      return session.serializer.serialize();
    } catch (error) {
      this.logger.warn(`serialize() failed for pane ${name}: ${error.message}`);
      return '';
    }
  }

  /**
   * Epoch ms do último output do pane — substitui `#{window_activity}`.
   * `null` quando o pane não existe (sessão viva no banco e pane morto é o
   * caso normal depois de um restart do backend, não a exceção).
   */
  lastActivity(name: string): number | null {
    return this.sessions.get(name)?.lastActivityAt ?? null;
  }

  /** PID do processo do pane, para gravar em `session.pid`. */
  pid(name: string): number | null {
    return this.sessions.get(name)?.ptyProcess.pid ?? null;
  }

  listNames(): string[] {
    return [...this.sessions.keys()];
  }

  /**
   * Metadados do pane para a listagem da página Terminals — o que o
   * `tmux list-sessions -F '#{session_name}|#{session_created}|#{session_attached}'`
   * devolvia.
   */
  info(name: string): { createdAt: number; attached: boolean; cwd: string } | null {
    const session = this.sessions.get(name);
    if (!session) return null;
    return {
      createdAt: session.createdAt,
      attached: session.listeners.size > 0,
      cwd: session.cwd,
    };
  }

  // -------------------------------------------------------------------- write

  /** Escrita crua no PTY (equivale a `tmux send-keys` com bytes literais). */
  write(name: string, data: string): void {
    const session = this.sessions.get(name);
    if (!session) throw new Error(`Pane ${name} is not running`);
    session.ptyProcess.write(data);
  }

  /** Equivale a `tmux send-keys -t <name> Enter`. */
  sendEnter(name: string): void {
    this.write(name, '\r');
  }

  /**
   * Equivale a `load-buffer` + `paste-buffer -p`: entrega o texto em bracketed
   * paste, então o shell/CLI trata como colagem literal — nada é interpretado
   * durante o envio, e CLIs TUI reconhecem multi-linha como um paste só em vez
   * de uma sequência de Enters.
   */
  paste(name: string, text: string): void {
    this.write(name, `\x1b[200~${text}\x1b[201~`);
  }

  resize(name: string, cols: number, rows: number): void {
    const session = this.sessions.get(name);
    if (!session) return;
    try {
      session.ptyProcess.resize(cols, rows);
      session.term.resize(cols, rows);
      session.cols = cols;
      session.rows = rows;
    } catch (error) {
      this.logger.warn(`resize of pane ${name} failed: ${error.message}`);
    }
  }

  // ------------------------------------------------------------------- attach

  /**
   * Equivale a `pty.spawn('tmux', ['attach-session'])`: assina o stream do pane
   * e devolve o unsubscribe. Vários assinantes compartilham UM processo — é o
   * multiplexing que o tmux dava (o mesmo pane aberto em dois tiles da UI).
   *
   * `replay: true` entrega o estado atual da tela antes do primeiro chunk novo,
   * para o cliente que chega no meio não ver tela em branco.
   */
  attach(
    name: string,
    onData: DataListener,
    opts?: { replay?: boolean; onExit?: (exitCode: number) => void },
  ): () => void {
    const session = this.sessions.get(name);
    if (!session) throw new Error(`Pane ${name} is not running`);

    if (opts?.replay !== false) {
      const snapshot = this.serialize(name);
      if (snapshot) onData(snapshot);
    }

    session.listeners.add(onData);
    if (opts?.onExit) session.exitListeners.add(opts.onExit);

    return () => {
      session.listeners.delete(onData);
      if (opts?.onExit) session.exitListeners.delete(opts.onExit);
    };
  }

  /** Mata todos os panes — chamado no shutdown do backend. */
  killAll(): void {
    for (const name of [...this.sessions.keys()]) this.kill(name);
  }
}

/**
 * Instância de processo. O registry precisa ser o MESMO objeto para o
 * session-runtime, o master-runtime e o terminal gateway — é ele que faz o
 * papel do servidor tmux, que também era único por máquina. Exportado como
 * singleton além de `@Injectable` porque `tmux.util.ts` (helpers do
 * master-runtime) é módulo solto, sem acesso ao container do Nest.
 */
export const ptyRegistry = new PtySessionRegistry();

/** Nome do host, só para log/diagnóstico (o tmux server tinha socket path). */
export const registryHost = os.hostname();
