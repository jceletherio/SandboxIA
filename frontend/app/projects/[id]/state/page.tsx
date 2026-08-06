'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';

interface ProjectState {
  project: {
    id: string;
    name: string;
    repoUrl: string;
    worktreeBase: string;
    worktreeExists: boolean;
    iaFrameworkExists: boolean;
    gitignoreExists: boolean;
  };
  stacks: {
    active: string[];
    all: { stack: string; isActive: boolean; agentCount: number; agents: string[] }[];
  };
  sdd: {
    projectSddExists: boolean;
    specs: { total: number; open: number; blocked: number; ready: number };
  };
  requirements: {
    requirementsExists: boolean;
    lastHealthCheck: { version: number; score: number; verdict: string; checkedAt: string } | null;
  };
  screens: { count: number };
  architecture: { files: string[] };
  testing: { testPlanCount: number };
}

const STACK_LABELS: Record<string, string> = {
  angular: 'Angular 22',
  nodejs: 'Node.js 22+',
  spring: 'Spring Boot 3.5',
  go: 'Go 1.23+',
  postgres: 'PostgreSQL 16+',
};

export default function ProjectStatePage() {
  const params = useParams();
  const projectId = params.id as string;
  const [state, setState] = useState<ProjectState | null>(null);
  const [loading, setLoading] = useState(true);

  const loadState = useCallback(async () => {
    try {
      const data = await api.get<ProjectState>(`/projects/${projectId}/state`);
      setState(data);
    } catch (e) {
      console.error('Failed to load state:', e);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { loadState(); }, [loadState]);

  if (loading) return <div className="p-8 text-muted-foreground">Carregando estado...</div>;
  if (!state) return <div className="p-8 text-muted-foreground">Projeto não encontrado.</div>;

  const { project, stacks, sdd, requirements, screens, architecture, testing } = state;

  const Check = ({ ok, label }: { ok: boolean; label: string }) => (
    <div className="flex items-center gap-2 text-sm py-1">
      <span className={ok ? 'text-green-400' : 'text-red-400'}>{ok ? '✓' : '✗'}</span>
      <span className={ok ? '' : 'text-muted-foreground'}>{label}</span>
    </div>
  );

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-semibold mb-2">{project.name}</h1>
      <p className="text-xs text-muted-foreground mb-6 font-mono">{project.repoUrl}</p>

      {/* Stacks */}
      <section className="mb-6">
        <h2 className="text-sm uppercase tracking-widest text-muted-foreground mb-3">Stacks Ativas</h2>
        <div className="flex flex-wrap gap-2">
          {stacks.active.length > 0 ? stacks.active.map(s => (
            <span key={s} className="px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium border border-primary/20">
              {STACK_LABELS[s] || s}
            </span>
          )) : <span className="text-sm text-muted-foreground">Nenhuma stack ativa</span>}
        </div>
      </section>

      {/* SDD */}
      <section className="mb-6">
        <h2 className="text-sm uppercase tracking-widest text-muted-foreground mb-3">Árvore SDD</h2>
        <Check ok={project.iaFrameworkExists} label="ia-framework/ com STACK.md" />
        <Check ok={sdd.projectSddExists} label="project_sdd/01-context/ existe" />
        <Check ok={project.gitignoreExists} label=".gitignore configurado" />
        {sdd.specs.total > 0 && (
          <div className="mt-2 text-xs text-muted-foreground">
            Trilhas: {sdd.specs.open} abertas | {sdd.specs.blocked} bloqueadas | {sdd.specs.ready} prontas (total: {sdd.specs.total})
          </div>
        )}
      </section>

      {/* Requirements */}
      <section className="mb-6">
        <h2 className="text-sm uppercase tracking-widest text-muted-foreground mb-3">Requisitos</h2>
        <Check ok={requirements.requirementsExists} label="01-context/requirements.md carregado" />
        {requirements.lastHealthCheck && (
          <div className="mt-2 p-3 rounded-lg bg-muted/50 border border-border">
            <div className="flex items-center gap-3 text-sm">
              <span className={`font-bold ${
                requirements.lastHealthCheck.verdict === 'healthy' ? 'text-green-400' :
                requirements.lastHealthCheck.verdict === 'needs_revision' ? 'text-yellow-400' : 'text-red-400'
              }`}>
                {requirements.lastHealthCheck.score}/100
              </span>
              <span className="text-muted-foreground">
                {requirements.lastHealthCheck.verdict} (v{requirements.lastHealthCheck.version})
              </span>
              <span className="text-xs text-muted-foreground ml-auto">
                {new Date(requirements.lastHealthCheck.checkedAt).toLocaleString()}
              </span>
            </div>
          </div>
        )}
      </section>

      {/* Screens */}
      <section className="mb-6">
        <h2 className="text-sm uppercase tracking-widest text-muted-foreground mb-3">Telas</h2>
        <Check ok={screens.count > 0} label={`${screens.count} tela(s) descrita(s)`} />
      </section>

      {/* Architecture */}
      <section className="mb-6">
        <h2 className="text-sm uppercase tracking-widest text-muted-foreground mb-3">Arquitetura</h2>
        {architecture.files.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {architecture.files.map(f => (
              <span key={f} className="text-xs px-2 py-1 rounded bg-muted text-muted-foreground border border-border">
                {f}
              </span>
            ))}
          </div>
        ) : <Check ok={false} label="docs/architecture/ vazio" />}
      </section>

      {/* Testing */}
      <section className="mb-6">
        <h2 className="text-sm uppercase tracking-widest text-muted-foreground mb-3">Testes</h2>
        <Check ok={testing.testPlanCount > 0} label={`${testing.testPlanCount} plano(s) de teste`} />
      </section>
    </div>
  );
}