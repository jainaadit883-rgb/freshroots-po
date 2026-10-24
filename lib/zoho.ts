import type { PO, ZohoStatus } from './types'

export interface ZohoResult {
  status: ZohoStatus
  ref: string | null
  error?: string
}

const HOSTS: Record<string, { accounts: string; api: string }> = {
  in: { accounts: 'accounts.zoho.in', api: 'www.zohoapis.in' },
  com: { accounts: 'accounts.zoho.com', api: 'www.zohoapis.com' },
  eu: { accounts: 'accounts.zoho.eu', api: 'www.zohoapis.eu' },
  au: { accounts: 'accounts.zoho.com.au', api: 'www.zohoapis.com.au' },
  ca: { accounts: 'accounts.zohocloud.ca', api: 'www.zohoapis.ca' },
}

interface Config {
  clientId: string
  clientSecret: string
  refreshToken: string
  orgId: string
  dc: string
}

function config(): Config | null {
  const { ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN, ZOHO_ORG_ID } = process.env
  const dc = (process.env.ZOHO_DC || 'in').toLowerCase()
  if (!ZOHO_CLIENT_ID || !ZOHO_CLIENT_SECRET || !ZOHO_REFRESH_TOKEN || !ZOHO_ORG_ID || !HOSTS[dc]) return null
  return { clientId: ZOHO_CLIENT_ID, clientSecret: ZOHO_CLIENT_SECRET, refreshToken: ZOHO_REFRESH_TOKEN, orgId: ZOHO_ORG_ID, dc }
}

export const zohoConfigured = () => config() !== null

let cached: { token: string; expires: number } | null = null

async function accessToken(cfg: Config, force = false): Promise<string> {
  if (!force && cached && cached.expires > Date.now() + 60_000) return cached.token
  const res = await fetch(`https://${HOSTS[cfg.dc].accounts}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: cfg.refreshToken,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      grant_type: 'refresh_token',
    }),
    signal: AbortSignal.timeout(10_000),
  })
  const data = await res.json().catch(() => ({}))
  if (!data.access_token) throw new Error(`Zoho sign-in failed${data.error ? ` (${data.error})` : ''}. Check the Zoho credentials.`)
  cached = { token: data.access_token, expires: Date.now() + (data.expires_in ?? 3600) * 1000 }
  return cached.token
}

async function zoho<T>(
  cfg: Config,
  method: 'GET' | 'POST',
  path: string,
  params: Record<string, string> = {},
  body?: unknown,
  refreshed = false,
): Promise<T> {
  const url = new URL(`https://${HOSTS[cfg.dc].api}/inventory/v1${path}`)
  url.searchParams.set('organization_id', cfg.orgId)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)

  const res = await fetch(url, {
    method,
    headers: {
      authorization: `Zoho-oauthtoken ${await accessToken(cfg, refreshed)}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(12_000),
  })
  if (res.status === 401 && !refreshed) return zoho(cfg, method, path, params, body, true)

  const data = await res.json().catch(() => ({}))
  if (!res.ok || (typeof data.code === 'number' && data.code !== 0)) {
    throw new Error(data.message || `Zoho returned an error (${res.status})`)
  }
  return data as T
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

async function findVendor(cfg: Config, name: string): Promise<string> {
  const data = await zoho<{ contacts?: { contact_id: string; contact_name: string; contact_type?: string }[] }>(
    cfg,
    'GET',
    '/contacts',
    { contact_name: name },
  )
  const hit = (data.contacts ?? []).find((c) => same(c.contact_name, name) && (c.contact_type ?? 'vendor') === 'vendor')
  if (!hit) throw new Error(`Vendor "${name}" is not in Zoho Inventory. Add it as a vendor with exactly this name.`)
  return hit.contact_id
}

interface ZohoItem {
  item_id: string
  name: string
  sku?: string
  status?: string
  purchase_rate?: number
}

async function findItem(cfg: Config, skuId: string, name: string): Promise<ZohoItem> {
  const bySku = await zoho<{ items?: ZohoItem[] }>(cfg, 'GET', '/items', { sku: skuId })
  const skuHit = (bySku.items ?? []).find((i) => i.status !== 'inactive' && i.sku && same(i.sku, skuId))
  if (skuHit) return skuHit

  const byName = await zoho<{ items?: ZohoItem[] }>(cfg, 'GET', '/items', { name })
  const nameHit = (byName.items ?? []).find((i) => i.status !== 'inactive' && same(i.name, name))
  if (nameHit) return nameHit

  throw new Error(`"${name}" is not in Zoho Inventory. Give the item the SKU ${skuId}, or the exact name.`)
}

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())

interface ZohoPO {
  purchaseorder_id: string
  purchaseorder_number: string
}

// Creates the approved order in Zoho Inventory as a draft, so it can be reviewed and issued there.
// Safe to call again for the same order: if Zoho already has that PO number, it is reported as sent.
export async function pushPO(po: PO): Promise<ZohoResult> {
  const cfg = config()
  if (!cfg) return { status: 'not_connected', ref: null }

  try {
    const existing = await zoho<{ purchaseorders?: ZohoPO[] }>(cfg, 'GET', '/purchaseorders', {
      purchaseorder_number: po.number,
    })
    const already = (existing.purchaseorders ?? []).find((p) => p.purchaseorder_number === po.number)
    if (already) return { status: 'sent', ref: already.purchaseorder_id }

    const [vendorId, items] = await Promise.all([
      findVendor(cfg, po.distributorName),
      Promise.all(po.lines.map((l) => findItem(cfg, l.skuId, l.skuName))),
    ])

    const lineItems = po.lines.map((l, i) => {
      const rate = items[i].purchase_rate
      return {
        item_id: items[i].item_id,
        quantity: l.qty,
        ...(rate && rate > 0 ? { rate, purchase_rate: rate } : {}),
      }
    })

    const created = await zoho<{ purchase_order?: ZohoPO; purchaseorder?: ZohoPO }>(
      cfg,
      'POST',
      '/purchaseorders',
      { ignore_auto_number_generation: 'true' },
      {
        purchaseorder_number: po.number,
        vendor_id: vendorId,
        date: today(),
        notes: `Approved in Freshroots Orders as ${po.number}.`,
        line_items: lineItems,
      },
    )
    const made = created.purchase_order ?? created.purchaseorder
    if (!made?.purchaseorder_id) throw new Error('Zoho did not return the new order')
    return { status: 'sent', ref: made.purchaseorder_id }
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Could not reach Zoho'
    return { status: 'failed', ref: null, error: message.slice(0, 240) }
  }
}
