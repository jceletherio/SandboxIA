'use client'

import { cn } from '@/lib/utils'
import { AlertTriangle, X } from 'lucide-react'

interface ConfirmModalProps {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  loading?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmModal({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => !loading && onCancel()}>
      <div className="w-full max-w-sm rounded-lg border border-border bg-card shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            {destructive && <AlertTriangle className="w-4 h-4 text-destructive" />}
            <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">{message}</p>
        </div>
        <div className="px-6 py-3 border-t border-border flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={loading}
            className="text-[11px] text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-md transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={cn(
              'text-[11px] px-3 py-1.5 rounded-md transition-colors',
              destructive
                ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                : 'bg-primary text-primary-foreground hover:bg-primary/90',
              loading && 'opacity-50 cursor-not-allowed'
            )}
          >
            {loading ? '...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
