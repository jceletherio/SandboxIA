'use client'

import Link from 'next/link'
import { Bot, ListTodo, MessageSquare, Terminal as TerminalIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { MasterAgentStats } from '@/lib/api'

interface MasterKpiStripProps {
  /** `null` = ainda carregando (mostra skeleton, não zeros falsos). */
  stats: MasterAgentStats | null
  className?: string
}

/**
 * Faixa de KPIs do projeto observado — os mesmos 4 números do antigo
 * "Project status", agora com peso visual e no topo da página em vez de
 * escondidos atrás de um drawer.
 *
 * Cada tile é um link: o número é o começo da investigação, não o fim.
 */
export function MasterKpiStrip({ stats, className }: MasterKpiStripProps) {
  if (!stats) {
    return (
      <div className={cn('grid grid-cols-2 xl:grid-cols-4 gap-2', className)}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border bg-card p-3 space-y-2">
            <div className="h-2.5 w-20 rounded bg-muted/50 animate-pulse" />
            <div className="h-6 w-10 rounded bg-muted/40 animate-pulse" />
          </div>
        ))}
      </div>
    )
  }

  const kpis = [
    {
      label: 'Live sessions',
      value: stats.sessions.active,
      sub: `${stats.sessions.total} total`,
      icon: TerminalIcon,
      href: '/sessions',
      tone: stats.sessions.active > 0 ? 'text-status-running' : 'text-foreground',
    },
    {
      label: 'Questions',
      value: stats.questions,
      sub: 'pending',
      icon: MessageSquare,
      href: '/questions',
      tone: stats.questions > 0 ? 'text-destructive' : 'text-foreground',
    },
    {
      label: 'Macro tasks',
      value: stats.tasks,
      sub: 'total',
      icon: ListTodo,
      href: '/macro-tasks',
      tone: 'text-foreground',
    },
    {
      label: 'Agents',
      value: stats.agents,
      sub: 'registered',
      icon: Bot,
      href: '/agents',
      tone: 'text-foreground',
    },
  ] as const

  return (
    <div className={cn('grid grid-cols-2 xl:grid-cols-4 gap-2', className)}>
      {kpis.map((kpi) => {
        const Icon = kpi.icon
        return (
          <Link
            key={kpi.label}
            href={kpi.href}
            className="rounded-lg border border-border bg-card px-3 py-2.5 flex flex-col gap-1.5 hover:border-primary/40 hover:bg-muted/20 transition-colors"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground truncate">
                {kpi.label}
              </span>
              <Icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className={cn('text-xl font-semibold font-mono leading-none', kpi.tone)}>{kpi.value}</span>
              <span className="text-[10px] text-muted-foreground truncate">{kpi.sub}</span>
            </div>
          </Link>
        )
      })}
    </div>
  )
}
