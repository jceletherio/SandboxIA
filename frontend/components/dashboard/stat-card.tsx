import { cn } from '@/lib/utils'
import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'

interface StatCardProps {
  label: string
  value: string | number
  sub?: string
  icon: LucideIcon
  trend?: 'up' | 'down' | 'neutral'
  accent?: boolean
  href?: string
}

export function StatCard({ label, value, sub, icon: Icon, accent, href }: StatCardProps) {
  const body = (
    <>
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-widest text-muted-foreground font-mono">{label}</span>
        <Icon className={cn('w-3.5 h-3.5', accent ? 'text-primary' : 'text-muted-foreground')} />
      </div>
      <div className="flex items-end gap-2">
        <span className={cn('text-2xl font-semibold leading-none', accent ? 'text-primary' : 'text-foreground')}>
          {value}
        </span>
        {sub && <span className="text-xs text-muted-foreground mb-0.5">{sub}</span>}
      </div>
    </>
  )

  const className = cn(
    'rounded-lg border border-border p-4 bg-card flex flex-col gap-3',
    accent && 'border-primary/30 bg-accent/30',
    href && 'hover:border-primary/40 hover:bg-muted/20 transition-colors',
  )

  if (href) {
    return (
      <Link href={href} className={className}>
        {body}
      </Link>
    )
  }
  return <div className={className}>{body}</div>
}
