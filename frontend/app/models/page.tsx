'use client'

import { Shell } from '@/components/shell'
import { ConfirmModal } from '@/components/confirm-modal'
import { SkeletonCard } from '@/components/ui/skeleton'
import { useToast } from '@/components/toast-provider'
import {
  modelsApi,
  pipelinesApi,
  cliProfilesApi,
  type LLMModel,
  type PhaseModelAssignment,
  type CliProfile,
} from '@/lib/api'
import { useProject } from '@/lib/project-context'
import { cn } from '@/lib/utils'
import {
  Cpu,
  Plus,
  X,
  Pencil,
  Trash2,
  Loader2,
  Inbox,
  ToggleLeft,
  ToggleRight,
  AlertCircle,
  Workflow,
  Terminal,
} from 'lucide-react'
import { useState, useEffect, useCallback } from 'react'

const defaultModelForm = {
  provider: '',
  name: '',
  contextSize: '',
  notes: '',
  enabled: true,
}

const defaultAssignmentForm = {
  phase: '',
  modelId: '',
  cliProfileId: '',
  reason: '',
}

const KNOWN_PROVIDERS = ['anthropic', 'openai', 'google', 'mistral', 'meta', 'local']

function formatContext(size?: number | null) {
  if (!size) return null
  if (size >= 1000) return `${Math.round(size / 1000)}k ctx`
  return `${size} ctx`
}

/** stages pode ser `[...]` ou `{ stages: [...] }` (formato do Json do banco). */
function extractStageNames(stagesJson: any): string[] {
  const stages = Array.isArray(stagesJson) ? stagesJson : stagesJson?.stages
  if (!Array.isArray(stages)) return []
  return stages
    .map((s: any) => (typeof s?.name === 'string' ? s.name : null))
    .filter((n: string | null): n is string => !!n)
}

export default function ModelsPage() {
  const [models, setModels] = useState<LLMModel[]>([])
  const [assignments, setAssignments] = useState<PhaseModelAssignment[]>([])
  const [cliProfiles, setCliProfiles] = useState<CliProfile[]>([])
  const [pipelinePhases, setPipelinePhases] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Model modal
  const [showModal, setShowModal] = useState(false)
  const [editingModel, setEditingModel] = useState<LLMModel | null>(null)
  const [form, setForm] = useState(defaultModelForm)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deletingModel, setDeletingModel] = useState<LLMModel | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Assignments
  const [assignmentForm, setAssignmentForm] = useState(defaultAssignmentForm)
  const [creatingAssignment, setCreatingAssignment] = useState(false)
  const [deletingAssignment, setDeletingAssignment] = useState<PhaseModelAssignment | null>(null)
  const [deletingAssignmentBusy, setDeletingAssignmentBusy] = useState(false)

  const { currentProject } = useProject()
  const { toast, update } = useToast()

  const fetchAll = useCallback(async () => {
    setError(null)
    try {
      const [modelList, assignmentList, profiles] = await Promise.all([
        modelsApi.list(),
        modelsApi.getAssignments(),
        cliProfilesApi.list().catch(() => [] as CliProfile[]),
      ])
      setModels(modelList)
      setAssignments(assignmentList)
      setCliProfiles(profiles)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar modelos')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAll()
  }, [fetchAll])

  // Fases sugeridas: stages dos pipelines do projeto atual (modelos são globais,
  // mas as fases vêm dos pipelines) + fases já usadas em assignments.
  useEffect(() => {
    async function fetchPhases() {
      if (!currentProject) {
        setPipelinePhases([])
        return
      }
      try {
        const pipelines = await pipelinesApi.list(currentProject.id)
        const names = new Set<string>()
        for (const p of pipelines) {
          for (const name of extractStageNames(p.stages)) names.add(name)
        }
        setPipelinePhases([...names])
      } catch {
        setPipelinePhases([])
      }
    }
    fetchPhases()
  }, [currentProject])

  const phaseSuggestions = [
    ...new Set([...pipelinePhases, ...assignments.map(a => a.phase)]),
  ].sort()

  // Só sinaliza fase desconhecida quando há um projeto com pipelines para comparar
  const isPhaseUnknown = (phase: string) =>
    !!currentProject && pipelinePhases.length > 0 && !pipelinePhases.includes(phase.trim())

  // ------- Models CRUD -------

  const openCreateModal = () => {
    setEditingModel(null)
    setForm(defaultModelForm)
    setFormError(null)
    setShowModal(true)
  }

  const openEditModal = (model: LLMModel) => {
    setEditingModel(model)
    setForm({
      provider: model.provider,
      name: model.name,
      contextSize: model.contextSize != null ? String(model.contextSize) : '',
      notes: model.notes || '',
      enabled: model.enabled,
    })
    setFormError(null)
    setShowModal(true)
  }

  const handleSave = async () => {
    if (!form.name.trim() || !form.provider.trim()) return
    if (form.contextSize && Number.isNaN(Number(form.contextSize))) {
      setFormError('Context size deve ser um número')
      return
    }
    setSaving(true)
    setFormError(null)
    const toastId = toast('loading', editingModel ? 'Atualizando modelo...' : 'Criando modelo...')
    try {
      const payload: Partial<LLMModel> = {
        provider: form.provider.trim(),
        name: form.name.trim(),
        notes: form.notes.trim() || undefined,
        enabled: form.enabled,
        ...(form.contextSize ? { contextSize: Number(form.contextSize) } : {}),
      }
      if (editingModel) {
        await modelsApi.update(editingModel.id, payload)
        update(toastId, 'success', 'Modelo atualizado')
      } else {
        await modelsApi.create(payload)
        update(toastId, 'success', 'Modelo criado')
      }
      setShowModal(false)
      await fetchAll()
    } catch (err) {
      update(toastId, 'error', 'Erro ao salvar modelo')
      setFormError(err instanceof Error ? err.message : 'Falha ao salvar modelo')
    } finally {
      setSaving(false)
    }
  }

  const toggleEnabled = async (model: LLMModel) => {
    try {
      await modelsApi.update(model.id, { enabled: !model.enabled })
      setModels(prev => prev.map(m => (m.id === model.id ? { ...m, enabled: !m.enabled } : m)))
      toast('success', `Modelo ${model.enabled ? 'desativado' : 'ativado'}`)
    } catch (err) {
      toast('error', 'Erro ao atualizar modelo')
      setError(err instanceof Error ? err.message : 'Falha ao atualizar modelo')
    }
  }

  const handleDelete = async () => {
    if (!deletingModel) return
    setDeleting(true)
    const toastId = toast('loading', 'Deletando modelo...')
    try {
      await modelsApi.delete(deletingModel.id)
      update(toastId, 'success', 'Modelo deletado')
      setDeletingModel(null)
      await fetchAll()
    } catch (err) {
      update(toastId, 'error', 'Erro ao deletar modelo')
      setError(
        err instanceof Error
          ? `${err.message} — remova os assignments do modelo antes de deletá-lo`
          : 'Falha ao deletar modelo',
      )
      setDeletingModel(null)
    } finally {
      setDeleting(false)
    }
  }

  // ------- Assignments -------

  const handleCreateAssignment = async () => {
    if (!assignmentForm.phase.trim() || !assignmentForm.modelId) return
    setCreatingAssignment(true)
    const toastId = toast('loading', 'Criando assignment...')
    try {
      await modelsApi.createAssignment({
        phase: assignmentForm.phase.trim(),
        modelId: assignmentForm.modelId,
        ...(assignmentForm.cliProfileId ? { cliProfileId: assignmentForm.cliProfileId } : {}),
        ...(assignmentForm.reason.trim() ? { reason: assignmentForm.reason.trim() } : {}),
      })
      update(toastId, 'success', 'Assignment criado')
      setAssignmentForm(defaultAssignmentForm)
      await fetchAll()
    } catch (err) {
      update(toastId, 'error', 'Erro ao criar assignment')
      setError(err instanceof Error ? err.message : 'Falha ao criar assignment')
    } finally {
      setCreatingAssignment(false)
    }
  }

  const handleDeleteAssignment = async () => {
    if (!deletingAssignment) return
    setDeletingAssignmentBusy(true)
    const toastId = toast('loading', 'Removendo assignment...')
    try {
      await modelsApi.deleteAssignment(deletingAssignment.id)
      update(toastId, 'success', 'Assignment removido')
      setDeletingAssignment(null)
      await fetchAll()
    } catch (err) {
      update(toastId, 'error', 'Erro ao remover assignment')
      setError(err instanceof Error ? err.message : 'Falha ao remover assignment')
      setDeletingAssignment(null)
    } finally {
      setDeletingAssignmentBusy(false)
    }
  }

  if (loading) {
    return (
      <Shell>
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <header className="flex items-center justify-between px-4 lg:px-6 py-3 border-b border-border bg-card/50 sticky top-0 z-10">
            <div className="space-y-2">
              <div className="h-4 w-16 bg-muted/50 rounded animate-pulse" />
              <div className="h-3 w-32 bg-muted/50 rounded animate-pulse" />
            </div>
          </header>
          <div className="flex-1 min-h-0 overflow-y-auto p-4 lg:p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <SkeletonCard key={i} />
              ))}
            </div>
          </div>
        </div>
      </Shell>
    )
  }

  return (
    <Shell>
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
        <header className="flex items-center justify-between px-4 lg:px-6 py-3 border-b border-border bg-card/50 sticky top-0 z-10">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-semibold text-foreground">Models</h1>
              <span
                className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-primary/15 text-primary border border-primary/20"
                title="Os assignments são aplicados no runtime: ao entrar numa fase, a sessão sobe o CLI com o modelo/profile atribuído. Precedência: atribuição de fase > modelo/CLI profile configurado no Agent"
              >
                aplicado no runtime
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5 max-w-2xl">
              Catálogo de modelos LLM por provider + matriz fase → modelo → CLI profile aplicada no
              runtime das sessões (atribuição de fase &gt; configuração do Agent)
            </p>
            <p className="text-[11px] text-muted-foreground font-mono mt-0.5">
              {models.filter(m => m.enabled).length} enabled · {models.length} total ·{' '}
              {assignments.length} assignments
            </p>
          </div>
          <button
            onClick={openCreateModal}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Adicionar modelo
          </button>
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto p-4 lg:p-6 space-y-6">
          {error && (
            <div className="flex items-start gap-2 p-3 rounded-lg border border-destructive/30 bg-destructive/10">
              <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
              <p className="text-xs text-destructive flex-1">{error}</p>
              <button
                onClick={() => setError(null)}
                className="p-0.5 rounded hover:bg-destructive/10 shrink-0"
              >
                <X className="w-3.5 h-3.5 text-destructive" />
              </button>
            </div>
          )}

          {/* Models grid — LLMModels são globais (sem projectId no schema) */}
          {models.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-60 gap-3">
              <Inbox className="w-10 h-10 text-muted-foreground/50" />
              <div className="text-center max-w-md">
                <p className="text-sm font-medium text-foreground">Nenhum modelo cadastrado</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Este é o catálogo de modelos LLM disponíveis por provider (anthropic, openai...).
                  Cadastre-os para referenciá-los na matriz fase → modelo usada ao configurar os
                  executores.
                </p>
              </div>
              <button
                onClick={openCreateModal}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs bg-primary text-primary-foreground hover:bg-primary/90 transition-colors mt-2"
              >
                <Plus className="w-3.5 h-3.5" />
                Adicionar modelo
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {models.map(model => {
                const modelAssignments = assignments.filter(a => a.modelId === model.id)
                return (
                  <div
                    key={model.id}
                    className={cn(
                      'rounded-lg border bg-card p-4 transition-colors',
                      model.enabled ? 'border-border hover:border-primary/30' : 'border-border/50 opacity-60',
                    )}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Cpu
                          className={cn(
                            'w-4 h-4 shrink-0',
                            model.enabled ? 'text-primary' : 'text-muted-foreground',
                          )}
                        />
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-foreground font-mono truncate">
                            {model.name}
                          </p>
                          {model.notes && (
                            <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">
                              {model.notes}
                            </p>
                          )}
                        </div>
                      </div>
                      <button onClick={() => toggleEnabled(model)} className="shrink-0">
                        {model.enabled ? (
                          <ToggleRight className="w-5 h-5 text-primary" />
                        ) : (
                          <ToggleLeft className="w-5 h-5 text-muted-foreground" />
                        )}
                      </button>
                    </div>
                    <div className="flex items-center gap-2 mt-3 pt-2 border-t border-border/50">
                      <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground uppercase">
                        {model.provider}
                      </span>
                      {model.contextSize != null && (
                        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                          {formatContext(model.contextSize)}
                        </span>
                      )}
                      {modelAssignments.length > 0 && (
                        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-primary/15 text-primary">
                          {modelAssignments.length} fase{modelAssignments.length > 1 ? 's' : ''}
                        </span>
                      )}
                      <div className="ml-auto flex items-center gap-1">
                        <button
                          onClick={() => openEditModal(model)}
                          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                          title="Editar modelo"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => setDeletingModel(model)}
                          className="p-1 rounded text-destructive hover:bg-destructive/10 transition-colors"
                          title="Deletar modelo"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Assignments por fase */}
          <div className="p-4 rounded-lg border border-border bg-card">
            <h2 className="text-sm font-semibold text-foreground mb-1 flex items-center gap-2">
              <Workflow className="w-4 h-4 text-primary" />
              Assignments por fase
            </h2>
            <p className="text-[11px] text-muted-foreground mb-4">
              Define qual modelo (e opcionalmente qual CLI profile) cada fase de pipeline usa — e o
              runtime aplica isso: ao entrar na fase, a sessão sobe o CLI com esse modelo/profile.
              Precedência: <span className="font-mono">atribuição de fase &gt; modelo/CLI profile do
              Agent</span>. Se a atribuição apontar para um modelo desabilitado ou um CLI profile que
              não existe mais, a sessão cai no default do agente e registra um aviso nos logs (o stage
              não é derrubado). Trocar de modelo/profile entre stages{' '}
              <strong className="font-medium text-foreground">reinicia o CLI da sessão</strong> — o
              prompt de cada stage é autocontido (os resumos dos stages já concluídos são
              re-injetados), então o trabalho anterior não é perdido.
              {currentProject
                ? ` Fases sugeridas vêm dos pipelines de ${currentProject.name}, mas qualquer nome de fase é aceito.`
                : ' Selecione um projeto para sugestões de fase, ou digite o nome da fase.'}
            </p>

            {/* Formulário de novo assignment */}
            <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_1fr_1fr_auto] gap-2 mb-4">
              <div>
                <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-1 block">
                  Fase *
                </label>
                <input
                  type="text"
                  list="phase-suggestions"
                  value={assignmentForm.phase}
                  onChange={e => setAssignmentForm({ ...assignmentForm, phase: e.target.value })}
                  className="w-full bg-input rounded-md px-3 py-2 text-xs text-foreground outline-none border border-border focus:border-primary/50 transition-colors"
                  placeholder="ex. Spec, Implement, Review"
                />
                <datalist id="phase-suggestions">
                  {phaseSuggestions.map(phase => (
                    <option key={phase} value={phase} />
                  ))}
                </datalist>
                {assignmentForm.phase.trim() && isPhaseUnknown(assignmentForm.phase) && (
                  <p className="text-[10px] text-amber-500 mt-1 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3 shrink-0" />
                    fase não encontrada nos pipelines do projeto
                  </p>
                )}
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-1 block">
                  Modelo *
                </label>
                <select
                  value={assignmentForm.modelId}
                  onChange={e => setAssignmentForm({ ...assignmentForm, modelId: e.target.value })}
                  className="w-full bg-input rounded-md px-3 py-2 text-xs text-foreground outline-none border border-border focus:border-primary/50 transition-colors"
                >
                  <option value="">Selecione...</option>
                  {models.map(model => (
                    <option key={model.id} value={model.id}>
                      {model.provider}/{model.name}
                      {!model.enabled ? ' (disabled)' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-1 block">
                  CLI Profile
                </label>
                <select
                  value={assignmentForm.cliProfileId}
                  onChange={e => setAssignmentForm({ ...assignmentForm, cliProfileId: e.target.value })}
                  className="w-full bg-input rounded-md px-3 py-2 text-xs text-foreground outline-none border border-border focus:border-primary/50 transition-colors"
                >
                  <option value="">Nenhum</option>
                  {cliProfiles.map(profile => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-1 block">
                  Motivo
                </label>
                <input
                  type="text"
                  value={assignmentForm.reason}
                  onChange={e => setAssignmentForm({ ...assignmentForm, reason: e.target.value })}
                  className="w-full bg-input rounded-md px-3 py-2 text-xs text-foreground outline-none border border-border focus:border-primary/50 transition-colors"
                  placeholder="opcional"
                />
              </div>
              <div className="flex items-end">
                <button
                  onClick={handleCreateAssignment}
                  disabled={
                    creatingAssignment || !assignmentForm.phase.trim() || !assignmentForm.modelId
                  }
                  className="flex items-center gap-1.5 px-3 py-2 rounded-md text-xs bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {creatingAssignment ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Plus className="w-3.5 h-3.5" />
                  )}
                  Atribuir
                </button>
              </div>
            </div>

            {/* Tabela fase -> modelo */}
            {assignments.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 gap-2 border border-dashed border-border rounded-md">
                <Workflow className="w-6 h-6 text-muted-foreground/50" />
                <p className="text-xs font-medium text-foreground">Nenhum assignment fase → modelo</p>
                <p className="text-[11px] text-muted-foreground text-center max-w-sm">
                  Sem assignment, cada fase roda com o modelo/CLI profile configurado no Agent da
                  sessão. Atribua aqui para que uma fase específica rode com outro modelo — o runtime
                  passa a usá-lo automaticamente nessa fase.
                </p>
                {models.length === 0 ? (
                  <button
                    onClick={openCreateModal}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs bg-primary text-primary-foreground hover:bg-primary/90 transition-colors mt-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Adicionar um modelo primeiro
                  </button>
                ) : (
                  <p className="text-[10px] text-muted-foreground/70">
                    Use o formulário acima para criar o primeiro assignment
                  </p>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground font-normal py-2 pr-4">
                        Fase
                      </th>
                      <th className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground font-normal py-2 pr-4">
                        Modelo
                      </th>
                      <th className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground font-normal py-2 pr-4">
                        CLI Profile
                      </th>
                      <th className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground font-normal py-2 pr-4">
                        Motivo
                      </th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {assignments.map(assignment => (
                      <tr
                        key={assignment.id}
                        className="border-b border-border/50 last:border-0 hover:bg-muted/20 transition-colors"
                      >
                        <td className="py-2 pr-4">
                          <span className="inline-flex items-center gap-1.5">
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-primary/15 text-primary">
                              {assignment.phase}
                            </span>
                            {isPhaseUnknown(assignment.phase) && (
                              <span title="Fase não encontrada nos pipelines do projeto atual">
                                <AlertCircle className="w-3 h-3 text-amber-500" />
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="py-2 pr-4">
                          <span className="text-xs font-mono text-foreground">
                            {assignment.model
                              ? `${assignment.model.provider}/${assignment.model.name}`
                              : assignment.modelId}
                          </span>
                        </td>
                        <td className="py-2 pr-4">
                          {assignment.cliProfile ? (
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground inline-flex items-center gap-1">
                              <Terminal className="w-2.5 h-2.5" />
                              {assignment.cliProfile.name}
                            </span>
                          ) : (
                            <span className="text-[10px] text-muted-foreground/50">—</span>
                          )}
                        </td>
                        <td className="py-2 pr-4">
                          <span className="text-[11px] text-muted-foreground">
                            {assignment.reason || '—'}
                          </span>
                        </td>
                        <td className="py-2">
                          <button
                            onClick={() => setDeletingAssignment(assignment)}
                            className="p-1 rounded text-destructive hover:bg-destructive/10 transition-colors"
                            title="Remover assignment"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Modal criar/editar modelo */}
        {showModal && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
            onClick={() => !saving && setShowModal(false)}
          >
            <div
              className="w-full max-w-md rounded-lg border border-border bg-card shadow-xl max-h-[90vh] overflow-y-auto"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-card z-10">
                <h2 className="text-sm font-semibold text-foreground">
                  {editingModel ? 'Edit Model' : 'New Model'}
                </h2>
                <button
                  onClick={() => !saving && setShowModal(false)}
                  className="p-1 rounded hover:bg-muted/40"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="px-6 py-4 space-y-4">
                <div>
                  <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-1 block">
                    Provider *
                  </label>
                  <input
                    type="text"
                    list="provider-suggestions"
                    value={form.provider}
                    onChange={e => setForm({ ...form, provider: e.target.value })}
                    className="w-full bg-input rounded-md px-3 py-2 text-xs text-foreground outline-none border border-border focus:border-primary/50 transition-colors"
                    placeholder="ex. anthropic, openai"
                  />
                  <datalist id="provider-suggestions">
                    {KNOWN_PROVIDERS.map(p => (
                      <option key={p} value={p} />
                    ))}
                  </datalist>
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-1 block">
                    Name *
                  </label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={e => setForm({ ...form, name: e.target.value })}
                    className="w-full bg-input rounded-md px-3 py-2 text-xs text-foreground outline-none border border-border focus:border-primary/50 transition-colors font-mono"
                    placeholder="ex. claude-sonnet-4"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-1 block">
                    Context Size (tokens)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={form.contextSize}
                    onChange={e => setForm({ ...form, contextSize: e.target.value })}
                    className="w-full bg-input rounded-md px-3 py-2 text-xs text-foreground outline-none border border-border focus:border-primary/50 transition-colors font-mono"
                    placeholder="ex. 200000"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-1 block">
                    Notes
                  </label>
                  <textarea
                    value={form.notes}
                    onChange={e => setForm({ ...form, notes: e.target.value })}
                    rows={3}
                    className="w-full bg-input rounded-md px-3 py-2 text-xs text-foreground outline-none border border-border focus:border-primary/50 transition-colors resize-none"
                    placeholder="Observações sobre o modelo (custo, uso recomendado...)"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setForm({ ...form, enabled: !form.enabled })}
                    className="shrink-0"
                  >
                    {form.enabled ? (
                      <ToggleRight className="w-5 h-5 text-primary" />
                    ) : (
                      <ToggleLeft className="w-5 h-5 text-muted-foreground" />
                    )}
                  </button>
                  <span className="text-[10px] text-muted-foreground">
                    {form.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
                {formError && <p className="text-[11px] text-destructive">{formError}</p>}
              </div>
              <div className="px-6 py-3 border-t border-border flex justify-end gap-2 sticky bottom-0 bg-card">
                <button
                  onClick={() => setShowModal(false)}
                  disabled={saving}
                  className="text-[11px] text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-md transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || !form.name.trim() || !form.provider.trim()}
                  className="flex items-center gap-1.5 text-[11px] bg-primary text-primary-foreground px-3 py-1.5 rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {saving ? (
                    <>
                      <Loader2 className="w-3 h-3 animate-spin" /> Saving...
                    </>
                  ) : (
                    'Save'
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {deletingModel && (
          <ConfirmModal
            title="Delete Model"
            message={`Tem certeza que deseja deletar "${deletingModel.provider}/${deletingModel.name}"? Esta ação não pode ser desfeita.`}
            confirmLabel="Delete"
            destructive
            loading={deleting}
            onConfirm={handleDelete}
            onCancel={() => setDeletingModel(null)}
          />
        )}

        {deletingAssignment && (
          <ConfirmModal
            title="Remover Assignment"
            message={`Remover o assignment da fase "${deletingAssignment.phase}"${
              deletingAssignment.model ? ` (${deletingAssignment.model.name})` : ''
            }?`}
            confirmLabel="Remover"
            destructive
            loading={deletingAssignmentBusy}
            onConfirm={handleDeleteAssignment}
            onCancel={() => setDeletingAssignment(null)}
          />
        )}
      </div>
    </Shell>
  )
}
