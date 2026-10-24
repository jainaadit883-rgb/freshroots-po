import { describe, expect, it } from 'vitest'
import seed from '../data/seed/seed.json'
import { recommend } from '../lib/engine'
import type { PlanningData } from '../lib/types'

const data = seed as PlanningData
const OCT = new Date('2026-10-24T06:00:00Z')
const JUL = new Date('2026-07-15T06:00:00Z')
const byId = (recs: ReturnType<typeof recommend>) => Object.fromEntries(recs.map((r) => [r.skuId, r]))

describe('engine on seed data, festival month (Oct 2026)', () => {
  const recs = byId(recommend(data, OCT))

  it('matches the averages from the hand analysis', () => {
    expect(recs.SKU001.avgLong).toBe(214.9)
    expect(recs.SKU001.avgShort).toBe(261)
    expect(recs.SKU001.effDemand).toBe(268.6)
    expect(recs.SKU011.avgLong).toBe(204.3)
  })

  it('flags exactly the five SKUs that need a reorder now', () => {
    const now = Object.values(recs).filter((r) => r.action === 'REORDER_NOW').map((r) => r.skuId).sort()
    expect(now).toEqual(['SKU001', 'SKU003', 'SKU004', 'SKU011', 'SKU013'])
  })

  it('orders 1.5x the standard quantity for the high-demand SKU only', () => {
    expect(recs.SKU001.highDemand).toBe(true)
    expect(recs.SKU001.qty).toBe(750)
    expect(recs.SKU003.qty).toBe(300)
    expect(recs.SKU004.qty).toBe(150)
    expect(recs.SKU011.qty).toBe(500)
    expect(recs.SKU013.qty).toBe(120)
  })

  it('pauses the two overstocked SKUs, using the tighter window for perishables', () => {
    expect(recs.SKU006.action).toBe('PAUSE')
    expect(recs.SKU007.action).toBe('PAUSE')
    expect(recs.SKU007.maxWeeks).toBe(4)
    expect(recs.SKU004.minWeeks).toBe(3)
  })

  it('leaves the other eight alone', () => {
    const ok = Object.values(recs).filter((r) => r.action === 'OK')
    expect(ok).toHaveLength(8)
  })
})

describe('festival uplift', () => {
  it('does not apply outside festival months', () => {
    const recs = byId(recommend(data, JUL))
    expect(recs.SKU001.festival).toBe(false)
    expect(recs.SKU001.effDemand).toBe(214.9)
    expect(recs.SKU001.coverWeeks).toBeCloseTo(4.2, 1)
  })

  it('can change the outcome: Peanut Butter is fine in July, short in October', () => {
    expect(byId(recommend(data, JUL)).SKU013.coverWeeks).toBeCloseTo(3.96, 1)
    expect(byId(recommend(data, OCT)).SKU013.coverWeeks).toBeCloseTo(3.17, 1)
  })
})

describe('stock already on order', () => {
  it('counts approved-but-not-received quantities so the same need is not ordered twice', () => {
    const recs = byId(recommend(data, OCT, { SKU001: 750, SKU003: 300 }))
    expect(recs.SKU001.onOrder).toBe(750)
    expect(recs.SKU001.action).toBe('OK')
    expect(recs.SKU003.action).toBe('OK')
    expect(recs.SKU004.action).toBe('REORDER_NOW')
  })

  it('still pauses a SKU whose stock plus open orders is too high', () => {
    const recs = byId(recommend(data, OCT, { SKU002: 5000 }))
    expect(recs.SKU002.action).toBe('PAUSE')
  })
})

describe('edge cases', () => {
  it('reports NO_DATA for a SKU with no sales history', () => {
    const trimmed: PlanningData = { ...data, sales: data.sales.filter((s) => s.skuId !== 'SKU002') }
    expect(byId(recommend(trimmed, OCT)).SKU002.action).toBe('NO_DATA')
  })

  it('suggests a reorder for rising demand even when stock is in range', () => {
    const rising: PlanningData = {
      ...data,
      inventory: data.inventory.map((i) => (i.skuId === 'SKU001' ? { ...i, onHand: 2500 } : i)),
    }
    const r = byId(recommend(rising, OCT)).SKU001
    expect(r.action).toBe('REORDER_SOON')
    expect(r.qty).toBe(750)
  })
})
