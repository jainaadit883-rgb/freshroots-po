import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PO } from '../lib/types'
import { pushPO, zohoConfigured } from '../lib/zoho'

const po: PO = {
  id: 'po-1',
  seq: 1,
  number: 'PO-2026-0001',
  distributorId: 'DIST001',
  distributorName: 'NutriFlow Distributors',
  region: 'Maharashtra',
  status: 'approved',
  rejectReason: null,
  createdAt: '2026-10-24T00:00:00Z',
  decidedAt: '2026-10-24T01:00:00Z',
  receivedAt: null,
  zohoStatus: 'not_connected',
  zohoRef: null,
  zohoError: null,
  lines: [
    { skuId: 'SKU001', skuName: 'Freshroots Mango Drink 200ml', qty: 750, recommendedQty: 750, action: 'REORDER_NOW', snapshot: {} as never },
    { skuId: 'SKU013', skuName: 'Freshroots Peanut Butter 300g', qty: 120, recommendedQty: 120, action: 'REORDER_NOW', snapshot: {} as never },
  ],
}

type Call = { method: string; url: URL; body?: any }
let calls: Call[]
let zohoState: { vendors: any[]; items: Record<string, any>; existing: any[] }

function fakeZoho() {
  calls = []
  vi.stubGlobal('fetch', async (input: URL | string, init: RequestInit = {}) => {
    const url = new URL(String(input))
    const method = init.method ?? 'GET'
    const body = init.body && typeof init.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : undefined
    calls.push({ method, url, body })
    const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })

    if (url.pathname === '/oauth/v2/token') return reply({ access_token: 'tok', expires_in: 3600 })
    if (url.pathname.endsWith('/contacts')) return reply({ code: 0, contacts: zohoState.vendors })
    if (url.pathname.endsWith('/items') && !url.searchParams.get('sku') && !url.searchParams.get('name')) {
      return reply({ code: 0, items: Object.values(zohoState.items), page_context: { has_more_page: false } })
    }
    if (url.pathname.endsWith('/items')) {
      const key = url.searchParams.get('sku') ?? url.searchParams.get('name') ?? ''
      return reply({ code: 0, items: zohoState.items[key] ? [zohoState.items[key]] : [] })
    }
    if (url.pathname.endsWith('/purchaseorders') && method === 'GET') return reply({ code: 0, purchaseorders: zohoState.existing })
    if (url.pathname.endsWith('/purchaseorders') && method === 'POST') {
      return reply({ code: 0, message: 'success', purchase_order: { purchaseorder_id: 'Z-100', purchaseorder_number: body.purchaseorder_number } }, 201)
    }
    return reply({ message: 'not found' }, 404)
  })
}

beforeEach(() => {
  process.env.ZOHO_CLIENT_ID = 'id'
  process.env.ZOHO_CLIENT_SECRET = 'secret'
  process.env.ZOHO_REFRESH_TOKEN = 'refresh'
  process.env.ZOHO_ORG_ID = '999'
  process.env.ZOHO_DC = 'in'
  zohoState = {
    vendors: [{ contact_id: 'V1', contact_name: 'NutriFlow Distributors', contact_type: 'vendor' }],
    items: {
      SKU001: { item_id: 'I1', name: 'Mango', sku: 'SKU001', purchase_rate: 12.5 },
      SKU013: { item_id: 'I13', name: 'Peanut Butter', sku: 'SKU013' },
    },
    existing: [],
  }
  fakeZoho()
})

afterEach(() => {
  vi.unstubAllGlobals()
  for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN', 'ZOHO_ORG_ID', 'ZOHO_DC']) delete process.env[k]
})

describe('zoho push', () => {
  it('does nothing until Zoho is configured', async () => {
    delete process.env.ZOHO_ORG_ID
    expect(zohoConfigured()).toBe(false)
    expect(await pushPO(po)).toEqual({ status: 'not_connected', ref: null })
    expect(calls).toHaveLength(0)
  })

  it('creates the order in the India data centre with our PO number, vendor and item ids', async () => {
    const result = await pushPO(po)
    expect(result).toEqual({ status: 'sent', ref: 'Z-100' })

    const create = calls.find((c) => c.method === 'POST' && c.url.pathname.endsWith('/purchaseorders'))!
    expect(create.url.host).toBe('www.zohoapis.in')
    expect(create.url.searchParams.get('organization_id')).toBe('999')
    expect(create.url.searchParams.get('ignore_auto_number_generation')).toBe('true')
    expect(create.body.purchaseorder_number).toBe('PO-2026-0001')
    expect(create.body.vendor_id).toBe('V1')
    expect(create.body.line_items).toEqual([
      { item_id: 'I1', quantity: 750, rate: 12.5, purchase_rate: 12.5 },
      { item_id: 'I13', quantity: 120 },
    ])
  })

  it('falls back to the item name when the SKU is not set in Zoho', async () => {
    zohoState.items = { 'Freshroots Mango Drink 200ml': { item_id: 'I1', name: 'Freshroots Mango Drink 200ml' }, SKU013: zohoState.items.SKU013 }
    expect((await pushPO(po)).status).toBe('sent')
  })

  it('reports a missing vendor in plain words and creates nothing', async () => {
    zohoState.vendors = []
    const result = await pushPO(po)
    expect(result.status).toBe('failed')
    expect(result.error).toContain('NutriFlow Distributors')
    expect(calls.some((c) => c.method === 'POST' && c.url.pathname.endsWith('/purchaseorders'))).toBe(false)
  })

  it('reports a missing item', async () => {
    delete zohoState.items.SKU013
    const result = await pushPO(po)
    expect(result.status).toBe('failed')
    expect(result.error).toContain('Peanut Butter')
  })

  it('does not create a duplicate when Zoho already has this PO number', async () => {
    zohoState.existing = [{ purchaseorder_id: 'Z-77', purchaseorder_number: 'PO-2026-0001' }]
    expect(await pushPO(po)).toEqual({ status: 'sent', ref: 'Z-77' })
    expect(calls.some((c) => c.method === 'POST' && c.url.pathname.endsWith('/purchaseorders'))).toBe(false)
  })

  it('fails with a clear message when the credentials are rejected', async () => {
    vi.resetModules()
    const fresh = await import('../lib/zoho')
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: 'invalid_client' }), { status: 200 }))
    const result = await fresh.pushPO(po)
    expect(result.status).toBe('failed')
    expect(result.error).toContain('invalid_client')
  })
})

describe('purchase rates', () => {
  it('reads purchase prices by SKU and ignores items without one', async () => {
    vi.resetModules()
    const fresh = await import('../lib/zoho')
    expect(await fresh.purchaseRates()).toEqual({ SKU001: 12.5 })
  })

  it('caches for a few minutes, so a second call does not hit Zoho', async () => {
    vi.resetModules()
    const fresh = await import('../lib/zoho')
    await fresh.purchaseRates()
    const before = calls.length
    await fresh.purchaseRates()
    expect(calls.length).toBe(before)
  })

  it('returns nothing when Zoho is not configured or unreachable', async () => {
    vi.resetModules()
    vi.stubGlobal('fetch', async () => {
      throw new Error('offline')
    })
    const fresh = await import('../lib/zoho')
    expect(await fresh.purchaseRates()).toEqual({})
    delete process.env.ZOHO_ORG_ID
    vi.resetModules()
    expect(await (await import('../lib/zoho')).purchaseRates()).toEqual({})
  })
})
