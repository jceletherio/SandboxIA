import { ITerminalProvider, CreateSessionOptions, SessionResult, AttachResult, SessionInfo } from './terminal-provider.interface';
import * as path from 'path';

export class TmuxProvider implements ITerminalProvider {
  private sessions = new Map<string, { tmuxSessionName: string; pid: number; cwd: string; createdAt: Date; lastActivity: Date; status: 'active' | 'idle' | 'dead' }>();

  getProviderName(): string {
    return 'tmux';
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.exec('tmux', ['-V']);
      return true;
    } catch {
      return false;
    }
  }

  async createSession(options: CreateSessionOptions): Promise<SessionResult> {
    const sessionId = `tmux-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const sessionName = `sandboxia-${options.name || options.cwd.split(path.sep).pop()}-${Date.now()}`;

    await this.exec('tmux', [
      'new-session', '-d',
      '-s', sessionName,
      '-c', options.cwd,
      '-x', String(options.cols || 80),
      '-y', String(options.rows || 24),
    ]);

    if (options.env) {
      for (const [key, value] of Object.entries(options.env)) {
        await this.exec('tmux', ['set-environment', '-t', sessionName, key, value]);
      }
    }

    if (options.initialCommand) {
      await this.exec('tmux', ['send-keys', '-t', sessionName, options.initialCommand, 'Enter']);
    }

    let pid = 0;
    try {
      const { stdout } = await this.exec('tmux', ['display-message', '-p', '-t', sessionName, '#{pid}']);
      pid = parseInt(stdout.trim(), 10) || 0;
    } catch { /* tmux may not support display-message in all versions */ }

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
    const inputStr = typeof input === 'string' ? input : Buffer.from(input).toString();
    await this.exec('tmux', ['send-keys', '-t', s.tmuxSessionName, inputStr]);
    s.lastActivity = new Date();
  }

  async resize(sessionId: string, cols: number, rows: number): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error(`Session ${sessionId} not found`);
    await this.exec('tmux', ['resize-window', '-t', s.tmuxSessionName, '-x', String(cols), '-y', String(rows)]);
  }

  async killSession(sessionId: string): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error(`Session ${sessionId} not found`);
    await this.exec('tmux', ['kill-session', '-t', s.tmuxSessionName]);
    this.sessions.delete(sessionId);
  }

  async listSessions(): Promise<SessionInfo[]> {
    const { stdout } = await this.exec('tmux', ['list-sessions', '-F', '#{session_name},#{session_id},#{session_attached},#{session_created}']);
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