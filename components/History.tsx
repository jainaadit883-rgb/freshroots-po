'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { units, when } from '@/lib/format'
import type { PO } from '@/lib/types'
import { post, trimBrand } from './api'
import Toast, { type ToastState } from './Toast'

function statusOf(po: PO): { text: string; on?: boolean } {
  if (po.status === 'rejected') return { text: `Rejected${po.rejectReason ? ` · ${po.rejectReason}` : ''}` }
  if (po.status === 'received') return { text: `Received ${when(po.receivedAt)}` }
  if (po.zohoStatus === 'sent') return { text: 'In Zoho as a draft', on: true }
  if (po.zohoStatus === 'queued') return { text: 'Queued for Zoho', on: true }
  if (po.zohoStatus === 'failed') return { text: 'Approved · Zoho failed' }
  return { text: 'Approved · waiting for Zoho', on: true }
}

export default function History({ pos, zohoReady }: { pos: PO[]; zohoReady: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [toast, setToast] = useState<ToastState | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(timer.current), [])

  async function act(po: PO, action: 'receive' | 'undo' | 'retry', message: string) {
    setBusy(po.id)
    const res = await post(`/api/pos/${po.id}/${action}`)
    setBusy(null)
    if (res.status === 401) return router.push('/login')
    clearTimeout(timer.current)
    const zohoFailed = action === 'retry' && res.ok && res.data.po?.zohoStatus === 'failed'
    setToast(
      !res.ok
        ? { text: res.data.error ?? 'Something went wrong', tone: 'bad' }
        : zohoFailed
          ? { text: `Zoho failed: ${res.data.po.zohoError ?? 'unknown error'}`, tone: 'bad' }
          : { text: message },
    )
    timer.current = setTimeout(() => setToast(null), zohoFailed ? 14000 : 4000)
    router.refresh()
  }

  if (!pos.length) {
    return (
      <div className="glass empty">
        <p>No decisions yet.</p>
        <p className="meta">Approved and rejected orders will show up here.</p>
      </div>
    )
  }

  return (
    <>
      <section className="glass rows" aria-label="Past orders">
        {pos.map((po) => {
          const st = statusOf(po)
          const total = po.lines.reduce((sum, l) => sum + l.qty, 0)
          const approved = po.status === 'approved'
          const needsSend = approved && (po.zohoStatus === 'failed' || (po.zohoStatus === 'not_connected' && zohoReady))
          const canUndo = po.status === 'rejected' || (approved && (po.zohoStatus === 'not_connected' || po.zohoStatus === 'failed'))
          return (
            <div className="row" key={po.id}>
              <div className="row-top">
                <strong>{po.distributorName}</strong>
                <span className={`status${st.on ? ' on' : ''}`}>{st.text}</span>
              </div>
              <p className="meta">
                {po.number} · {when(po.decidedAt ?? po.createdAt)} · {units(total)} units
              </p>
              <p className="items">{po.lines.map((l) => `${trimBrand(l.skuName)} ${units(l.qty)}`).join(' · ')}</p>
              {po.zohoStatus === 'failed' && po.zohoError && approved && <p className="error">{po.zohoError}</p>}
              {(approved || canUndo) && (
                <div className="row-actions">
                  {needsSend && (
                    <button className="btn primary small" style={{ flex: 'none' }} disabled={busy === po.id} onClick={() => act(po, 'retry', 'Sent to Zoho as a draft.')}>
                      {busy === po.id ? 'Sending…' : po.zohoStatus === 'failed' ? 'Retry Zoho' : 'Send to Zoho'}
                    </button>
                  )}
                  {approved && !needsSend && (
                    <button className="btn primary small" style={{ flex: 'none' }} disabled={busy === po.id} onClick={() => act(po, 'receive', 'Marked as received. Stock updated.')}>
                      Mark received
                    </button>
                  )}
                  {canUndo && (
                    <button className="btn quiet small" disabled={busy === po.id} onClick={() => act(po, 'undo', 'Moved back to approvals')}>
                      {po.status === 'rejected' ? 'Reopen' : 'Undo'}
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </section>
      <Toast toast={toast} />
    </>
  )
}
