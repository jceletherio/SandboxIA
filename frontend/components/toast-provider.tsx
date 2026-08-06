'use client'

import { createContext, useContext, useCallback, useState, useRef, useEffect, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { CheckCircle2, AlertCircle, Loader2, X } from 'lucide-react'

type ToastType = 'success' | 'error' | 'loading'

interface Toast {
  id: string
  type: ToastType
  message: string
}

interface ToastContextValue {
  toast: (type: ToastType, message: string) => string
  dismiss: (id: string) => void
  update: (id: string, type: ToastType, message: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}

const icons = {
  success: CheckCircle2,
  error: AlertCircle,
  loading: Loader2,
}

const styles = {
  success: 'border-status-done/30 bg-status-done/10 text-status-done',
  error: 'border-destructive/30 bg-destructive/10 text-destructive',
  loading: 'border-primary/30 bg-primary/10 text-primary',
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
    const timer = timersRef.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timersRef.current.delete(id)
    }
  }, [])

  const toast = useCallback((type: ToastType, message: string) => {
    const id = Math.random().toString(36).slice(2, 10)
    setToasts(prev => [...prev, { id, type, message }])
    if (type !== 'loading') {
      const timer = setTimeout(() => dismiss(id), 4000)
      timersRef.current.set(id, timer)
    }
    return id
  }, [dismiss])

  const update = useCallback((id: string, type: ToastType, message: string) => {
    setToasts(prev => prev.map(t => t.id === id ? { ...t, type, message } : t))
    const existingTimer = timersRef.current.get(id)
    if (existingTimer) {
      clearTimeout(existingTimer)
      timersRef.current.delete(id)
    }
    if (type !== 'loading') {
      const timer = setTimeout(() => dismiss(id), 4000)
      timersRef.current.set(id, timer)
    }
  }, [dismiss])

  useEffect(() => {
    return () => {
      timersRef.current.forEach(timer => clearTimeout(timer))
    }
  }, [])

  return (
    <ToastContext.Provider value={{ toast, dismiss, update }}>
      {children}
      {/* No mobile os toasts sobem acima da MobileNav (3rem + inset) e ocupam a
          largura toda — a 4rem da direita eles ficavam atrás da barra. */}
      <div className="fixed z-[100] flex flex-col gap-2 left-3 right-3 bottom-[calc(3.75rem+env(safe-area-inset-bottom))] lg:left-auto lg:right-4 lg:bottom-4 lg:max-w-sm">
        {toasts.map(t => {
          const Icon = icons[t.type]
          return (
            <div
              key={t.id}
              className={cn(
                'flex items-center gap-2 px-3 py-2 rounded-lg border shadow-lg backdrop-blur-sm animate-in slide-in-from-right-2 fade-in duration-200',
                styles[t.type]
              )}
            >
              <Icon className={cn('w-3.5 h-3.5 shrink-0', t.type === 'loading' && 'animate-spin')} />
              <span className="text-xs font-medium flex-1 min-w-0">{t.message}</span>
              <button
                onClick={() => dismiss(t.id)}
                className="p-0.5 rounded hover:bg-white/10 transition-colors shrink-0"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}
