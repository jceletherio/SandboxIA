'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { api } from '@/lib/api';

interface StackInfo {
  stack: string;
  isActive: boolean;
  agentCount: number;
  agents: string[];
  skillPath: string;
}

const STACK_META: Record<string, { label: string; color: string; icon: string; description: string }> = {
  angular:  { label: 'Angular 22',       color: 'text-red-400',    icon: 'A', description: 'Frontend standalone, signals, zoneless' },
  nodejs:   { label: 'Node.js 22+',      color: 'text-green-400',   icon: 'N', description: 'Backend ESM, Fastify/Express5/NestJS' },
  spring:   { label: 'Spring Boot 3.5',  color: 'text-emerald-400', icon: 'S', description: 'Java 21+, virtual threads, JPA + Flyway' },
  go:       { label: 'Go 1.23+',         color: 'text-cyan-400',    icon: 'G', description: 'Context-first, pgxpool, interfaces consumer-side' },
  postgres: { label: 'PostgreSQL 16+',   color: 'text-blue-400',    icon: 'P', description: 'RLS multi-tenant, particionamento, JSONB+GIN' },
};

export default function StackSelectorPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;
  const [stacks, setStacks] = useState<StackInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [previewAgents, setPreviewAgents] = useState<string[]>([]);

  const loadStacks = useCallback(async () => {
    try {
      const data = await api.get<StackInfo[]>(`/projects/${projectId}/stacks`);
      setStacks(data);
      setPreviewAgents(data.filter(s => s.isActive).flatMap(s => s.agents));
    } catch (e) {
      console.error('Failed to load stacks:', e);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { loadStacks(); }, [loadStacks]);

  const toggleStack = (stack: string) => {
    setStacks(prev => prev.map(s => {
      if (s.stack === stack) {
        const newActive = !s.isActive;
        if (newActive) {
          setPreviewAgents(prev2 => [...prev2, ...s.agents]);
        } else {
          setPreviewAgents(prev2 => prev2.filter(a => !s.agents.includes(a)));
        }
        return { ...s, isActive: newActive };
      }
      return s;
    }));
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/projects/${projectId}/stacks`, {
        stacks: stacks.map(s => ({ stack: s.stack, isActive: s.isActive })),
      });
      setDirty(false);
      router.refresh();
    } catch (e) {
      console.error('Failed to save stacks:', e);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="p-8 text-muted-foreground">Carregando stacks...</div>;
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold mb-2">Stack Selector</h1>
        <p className="text-sm text-muted-foreground">
          Ative as stacks do seu projeto. Os agentes correspondentes serão copiados para o worktree automaticamente.
        </p>
      </div>

      {/* Stack cards grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {stacks.map(s => {
          const meta = STACK_META[s.stack] || { label: s.stack, color: '', icon: '?', description: '' };
          return (
            <button
              key={s.stack}
              onClick={() => toggleStack(s.stack)}
              className={`relative p-4 rounded-lg border-2 transition-all text-left ${
                s.isActive
                  ? 'border-primary bg-primary/10'
                  : 'border-border hover:border-muted-foreground/50'
              }`}
            >
              <div className="flex items-start justify-between mb-3">
                <div className={`text-3xl font-bold ${meta.color}`}>{meta.icon}</div>
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                  s.isActive ? 'border-primary bg-primary' : 'border-muted-foreground'
                }`}>
                  {s.isActive && <span className="text-primary-foreground text-xs">✓</span>}
                </div>
              </div>
              <h3 className="font-semibold text-sm">{meta.label}</h3>
              <p className="text-xs text-muted-foreground mt-1">{meta.description}</p>
              <div className="mt-3 text-xs text-muted-foreground">
                {s.agentCount} agentes
              </div>
            </button>
          );
        })}
      </div>

      {/* Preview: Agents that will be activated */}
      {previewAgents.length > 0 && (
        <div className="mb-6 p-4 rounded-lg bg-muted/50 border border-border">
          <h3 className="text-sm font-semibold mb-3">Agentes que serão ativados ({previewAgents.length})</h3>
          <div className="flex flex-wrap gap-2">
            {previewAgents.map(agent => (
              <span key={agent} className="text-xs px-2 py-1 rounded bg-muted text-muted-foreground border border-border">
                {agent}.md
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-3">
        <button
          onClick={save}
          disabled={!dirty || saving}
          className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 hover:bg-primary/90 transition-colors"
        >
          {saving ? 'Salvando...' : 'Salvar e copiar agents'}
        </button>
        <button
          onClick={() => router.back()}
          className="px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted transition-colors"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}