import { ITerminalProvider } from './terminal-provider.interface';
import { TmuxProvider } from './tmux-provider';
import { ItmuxProvider } from './itmux-provider';
import { ConptyProvider } from './conpty-provider';

/**
 * Detects the best available terminal provider on the current system and
 * returns a single instance.
 *
 * Priority:
 *   1. tmux (Linux/macOS, or Windows with WSL/Git Bash)
 *   2. itmux (Windows native tmux via Cygwin — https://itefix.net/itmux)
 *   3. ConPTY (Windows 10 1809+ fallback — no multiplexing)
 */
export async function createTerminalProvider(): Promise<ITerminalProvider> {
  const terminalProviderEnv = (process.env.TERMINAL_PROVIDER || 'auto').toLowerCase();

  if (terminalProviderEnv !== 'auto') {
    return instantiateByName(terminalProviderEnv);
  }

  // Auto-detect: try in priority order
  const candidates = [new TmuxProvider(), new ItmuxProvider(), new ConptyProvider()];
  for (const c of candidates) {
    if (await c.isAvailable()) {
      return c;
    }
  }

  throw new Error(
    'No terminal provider available. Install tmux (Linux/macOS) or itmux (https://itefix.net/itmux) on Windows. ' +
    'ConPTY fallback requires Windows 10 1809+ and node-pty installed.'
  );
}

async function instantiateByName(name: string): Promise<ITerminalProvider> {
  switch (name) {
    case 'tmux':  return new TmuxProvider();
    case 'itmux': return new ItmuxProvider();
    case 'conpty': return new ConptyProvider();
    default: throw new Error(`Unknown terminal provider: ${name}. Use tmux, itmux, conpty, or auto.`);
  }
}