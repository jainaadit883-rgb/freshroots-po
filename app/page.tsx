import Approvals from '@/components/Approvals'
import Shell from '@/components/Shell'
import { requireSession } from '@/lib/auth'
import { computePlan, ensureFreshPlan } from '@/lib/plan'
import { getStore } from '@/lib/store'
import { purchaseRates } from '@/lib/zoho'

export const dynamic = 'force-dynamic'

export default async function Page() {
  await requireSession()
  const store = getStore()
  await ensureFreshPlan(store)

  const rateTimeout = new Promise<Record<string, number>>((resolve) => setTimeout(() => resolve({}), 4000))
  const [pending, plan, rates] = await Promise.all([
    store.listPOs(['pending']),
    computePlan(store),
    Promise.race([purchaseRates(), rateTimeout]),
  ])
  const urgency = (lines: (typeof pending)[number]['lines']) =>
    Math.min(...lines.map((l) => l.snapshot.coverWeeks / l.snapshot.minWeeks))
  pending.sort((a, b) => urgency(a.lines) - urgency(b.lines))

  const names = new Map(plan.data.skus.map((s) => [s.id, s.name]))
  const held = plan.recs
    .filter((r) => r.action === 'PAUSE')
    .map((r) => ({ skuId: r.skuId, name: names.get(r.skuId) ?? r.skuId, coverWeeks: r.coverWeeks, maxWeeks: r.maxWeeks }))

  return (
    <Shell active="approvals" pending={pending.length} demo={store.mode === 'demo'}>
      <Approvals pos={pending} held={held} rates={rates} />
    </Shell>
  )
}
