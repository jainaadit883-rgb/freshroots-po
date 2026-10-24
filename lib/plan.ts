import { recommend } from './engine'
import type { Store } from './store/types'
import type { NewLine, PlanningData, PO, Recommendation } from './types'

export const REJECT_SNOOZE_DAYS = 3
const FRESH_HOURS = 12
const LAST_RUN = 'last_plan_run'

export interface Plan {
  data: PlanningData
  recs: Recommendation[]
}

export async function computePlan(store: Store, now = new Date()): Promise<Plan> {
  const [data, approved] = await Promise.all([store.loadPlanningData(), store.listPOs(['approved'])])
  const onOrder: Record<string, number> = {}
  for (const po of approved) for (const l of po.lines) onOrder[l.skuId] = (onOrder[l.skuId] ?? 0) + l.qty
  return { data, recs: recommend(data, now, onOrder) }
}

function toLine(rec: Recommendation, qty: number): NewLine {
  return {
    skuId: rec.skuId,
    qty,
    recommendedQty: rec.qty,
    action: rec.action as 'REORDER_NOW' | 'REORDER_SOON',
    snapshot: {
      onHand: rec.onHand,
      onOrder: rec.onOrder,
      effDemand: rec.effDemand,
      avgLong: rec.avgLong,
      avgShort: rec.avgShort,
      trend: rec.trend,
      coverWeeks: rec.coverWeeks,
      minWeeks: rec.minWeeks,
      maxWeeks: rec.maxWeeks,
      highDemand: rec.highDemand,
      festival: rec.festival,
      perishable: rec.perishable,
      standardQty: rec.standardQty,
    },
  }
}

export interface SyncResult {
  created: number
  updated: number
  removed: number
}

// Turns the latest recommendations into one pending PO per distributor.
// Quantities the approver already edited are kept; lines that are no longer needed drop off.
export async function syncDrafts(store: Store, now = new Date()): Promise<SyncResult> {
  const { data, recs } = await computePlan(store, now)
  const skuToDist = new Map(data.skus.map((s) => [s.id, s.distributorId]))

  const rejected = await store.listPOs(['rejected'])
  const snoozed = new Set<string>()
  for (const po of rejected) {
    const at = po.decidedAt ? Date.parse(po.decidedAt) : 0
    if (now.getTime() - at < REJECT_SNOOZE_DAYS * 86_400_000) po.lines.forEach((l) => snoozed.add(l.skuId))
  }

  const needed = new Map<string, Recommendation[]>()
  for (const rec of recs) {
    if ((rec.action !== 'REORDER_NOW' && rec.action !== 'REORDER_SOON') || snoozed.has(rec.skuId)) continue
    const dist = skuToDist.get(rec.skuId)
    if (!dist) continue
    needed.set(dist, [...(needed.get(dist) ?? []), rec])
  }

  const result: SyncResult = { created: 0, updated: 0, removed: 0 }
  const pendingByDist = async () => new Map((await store.listPOs(['pending'])).map((p) => [p.distributorId, p]))
  let pending = await pendingByDist()

  const merge = (existing: PO, group: Recommendation[]): NewLine[] =>
    group.map((rec) => {
      const prev = existing.lines.find((l) => l.skuId === rec.skuId)
      const edited = prev && prev.qty !== prev.recommendedQty
      return toLine(rec, edited ? prev.qty : rec.qty)
    })

  for (const [dist, group] of needed) {
    const existing = pending.get(dist)
    if (existing) {
      await store.replaceLines(existing.id, merge(existing, group))
      result.updated++
      continue
    }
    try {
      await store.createPO(dist, group.map((r) => toLine(r, r.qty)))
      result.created++
    } catch {
      // A concurrent sync created this distributor's draft first; fold into it.
      pending = await pendingByDist()
      const winner = pending.get(dist)
      if (!winner) throw new Error(`Could not create a PO for ${dist}`)
      await store.replaceLines(winner.id, merge(winner, group))
      result.updated++
    }
  }

  for (const [dist, po] of pending) {
    if (!needed.has(dist)) {
      await store.deletePO(po.id)
      result.removed++
    }
  }

  await store.setMeta(LAST_RUN, now.toISOString())
  return result
}

export async function ensureFreshPlan(store: Store, now = new Date()): Promise<boolean> {
  const last = await store.getMeta(LAST_RUN)
  if (last && now.getTime() - Date.parse(last) < FRESH_HOURS * 3_600_000) return false
  await syncDrafts(store, now)
  return true
}
