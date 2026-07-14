import { useSyncExternalStore } from 'react'
import { X, AlertCircle } from 'lucide-react'
import { subscribeToasts, getToasts, dismissToast } from '../lib/toast'

export default function ToastContainer() {
  const toasts = useSyncExternalStore(subscribeToasts, getToasts)

  if (toasts.length === 0) return null

  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.type}`}>
          <AlertCircle size={16} />
          <span>{t.message}</span>
          <button type="button" onClick={() => dismissToast(t.id)} aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
