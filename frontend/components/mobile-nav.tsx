'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Terminal, MessageSquare, Bot, Menu } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useNavCounts } from '@/lib/nav-counts'

/**
 * Barra inferior — só mobile (`lg:hidden`). Não é um segundo menu: são os cinco
 * destinos que a gente abre pelo celular, na faixa que o dedo alcança, e o
 * último item abre o mesmo drawer da sidebar para o resto.
 *
 * Os badges ficam aqui de propósito: no celular a sidebar está fechada, então
 * sem eles "tem pergunta esperando" só apareceria depois de dois toques.
 */
const items = [
  { href: '/', label: 'Home', icon: LayoutDashboard },
  { href: '/sessions', label: 'Sessions', icon: Terminal, countKey: 'sessions', alertKey: 'stalledSessions' },
  { href: '/questions', label: 'Questions', icon: MessageSquare, countKey: 'questions', urgent: true },
  { href: '/master-agent', label: 'Master', icon: Bot },
] as const

export function MobileNav({ onOpenMenu }: { onOpenMenu: () => void }) {
  const pathname = usePathname()
  const counts = useNavCounts()

  return (
    <nav
      className="lg:hidden fixed bottom-0 left-0 right-0 z-40 flex items-stretch bg-sidebar border-t border-sidebar-border pb-[env(safe-area-inset-bottom)]"
      aria-label="Navegação principal"
    >
      {items.map((item) => {
        const Icon = item.icon
        const active = pathname === item.href
        const count = 'countKey' in item && item.countKey ? counts[item.countKey] : undefined
        const alert = 'alertKey' in item && item.alertKey ? counts[item.alertKey] : undefined
        const urgent = 'urgent' in item && item.urgent

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'relative flex-1 min-h-12 flex flex-col items-center justify-center gap-0.5 py-1.5 transition-colors',
              active ? 'text-primary' : 'text-muted-foreground active:bg-sidebar-accent'
            )}
          >
            <span className="relative">
              <Icon className="w-5 h-5" />
              {/* Contagem urgente (perguntas) e alerta de travamento viram um
                  badge no ícone — o rótulo abaixo é curto demais para caber. */}
              {count !== undefined && count > 0 && (
                <span
                  className={cn(
                    'absolute -top-1.5 -right-2 min-w-4 px-1 rounded-full text-[9px] font-mono leading-4 text-center',
                    urgent ? 'bg-destructive text-white' : 'bg-muted text-foreground'
                  )}
                >
                  {count > 99 ? '99+' : count}
                </span>
              )}
              {alert !== undefined && alert > 0 && (
                <span
                  title={`${alert} sessão(ões) travada(s)`}
                  className="absolute -bottom-1 -right-2 w-2 h-2 rounded-full bg-status-waiting ring-2 ring-sidebar"
                />
              )}
            </span>
            <span className="text-[10px] leading-none">{item.label}</span>
          </Link>
        )
      })}

      <button
        onClick={onOpenMenu}
        className="flex-1 min-h-12 flex flex-col items-center justify-center gap-0.5 py-1.5 text-muted-foreground active:bg-sidebar-accent transition-colors"
        aria-label="Abrir menu completo"
      >
        <Menu className="w-5 h-5" />
        <span className="text-[10px] leading-none">Menu</span>
      </button>
    </nav>
  )
}
