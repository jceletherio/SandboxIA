'use client'

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface MasterSectionProps {
  title: string
  /** Conteúdo do canto direito do cabeçalho (contador, link "view all", dot). */
  meta?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}

/**
 * Card de seção do painel de situação do Master.
 *
 * Existe para o painel central ter um ritmo visual único: mesmo cabeçalho,
 * mesma borda, mesmo rótulo `text-[10px] uppercase`. Quem tem scroll próprio
 * (activity, decisions) recebe a altura pelo `bodyClassName`.
 */
export function MasterSection({ title, meta, children, className, bodyClassName }: MasterSectionProps) {
  return (
    <section
      className={cn('rounded-lg border border-border bg-card overflow-hidden flex flex-col min-h-0', className)}
    >
      <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-border shrink-0">
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{title}</p>
        {meta && <div className="flex items-center gap-2 shrink-0">{meta}</div>}
      </div>
      <div className={cn('min-h-0', bodyClassName)}>{children}</div>
    </section>
  )
}
