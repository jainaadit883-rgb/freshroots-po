export const units = (n: number) => n.toLocaleString('en-IN')

export const weeks = (n: number) => (n >= 99 ? '99+' : n.toFixed(1))

export const percent = (ratio: number) => `${ratio >= 0 ? '+' : '−'}${Math.abs(Math.round(ratio * 100))}%`

export function when(iso: string | null): string {
  if (!iso) return ''
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso))
}
