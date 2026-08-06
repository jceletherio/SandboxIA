import { ITerminalProvider, CreateSessionOptions, SessionResult, AttachResult, SessionInfo } from './terminal-provider.interface';
import * as path from 'path';
import * as os from 'os';

/**
 * ItmuxProvider — tmux for Windows via itmux (Cygwin-based tmux packaging).
 * 
 * Detects itmux at common locations or in PATH. Converts Windows paths to
 * Cygwin paths when passing to tmux commands.
 * 
 * itmux download: https://itefix.net/itmux (free, ~12MB, digitally signed)
 */
export class ItmuxProvider implements ITerminalProvider {
  private sessions = new Map<string, { tmuxSessionName: string; pid: number; cwd: string; createdAt: Date; lastActivity: Date; status: 'active' | 'idle' | 'dead' }>();
  private itmuxTmuxPath: string | null = null;

  constructor() {
    this.itmuxTmuxPath = this.findItmuxTmux();
  }

  getProviderName(): string {
    return 'itmux';
  }

  async isAvailable(): Promise<boolean> {
    if (!this.itmuxTmuxPath) return false;
    try {
      await this.exec(this.itmuxTmuxPath, ['-V']);
      return true;
    } catch {
      return false;
    }
  }

  async createSession(options: CreateSessionOptions): Promise<SessionResult> {
    if (!this.itmuxTmuxPath) throw new Error('itmux not available');
    const sessionId = `itmux-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const sessionName = `sandboxia-${options.name || options.cwd.split(path.sep).pop()}-${Date.now()}`;
    const cygwinCwd = this.toCygwinPath(options.cwd);

    await this.exec(this.itmuxTmuxPath, [
      'new-session', '-d',
      '-s', sessionName,
      '-c', cygwinCwd,
      '-x', String(options.cols || 80),
      '-y', String(options.rows || 24),
    ]);

    if (options.env) {
      for (const [key, value] of Object.entries(options.env)) {
        await this.exec(this.itmuxTmuxPath, ['set-environment', '-t', sessionName, key, value]);
      }
    }

    if (options.initialCommand) {
      await this.exec(this.itmuxTmuxPath, ['send-keys', '-t', sessionName, options.initialCommand, 'Enter']);
    }

    let pid = 0;
    try {
      const { stdout } = await this.exec(this.itmuxTmuxPath, ['display-message', '-p', '-t', sessionName, '#{pid}']);
      pid = parseInt(stdout.trim(), 10) || 0;
    } catch { /* not all tmux versions support display-message */ }

    this.sessions.set(sessionId, { tmuxSessionName: sessionName, pid, cwd: options.cwd, createdAt: new Date(), lastActivity: new Date(), status: 'active' });

    return { sessionId, pid, tmuxSessionName: sessionName };
  }

  async attachSession(sessionId: string): Promise<AttachResult> {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error(`Session ${sessionId} not found`);
    return { sessionId, wsUrl: `/terminal/attach/${s.tmuxSessionName}` };
  }

  async sendInput(sessionId: string, input: string | Uint8Array): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error(`Session ${sessionId} not found`);
    if (!this.itmuxTmuxPath) throw new Error('itmux not available');
    const inputStr = typeof input === 'string' ? input : Buffer.from(input).toString();
    await this.exec(this.itmuxTmuxPath, ['send-keys', '-t', s.tmuxSessionName, inputStr]);
    s.lastActivity = new Date();
  }

  async resize(sessionId: string, cols: number, rows: number): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error(`Session ${sessionId} not found`);
    if (!this.itmuxTmuxPath) throw new Error('itmux not available');
    await this.exec(this.itmuxTmuxPath, ['resize-window', '-t', s.tmuxSessionName, '-x', String(cols), '-y', String(rows)]);
  }

  async killSession(sessionId: string): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error(`Session ${sessionId} not found`);
    if (!this.itmuxTmuxPath) throw new Error('itmux not available');
    await this.exec(this.itmuxTmuxPath, ['kill-session', '-t', s.tmuxSessionName]);
    this.sessions.delete(sessionId);
  }

  async listSessions(): Promise<SessionInfo[]> {
    if (!this.itmuxTmuxPath) return [];
    const { stdout } = await this.exec(this.itmuxTmuxPath, ['list-sessions', '-F', '#{session_name},#{session_id},#{session_attached},#{session_created}']);
    const result: SessionInfo[] = [];
    for (const line of stdout.trim().split('\n')) {
      if (!line.trim()) continue;
      const [name, id, attached, created] = line.split(',');
      result.push({
        sessionId: id, name, cwd: '', status: attached === '1' ? 'active' : 'idle',
        tmuxSessionName: name, createdAt: new Date(parseInt(created) * 1000), lastActivity: new Date(),
      });
    }
    return result;
  }

  private findItmuxTmux(): string | null {
    // Check common itmux installation locations
    const candidates = [
      path.join(os.homedir(), 'itmux', 'bin', 'tmux.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'itmux', 'bin', 'tmux.exe'),
      path.join('C:', 'itmux', 'bin', 'tmux.exe'),
      path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'itmux', 'bin', 'tmux.exe'),
      'tmux', // Try PATH (itmux may add itself to PATH)
    ];
    for (const c of candidates) {
      try {
        require('fs').accessSync(c, require('fs').constants.X_OK);
        return c;
      } catch { /* try next */ }
    }
    return null;
  }

  private toCygwinPath(winPath: string): string {
    const normalized = winPath.replace(/\\/g, '/');
    const match = normalized.match(/^([A-Za-z]):\/(.*)/);
    if (match) {
      return `/cygdrive/${match[1].toLowerCase()}/${match[2]}`;
    }
    return winPath;
  }

  private exec(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = require('child_process').spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '', stderr = '';
      child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
      child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
      child.on('close', (code: number) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${cmd} exit ${code}: ${stderr}`)));
      child.on('error', reject);
    });
  }
}