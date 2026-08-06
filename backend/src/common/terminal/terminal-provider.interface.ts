/**
 * Terminal provider abstraction layer.
 * 
 * Detects the best available terminal provider on the current OS:
 * - Linux/macOS: tmux (native)
 * - Windows: itmux (Cygwin tmux) or ConPTY fallback
 * 
 * All providers implement ITerminalProvider, allowing the rest of the
 * application to be OS-agnostic.
 */

export interface CreateSessionOptions {
  cwd: string;
  env?: Record<string, string>;
  initialCommand?: string;
  name?: string;
  cols?: number;
  rows?: number;
  sessionEnv?: Record<string, string>;
}

export interface SessionResult {
  sessionId: string;
  pid: number;
  tmuxSessionName?: string;
}

export interface AttachResult {
  wsUrl: string;
  sessionId: string;
}

export interface SessionInfo {
  sessionId: string;
  name?: string;
  cwd: string;
  status: 'active' | 'idle' | 'dead';
  pid?: number;
  tmuxSessionName?: string;
  createdAt: Date;
  lastActivity: Date;
}

export interface ITerminalProvider {
  createSession(options: CreateSessionOptions): Promise<SessionResult>;
  attachSession(sessionId: string): Promise<AttachResult>;
  sendInput(sessionId: string, input: string | Uint8Array): Promise<void>;
  resize(sessionId: string, cols: number, rows: number): Promise<void>;
  killSession(sessionId: string): Promise<void>;
  listSessions(): Promise<SessionInfo[]>;
  getProviderName(): string;
  isAvailable(): Promise<boolean>;
}