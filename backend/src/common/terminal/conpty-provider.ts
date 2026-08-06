import { ITerminalProvider, CreateSessionOptions, SessionResult, AttachResult, SessionInfo } from './terminal-provider.interface';
import * as os from 'os';
import * as path from 'path';

/**
 * ConPTYProvider — Windows fallback terminal provider using ConPTY.
 * 
 * ConPTY is available on Windows 10 1809+ (build 17763+). This provider
 * does NOT support tmux multiplexing — each session is an isolated PTY
 * process. Use itmux/tmux when multiplexing is needed.
 * 
 * Full ConPTY support requires node-pty (@microsoft/node-pty or node-pty
 * package). This is a stub that delegates to node-pty when available.
 */
export class ConptyProvider implements ITerminalProvider {
  private sessions = new Map<string, { pid: number; cwd: string; createdAt: Date; lastActivity: Date; status: 'active' | 'idle' | 'dead'; pty: any }>();

  getProviderName(): string {
    return 'conpty';
  }

  async isAvailable(): Promise<boolean> {
    if (process.platform !== 'win32') return false;
    const release = os.release().split('.').map(Number);
    const build = release[2] || 0;
    return (release[0] || 0) >= 10 && build >= 17763;
  }

  async createSession(options: CreateSessionOptions): Promise<SessionResult> {
    let pty: any;
    try {
      pty = require('node-pty');
    } catch {
      throw new Error('node-pty module not installed. Run: npm install node-pty');
    }

    const sessionId = `conpty-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const sessionName = `conpty-${Date.now()}`;
    const shell = process.env.COMSPEC || 'cmd.exe';

    const ptyProcess = pty.spawn(shell, [], {
      name: sessionName,
      cols: options.cols || 80,
      rows: options.rows || 24,
      cwd: options.cwd,
      env: { ...process.env, ...options.env } as any,
    });

    if (options.initialCommand) {
      ptyProcess.write(options.initialCommand + '\r\n');
    }

    this.sessions.set(sessionId, {
      pid: ptyProcess.pid || 0,
      cwd: options.cwd,
      createdAt: new Date(),
      lastActivity: new Date(),
      status: 'active',
      pty: ptyProcess,
    });

    return { sessionId, pid: ptyProcess.pid || 0, tmuxSessionName: sessionName };
  }

  async attachSession(sessionId: string): Promise<AttachResult> {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error(`Session ${sessionId} not found`);
    return { sessionId, wsUrl: `/terminal/attach/conpty/${sessionId}` };
  }

  async sendInput(sessionId: string, input: string | Uint8Array): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error(`Session ${sessionId} not found`);
    const inputStr = typeof input === 'string' ? input : Buffer.from(input).toString();
    s.pty.write(inputStr);
    s.lastActivity = new Date();
  }

  async resize(sessionId: string, cols: number, rows: number): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error(`Session ${sessionId} not found`);
    try { s.pty.resize(cols, rows); } catch { /* ConPTY resize may not be available */ }
  }

  async killSession(sessionId: string): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error(`Session ${sessionId} not found`);
    try { s.pty.kill(); } catch { /* already dead */ }
    this.sessions.delete(sessionId);
  }

  async listSessions(): Promise<SessionInfo[]> {
    const result: SessionInfo[] = [];
    for (const [sessionId, s] of this.sessions.entries()) {
      result.push({
        sessionId,
        name: `conpty-${s.pid}`,
        cwd: s.cwd,
        status: s.status,
        pid: s.pid,
        tmuxSessionName: `conpty-${s.pid}`,
        createdAt: s.createdAt,
        lastActivity: s.lastActivity,
      });
    }
    return result;
  }
}