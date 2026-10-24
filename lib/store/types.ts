import type { NewLine, PlanningData, PO, POStatus, StatusPatch } from '../types'

export interface Store {
  mode: 'supabase' | 'demo'
  ping(): Promise<void>
  loadPlanningData(): Promise<PlanningData>
  listPOs(statuses?: POStatus[]): Promise<PO[]>
  getPO(id: string): Promise<PO | null>
  createPO(distributorId: string, lines: NewLine[]): Promise<PO>
  replaceLines(id: string, lines: NewLine[]): Promise<void>
  setQuantities(id: string, qtys: Record<string, number>): Promise<void>
  removeLines(id: string, skuIds: string[]): Promise<void>
  deletePO(id: string): Promise<void>
  // Moves a PO between statuses only if it is still in `from`. Returns false if someone else got there first.
  transition(id: string, from: POStatus, to: POStatus, patch?: StatusPatch): Promise<boolean>
  receivePO(id: string): Promise<boolean>
  getMeta(key: string): Promise<string | null>
  setMeta(key: string, value: string): Promise<void>
}

export const poNumber = (seq: number, createdAt: string) =>
  `PO-${new Date(createdAt).getUTCFullYear()}-${String(seq).padStart(4, '0')}`
