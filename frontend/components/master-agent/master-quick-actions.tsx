'use client'

import Link from 'next/link'
import {
  ChevronRight,
  Clock,
  Layers,
  MessageSquare,
  Play,
  Terminal as TerminalIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ActiveTask } from '@/lib/api'

/** Atalhos de navegação do painel de status (mesma lista de sempre). */
const QUICK_ACTIONS = [
  { label: 'Run a macro task', icon: Play, href: '/macro-tasks' },
  { label: 'Answer questions', icon: MessageSquare, href: '/questions' },
  { label: 'View sessions', icon: TerminalIcon, href: '/sessions' },
  { label: 'View terminals', icon: Layers, href: '/terminal' },
  { label: 'Scheduler', icon: Clock, href: '/scheduler' },
] as const

/**
 * Links rápidos para as outras páginas do orquestrador.
 *
 * O título ("Quick actions") vive na `MasterSection` que envolve o bloco — por
 * isso o componente não repete rótulo nem borda própria.
 */
export function MasterQuickActions({ className }: { className?: string }) {
  return (
    <div className={cn('px-3 py-3 space-y-1.5', className)}>
      {QUICK_ACTIONS.map((a) => {
        const Icon = a.icon
        return (
          <Link
            key={a.label}
            href={a.href}
            className="w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-xs text-foreground bg-muted/30 hover:bg-muted/60 transition-colors text-left"
          >
            <Icon className="w-3.5 h-3.5 text-primary shrink-0" />
            {a.label}
            <ChevronRight className="w-3 h-3 text-muted-foreground ml-auto" />
          </Link>
        )
      })}
    </div>
  )
}

/** Macro-tasks em andamento (running pulsa, waiting fica estático). */
export function MasterActiveTasks({ tasks, className }: { tasks: ActiveTask[]; className?: string }) {
  return (
    <div className={cn('px-3 py-3 space-y-1.5', className)}>
      {tasks.map((t) => (
        <div key={t.id} className="flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-border bg-card/50">
          <div
            className={cn(
              'w-1.5 h-1.5 rounded-full shrink-0',
              t.status === 'running' ? 'bg-status-running animate-pulse' : 'bg-status-waiting',
            )}
          />
          <span className="text-[10px] font-mono text-primary shrink-0">{t.id.slice(0, 8)}</span>
          <span className="text-[11px] text-muted-foreground truncate">{t.title}</span>
        </div>
      ))}
      {tasks.length === 0 && <p className="text-[10px] text-muted-foreground text-center py-4">No active macro tasks</p>}
    </div>
  )
}
