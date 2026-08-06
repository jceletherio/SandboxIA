'use client'

import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface MasterTabItem<T extends string = string> {
  id: T
  label: string
  icon: LucideIcon
  /** Contagem neutra (sessões vivas, decisões). Zero não aparece. */
  badge?: number
  /** Contagem urgente (perguntas pendentes). Zero não aparece. */
  alert?: number
  /** Estado ligado/desligado da aba (ex.: agendamentos ativos). */
  dot?: 'active' | 'idle'
  title?: string
}

interface MasterTabBarProps<T extends string> {
  items: MasterTabItem<T>[]
  current: T
  onSelect: (id: T) => void
  className?: string
}

/**
 * Barra de abas da página do Master.
 *
 * É o mesmo tratamento visual das abas que a página já usava no mobile
 * (`flex-1`, ícone + rótulo, sublinhado no ativo) — de propósito: o projeto tem
 * um padrão de aba só, e agora ele serve tanto o switch mobile
 * (painel/chat) quanto as seções do painel de situação no desktop.
 *
 * Os contadores existem para a aba fechada não esconder informação: dá para ver
 * que há 3 sessões vivas ou 2 perguntas pendentes sem abrir a aba.
 */
export function MasterTabBar<T extends string>({
  items,
  current,
  onSelect,
  className,
}: MasterTabBarProps<T>) {
  return (
    <div role="tablist" className={cn('flex border-b border-border shrink-0 bg-card/40', className)}>
      {items.map((item) => {
        const Icon = item.icon
        const active = item.id === current
        return (
          <button
            key={item.id}
            role="tab"
            aria-selected={active}
            title={item.title}
            onClick={() => onSelect(item.id)}
            className={cn(
              'flex-1 min-w-0 flex items-center justify-center gap-1.5 py-2.5 text-xs transition-colors',
              active
                ? 'text-primary border-b-2 border-primary'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{item.label}</span>
            {item.dot && (
              <span
                className={cn(
                  'w-1.5 h-1.5 rounded-full shrink-0',
                  item.dot === 'active' ? 'bg-status-running' : 'bg-muted-foreground/50',
                )}
              />
            )}
            {!!item.badge && (
              <span className="shrink-0 text-[10px] font-mono px-1 rounded bg-muted text-muted-foreground">
                {item.badge}
              </span>
            )}
            {!!item.alert && (
              <span className="shrink-0 text-[10px] font-mono px-1 rounded bg-destructive/20 text-destructive">
                {item.alert}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
