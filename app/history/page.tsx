import History from '@/components/History'
import Shell from '@/components/Shell'
import { requireSession } from '@/lib/auth'
import { getStore } from '@/lib/store'
import { zohoConfigured } from '@/lib/zoho'

export const dynamic = 'force-dynamic'

export default async function HistoryPage() {
  await requireSession()
  const store = getStore()
  const [pending, decided] = await Promise.all([
    store.listPOs(['pending']),
    store.listPOs(['approved', 'rejected', 'received']),
  ])
  const recent = decided
    .sort((a, b) => (b.decidedAt ?? b.createdAt).localeCompare(a.decidedAt ?? a.createdAt))
    .slice(0, 50)

  return (
    <Shell active="history" pending={pending.length} demo={store.mode === 'demo'}>
      <History pos={recent} zohoReady={zohoConfigured()} />
    </Shell>
  )
}
