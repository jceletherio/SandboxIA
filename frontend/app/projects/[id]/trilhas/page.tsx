'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';

interface Spec {
  id: string; nnn: string; slug: string; variant: string; stack: string; status: string; dependsOn: string[];
}

const STACK_COLORS: Record<string, string> = {
  angular: 'bg-red-500/10 text-red-400 border-red-500/30',
  nodejs: 'bg-green-500/10 text-green-400 border-green-500/30',
  spring: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  go: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30',
  postgres: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
  multi: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
};

export default function TrilhaBoard() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;
  const [specs, setSpecs] = useState<Spec[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await fetch(`http://localhost:4000/projects/${projectId}/specs`).then(r => r.json());
      setSpecs(Array.isArray(data) ? data : []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const moveCard = async (nnn: string, status: string) => {
    try {
      await fetch(`http://localhost:4000/projects/${projectId}/specs/${nnn}/status`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
      });
      setSpecs(prev => prev.map(s => s.nnn === nnn ? { ...s, status } : s));
    } catch (e) { console.error(e); }
  };

  if (loading) return <div className="p-8 text-muted-foreground">Carregando...</div>;

  const cols = { open: 'Abertas', blocked: 'Bloqueadas', ready: 'Prontas' };

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <h1 className="text-2xl font-semibold mb-6">Trilhas SDD</h1>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {Object.entries(cols).map(([status, label]) => {
          const items = specs.filter(s => s.status === status);
          return (
            <div key={status} className="rounded-lg bg-muted/30 border border-border p-3 min-h-[200px]">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm uppercase tracking-widest text-muted-foreground">{label}</h2>
                <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{items.length}</span>
              </div>
              <div className="space-y-2">
                {items.map(s => (
                  <div
                    key={s.nnn}
                    onClick={() => router.push(`/projects/${projectId}/trilhas/${s.nnn}`)}
                    className="p-3 rounded-lg bg-card border border-border cursor-pointer hover:border-primary/50 transition-colors"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-mono font-semibold">{s.nnn}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${STACK_COLORS[s.stack] || 'bg-muted'}`}>
                        {s.stack}
                      </span>
                    </div>
                    <div className="text-sm font-medium truncate">{s.slug}</div>
                    <div className="text-[10px] text-muted-foreground mt-1">{s.variant}</div>
                    {s.dependsOn?.length > 0 && (
                      <div className="text-[10px] text-muted-foreground mt-2">depende: {s.dependsOn.join(', ')}</div>
                    )}
                    {status === 'open' && (
                      <button
                        onClick={(e) => { e.stopPropagation(); moveCard(s.nnn, 'ready'); }}
                        className="mt-2 text-[10px] px-2 py-1 rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors w-full"
                      >
                        Marcar pronto
                      </button>
                    )}
                    {status === 'ready' && (
                      <button
                        onClick={(e) => { e.stopPropagation(); moveCard(s.nnn, 'open'); }}
                        className="mt-2 text-[10px] px-2 py-1 rounded bg-muted hover:bg-muted/80 transition-colors w-full"
                      >
                        Reabrir
                      </button>
                    )}
                  </div>
                ))}
                {items.length === 0 && <div className="text-xs text-muted-foreground text-center py-6">Vazio</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
