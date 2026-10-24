export type Perishability = 'High' | 'Low'

export interface Distributor {
  id: string
  name: string
  region: string
  status: string
}

export interface Sku {
  id: string
  name: string
  category: string
  perishability: Perishability
  standardQty: number
  uom: string
  distributorId: string
}

export interface SalesRow {
  skuId: string
  week: string
  units: number
}

export interface InventoryRow {
  skuId: string
  location: string
  onHand: number
  asOf: string
}

export interface CalendarRow {
  yearMonth: string
  isFestival: boolean
}

export interface PlanningData {
  distributors: Distributor[]
  skus: Sku[]
  sales: SalesRow[]
  inventory: InventoryRow[]
  calendar: CalendarRow[]
}

export type Action = 'REORDER_NOW' | 'REORDER_SOON' | 'PAUSE' | 'OK' | 'NO_DATA'

export interface Recommendation {
  skuId: string
  action: Action
  qty: number
  onHand: number
  onOrder: number
  avgLong: number
  avgShort: number
  trend: number
  effDemand: number
  coverWeeks: number
  minWeeks: number
  maxWeeks: number
  highDemand: boolean
  festival: boolean
  perishable: boolean
  standardQty: number
}

export type POStatus = 'pending' | 'approved' | 'rejected' | 'received'
export type ZohoStatus = 'not_connected' | 'queued' | 'sent'

export interface LineSnapshot {
  onHand: number
  onOrder: number
  effDemand: number
  avgLong: number
  avgShort: number
  trend: number
  coverWeeks: number
  minWeeks: number
  maxWeeks: number
  highDemand: boolean
  festival: boolean
  perishable: boolean
  standardQty: number
}

export interface POLine {
  skuId: string
  skuName: string
  qty: number
  recommendedQty: number
  action: 'REORDER_NOW' | 'REORDER_SOON'
  snapshot: LineSnapshot
}

export interface NewLine {
  skuId: string
  qty: number
  recommendedQty: number
  action: 'REORDER_NOW' | 'REORDER_SOON'
  snapshot: LineSnapshot
}

export interface PO {
  id: string
  seq: number
  number: string
  distributorId: string
  distributorName: string
  region: string
  status: POStatus
  rejectReason: string | null
  createdAt: string
  decidedAt: string | null
  receivedAt: string | null
  zohoStatus: ZohoStatus
  zohoRef: string | null
  lines: POLine[]
}

export interface StatusPatch {
  decidedAt?: string | null
  receivedAt?: string | null
  rejectReason?: string | null
  zohoStatus?: ZohoStatus
  zohoRef?: string | null
}
