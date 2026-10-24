export interface ToastState {
  text: string
  tone?: 'bad'
  action?: { label: string; run: () => void }
}

export default function Toast({ toast }: { toast: ToastState | null }) {
  if (!toast) return null
  return (
    <div className={`toast glass${toast.tone === 'bad' ? ' bad' : ''}`} role="status" aria-live="polite">
      <span>{toast.text}</span>
      {toast.action && <button onClick={toast.action.run}>{toast.action.label}</button>}
    </div>
  )
}
