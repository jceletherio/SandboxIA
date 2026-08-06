'use client'

import { Shell } from '@/components/shell'
import { NotificationsCard } from '@/components/settings/notifications-card'
import {
  api,
  projectsApi,
  cliProfilesApi,
  masterAgentApi,
  modelsApi,
  type Project,
  type CliProfile,
  type LLMModel,
  type ProjectDefaults,
} from '@/lib/api'
import { useProject } from '@/lib/project-context'
import { cn } from '@/lib/utils'
import Link from 'next/link'
import {
  Settings,
  Save,
  FolderOpen,
  TerminalSquare,
  Bot,
  Plus,
  Trash2,
  Edit3,
  X,
  AlertCircle,
  CheckCircle2,
  ChevronRight,
} from 'lucide-react'
import { useState, useEffect, useCallback, useRef } from 'react'
import { ConfirmModal } from '@/components/confirm-modal'

type Feedback = { ok: boolean; text: string } | null

/* ------------------------------------------------------------------ */
/* Editor de CLI Profile (modal)                                       */
/* ------------------------------------------------------------------ */

/**
 * Tokens de template suportados pelo renderer do backend
 * (backend/src/session-runtime/cli-profile.renderer.ts). Lista FIXA: o renderer
 * só resolve estas chaves do RenderContext. Qualquer outro token é descartado
 * silenciosamente em runtime (junto com a flag anterior, em args), por isso o
 * editor bloqueia o save quando encontra um desconhecido.
 */
const PLACEHOLDERS = [
  { token: 'prompt', desc: 'o prompt a executar' },
  { token: 'model', desc: 'modelo resolvido — o campo Default model, ou o modelo do Agent' },
  { token: 'mcpConfigPath', desc: 'caminho do arquivo de config MCP escrito na worktree' },
  { token: 'url', desc: 'URL do servidor MCP do orquestrador' },
  { token: 'token', desc: 'bearer token da sessão' },
  { token: 'resumeId', desc: 'id de retomada da sessão do CLI' },
  { token: 'sessionId', desc: 'id da Session do orquestrador' },
  { token: 'permissionMode', desc: 'modo de permissão do CLI (ex.: acceptEdits, bypassPermissions)' },
] as const

const KNOWN_PLACEHOLDERS = new Set<string>(PLACEHOLDERS.map((p) => p.token))

/**
 * `--permission-mode` do CLI (claude --help). Não vem de tabela nenhuma — é
 * enum fixo do binário, então select com opções fixas em vez de texto livre.
 */
const PERMISSION_MODES = ['auto', 'acceptEdits', 'bypassPermissions', 'plan', 'manual', 'dontAsk'] as const

/** Casa qualquer `{{...}}`, inclusive os malformados — é isso que pega o typo. */
const PLACEHOLDER_SCAN_RE = /\{\{([^{}]*)\}\}/g

/** Campos do editor que passam pelo renderer de templates. */
type TemplateField = 'interactiveArgs' | 'resumeArgs' | 'mcpConfigTemplate' | 'env'

function findUnknownPlaceholders(sources: string[]): string[] {
  const unknown = new Set<string>()
  for (const source of sources) {
    for (const match of source.matchAll(PLACEHOLDER_SCAN_RE)) {
      if (!KNOWN_PLACEHOLDERS.has(match[1])) unknown.add(`{{${match[1]}}}`)
    }
  }
  return [...unknown]
}

function CliProfileEditor({
  profile,
  onClose,
  onSaved,
}: {
  profile: CliProfile | null
  onClose: () => void
  onSaved: () => void
}) {
  const isEdit = !!profile
  const [name, setName] = useState(profile?.name || '')
  const [binary, setBinary] = useState(profile?.binary || '')
  const [defaultModel, setDefaultModel] = useState(profile?.defaultModel || '')
  const [interactiveArgs, setInteractiveArgs] = useState(
    JSON.stringify(profile?.interactiveArgs ?? [], null, 2),
  )
  const [resumeArgs, setResumeArgs] = useState(JSON.stringify(profile?.resumeArgs ?? [], null, 2))
  const [mcpConfigFile, setMcpConfigFile] = useState(profile?.mcpConfigFile || '.orchestrator/mcp.json')
  const [mcpConfigTemplate, setMcpConfigTemplate] = useState(
    JSON.stringify(
      profile?.mcpConfigTemplate ?? {
        mcpServers: {
          orchestrator: {
            type: 'http',
            url: '{{url}}',
            headers: { Authorization: 'Bearer {{token}}' },
          },
        },
      },
      null,
      2,
    ),
  )
  const [envText, setEnvText] = useState(JSON.stringify(profile?.env ?? {}, null, 2))
  const [isDefault, setIsDefault] = useState(profile?.isDefault || false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  /* --- paleta de placeholders: insere no cursor do último campo focado --- */
  const templateRefs = useRef<Record<TemplateField, HTMLTextAreaElement | null>>({
    interactiveArgs: null,
    resumeArgs: null,
    mcpConfigTemplate: null,
    env: null,
  })
  const lastFocused = useRef<TemplateField | null>(null)

  const templateValues: Record<TemplateField, string> = {
    interactiveArgs,
    resumeArgs,
    mcpConfigTemplate,
    env: envText,
  }
  const templateSetters: Record<TemplateField, (value: string) => void> = {
    interactiveArgs: setInteractiveArgs,
    resumeArgs: setResumeArgs,
    mcpConfigTemplate: setMcpConfigTemplate,
    env: setEnvText,
  }

  const insertPlaceholder = (token: string) => {
    const key = lastFocused.current ?? 'interactiveArgs'
    const node = templateRefs.current[key]
    const current = templateValues[key]
    const text = `{{${token}}}`
    // Sem campo focado ainda: append no fim do primeiro campo de template.
    const hasCursor = lastFocused.current !== null && node !== null
    const start = hasCursor ? node!.selectionStart : current.length
    const end = hasCursor ? node!.selectionEnd : current.length
    templateSetters[key](current.slice(0, start) + text + current.slice(end))
    requestAnimationFrame(() => {
      const el = templateRefs.current[key]
      if (!el) return
      const caret = start + text.length
      el.focus()
      el.setSelectionRange(caret, caret)
      lastFocused.current = key
    })
  }

  /** Props comuns dos textareas de template (ref + rastreio de foco). */
  const templateProps = (key: TemplateField) => ({
    ref: (el: HTMLTextAreaElement | null) => {
      templateRefs.current[key] = el
    },
    onFocus: () => {
      lastFocused.current = key
    },
  })

  const parseJson = (label: string, value: string, expectArray: boolean): any => {
    const parsed = JSON.parse(value)
    if (expectArray && !Array.isArray(parsed)) throw new Error(`${label} must be a JSON array of strings`)
    return parsed
  }

  const parseEnv = (value: string): Record<string, string> => {
    const parsed = JSON.parse(value)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('env must be a JSON object of string values (ex.: { "KEY": "value" })')
    }
    for (const [key, val] of Object.entries(parsed)) {
      if (typeof val !== 'string') throw new Error(`env["${key}"] must be a string`)
    }
    return parsed as Record<string, string>
  }

  const save = async () => {
    setError(null)
    if (!name.trim() || !binary.trim()) {
      setError('Name and binary are required')
      return
    }
    // Um token fora da lista suportada some em runtime sem erro — barra aqui.
    const unknown = findUnknownPlaceholders([interactiveArgs, resumeArgs, mcpConfigTemplate, envText])
    if (unknown.length > 0) {
      setError(
        `${unknown.length === 1 ? 'Placeholder desconhecido' : 'Placeholders desconhecidos'}: ${unknown.join(', ')}\n` +
          `Suportados: ${PLACEHOLDERS.map((p) => `{{${p.token}}}`).join(' ')}`,
      )
      return
    }
    let payload: Partial<CliProfile>
    try {
      payload = {
        name: name.trim(),
        binary: binary.trim(),
        defaultModel: defaultModel.trim() || undefined,
        interactiveArgs: parseJson('interactiveArgs', interactiveArgs, true),
        resumeArgs: parseJson('resumeArgs', resumeArgs, true),
        mcpConfigFile: mcpConfigFile.trim() || undefined,
        mcpConfigTemplate: parseJson('mcpConfigTemplate', mcpConfigTemplate, false),
        env: parseEnv(envText),
        isDefault,
      }
    } catch (err: any) {
      setError(`Invalid JSON: ${err.message}`)
      return
    }
    setSaving(true)
    try {
      if (isEdit && profile) {
        await cliProfilesApi.update(profile.id, payload)
      } else {
        await cliProfilesApi.create(payload)
      }
      onSaved()
      onClose()
    } catch (err: any) {
      setError(err?.message || 'Failed to save profile')
    } finally {
      setSaving(false)
    }
  }

  const field = (label: string, hint?: string) => (
    <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-1 block">
      {label}
      {hint && <span className="ml-2 normal-case tracking-normal text-muted-foreground/60">{hint}</span>}
    </label>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-lg border border-border bg-card shadow-xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              {isEdit ? `Edit CLI profile — ${profile?.name}` : 'New CLI profile'}
            </h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Args, MCP config e env são templates — use a paleta de placeholders abaixo.
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-muted/40 transition-colors">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              {field('Name *', 'identifica o perfil na UI')}
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={isEdit && profile?.builtin}
                className="w-full bg-input border border-border rounded-md px-3 py-2 text-xs font-mono text-foreground outline-none focus:border-primary/50 disabled:opacity-60"
                placeholder="ex.: claude-code, codex, opencode…"
              />
            </div>
            <div>
              {field('Binary *', 'executável do CLI')}
              <input
                value={binary}
                onChange={(e) => setBinary(e.target.value)}
                className="w-full bg-input border border-border rounded-md px-3 py-2 text-xs font-mono text-foreground outline-none focus:border-primary/50"
                placeholder="ex.: claude — nome no PATH ou caminho absoluto"
              />
            </div>
          </div>
          <div>
            {field('Default model', 'opcional — preenche {{model}} nos args')}
            <input
              value={defaultModel}
              onChange={(e) => setDefaultModel(e.target.value)}
              className="w-full bg-input border border-border rounded-md px-3 py-2 text-xs font-mono text-foreground outline-none focus:border-primary/50"
              placeholder="ex.: claude-sonnet-5 — vazio = default do próprio CLI"
            />
          </div>
          <div className="rounded-md border border-border/70 bg-muted/10 px-3 py-2.5">
            <p className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-1.5">
              Placeholders
              <span className="ml-2 normal-case tracking-normal text-muted-foreground/60">
                lista fixa do renderer do backend — clique para inserir no cursor do campo focado
              </span>
            </p>
            <div className="flex flex-wrap gap-1.5">
              {PLACEHOLDERS.map((p) => (
                <button
                  key={p.token}
                  type="button"
                  // preventDefault no mousedown mantém o foco (e o cursor) no textarea
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insertPlaceholder(p.token)}
                  title={`{{${p.token}}} — ${p.desc}`}
                  className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-border bg-input text-foreground hover:border-primary/50 hover:text-primary transition-colors"
                >
                  {`{{${p.token}}}`}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground/70 mt-1.5 leading-relaxed">
              Token fora dessa lista é descartado silenciosamente na execução (em args, junto com a flag
              anterior) — por isso o save é bloqueado se encontrar um desconhecido.
            </p>
          </div>
          <div>
            {field('Interactive args', 'JSON array — modo padrão: CLI vivo na sessão tmux')}
            <textarea
              {...templateProps('interactiveArgs')}
              value={interactiveArgs}
              onChange={(e) => setInteractiveArgs(e.target.value)}
              rows={4}
              spellCheck={false}
              placeholder={'["--model", "{{model}}", "--mcp-config", "{{mcpConfigPath}}"]'}
              className="w-full bg-input border border-border rounded-md px-3 py-2 text-xs font-mono text-foreground outline-none focus:border-primary/50 resize-y"
            />
          </div>
          <div>
            {field('Resume args', 'JSON array — args para retomar uma sessão existente do CLI')}
            <textarea
              {...templateProps('resumeArgs')}
              value={resumeArgs}
              onChange={(e) => setResumeArgs(e.target.value)}
              rows={3}
              spellCheck={false}
              placeholder={'["--resume", "{{resumeId}}", "--mcp-config", "{{mcpConfigPath}}"]'}
              className="w-full bg-input border border-border rounded-md px-3 py-2 text-xs font-mono text-foreground outline-none focus:border-primary/50 resize-y"
            />
            <p className="text-[10px] text-muted-foreground/70 mt-1 leading-relaxed">
              Usado no lugar dos interactive args quando a sessão já tem um id de retomada. É o único lugar
              onde <span className="font-mono">{'{{resumeId}}'}</span> resolve; vazio = sempre inicia do zero.
            </p>
          </div>
          <div>
            {field('MCP config file', 'caminho relativo à worktree')}
            <input
              value={mcpConfigFile}
              onChange={(e) => setMcpConfigFile(e.target.value)}
              className="w-full bg-input border border-border rounded-md px-3 py-2 text-xs font-mono text-foreground outline-none focus:border-primary/50"
              placeholder="ex.: .orchestrator/mcp.json"
            />
          </div>
          <div>
            {field('MCP config template', 'JSON escrito na worktree com {{url}}/{{token}}')}
            <textarea
              {...templateProps('mcpConfigTemplate')}
              value={mcpConfigTemplate}
              onChange={(e) => setMcpConfigTemplate(e.target.value)}
              rows={6}
              spellCheck={false}
              placeholder={'{ "mcpServers": { "orchestrator": { "type": "http", "url": "{{url}}" } } }'}
              className="w-full bg-input border border-border rounded-md px-3 py-2 text-xs font-mono text-foreground outline-none focus:border-primary/50 resize-y"
            />
          </div>
          <div>
            {field('Env', 'JSON object — variáveis de ambiente do processo do CLI')}
            <textarea
              {...templateProps('env')}
              value={envText}
              onChange={(e) => setEnvText(e.target.value)}
              rows={4}
              spellCheck={false}
              placeholder={'{ "ANTHROPIC_BASE_URL": "https://…", "ORCH_SESSION": "{{sessionId}}" }'}
              className="w-full bg-input border border-border rounded-md px-3 py-2 text-xs font-mono text-foreground outline-none focus:border-primary/50 resize-y"
            />
            <p className="text-[10px] text-muted-foreground/70 mt-1 leading-relaxed">
              Chaves e valores são strings; os valores também aceitam placeholders. Vazio ({'{}'}) = sem env
              extra.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              role="checkbox"
              aria-checked={isDefault}
              onClick={() => setIsDefault(!isDefault)}
              className={cn(
                'w-4 h-4 rounded border flex items-center justify-center transition-colors',
                isDefault
                  ? 'bg-primary border-primary'
                  : 'bg-transparent border-border hover:border-primary/50',
              )}
            >
              {isDefault && <CheckCircle2 className="w-3 h-3 text-primary-foreground" />}
            </button>
            <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground cursor-pointer" onClick={() => setIsDefault(!isDefault)}>
              Set as default CLI profile
            </label>
          </div>

          {error && (
            <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/30">
              <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
              <p className="text-xs text-destructive whitespace-pre-wrap">{error}</p>
            </div>
          )}
        </div>

        <div className="px-6 py-3 border-t border-border flex justify-end gap-2 shrink-0">
          <button onClick={onClose} className="text-[11px] text-muted-foreground hover:text-foreground px-3 py-2 rounded-md">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="text-[11px] bg-primary text-primary-foreground px-4 py-2 rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving...' : isEdit ? 'Save changes' : 'Create profile'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Página                                                              */
/* ------------------------------------------------------------------ */

export default function SettingsPage() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<Feedback>(null)
  const { currentProject, refreshProjects } = useProject()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [repoUrl, setRepoUrl] = useState('')
  const [mainPath, setMainPath] = useState('')
  const [worktreeBase, setWorktreeBase] = useState('')
  const [maxSessions, setMaxSessions] = useState(3)

  const [profiles, setProfiles] = useState<CliProfile[]>([])
  const [profileEditorOpen, setProfileEditorOpen] = useState(false)
  const [editingProfile, setEditingProfile] = useState<CliProfile | null>(null)
  const [profileFeedback, setProfileFeedback] = useState<Feedback>(null)
  const [showDeleteProjectConfirm, setShowDeleteProjectConfirm] = useState(false)
  const [deletingProfile, setDeletingProfile] = useState<CliProfile | null>(null)

  const [projSettings, setProjSettings] = useState({
    defaultCliProfileId: '',
    masterAgentProfileId: '',
  })
  const [projSettingsLoading, setProjSettingsLoading] = useState(false)
  const [projSettingsSaving, setProjSettingsSaving] = useState(false)
  const [projSettingsFeedback, setProjSettingsFeedback] = useState<Feedback>(null)

  const [models, setModels] = useState<LLMModel[]>([])
  const [defaults, setDefaults] = useState<ProjectDefaults>({})
  const [defaultsLoading, setDefaultsLoading] = useState(false)
  const [defaultsSaving, setDefaultsSaving] = useState(false)
  const [defaultsFeedback, setDefaultsFeedback] = useState<Feedback>(null)

  const [masterStatus, setMasterStatus] = useState<{
    isActive: boolean
    projectName?: string | null
    cliProfileName?: string | null
  }>({ isActive: false })

  const loadProfiles = useCallback(async () => {
    try {
      setProfiles(await cliProfilesApi.list())
    } catch (error) {
      console.error('Failed to load CLI profiles:', error)
    }
  }, [])

  useEffect(() => {
    async function fetchAll() {
      try {
        if (currentProject) {
          const data = await projectsApi.get(currentProject.id)
          setName(data.name)
          setDescription(data.description || '')
          setRepoUrl(data.repoUrl)
          setMainPath(data.mainPath)
          setWorktreeBase(data.worktreeBase)
          setMaxSessions((data as any).maxSessions || 3)
        }
        await loadProfiles()
        if (currentProject) {
          setProjSettingsLoading(true)
          try {
            const s = await api.get<Record<string, any>>(`/projects/${currentProject.id}/settings`)
            setProjSettings({
              defaultCliProfileId: s.defaultCliProfileId || '',
              masterAgentProfileId: s.masterAgentProfileId || '',
            })
          } catch {
          } finally {
            setProjSettingsLoading(false)
          }
        }
        try {
          setModels(await modelsApi.list())
        } catch (error) {
          console.error('Failed to load LLM models:', error)
        }
        if (currentProject) {
          setDefaultsLoading(true)
          try {
            setDefaults(await projectsApi.getDefaults(currentProject.id))
          } catch (error) {
            console.error('Failed to load project defaults:', error)
          } finally {
            setDefaultsLoading(false)
          }
        }
        try {
          setMasterStatus(await masterAgentApi.getStatus(currentProject?.id))
        } catch {
          /* backend pode estar sem master */
        }
      } catch (error) {
        console.error('Failed to fetch settings:', error)
      } finally {
        setLoading(false)
      }
    }
    fetchAll()
  }, [currentProject, loadProfiles])

  async function saveSettings() {
    if (!currentProject) return
    setSaving(true)
    setFeedback(null)
    try {
      await projectsApi.update(currentProject.id, {
        name,
        description,
        repoUrl,
        mainPath,
        worktreeBase,
        maxSessions,
      })
      await refreshProjects()
      setFeedback({ ok: true, text: 'Project settings saved.' })
    } catch (error: any) {
      setFeedback({ ok: false, text: error?.message || 'Failed to save settings' })
    } finally {
      setSaving(false)
      setTimeout(() => setFeedback(null), 5000)
    }
  }

  async function saveProjectSettings() {
    if (!currentProject) return
    setProjSettingsSaving(true)
    setProjSettingsFeedback(null)
    try {
      await api.patch(`/projects/${currentProject.id}/settings`, projSettings)
      setProjSettingsFeedback({ ok: true, text: 'Configurações do projeto salvas.' })
    } catch (error: any) {
      setProjSettingsFeedback({ ok: false, text: error?.message || 'Falha ao salvar configurações' })
    } finally {
      setProjSettingsSaving(false)
      setTimeout(() => setProjSettingsFeedback(null), 5000)
    }
  }

  /**
   * `''` no select vira `null` no patch — é como a UI apaga um default sem
   * reenviar o objeto inteiro (`setDefaults` trata `null` como remoção, ver
   * 01-CONTRATOS §4). String vazia estouraria `assertValidProjectDefaults`.
   */
  async function saveDefaults() {
    if (!currentProject) return
    setDefaultsSaving(true)
    setDefaultsFeedback(null)
    try {
      const patch = {
        model: defaults.model || null,
        masterModel: defaults.masterModel || null,
        permissionMode: defaults.permissionMode || null,
        cliProfile: defaults.cliProfile || null,
        timeout: defaults.timeout || null,
      }
      setDefaults(await projectsApi.setDefaults(currentProject.id, patch))
      setDefaultsFeedback({ ok: true, text: 'Defaults de execução salvos.' })
    } catch (error: any) {
      setDefaultsFeedback({ ok: false, text: error?.message || 'Falha ao salvar defaults' })
    } finally {
      setDefaultsSaving(false)
      setTimeout(() => setDefaultsFeedback(null), 5000)
    }
  }

  function deleteProject() {
    if (!currentProject) return
    setShowDeleteProjectConfirm(true)
  }

  async function confirmDeleteProject() {
    if (!currentProject) return
    try {
      await projectsApi.delete(currentProject.id)
      await refreshProjects()
      setFeedback({ ok: true, text: 'Project deleted.' })
      setShowDeleteProjectConfirm(false)
    } catch (error: any) {
      setFeedback({ ok: false, text: error?.message || 'Failed to delete project' })
      setShowDeleteProjectConfirm(false)
    }
  }

  function deleteProfile(profile: CliProfile) {
    setDeletingProfile(profile)
  }

  async function confirmDeleteProfile() {
    if (!deletingProfile) return
    setProfileFeedback(null)
    try {
      await cliProfilesApi.delete(deletingProfile.id)
      await loadProfiles()
      setProfileFeedback({ ok: true, text: `Profile "${deletingProfile.name}" deleted.` })
      setDeletingProfile(null)
    } catch (error: any) {
      setProfileFeedback({ ok: false, text: error?.message || 'Failed to delete profile' })
      setDeletingProfile(null)
    }
  }

  async function setDefaultProfile(profile: CliProfile) {
    setProfileFeedback(null)
    try {
      await cliProfilesApi.update(profile.id, { isDefault: true } as any)
      await loadProfiles()
      setProfileFeedback({ ok: true, text: `Profile "${profile.name}" set as default.` })
    } catch (error: any) {
      setProfileFeedback({ ok: false, text: error?.message || 'Failed to set default profile' })
    }
  }

  if (loading) {
    return (
      <Shell>
        <div className="flex items-center justify-center h-full">
          <div className="text-sm text-muted-foreground">Loading settings...</div>
        </div>
      </Shell>
    )
  }

  const feedbackBox = (fb: Feedback) =>
    fb && (
      <div
        className={cn(
          'flex items-center gap-2 p-2.5 rounded-md border text-xs',
          fb.ok
            ? 'bg-status-done/10 border-status-done/20 text-status-done'
            : 'bg-destructive/10 border-destructive/30 text-destructive',
        )}
      >
        {fb.ok ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> : <AlertCircle className="w-3.5 h-3.5 shrink-0" />}
        {fb.text}
      </div>
    )

  return (
    <Shell>
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
        <header className="flex items-center justify-between px-4 lg:px-6 py-3 border-b border-border bg-card/50 sticky top-0 z-10">
          <div>
            <h1 className="text-sm font-semibold text-foreground">Settings</h1>
            <p className="text-[11px] text-muted-foreground font-mono mt-0.5">
              Project · Notificações · CLI profiles · Master Agent
            </p>
          </div>
          <Settings className="w-4 h-4 text-muted-foreground" />
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto p-4 lg:p-6">
          {/* Grid de 2 colunas em telas largas; empilha em 1 coluna no mobile/tablet. */}
          <div className="w-full max-w-3xl xl:max-w-6xl 2xl:max-w-7xl grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
            <div className="space-y-6 min-w-0">
            {/* ------------------------------------------------ Project */}
            <div className="rounded-lg border border-border bg-card p-6 space-y-4">
              <h2 className="text-xs font-semibold text-foreground flex items-center gap-2">
                <FolderOpen className="w-4 h-4 text-primary" />
                Project
                {currentProject && (
                  <span className="text-[10px] font-mono text-muted-foreground">{currentProject.id.slice(0, 8)}</span>
                )}
              </h2>

              {!currentProject ? (
                <div className="flex flex-col items-center justify-center py-8 gap-2 px-4">
                  <FolderOpen className="w-5 h-5 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground text-center">
                    No project selected. Select or create one to edit its settings.
                  </span>
                  <Link
                    href="/projects"
                    className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                  >
                    Ir para Projects
                    <ChevronRight className="w-3 h-3" />
                  </Link>
                </div>
              ) : (
                <>
                  <div className="space-y-3">
                    <div>
                      <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-1 block">Name</label>
                      <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="w-full bg-input rounded-md px-3 py-2 text-xs text-foreground outline-none border border-border focus:border-primary/50 transition-colors"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-1 block">Description</label>
                      <textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        rows={3}
                        className="w-full bg-input rounded-md px-3 py-2 text-xs text-foreground outline-none border border-border focus:border-primary/50 transition-colors resize-none"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-1 block">Repository URL</label>
                      <input
                        type="text"
                        value={repoUrl}
                        onChange={(e) => setRepoUrl(e.target.value)}
                        className="w-full bg-input rounded-md px-3 py-2 text-xs text-foreground font-mono outline-none border border-border focus:border-primary/50 transition-colors"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-1 block">
                        Main Path
                        <span className="ml-2 normal-case tracking-normal text-muted-foreground/60">repo git local usado pelas sessões e pelo contexto</span>
                      </label>
                      <input
                        type="text"
                        value={mainPath}
                        onChange={(e) => setMainPath(e.target.value)}
                        className="w-full bg-input rounded-md px-3 py-2 text-xs text-foreground font-mono outline-none border border-border focus:border-primary/50 transition-colors"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-1 block">
                        Worktree Base
                        <span className="ml-2 normal-case tracking-normal text-muted-foreground/60">onde as worktrees das sessões são criadas</span>
                      </label>
                      <input
                        type="text"
                        value={worktreeBase}
                        onChange={(e) => setWorktreeBase(e.target.value)}
                        className="w-full bg-input rounded-md px-3 py-2 text-xs text-foreground font-mono outline-none border border-border focus:border-primary/50 transition-colors"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-1 block">
                        Max Active Sessions
                        <span className="ml-2 normal-case tracking-normal text-muted-foreground/60">limite de sessões simultâneas neste projeto</span>
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={20}
                        value={maxSessions}
                        onChange={(e) => setMaxSessions(parseInt(e.target.value) || 3)}
                        className="w-full bg-input rounded-md px-3 py-2 text-xs text-foreground font-mono outline-none border border-border focus:border-primary/50 transition-colors"
                      />
                    </div>
                  </div>

                  {feedbackBox(feedback)}

                  <div className="flex items-center justify-between">
                    <button
                      onClick={saveSettings}
                      disabled={saving}
                      className="flex items-center gap-1.5 text-xs bg-primary text-primary-foreground px-4 py-2 rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors font-medium"
                    >
                      <Save className="w-3.5 h-3.5" />
                      {saving ? 'Saving...' : 'Save Changes'}
                    </button>
                    <button
                      onClick={deleteProject}
                      className="flex items-center gap-1.5 text-xs border border-destructive/30 text-destructive px-3 py-2 rounded-md hover:bg-destructive/10 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Delete project
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* ----------------------------------------- Project Settings */}
            <div className="rounded-lg border border-border bg-card p-6 space-y-4">
              <h2 className="text-xs font-semibold text-foreground flex items-center gap-2">
                <Settings className="w-4 h-4 text-primary" />
                Configurações do Projeto
              </h2>

              {!currentProject ? (
                <div className="flex flex-col items-center justify-center py-8 gap-2 px-4">
                  <FolderOpen className="w-5 h-5 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground text-center">
                    Nenhum projeto selecionado. Selecione ou crie um projeto para configurar.
                  </span>
                  <Link
                    href="/projects"
                    className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                  >
                    Ir para Projects
                    <ChevronRight className="w-3 h-3" />
                  </Link>
                </div>
              ) : projSettingsLoading ? (
                <div className="text-xs text-muted-foreground py-4">Carregando configurações...</div>
              ) : (
                <>
                  <div className="space-y-3">
                    <div>
                      <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-1 block">Default CLI Profile</label>
                      <select
                        value={projSettings.defaultCliProfileId}
                        onChange={(e) => setProjSettings({ ...projSettings, defaultCliProfileId: e.target.value })}
                        className="w-full bg-input border border-border rounded-md px-3 py-2 text-xs text-foreground outline-none focus:border-primary/50 transition-colors"
                      >
                        <option value="">— nenhum —</option>
                        {profiles.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-1 block">Master Agent Profile</label>
                      <select
                        value={projSettings.masterAgentProfileId}
                        onChange={(e) => setProjSettings({ ...projSettings, masterAgentProfileId: e.target.value })}
                        className="w-full bg-input border border-border rounded-md px-3 py-2 text-xs text-foreground outline-none focus:border-primary/50 transition-colors"
                      >
                        <option value="">— nenhum —</option>
                        {profiles.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Automação do Master Agent (auto triage, sweep interval, session check, status report) é
                      configurada na página do Master Agent — veja o card abaixo.
                    </p>
                  </div>

                  {feedbackBox(projSettingsFeedback)}

                  <div className="flex justify-end">
                    <button
                      onClick={saveProjectSettings}
                      disabled={projSettingsSaving}
                      className="flex items-center gap-1.5 text-xs bg-primary text-primary-foreground px-4 py-2 rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors font-medium"
                    >
                      <Save className="w-3.5 h-3.5" />
                      {projSettingsSaving ? 'Saving...' : 'Save Settings'}
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* ----------------------------------------- Runtime Defaults */}
            <div className="rounded-lg border border-border bg-card p-6 space-y-4">
              <h2 className="text-xs font-semibold text-foreground flex items-center gap-2">
                <Bot className="w-4 h-4 text-primary" />
                Defaults de Execução
              </h2>
              <p className="text-[11px] text-muted-foreground">
                Camada <span className="font-mono">mais fraca</span> da precedência — defaults de
                pipeline e de estágio sobrescrevem isto. Se você mudar algo aqui e não ver efeito
                numa sessão, é porque o pipeline/estágio dela já define esse campo.
              </p>

              {!currentProject ? (
                <span className="text-xs text-muted-foreground">Selecione um projeto.</span>
              ) : defaultsLoading ? (
                <div className="text-xs text-muted-foreground py-4">Carregando defaults...</div>
              ) : (
                <>
                  <div className="space-y-3">
                    <div>
                      <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-1 block">
                        Model (sessões)
                      </label>
                      <select
                        value={defaults.model || ''}
                        onChange={(e) => setDefaults({ ...defaults, model: e.target.value })}
                        className="w-full bg-input border border-border rounded-md px-3 py-2 text-xs text-foreground outline-none focus:border-primary/50 transition-colors"
                      >
                        <option value="">— nenhum —</option>
                        {models.filter((m) => m.enabled).map((m) => (
                          <option key={m.id} value={m.name}>{m.provider}/{m.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-1 block">
                        Master Model
                        <span className="ml-2 normal-case tracking-normal text-muted-foreground/60">independente do model das sessões</span>
                      </label>
                      <select
                        value={defaults.masterModel || ''}
                        onChange={(e) => setDefaults({ ...defaults, masterModel: e.target.value })}
                        className="w-full bg-input border border-border rounded-md px-3 py-2 text-xs text-foreground outline-none focus:border-primary/50 transition-colors"
                      >
                        <option value="">— nenhum —</option>
                        {models.filter((m) => m.enabled).map((m) => (
                          <option key={m.id} value={m.name}>{m.provider}/{m.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-1 block">CLI Profile</label>
                      <select
                        value={defaults.cliProfile || ''}
                        onChange={(e) => setDefaults({ ...defaults, cliProfile: e.target.value })}
                        className="w-full bg-input border border-border rounded-md px-3 py-2 text-xs text-foreground outline-none focus:border-primary/50 transition-colors"
                      >
                        <option value="">— nenhum —</option>
                        {profiles.map((p) => (
                          <option key={p.id} value={p.name}>{p.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-1 block">
                        Permission Mode
                        <span className="ml-2 normal-case tracking-normal text-muted-foreground/60">sessões e Master Agent</span>
                      </label>
                      <select
                        value={defaults.permissionMode || ''}
                        onChange={(e) => setDefaults({ ...defaults, permissionMode: e.target.value })}
                        className="w-full bg-input border border-border rounded-md px-3 py-2 text-xs text-foreground outline-none focus:border-primary/50 transition-colors"
                      >
                        <option value="">— nenhum (acceptEdits) —</option>
                        {PERMISSION_MODES.map((mode) => (
                          <option key={mode} value={mode}>{mode}</option>
                        ))}
                      </select>
                      <p className="text-[10px] text-muted-foreground/70 mt-1 leading-snug">
                        Vale para as sessões e para o terminal do Master. Precisa valer para o
                        Master: sem modo automático ele pede confirmação a cada tool call num
                        terminal que ninguém está olhando, e fica parado esperando. Vazio = acceptEdits.
                      </p>
                    </div>
                    <div>
                      <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-1 block">Timeout (minutos)</label>
                      <input
                        type="number"
                        min={1}
                        value={defaults.timeout || ''}
                        onChange={(e) => setDefaults({ ...defaults, timeout: parseInt(e.target.value) || undefined })}
                        className="w-full bg-input border border-border rounded-md px-3 py-2 text-xs text-foreground font-mono outline-none focus:border-primary/50 transition-colors"
                      />
                    </div>
                  </div>

                  {feedbackBox(defaultsFeedback)}

                  <div className="flex justify-end">
                    <button
                      onClick={saveDefaults}
                      disabled={defaultsSaving}
                      className="flex items-center gap-1.5 text-xs bg-primary text-primary-foreground px-4 py-2 rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors font-medium"
                    >
                      <Save className="w-3.5 h-3.5" />
                      {defaultsSaving ? 'Saving...' : 'Save Defaults'}
                    </button>
                  </div>
                </>
              )}
            </div>

            </div>

            <div className="space-y-6 min-w-0">
            {/* ------------------------------------------- Notificações */}
            <NotificationsCard />

            {/* -------------------------------------------- CLI Profiles */}
            <div className="rounded-lg border border-border bg-card p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold text-foreground flex items-center gap-2">
                  <TerminalSquare className="w-4 h-4 text-primary" />
                  CLI Profiles
                  <span className="text-[10px] text-muted-foreground font-normal">
                    como cada LLM CLI é executado (agnóstico — qualquer CLI vira um perfil)
                  </span>
                </h2>
                <button
                  onClick={() => { setEditingProfile(null); setProfileEditorOpen(true) }}
                  className="flex items-center gap-1 text-[11px] bg-primary text-primary-foreground px-2.5 py-1.5 rounded-md hover:bg-primary/90 transition-colors"
                >
                  <Plus className="w-3 h-3" />
                  New profile
                </button>
              </div>

              {feedbackBox(profileFeedback)}

              <div className="divide-y divide-border/50 rounded-md border border-border overflow-hidden">
                {profiles.length === 0 && (
                  <p className="text-xs text-muted-foreground p-4">
                    No CLI profiles. Run <span className="font-mono">npx prisma db seed</span> in the backend
                    or create one here.
                  </p>
                )}
                {profiles.map((profile) => (
                  <div key={profile.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/20 transition-colors">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-foreground font-mono">{profile.name}</span>
                        {profile.builtin && (
                          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
                            builtin
                          </span>
                        )}
                        {profile.isDefault && (
                          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-status-done/10 text-status-done border border-status-done/20">
                            default
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground font-mono mt-0.5 truncate">
                        {profile.binary}
                        {profile.defaultModel ? ` · model: ${profile.defaultModel}` : ''}
                        {profile.resumeArgs && profile.resumeArgs.length > 0 ? ' · resume' : ''}
                        {profile.env && Object.keys(profile.env).length > 0
                          ? ` · env: ${Object.keys(profile.env).length}`
                          : ''}
                      </p>
                    </div>
                    {!profile.isDefault && (
                      <button
                        onClick={() => setDefaultProfile(profile)}
                        className="p-1.5 rounded hover:bg-status-done/10 text-muted-foreground hover:text-status-done transition-colors"
                        title="Set as default"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      onClick={() => { setEditingProfile(profile); setProfileEditorOpen(true) }}
                      className="p-1.5 rounded hover:bg-muted/40 text-muted-foreground hover:text-foreground transition-colors"
                      title="Edit"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => deleteProfile(profile)}
                      disabled={profile.builtin}
                      className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      title={profile.builtin ? 'Built-in profiles cannot be deleted' : 'Delete'}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* -------------------------------------------- Master Agent */}
            <div className="rounded-lg border border-border bg-card p-6 space-y-3">
              <h2 className="text-xs font-semibold text-foreground flex items-center gap-2">
                <Bot className="w-4 h-4 text-primary" />
                Master Agent
              </h2>
              <div className="flex items-center gap-2">
                <div className={cn('w-2 h-2 rounded-full', masterStatus.isActive ? 'bg-status-running animate-pulse' : 'bg-muted-foreground')} />
                <span className="text-xs font-mono text-foreground">{masterStatus.isActive ? 'ACTIVE' : 'INACTIVE'}</span>
                {masterStatus.isActive && (
                  <span className="text-[11px] text-muted-foreground">
                    project: <span className="text-foreground">{masterStatus.projectName || '—'}</span>
                    {' · '}profile: <span className="text-foreground font-mono">{masterStatus.cliProfileName || '—'}</span>
                  </span>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">
                O Master roda o CLI selecionado em uma sessão tmux <strong className="font-medium text-foreground">interativa e persistente</strong>,
                com a config MCP do Master — sem API de LLM e sem execução headless. Triagem automática de perguntas e
                chat são prompts colados nesse terminal; o CLI responde chamando as MCP tools
                (<span className="font-mono">answer_question</span>, <span className="font-mono">escalate_question</span>,{' '}
                <span className="font-mono">reply_chat</span>). O estado sobrevive a restart do backend.
              </p>
              <p className="text-[11px] text-muted-foreground">
                Auto triage, sweep interval, session check e status report são configurados na página do
                Master Agent (persistidos no Redis) — não em project settings.
              </p>
              <Link
                href="/master-agent"
                className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
              >
                Configure na página do Master Agent
                <ChevronRight className="w-3 h-3" />
              </Link>
            </div>
            </div>
          </div>
        </div>
      </div>

      {profileEditorOpen && (
        <CliProfileEditor
          profile={editingProfile}
          onClose={() => { setProfileEditorOpen(false); setEditingProfile(null) }}
          onSaved={loadProfiles}
        />
      )}
      {showDeleteProjectConfirm && currentProject && (
        <ConfirmModal
          title="Delete Project"
          message={`Delete project "${currentProject.name}"? This removes its pipelines, tasks and sessions. This cannot be undone.`}
          confirmLabel="Delete"
          destructive
          onConfirm={confirmDeleteProject}
          onCancel={() => setShowDeleteProjectConfirm(false)}
        />
      )}
      {deletingProfile && (
        <ConfirmModal
          title="Delete CLI Profile"
          message={`Delete CLI profile "${deletingProfile.name}"?`}
          confirmLabel="Delete"
          destructive
          onConfirm={confirmDeleteProfile}
          onCancel={() => setDeletingProfile(null)}
        />
      )}
    </Shell>
  )
}
