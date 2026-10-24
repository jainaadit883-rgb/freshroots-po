import { DemoStore } from './demo'
import { SupabaseStore } from './supabase'
import type { Store } from './types'

const g = globalThis as unknown as { __poStore?: Store }

export function getStore(): Store {
  if (!g.__poStore) {
    const url = process.env.SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    g.__poStore = url && key ? new SupabaseStore(url, key) : new DemoStore()
  }
  return g.__poStore
}
