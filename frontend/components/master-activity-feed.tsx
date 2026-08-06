'use client';

import { useEffect, useRef, useState } from 'react';
import { masterAgentApi, type MasterActivityRun } from '@/lib/api';
import { useGlobalSSE, type SseEvent } from '@/lib/use-sse';

interface MasterActivityFeedProps {
  className?: string;
}

function timeOf(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}

/**
 * Painel read-only estilo terminal com as execuções do Master Agent
 * (triagens e chat) em tempo real: snapshot via GET /master-agent/activity +
 * eventos SSE `master:activity` mesclados por runId.
 */
export function MasterActivityFeed({ className }: MasterActivityFeedProps) {
  const [runs, setRuns] = useState<MasterActivityRun[]>([]);
  const [loaded, setLoaded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    masterAgentApi
      .getActivity()
      .then((data) => setRuns(data.runs || []))
      .catch((error) => console.error('Failed to load master activity:', error))
      .finally(() => setLoaded(true));
  }, []);

  useGlobalSSE((event: SseEvent) => {
    if (event.type !== 'master:activity') return;
    const ev = event.data;
    setRuns((prev) => {
      if (ev.phase === 'start') {
        if (prev.some((r) => r.runId === ev.runId)) return prev;
        const next = [
          ...prev,
          {
            runId: ev.runId,
            kind: ev.kind,
            questionId: ev.questionId,
            promptPreview: ev.promptPreview || '',
            startedAt: ev.ts,
            output: '',
          } as MasterActivityRun,
        ];
        return next.slice(-50);
      }
      return prev.map((run) => {
        if (run.runId !== ev.runId) return run;
        if (ev.phase === 'chunk' && ev.chunk) {
          return { ...run, output: (run.output + ev.chunk).slice(-64_000) };
        }
        if (ev.phase === 'end') {
          return {
            ...run,
            endedAt: ev.ts,
            exitCode: ev.exitCode,
            result: ev.result,
            action: ev.action,
            error: ev.error,
          };
        }
        return run;
      });
    });
  });

  // Auto-scroll só quando o usuário já está no fundo (não rouba o scroll)
  useEffect(() => {
    const el = containerRef.current;
    if (el && stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [runs]);

  const onScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  return (
    <div
      ref={containerRef}
      onScroll={onScroll}
      className={`bg-[#0d1117] font-mono text-xs overflow-y-auto p-3 space-y-3 ${className || ''}`}
    >
      {!loaded ? (
        <p className="text-[#8b949e]">Loading activity...</p>
      ) : runs.length === 0 ? (
        <div className="text-[#8b949e]">
          <p>No activity yet.</p>
          <p className="mt-1 text-[10px]">
            Triage runs and chat replies will stream here in real time.
          </p>
        </div>
      ) : (
        runs.map((run) => (
          <div key={run.runId} className="border-b border-[#21262d] pb-2 last:border-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[#8b949e]">[{timeOf(run.startedAt)}]</span>
              <span
                className={
                  run.kind === 'triage'
                    ? 'text-[#d29922]'
                    : run.kind === 'health'
                      ? 'text-[#3fb950]'
                      : 'text-[#58a6ff]'
                }
              >
                ▶ {run.kind.toUpperCase()}
              </span>
              {run.questionId && (
                <span className="text-[#8b949e]">q={run.questionId.slice(0, 8)}</span>
              )}
              <span className="text-[#c9d1d9] truncate max-w-[50ch]" title={run.promptPreview}>
                {run.promptPreview.replace(/\s+/g, ' ').slice(0, 80)}…
              </span>
            </div>
            {run.output && (
              <pre className="whitespace-pre-wrap break-all text-[#c9d1d9] mt-1 max-h-48 overflow-y-auto">
                {run.output}
              </pre>
            )}
            <div className="mt-1">
              {run.error ? (
                <span className="text-[#ff7b72]">✗ error: {run.error}</span>
              ) : run.endedAt ? (
                <span
                  className={
                    run.action === 'answer'
                      ? 'text-[#3fb950]'
                      : run.action === 'escalate'
                        ? 'text-[#d29922]'
                        : 'text-[#3fb950]'
                  }
                >
                  ✓ {run.action ? `${run.action === 'answer' ? 'auto-answered' : 'escalated'}` : 'done'}
                  {typeof run.exitCode === 'number' ? ` (exit ${run.exitCode})` : ''}
                  {run.result ? ` — ${run.result.slice(0, 120)}` : ''}
                </span>
              ) : (
                <span className="text-[#58a6ff] animate-pulse">… running</span>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
