import { beforeEach, describe, expect, it } from 'vitest'
import { computePlan, ensureFreshPlan, syncDrafts } from '../lib/plan'
import { DemoStore } from '../lib/store/demo'
import { approvePO, receivePO, rejectPO, reopenPO } from '../lib/workflow'

const NOW = new Date('2026-10-24T06:00:00Z')
let store: DemoStore

beforeEach(() => {
  store = new DemoStore()
})

const pendingBy = async (name: string) => (await store.listPOs(['pending'])).find((p) => p.distributorName === name)!

describe('plan sync', () => {
  it('creates one PO per distributor with the right lines', async () => {
    expect(await syncDrafts(store, NOW)).toEqual({ created: 3, updated: 0, removed: 0 })
    const pos = await store.listPOs(['pending'])
    expect(pos).toHaveLength(3)
    const nutri = await pendingBy('NutriFlow Distributors')
    expect(nutri.lines.map((l) => [l.skuId, l.qty])).toEqual([['SKU001', 750], ['SKU013', 120]])
    expect(nutri.number).toMatch(/^PO-2026-000\d$/)
  })

  it('is idempotent and keeps quantities the approver edited', async () => {
    await syncDrafts(store, NOW)
    const nutri = await pendingBy('NutriFlow Distributors')
    await store.setQuantities(nutri.id, { SKU001: 600 })
    expect(await syncDrafts(store, NOW)).toEqual({ created: 0, updated: 3, removed: 0 })
    const after = await pendingBy('NutriFlow Distributors')
    expect(after.lines.find((l) => l.skuId === 'SKU001')!.qty).toBe(600)
    expect(after.lines.find((l) => l.skuId === 'SKU001')!.recommendedQty).toBe(750)
    expect(await store.listPOs(['pending'])).toHaveLength(3)
  })

  it('only re-syncs when the last run is stale', async () => {
    expect(await ensureFreshPlan(store, NOW)).toBe(true)
    expect(await ensureFreshPlan(store, new Date(NOW.getTime() + 3_600_000))).toBe(false)
    expect(await ensureFreshPlan(store, new Date(NOW.getTime() + 13 * 3_600_000))).toBe(true)
  })
})

describe('approve', () => {
  it('approves with an edited quantity and counts it as on order afterwards', async () => {
    await syncDrafts(store, NOW)
    const nutri = await pendingBy('NutriFlow Distributors')
    const res = await approvePO(store, nutri.id, { SKU001: 800 })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.po.status).toBe('approved')
      expect(res.po.zohoStatus).toBe('not_connected')
      expect(res.po.lines.find((l) => l.skuId === 'SKU001')!.qty).toBe(800)
    }
    const { recs } = await computePlan(store, NOW)
    expect(recs.find((r) => r.skuId === 'SKU001')!.action).toBe('OK')
    expect(await syncDrafts(store, NOW)).toMatchObject({ created: 0 })
  })

  it('drops lines set to zero, and refuses an order with nothing left', async () => {
    await syncDrafts(store, NOW)
    const nutri = await pendingBy('NutriFlow Distributors')
    const bad = await approvePO(store, nutri.id, { SKU001: 0, SKU013: 0 })
    expect(bad).toMatchObject({ ok: false, status: 400 })
    const ok = await approvePO(store, nutri.id, { SKU013: 0 })
    expect(ok.ok && ok.po.lines.map((l) => l.skuId)).toEqual(['SKU001'])
  })

  it('rejects bad quantities and unknown items', async () => {
    await syncDrafts(store, NOW)
    const nutri = await pendingBy('NutriFlow Distributors')
    expect(await approvePO(store, nutri.id, { SKU001: -5 })).toMatchObject({ ok: false, status: 400 })
    expect(await approvePO(store, nutri.id, { SKU001: 1.5 })).toMatchObject({ ok: false, status: 400 })
    expect(await approvePO(store, nutri.id, { SKU999: 10 })).toMatchObject({ ok: false, status: 400 })
  })

  it('cannot be approved twice', async () => {
    await syncDrafts(store, NOW)
    const nutri = await pendingBy('NutriFlow Distributors')
    await approvePO(store, nutri.id, {})
    expect(await approvePO(store, nutri.id, {})).toMatchObject({ ok: false, status: 409 })
  })
})

describe('reject, undo, receive', () => {
  it('snoozes rejected SKUs so they do not come straight back', async () => {
    await syncDrafts(store, NOW)
    const grain = await pendingBy('GrainPath Logistics')
    expect((await rejectPO(store, grain.id, 'Enough stock')).ok).toBe(true)
    await syncDrafts(store, NOW)
    expect((await store.listPOs(['pending'])).map((p) => p.distributorName)).not.toContain('GrainPath Logistics')
    const later = new Date(NOW.getTime() + 4 * 86_400_000)
    await syncDrafts(store, later)
    expect((await store.listPOs(['pending'])).map((p) => p.distributorName)).toContain('GrainPath Logistics')
  })

  it('undo returns an approved PO to pending', async () => {
    await syncDrafts(store, NOW)
    const meridian = await pendingBy('Meridian Trade Co.')
    await approvePO(store, meridian.id, {})
    const res = await reopenPO(store, meridian.id)
    expect(res.ok && res.po.status).toBe('pending')
  })

  it('undo also brings back a rejected order', async () => {
    await syncDrafts(store, NOW)
    const grain = await pendingBy('GrainPath Logistics')
    await rejectPO(store, grain.id, 'Order later')
    const res = await reopenPO(store, grain.id)
    expect(res.ok && res.po.status).toBe('pending')
    expect(res.ok && res.po.rejectReason).toBe(null)
  })

  it('undo is blocked once Zoho has the order', async () => {
    await syncDrafts(store, NOW)
    const meridian = await pendingBy('Meridian Trade Co.')
    await approvePO(store, meridian.id, {})
    await store.transition(meridian.id, 'approved', 'approved', { zohoStatus: 'sent', zohoRef: 'PO-1' })
    expect(await reopenPO(store, meridian.id)).toMatchObject({ ok: false, status: 409 })
  })

  it('receiving adds the quantities to stock and clears the on-order count', async () => {
    await syncDrafts(store, NOW)
    const nutri = await pendingBy('NutriFlow Distributors')
    await approvePO(store, nutri.id, {})
    expect((await receivePO(store, nutri.id)).ok).toBe(true)
    const inv = (await store.loadPlanningData()).inventory.find((i) => i.skuId === 'SKU001')!
    expect(inv.onHand).toBe(900 + 750)
    expect((await receivePO(store, nutri.id)).ok).toBe(false)
  })
})
