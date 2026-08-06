'use client';

import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Shell } from '@/components/shell';
import { Terminal } from '@/components/terminal';
import { ChatPanel, type ChatMessageView } from '@/components/chat';
import { useProject } from '@/lib/project-context';
import { useGlobalSSE, type SseEvent } from '@/lib/use-sse';
import { isSessionAlive } from '@/lib/status';
import { masterAgentApi, sessionsApi, terminalApi, type Session, type TmuxSessionInfo } from '@/lib/api';
import {
  Terminal as TerminalIcon,
  Bot,
  AlertCircle,
  Maximize2,
  Minimize2,
  Plug,
  MessageSquare,
} from 'lucide-react';

const STATUS_DOT: Record<string, string> = {
  running: 'bg-green-500 animate-pulse',
  waiting: 'bg-yellow-500',
  paused: 'bg-gray-400',
  initializing: 'bg-blue-500 animate-pulse',
};

/** ISO do backend → hora curta (o ChatMessageView recebe o `time` pronto). */
function formatChatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function TerminalContent() {
  const { currentProject } = useProject();
  const searchParams = useSearchParams();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [masterStatus, setMasterStatus] = useState<{ isActive: boolean; projectId: string | null }>(
    { isActive: false, projectId: null },
  );
  const [loading, setLoading] = useState(true);
  // id da sessão maximizada ('master' para o tile do Master Agent,
  // 'external:<nome>' para tmux externas)
  const [focusedId, setFocusedId] = useState<string | null>(null);
  // tmux sessions da máquina não gerenciadas pelo orquestrador
  const [externalTmux, setExternalTmux] = useState<TmuxSessionInfo[]>([]);
  // nomes de tmux externas com terminal aberto na UI
  const [openExternal, setOpenExternal] = useState<Set<string>>(new Set());
  // --- chat por sessão (P3.1): tudo indexado por sessionId, nunca compartilhado
  const [openChats, setOpenChats] = useState<Set<string>>(new Set());
  const [chatMessages, setChatMessages] = useState<Record<string, ChatMessageView[]>>({});
  const [chatInput, setChatInput] = useState<Record<string, string>>({});
  const [chatSending, setChatSending] = useState<Record<string, boolean>>({});
  // timeout de segurança por sessão (resposta via reply_chat pode demorar)
  const chatTimeouts = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const fetchData = useCallback(async () => {
    try {
      const [sessionsData, status, tmuxData] = await Promise.all([
        sessionsApi.list(currentProject ? { projectId: currentProject.id } : undefined),
        masterAgentApi.getStatus(currentProject?.id),
        terminalApi.listTmuxSessions().catch(() => ({ sessions: [] as TmuxSessionInfo[] })),
      ]);
      setSessions(sessionsData);
      setMasterStatus({ isActive: status.isActive, projectId: status.projectId });
      setExternalTmux(tmuxData.sessions.filter((t) => !t.managed));
    } catch (error) {
      console.error('Failed to fetch data:', error);
    } finally {
      setLoading(false);
    }
  }, [currentProject]);

  useEffect(() => {
    setLoading(true);
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // `paused` entra: a sessão não terminou e o tile dela ainda tem histórico útil.
  const liveSessions = sessions.filter((s) => isSessionAlive(s.status));
  const showMasterTile = masterStatus.isActive;

  // Deep-link: /terminal?agentId=<id> ou ?session=<id> maximiza o tile alvo
  const appliedDeepLink = useRef(false);
  useEffect(() => {
    if (appliedDeepLink.current || loading) return;
    const agentId = searchParams.get('agentId');
    const sessionId = searchParams.get('session');
    if (!agentId && !sessionId) return;
    const target = liveSessions.find(
      (s) => (sessionId && s.id === sessionId) || (agentId && s.agentId === agentId),
    );
    if (target) setFocusedId(target.id);
    appliedDeepLink.current = true;
  }, [loading, liveSessions, searchParams]);

  const loadChat = useCallback(async (sessionId: string) => {
    try {
      const history = await sessionsApi.getChat(sessionId);
      setChatMessages((prev) => ({
        ...prev,
        [sessionId]: history.map((msg) => ({
          id: msg.id,
          role: msg.role,
          content: msg.content,
          time: formatChatTime(msg.time),
          type: 'normal' as const,
        })),
      }));
    } catch (error) {
      console.error('Failed to load session chat:', error);
    }
  }, []);

  const clearChatTimeout = useCallback((sessionId: string) => {
    const timer = chatTimeouts.current[sessionId];
    if (timer) {
      clearTimeout(timer);
      delete chatTimeouts.current[sessionId];
    }
  }, []);

  // O chat só cabe com o tile maximizado (o grid solto tem 340px de altura).
  const toggleChat = useCallback(
    (sessionId: string) => {
      if (openChats.has(sessionId)) {
        setOpenChats((prev) => {
          const next = new Set(prev);
          next.delete(sessionId);
          return next;
        });
        return;
      }
      setOpenChats((prev) => new Set(prev).add(sessionId));
      setFocusedId(sessionId);
      loadChat(sessionId);
    },
    [openChats, loadChat],
  );

  const sendChat = useCallback(
    async (sessionId: string) => {
      const content = (chatInput[sessionId] || '').trim();
      if (!content || chatSending[sessionId]) return;

      setChatInput((prev) => ({ ...prev, [sessionId]: '' }));
      setChatSending((prev) => ({ ...prev, [sessionId]: true }));
      // eco otimista: a mensagem já foi gravada no backend, mas o refetch só
      // vem com o SSE — sem isto a caixa parece engolir o texto
      setChatMessages((prev) => ({
        ...prev,
        [sessionId]: [
          ...(prev[sessionId] || []),
          {
            id: `local-${Date.now()}`,
            role: 'user',
            content,
            time: formatChatTime(new Date().toISOString()),
            type: 'normal',
          },
        ],
      }));

      try {
        const res = await sessionsApi.sendChat(sessionId, content);
        if (res.response) {
          // sessão morta: o backend já gravou a resposta explicando
          await loadChat(sessionId);
          setChatSending((prev) => ({ ...prev, [sessionId]: false }));
        } else {
          // enfileirado no pane tmux — a resposta chega via SSE (reply_chat)
          clearChatTimeout(sessionId);
          chatTimeouts.current[sessionId] = setTimeout(
            () => {
              delete chatTimeouts.current[sessionId];
              setChatSending((prev) => ({ ...prev, [sessionId]: false }));
              loadChat(sessionId);
            },
            5 * 60 * 1000,
          );
        }
      } catch (error: any) {
        setChatSending((prev) => ({ ...prev, [sessionId]: false }));
        setChatMessages((prev) => ({
          ...prev,
          [sessionId]: [
            ...(prev[sessionId] || []),
            {
              id: `error-${Date.now()}`,
              role: 'agent',
              content: `Failed to send: ${error?.message || 'unknown error'}`,
              time: formatChatTime(new Date().toISOString()),
              type: 'status',
            },
          ],
        }));
      }
    },
    [chatInput, chatSending, loadChat, clearChatTimeout],
  );

  // Resposta do agente (reply_chat) e eco da própria mensagem chegam por
  // `session:chat`, que carrega `sessionId` — recarrega só o chat daquela sessão.
  useGlobalSSE(
    (event: SseEvent) => {
      if (event.type !== 'session:chat') return;
      const sessionId = event.data?.sessionId;
      if (!sessionId || !openChats.has(sessionId)) return;
      loadChat(sessionId);
      if (event.data?.role === 'agent') {
        clearChatTimeout(sessionId);
        setChatSending((prev) => ({ ...prev, [sessionId]: false }));
      }
    },
    true,
    currentProject?.id,
  );

  useEffect(() => {
    const timers = chatTimeouts.current;
    return () => {
      for (const timer of Object.values(timers)) clearTimeout(timer);
    };
  }, []);

  if (loading) {
    return (
      <Shell>
        <div className="flex items-center justify-center h-full">
          <div className="text-sm text-muted-foreground">Loading terminals...</div>
        </div>
      </Shell>
    );
  }

  const focusButton = (id: string) => (
    <button
      onClick={() => setFocusedId(focusedId === id ? null : id)}
      className="text-muted-foreground hover:text-foreground transition-colors"
      title={focusedId === id ? 'Restore grid' : 'Maximize'}
    >
      {focusedId === id ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
    </button>
  );

  const masterTile = showMasterTile && (
    <div
      key="master"
      className={`flex flex-col rounded-lg border border-primary/30 overflow-hidden bg-[#0d1117] ${
        focusedId === 'master' ? 'col-span-full row-span-full' : ''
      }`}
    >
      <div className="flex items-center justify-between px-3 py-2 bg-[#161b22] border-b border-border">
        <div className="flex items-center gap-2 min-w-0">
          <Bot className="w-3.5 h-3.5 text-primary shrink-0" />
          <span className="text-xs font-mono text-primary">Master Agent</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
            interactive CLI
          </span>
        </div>
        {focusButton('master')}
      </div>
      <div className="flex-1 min-h-0">
        {/* MT-20: tmux por projeto — sem o id, `resolveMasterSession` só acha
            sozinho quando há exatamente um Master ativo na máquina inteira. */}
        <Terminal
          sessionId={masterStatus.projectId ? `master:${masterStatus.projectId}` : 'master'}
          worktreePath=""
          hideHeader
        />
      </div>
    </div>
  );

  const sessionTiles = liveSessions.map((session) => {
    const chatOpen = openChats.has(session.id);
    return (
      <div
        key={session.id}
        className={`flex flex-col rounded-lg border border-border overflow-hidden bg-[#0d1117] ${
          focusedId === session.id ? 'col-span-full row-span-full' : ''
        }`}
      >
        <div className="flex items-center justify-between px-3 py-2 bg-[#161b22] border-b border-border">
          <div className="flex items-center gap-2 min-w-0">
            <div
              className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[session.status] || 'bg-gray-500'}`}
            />
            <span className="text-xs font-mono text-foreground shrink-0">
              {session.id.slice(0, 8)}
            </span>
            <span className="text-[10px] text-muted-foreground truncate">{session.branchName}</span>
            {session.currentStage && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted/40 text-muted-foreground shrink-0">
                {session.currentStage}
              </span>
            )}
            <span className="text-[10px] text-muted-foreground shrink-0">{session.status}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => toggleChat(session.id)}
              className={`transition-colors ${
                chatOpen ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
              }`}
              title={chatOpen ? 'Close session chat' : 'Chat with this session agent'}
            >
              <MessageSquare className="w-3.5 h-3.5" />
            </button>
            {focusButton(session.id)}
          </div>
        </div>
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
          <div className="flex-1 min-h-0 min-w-0">
            <Terminal sessionId={session.id} worktreePath={session.worktreePath} hideHeader />
          </div>
          {chatOpen && (
            <div className="w-full lg:w-[420px] shrink-0 min-h-[320px] lg:min-h-0 border-t lg:border-t-0 lg:border-l border-border bg-background flex flex-col">
              <ChatPanel
                messages={chatMessages[session.id] || []}
                input={chatInput[session.id] || ''}
                onInputChange={(value) =>
                  setChatInput((prev) => ({ ...prev, [session.id]: value }))
                }
                onSend={() => sendChat(session.id)}
                sending={!!chatSending[session.id]}
                variant="mobile"
                header={
                  <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-card/30 shrink-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <MessageSquare className="w-3.5 h-3.5 text-primary shrink-0" />
                      <span className="text-xs font-medium text-foreground">Session chat</span>
                      <span className="text-[10px] font-mono text-muted-foreground truncate">
                        {session.id.slice(0, 8)}
                      </span>
                    </div>
                    <button
                      onClick={() => toggleChat(session.id)}
                      className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Close
                    </button>
                  </div>
                }
                emptyLabel="Talk to the agent running this session"
                placeholder={
                  chatSending[session.id]
                    ? 'Waiting for the agent to reply...'
                    : 'Ask this session agent something...'
                }
                pendingContent={
                  <p className="text-xs text-muted-foreground">
                    Prompt sent to the tmux pane — the reply arrives when the agent calls reply_chat.
                  </p>
                }
              />
            </div>
          )}
        </div>
      </div>
    );
  });

  // Tiles de tmux externas ABERTAS pelo usuário (attach sob demanda)
  const externalTiles = externalTmux
    .filter((t) => openExternal.has(t.name))
    .map((t) => {
      const id = `external:${t.name}`;
      return (
        <div
          key={id}
          className={`flex flex-col rounded-lg border border-dashed border-border overflow-hidden bg-[#0d1117] ${
            focusedId === id ? 'col-span-full row-span-full' : ''
          }`}
        >
          <div className="flex items-center justify-between px-3 py-2 bg-[#161b22] border-b border-border">
            <div className="flex items-center gap-2 min-w-0">
              <Plug className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <span className="text-xs font-mono text-foreground truncate">{t.name}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted/40 text-muted-foreground shrink-0">
                external tmux
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => {
                  setOpenExternal((prev) => {
                    const next = new Set(prev);
                    next.delete(t.name);
                    return next;
                  });
                  if (focusedId === id) setFocusedId(null);
                }}
                className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              >
                Close
              </button>
              {focusButton(id)}
            </div>
          </div>
          <div className="flex-1 min-h-0">
            <Terminal sessionId={id} worktreePath="" hideHeader />
          </div>
        </div>
      );
    });

  // Com um tile maximizado, esconde os demais (mantém montado só o focado
  // para não pagar attach de PTY à toa)
  const tiles = focusedId
    ? [masterTile, ...sessionTiles, ...externalTiles].filter(
        (tile: any) => tile && tile.key === focusedId,
      )
    : [masterTile, ...sessionTiles, ...externalTiles].filter(Boolean);

  return (
    <Shell>
      <div className="flex flex-col h-full">
        <header className="flex items-center justify-between px-4 lg:px-6 py-3 border-b border-border bg-card/50 sticky top-0 z-10">
          <div>
            <h1 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <TerminalIcon className="w-4 h-4" />
              Terminals
            </h1>
            <p className="text-[11px] text-muted-foreground font-mono mt-0.5">
              {liveSessions.length} live session{liveSessions.length === 1 ? '' : 's'}
              {currentProject ? ` — ${currentProject.name}` : ''}
              {showMasterTile ? ' + master agent' : ''}
              {externalTmux.length > 0
                ? ` · ${externalTmux.length} external tmux`
                : ''}
            </p>
          </div>
          {masterStatus.isActive && (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-primary/10 border border-primary/20">
              <Bot className="w-3.5 h-3.5 text-primary" />
              <span className="text-[10px] font-mono text-primary">Master Agent Active</span>
            </div>
          )}
        </header>

        {externalTmux.length > 0 && !focusedId && (
          <div className="px-4 lg:px-6 py-2 border-b border-border bg-muted/10">
            <p className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-1.5">
              Terminais externos (tmux fora do orquestrador)
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              {externalTmux.map((t) => {
                const isOpen = openExternal.has(t.name);
                return (
                  <button
                    key={t.name}
                    onClick={() =>
                      setOpenExternal((prev) => {
                        const next = new Set(prev);
                        if (next.has(t.name)) next.delete(t.name);
                        else next.add(t.name);
                        return next;
                      })
                    }
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-mono border transition-colors ${
                      isOpen
                        ? 'bg-primary/10 border-primary/30 text-primary'
                        : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted/40'
                    }`}
                    title={
                      t.createdAt
                        ? `Criada em ${new Date(t.createdAt).toLocaleString()}${t.attached ? ' · attached' : ''}`
                        : undefined
                    }
                  >
                    <Plug className="w-3 h-3" />
                    {t.name}
                    {t.attached && <span className="w-1.5 h-1.5 rounded-full bg-green-500" />}
                    <span className="text-[9px] text-muted-foreground">
                      {isOpen ? 'fechar' : 'abrir'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {tiles.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <AlertCircle className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No live terminals</p>
              <p className="text-xs text-muted-foreground mt-1.5">
                Run a macro task (Macro Tasks → Run), activate the Master Agent
                {externalTmux.length > 0 ? ' or open an external tmux above' : ''}
              </p>
            </div>
          </div>
        ) : (
          <div
            className={`flex-1 min-h-0 overflow-y-auto p-3 grid gap-3 ${
              focusedId
                ? 'grid-cols-1 auto-rows-fr'
                : // No mobile cada tile ocupa ~70% da tela e a navegação entre
                  // terminais é a rolagem vertical: com 340px sobravam ~15
                  // linhas depois do header e da barra de teclas, e um CLI
                  // interativo não cabe nisso.
                  'grid-cols-1 auto-rows-[minmax(70dvh,1fr)] xl:grid-cols-2 xl:auto-rows-[minmax(340px,1fr)] 2xl:grid-cols-3'
            }`}
          >
            {tiles}
          </div>
        )}
      </div>
    </Shell>
  );
}

export default function TerminalPage() {
  return (
    <Suspense
      fallback={
        <Shell>
          <div className="flex items-center justify-center h-full">
            <div className="text-sm text-muted-foreground">Loading terminals...</div>
          </div>
        </Shell>
      }
    >
      <TerminalContent />
    </Suspense>
  );
}
