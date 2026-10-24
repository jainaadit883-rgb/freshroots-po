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

export const rupees = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`

// Total order value, or null when any line has no known purchase price.
export function orderValue(lines: { skuId: string; qty: number }[], rates: Record<string, number>): number | null {
  let total = 0
  for (const l of lines) {
    const rate = rates[l.skuId]
    if (!rate || rate <= 0) return null
    total += rate * l.qty
  }
  return total
}
