'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

/**
 * Alertas dentro do navegador — a camada que funciona onde push não funciona.
 *
 * Pelo IP da LAN em http a origem não é segura, então nada de Service Worker
 * nem Web Push: o que sobra com a aba aberta é som, vibração e o contador no
 * título. O push de verdade (com o app fechado) é o ntfy, configurado no
 * backend — ver docs/guides/mobile-e-notificacoes.md.
 *
 * A Notification API entra como bônus oportunista: em `localhost` a origem É
 * segura, então o desktop ganha notificação de sistema de graça.
 */

export type AlertUrgency = 'high' | 'normal'

export interface AlertPrefs {
  sound: boolean
  vibrate: boolean
  /** Notificação de sistema (só em origem segura e com permissão concedida). */
  system: boolean
}

const DEFAULT_PREFS: AlertPrefs = { sound: true, vibrate: true, system: true }
const STORAGE_KEY = 'orchestr.alertPrefs'

export interface AlertInput {
  title: string
  body?: string
  urgency: AlertUrgency
  /** Colapsa notificações repetidas do mesmo assunto na mesma linha. */
  tag?: string
}

interface BrowserAlertsValue {
  prefs: AlertPrefs
  setPrefs: (patch: Partial<AlertPrefs>) => void
  /** `false` quando a origem não é segura — aí a Notification API não existe. */
  systemSupported: boolean
  systemPermission: NotificationPermission | 'unsupported'
  requestSystemPermission: () => Promise<NotificationPermission | 'unsupported'>
  alert: (input: AlertInput) => void
  /** `true` depois do primeiro toque/clique: som e vibração exigem isso. */
  primed: boolean
}

const BrowserAlertsContext = createContext<BrowserAlertsValue | null>(null)

export function useBrowserAlerts(): BrowserAlertsValue {
  const ctx = useContext(BrowserAlertsContext)
  if (!ctx) throw new Error('useBrowserAlerts precisa do BrowserAlertsProvider')
  return ctx
}

function readPrefs(): AlertPrefs {
  if (typeof window === 'undefined') return DEFAULT_PREFS
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_PREFS
    return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<AlertPrefs>) }
  } catch {
    return DEFAULT_PREFS
  }
}

/** Padrão de vibração por urgência — `high` é o que se sente no bolso. */
const VIBRATION: Record<AlertUrgency, number[]> = {
  high: [140, 70, 140],
  normal: [60],
}

/** Blips (Hz, segundos) — dois tons subindo para `high`, um curto para `normal`. */
const TONES: Record<AlertUrgency, Array<[number, number]>> = {
  high: [
    [880, 0.11],
    [1320, 0.13],
  ],
  normal: [[660, 0.08]],
}

export function BrowserAlertsProvider({ children }: { children: ReactNode }) {
  // Sem prefs no primeiro render: localStorage não existe no servidor, e ler no
  // initializer daria hidratação divergente.
  const [prefs, setPrefsState] = useState<AlertPrefs>(DEFAULT_PREFS)
  const [systemPermission, setSystemPermission] = useState<
    NotificationPermission | 'unsupported'
  >('unsupported')
  const [primed, setPrimed] = useState(false)
  const audioRef = useRef<AudioContext | null>(null)

  useEffect(() => {
    setPrefsState(readPrefs())
    if (typeof Notification !== 'undefined' && window.isSecureContext) {
      setSystemPermission(Notification.permission)
    }
  }, [])

  // Som e vibração só funcionam depois de uma interação do usuário na página
  // (política de autoplay / user activation). O primeiro toque destrava os dois
  // e também acorda o AudioContext, que nasce suspenso.
  useEffect(() => {
    if (primed) return
    const onFirstInteraction = () => {
      setPrimed(true)
      try {
        const Ctor =
          window.AudioContext ?? (window as any).webkitAudioContext
        if (Ctor) {
          audioRef.current = audioRef.current ?? new Ctor()
          void audioRef.current?.resume()
        }
      } catch {
        // Sem áudio disponível: vibração e título continuam valendo.
      }
    }
    window.addEventListener('pointerdown', onFirstInteraction, { once: true })
    window.addEventListener('keydown', onFirstInteraction, { once: true })
    return () => {
      window.removeEventListener('pointerdown', onFirstInteraction)
      window.removeEventListener('keydown', onFirstInteraction)
    }
  }, [primed])

  const setPrefs = useCallback((patch: Partial<AlertPrefs>) => {
    setPrefsState((current) => {
      const next = { ...current, ...patch }
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      } catch {
        // Modo privado sem storage: vale para a sessão atual e pronto.
      }
      return next
    })
  }, [])

  const requestSystemPermission = useCallback(async () => {
    if (typeof Notification === 'undefined' || !window.isSecureContext) {
      return 'unsupported' as const
    }
    const result = await Notification.requestPermission()
    setSystemPermission(result)
    return result
  }, [])

  const playTone = useCallback((urgency: AlertUrgency) => {
    // Oscillator em vez de um arquivo de áudio: nada para baixar, funciona
    // offline e não depende de asset com política de cache.
    const context = audioRef.current
    if (!context || context.state !== 'running') return
    let at = context.currentTime
    for (const [frequency, duration] of TONES[urgency]) {
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.value = frequency
      // Envelope curto: sem o ramp, ligar/desligar o oscillator estala.
      gain.gain.setValueAtTime(0, at)
      gain.gain.linearRampToValueAtTime(0.18, at + 0.01)
      gain.gain.linearRampToValueAtTime(0, at + duration)
      oscillator.connect(gain).connect(context.destination)
      oscillator.start(at)
      oscillator.stop(at + duration)
      at += duration + 0.04
    }
  }, [])

  const alert = useCallback(
    (input: AlertInput) => {
      if (prefs.sound) playTone(input.urgency)

      if (prefs.vibrate && typeof navigator !== 'undefined' && navigator.vibrate) {
        try {
          navigator.vibrate(VIBRATION[input.urgency])
        } catch {
          // Aparelho sem motor de vibração ou permissão negada.
        }
      }

      if (
        prefs.system &&
        systemPermission === 'granted' &&
        // Só com a aba escondida: com a página na frente, o toast já disse tudo
        // e a notificação de sistema seria eco.
        typeof document !== 'undefined' &&
        document.visibilityState === 'hidden'
      ) {
        try {
          new Notification(input.title, {
            body: input.body,
            icon: '/icon-192.png',
            badge: '/badge-96.png',
            tag: input.tag,
          })
        } catch {
          // Alguns navegadores só permitem via Service Worker; ignora.
        }
      }
    },
    [prefs, playTone, systemPermission],
  )

  const value = useMemo(
    () => ({
      prefs,
      setPrefs,
      systemSupported: systemPermission !== 'unsupported',
      systemPermission,
      requestSystemPermission,
      alert,
      primed,
    }),
    [prefs, setPrefs, systemPermission, requestSystemPermission, alert, primed],
  )

  return (
    <BrowserAlertsContext.Provider value={value}>
      {children}
    </BrowserAlertsContext.Provider>
  )
}
