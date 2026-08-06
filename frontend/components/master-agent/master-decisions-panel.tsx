'use client'

import {
  Activity,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  GitMerge,
  Play,
  Plus,
  RefreshCw,
  Square,
  XCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Decision } from '@/lib/api'

/** Ícone por tipo de decisão do Master (era função solta na página). */
export function getDecisionIcon(type: string) {
  switch (type) {
    case 'MERGED':
      return GitMerge
    case 'CREATED':
      return Plus
    case 'DELEGATED':
      return Play
    case 'ANSWERED':
      return CheckCircle2
    case 'AUTO_ANSWERED':
      return CheckCircle2
    case 'ESCALATED':
      return AlertCircle
    case 'RETRIED':
      return RefreshCw
    case 'ACTIVATED':
      return Play
    case 'DEACTIVATED':
      return Square
    case 'ERROR':
      return XCircle
    case 'WARNING':
      return AlertTriangle
    default:
      return Activity
  }
}

/** Paleta por tipo de decisão: chip do rótulo, cor do ícone e caixa do ícone. */
export function decisionColors(type: string): { chip: string; icon: string; box: string } {
  if (type === 'MERGED' || type === 'ANSWERED' || type === 'AUTO_ANSWERED') {
    return { chip: 'bg-status-done/15 text-status-done', icon: 'text-status-done', box: 'bg-status-done/15' }
  }
  if (type === 'ESCALATED' || type === 'ERROR') {
    return { chip: 'bg-destructive/15 text-destructive', icon: 'text-destructive', box: 'bg-destructive/15' }
  }
  if (type === 'RETRIED' || type === 'WARNING') {
    return { chip: 'bg-status-waiting/15 text-status-waiting', icon: 'text-status-waiting', box: 'bg-status-waiting/15' }
  }
  return { chip: 'bg-primary/10 text-primary', icon: 'text-primary', box: 'bg-primary/10' }
}

interface MasterDecisionsPanelProps {
  decisions: Decision[]
  className?: string
}

/** Lista de decisões autônomas do Master (P3.3 — extraída da página). */
export function MasterDecisionsPanel({ decisions, className }: MasterDecisionsPanelProps) {
  return (
    <div className={cn('px-3 py-2 space-y-1', className)}>
      {decisions.map((d) => {
        const Icon = getDecisionIcon(d.type)
        const colors = decisionColors(d.type)
        return (
          <div key={d.id} className="flex gap-2.5 px-2 py-2.5 rounded-md hover:bg-muted/20 transition-colors">
            <div className={cn('w-6 h-6 rounded-md flex items-center justify-center shrink-0 mt-0.5', colors.box)}>
              <Icon className={cn('w-3 h-3', colors.icon)} />
            </div>
            <div className="flex flex-col gap-0.5 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className={cn('text-[9px] font-mono px-1 py-0.5 rounded shrink-0', colors.chip)}>{d.type}</span>
                <span className="text-[10px] font-mono text-muted-foreground/60">
                  {new Date(d.time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground leading-snug">{d.text}</p>
            </div>
          </div>
        )
      })}
      {decisions.length === 0 && <p className="text-[10px] text-muted-foreground text-center py-4">No decisions yet</p>}
    </div>
  )
}
