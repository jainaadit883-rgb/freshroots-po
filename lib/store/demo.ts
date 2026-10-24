import seed from '@/data/seed/seed.json'
import type { NewLine, PlanningData, PO, POStatus, StatusPatch } from '../types'
import { poNumber, type Store } from './types'

interface State {
  data: PlanningData
  pos: PO[]
  seq: number
  meta: Map<string, string>
}

const clone = <T>(v: T): T => structuredClone(v)

export class DemoStore implements Store {
  mode = 'demo' as const
  private s: State

  constructor() {
    this.s = { data: clone(seed) as PlanningData, pos: [], seq: 0, meta: new Map() }
  }

  async ping() {}

  async loadPlanningData() {
    return clone(this.s.data)
  }

  private skuName(id: string) {
    return this.s.data.skus.find((k) => k.id === id)?.name ?? id
  }

  private hydrate(lines: NewLine[]) {
    return lines.map((l) => ({ ...clone(l), skuName: this.skuName(l.skuId) }))
  }

  async listPOs(statuses?: POStatus[]) {
    const rows = statuses ? this.s.pos.filter((p) => statuses.includes(p.status)) : this.s.pos
    return clone(rows).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  async getPO(id: string) {
    const po = this.s.pos.find((p) => p.id === id)
    return po ? clone(po) : null
  }

  async createPO(distributorId: string, lines: NewLine[]) {
    const dist = this.s.data.distributors.find((d) => d.id === distributorId)
    if (!dist) throw new Error(`Unknown distributor ${distributorId}`)
    if (this.s.pos.some((p) => p.distributorId === distributorId && p.status === 'pending')) {
      throw new Error('A draft for this distributor already exists')
    }
    const createdAt = new Date().toISOString()
    const seq = ++this.s.seq
    const po: PO = {
      id: crypto.randomUUID(),
      seq,
      number: poNumber(seq, createdAt),
      distributorId,
      distributorName: dist.name,
      region: dist.region,
      status: 'pending',
      rejectReason: null,
      createdAt,
      decidedAt: null,
      receivedAt: null,
      zohoStatus: 'not_connected',
      zohoRef: null,
      lines: this.hydrate(lines),
    }
    this.s.pos.push(po)
    return clone(po)
  }

  private find(id: string) {
    const po = this.s.pos.find((p) => p.id === id)
    if (!po) throw new Error('PO not found')
    return po
  }

  async replaceLines(id: string, lines: NewLine[]) {
    this.find(id).lines = this.hydrate(lines)
  }

  async setQuantities(id: string, qtys: Record<string, number>) {
    for (const line of this.find(id).lines) if (line.skuId in qtys) line.qty = qtys[line.skuId]
  }

  async removeLines(id: string, skuIds: string[]) {
    const po = this.find(id)
    po.lines = po.lines.filter((l) => !skuIds.includes(l.skuId))
  }

  async deletePO(id: string) {
    this.s.pos = this.s.pos.filter((p) => p.id !== id)
  }

  async transition(id: string, from: POStatus, to: POStatus, patch: StatusPatch = {}) {
    const po = this.s.pos.find((p) => p.id === id)
    if (!po || po.status !== from) return false
    if (to === 'pending' && this.s.pos.some((p) => p.id !== id && p.distributorId === po.distributorId && p.status === 'pending')) {
      throw new Error('A draft for this distributor already exists')
    }
    po.status = to
    Object.assign(po, patch)
    return true
  }

  async receivePO(id: string) {
    const po = this.s.pos.find((p) => p.id === id)
    if (!po || po.status !== 'approved') return false
    po.status = 'received'
    po.receivedAt = new Date().toISOString()
    const today = po.receivedAt.slice(0, 10)
    for (const line of po.lines) {
      const inv = this.s.data.inventory.find((i) => i.skuId === line.skuId)
      if (inv) {
        inv.onHand += line.qty
        inv.asOf = today
      }
    }
    return true
  }

  async getMeta(key: string) {
    return this.s.meta.get(key) ?? null
  }

  async setMeta(key: string, value: string) {
    this.s.meta.set(key, value)
  }
}
