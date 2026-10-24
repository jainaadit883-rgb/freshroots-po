import { json } from '@/lib/api'
import { syncDrafts } from '@/lib/plan'
import { getStore } from '@/lib/store'

export const dynamic = 'force-dynamic'

// Vercel Cron calls this once a day with "Authorization: Bearer $CRON_SECRET".
// It refreshes the draft orders before the day starts and touches the database,
// which stops a free Supabase project from pausing for inactivity.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return json({ error: 'Unauthorized' }, 401)
  }
  try {
    const store = getStore()
    await store.ping()
    return json({ ok: true, store: store.mode, ...(await syncDrafts(store)) })
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : 'Failed' }, 500)
  }
}
