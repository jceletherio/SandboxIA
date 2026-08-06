'use client'

import { Shell } from '@/components/shell'
import { mcpsApi, type MCP } from '@/lib/api'
import { useProject } from '@/lib/project-context'
import { cn } from '@/lib/utils'
import { Wifi, WifiOff, Inbox, Plus, X, Pencil, Zap, Loader2, Trash2, Search, Check, FileSearch, FileCode, Link, Unlink, Sparkles } from 'lucide-react'
import { useState, useEffect } from 'react'
import { SkeletonCard } from '@/components/ui/skeleton'
import { useToast } from '@/components/toast-provider'

const defaultForm = {
  name: '',
  description: '',
  endpoint: '',
  type: 'sse',
  source: 'manual' as 'manual' | 'scan' | 'config',
}

type ScannedMcp = {
  name: string
  endpoint?: string
  type?: string
  description?: string
  path?: string
  /** Config file de origem (ex. .mcp.json, .opencode.json) */
  file?: string
}

export default function McpsPage() {
  const [mcps, setMcps] = useState<MCP[]>([])
  const [projectMCPs, setProjectMCPs] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingMcp, setEditingMcp] = useState<MCP | null>(null)
  const [deletingMcp, setDeletingMcp] = useState<MCP | null>(null)
  const [form, setForm] = useState(defaultForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ id: string; ok: boolean; message: string } | null>(null)
  const [scanning, setScanning] = useState(false)
  const [showScanDrawer, setShowScanDrawer] = useState(false)
  const [scannedMcps, setScannedMcps] = useState<ScannedMcp[]>([])
  const [selectedScanned, setSelectedScanned] = useState<Set<number>>(new Set())
  const [importing, setImporting] = useState(false)
  const [suggestions, setSuggestions] = useState<ScannedMcp[]>([])
  const [globalSuggestions, setGlobalSuggestions] = useState<(ScannedMcp & { global?: boolean })[]>([])
  const [loadingSuggestions, setLoadingSuggestions] = useState(false)
  const { currentProject } = useProject()
  const { toast, update } = useToast()

  useEffect(() => {
    async function fetchMcps() {
      try {
        const data = await mcpsApi.list()
        setMcps(data)
        if (currentProject) {
          const projMCPs = await mcpsApi.getProjectMCPs(currentProject.id)
          setProjectMCPs(new Set(projMCPs.map(m => m.id)))
        }
      } catch (error) {
        console.error('Failed to fetch MCPs:', error)
      } finally {
        setLoading(false)
      }
    }
    fetchMcps()
    const interval = setInterval(fetchMcps, 10000)
    return () => clearInterval(interval)
  }, [currentProject])

  useEffect(() => {
    async function loadSuggestions() {
      if (!currentProject) return
      setLoadingSuggestions(true)
      try {
        const [project, global] = await Promise.all([
          mcpsApi.scan(currentProject.id),
          mcpsApi.scanGlobal(),
        ])
        setSuggestions(project)
        setGlobalSuggestions(global)
      } catch (error) {
        console.error('Failed to load suggestions:', error)
      } finally {
        setLoadingSuggestions(false)
      }
    }
    loadSuggestions()
  }, [currentProject])

  const refetchMcps = async () => {
    try {
      const data = await mcpsApi.list()
      setMcps(data)
      if (currentProject) {
        const projMCPs = await mcpsApi.getProjectMCPs(currentProject.id)
        setProjectMCPs(new Set(projMCPs.map(m => m.id)))
      }
    } catch (error) {
      console.error('Failed to refetch MCPs:', error)
    }
  }

  const handleScan = async () => {
    if (!currentProject) return
    setScanning(true)
    try {
      const results = await mcpsApi.scan(currentProject.id)
      setScannedMcps(results)
      setSelectedScanned(new Set())
      setShowScanDrawer(true)
    } catch (err) {
      toast('error', 'Erro ao escanear projeto')
      console.error('Failed to scan:', err)
    } finally {
      setScanning(false)
    }
  }

  const toggleScannedSelection = (index: number) => {
    setSelectedScanned(prev => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  const handleImportScanned = async (mcp: ScannedMcp) => {
    setImporting(true)
    const toastId = toast('loading', `Importando ${mcp.name}...`)
    try {
      // Só vincula ao projeto se a entrada já veio do .mcp.json do repo —
      // para as demais origens, o vínculo é criado ao clicar em "Injetar".
      const alreadyInMcpJson = mcp.file === '.mcp.json'
      await mcpsApi.create({
        name: mcp.name,
        description: mcp.description || '',
        endpoint: mcp.endpoint || '',
        metadata: { type: mcp.type || 'sse' },
      }, alreadyInMcpJson ? currentProject?.id : undefined)
      update(
        toastId,
        'success',
        alreadyInMcpJson
          ? `${mcp.name} importado para o catálogo (já presente no .mcp.json do projeto)`
          : `${mcp.name} importado para o catálogo`,
      )
      await refetchMcps()
    } catch (err) {
      update(toastId, 'error', `Erro ao importar ${mcp.name}`)
      console.error('Failed to import:', err)
    } finally {
      setImporting(false)
    }
  }

  const handleImportSelected = async () => {
    for (const idx of selectedScanned) {
      await handleImportScanned(scannedMcps[idx])
    }
    setSelectedScanned(new Set())
  }

  const openCreateModal = () => {
    setEditingMcp(null)
    setForm(defaultForm)
    setError(null)
    setShowModal(true)
  }

  const openEditModal = (mcp: MCP) => {
    setEditingMcp(mcp)
    setForm({
      name: mcp.name,
      description: mcp.description || '',
      endpoint: mcp.endpoint || '',
      type: (mcp.metadata as any)?.type || 'sse',
      source: 'manual',
    })
    setError(null)
    setShowModal(true)
  }

  const handleSave = async () => {
    if (!form.name) return
    setSaving(true)
    setError(null)
    const toastId = toast('loading', editingMcp ? 'Atualizando MCP...' : 'Criando MCP...')
    try {
      const payload = {
        name: form.name,
        description: form.description,
        endpoint: form.endpoint,
        // preserva outras chaves de metadata (ex. command/args) e persiste o type,
        // que o backend usa para gravar {type:'sse'|'http'} no .mcp.json
        metadata: { ...((editingMcp?.metadata as Record<string, unknown>) || {}), type: form.type },
      }
      if (editingMcp) {
        await mcpsApi.update(editingMcp.id, payload)
        update(toastId, 'success', 'MCP atualizado com sucesso')
      } else {
        await mcpsApi.create(payload)
        update(toastId, 'success', 'MCP adicionado ao catálogo — use "Injetar" para gravá-lo no .mcp.json do projeto')
      }
      setShowModal(false)
      await refetchMcps()
    } catch (err) {
      update(toastId, 'error', 'Erro ao salvar MCP')
      setError(err instanceof Error ? err.message : 'Failed to save MCP')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deletingMcp) return
    const toastId = toast('loading', 'Deletando MCP...')
    try {
      await mcpsApi.delete(deletingMcp.id)
      update(toastId, 'success', 'MCP deletado com sucesso')
      setDeletingMcp(null)
      await refetchMcps()
    } catch (err) {
      update(toastId, 'error', 'Erro ao deletar MCP')
      console.error('Failed to delete MCP:', err)
    }
  }

  const handleInject = async (mcp: MCP) => {
    if (!currentProject) return
    const isInjected = projectMCPs.has(mcp.id)
    const toastId = toast(
      'loading',
      isInjected
        ? `Removendo ${mcp.name} do .mcp.json do projeto...`
        : `Gravando ${mcp.name} no .mcp.json do projeto...`,
    )
    try {
      if (isInjected) {
        const res = await mcpsApi.removeFromProject(mcp.id, currentProject.id)
        update(toastId, 'success', `Entrada "${res.server}" removida do ${res.file} do projeto`)
      } else {
        const res = await mcpsApi.inject(mcp.id, currentProject.id)
        update(toastId, 'success', `"${res.server}" gravado no ${res.file} do projeto`)
      }
      await refetchMcps()
    } catch (err) {
      update(
        toastId,
        'error',
        err instanceof Error ? err.message : 'Erro ao atualizar o .mcp.json do projeto',
      )
      console.error('Failed to inject/remove MCP:', err)
    }
  }

  const handleTest = async (mcp: MCP) => {
    if (!mcp.endpoint) return
    setTestingId(mcp.id)
    setTestResult(null)
    try {
      const result = await mcpsApi.test(mcp.id)
      setMcps(prev => prev.map(m => m.id === mcp.id ? { ...m, connected: result.reachable } : m))
      if (result.reachable) {
        const latency = result.latencyMs != null ? ` em ${result.latencyMs}ms` : ''
        const server = result.serverInfo?.name
          ? ` · ${result.serverInfo.name}${result.serverInfo.version ? ` v${result.serverInfo.version}` : ''}`
          : ''
        setTestResult({ id: mcp.id, ok: true, message: `${result.mode.toUpperCase()} OK${latency}${server}` })
        toast('success', `${mcp.name} alcançável${latency}${server}`)
      } else {
        const message = result.error || 'Não alcançável'
        setTestResult({ id: mcp.id, ok: false, message })
        toast('error', `Falha no teste de ${mcp.name}: ${message}`)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Test failed'
      setTestResult({ id: mcp.id, ok: false, message })
      toast('error', `Erro ao testar ${mcp.name}`)
    } finally {
      setTestingId(null)
    }
  }

  if (loading) {
    return (
      <Shell>
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <header className="flex items-center justify-between px-4 lg:px-6 py-3 border-b border-border bg-card/50 sticky top-0 z-10">
            <div className="space-y-2">
              <div className="h-4 w-28 bg-muted/50 rounded animate-pulse" />
              <div className="h-3 w-32 bg-muted/50 rounded animate-pulse" />
            </div>
          </header>
          <div className="flex-1 min-h-0 overflow-y-auto p-4 lg:p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
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
          <h1 className="text-sm font-semibold text-foreground">MCP Servers</h1>
          <p className="text-[11px] text-muted-foreground mt-0.5 max-w-2xl">
            Catálogo de servidores MCP — injete no projeto selecionado para gravar a entrada no{' '}
            <span className="font-mono">.mcp.json</span> do repo, lido pelos CLIs de IA
          </p>
          <p className="text-[11px] text-muted-foreground font-mono mt-0.5">
            {mcps.filter(m => m.connected).length} OK no último teste · {mcps.length} no catálogo
            {currentProject ? ` · ${projectMCPs.size} no .mcp.json de ${currentProject.name}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleScan}
            disabled={scanning}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
          >
            {scanning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
            Escanear Projeto
          </button>
          <button
            onClick={openCreateModal}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            New MCP
          </button>
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 lg:p-6">
        {loadingSuggestions ? (
          <div className="mb-6 p-4 rounded-lg border border-primary/20 bg-primary/5 flex items-center justify-center">
            <Loader2 className="w-4 h-4 animate-spin text-primary mr-2" />
            <span className="text-xs text-muted-foreground">Carregando sugestões...</span>
          </div>
        ) : suggestions.length > 0 ? (
          <div className="mb-6 p-4 rounded-lg border border-primary/20 bg-primary/5">
            <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              Sugestões do Projeto
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {suggestions.map((suggestion, idx) => (
                <div key={idx} className="rounded-md border border-border bg-card p-3">
                  <p className="text-xs font-semibold text-foreground">{suggestion.name}</p>
                  {suggestion.endpoint && (
                    <p className="text-[10px] font-mono text-primary mt-1 truncate">{suggestion.endpoint}</p>
                  )}
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                      {suggestion.type || 'sse'}
                    </span>
                    {suggestion.file && (
                      <span
                        className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-primary/10 text-primary truncate"
                        title={`Encontrado em ${suggestion.file}`}
                      >
                        {suggestion.file}
                      </span>
                    )}
                    {suggestion.path && (
                      <span className="text-[9px] font-mono text-muted-foreground truncate">{suggestion.path}</span>
                    )}
                  </div>
                  <button
                    onClick={() => handleImportScanned(suggestion)}
                    disabled={importing}
                    className="mt-2 w-full px-2 py-1 rounded-md text-[11px] bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                  >
                    Importar
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {globalSuggestions.length > 0 && (
          <div className="mb-6 p-4 rounded-lg border border-blue-500/20 bg-blue-500/5">
            <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-blue-400" />
              Sugestões Globais
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {globalSuggestions.map((suggestion, idx) => (
                <div key={`global-${idx}`} className="rounded-md border border-border bg-card p-3">
                  <p className="text-xs font-semibold text-foreground">{suggestion.name}</p>
                  {suggestion.endpoint && (
                    <p className="text-[10px] font-mono text-primary mt-1 truncate">{suggestion.endpoint}</p>
                  )}
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                      {suggestion.type || 'sse'}
                    </span>
                    {suggestion.file && (
                      <span
                        className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-primary/10 text-primary truncate"
                        title={`Encontrado em ${suggestion.file}`}
                      >
                        {suggestion.file}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => handleImportScanned(suggestion)}
                    disabled={importing}
                    className="mt-2 w-full px-2 py-1 rounded-md text-[11px] bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                  >
                    Importar
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {mcps.map(mcp => {
            const isInjected = projectMCPs.has(mcp.id)
            return (
            <div
              key={mcp.id}
              className={cn(
                'rounded-lg border bg-card p-4 transition-colors',
                mcp.connected ? 'border-status-done/30' : 'border-border'
              )}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className={cn(
                    'w-8 h-8 rounded-lg flex items-center justify-center',
                    mcp.connected ? 'bg-status-done/10' : 'bg-muted'
                  )}>
                    {mcp.connected ? (
                      <Wifi className="w-4 h-4 text-status-done" />
                    ) : (
                      <WifiOff className="w-4 h-4 text-muted-foreground" />
                    )}
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-foreground">{mcp.name}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{mcp.description}</p>
                  </div>
                </div>
                {isInjected && (
                  <span
                    className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-primary/15 text-primary shrink-0"
                    title={`Entrada gravada no .mcp.json${currentProject ? ` de ${currentProject.name}` : ' do projeto'}`}
                  >
                    .mcp.json
                  </span>
                )}
              </div>

              <div className="space-y-2 mb-4">
                {mcp.endpoint && (
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground">Endpoint</span>
                    <span className="text-[10px] font-mono text-primary truncate max-w-[180px]">{mcp.endpoint}</span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground" title="Resultado do último Test — use o botão Test para atualizar">
                    Status (último teste)
                  </span>
                  <span className={cn(
                    'text-[10px] font-mono px-1.5 py-0.5 rounded',
                    mcp.connected ? 'bg-status-done/15 text-status-done' : 'bg-muted text-muted-foreground'
                  )}>
                    {mcp.connected ? 'REACHABLE' : 'NOT VERIFIED'}
                  </span>
                </div>
                {testResult && testResult.id === mcp.id && (
                  <div className={cn(
                    'text-[10px] font-mono px-2 py-1 rounded',
                    testResult.ok ? 'bg-status-done/15 text-status-done' : 'bg-destructive/15 text-destructive'
                  )}>
                    Test: {testResult.message}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleInject(mcp)}
                  disabled={!currentProject}
                  title={
                    !currentProject
                      ? 'Selecione um projeto para injetar'
                      : isInjected
                        ? 'Apaga a entrada do .mcp.json do projeto'
                        : 'Grava a entrada no .mcp.json do projeto (lido pelos CLIs de IA)'
                  }
                  className={cn(
                    'flex-1 flex items-center justify-center gap-1.5 text-[11px] py-2 rounded-md border transition-colors disabled:opacity-50',
                    isInjected
                      ? 'border-destructive/30 text-destructive hover:bg-destructive/10'
                      : 'border-primary/30 text-primary hover:bg-primary/10'
                  )}
                >
                  {isInjected ? (
                    <><Unlink className="w-3 h-3" /> Remover do .mcp.json</>
                  ) : (
                    <><Link className="w-3 h-3" /> Injetar no projeto</>
                  )}
                </button>
                <button
                  onClick={() => handleTest(mcp)}
                  disabled={testingId === mcp.id || !mcp.endpoint}
                  title="Testa a conectividade do server e persiste o status"
                  className="flex items-center justify-center gap-1.5 text-[11px] py-2 px-3 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-50"
                >
                  {testingId === mcp.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                  Test
                </button>
                <button
                  onClick={() => openEditModal(mcp)}
                  title="Editar MCP"
                  className="p-2 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                >
                  <Pencil className="w-3 h-3" />
                </button>
                <button
                  onClick={() => setDeletingMcp(mcp)}
                  title="Deletar do catálogo"
                  className="p-2 rounded-md border border-destructive/30 text-destructive hover:bg-destructive/10 transition-colors"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
            )
          })}
        </div>

        {mcps.length === 0 && (
          <div className="flex flex-col items-center justify-center h-60 gap-3">
            <Inbox className="w-10 h-10 text-muted-foreground/50" />
            <div className="text-center">
              <p className="text-sm font-medium text-foreground">Catálogo de MCPs vazio</p>
              <p className="text-xs text-muted-foreground mt-1">
                Crie um servidor ou escaneie os config files do projeto — depois injete-o para gravar no .mcp.json
              </p>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <button
                onClick={handleScan}
                disabled={scanning}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-50"
              >
                {scanning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                Escanear projeto
              </button>
              <button
                onClick={openCreateModal}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Criar MCP
              </button>
            </div>
          </div>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => !saving && setShowModal(false)}>
          <div className="w-full max-w-md rounded-lg border border-border bg-card shadow-xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-card z-10">
              <h2 className="text-sm font-semibold text-foreground">
                {editingMcp ? 'Edit MCP' : 'New MCP'}
              </h2>
              <button onClick={() => !saving && setShowModal(false)} className="p-1 rounded hover:bg-muted/40">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-6 py-4 space-y-4">
              {!editingMcp && (
                <div>
                  <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-1 block">Source</label>
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      onClick={() => setForm({ ...form, source: 'manual' })}
                      className={cn(
                        'text-[11px] px-2.5 py-1 rounded-md transition-colors',
                        form.source === 'manual' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
                      )}
                    >
                      Manual
                    </button>
                    <button
                      onClick={() => setForm({ ...form, source: 'scan' })}
                      className={cn(
                        'text-[11px] px-2.5 py-1 rounded-md transition-colors',
                        form.source === 'scan' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
                      )}
                    >
                      Scan project
                    </button>
                    <button
                      onClick={() => setForm({ ...form, source: 'config' })}
                      className={cn(
                        'text-[11px] px-2.5 py-1 rounded-md transition-colors',
                        form.source === 'config' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
                      )}
                    >
                      Import from config
                    </button>
                  </div>
                </div>
              )}
              {form.source === 'scan' && !editingMcp ? (
                <ScanMcpSelector
                  currentProject={currentProject}
                  onSelect={(scanned) => {
                    setForm({
                      ...form,
                      name: scanned.name,
                      description: scanned.description || '',
                      endpoint: scanned.endpoint || '',
                      type: scanned.type || 'sse',
                      source: 'manual',
                    })
                  }}
                />
              ) : form.source === 'config' && !editingMcp ? (
                <ConfigImportSelector
                  currentProject={currentProject}
                  onSelect={(scanned) => {
                    setForm({
                      ...form,
                      name: scanned.name,
                      description: scanned.description || '',
                      endpoint: scanned.endpoint || '',
                      type: scanned.type || 'sse',
                      source: 'manual',
                    })
                  }}
                />
              ) : (
                <>
                  <div>
                    <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-1 block">Name *</label>
                    <input
                      type="text"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      className="w-full bg-input rounded-md px-3 py-2 text-xs text-foreground outline-none border border-border focus:border-primary/50 transition-colors"
                      placeholder="MCP server name"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-1 block">Description</label>
                    <input
                      type="text"
                      value={form.description}
                      onChange={(e) => setForm({ ...form, description: e.target.value })}
                      className="w-full bg-input rounded-md px-3 py-2 text-xs text-foreground outline-none border border-border focus:border-primary/50 transition-colors"
                      placeholder="MCP description"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-1 block">Endpoint (URL)</label>
                    <input
                      type="url"
                      value={form.endpoint}
                      onChange={(e) => setForm({ ...form, endpoint: e.target.value })}
                      className="w-full bg-input rounded-md px-3 py-2 text-xs text-foreground outline-none border border-border focus:border-primary/50 transition-colors font-mono"
                      placeholder="http://localhost:3001/sse"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-1 block">Type</label>
                    <select
                      value={form.type}
                      onChange={(e) => setForm({ ...form, type: e.target.value })}
                      className="w-full bg-input rounded-md px-3 py-2 text-xs text-foreground outline-none border border-border focus:border-primary/50 transition-colors"
                    >
                      <option value="sse">SSE</option>
                      <option value="streamable-http">Streamable HTTP</option>
                    </select>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Define o <span className="font-mono">type</span> gravado no .mcp.json ao injetar (endpoints sem URL viram command/args)
                    </p>
                  </div>
                </>
              )}
              {error && (
                <p className="text-[11px] text-destructive">{error}</p>
              )}
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
                disabled={saving || !form.name}
                className="flex items-center gap-1.5 text-[11px] bg-primary text-primary-foreground px-3 py-1.5 rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {saving ? <><Loader2 className="w-3 h-3 animate-spin" /> Saving...</> : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showScanDrawer && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/60" onClick={() => setShowScanDrawer(false)}>
          <div className="w-full max-w-lg bg-card border-l border-border h-full overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-card z-10">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Scan Results</h2>
                <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
                  {scannedMcps.length} MCPs nos config files do projeto
                </p>
              </div>
              <button onClick={() => setShowScanDrawer(false)} className="p-1 rounded hover:bg-muted/40">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-2">
              {scannedMcps.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <FileSearch className="w-8 h-8 text-muted-foreground/50" />
                  <p className="text-xs text-muted-foreground">Nenhum MCP encontrado no projeto</p>
                </div>
              )}
              {scannedMcps.map((mcp, idx) => (
                <div
                  key={idx}
                  className={cn(
                    'rounded-lg border p-3 transition-colors',
                    selectedScanned.has(idx) ? 'border-primary/50 bg-primary/5' : 'border-border hover:border-primary/20'
                  )}
                >
                  <div className="flex items-start gap-3">
                    <button
                      onClick={() => toggleScannedSelection(idx)}
                      className={cn(
                        'mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors',
                        selectedScanned.has(idx) ? 'bg-primary border-primary' : 'border-border hover:border-primary/50'
                      )}
                    >
                      {selectedScanned.has(idx) && <Check className="w-3 h-3 text-primary-foreground" />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-foreground">{mcp.name}</p>
                      {mcp.endpoint && <p className="text-[10px] font-mono text-primary mt-0.5 truncate">{mcp.endpoint}</p>}
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{mcp.type || 'sse'}</span>
                        {mcp.file && (
                          <span
                            className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-primary/10 text-primary truncate"
                            title={`Encontrado em ${mcp.file}`}
                          >
                            {mcp.file}
                          </span>
                        )}
                        {mcp.path && <span className="text-[9px] font-mono text-muted-foreground truncate">{mcp.path}</span>}
                      </div>
                    </div>
                    <button
                      onClick={() => handleImportScanned(mcp)}
                      disabled={importing}
                      className="shrink-0 text-[10px] bg-primary text-primary-foreground px-2.5 py-1 rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors"
                    >
                      Import
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {selectedScanned.size > 0 && (
              <div className="px-6 py-3 border-t border-border sticky bottom-0 bg-card">
                <button
                  onClick={handleImportSelected}
                  disabled={importing}
                  className="w-full flex items-center justify-center gap-1.5 text-[11px] bg-primary text-primary-foreground px-3 py-2 rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  {importing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                  Import {selectedScanned.size} selected
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {deletingMcp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setDeletingMcp(null)}>
          <div className="w-full max-w-sm rounded-lg border border-border bg-card shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-border">
              <h2 className="text-sm font-semibold text-foreground">Delete MCP</h2>
              <p className="text-[11px] text-muted-foreground mt-1">
                Are you sure you want to delete "{deletingMcp.name}"? This action cannot be undone.
              </p>
            </div>
            <div className="px-6 py-3 border-t border-border flex justify-end gap-2">
              <button
                onClick={() => setDeletingMcp(null)}
                className="text-[11px] text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-md transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                className="text-[11px] bg-destructive text-destructive-foreground px-3 py-1.5 rounded-md hover:bg-destructive/90 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </Shell>
  )
}

function ScanMcpSelector({
  currentProject,
  onSelect,
}: {
  currentProject: any
  onSelect: (mcp: ScannedMcp) => void
}) {
  const [scanned, setScanned] = useState<ScannedMcp[]>([])
  const [loading, setLoading] = useState(false)

  const doScan = async () => {
    if (!currentProject) return
    setLoading(true)
    try {
      const results = await mcpsApi.scan(currentProject.id)
      setScanned(results)
    } catch {
      setScanned([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    doScan()
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 gap-2">
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        <span className="text-xs text-muted-foreground">Scanning project...</span>
      </div>
    )
  }

  if (scanned.length === 0) {
    return (
      <div className="text-center py-6">
        <p className="text-xs text-muted-foreground">Nenhum MCP encontrado no projeto</p>
        <button onClick={doScan} className="text-[11px] text-primary hover:underline mt-2">Tentar novamente</button>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <p className="text-[10px] text-muted-foreground">{scanned.length} MCPs found — select one to pre-fill the form:</p>
      {scanned.map((mcp, idx) => (
        <button
          key={idx}
          onClick={() => onSelect(mcp)}
          className="w-full text-left rounded-md border border-border p-2.5 hover:border-primary/40 hover:bg-primary/5 transition-colors"
        >
          <p className="text-xs font-semibold text-foreground">{mcp.name}</p>
          {mcp.endpoint && <p className="text-[10px] font-mono text-primary mt-0.5 truncate">{mcp.endpoint}</p>}
          <span className="flex items-center gap-2 mt-1">
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{mcp.type || 'sse'}</span>
            {mcp.file && (
              <span
                className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-primary/10 text-primary truncate"
                title={`Encontrado em ${mcp.file}`}
              >
                {mcp.file}
              </span>
            )}
          </span>
        </button>
      ))}
    </div>
  )
}

function ConfigImportSelector({
  currentProject,
  onSelect,
}: {
  currentProject: any
  onSelect: (mcp: ScannedMcp) => void
}) {
  const [configs, setConfigs] = useState<ScannedMcp[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    async function loadConfig() {
      if (!currentProject) return
      setLoading(true)
      try {
        const results = await mcpsApi.scan(currentProject.id)
        // o scan retorna `file` com o config file de origem (.mcp.json, .opencode.json...)
        setConfigs(results.filter((r: ScannedMcp) => !!r.file || r.path?.includes('config')))
      } catch {
        setConfigs([])
      } finally {
        setLoading(false)
      }
    }
    loadConfig()
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 gap-2">
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        <span className="text-xs text-muted-foreground">Loading config...</span>
      </div>
    )
  }

  if (configs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 gap-2">
        <FileCode className="w-6 h-6 text-muted-foreground/50" />
        <p className="text-xs text-muted-foreground">Nenhuma configuração MCP encontrada</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <p className="text-[10px] text-muted-foreground">{configs.length} MCPs from config — select one:</p>
      {configs.map((mcp, idx) => (
        <button
          key={idx}
          onClick={() => onSelect(mcp)}
          className="w-full text-left rounded-md border border-border p-2.5 hover:border-primary/40 hover:bg-primary/5 transition-colors"
        >
          <p className="text-xs font-semibold text-foreground">{mcp.name}</p>
          {mcp.endpoint && <p className="text-[10px] font-mono text-primary mt-0.5 truncate">{mcp.endpoint}</p>}
          <span className="flex items-center gap-2 mt-1">
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{mcp.type || 'sse'}</span>
            {mcp.file && (
              <span
                className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-primary/10 text-primary truncate"
                title={`Encontrado em ${mcp.file}`}
              >
                {mcp.file}
              </span>
            )}
          </span>
        </button>
      ))}
    </div>
  )
}
