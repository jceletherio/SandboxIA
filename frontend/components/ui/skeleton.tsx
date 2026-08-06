import { cn } from '@/lib/utils'

export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn('animate-pulse rounded-md bg-muted/50', className)} />
  )
}

export function SkeletonCard() {
  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <Skeleton className="w-8 h-8 rounded-lg" />
          <div className="space-y-1.5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-2.5 w-16" />
          </div>
        </div>
        <Skeleton className="w-2 h-2 rounded-full" />
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Skeleton className="h-2.5 w-12" />
          <Skeleton className="h-4 w-16 rounded" />
        </div>
        <div className="flex items-center justify-between">
          <Skeleton className="h-2.5 w-12" />
          <Skeleton className="h-3 w-8" />
        </div>
      </div>
      <Skeleton className="h-8 w-full rounded-md" />
    </div>
  )
}

export function SkeletonTable({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3 rounded-lg border border-border bg-card">
          <Skeleton className="w-1.5 h-1.5 rounded-full shrink-0" />
          <Skeleton className="w-16 h-3 shrink-0" />
          <Skeleton className="h-3 flex-1" />
          <Skeleton className="w-20 h-4 rounded shrink-0" />
          <Skeleton className="w-24 h-3 shrink-0" />
          <Skeleton className="w-16 h-3 shrink-0" />
        </div>
      ))}
    </div>
  )
}

export function SkeletonKanban() {
  return (
    <div className="flex gap-3 p-4 lg:p-6 min-w-max">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="w-72 shrink-0 space-y-3">
          <div className="flex items-center gap-2 px-1">
            <Skeleton className="w-3.5 h-3.5 rounded" />
            <Skeleton className="h-2.5 w-16" />
          </div>
          <div className="space-y-2 rounded-lg bg-muted/5 p-2">
            {Array.from({ length: 3 }).map((_, j) => (
              <div key={j} className="rounded-lg border border-border bg-card p-3 space-y-2">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-2.5 w-3/4" />
                <div className="flex items-center gap-2">
                  <Skeleton className="h-4 w-8 rounded" />
                  <Skeleton className="h-4 w-16 rounded" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
