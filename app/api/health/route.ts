import { json } from '@/lib/api'
import { getStore } from '@/lib/store'

export const dynamic = 'force-dynamic'

// Touches the database, so an uptime monitor pinging this also counts as Supabase activity.
export async function GET() {
  try {
    const store = getStore()
    await store.ping()
    return json({ ok: true, store: store.mode })
  } catch {
    return json({ ok: false }, 503)
  }
}
