'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';

interface Spec {
  id: string; nnn: string; slug: string; variant: string; stack: string; status: string;
  dependsOn: string[]; content: string;
}

export default function SpecViewer() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;
  const nnn = params.nnn as string;
  const [spec, setSpec] = useState<Spec | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await fetch(`http://localhost:4000/projects/${projectId}/specs/${nnn}`).then(r => r.json());
      setSpec(data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [projectId, nnn]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="p-8 text-muted-foreground">Carregando...</div>;
  if (!spec) return <div className="p-8 text-muted-foreground">Spec nao encontrada.</div>;

  const statusColor = spec.status === 'ready' ? 'text-green-400' : spec.status === 'blocked' ? 'text-red-400' : 'text-muted-foreground';

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <button onClick={() => router.back()} className="text-xs text-muted-foreground hover:text-foreground mb-2 block">&larr; Voltar</button>
          <h1 className="text-2xl font-semibold">
            <span className="font-mono text-muted-foreground text-lg">{spec.nnn}</span> {spec.slug}
          </h1>
          <div className="flex gap-3 mt-2 text-xs">
            <span className="text-muted-foreground">{spec.variant}</span>
            <span className="text-muted-foreground">stack: {spec.stack}</span>
            <span className={statusColor}>{spec.status}</span>
          </div>
        </div>
      </div>

      {spec.dependsOn?.length > 0 && (
        <div className="mb-4 p-3 rounded-lg bg-muted/30 border border-border text-xs">
          <span className="text-muted-foreground">Depende de: </span>
          {spec.dependsOn.map(d => (
            <button key={d} onClick={() => router.push(`/projects/${projectId}/trilhas/${d}`)}
              className="text-primary hover:underline mx-1">{d}</button>
          ))}
        </div>
      )}

      <div className="prose prose-sm prose-invert max-w-none">
        <pre className="whitespace-pre-wrap font-mono text-sm bg-muted/50 p-6 rounded-lg border border-border overflow-x-auto">
          {spec.content || '(spec.md vazio)'}
        </pre>
      </div>
    </div>
  );
}
