import { guard, json } from '@/lib/api'
import { getStore } from '@/lib/store'
import { approvePO, receivePO, rejectPO, reopenPO, retryZoho } from '@/lib/workflow'

export const maxDuration = 30

export async function POST(req: Request, ctx: { params: Promise<{ id: string; action: string }> }) {
  const blocked = await guard(req)
  if (blocked) return blocked

  const { id, action } = await ctx.params
  const body = await req.json().catch(() => ({}))
  const store = getStore()

  try {
    let outcome
    switch (action) {
      case 'approve':
        outcome = await approvePO(store, id, body?.qtys && typeof body.qtys === 'object' ? body.qtys : {})
        break
      case 'reject':
        outcome = await rejectPO(store, id, body?.reason)
        break
      case 'undo':
        outcome = await reopenPO(store, id)
        break
      case 'retry':
        outcome = await retryZoho(store, id)
        break
      case 'receive':
        outcome = await receivePO(store, id)
        break
      default:
        return json({ error: 'Unknown action' }, 404)
    }
    return outcome.ok ? json({ ok: true, po: outcome.po }) : json({ error: outcome.error }, outcome.status)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Something went wrong' }, 500)
  }
}
