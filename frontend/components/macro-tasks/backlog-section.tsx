'use client'

/**
 * Backlog vindo dos task-reports (melhorias.md #5).
 *
 * Fica ABAIXO do kanban, não dentro dele: o kanban serve para acompanhar fluxo e
 * a Onda 1 já gerou 25 findings em 3 tasks — uma coluna de kanban com 100+ cards
 * seria inutilizável. Componente separado da `page.tsx` para não engordar mais um
 * arquivo que já tem 1500 linhas.
 *
 * Contenção de scroll: a tabela rola no PRÓPRIO container (X e Y). O kanban ao
 * lado já rola no eixo X e dois eixos concorrentes no mesmo scroll deixam a
 * página ruim de usar.
 */

import { macroTasksApi, type BacklogItem, type BacklogSummary, type Pipeline } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useToast } from '@/components/toast-provider'
import { ChevronDown, ChevronRight, Inbox, Loader2, Play, RefreshCw, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/** Acima disto a seção nasce fechada, para o kanban não sumir do campo de visão. */
const COLLAPSE_THRESHOLD = 20

const kindColors: Record<string, string> = {
  bug: 'bg-destructive/15 text-destructive',
  debt: 'bg-status-waiting/15 text-status-waiting',
  optimization: 'bg-primary/15 text-primary',
  improvement: 'bg-muted text-muted-foreground',
  docs: 'bg-muted text-muted-foreground',
}

const effortLabels: Record<string, string> = { s: 'P', m: 'M', l: 'G' }

interface Props {
  projectId: string
  pipelines: Pipeline[]
  /** Chamado após promover — a página recarrega o kanban para o item aparecer lá. */
  onPromoted: () => void
}

export function BacklogSection({ projectId, pipelines, onPromoted }: Props) {
  const { toast, update } = useToast()
  const [items, setItems] = useState<BacklogItem[]>([])
  const [summary, setSummary] = useState<BacklogSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)
  /** O auto-colapso decide uma vez; depois quem manda é o usuário. */
  const autoExpandDecided = useRef(false)
  const [ingesting, setIngesting] = useState(false)
  const [filterKind, setFilterKind] = useState<string | null>(null)
  const [filterOrigin, setFilterOrigin] = useState<string | null>(null)
  const [fileQuery, setFileQuery] = useState('')
  const [promoting, setPromoting] = useState<BacklogItem | null>(null)
  const [promotePipelineId, setPromotePipelineId] = useState('')
  const [promoteBusy, setPromoteBusy] = useState(false)

  const load = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const [backlog, agg] = await Promise.all([
        macroTasksApi.backlog(projectId),
        macroTasksApi.backlogSummary(projectId),
      ])
      const list = Array.isArray(backlog) ? backlog : []
      setItems(list)
      setSummary(agg)
      // Só decide o estado inicial uma vez: reabrir sozinho depois que o usuário
      // fechou seria briga de controle a cada refetch. Ref, não state — decidir
      // isso dentro de um updater de `useState` é efeito colateral em reducer, e
      // o StrictMode chama o updater duas vezes.
      if (!autoExpandDecided.current) {
        autoExpandDecided.current = true
        setExpanded(list.length <= COLLAPSE_THRESHOLD)
      }
    } catch {
      setItems([])
      setSummary(null)
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => { void load() }, [load])

  const filtered = useMemo(() => {
    const query = fileQuery.trim().toLowerCase()
    return items.filter(item => {
      if (filterKind && item.backlog.kind !== filterKind) return false
      if (filterOrigin && item.origin?.macroTaskId !== filterOrigin) return false
      if (query && !item.backlog.files.some(f => f.toLowerCase().includes(query))) return false
      return true
    })
  }, [items, filterKind, filterOrigin, fileQuery])

  const hasFilters = filterKind !== null || filterOrigin !== null || fileQuery.trim() !== ''

  const runIngest = async () => {
    setIngesting(true)
    const toastId = toast('loading', 'Lendo os task-reports das sessões...')
    try {
      const result = await macroTasksApi.ingestBacklog(projectId)
      update(
        toastId,
        'success',
        `${result.created} novos · ${result.merged} fundidos · ${result.skipped} já existentes`,
      )
      await load()
    } catch (error) {
      update(toastId, 'error', error instanceof Error ? error.message : 'Falha ao ingerir reports')
    } finally {
      setIngesting(false)
    }
  }

  const confirmPromote = async () => {
    if (!promoting) return
    const item = promoting
    setPromoteBusy(true)
    const toastId = toast('loading', 'Promovendo...')
    try {
      await macroTasksApi.promote(projectId, item.id, promotePipelineId || undefined)
      update(toastId, 'success', `"${item.title}" promovido para pending`)
      setPromoting(null)
      // Sai do backlog e entra no kanban na mesma ação.
      setItems(prev => prev.filter(entry => entry.id !== item.id))
      onPromoted()
      await load()
    } catch (error) {
      update(toastId, 'error', error instanceof Error ? error.message : 'Falha ao promover')
    } finally {
      setPromoteBusy(false)
    }
  }

  return (
    <div className="shrink-0 border-t border-border bg-card/30">
      <div className="flex items-center gap-2 px-4 lg:px-6 py-2">
        <button
          onClick={() => { autoExpandDecided.current = true; setExpanded(!expanded) }}
          className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
        >
          {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          <span className="text-[10px] uppercase tracking-widest font-mono">Backlog</span>
          <span className="text-[10px] font-mono text-muted-foreground/60">({items.length})</span>
        </button>

        {/* Resumo por kind fica visível mesmo fechado — é o sinal de onde a dívida está. */}
        {summary && summary.byKind.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap ml-1">
            {summary.byKind.map(entry => (
              <button
                key={entry.kind}
                onClick={() => { autoExpandDecided.current = true; setExpanded(true); setFilterKind(filterKind === entry.kind ? null : entry.kind) }}
                className={cn(
                  'text-[9px] font-mono px-1.5 py-0.5 rounded transition-opacity hover:opacity-80',
                  kindColors[entry.kind] ?? 'bg-muted text-muted-foreground',
                  filterKind === entry.kind && 'ring-1 ring-primary/50',
                )}
              >
                {entry.count} {entry.kind}
              </button>
            ))}
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => void load()}
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
            aria-label="Recarregar backlog"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
          </button>
          <button
            onClick={() => void runIngest()}
            disabled={ingesting}
            title="Lê os task-reports das sessões concluídas e materializa o backlog"
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-50"
          >
            {ingesting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Inbox className="w-3 h-3" />}
            Ingerir reports
          </button>
        </div>
      </div>

      {expanded && (
        <div className="max-h-[45vh] overflow-y-auto border-t border-border">
          <div className="flex items-center gap-2 px-4 lg:px-6 py-2 flex-wrap">
            <select
              value={filterOrigin ?? ''}
              onChange={e => setFilterOrigin(e.target.value || null)}
              className="bg-input border border-border rounded-md px-2 py-1 text-xs text-foreground outline-none focus:border-primary/50 max-w-[16rem]"
            >
              <option value="">Todas as origens</option>
              {summary?.byOrigin.map(origin => (
                <option key={origin.macroTaskId} value={origin.macroTaskId}>
                  {origin.title} ({origin.count})
                </option>
              ))}
            </select>
            <input
              value={fileQuery}
              onChange={e => setFileQuery(e.target.value)}
              placeholder="Filtrar por arquivo…"
              className="bg-input border border-border rounded-md px-2 py-1 text-xs text-foreground outline-none focus:border-primary/50 w-52"
            />
            {hasFilters && (
              <button
                onClick={() => { setFilterKind(null); setFilterOrigin(null); setFileQuery('') }}
                className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              >
                Limpar filtros
              </button>
            )}
            <span className="text-[10px] font-mono text-muted-foreground/60 ml-auto">
              {filtered.length} de {items.length}
            </span>
          </div>

          {/* Arquivos mais citados: onde a dívida se concentra. */}
          {summary && summary.byFile.length > 0 && (
            <div className="flex items-center gap-1.5 px-4 lg:px-6 pb-2 flex-wrap">
              <span className="text-[9px] uppercase tracking-widest font-mono text-muted-foreground/60">Concentração</span>
              {summary.byFile.slice(0, 6).map(entry => (
                <button
                  key={entry.file}
                  onClick={() => setFileQuery(entry.file)}
                  className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground hover:text-foreground transition-colors max-w-[18rem] truncate"
                  title={`${entry.file} — ${entry.kinds.join(', ')}`}
                >
                  {entry.count}× {entry.file.split('/').pop()}
                </button>
              ))}
            </div>
          )}

          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
              <Inbox className="w-7 h-7 text-muted-foreground/40" />
              <p className="text-xs text-muted-foreground">Nenhum item de backlog ainda</p>
              <p className="text-[10px] text-muted-foreground/70 max-w-md">
                Os itens aparecem sozinhos quando uma sessão termina e grava o task-report.
                Use <span className="font-mono">Ingerir reports</span> para consumir os reports já existentes.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto px-4 lg:px-6 pb-4">
              <table className="w-full min-w-[52rem] text-left">
                <thead>
                  <tr className="text-[9px] uppercase tracking-widest font-mono text-muted-foreground/60">
                    <th className="py-1.5 pr-3 font-normal">Prio</th>
                    <th className="py-1.5 pr-3 font-normal">Item</th>
                    <th className="py-1.5 pr-3 font-normal">Kind</th>
                    <th className="py-1.5 pr-3 font-normal">Esf.</th>
                    <th className="py-1.5 pr-3 font-normal">Origem</th>
                    <th className="py-1.5 pr-3 font-normal">Arquivos</th>
                    <th className="py-1.5 pr-3 font-normal">Visto</th>
                    <th className="py-1.5 font-normal" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(item => (
                    <tr key={item.id} className="border-t border-border/50 align-top hover:bg-muted/20">
                      <td className="py-2 pr-3">
                        <span className={cn(
                          'text-[9px] font-mono px-1.5 py-0.5 rounded',
                          item.priority >= 2 ? 'bg-destructive/15 text-destructive' :
                            item.priority >= 1 ? 'bg-status-waiting/15 text-status-waiting' :
                              'bg-muted text-muted-foreground',
                        )} title={`Score ${item.backlog.score}`}>
                          P{item.priority}
                        </span>
                      </td>
                      <td className="py-2 pr-3 max-w-[24rem]">
                        <p className="text-xs text-foreground leading-snug">{item.title}</p>
                        {item.backlog.detail && (
                          <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">{item.backlog.detail}</p>
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        <span className={cn('text-[9px] font-mono px-1.5 py-0.5 rounded', kindColors[item.backlog.kind] ?? 'bg-muted text-muted-foreground')}>
                          {item.backlog.kind}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-[10px] font-mono text-muted-foreground">
                        {effortLabels[item.backlog.effort] ?? item.backlog.effort}
                      </td>
                      <td className="py-2 pr-3 max-w-[12rem]">
                        {item.origin ? (
                          <button
                            onClick={() => setFilterOrigin(item.origin!.macroTaskId)}
                            className="text-[10px] text-primary hover:underline text-left line-clamp-2"
                            title={`Filtrar pelos itens de "${item.origin.title}"`}
                          >
                            {item.origin.title}
                          </button>
                        ) : (
                          <span className="text-[10px] text-muted-foreground/50">—</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 max-w-[14rem]">
                        {item.backlog.files.length > 0 ? (
                          <span className="text-[10px] font-mono text-muted-foreground line-clamp-2" title={item.backlog.files.join('\n')}>
                            {item.backlog.files.map(f => f.split('/').pop()).join(', ')}
                          </span>
                        ) : (
                          <span className="text-[10px] text-muted-foreground/50">—</span>
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        <span className={cn(
                          'text-[10px] font-mono',
                          item.backlog.seenCount > 1 ? 'text-status-waiting' : 'text-muted-foreground/60',
                        )} title={`${item.backlog.seenCount} sessão(ões) reportaram isto`}>
                          {item.backlog.seenCount}×
                        </span>
                      </td>
                      <td className="py-2">
                        <button
                          onClick={() => {
                            setPromoting(item)
                            const suggested = pipelines.find(p => p.name === item.suggestedPipeline)
                            setPromotePipelineId(suggested?.id ?? item.pipelineId)
                          }}
                          className="flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 rounded bg-primary/15 text-primary hover:bg-primary/25 transition-colors whitespace-nowrap"
                        >
                          <Play className="w-2.5 h-2.5" />
                          Promover
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-6 text-center text-[10px] text-muted-foreground/60">
                        Nenhum item com esses filtros
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {promoting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setPromoting(null)}>
          <div className="w-full max-w-md rounded-lg border border-border bg-card shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-border flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-foreground">Promover para task</h2>
                <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2">{promoting.title}</p>
              </div>
              <button onClick={() => setPromoting(null)} className="p-1 rounded hover:bg-muted/40 text-muted-foreground" aria-label="Fechar">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="px-6 py-4 space-y-3">
              <div>
                <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">Pipeline</label>
                <select
                  value={promotePipelineId}
                  onChange={e => setPromotePipelineId(e.target.value)}
                  className="w-full mt-1 bg-input border border-border rounded-md px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary/50"
                >
                  {pipelines.map(pipeline => (
                    <option key={pipeline.id} value={pipeline.id}>{pipeline.name}</option>
                  ))}
                </select>
                {promoting.suggestedPipeline && (
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Sugerido pelo esforço <span className="font-mono">{promoting.backlog.effort}</span>:{' '}
                    <span className="font-mono">{promoting.suggestedPipeline}</span>
                  </p>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground">
                O item vira <span className="font-mono">pending</span> e aparece no kanban. A origem
                {promoting.origin ? <> (<span className="font-mono">{promoting.origin.title}</span>)</> : null} é preservada.
              </p>
            </div>
            <div className="px-6 py-3 border-t border-border flex justify-end gap-2">
              <button onClick={() => setPromoting(null)} className="text-[11px] text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-md transition-colors">
                Cancelar
              </button>
              <button
                onClick={() => void confirmPromote()}
                disabled={promoteBusy}
                className="flex items-center gap-1.5 text-[11px] bg-primary text-primary-foreground px-3 py-1.5 rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {promoteBusy && <Loader2 className="w-3 h-3 animate-spin" />}
                Promover
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
