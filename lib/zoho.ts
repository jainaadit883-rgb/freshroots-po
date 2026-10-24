import type { PO, ZohoStatus } from './types'

// Hook point for the Zoho Inventory integration. Called once a PO is approved.
// Until Zoho is connected the PO stays "approved" and is marked as waiting for Zoho.
export async function pushPO(_po: PO): Promise<{ status: ZohoStatus; ref: string | null }> {
  return { status: 'not_connected', ref: null }
}
