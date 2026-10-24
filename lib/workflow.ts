import type { Store } from './store/types'
import type { PO } from './types'
import { pushPO } from './zoho'

export const REJECT_REASONS = ['Enough stock', 'Supplier issue', 'Order later', 'Other'] as const
const MAX_QTY = 1_000_000

export type Outcome = { ok: true; po: PO } | { ok: false; error: string; status: number }
const fail = (error: string, status = 409): Outcome => ({ ok: false, error, status })

async function load(store: Store, id: string): Promise<PO | Outcome> {
  const po = await store.getPO(id)
  return po ?? fail('Order not found', 404)
}
const isOutcome = (v: PO | Outcome): v is Outcome => 'ok' in v

export async function approvePO(store: Store, id: string, qtys: Record<string, unknown>): Promise<Outcome> {
  const found = await load(store, id)
  if (isOutcome(found)) return found
  if (found.status !== 'pending') return fail(`This order was already ${found.status}`)

  const final = new Map(found.lines.map((l) => [l.skuId, l.qty]))
  for (const [skuId, raw] of Object.entries(qtys)) {
    if (!final.has(skuId)) return fail('Unknown item on this order', 400)
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0 || raw > MAX_QTY) {
      return fail('Quantities must be whole numbers', 400)
    }
    final.set(skuId, raw)
  }
  const kept = [...final].filter(([, q]) => q > 0)
  if (!kept.length) return fail('Add at least one item to approve', 400)

  const changed = Object.fromEntries(kept.filter(([skuId, q]) => found.lines.find((l) => l.skuId === skuId)?.qty !== q))
  if (Object.keys(changed).length) await store.setQuantities(id, changed)
  const dropped = [...final].filter(([, q]) => q === 0).map(([skuId]) => skuId)
  if (dropped.length) await store.removeLines(id, dropped)

  const moved = await store.transition(id, 'pending', 'approved', {
    decidedAt: new Date().toISOString(),
    zohoStatus: 'not_connected',
  })
  if (!moved) return fail('This order was just changed elsewhere. Refresh to see it.')

  const approved = (await store.getPO(id))!
  const zoho = await pushPO(approved)
  if (zoho.status !== 'not_connected') {
    await store.transition(id, 'approved', 'approved', { zohoStatus: zoho.status, zohoRef: zoho.ref })
  }
  return { ok: true, po: (await store.getPO(id))! }
}

export async function rejectPO(store: Store, id: string, reason: unknown): Promise<Outcome> {
  const found = await load(store, id)
  if (isOutcome(found)) return found
  const text = typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 80) : 'Other'
  const moved = await store.transition(id, 'pending', 'rejected', {
    decidedAt: new Date().toISOString(),
    rejectReason: text,
  })
  if (!moved) return fail(`This order was already ${found.status}`)
  return { ok: true, po: (await store.getPO(id))! }
}

// Undo for either decision: an approval that has not reached Zoho, or a rejection.
export async function reopenPO(store: Store, id: string): Promise<Outcome> {
  const found = await load(store, id)
  if (isOutcome(found)) return found
  if (found.status !== 'approved' && found.status !== 'rejected') {
    return fail(`This order is ${found.status}, so it can't be undone`)
  }
  if (found.status === 'approved' && found.zohoStatus !== 'not_connected') {
    return fail('This order has already gone to Zoho')
  }

  const newer = `There is a newer draft for ${found.distributorName}. Decide that one first.`
  const pending = await store.listPOs(['pending'])
  if (pending.some((p) => p.distributorId === found.distributorId)) return fail(newer)
  try {
    const moved = await store.transition(id, found.status, 'pending', { decidedAt: null, rejectReason: null })
    if (!moved) return fail('This order was just changed elsewhere. Refresh to see it.')
  } catch {
    return fail(newer)
  }
  return { ok: true, po: (await store.getPO(id))! }
}

export async function receivePO(store: Store, id: string): Promise<Outcome> {
  const found = await load(store, id)
  if (isOutcome(found)) return found
  if (!(await store.receivePO(id))) return fail(`This order is ${found.status}, so it can't be received`)
  return { ok: true, po: (await store.getPO(id))! }
}
