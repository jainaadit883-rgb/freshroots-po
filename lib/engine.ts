import type { CalendarRow, PlanningData, Recommendation, SalesRow } from './types'

export interface EngineConfig {
  shortWindow: number
  longWindow: number
  highDemandRatio: number
  highDemandMultiplier: number
  festivalUplift: number
  minWeeks: number
  maxWeeks: number
  perishableMinWeeks: number
  perishableMaxWeeks: number
}

export const DEFAULTS: EngineConfig = {
  shortWindow: 4,
  longWindow: 12,
  highDemandRatio: 1.2,
  highDemandMultiplier: 1.5,
  festivalUplift: 1.25,
  minWeeks: 6,
  maxWeeks: 14,
  perishableMinWeeks: 3,
  perishableMaxWeeks: 4,
}

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)
const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d

export function yearMonthIST(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(d)
  const y = parts.find((p) => p.type === 'year')?.value
  const m = parts.find((p) => p.type === 'month')?.value
  return `${y}-${m}`
}

export function isFestivalMonth(calendar: CalendarRow[], d: Date): boolean {
  const ym = yearMonthIST(d)
  return calendar.find((c) => c.yearMonth === ym)?.isFestival ?? false
}

export function recommend(
  data: PlanningData,
  today: Date,
  onOrder: Record<string, number> = {},
  cfg: EngineConfig = DEFAULTS,
): Recommendation[] {
  const festival = isFestivalMonth(data.calendar, today)

  const salesBySku = new Map<string, SalesRow[]>()
  for (const row of data.sales) {
    const list = salesBySku.get(row.skuId) ?? []
    list.push(row)
    salesBySku.set(row.skuId, list)
  }
  const invBySku = new Map(data.inventory.map((i) => [i.skuId, i]))

  return data.skus.map((sku): Recommendation => {
    const perishable = sku.perishability === 'High'
    const minWeeks = perishable ? cfg.perishableMinWeeks : cfg.minWeeks
    const maxWeeks = perishable ? cfg.perishableMaxWeeks : cfg.maxWeeks
    const base = {
      skuId: sku.id,
      qty: 0,
      onHand: 0,
      onOrder: 0,
      avgLong: 0,
      avgShort: 0,
      trend: 0,
      effDemand: 0,
      coverWeeks: 0,
      minWeeks,
      maxWeeks,
      highDemand: false,
      festival,
      perishable,
      standardQty: sku.standardQty,
    }

    const rows = (salesBySku.get(sku.id) ?? []).sort((a, b) => a.week.localeCompare(b.week))
    const inv = invBySku.get(sku.id)
    if (!rows.length || !inv) return { ...base, action: 'NO_DATA' }

    const units = rows.map((r) => r.units)
    const avgLong = mean(units.slice(-cfg.longWindow))
    const avgShort = mean(units.slice(-cfg.shortWindow))
    const effDemand = avgLong * (festival ? cfg.festivalUplift : 1)
    const orderedQty = onOrder[sku.id] ?? 0
    const position = inv.onHand + orderedQty
    const coverWeeks = effDemand > 0 ? Math.min(position / effDemand, 999) : 999

    const highDemand = avgLong > 0 && avgShort > avgLong * cfg.highDemandRatio
    const boosted = Math.round(sku.standardQty * cfg.highDemandMultiplier)

    let action: Recommendation['action'] = 'OK'
    let qty = 0
    // A SKU with an open order is not re-proposed until that order is received.
    if (coverWeeks < minWeeks && orderedQty === 0) {
      action = 'REORDER_NOW'
      qty = highDemand ? boosted : sku.standardQty
    } else if (coverWeeks > maxWeeks) {
      action = 'PAUSE'
    } else if (highDemand && orderedQty === 0 && coverWeeks >= minWeeks) {
      action = 'REORDER_SOON'
      qty = boosted
    }

    return {
      ...base,
      action,
      qty,
      onHand: inv.onHand,
      onOrder: orderedQty,
      avgLong: round(avgLong),
      avgShort: round(avgShort),
      trend: avgLong > 0 ? round(avgShort / avgLong - 1, 3) : 0,
      effDemand: round(effDemand),
      coverWeeks: round(coverWeeks),
      highDemand,
    }
  })
}
