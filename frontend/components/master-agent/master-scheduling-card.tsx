'use client'

import {
  Activity,
  HeartPulse,
  MessageSquare,
  PlayCircle,
  Recycle,
  RefreshCw,
  Save,
  Sparkles,
  Timer,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import type { MasterScheduling, MasterSchedulingFields, MasterSchedulingSaveResult } from '@/lib/api'

interface MasterSchedulingCardProps {
  /** `null` enquanto a config não carregou — o card fica vazio, como antes. */
  scheduling: MasterScheduling | null
  /** Identifica de qual projeto é o `scheduling` — reseta o rascunho ao trocar de projeto. */
  projectId?: string
  /** Salva o rascunho inteiro de uma vez (save idempotente: mesmo valor duas vezes = no-op no backend). */
  onSave: (patch: MasterSchedulingFields) => Promise<MasterSchedulingSaveResult>
  /** Os botões "now" só existem com o Master ligado (mesma regra de antes). */
  masterActive: boolean
  checkingNow?: boolean
  /** Mensagem do último "Check sessions now" / "Report now". */
  checkResult?: string | null
  onCheckNow: () => void
  onReportNow: () => void
  className?: string
}

/** Abaixo disso o tick custa um turno do Master por ciclo sem entregar muito mais — a UI avisa. */
const NOISY_TICK_MINUTES = 5

function fieldsOf(scheduling: MasterScheduling): MasterSchedulingFields {
  const {
    tickIntervalMinutes,
    autoTriageEnabled,
    repromptAfterMs,
    sessionCheckEnabled,
    stalledAfterMinutes,
    statusReportEnabled,
    autoStartEnabled,
    autoStartMaxPerTick,
    contextRecycleEnabled,
    contextRecycleAfterTicks,
  } = scheduling
  return {
    tickIntervalMinutes,
    autoTriageEnabled,
    repromptAfterMs,
    sessionCheckEnabled,
    stalledAfterMinutes,
    statusReportEnabled,
    autoStartEnabled,
    autoStartMaxPerTick,
    contextRecycleEnabled,
    contextRecycleAfterTicks,
  }
}

function fieldsEqual(a: MasterSchedulingFields, b: MasterSchedulingFields): boolean {
  return (Object.keys(a) as Array<keyof MasterSchedulingFields>).every((key) => a[key] === b[key])
}

function formatTime(iso: string | null | undefined): string | null {
  if (!iso) return null
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
}

/** Toggle pill reutilizado pelas três partes do tick. */
function ScheduleToggle({
  label,
  icon: Icon,
  iconClass,
  enabled,
  onToggle,
}: {
  label: string
  icon: typeof Activity
  iconClass: string
  enabled: boolean
  onToggle: () => void
}) {
  return (
    <button onClick={onToggle} className="w-full flex items-center justify-between group">
      <span className="flex items-center gap-2 text-xs text-foreground">
        <Icon className={cn('w-3.5 h-3.5', iconClass)} />
        {label}
      </span>
      <span className={cn('w-7 h-4 rounded-full relative transition-colors', enabled ? 'bg-primary' : 'bg-muted')}>
        <span
          className={cn(
            'absolute top-0.5 w-3 h-3 rounded-full bg-background transition-all',
            enabled ? 'left-3.5' : 'left-0.5',
          )}
        />
      </span>
    </button>
  )
}

/** Campo numérico "a cada X min/ms". Só propaga valor finito e >= `min` pro rascunho local (não salva sozinho). */
function NumberField({
  label,
  value,
  min,
  unit = 'min',
  onChange,
}: {
  label: string
  value: number
  min: number
  unit?: string
  onChange: (value: number) => void
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[10px] text-muted-foreground pl-0.5">{label}</span>
      <span className="flex items-center gap-1">
        <input
          type="number"
          min={min}
          value={value}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10)
            if (Number.isFinite(v) && v >= min) onChange(v)
          }}
          className="w-14 bg-input border border-border rounded px-1.5 py-0.5 text-[11px] font-mono text-foreground text-right outline-none focus:border-primary/40"
        />
        <span className="text-[10px] text-muted-foreground">{unit}</span>
      </span>
    </div>
  )
}

/** Texto pequeno de "o que isso significa" — o pedido literal do usuário era não ter ideia. */
function Explainer({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] text-muted-foreground/80 leading-snug pl-0.5">{children}</p>
}

/**
 * Agendamento do Master: UM intervalo (o tick) e as partes que rodam nele —
 * auto triage, session health check e status report (MT-28; antes cada parte
 * tinha o intervalo próprio, o que dava três agendas num timer só). MT-2 segue
 * valendo no save idempotente por botão explícito.
 *
 * A config é por projeto (`Project.settings.automation`); o rascunho local só
 * é enviado ao clicar "Salvar", e o backend decide se mudou algo de verdade
 * (`changed`) antes de re-armar os timers — salvar o mesmo valor duas vezes é
 * no-op.
 */
export function MasterSchedulingCard({
  scheduling,
  projectId,
  onSave,
  masterActive,
  checkingNow = false,
  checkResult,
  onCheckNow,
  onReportNow,
  className,
}: MasterSchedulingCardProps) {
  const [draft, setDraft] = useState<MasterSchedulingFields | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [nextTick, setNextTick] = useState(scheduling?.nextTick ?? null)

  // Troca de projeto: o rascunho de um projeto não pode vazar pro outro.
  useEffect(() => {
    setDraft(null)
    setSaveMessage(null)
  }, [projectId])

  // Primeira carga deste projeto (ou depois de um reset acima): popula o
  // rascunho a partir do que veio do servidor. Depois disso só o usuário (ou
  // um save bem-sucedido) muda o rascunho — um refetch em segundo plano não
  // pisa em cima de uma edição em andamento.
  useEffect(() => {
    if (scheduling && !draft) {
      setDraft(fieldsOf(scheduling))
      setNextTick(scheduling.nextTick ?? null)
    }
  }, [scheduling, draft])

  const dirty = !!(draft && scheduling && !fieldsEqual(draft, fieldsOf(scheduling)))

  async function handleSave() {
    if (!draft) return
    setSaving(true)
    setSaveMessage(null)
    try {
      const result = await onSave(draft)
      setNextTick(result.nextTick)
      setSaveMessage(
        result.changed
          ? 'Salvo — automações re-armadas.'
          : 'Sem mudanças (valor já era esse).',
      )
    } catch (error) {
      setSaveMessage(`Falhou: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={cn('px-4 py-3 space-y-3', className)}>
      {!draft && <p className="text-[10px] text-muted-foreground">Loading schedule config...</p>}
      {draft && (
        <>
          <div className="space-y-1.5">
            <p className="flex items-center gap-2 text-xs text-foreground">
              <Timer className="w-3.5 h-3.5 text-primary" />
              Orchestrator tick
            </p>
            <NumberField
              label="Tick every"
              value={draft.tickIntervalMinutes}
              min={1}
              onChange={(v) => setDraft({ ...draft, tickIntervalMinutes: v })}
            />
            <Explainer>
              De quanto em quanto tempo o Master faz uma passada. Tudo que estiver ligado abaixo roda
              em TODO tick, num prompt único — um turno do CLI por tick, não um por automação.
            </Explainer>
            {draft.tickIntervalMinutes < NOISY_TICK_MINUTES && (
              <p className="text-[10px] text-status-waiting leading-snug pl-0.5">
                Tick abaixo de {NOISY_TICK_MINUTES} min gasta um turno do Master por ciclo.
                {draft.statusReportEnabled && ' Com o status report ligado, também posta no chat nessa cadência.'}
              </p>
            )}
            {nextTick && (
              <p className="text-[10px] text-muted-foreground/60 font-mono">
                Next tick: {formatTime(nextTick)}
              </p>
            )}
          </div>

          <div className="space-y-1.5 pt-1 border-t border-border/50">
            <p className="text-[10px] text-muted-foreground/80 pl-0.5">O que roda neste tick</p>
            <ScheduleToggle
              label="Auto triage"
              icon={MessageSquare}
              iconClass="text-primary"
              enabled={draft.autoTriageEnabled}
              onToggle={() => setDraft({ ...draft, autoTriageEnabled: !draft.autoTriageEnabled })}
            />
            <Explainer>
              O Master recebe as perguntas pendentes para triar, todas no mesmo prompt do tick.
            </Explainer>
            <NumberField
              label="Reprompt after"
              value={Math.round(draft.repromptAfterMs / 60_000)}
              min={1}
              onChange={(v) => setDraft({ ...draft, repromptAfterMs: v * 60_000 })}
            />
            <Explainer>
              Tempo mínimo antes de cutucar a MESMA pergunta de novo — evita repetir o prompt enquanto
              o Master ainda não respondeu.
            </Explainer>

            <ScheduleToggle
              label="Session health check"
              icon={HeartPulse}
              iconClass="text-status-running"
              enabled={draft.sessionCheckEnabled}
              onToggle={() => setDraft({ ...draft, sessionCheckEnabled: !draft.sessionCheckEnabled })}
            />
            <Explainer>
              O Master lista as sessões ativas e inspeciona (via MCP) as pausadas e as que passaram de
              "Stalled after" sem atualizar, tentando retomá-las antes de chamar você.
            </Explainer>
            <NumberField
              label="Stalled after"
              value={draft.stalledAfterMinutes}
              min={1}
              onChange={(v) => setDraft({ ...draft, stalledAfterMinutes: v })}
            />
            {masterActive && (
              <button
                onClick={onCheckNow}
                disabled={checkingNow}
                className="w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] border border-border text-muted-foreground hover:text-primary hover:border-primary/40 hover:bg-primary/5 disabled:opacity-50 transition-colors"
              >
                {checkingNow ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Timer className="w-3 h-3" />}
                Check sessions now
              </button>
            )}
            {checkResult && <p className="text-[10px] text-muted-foreground leading-snug">{checkResult}</p>}
            {scheduling?.lastSessionCheckAt && (
              <p className="text-[10px] text-muted-foreground/60 font-mono">
                Last check: {formatTime(scheduling.lastSessionCheckAt)}
              </p>
            )}

            <ScheduleToggle
              label="Status report"
              icon={Activity}
              iconClass="text-primary"
              enabled={draft.statusReportEnabled}
              onToggle={() => setDraft({ ...draft, statusReportEnabled: !draft.statusReportEnabled })}
            />
            <Explainer>
              O Master monta um resumo do orquestrador (sessões, travadas, perguntas pendentes) e posta
              no chat do dashboard. Sai na cadência do tick: se ficar ruidoso, desligue aqui ou aumente
              o intervalo acima.
            </Explainer>
            {masterActive && (
              <button
                onClick={onReportNow}
                className="w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] border border-border text-muted-foreground hover:text-primary hover:border-primary/40 hover:bg-primary/5 transition-colors"
              >
                <Sparkles className="w-3 h-3" />
                Report now
              </button>
            )}
          </div>

          <div className="space-y-1.5 pt-1 border-t border-border/50">
            <ScheduleToggle
              label="Auto-start next task"
              icon={PlayCircle}
              iconClass="text-status-running"
              enabled={draft.autoStartEnabled}
              onToggle={() => setDraft({ ...draft, autoStartEnabled: !draft.autoStartEnabled })}
            />
            <Explainer>
              A cada tick, se ligado, o orquestrador sobe sozinho as próximas macro tasks pendentes
              deste projeto (maior prioridade primeiro), sempre respeitando o limite de sessões. Uma
              task sai do automático com <span className="font-mono">metadata.autoStart: false</span>.
            </Explainer>
            <NumberField
              label="Max per tick"
              value={draft.autoStartMaxPerTick}
              min={1}
              onChange={(v) => setDraft({ ...draft, autoStartMaxPerTick: v })}
            />
            <Explainer>
              Teto por passada — com 13 pendentes e este valor em 1, sobe uma por tick em vez das 13
              de uma vez.
            </Explainer>
          </div>

          <div className="space-y-1.5 pt-1 border-t border-border/50">
            <ScheduleToggle
              label="Recycle Master context"
              icon={Recycle}
              iconClass="text-primary"
              enabled={draft.contextRecycleEnabled}
              onToggle={() =>
                setDraft({ ...draft, contextRecycleEnabled: !draft.contextRecycleEnabled })
              }
            />
            <Explainer>
              O terminal do Master é uma conversa só, que cresce a cada tick e vai encarecendo os
              próximos. Se ligado, ele é reiniciado a cada N ticks — nunca no meio de um turno. O
              estado do Master está no banco, então nada se perde.
            </Explainer>
            <NumberField
              label="Recycle every (ticks)"
              value={draft.contextRecycleAfterTicks}
              min={2}
              onChange={(v) => setDraft({ ...draft, contextRecycleAfterTicks: v })}
            />
          </div>

          <div className="pt-1 border-t border-border/50 space-y-1.5">
            <button
              onClick={handleSave}
              disabled={saving || !dirty}
              className="w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium border border-primary/40 text-primary hover:bg-primary/10 disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
            >
              {saving ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
              Salvar
            </button>
            {saveMessage && <p className="text-[10px] text-muted-foreground leading-snug">{saveMessage}</p>}
          </div>
        </>
      )}
    </div>
  )
}
