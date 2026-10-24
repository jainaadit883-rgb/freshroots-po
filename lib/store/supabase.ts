import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { LineSnapshot, NewLine, PlanningData, PO, POStatus, StatusPatch } from '../types'
import { poNumber, type Store } from './types'

type Row = Record<string, any>

const PO_SELECT = '*, distributors(name, region), po_lines(*, skus(name))'

function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`)
  return res.data as T
}

function mapPO(r: Row): PO {
  return {
    id: r.id,
    seq: Number(r.seq),
    number: poNumber(Number(r.seq), r.created_at),
    distributorId: r.distributor_id,
    distributorName: r.distributors?.name ?? r.distributor_id,
    region: r.distributors?.region ?? '',
    status: r.status,
    rejectReason: r.reject_reason,
    createdAt: r.created_at,
    decidedAt: r.decided_at,
    receivedAt: r.received_at,
    zohoStatus: r.zoho_status,
    zohoRef: r.zoho_ref,
    lines: (r.po_lines ?? [])
      .map((l: Row) => ({
        skuId: l.sku_id,
        skuName: l.skus?.name ?? l.sku_id,
        qty: l.qty,
        recommendedQty: l.recommended_qty,
        action: l.action,
        snapshot: l.snapshot as LineSnapshot,
      }))
      .sort((a: { skuId: string }, b: { skuId: string }) => a.skuId.localeCompare(b.skuId)),
  }
}

const lineRow = (poId: string, l: NewLine) => ({
  po_id: poId,
  sku_id: l.skuId,
  qty: l.qty,
  recommended_qty: l.recommendedQty,
  action: l.action,
  snapshot: l.snapshot,
})

export class SupabaseStore implements Store {
  mode = 'supabase' as const
  private db: SupabaseClient

  constructor(url: string, serviceKey: string) {
    this.db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  }

  async ping() {
    must(await this.db.from('distributors').select('id').limit(1), 'ping')
  }

  async loadPlanningData(): Promise<PlanningData> {
    const [dists, skus, inv, cal] = await Promise.all([
      this.db.from('distributors').select('*'),
      this.db.from('skus').select('*'),
      this.db.from('inventory').select('*'),
      this.db.from('calendar').select('*'),
    ])

    // Supabase returns at most 1000 rows per request; page newest-first and stop once we have enough weeks.
    const sales: PlanningData['sales'] = []
    const weeks = new Set<string>()
    for (let from = 0; from < 200_000; from += 1000) {
      const page = must(
        await this.db
          .from('weekly_sales')
          .select('sku_id, week, units_sold')
          .order('week', { ascending: false })
          .order('sku_id')
          .range(from, from + 999),
        'weekly_sales',
      ) as Row[]
      for (const r of page) {
        weeks.add(r.week)
        sales.push({ skuId: r.sku_id, week: r.week, units: r.units_sold })
      }
      if (page.length < 1000 || weeks.size > 14) break
    }

    return {
      distributors: (must(dists, 'distributors') as Row[]).map((d) => ({
        id: d.id,
        name: d.name,
        region: d.region ?? '',
        status: d.status,
      })),
      skus: (must(skus, 'skus') as Row[]).map((s) => ({
        id: s.id,
        name: s.name,
        category: s.category ?? '',
        perishability: s.perishability,
        standardQty: s.standard_reorder_qty,
        uom: s.uom,
        distributorId: s.distributor_id,
      })),
      sales,
      inventory: (must(inv, 'inventory') as Row[]).map((i) => ({
        skuId: i.sku_id,
        location: i.location ?? '',
        onHand: i.units_on_hand,
        asOf: i.as_of_date,
      })),
      calendar: (must(cal, 'calendar') as Row[]).map((c) => ({
        yearMonth: c.year_month,
        isFestival: c.is_festival_month,
      })),
    }
  }

  async listPOs(statuses?: POStatus[]) {
    let q = this.db.from('purchase_orders').select(PO_SELECT).order('created_at', { ascending: false })
    if (statuses) q = q.in('status', statuses)
    return (must(await q, 'listPOs') as Row[]).map(mapPO)
  }

  async getPO(id: string) {
    const row = must(await this.db.from('purchase_orders').select(PO_SELECT).eq('id', id).maybeSingle(), 'getPO')
    return row ? mapPO(row as Row) : null
  }

  async createPO(distributorId: string, lines: NewLine[]) {
    const created = must(
      await this.db.from('purchase_orders').insert({ distributor_id: distributorId }).select('id').single(),
      'createPO',
    ) as Row
    const res = await this.db.from('po_lines').insert(lines.map((l) => lineRow(created.id, l)))
    if (res.error) {
      await this.db.from('purchase_orders').delete().eq('id', created.id)
      throw new Error(`createPO lines: ${res.error.message}`)
    }
    return (await this.getPO(created.id))!
  }

  async replaceLines(id: string, lines: NewLine[]) {
    must(await this.db.from('po_lines').delete().eq('po_id', id).select('sku_id'), 'replaceLines delete')
    must(await this.db.from('po_lines').insert(lines.map((l) => lineRow(id, l))).select('sku_id'), 'replaceLines insert')
  }

  async setQuantities(id: string, qtys: Record<string, number>) {
    for (const [skuId, qty] of Object.entries(qtys)) {
      must(await this.db.from('po_lines').update({ qty }).eq('po_id', id).eq('sku_id', skuId).select('sku_id'), 'setQuantities')
    }
  }

  async removeLines(id: string, skuIds: string[]) {
    if (!skuIds.length) return
    must(await this.db.from('po_lines').delete().eq('po_id', id).in('sku_id', skuIds).select('sku_id'), 'removeLines')
  }

  async deletePO(id: string) {
    must(await this.db.from('purchase_orders').delete().eq('id', id).select('id'), 'deletePO')
  }

  async transition(id: string, from: POStatus, to: POStatus, patch: StatusPatch = {}) {
    const update: Row = { status: to }
    if ('decidedAt' in patch) update.decided_at = patch.decidedAt
    if ('receivedAt' in patch) update.received_at = patch.receivedAt
    if ('rejectReason' in patch) update.reject_reason = patch.rejectReason
    if ('zohoStatus' in patch) update.zoho_status = patch.zohoStatus
    if ('zohoRef' in patch) update.zoho_ref = patch.zohoRef
    const rows = must(
      await this.db.from('purchase_orders').update(update).eq('id', id).eq('status', from).select('id'),
      'transition',
    ) as Row[]
    return rows.length > 0
  }

  async receivePO(id: string) {
    return must(await this.db.rpc('receive_po', { p_id: id }), 'receive_po') as unknown as boolean
  }

  async getMeta(key: string) {
    const row = must(await this.db.from('meta').select('value').eq('key', key).maybeSingle(), 'getMeta') as Row | null
    return row?.value ?? null
  }

  async setMeta(key: string, value: string) {
    must(await this.db.from('meta').upsert({ key, value }).select('key'), 'setMeta')
  }
}
