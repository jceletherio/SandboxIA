'use client';

import { useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { acquireTerminalSocket, releaseTerminalSocket } from '@/lib/terminal-socket';

interface TerminalProps {
  sessionId: string;
  worktreePath: string;
  onClose?: () => void;
  /** Esconde o header interno (útil quando o tile já tem header próprio). */
  hideHeader?: boolean;
}

export function Terminal({ sessionId, worktreePath, onClose, hideHeader }: TerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminalIdRef = useRef<string>('');
  if (!terminalIdRef.current) {
    // crypto.randomUUID exige secure context (HTTPS/localhost); em HTTP puro
    // (IP da rede local, proxy sem TLS) o método não existe mesmo com `crypto` presente.
    terminalIdRef.current =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }
  const [connected, setConnected] = useState(false);
  const [tmuxSession, setTmuxSession] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  /** Ctrl "grudado": o próximo caractere digitado vira control char. */
  const [ctrlSticky, setCtrlSticky] = useState(false);
  const ctrlStickyRef = useRef(false);
  ctrlStickyRef.current = ctrlSticky;
  // Pontes para a barra de teclas do mobile alcançar o socket e o xterm, que
  // vivem dentro do efeito (e não podem virar estado sem remontar o terminal).
  const sendInputRef = useRef<((data: string) => void) | null>(null);
  const focusTerminalRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let mounted = true;
    let socket: Socket | null = null;
    let xterm: any = null;
    let fitAddon: any = null;
    let resizeObserver: ResizeObserver | null = null;
    let resizeDebounce: ReturnType<typeof setTimeout> | null = null;
    const handlers: Array<[string, (...args: any[]) => void]> = [];
    const terminalId = terminalIdRef.current;

    async function initTerminal() {
      if (!terminalRef.current) return;

      // Pacotes `@xterm/*`: os antigos `xterm`/`xterm-addon-*` foram
      // descontinuados pelo upstream. A versão 6 casa com o `@xterm/headless`
      // do backend de propósito — é o espelho de lá que gera o `serialize()`
      // reproduzido aqui no attach, e famílias diferentes poderiam divergir no
      // tratamento de escapes.
      const { Terminal: XTerm } = await import('@xterm/xterm');
      const { FitAddon } = await import('@xterm/addon-fit');
      const { WebLinksAddon } = await import('@xterm/addon-web-links');
      await import('@xterm/xterm/css/xterm.css');

      if (!mounted || !terminalRef.current) return;

      xterm = new XTerm({
        cursorBlink: true,
        // 12px no celular: com 14 sobravam ~30 colunas em 390px e qualquer CLI
        // quebrava linha no meio da palavra. 12 dá ~52, que é usável.
        fontSize: window.innerWidth < 1024 ? 12 : 14,
        fontFamily: 'JetBrains Mono, Fira Code, monospace',
        theme: {
          background: '#0d1117',
          foreground: '#c9d1d9',
          cursor: '#58a6ff',
          selectionBackground: '#264f78',
          black: '#0d1117',
          red: '#ff7b72',
          green: '#3fb950',
          yellow: '#d29922',
          blue: '#58a6ff',
          magenta: '#bc8cff',
          cyan: '#39c5cf',
          white: '#c9d1d9',
          brightBlack: '#484f58',
          brightRed: '#ffa198',
          brightGreen: '#56d364',
          brightYellow: '#e3b341',
          brightBlue: '#79c0ff',
          brightMagenta: '#d2a8ff',
          brightCyan: '#56d4dd',
          brightWhite: '#f0f6fc',
        },
      });

      fitAddon = new FitAddon();
      xterm.loadAddon(fitAddon);
      xterm.loadAddon(new WebLinksAddon());
      xterm.open(terminalRef.current);
      fitAddon.fit();

      socket = acquireTerminalSocket();

      const on = (event: string, handler: (...args: any[]) => void) => {
        socket!.on(event, handler);
        handlers.push([event, handler]);
      };

      const attach = () => {
        if (!mounted) return;
        fitAddon.fit();
        socket!.emit('createTerminal', {
          terminalId,
          sessionId,
          cols: xterm.cols,
          rows: xterm.rows,
        });
      };

      on('connect', () => {
        if (!mounted) return;
        setConnected(true);
        attach();
      });

      on('disconnect', () => {
        if (!mounted) return;
        setConnected(false);
        xterm.writeln('\r\n\x1b[31mDisconnected from terminal service\x1b[0m');
      });

      on('terminalReady', (msg: { terminalId: string; tmuxSession: string }) => {
        if (msg.terminalId !== terminalId || !mounted) return;
        setConnected(true);
        setErrorMsg(null);
        setTmuxSession(msg.tmuxSession);
      });

      on('terminalData', (msg: { terminalId: string; data: string }) => {
        if (msg.terminalId !== terminalId) return;
        xterm.write(msg.data);
      });

      on('terminalExit', (msg: { terminalId: string; exitCode: number }) => {
        if (msg.terminalId !== terminalId || !mounted) return;
        xterm.writeln(`\r\n\x1b[31mTerminal exited (code ${msg.exitCode})\x1b[0m`);
        setConnected(false);
      });

      on('terminalError', (msg: { terminalId: string; code: string; message: string }) => {
        if (msg.terminalId !== terminalId || !mounted) return;
        setConnected(false);
        setErrorMsg(msg.message);
        xterm.writeln(`\r\n\x1b[31m${msg.message}\x1b[0m`);
        // Sem linha extra para 'terminal_never_started': a mensagem do backend
        // já diz o que houve e para onde olhar. A dica genérica que existia
        // aqui ("finished or was not started yet") cobria os dois casos sem
        // decidir nenhum, e só somava ruído à tela de erro.
        if (msg.code === 'terminal_not_running') {
          xterm.writeln('\x1b[33mUse "Retry Stage" to start it again.\x1b[0m');
        }
      });

      const sendInput = (input: string) => {
        socket?.emit('terminalInput', { terminalId, input });
      };
      sendInputRef.current = sendInput;
      focusTerminalRef.current = () => xterm?.focus();

      xterm.onData((data: string) => {
        // Ctrl grudado: o teclado do celular não tem Ctrl, então a barra marca a
        // intenção e a próxima letra vira o control char (Ctrl-C, Ctrl-D,
        // Ctrl-R…). Um botão por combinação não caberia na tela.
        if (ctrlStickyRef.current && data.length === 1 && /[a-zA-Z]/.test(data)) {
          setCtrlSticky(false);
          sendInput(String.fromCharCode(data.toLowerCase().charCodeAt(0) - 96));
          return;
        }
        sendInput(data);
      });

      // Resize por container (tiles de grid mudam sem resize da janela)
      resizeObserver = new ResizeObserver(() => {
        if (resizeDebounce) clearTimeout(resizeDebounce);
        resizeDebounce = setTimeout(() => {
          if (!mounted || !fitAddon || !xterm) return;
          fitAddon.fit();
          socket?.emit('resizeTerminal', { terminalId, cols: xterm.cols, rows: xterm.rows });
        }, 100);
      });
      resizeObserver.observe(terminalRef.current);

      // Socket compartilhado pode já estar conectado — 'connect' não dispara de novo
      if (socket.connected) {
        setConnected(true);
        attach();
      }
    }

    void initTerminal();

    return () => {
      mounted = false;
      if (resizeDebounce) clearTimeout(resizeDebounce);
      resizeObserver?.disconnect();
      if (socket) {
        socket.emit('closeTerminal', { terminalId });
        for (const [event, handler] of handlers) {
          socket.off(event, handler);
        }
        releaseTerminalSocket();
        socket = null;
      }
      sendInputRef.current = null;
      focusTerminalRef.current = null;
      xterm?.dispose();
      xterm = null;
      fitAddon = null;
    };
  }, [sessionId]);

  return (
    <div className="flex flex-col h-full w-full bg-[#0d1117]">
      {!hideHeader && (
        <div className="flex items-center justify-between px-4 py-2 bg-[#161b22] border-b border-border">
          <div className="flex items-center gap-2">
            <div
              className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500 animate-pulse' : errorMsg ? 'bg-red-500' : 'bg-yellow-500'}`}
            />
            <span className="text-xs font-mono text-foreground">
              {connected
                ? `Connected to ${tmuxSession || 'tmux'}`
                : errorMsg || 'Connecting...'}
            </span>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Close
            </button>
          )}
        </div>
      )}
      <div ref={terminalRef} className="flex-1 p-2 min-h-0" />
      <TerminalKeyBar
        ctrlSticky={ctrlSticky}
        onToggleCtrl={() => setCtrlSticky((current) => !current)}
        onSend={(data) => {
          sendInputRef.current?.(data);
          // Devolve o foco: senão o próximo caractere digitado no teclado
          // virtual não chega ao terminal.
          focusTerminalRef.current?.();
        }}
        onFocus={() => focusTerminalRef.current?.()}
      />
    </div>
  );
}

/** Teclas que o teclado virtual do celular não tem, e sem as quais um CLI não anda. */
const KEYS: Array<{ label: string; seq: string; title: string }> = [
  { label: 'Esc', seq: '\x1b', title: 'Escape' },
  { label: 'Tab', seq: '\t', title: 'Tab / completar' },
  { label: '↑', seq: '\x1b[A', title: 'Seta acima (histórico)' },
  { label: '↓', seq: '\x1b[B', title: 'Seta abaixo' },
  { label: '←', seq: '\x1b[D', title: 'Seta esquerda' },
  { label: '→', seq: '\x1b[C', title: 'Seta direita' },
  { label: '^C', seq: '\x03', title: 'Ctrl-C — interromper' },
  { label: '|', seq: '|', title: 'Pipe' },
  { label: '/', seq: '/', title: 'Barra' },
  { label: '-', seq: '-', title: 'Hífen' },
  { label: '~', seq: '~', title: 'Home' },
];

/**
 * Barra de teclas — só mobile (`lg:hidden`).
 *
 * Sem isso o terminal no celular é read-only na prática: não há Esc, Tab, setas
 * nem Ctrl no teclado virtual, e são exatamente as teclas que um CLI
 * interativo (o caso de uso do orquestrador) exige.
 */
function TerminalKeyBar({
  ctrlSticky,
  onToggleCtrl,
  onSend,
  onFocus,
}: {
  ctrlSticky: boolean;
  onToggleCtrl: () => void;
  onSend: (data: string) => void;
  onFocus: () => void;
}) {
  return (
    <div className="lg:hidden shrink-0 border-t border-border bg-[#161b22]">
      <div className="flex items-center gap-1 px-2 py-1.5 overflow-x-auto">
        <button
          onClick={onFocus}
          className="shrink-0 min-w-11 h-9 px-2.5 rounded-md bg-primary/15 text-primary text-[11px] font-mono active:bg-primary/25"
          title="Abrir o teclado do celular"
        >
          ⌨
        </button>
        <button
          onClick={onToggleCtrl}
          aria-pressed={ctrlSticky}
          className={`shrink-0 min-w-11 h-9 px-2.5 rounded-md text-[11px] font-mono transition-colors ${
            ctrlSticky
              ? 'bg-primary text-primary-foreground'
              : 'bg-white/5 text-[#c9d1d9] active:bg-white/10'
          }`}
          title="Ctrl grudado: a próxima letra vira Ctrl-<letra>"
        >
          Ctrl
        </button>
        {KEYS.map((key) => (
          <button
            key={key.label}
            onClick={() => onSend(key.seq)}
            title={key.title}
            // min-w-11/h-9 ≈ 44px de alvo com a borda — abaixo disso o toque erra.
            className="shrink-0 min-w-11 h-9 px-2.5 rounded-md bg-white/5 text-[#c9d1d9] text-[11px] font-mono active:bg-white/10 transition-colors"
          >
            {key.label}
          </button>
        ))}
      </div>
    </div>
  );
}
