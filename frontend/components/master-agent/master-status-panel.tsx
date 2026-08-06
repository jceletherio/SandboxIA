'use client'

import { AlertCircle, Play, Square } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CliProfile } from '@/lib/api'

/** Estado do runtime do Master, como vem de `GET /master-agent/status`. */
export interface MasterStatusInfo {
  isActive: boolean
  projectId: string | null
  cliProfileId: string | null
  projectName?: string | null
  cliProfileName?: string | null
  /**
   * A sessão tmux do Master está de pé. Vem do backend desde sempre e não era
   * lido aqui: com o tmux morto (o servidor tmux 3.2a já segfaultou em produção,
   * derrubando todas as sessões) o painel seguia dizendo ACTIVE, e o Master
   * parecia "desconectar sozinho" sem nada na tela dizer isso. O backend resobe
   * o terminal em até 30s, então este estado é transitório — mas visível.
   */
  tmuxRunning?: boolean
}

interface MasterStatusPanelProps {
  /** Nome do projeto selecionado no switcher global (só rótulo). */
  projectName?: string | null
  status: MasterStatusInfo
  cliProfiles: CliProfile[]
  selectedProfileId: string
  onSelectProfile: (id: string) => void
  /** Nome do profile que o backend usaria se nenhum for escolhido. */
  defaultProfileName?: string
  activating?: boolean
  actionError?: string | null
  onActivate: () => void
  onDeactivate: () => void
  className?: string
}

/**
 * Cabeçalho do painel de situação: identidade da página, estado do runtime e
 * o controle Activate/Deactivate.
 *
 * Antes era um bloco vertical de sidebar (e depois de drawer). Virou uma faixa
 * horizontal fixa no topo da coluna central — o estado do Master é a primeira
 * coisa que a página responde, sem clique. Os números do projeto saíram daqui
 * e viraram a `MasterKpiStrip`.
 */
export function MasterStatusPanel({
  projectName,
  status,
  cliProfiles,
  selectedProfileId,
  onSelectProfile,
  defaultProfileName,
  activating = false,
  actionError,
  onActivate,
  onDeactivate,
  className,
}: MasterStatusPanelProps) {
  const masterActive = status.isActive
  // `tmuxRunning` ausente = backend antigo: não invente "terminal caído".
  const terminalDown = masterActive && status.tmuxRunning === false

  return (
    <header className={cn('border-b border-border bg-card/50 shrink-0', className)}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 lg:px-6 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-sm font-semibold text-foreground">Master Agent</h1>
            <span className="flex items-center gap-1.5">
              <span
                className={cn(
                  'w-2 h-2 rounded-full',
                  terminalDown
                    ? 'bg-status-waiting animate-pulse'
                    : masterActive
                      ? 'bg-status-running animate-pulse'
                      : 'bg-muted-foreground',
                )}
              />
              <span className="text-[10px] font-mono text-foreground">
                {terminalDown ? 'TERMINAL DOWN' : masterActive ? 'ACTIVE' : 'INACTIVE'}
              </span>
            </span>
            {terminalDown && (
              <span
                className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-status-waiting/10 text-status-waiting border border-status-waiting/20"
                title="A sessão tmux do Master caiu. O backend a resobe em até 30s — o contexto da conversa do CLI é perdido."
              >
                restarting
              </span>
            )}
            {masterActive && status.cliProfileName && (
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
                {status.cliProfileName}
              </span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground font-mono mt-0.5 truncate">
            {masterActive && status.projectName ? (
              <>
                Watching project: <span className="text-foreground">{status.projectName}</span>
              </>
            ) : (
              projectName || 'no project selected'
            )}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {!masterActive && (
            <label className="flex items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground hidden xl:inline">
                CLI profile
              </span>
              <select
                aria-label="CLI profile"
                value={selectedProfileId}
                onChange={(e) => onSelectProfile(e.target.value)}
                className="max-w-48 bg-input border border-border rounded-md px-2 py-1.5 text-[11px] text-foreground outline-none focus:border-primary/40"
              >
                <option value="">Default ({defaultProfileName || 'first available'})</option>
                {cliProfiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.binary}){p.builtin ? ' — builtin' : ''}
                  </option>
                ))}
              </select>
            </label>
          )}

          {!masterActive ? (
            <button
              onClick={onActivate}
              disabled={activating}
              className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Play className="w-3.5 h-3.5" />
              {activating ? 'Activating...' : 'Activate'}
            </button>
          ) : (
            <button
              onClick={onDeactivate}
              className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
            >
              <Square className="w-3.5 h-3.5" />
              Deactivate
            </button>
          )}
        </div>
      </div>

      {actionError && (
        <div className="mx-4 lg:mx-6 mb-3 flex items-start gap-1.5 p-2 rounded-md bg-destructive/10 border border-destructive/30">
          <AlertCircle className="w-3.5 h-3.5 text-destructive shrink-0 mt-0.5" />
          <p className="text-[11px] text-destructive leading-snug">{actionError}</p>
        </div>
      )}
    </header>
  )
}
