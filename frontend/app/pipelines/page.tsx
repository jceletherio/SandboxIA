'use client'

import { Shell } from '@/components/shell'
import { PipelineEditor } from '@/components/pipeline-editor'
import { pipelinesApi, pipelineTemplatesApi, type Pipeline, type PipelineFacets, type PipelineKind, type PipelineTemplate } from '@/lib/api'
import { useProject } from '@/lib/project-context'
import { cn } from '@/lib/utils'
import { Plus, Play, Pause, Trash2, Edit, Layers, Search, Copy, Lock, AlertCircle, ChevronLeft } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ConfirmModal } from '@/components/confirm-modal'
import { useToast } from '@/components/toast-provider'

/**
 * `kind`/`category`/`tags` (MT-0) vivem dentro do JSON `stages`, não em
 * colunas próprias — não há migration de schema para eles. Pipeline sem
 * `kind` gravado (todas as customizadas anteriores à MT-3) conta como
 * 'custom', que é o comportamento neutro esperado.
 */
/**
 * `lib/api.ts` já propaga a `message` do backend (BadRequest da guarda de FK, por
 * exemplo). Só o fallback é genérico, para o toast nunca sair vazio.
 */
function errorText(error: unknown): string {
  const message = (error as { message?: string })?.message
  return message && message.trim() ? message : 'erro desconhecido'
}

function pipelineMeta(pipeline: Pipeline): { kind: PipelineKind; category?: string; tags: string[] } {
  const def = (pipeline.stages as any) || {}
  return {
    kind: def.kind === 'fixed' ? 'fixed' : 'custom',
    category: typeof def.category === 'string' ? def.category : undefined,
    tags: Array.isArray(def.tags) ? def.tags.filter((t: unknown) => typeof t === 'string') : [],
  }
}

/** Itens por página. A lista mora numa coluna de 320px — mais que isto já é scroll longo. */
const PAGE_SIZE = 25

export default function PipelinesPage() {
  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [facets, setFacets] = useState<PipelineFacets>({
    total: 0,
    active: 0,
    matching: 0,
    categories: [],
    tags: [],
  })
  const [templates, setTemplates] = useState<PipelineTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingPipeline, setEditingPipeline] = useState<Pipeline | null>(null)
  const [selectedPipeline, setSelectedPipeline] = useState<Pipeline | null>(null)
  const [deletingPipelineId, setDeletingPipelineId] = useState<string | null>(null)
  const [duplicating, setDuplicating] = useState(false)
  const [search, setSearch] = useState('')
  const [kindFilter, setKindFilter] = useState<'all' | PipelineKind>('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [tagFilter, setTagFilter] = useState('all')
  const [page, setPage] = useState(0)
  const [loadError, setLoadError] = useState<string | null>(null)
  const { currentProject } = useProject()
  const { toast } = useToast()

  /**
   * Filtro e paginação são do BACKEND desde a MT-17 (`?search=&kind=&...`).
   * Antes a página carregava todas as pipelines do projeto e filtrava em JS,
   * o que não passa de umas poucas dezenas — e `pipelinesApi.list` traz cada
   * pipeline com TODAS as suas macro tasks embutidas.
   *
   * `'all'` é o valor do select para "sem filtro" e não vai na query: virasse
   * `kind=all`, o backend recusaria (o DTO só aceita fixed|custom).
   */
  const query = useMemo(
    () => ({
      search: search.trim() || undefined,
      kind: kindFilter === 'all' ? undefined : kindFilter,
      category: categoryFilter === 'all' ? undefined : categoryFilter,
      tag: tagFilter === 'all' ? undefined : tagFilter,
      skip: page * PAGE_SIZE || undefined,
      take: PAGE_SIZE,
    }),
    [search, kindFilter, categoryFilter, tagFilter, page]
  )

  const fetchData = useCallback(async () => {
    if (!currentProject) {
      // sem projeto: não fica preso em "Loading..."
      setPipelines([])
      setLoading(false)
      return
    }
    try {
      const [p, f] = await Promise.all([
        pipelinesApi.list(currentProject.id, query),
        pipelinesApi.facets(currentProject.id, query),
      ])
      setPipelines(p)
      setFacets(f)
      // Só atualiza a selecionada se ela estiver na página atual. Trocar por
      // `?? null` fecharia o painel de detalhe a cada tecla digitada na busca.
      setSelectedPipeline((prev) => (prev ? p.find((x) => x.id === prev.id) ?? prev : prev))
      setLoadError(null)
    } catch (error: any) {
      // Toast a cada fetch (debounce de 250ms por tecla) viraria spam com o
      // backend fora do ar — a falha de LEITURA fica como banner persistente,
      // formato honesto para "o que você está vendo pode estar velho".
      console.error('Failed to fetch pipelines:', error)
      setLoadError(error?.message || 'Falha ao carregar as pipelines')
    } finally {
      setLoading(false)
    }
  }, [currentProject, query])

  /**
   * Debounce curto porque `search` muda a cada tecla. Substituiu o poll de 10s:
   * com a query no servidor, um refetch de fundo a cada 10s recarregaria a
   * página atual sem ninguém ter pedido — o fetch agora segue a intenção do
   * usuário (filtro, paginação) e as mutações chamam `fetchData` direto.
   */
  useEffect(() => {
    const timer = setTimeout(fetchData, 250)
    return () => clearTimeout(timer)
  }, [fetchData])

  /** Filtro novo com a lista rolada para a página 3 devolveria "nenhum resultado". */
  useEffect(() => {
    setPage(0)
  }, [search, kindFilter, categoryFilter, tagFilter, currentProject])

  useEffect(() => {
    if (!currentProject) return
    // Templates são constantes no backend — fetch por projeto, não por filtro.
    pipelineTemplatesApi
      .list(currentProject.id)
      .then(setTemplates)
      .catch((error) => console.error('Failed to fetch pipeline templates:', error))
  }, [currentProject])

  async function toggleActive(pipeline: Pipeline) {
    if (!currentProject) return
    try {
      await pipelinesApi.update(currentProject.id, pipeline.id, { isActive: !pipeline.isActive })
      toast('success', `Pipeline "${pipeline.name}" ${pipeline.isActive ? 'desativada' : 'ativada'}`)
      fetchData()
    } catch (error: any) {
      console.error('Failed to toggle pipeline:', error)
      toast('error', `Não foi possível ${pipeline.isActive ? 'desativar' : 'ativar'}: ${errorText(error)}`)
    }
  }

  function deletePipeline(id: string) {
    setDeletingPipelineId(id)
  }

  async function confirmDeletePipeline() {
    if (!currentProject || !deletingPipelineId) return
    const target = pipelines.find((p) => p.id === deletingPipelineId)
    try {
      await pipelinesApi.delete(currentProject.id, deletingPipelineId)
      if (selectedPipeline?.id === deletingPipelineId) setSelectedPipeline(null)
      setDeletingPipelineId(null)
      toast('success', `Pipeline "${target?.name ?? ''}" apagada`)
      fetchData()
    } catch (error: any) {
      // O delete falha DE PROPÓSITO quando há macro task associada (FK
      // RESTRICT) — o backend manda a contagem na mensagem. Sem o toast o modal
      // só fechava e a pipeline continuava na lista, sem explicação nenhuma.
      console.error('Failed to delete pipeline:', error)
      setDeletingPipelineId(null)
      toast('error', `Não foi possível apagar "${target?.name ?? ''}": ${errorText(error)}`)
    }
  }

  async function duplicatePipeline(pipeline: Pipeline) {
    if (!currentProject) return
    setDuplicating(true)
    try {
      const copy = await pipelinesApi.duplicate(currentProject.id, pipeline.id)
      await fetchData()
      setSelectedPipeline(copy)
      toast('success', `Criada "${copy.name}" como customizada (inativa)`)
    } catch (error: any) {
      console.error('Failed to duplicate pipeline:', error)
      toast('error', `Não foi possível duplicar: ${errorText(error)}`)
    } finally {
      setDuplicating(false)
    }
  }

  // `pipelines` JÁ vem filtrado e paginado do backend — o que sobra aqui é a
  // divisão visual em duas seções, que continua sendo apresentação.
  const fixedPipelines = pipelines.filter((p) => pipelineMeta(p).kind === 'fixed')
  const customPipelines = pipelines.filter((p) => pipelineMeta(p).kind === 'custom')
  const selectedMeta = selectedPipeline ? pipelineMeta(selectedPipeline) : null
  const hasFilter =
    !!search.trim() || kindFilter !== 'all' || categoryFilter !== 'all' || tagFilter !== 'all'
  const pageCount = Math.max(1, Math.ceil(facets.matching / PAGE_SIZE))

  function renderPipelineCard(pipeline: Pipeline) {
    const meta = pipelineMeta(pipeline)
    return (
      <div
        key={pipeline.id}
        onClick={() => setSelectedPipeline(pipeline)}
        className={cn(
          'flex items-start gap-3 px-4 py-3 cursor-pointer border-b border-border/60 transition-colors',
          selectedPipeline?.id === pipeline.id ? 'bg-accent/20' : 'hover:bg-muted/20'
        )}
      >
        <div className={cn(
          'w-1.5 h-1.5 rounded-full shrink-0 mt-1.5',
          pipeline.isActive ? 'bg-status-running animate-pulse' : 'bg-muted-foreground/40'
        )} />
        <div className="flex-1 min-w-0 space-y-0.5">
          <p className="text-xs font-medium text-foreground truncate">{pipeline.name}</p>
          <p className="text-[10px] text-muted-foreground truncate">{pipeline.description}</p>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[10px] font-mono text-muted-foreground">
              {(pipeline.stages as any)?.stages?.length || 0} stages
            </span>
            <span className="text-[10px] text-muted-foreground">·</span>
            <span className="text-[10px] text-muted-foreground">
              {pipeline.macroTasks?.length || 0} tasks
            </span>
            {meta.category && (
              <>
                <span className="text-[10px] text-muted-foreground">·</span>
                <span className="text-[10px] font-mono text-muted-foreground">{meta.category}</span>
              </>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {meta.kind === 'fixed' && (
            <span className="flex items-center gap-0.5 text-[9px] font-mono px-1.5 py-0.5 rounded bg-primary/15 text-primary">
              <Lock className="w-2.5 h-2.5" /> FIXED
            </span>
          )}
          <span className={cn(
            'text-[9px] font-mono px-1.5 py-0.5 rounded',
            pipeline.isActive ? 'bg-status-running/15 text-status-running' : 'bg-muted text-muted-foreground'
          )}>
            {pipeline.isActive ? 'ACTIVE' : 'INACTIVE'}
          </span>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <Shell>
        <div className="flex items-center justify-center h-full">
          <div className="text-sm text-muted-foreground">Loading pipelines...</div>
        </div>
      </Shell>
    )
  }

  return (
    <Shell>
      <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* Master-detail: no mobile os dois painéis não cabem (o detalhe ficava com
          ~70px e quebrava uma palavra por linha), então a lista dá lugar ao
          detalhe. Aqui `selectedPipeline` já serve de estado — diferente de
          /questions, nada é auto-selecionado. */}
      <div
        className={cn(
          'w-full lg:w-80 shrink-0 border-r border-border flex-col min-h-0',
          selectedPipeline ? 'hidden lg:flex' : 'flex',
        )}
      >
        <div className="px-4 py-3 border-b border-border space-y-2.5">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-sm font-semibold text-foreground">Pipelines</h1>
              <p className="text-[11px] text-muted-foreground font-mono mt-0.5">
                {facets.matching} of {facets.total} · {facets.active} active
              </p>
            </div>
            <button
              onClick={() => { setEditingPipeline(null); setEditorOpen(true) }}
              className="flex items-center gap-1 text-[11px] bg-primary text-primary-foreground px-2.5 py-1.5 rounded-md hover:bg-primary/90 transition-colors"
            >
              <Plus className="w-3 h-3" />
              New
            </button>
          </div>

          {loadError && (
            <div className="flex items-start gap-1.5 p-2 rounded-md bg-destructive/10 border border-destructive/30">
              <AlertCircle className="w-3.5 h-3.5 text-destructive shrink-0 mt-px" />
              <p className="text-[10px] text-destructive">{loadError} — a lista pode estar desatualizada.</p>
            </div>
          )}

          <div className="relative">
            <Search className="w-3 h-3 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name..."
              className="w-full bg-input border border-border rounded-md pl-7 pr-2 py-1.5 text-[11px] text-foreground outline-none focus:border-primary/40"
            />
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            <select
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value as 'all' | PipelineKind)}
              className="bg-input border border-border rounded-md px-1.5 py-1 text-[10px] text-foreground outline-none focus:border-primary/40"
            >
              <option value="all">All kinds</option>
              <option value="fixed">Fixed</option>
              <option value="custom">Custom</option>
            </select>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="bg-input border border-border rounded-md px-1.5 py-1 text-[10px] text-foreground outline-none focus:border-primary/40"
            >
              <option value="all">All categories</option>
              {facets.categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              className="bg-input border border-border rounded-md px-1.5 py-1 text-[10px] text-foreground outline-none focus:border-primary/40"
            >
              <option value="all">All tags</option>
              {facets.tags.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {/* `facets.total` e não `pipelines.length`: a lista agora é uma página
              só, então "vazia" pode significar "página vazia" e não "projeto
              sem pipeline" — que são duas mensagens diferentes. */}
          {facets.total === 0 && !loading && (
            <div className="flex flex-col items-center justify-center h-40 gap-2 px-4">
              <Layers className="w-5 h-5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground text-center">No pipelines defined. Create one from a template.</span>
            </div>
          )}
          {facets.total > 0 && pipelines.length === 0 && hasFilter && (
            <div className="flex flex-col items-center justify-center h-40 gap-2 px-4">
              <Search className="w-5 h-5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground text-center">No pipeline matches these filters.</span>
            </div>
          )}
          {fixedPipelines.length > 0 && (
            <div>
              <p className="px-4 pt-3 pb-1 text-[10px] uppercase tracking-widest font-mono text-primary">
                Catálogo (fixas)
              </p>
              {fixedPipelines.map(renderPipelineCard)}
            </div>
          )}
          {customPipelines.length > 0 && (
            <div>
              <p className="px-4 pt-3 pb-1 text-[10px] uppercase tracking-widest font-mono text-muted-foreground">
                Customizadas
              </p>
              {customPipelines.map(renderPipelineCard)}
            </div>
          )}
        </div>

        {/* Só aparece quando há mais de uma página: com 4 pipelines no projeto
            um controle de paginação seria só ruído. */}
        {pageCount > 1 && (
          <div className="shrink-0 flex items-center justify-between gap-2 px-4 py-2 border-t border-border">
            <button
              onClick={() => setPage((prev) => Math.max(0, prev - 1))}
              disabled={page === 0}
              className="text-[10px] font-mono px-2 py-1 rounded border border-border text-muted-foreground hover:text-foreground hover:border-primary/40 disabled:opacity-40 disabled:hover:text-muted-foreground disabled:hover:border-border transition-colors"
            >
              Prev
            </button>
            <span className="text-[10px] font-mono text-muted-foreground">
              {page + 1} / {pageCount}
            </span>
            <button
              onClick={() => setPage((prev) => Math.min(pageCount - 1, prev + 1))}
              disabled={page >= pageCount - 1}
              className="text-[10px] font-mono px-2 py-1 rounded border border-border text-muted-foreground hover:text-foreground hover:border-primary/40 disabled:opacity-40 disabled:hover:text-muted-foreground disabled:hover:border-border transition-colors"
            >
              Next
            </button>
          </div>
        )}
      </div>

      <div
        className={cn(
          'flex-1 min-w-0 flex-col min-h-0',
          selectedPipeline ? 'flex' : 'hidden lg:flex',
        )}
      >
        {selectedPipeline ? (
          <>
            <div className="px-4 lg:px-6 py-4 border-b border-border">
              <button
                onClick={() => setSelectedPipeline(null)}
                className="lg:hidden inline-flex items-center gap-1 -ml-1 mb-2 px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                Pipelines
              </button>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={cn(
                      'text-[10px] font-mono px-1.5 py-0.5 rounded',
                      selectedPipeline.isActive ? 'bg-status-running/15 text-status-running' : 'bg-muted text-muted-foreground'
                    )}>
                      {selectedPipeline.isActive ? 'ACTIVE' : 'INACTIVE'}
                    </span>
                    <span className="text-[10px] font-mono text-muted-foreground">{selectedPipeline.id.slice(0, 8)}</span>
                    {selectedMeta?.kind === 'fixed' && (
                      <span className="flex items-center gap-0.5 text-[10px] font-mono px-1.5 py-0.5 rounded bg-primary/15 text-primary">
                        <Lock className="w-2.5 h-2.5" /> FIXED{selectedMeta.category ? ` · ${selectedMeta.category}` : ''}
                      </span>
                    )}
                  </div>
                  <h2 className="text-sm font-semibold text-foreground">{selectedPipeline.name}</h2>
                  <p className="text-[11px] text-muted-foreground mt-1">{selectedPipeline.description}</p>
                  {!!selectedMeta?.tags.length && (
                    <div className="flex items-center gap-1 mt-1.5">
                      {selectedMeta.tags.map((t) => (
                        <span key={t} className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{t}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {selectedMeta?.kind === 'fixed' && (
                    <button
                      onClick={() => duplicatePipeline(selectedPipeline)}
                      disabled={duplicating}
                      title="Cria uma cópia customizada para um fluxo diferente, sem afetar o catálogo"
                      className="flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-md border border-primary bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50 transition-colors"
                    >
                      <Copy className="w-3 h-3" />
                      {duplicating ? 'Duplicating...' : 'Duplicar como customizada'}
                    </button>
                  )}
                  <button
                    onClick={() => { setEditingPipeline(selectedPipeline); setEditorOpen(true) }}
                    title={selectedMeta?.kind === 'fixed' ? 'Edição direta é para correção (typo, timeout) — a alteração vale para todas as tasks que usam esta fixa' : undefined}
                    className="flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-md border border-border text-foreground hover:bg-muted/40 transition-colors"
                  >
                    <Edit className="w-3 h-3" />
                    Edit
                  </button>
                  <button
                    onClick={() => toggleActive(selectedPipeline)}
                    className={cn(
                      'flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-md border transition-colors',
                      selectedPipeline.isActive
                        ? 'border-status-waiting/30 text-status-waiting hover:bg-status-waiting/10'
                        : 'border-status-done/30 text-status-done hover:bg-status-done/10'
                    )}
                  >
                    {selectedPipeline.isActive ? <><Pause className="w-3 h-3" /> Deactivate</> : <><Play className="w-3 h-3" /> Activate</>}
                  </button>
                  <button
                    onClick={() => deletePipeline(selectedPipeline.id)}
                    className="flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-md border border-destructive/30 text-destructive hover:bg-destructive/10 transition-colors"
                  >
                    <Trash2 className="w-3 h-3" />
                    Delete
                  </button>
                </div>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-6">
              <div className="rounded-lg border border-border bg-muted/20 p-4">
                <p className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-4">Pipeline Stages</p>
                <div className="space-y-0">
                  {((selectedPipeline.stages as any)?.stages || []).map((stage: any, i: number, arr: any[]) => (
                    <div key={stage.name || i} className="flex items-center gap-3">
                      <div className="flex flex-col items-center">
                        <div className="w-3 h-3 rounded-full border-2 border-primary/50 bg-primary/10 flex items-center justify-center">
                          <span className="text-[8px] font-mono text-primary">{i + 1}</span>
                        </div>
                        {i < arr.length - 1 && (
                          <div className="w-px h-8 bg-border" />
                        )}
                      </div>
                      <div className="flex-1 pb-4">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-foreground">{stage.name}</span>
                          <span className={cn(
                            'text-[9px] font-mono px-1.5 py-0.5 rounded',
                            stage.mode === 'engine' ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'
                          )}>
                            {stage.mode || 'interactive'}
                          </span>
                          {stage.agent && (
                            <span className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 rounded">{stage.agent}</span>
                          )}
                          {stage.timeout && (
                            <span className="text-[10px] font-mono text-muted-foreground">{stage.timeout}m</span>
                          )}
                          {stage.onQuestion === 'pause' && (
                            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-status-waiting/15 text-status-waiting">PAUSES ON Q</span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-border bg-muted/20 p-4">
                <p className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-3">Associated Tasks</p>
                {selectedPipeline.macroTasks?.length ? (
                  <div className="space-y-1.5">
                    {selectedPipeline.macroTasks.map((task: any) => (
                      <div key={task.id} className="flex items-center justify-between px-3 py-2 rounded-md bg-card border border-border/50">
                        <div className="flex items-center gap-2">
                          <div className={cn(
                            'w-1.5 h-1.5 rounded-full',
                            task.status === 'done' ? 'bg-status-done' :
                            task.status === 'running' ? 'bg-status-running animate-pulse' :
                            'bg-muted-foreground/40'
                          )} />
                          <span className="text-xs text-foreground">{task.title}</span>
                        </div>
                        <span className="text-[10px] font-mono text-muted-foreground">{task.status}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No tasks associated with this pipeline.</p>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center space-y-2">
              <Layers className="w-8 h-8 text-muted-foreground mx-auto" />
              <p className="text-sm font-medium text-foreground">Select a pipeline</p>
              <p className="text-xs text-muted-foreground">Choose a pipeline from the list to view details</p>
            </div>
          </div>
        )}
      </div>

      {editorOpen && currentProject && (
        <PipelineEditor
          projectId={currentProject.id}
          templates={templates}
          pipeline={editingPipeline}
          onClose={() => { setEditorOpen(false); setEditingPipeline(null) }}
          onSaved={fetchData}
        />
      )}
      {deletingPipelineId && (() => {
        const target = pipelines.find((p) => p.id === deletingPipelineId)
        const taskCount = target?.macroTasks?.length || 0
        return (
          <ConfirmModal
            title="Delete Pipeline"
            message={
              taskCount > 0
                ? `Usada por ${taskCount} macro task${taskCount > 1 ? 's' : ''} — o banco bloqueia a exclusão enquanto elas existirem. Remova ou reatribua essas tasks antes de tentar excluir.`
                : 'Delete this pipeline?'
            }
            confirmLabel="Delete"
            destructive
            onConfirm={confirmDeletePipeline}
            onCancel={() => setDeletingPipelineId(null)}
          />
        )
      })()}
      </div>
    </Shell>
  )
}
