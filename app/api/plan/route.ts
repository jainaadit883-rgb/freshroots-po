import { guard, json } from '@/lib/api'
import { syncDrafts } from '@/lib/plan'
import { getStore } from '@/lib/store'

export async function POST(req: Request) {
  const blocked = await guard(req)
  if (blocked) return blocked
  try {
    return json({ ok: true, ...(await syncDrafts(getStore())) })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Could not check for new orders' }, 500)
  }
}
