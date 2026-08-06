'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { useToast } from '@/components/toast-provider'
import {
  pipelinesApi,
  modelsApi,
  cliProfilesApi,
  cliFilesApi,
  cliLibraryApi,
  cliSkillsApi,
  cliSkillsLibraryApi,
  projectsApi,
  type Pipeline,
  type PipelineKind,
  type PipelineTemplate,
  type PipelineDefaults,
  type LLMModel,
  type CliProfile,
  type ProjectDefaults,
} from '@/lib/api'
import {
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  X,
  Zap,
  AlertCircle,
  AlertTriangle,
  FileText,
  Settings2,
} from 'lucide-react'

export interface StageForm {
  name: string
  mode: 'interactive' | 'engine'
  timeout: string // string no form; convertido ao salvar
  onQuestion: 'pause' | 'continue'
  promptTemplate: string
  // MT-3: runtime por estágio — '' = herda do pipeline/projeto, nunca texto livre.
  model: string
  cliProfile: string
  subagents: string[]
  skills: string[]
  // MT-18: os dois campos do contrato §1 que a UI só sabia preservar. `'' =`
  // herda do pipeline. `extraMcpServers` fica como texto no form para o usuário
  // poder digitar Json incompleto sem a tela quebrar — validado no save.
  permissionMode: string
  extraMcpServers: string
}

/** Espelha `PipelineDefaults` do form (timeout como string, igual ao StageForm). */
interface DefaultsForm {
  model: string
  cliProfile: string
  subagents: string[]
  skills: string[]
  timeout: string
}

/**
 * MT-18: metadados de catálogo do contrato §2. Antes só a migração da MT-3 e o
 * "duplicar como customizada" gravavam isso — pipeline criada pela UI nascia sem
 * `category`/`tags` e, por consequência, invisível nos filtros da /pipelines.
 */
interface CatalogForm {
  kind: PipelineKind
  category: string
  tags: string[]
}

/**
 * Fallback retroativo: o modo "oneshot" (CLI headless paralelo à sessão tmux)
 * foi removido do engine. Pipelines salvos antes disso ainda podem trazer o
 * valor no JSON — exibe como "interactive", que é como o backend já os executa.
 */
function normalizeStageMode(mode: unknown): StageForm['mode'] {
  return mode === 'engine' ? 'engine' : 'interactive'
}

interface PipelineEditorProps {
  projectId: string
  templates: PipelineTemplate[]
  /** Pipeline existente para editar; null/undefined = criar nova. */
  pipeline?: Pipeline | null
  onClose: () => void
  onSaved: () => void
}

function stagesFromPipeline(pipeline: Pipeline): StageForm[] {
  const raw = (pipeline.stages as any)?.stages || (Array.isArray(pipeline.stages) ? pipeline.stages : [])
  return raw.map((s: any) => ({
    name: s.name || '',
    mode: normalizeStageMode(s.mode),
    timeout: s.timeout != null ? String(s.timeout) : '',
    onQuestion: s.onQuestion || 'pause',
    promptTemplate: s.promptTemplate || '',
    model: s.model || '',
    cliProfile: s.cliProfile || '',
    subagents: Array.isArray(s.subagents) ? s.subagents : [],
    skills: Array.isArray(s.skills) ? s.skills : [],
    permissionMode: s.permissionMode || '',
    extraMcpServers: s.extraMcpServers ? JSON.stringify(s.extraMcpServers, null, 2) : '',
  }))
}

function catalogFromPipeline(pipeline?: Pipeline | null): CatalogForm {
  const def = (pipeline?.stages as any) || {}
  return {
    // Mesma leitura da /pipelines: pipeline sem `kind` gravado conta como custom.
    kind: def.kind === 'fixed' ? 'fixed' : 'custom',
    category: typeof def.category === 'string' ? def.category : '',
    tags: Array.isArray(def.tags) ? def.tags.filter((t: unknown) => typeof t === 'string') : [],
  }
}

function defaultsFromPipeline(pipeline?: Pipeline | null): DefaultsForm {
  const d: PipelineDefaults = (pipeline?.stages as any)?.defaults || {}
  return {
    model: d.model || '',
    cliProfile: d.cliProfile || '',
    subagents: Array.isArray(d.subagents) ? d.subagents : [],
    skills: Array.isArray(d.skills) ? d.skills : [],
    timeout: d.timeout != null ? String(d.timeout) : '',
  }
}

const EMPTY_STAGE: StageForm = {
  name: '',
  mode: 'interactive',
  timeout: '30',
  onQuestion: 'pause',
  promptTemplate: '',
  model: '',
  cliProfile: '',
  subagents: [],
  skills: [],
  permissionMode: '',
  extraMcpServers: '',
}

const EMPTY_DEFAULTS: DefaultsForm = { model: '', cliProfile: '', subagents: [], skills: [], timeout: '' }
/** Pipeline nova nasce customizada: `fixed` é catálogo geral, decisão consciente. */
const EMPTY_CATALOG: CatalogForm = { kind: 'custom', category: '', tags: [] }

const selectClass =
  'bg-input border border-border rounded-md px-2 py-1.5 text-xs outline-none focus:border-primary/40'

/**
 * Multi-select de tags a partir de uma lista fechada (subagentes ou skills
 * reais do disco) — nada de texto livre. Um valor já salvo que não está mais
 * em `options` (arquivo apagado do projeto/biblioteca) aparece com aviso em
 * vez de simplesmente sumir da UI.
 */
function TagMultiSelect({
  values,
  options,
  onChange,
  placeholder,
}: {
  values: string[]
  options: string[]
  onChange: (next: string[]) => void
  placeholder: string
}) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const toggle = (v: string) => {
    onChange(values.includes(v) ? values.filter((x) => x !== v) : [...values, v])
  }

  // Fecha no clique fora e no Escape. `mousedown` (e não `click`) para o
  // dropdown não continuar aberto por cima do controle que o usuário acabou de
  // mirar; os listeners só existem enquanto está aberto.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full min-h-[30px] flex flex-wrap items-center gap-1 bg-input border border-border rounded-md px-2 py-1 text-left"
      >
        {values.length === 0 && <span className="text-[10px] text-muted-foreground">{placeholder}</span>}
        {values.map((v) => {
          const invalid = !options.includes(v)
          return (
            <span
              key={v}
              className={cn(
                'flex items-center gap-0.5 text-[9px] font-mono px-1.5 py-0.5 rounded',
                invalid ? 'bg-destructive/15 text-destructive' : 'bg-muted text-foreground',
              )}
              title={invalid ? 'Não encontrado no projeto nem na biblioteca — pode ter sido apagado do disco' : undefined}
            >
              {invalid && <AlertTriangle className="w-2.5 h-2.5" />}
              {v}
            </span>
          )
        })}
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full max-h-44 overflow-y-auto rounded-md border border-border bg-card shadow-xl p-1 space-y-0.5">
          {options.length === 0 && (
            <p className="text-[10px] text-muted-foreground px-2 py-1.5">Nenhum encontrado no projeto/biblioteca</p>
          )}
          {options.map((o) => (
            <label key={o} className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-muted/40 cursor-pointer">
              <input
                type="checkbox"
                checked={values.includes(o)}
                onChange={() => toggle(o)}
                className="accent-primary"
              />
              <span className="text-[10px] font-mono truncate">{o}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Editor visual de pipeline: criar do zero ou de template, editar stages
 * (nome, modo, timeout, onQuestion, prompt, model/cliProfile/subagents/skills),
 * defaults do pipeline com herança visível, reordenar e validar.
 */
export function PipelineEditor({ projectId, templates, pipeline, onClose, onSaved }: PipelineEditorProps) {
  const isEdit = !!pipeline
  const { toast } = useToast()
  const [name, setName] = useState(pipeline?.name || '')
  const [description, setDescription] = useState(pipeline?.description || '')
  const [stages, setStages] = useState<StageForm[]>(
    pipeline ? stagesFromPipeline(pipeline) : [{ ...EMPTY_STAGE }],
  )
  const [defaults, setDefaults] = useState<DefaultsForm>(defaultsFromPipeline(pipeline))
  const [catalog, setCatalog] = useState<CatalogForm>(catalogFromPipeline(pipeline))
  const [tagDraft, setTagDraft] = useState('')
  const [expandedPrompt, setExpandedPrompt] = useState<number | null>(null)
  const [expandedConfig, setExpandedConfig] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [showTemplates, setShowTemplates] = useState(!isEdit)

  // Opções reais de model/cliProfile/subagentes/skills — carregadas uma vez
  // por projeto. Falha aqui não bloqueia o editor: só deixa os selects vazios,
  // o valor já salvo no pipeline continua visível (com aviso se inválido).
  const [models, setModels] = useState<LLMModel[]>([])
  const [cliProfiles, setCliProfiles] = useState<CliProfile[]>([])
  const [agentOptions, setAgentOptions] = useState<string[]>([])
  const [skillOptions, setSkillOptions] = useState<string[]>([])
  const [projectDefaults, setProjectDefaults] = useState<ProjectDefaults>({})

  // Aviso quantificado ao editar uma pipeline fixa (decisão do usuário: kind
  // é metadado de catálogo, não permissão — sem bloqueio no backend, só aqui
  // um banner com número real de tasks e, se alguma estiver rodando agora,
  // uma confirmação explícita antes de liberar o Save).
  const isFixed = isEdit && (pipeline?.stages as any)?.kind === 'fixed'
  const taskCount = pipeline?.macroTasks?.length || 0
  // Mesmo conjunto de status que `macro-tasks.service.ts` trata como "ativa"
  // (sessão de verdade ocupada, mesmo pausada esperando resposta) — contar só
  // 'running' subestimaria o número e o aviso perderia a credibilidade.
  const activeTaskCount = (pipeline?.macroTasks || []).filter(
    (t: any) => t.status === 'running' || t.status === 'waiting',
  ).length
  const [confirmedFixedEdit, setConfirmedFixedEdit] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function loadOptions() {
      try {
        const [modelsRes, profilesRes, projectAgents, libraryAgents, projectSkills, librarySkills, projDefaults] =
          await Promise.all([
            modelsApi.list(),
            cliProfilesApi.list(),
            cliFilesApi.list(projectId, 'agents'),
            cliLibraryApi.list('agents'),
            cliSkillsApi.list(projectId),
            cliSkillsLibraryApi.list(),
            projectsApi.getDefaults(projectId),
          ])
        if (cancelled) return
        setModels(modelsRes.filter((m) => m.enabled))
        setCliProfiles(profilesRes)
        // Identificador do subagente é o nome do arquivo sem extensão (mesma
        // convenção da página /agents) — não o `name` do frontmatter, que pode
        // divergir do arquivo.
        const agents = new Set<string>()
        for (const target of projectAgents.targets) {
          for (const file of target.files) agents.add(file.fileName.replace(/\.md$/, ''))
        }
        for (const file of libraryAgents.files) agents.add(file.fileName.replace(/\.md$/, ''))
        setAgentOptions(Array.from(agents).sort())
        const skills = new Set<string>()
        for (const target of projectSkills.targets) {
          for (const skill of target.skills) skills.add(skill.dirName)
        }
        for (const skill of librarySkills.skills) skills.add(skill.dirName)
        setSkillOptions(Array.from(skills).sort())
        setProjectDefaults(projDefaults)
      } catch (error: any) {
        // Não bloqueia o editor (os selects só ficam vazios), mas o usuário
        // precisa saber POR QUE a lista de subagentes/skills veio vazia — antes
        // isso morria no console e parecia "não existe nenhum no projeto".
        if (cancelled) return
        console.error('Failed to load pipeline editor options:', error)
        toast('error', `Falha ao carregar model/CLI/subagentes/skills: ${error?.message || 'erro desconhecido'}`)
      }
    }
    loadOptions()
    return () => {
      cancelled = true
    }
  }, [projectId, toast])

  const applyTemplate = (template: PipelineTemplate) => {
    if (!name) setName(template.name)
    if (!description) setDescription(template.description || '')
    setStages(
      (template.stages as any[]).map((s) => ({
        name: s.name || '',
        mode: normalizeStageMode(s.mode),
        timeout: s.timeout != null ? String(s.timeout) : '',
        onQuestion: s.onQuestion || 'pause',
        promptTemplate: s.promptTemplate || '',
        model: '',
        cliProfile: '',
        subagents: [],
        skills: [],
        permissionMode: s.permissionMode || '',
        extraMcpServers: s.extraMcpServers ? JSON.stringify(s.extraMcpServers, null, 2) : '',
      })),
    )
    setDefaults({ ...EMPTY_DEFAULTS })
    setCatalog({ ...EMPTY_CATALOG })
    setShowTemplates(false)
  }

  /** Confirma o rascunho de tag. Dedup e trim aqui: o contrato recusa string vazia. */
  const addTag = () => {
    const value = tagDraft.trim()
    setTagDraft('')
    if (!value) return
    setCatalog((c) => (c.tags.includes(value) ? c : { ...c, tags: [...c.tags, value] }))
  }

  const updateStage = (index: number, patch: Partial<StageForm>) => {
    setStages((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)))
  }

  const removeStage = (index: number) => {
    setStages((prev) => prev.filter((_, i) => i !== index))
    if (expandedPrompt === index) setExpandedPrompt(null)
    if (expandedConfig === index) setExpandedConfig(null)
  }

  const moveStage = (index: number, dir: -1 | 1) => {
    setStages((prev) => {
      const target = index + dir
      if (target < 0 || target >= prev.length) return prev
      const next = [...prev]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
    setExpandedPrompt(null)
    setExpandedConfig(null)
  }

  /**
   * `extraMcpServers` é editado como texto Json. Devolve `undefined` para campo
   * vazio (não grava a chave) e lança com mensagem legível em Json inválido, em
   * vez de deixar o `JSON.parse` estourar dentro do save.
   */
  const parseExtraMcpServers = (raw: string, label: string): Record<string, unknown> | undefined => {
    if (!raw.trim()) return undefined
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (err: any) {
      throw new Error(`${label}: extraMcpServers is not valid JSON (${err.message})`)
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error(`${label}: extraMcpServers must be a JSON object (server name -> config)`)
    }
    return parsed as Record<string, unknown>
  }

  const validate = (): string | null => {
    if (!name.trim()) return 'Pipeline name is required'
    if (stages.length === 0) return 'Pipeline must have at least one stage'
    const names = new Set<string>()
    for (const [i, stage] of stages.entries()) {
      if (!stage.name.trim()) return `Stage #${i + 1} needs a name`
      if (names.has(stage.name.trim())) return `Duplicate stage name: ${stage.name.trim()}`
      names.add(stage.name.trim())
      if (stage.timeout && (!/^\d+$/.test(stage.timeout) || parseInt(stage.timeout, 10) <= 0)) {
        return `Stage "${stage.name}": timeout must be a positive number of minutes`
      }
      try {
        parseExtraMcpServers(stage.extraMcpServers, `Stage "${stage.name.trim() || i + 1}"`)
      } catch (err: any) {
        return err.message
      }
    }
    if (defaults.timeout && (!/^\d+$/.test(defaults.timeout) || parseInt(defaults.timeout, 10) <= 0)) {
      return 'Pipeline defaults: timeout must be a positive number of minutes'
    }
    return null
  }

  const save = async () => {
    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }
    setError(null)
    setSaving(true)
    try {
      await persist()
      onSaved()
      onClose()
    } catch (err: any) {
      setError(err?.message || 'Failed to save pipeline')
    } finally {
      setSaving(false)
    }
  }

  /**
   * Monta o payload e grava. Separado do `save` para o `try` cobrir também a
   * MONTAGEM: `parseExtraMcpServers` lança, e fora do try o `saving` ficaria
   * preso em true sem mensagem nenhuma na tela.
   */
  const persist = async () => {
    // O que ESTA UI ainda não edita — `permissions` (allowlist do worktree) e o
    // par extraMcpServers/permissionMode do NÍVEL PIPELINE — é preservado do
    // registro gravado. CRÍTICO: `update` faz replace do JSON inteiro de
    // `stages`, não merge; sem isto, salvar qualquer campo daqui apagaria a
    // allowlist das 4 pipelines fixas (17-21 regras cada).
    //
    // MT-18: os campos POR ESTÁGIO saíram desta lista. Antes eram copiados do
    // original casando `stage.name`, o que sumia com eles em qualquer rename e
    // não havia como criar os dois num estágio novo — agora vêm do form.
    const existingMeta = (pipeline?.stages as any) || {}
    const hasDefaults =
      defaults.model || defaults.cliProfile || defaults.subagents.length || defaults.skills.length || defaults.timeout
    const payload = {
      name: name.trim(),
      description: description.trim() || undefined,
      stages: {
        stages: stages.map((s) => {
          const extraMcpServers = parseExtraMcpServers(s.extraMcpServers, `Stage "${s.name.trim()}"`)
          return {
            name: s.name.trim(),
            mode: s.mode,
            ...(s.timeout ? { timeout: parseInt(s.timeout, 10) } : {}),
            onQuestion: s.onQuestion,
            ...(s.promptTemplate.trim() ? { promptTemplate: s.promptTemplate.trim() } : {}),
            ...(s.model ? { model: s.model } : {}),
            ...(s.cliProfile ? { cliProfile: s.cliProfile } : {}),
            ...(s.subagents.length ? { subagents: s.subagents } : {}),
            ...(s.skills.length ? { skills: s.skills } : {}),
            ...(s.permissionMode.trim() ? { permissionMode: s.permissionMode.trim() } : {}),
            ...(extraMcpServers ? { extraMcpServers } : {}),
          }
        }),
        kind: catalog.kind,
        ...(catalog.category.trim() ? { category: catalog.category.trim() } : {}),
        ...(catalog.tags.length ? { tags: catalog.tags } : {}),
        ...(existingMeta.permissions ? { permissions: existingMeta.permissions } : {}),
        ...(existingMeta.extraMcpServers ? { extraMcpServers: existingMeta.extraMcpServers } : {}),
        ...(existingMeta.permissionMode ? { permissionMode: existingMeta.permissionMode } : {}),
        ...(hasDefaults
          ? {
              defaults: {
                ...(defaults.model ? { model: defaults.model } : {}),
                ...(defaults.cliProfile ? { cliProfile: defaults.cliProfile } : {}),
                ...(defaults.subagents.length ? { subagents: defaults.subagents } : {}),
                ...(defaults.skills.length ? { skills: defaults.skills } : {}),
                ...(defaults.timeout ? { timeout: parseInt(defaults.timeout, 10) } : {}),
              },
            }
          : {}),
      },
    }
    if (isEdit && pipeline) {
      await pipelinesApi.update(projectId, pipeline.id, payload)
    } else {
      await pipelinesApi.create(projectId, { ...payload, isActive: true })
    }
  }

  const modelOptions = models.map((m) => m.name)
  const cliProfileOptions = cliProfiles.map((p) => p.name)
  // Valor que um STAGE vazio efetivamente herdaria (pipeline.defaults vence,
  // projeto é o fallback) — só para escalares, onde "o mais forte ganha".
  const inheritedModel = defaults.model || projectDefaults.model
  const inheritedCliProfile = defaults.cliProfile || projectDefaults.cliProfile
  const inheritedTimeout = defaults.timeout ? parseInt(defaults.timeout, 10) : projectDefaults.timeout
  // `permissionMode` não está em `defaults` de propósito (contratos §2): mora no
  // nível do pipeline, que esta UI preserva sem editar — daí ler do gravado.
  const inheritedPermissionMode =
    ((pipeline?.stages as any)?.permissionMode as string | undefined) || projectDefaults.permissionMode
  const preservedMeta = (() => {
    const meta = (pipeline?.stages as any) || {}
    const parts: string[] = []
    if (Array.isArray(meta.permissions) && meta.permissions.length) {
      parts.push(`permissions (${meta.permissions.length} regras)`)
    }
    if (meta.permissionMode) parts.push(`permissionMode do pipeline: ${meta.permissionMode}`)
    const extras = meta.extraMcpServers ? Object.keys(meta.extraMcpServers) : []
    if (extras.length) parts.push(`MCP extras do pipeline: ${extras.join(', ')}`)
    return parts
  })()
  // subagents/skills são UNIÃO, não substituição — o que o pipeline/projeto
  // define entra sempre, independente do que o stage escolher.
  const alwaysMergedSubagents = Array.from(new Set([...(projectDefaults.subagents || []), ...defaults.subagents]))
  const alwaysMergedSkills = Array.from(new Set([...(projectDefaults.skills || []), ...defaults.skills]))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-3xl max-h-[90vh] flex flex-col rounded-lg border border-border bg-card shadow-xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              {isEdit ? 'Edit Pipeline' : 'New Pipeline'}
            </h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {isEdit ? pipeline?.name : 'Build from scratch or start from a template'}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-muted/40 transition-colors">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 space-y-4">
          {isFixed && (
            <div className="flex items-start gap-2 p-3 rounded-md bg-primary/10 border border-primary/30">
              <AlertTriangle className="w-4 h-4 text-primary shrink-0 mt-0.5" />
              <div className="space-y-1.5 flex-1">
                <p className="text-xs text-foreground">
                  Esta é uma pipeline <strong>fixa do catálogo</strong>, usada por {taskCount} macro task
                  {taskCount === 1 ? '' : 's'} {activeTaskCount > 0 ? `(${activeTaskCount} com sessão rodando agora)` : ''}.
                  A alteração vale para todas elas. Sessões já em andamento não são afetadas — elas rodam a
                  partir de um snapshot do pipeline tirado no início.
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Editar aqui é para <strong>correção</strong> (typo, timeout, allowlist). Para um fluxo
                  diferente, feche e use "Duplicar como customizada" em vez de mudar esta.
                </p>
                {activeTaskCount > 0 && (
                  <label className="flex items-center gap-1.5 text-[11px] text-foreground cursor-pointer pt-1">
                    <input
                      type="checkbox"
                      checked={confirmedFixedEdit}
                      onChange={(e) => setConfirmedFixedEdit(e.target.checked)}
                      className="accent-primary"
                    />
                    Entendi que isso afeta {activeTaskCount} task{activeTaskCount === 1 ? '' : 's'} com sessão rodando agora
                  </label>
                )}
              </div>
            </div>
          )}
          {!isEdit && (
            <div>
              <button
                onClick={() => setShowTemplates((v) => !v)}
                className="flex items-center gap-1.5 text-[11px] text-primary hover:underline"
              >
                <Zap className="w-3 h-3" />
                {showTemplates ? 'Hide templates' : 'Start from a template'}
              </button>
              {showTemplates && (
                <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {templates.map((template) => (
                    <button
                      key={template.name}
                      onClick={() => applyTemplate(template)}
                      className="text-left rounded-lg border border-border bg-muted/20 p-3 hover:border-primary/40 hover:bg-accent/10 transition-colors"
                    >
                      <span className="text-xs font-semibold text-foreground block">{template.name}</span>
                      <span className="text-[10px] text-muted-foreground block mt-1">
                        {(template.stages as any[]).length} stages
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] uppercase tracking-widest text-muted-foreground block mb-1">Name *</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-input border border-border rounded-md px-3 py-2 text-xs text-foreground outline-none focus:border-primary/40"
                placeholder="e.g. Feature SDD"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-widest text-muted-foreground block mb-1">Description</label>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full bg-input border border-border rounded-md px-3 py-2 text-xs text-foreground outline-none focus:border-primary/40"
                placeholder="What this pipeline does"
              />
            </div>
          </div>

          <div className="rounded-lg border border-border bg-muted/10 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[10px] uppercase tracking-widest text-muted-foreground">Catálogo</label>
              <span className="text-[10px] text-muted-foreground">usado pelos filtros da página</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <select
                value={catalog.kind}
                onChange={(e) => setCatalog((c) => ({ ...c, kind: e.target.value as PipelineKind }))}
                className={selectClass}
                title="fixed = catálogo geral reusável; custom = fluxo específico deste projeto"
              >
                <option value="custom">custom — fluxo do projeto</option>
                <option value="fixed">fixed — catálogo geral</option>
              </select>
              <input
                value={catalog.category}
                onChange={(e) => setCatalog((c) => ({ ...c, category: e.target.value }))}
                className="bg-input border border-border rounded-md px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary/40"
                placeholder="category (ex.: sdd-simples)"
              />
              <div className="flex flex-wrap items-center gap-1 bg-input border border-border rounded-md px-2 py-1">
                {catalog.tags.map((tag) => (
                  <span key={tag} className="flex items-center gap-0.5 text-[9px] font-mono px-1.5 py-0.5 rounded bg-muted text-foreground">
                    {tag}
                    <button
                      type="button"
                      onClick={() => setCatalog((c) => ({ ...c, tags: c.tags.filter((t) => t !== tag) }))}
                      className="text-muted-foreground hover:text-destructive"
                      title={`Remover tag ${tag}`}
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </span>
                ))}
                <input
                  value={tagDraft}
                  onChange={(e) => setTagDraft(e.target.value)}
                  onKeyDown={(e) => {
                    // Enter/vírgula confirmam a tag; Backspace no campo vazio
                    // apaga a última, que é o comportamento esperado de chips.
                    if (e.key === 'Enter' || e.key === ',') {
                      e.preventDefault()
                      addTag()
                    } else if (e.key === 'Backspace' && !tagDraft && catalog.tags.length) {
                      setCatalog((c) => ({ ...c, tags: c.tags.slice(0, -1) }))
                    }
                  }}
                  onBlur={addTag}
                  className="flex-1 min-w-[70px] bg-transparent text-xs text-foreground outline-none"
                  placeholder={catalog.tags.length ? '' : 'tags (Enter)'}
                />
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-muted/10 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[10px] uppercase tracking-widest text-muted-foreground">Pipeline defaults</label>
              <span className="text-[10px] text-muted-foreground">herdado por todo estágio que não sobrescrever</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              <select
                value={defaults.model}
                onChange={(e) => setDefaults((d) => ({ ...d, model: e.target.value }))}
                className={cn(selectClass, !defaults.model && 'text-muted-foreground')}
              >
                <option value="">{projectDefaults.model ? `— herda: ${projectDefaults.model}` : '— model'}</option>
                {modelOptions.map((m) => (
                  <option key={m} value={m} className="text-foreground">{m}</option>
                ))}
              </select>
              <select
                value={defaults.cliProfile}
                onChange={(e) => setDefaults((d) => ({ ...d, cliProfile: e.target.value }))}
                className={cn(selectClass, !defaults.cliProfile && 'text-muted-foreground')}
              >
                <option value="">{projectDefaults.cliProfile ? `— herda: ${projectDefaults.cliProfile}` : '— cliProfile'}</option>
                {cliProfileOptions.map((p) => (
                  <option key={p} value={p} className="text-foreground">{p}</option>
                ))}
              </select>
              <TagMultiSelect
                values={defaults.subagents}
                options={agentOptions}
                onChange={(next) => setDefaults((d) => ({ ...d, subagents: next }))}
                placeholder="subagents"
              />
              <TagMultiSelect
                values={defaults.skills}
                options={skillOptions}
                onChange={(next) => setDefaults((d) => ({ ...d, skills: next }))}
                placeholder="skills"
              />
              <input
                value={defaults.timeout}
                onChange={(e) => setDefaults((d) => ({ ...d, timeout: e.target.value }))}
                placeholder={projectDefaults.timeout ? `${projectDefaults.timeout} (projeto)` : 'timeout'}
                inputMode="numeric"
                className="bg-input border border-border rounded-md px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary/40"
              />
            </div>
            {!!(projectDefaults.subagents?.length || projectDefaults.skills?.length) && (
              <p className="text-[10px] text-muted-foreground">
                Projeto sempre soma: {[...(projectDefaults.subagents || []), ...(projectDefaults.skills || [])].join(', ')}
              </p>
            )}
            {isEdit && !!preservedMeta.length && (
              // Estes três ficam no nível do pipeline e esta UI não os edita —
              // dizer que existem evita a leitura de que salvar aqui os apagou.
              <p className="text-[10px] text-muted-foreground">
                Preservados sem edição: {preservedMeta.join(' · ')}
              </p>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Stages ({stages.length})
              </label>
              <span className="text-[10px] text-muted-foreground">
                mode: interactive = CLI session · engine = orchestrator (Merge)
              </span>
            </div>
            <div className="space-y-2">
              {stages.map((stage, i) => (
                <div key={i} className="rounded-lg border border-border bg-muted/10 p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-primary w-5 shrink-0">{i + 1}.</span>
                    <input
                      value={stage.name}
                      onChange={(e) => updateStage(i, { name: e.target.value })}
                      className="flex-1 min-w-0 bg-input border border-border rounded-md px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-primary/40"
                      placeholder="Stage name (e.g. Spec)"
                    />
                    <select
                      value={stage.mode}
                      onChange={(e) => updateStage(i, { mode: e.target.value as StageForm['mode'] })}
                      className="bg-input border border-border rounded-md px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary/40"
                    >
                      <option value="interactive">interactive</option>
                      <option value="engine">engine</option>
                    </select>
                    <div className="flex items-center gap-1 shrink-0">
                      <input
                        value={stage.timeout}
                        onChange={(e) => updateStage(i, { timeout: e.target.value })}
                        className="w-14 bg-input border border-border rounded-md px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary/40 text-right"
                        placeholder={String(inheritedTimeout ?? 30)}
                        inputMode="numeric"
                      />
                      <span className="text-[10px] text-muted-foreground">min</span>
                    </div>
                    <select
                      value={stage.onQuestion}
                      onChange={(e) => updateStage(i, { onQuestion: e.target.value as StageForm['onQuestion'] })}
                      className="bg-input border border-border rounded-md px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary/40"
                      title="What happens when the agent asks a question"
                    >
                      <option value="pause">pause on Q</option>
                      <option value="continue">continue on Q</option>
                    </select>
                    <div className="flex items-center shrink-0">
                      <button
                        onClick={() => moveStage(i, -1)}
                        disabled={i === 0}
                        className="p-1 rounded hover:bg-muted/40 disabled:opacity-30 text-muted-foreground"
                        title="Move up"
                      >
                        <ChevronUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => moveStage(i, 1)}
                        disabled={i === stages.length - 1}
                        className="p-1 rounded hover:bg-muted/40 disabled:opacity-30 text-muted-foreground"
                        title="Move down"
                      >
                        <ChevronDown className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setExpandedConfig(expandedConfig === i ? null : i)}
                        className={cn(
                          'p-1 rounded hover:bg-muted/40',
                          stage.model ||
                            stage.cliProfile ||
                            stage.subagents.length ||
                            stage.skills.length ||
                            stage.permissionMode ||
                            stage.extraMcpServers
                            ? 'text-primary'
                            : 'text-muted-foreground',
                        )}
                        title="Model / CLI profile / subagents / skills / permissionMode / MCP extras deste estágio"
                      >
                        <Settings2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setExpandedPrompt(expandedPrompt === i ? null : i)}
                        className={cn(
                          'p-1 rounded hover:bg-muted/40',
                          stage.promptTemplate ? 'text-primary' : 'text-muted-foreground',
                        )}
                        title="Custom prompt template"
                      >
                        <FileText className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => removeStage(i)}
                        className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                        title="Remove stage"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  {expandedConfig === i && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-border/60">
                      <select
                        value={stage.model}
                        onChange={(e) => updateStage(i, { model: e.target.value })}
                        className={cn(selectClass, !stage.model && 'text-muted-foreground')}
                      >
                        <option value="">{inheritedModel ? `— herda: ${inheritedModel}` : '— model'}</option>
                        {modelOptions.map((m) => (
                          <option key={m} value={m} className="text-foreground">{m}</option>
                        ))}
                      </select>
                      <select
                        value={stage.cliProfile}
                        onChange={(e) => updateStage(i, { cliProfile: e.target.value })}
                        className={cn(selectClass, !stage.cliProfile && 'text-muted-foreground')}
                      >
                        <option value="">{inheritedCliProfile ? `— herda: ${inheritedCliProfile}` : '— cliProfile'}</option>
                        {cliProfileOptions.map((p) => (
                          <option key={p} value={p} className="text-foreground">{p}</option>
                        ))}
                      </select>
                      <TagMultiSelect
                        values={stage.subagents}
                        options={agentOptions}
                        onChange={(next) => updateStage(i, { subagents: next })}
                        placeholder="subagents"
                      />
                      <TagMultiSelect
                        values={stage.skills}
                        options={skillOptions}
                        onChange={(next) => updateStage(i, { skills: next })}
                        placeholder="skills"
                      />
                      {!!(alwaysMergedSubagents.length || alwaysMergedSkills.length) && (
                        <p className="col-span-2 sm:col-span-4 text-[10px] text-muted-foreground">
                          Sempre soma do pipeline/projeto: {[...alwaysMergedSubagents, ...alwaysMergedSkills].join(', ')}
                        </p>
                      )}
                      <input
                        value={stage.permissionMode}
                        onChange={(e) => updateStage(i, { permissionMode: e.target.value })}
                        className="col-span-2 bg-input border border-border rounded-md px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary/40"
                        placeholder={
                          inheritedPermissionMode
                            ? `permissionMode — herda: ${inheritedPermissionMode}`
                            : 'permissionMode (acceptEdits, bypassPermissions, plan)'
                        }
                      />
                      <textarea
                        value={stage.extraMcpServers}
                        onChange={(e) => updateStage(i, { extraMcpServers: e.target.value })}
                        rows={stage.extraMcpServers ? 5 : 2}
                        spellCheck={false}
                        className="col-span-2 sm:col-span-4 bg-input border border-border rounded-md px-2 py-1.5 text-[11px] font-mono text-foreground outline-none focus:border-primary/40 resize-y"
                        placeholder={'extraMcpServers — Json { "nome": { "command": "..." } }, só neste estágio'}
                      />
                    </div>
                  )}
                  {expandedPrompt === i && (
                    <textarea
                      value={stage.promptTemplate}
                      onChange={(e) => updateStage(i, { promptTemplate: e.target.value })}
                      rows={4}
                      className="w-full bg-input border border-border rounded-md px-2.5 py-2 text-xs font-mono text-foreground outline-none focus:border-primary/40 resize-y"
                      placeholder="Optional custom prompt for this stage. Leave empty to use the default stage prompt (task context + MCP tool instructions)."
                    />
                  )}
                </div>
              ))}
            </div>
            <button
              onClick={() => setStages((prev) => [...prev, { ...EMPTY_STAGE }])}
              className="mt-2 flex items-center gap-1.5 px-3 py-2 rounded-md text-xs border border-dashed border-border text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors w-full justify-center"
            >
              <Plus className="w-3.5 h-3.5" />
              Add stage
            </button>
          </div>

          {error && (
            <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/30">
              <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
              <p className="text-xs text-destructive">{error}</p>
            </div>
          )}
        </div>

        <div className="px-6 py-3 border-t border-border flex justify-end gap-2 shrink-0">
          <button
            onClick={onClose}
            className="text-[11px] text-muted-foreground hover:text-foreground px-3 py-2 rounded-md transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving || (isFixed && activeTaskCount > 0 && !confirmedFixedEdit)}
            title={isFixed && activeTaskCount > 0 && !confirmedFixedEdit ? 'Confirme o aviso acima antes de salvar' : undefined}
            className="text-[11px] bg-primary text-primary-foreground px-4 py-2 rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving...' : isEdit ? 'Save changes' : 'Create pipeline'}
          </button>
        </div>
      </div>
    </div>
  )
}
