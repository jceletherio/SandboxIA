'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';

interface HealthCheck {
  id: string;
  version: number;
  score: number;
  verdict: string;
  context: string;
  findings: Finding[];
  recommendations: string[];
  dimensions: Record<string, any>;
  checkedAt: string;
  snapshotPath?: string;
  docHash?: string;
}

interface Finding {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  dimension: string;
  evidence: string;
  fix: string;
}

interface HealthHistory {
  id: string;
  version: number;
  score: number;
  verdict: string;
  checkedAt: string;
}

export default function RequirementsDashboard() {
  const params = useParams();
  const projectId = params.id as string;
  const [health, setHealth] = useState<HealthCheck | null>(null);
  const [history, setHistory] = useState<HealthHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [checking, setChecking] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadData = useCallback(async () => {
    try {
      const [h, hist] = await Promise.all([
        api.get<any>(`/projects/${projectId}/requirements/health`),
        api.get<any[]>(`/projects/${projectId}/requirements/health`),
      ]);
      const latest = Array.isArray(hist) && hist.length > 0 ? await api.get<HealthCheck>(`/projects/${projectId}/requirements/health/${hist[0].version}`) : null;
      setHealth(latest);
      setHistory(Array.isArray(hist) ? hist : []);
    } catch (e) {
      console.error('Failed to load health data:', e);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/projects/${projectId}/requirements/upload`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      setHealth(data.healthCheck);
      loadData();
    } catch (err) {
      console.error('Upload failed:', err);
    } finally {
      setUploading(false);
    }
  };

  const handleDoctor = async () => {
    setChecking(true);
    try {
      const res = await (api as any).post?.(`/projects/${projectId}/requirements/doctor`, {});
      if (res) {
        setHealth(res);
        loadData();
      }
    } catch (err) {
      console.error('Health check failed:', err);
    } finally {
      setChecking(false);
    }
  };

  if (loading) return <div className="p-8 text-muted-foreground">Carregando...</div>;

  const scoreColor = health?.verdict === 'healthy' ? 'text-green-400' :
    health?.verdict === 'needs_revision' ? 'text-yellow-400' : 'text-red-400';

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold mb-1">Requisitos</h1>
          <p className="text-xs text-muted-foreground">Health check + upload + historico</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="px-3 py-2 rounded-lg border border-border text-xs font-medium hover:bg-muted transition-colors disabled:opacity-50"
          >
            {uploading ? 'Enviando...' : 'Upload .docx/.pdf'}
          </button>
          <input ref={fileRef} type="file" accept=".docx,.pdf,.md,.txt" className="hidden" onChange={handleUpload} />
          <button
            onClick={handleDoctor}
            disabled={checking}
            className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {checking ? 'Verificando...' : 'Rodar Doctor'}
          </button>
        </div>
      </div>

      {/* Score Gauge */}
      {health && (
        <div className="mb-6 p-6 rounded-lg bg-muted/50 border border-border text-center">
          <div className="text-5xl font-bold mb-2">
            <span className={scoreColor}>{health.score}</span>
            <span className="text-muted-foreground text-2xl">/100</span>
          </div>
          <div className={`text-sm font-semibold ${scoreColor}`}>
            {health.verdict === 'healthy' ? 'Saudavel' : health.verdict === 'needs_revision' ? 'Precisa de revisao' : 'Bloqueado'}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            v{health.version} · {new Date(health.checkedAt).toLocaleString()} · {health.context}
          </div>
        </div>
      )}

      {/* Findings */}
      {health?.findings && health.findings.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm uppercase tracking-widest text-muted-foreground mb-3">Findings ({health.findings.length})</h2>
          <div className="space-y-2">
            {['critical', 'high', 'medium', 'low'].map(sev => {
              const grouped = health.findings.filter(f => f.severity === sev);
              if (grouped.length === 0) return null;
              return (
                <div key={sev} className="p-3 rounded-lg bg-muted/50 border border-border">
                  <div className={`text-xs font-semibold mb-2 ${
                    sev === 'critical' ? 'text-red-400' : sev === 'high' ? 'text-orange-400' : sev === 'medium' ? 'text-yellow-400' : 'text-blue-400'
                  }`}>
                    {sev.toUpperCase()} ({grouped.length})
                  </div>
                  {grouped.map(f => (
                    <div key={f.id} className="text-xs mb-2 pl-2 border-l-2 border-muted-foreground/30">
                      <div className="font-medium">{f.id} <span className="text-muted-foreground">({f.dimension})</span></div>
                      <div className="text-muted-foreground mt-0.5">{f.evidence}</div>
                      <div className="text-primary/70 mt-0.5">Fix: {f.fix}</div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Recommendations */}
      {health?.recommendations && health.recommendations.length > 0 && (
        <div className="mb-6 p-4 rounded-lg bg-primary/5 border border-primary/20">
          <h3 className="text-sm font-semibold mb-2">Recomendacoes</h3>
          <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-4">
            {health.recommendations.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </div>
      )}

      {/* History Timeline */}
      {history.length > 0 && (
        <div>
          <h2 className="text-sm uppercase tracking-widest text-muted-foreground mb-3">Historico ({history.length})</h2>
          <div className="space-y-1">
            {history.map(h => (
              <div key={h.version} className="flex items-center gap-4 text-xs py-2 px-3 rounded bg-muted/50 border border-border">
                <span className="font-mono font-semibold">v{String(h.version).padStart(3, '0')}</span>
                <span className={`font-semibold ${h.verdict === 'healthy' ? 'text-green-400' : h.verdict === 'needs_revision' ? 'text-yellow-400' : 'text-red-400'}`}>
                  {h.score}/100
                </span>
                <span className="text-muted-foreground">{h.verdict}</span>
                <span className="text-muted-foreground ml-auto">{new Date(h.checkedAt).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!health && (
        <div className="text-center py-12 text-muted-foreground text-sm">
          Sem health check. Faca upload de um documento de requisitos ou rode o Doctor.
        </div>
      )}
    </div>
  );
}
