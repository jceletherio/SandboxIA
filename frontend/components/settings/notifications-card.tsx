'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  AlertCircle,
  Bell,
  BellOff,
  CheckCircle2,
  Loader2,
  Monitor,
  Send,
  Smartphone,
  Vibrate,
  Volume2,
  Webhook,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useBrowserAlerts } from '@/lib/browser-alerts'
import {
  notificationsApi,
  type NotificationSettings,
  type NotificationTestResult,
} from '@/lib/api'

/** Rótulo e explicação de cada evento notificável — a ordem é a de urgência. */
const EVENTS: Array<{
  key: keyof NotificationSettings
  label: string
  hint: string
}> = [
  { key: 'notifyQuestion', label: 'Pergunta esperando', hint: 'a sessão para até você responder' },
  { key: 'notifyEscalation', label: 'Master escalou', hint: 'o Master não decidiu sozinho' },
  { key: 'notifyStalled', label: 'Sessão travada', hint: 'sem output além do limite do watchdog' },
  { key: 'notifyStageFailed', label: 'Stage falhou', hint: 'erro no meio do pipeline' },
  { key: 'notifySessionFailed', label: 'Sessão falhou / timeout', hint: 'pipeline interrompido' },
  { key: 'notifySessionCompleted', label: 'Sessão concluída', hint: 'sucesso — em fila longa isso vira spam' },
]

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-1 block">
        {label}
        {hint && (
          <span className="ml-2 normal-case tracking-normal text-muted-foreground/60">{hint}</span>
        )}
      </label>
      {children}
    </div>
  )
}

const inputClass =
  'w-full bg-input rounded-md px-3 py-2 text-xs text-foreground font-mono outline-none border border-border focus:border-primary/50 transition-colors'

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
  hint?: string
}) {
  return (
    // py-2 e o label inteiro clicável: no celular um checkbox de 13px sozinho é
    // alvo pequeno demais.
    <label className="flex items-start gap-2.5 py-2 cursor-pointer group">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 w-4 h-4 shrink-0 accent-primary"
      />
      <span className="min-w-0">
        <span className="text-xs text-foreground block leading-tight">{label}</span>
        {hint && (
          <span className="text-[11px] text-muted-foreground block leading-tight mt-0.5">{hint}</span>
        )}
      </span>
    </label>
  )
}

/**
 * Alertas deste navegador: som, vibração e notificação de sistema.
 *
 * Card próprio, acima do de push, porque é a parte que funciona sem
 * configuração nenhuma e sem depender do backend — inclusive em http na LAN,
 * onde Web Push não existe. Se o módulo do backend estiver fora, este bloco
 * continua de pé.
 */
function BrowserAlertsCard() {
  const {
    prefs,
    setPrefs,
    systemSupported,
    systemPermission,
    requestSystemPermission,
    alert,
    primed,
  } = useBrowserAlerts()

  return (
    <div className="rounded-lg border border-border bg-card p-6 space-y-3">
      <h2 className="text-xs font-semibold text-foreground flex items-center gap-2">
        <Volume2 className="w-4 h-4 text-primary" />
        Alertas neste navegador
      </h2>
      <p className="text-[11px] text-muted-foreground">
        Valem com a aba aberta (mesmo em segundo plano). Para ser avisado com o
        app fechado, configure o push abaixo.
      </p>

      <div className="divide-y divide-border/50">
        <Toggle
          checked={prefs.sound}
          onChange={(sound) => setPrefs({ sound })}
          label="Som"
          hint="dois blips curtos nos eventos urgentes"
        />
        <Toggle
          checked={prefs.vibrate}
          onChange={(vibrate) => setPrefs({ vibrate })}
          label="Vibração"
          hint="só em aparelho com motor de vibração"
        />
        <Toggle
          checked={prefs.system}
          onChange={(system) => setPrefs({ system })}
          label="Notificação de sistema"
          hint="só quando a aba está escondida — na frente, o toast já basta"
        />
      </div>

      {!primed && (
        // Não é um aviso decorativo: até o primeiro toque na página, o
        // navegador bloqueia áudio e vibração por política de user activation.
        <p className="text-[11px] text-status-waiting">
          Som e vibração destravam no primeiro toque nesta página.
        </p>
      )}

      {!systemSupported ? (
        <p className="text-[11px] text-muted-foreground">
          Notificação de sistema indisponível: esta origem não é segura. Pelo IP
          da LAN em <span className="font-mono">http</span> o navegador não
          oferece a API — em <span className="font-mono">localhost</span> ou por
          HTTPS, sim.
        </p>
      ) : systemPermission !== 'granted' ? (
        <button
          onClick={() => void requestSystemPermission()}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-border text-xs text-foreground hover:bg-accent transition-colors"
        >
          <Monitor className="w-3.5 h-3.5" />
          {systemPermission === 'denied'
            ? 'Permissão negada — libere nas configurações do site'
            : 'Permitir notificação de sistema'}
        </button>
      ) : (
        <p className="text-[11px] text-status-done">Permissão concedida.</p>
      )}

      <button
        onClick={() =>
          alert({
            title: 'Alerta de teste',
            body: 'Som e vibração deste navegador.',
            urgency: 'high',
            tag: 'test',
          })
        }
        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-border text-xs text-foreground hover:bg-accent transition-colors"
      >
        <Vibrate className="w-3.5 h-3.5" />
        Tocar/vibrar agora
      </button>
    </div>
  )
}

/**
 * Config de notificação push (backend → ntfy/webhook).
 *
 * Card separado, e não mais 200 linhas em `settings/page.tsx`: a página já tem
 * 1100 e o objetivo aqui é justamente conseguir mexer nisso pelo celular.
 */
function PushConfigCard() {
  const [settings, setSettings] = useState<NotificationSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(async () => {
    try {
      setSettings(await notificationsApi.getSettings())
    } catch (error: any) {
      setFeedback({ ok: false, text: `Falha lendo config: ${error.message}` })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  function patch(next: Partial<NotificationSettings>) {
    setSettings((current) => (current ? { ...current, ...next } : current))
  }

  async function save() {
    if (!settings) return
    setSaving(true)
    setFeedback(null)
    try {
      const { id, updatedAt, ...body } = settings
      const saved = await notificationsApi.updateSettings({
        ...body,
        // String vazia no banco daria "canal habilitado com URL inválida"; null
        // é o estado honesto de "não configurado".
        publicBaseUrl: body.publicBaseUrl?.trim() || null,
        ntfyTopic: body.ntfyTopic?.trim() || null,
        ntfyToken: body.ntfyToken?.trim() || null,
        webhookUrl: body.webhookUrl?.trim() || null,
        webhookSecret: body.webhookSecret?.trim() || null,
      })
      setSettings(saved)
      setFeedback({ ok: true, text: 'Config salva.' })
    } catch (error: any) {
      setFeedback({ ok: false, text: error.message })
    } finally {
      setSaving(false)
    }
  }

  async function test() {
    setTesting(true)
    setFeedback(null)
    try {
      const response = await notificationsApi.test()
      setFeedback({
        ok: response.ok,
        text: response.ok
          ? 'Enviado — confira o celular.'
          : describeFailures(response.results),
      })
    } catch (error: any) {
      setFeedback({ ok: false, text: error.message })
    } finally {
      setTesting(false)
    }
  }

  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-card p-6">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Carregando notificações…
        </div>
      </div>
    )
  }

  if (!settings) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 space-y-2">
        <h2 className="text-xs font-semibold text-foreground flex items-center gap-2">
          <Bell className="w-4 h-4 text-primary" />
          Notificações
        </h2>
        <p className="text-[11px] text-destructive">
          Backend não respondeu. Se o módulo é novo, o backend precisa de rebuild
          (<span className="font-mono">pnpm start:clean</span>).
        </p>
      </div>
    )
  }

  const activeSinks = [
    settings.ntfyEnabled && settings.ntfyTopic ? 'ntfy' : null,
    settings.webhookEnabled && settings.webhookUrl ? 'webhook' : null,
  ].filter(Boolean) as string[]

  return (
    <div className="rounded-lg border border-border bg-card p-6 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-xs font-semibold text-foreground flex items-center gap-2">
          {settings.enabled && activeSinks.length > 0 ? (
            <Bell className="w-4 h-4 text-primary" />
          ) : (
            <BellOff className="w-4 h-4 text-muted-foreground" />
          )}
          Notificações
        </h2>
        {/* Estado sem precisar abrir nada: o que está entregando, agora. */}
        <span
          className={cn(
            'text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0',
            settings.enabled && activeSinks.length > 0
              ? 'bg-status-done/15 text-status-done'
              : 'bg-muted text-muted-foreground',
          )}
        >
          {!settings.enabled
            ? 'DESLIGADO'
            : activeSinks.length === 0
              ? 'SEM CANAL'
              : activeSinks.join(' + ').toUpperCase()}
        </span>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Push de verdade no celular sem exigir HTTPS no orquestrador: o backend
        posta no <span className="font-mono">ntfy</span> e o app do ntfy entrega a
        notificação, mesmo com o navegador fechado.
      </p>

      <Toggle
        checked={settings.enabled}
        onChange={(enabled) => patch({ enabled })}
        label="Notificações ligadas"
        hint="desliga tudo sem perder a config dos canais"
      />

      <Field label="URL pública da UI" hint="usada no link da notificação">
        <input
          type="text"
          value={settings.publicBaseUrl ?? ''}
          onChange={(event) => patch({ publicBaseUrl: event.target.value })}
          placeholder="http://192.168.1.48:3000"
          className={inputClass}
        />
      </Field>

      <Field label="Janela de dedup (s)" hint="mesma tag não repete dentro da janela">
        <input
          type="number"
          min={0}
          max={3600}
          value={settings.dedupeWindowSec}
          onChange={(event) =>
            patch({ dedupeWindowSec: Number(event.target.value) || 0 })
          }
          className={inputClass}
        />
      </Field>

      {/* ---------------------------------------------------------- ntfy */}
      <div className="rounded-md border border-border/70 p-3 space-y-3">
        <div className="flex items-center gap-2">
          <Smartphone className="w-3.5 h-3.5 text-primary" />
          <span className="text-xs font-medium text-foreground">ntfy</span>
          <span className="text-[10px] text-muted-foreground">push no celular</span>
        </div>
        <Toggle
          checked={settings.ntfyEnabled}
          onChange={(ntfyEnabled) => patch({ ntfyEnabled })}
          label="Habilitar ntfy"
          hint="instale o app ntfy e assine o mesmo tópico"
        />
        <Field label="Servidor">
          <input
            type="text"
            value={settings.ntfyServerUrl}
            onChange={(event) => patch({ ntfyServerUrl: event.target.value })}
            placeholder="https://ntfy.sh"
            className={inputClass}
          />
        </Field>
        <Field label="Tópico" hint="qualquer um com o topico e o servidor recebe — use algo difícil de adivinhar">
          <input
            type="text"
            value={settings.ntfyTopic ?? ''}
            onChange={(event) => patch({ ntfyTopic: event.target.value })}
            placeholder="orchestr-a7f3c1"
            className={inputClass}
          />
        </Field>
        <Field label="Token" hint="opcional, para tópico protegido">
          <input
            type="password"
            value={settings.ntfyToken ?? ''}
            onChange={(event) => patch({ ntfyToken: event.target.value })}
            placeholder="tk_…"
            className={inputClass}
          />
        </Field>
      </div>

      {/* ------------------------------------------------------- webhook */}
      <div className="rounded-md border border-border/70 p-3 space-y-3">
        <div className="flex items-center gap-2">
          <Webhook className="w-3.5 h-3.5 text-primary" />
          <span className="text-xs font-medium text-foreground">Webhook</span>
          <span className="text-[10px] text-muted-foreground">Telegram, Slack, n8n…</span>
        </div>
        <Toggle
          checked={settings.webhookEnabled}
          onChange={(webhookEnabled) => patch({ webhookEnabled })}
          label="Habilitar webhook"
          hint="POST JSON com o payload cru"
        />
        <Field label="URL">
          <input
            type="text"
            value={settings.webhookUrl ?? ''}
            onChange={(event) => patch({ webhookUrl: event.target.value })}
            placeholder="http://localhost:5678/webhook/orchestr"
            className={inputClass}
          />
        </Field>
        <Field label="Segredo" hint="vai em X-Orchestr-Secret">
          <input
            type="password"
            value={settings.webhookSecret ?? ''}
            onChange={(event) => patch({ webhookSecret: event.target.value })}
            className={inputClass}
          />
        </Field>
      </div>

      {/* -------------------------------------------------------- eventos */}
      <div>
        <span className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">
          O que notifica
        </span>
        <div className="mt-1 divide-y divide-border/50">
          {EVENTS.map((event) => (
            <Toggle
              key={event.key}
              checked={Boolean(settings[event.key])}
              onChange={(value) => patch({ [event.key]: value } as Partial<NotificationSettings>)}
              label={event.label}
              hint={event.hint}
            />
          ))}
        </div>
      </div>

      {feedback && (
        <div
          className={cn(
            'flex items-start gap-2 p-2.5 rounded-md border text-xs',
            feedback.ok
              ? 'bg-status-done/10 border-status-done/20 text-status-done'
              : 'bg-destructive/10 border-destructive/30 text-destructive',
          )}
        >
          {feedback.ok ? (
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          )}
          <span className="min-w-0 break-words">{feedback.text}</span>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          Salvar
        </button>
        <button
          onClick={test}
          disabled={testing}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-border text-xs text-foreground hover:bg-accent disabled:opacity-50 transition-colors"
        >
          {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          Testar
        </button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        O teste usa a config <strong className="font-medium text-foreground">já salva</strong> — salve antes de testar.
      </p>
    </div>
  )
}

/**
 * Os dois lados da notificação, na ordem em que se resolve o problema: primeiro
 * o que funciona sem configurar nada, depois o push que exige um canal.
 */
export function NotificationsCard() {
  return (
    <>
      <BrowserAlertsCard />
      <PushConfigCard />
    </>
  )
}

/** Um erro por canal: "aceitou" e "chegou" são coisas diferentes, e o motivo importa. */
function describeFailures(results: NotificationTestResult[]): string {
  const failures = results.filter((result) => !result.ok)
  if (failures.length === 0) return 'Falhou sem detalhe do canal.'
  return failures.map((result) => `${result.sink}: ${result.error}`).join(' · ')
}
