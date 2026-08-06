'use client'

import { useEffect, useRef } from 'react'
import { FileText, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ProjectFileEntry } from '@/lib/api'

interface FileMentionListProps {
  files: ProjectFileEntry[]
  activeIndex: number
  onHover: (index: number) => void
  onSelect: (file: ProjectFileEntry) => void
  loading?: boolean
  /** Quantos casaram além dos exibidos — vira "+N more". */
  hiddenCount?: number
  query?: string
  className?: string
}

/**
 * Dropdown do `@arquivo`, ancorado acima do composer (o wrapper do
 * `ChatComposer` é `relative`).
 *
 * Mostra o **nome** em destaque e o diretório em segundo plano: numa coluna de
 * ~400px o caminho inteiro em uma linha só é ilegível.
 */
export function FileMentionList({
  files,
  activeIndex,
  onHover,
  onSelect,
  loading = false,
  hiddenCount = 0,
  query,
  className,
}: FileMentionListProps) {
  const listRef = useRef<HTMLDivElement>(null)

  // Mantém o item ativo visível quando se navega com as setas.
  useEffect(() => {
    const container = listRef.current
    const active = container?.querySelector<HTMLElement>('[data-active="true"]')
    active?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  return (
    <div
      className={cn(
        'absolute bottom-full left-0 right-0 mb-2 mx-4 lg:mx-6 z-20',
        'rounded-lg border border-border bg-card shadow-lg overflow-hidden',
        className,
      )}
    >
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border bg-muted/20">
        <Search className="w-3 h-3 text-muted-foreground shrink-0" />
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Project files
        </span>
        {query ? (
          <span className="text-[10px] font-mono text-primary truncate">{query}</span>
        ) : null}
        {loading && <span className="text-[10px] text-muted-foreground ml-auto">searching…</span>}
      </div>

      <div ref={listRef} className="max-h-64 overflow-y-auto">
        {files.map((file, index) => (
          <button
            key={file.path}
            data-active={index === activeIndex}
            // mousedown + preventDefault: o blur do textarea não pode ganhar a
            // corrida do clique, senão o dropdown fecha antes de selecionar.
            onMouseDown={(e) => {
              e.preventDefault()
              onSelect(file)
            }}
            onMouseEnter={() => onHover(index)}
            className={cn(
              'w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors',
              index === activeIndex ? 'bg-primary/10' : 'hover:bg-muted/40',
            )}
          >
            <FileText
              className={cn(
                'w-3.5 h-3.5 shrink-0',
                index === activeIndex ? 'text-primary' : 'text-muted-foreground',
              )}
            />
            <span className="text-[11px] text-foreground font-mono truncate shrink-0 max-w-[45%]">
              {file.name}
            </span>
            {file.dir && (
              <span className="text-[10px] text-muted-foreground font-mono truncate" dir="rtl">
                {file.dir}
              </span>
            )}
          </button>
        ))}

        {!loading && files.length === 0 && (
          <p className="px-3 py-3 text-[11px] text-muted-foreground text-center">
            No file matches “{query}”
          </p>
        )}
      </div>

      {hiddenCount > 0 && (
        <p className="px-3 py-1.5 border-t border-border bg-muted/10 text-[10px] text-muted-foreground">
          +{hiddenCount} more — keep typing to narrow it down
        </p>
      )}
    </div>
  )
}
