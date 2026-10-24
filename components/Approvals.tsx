'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { percent, units, weeks } from '@/lib/format'
import type { PO, POLine } from '@/lib/types'
import { plain, post, trimBrand } from './api'
import Toast, { type ToastState } from './Toast'

export interface Held {
  skuId: string
  name: string
  coverWeeks: number
  maxWeeks: number
}

const REASONS = ['Enough stock', 'Supplier issue', 'Order later', 'Other']
const stepFor = (standard: number) => (standard >= 300 ? 50 : standard >= 100 ? 10 : 5)
const isCritical = (l: POLine) => l.snapshot.coverWeeks < l.snapshot.minWeeks * 0.6 + 1e-9
const coverAfter = (l: POLine, qty: number) =>
  l.snapshot.effDemand > 0 ? (l.snapshot.onHand + l.snapshot.onOrder + qty) / l.snapshot.effDemand : 99

function Stepper({ value, step, label, onChange }: { value: number; step: number; label: string; onChange: (n: number) => void }) {
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button type="button" aria-label="Decrease" onClick={() => onChange(Math.max(0, value - step))}>
        −
      </button>
      <input
        inputMode="numeric"
        aria-label={`${label} quantity`}
        value={value}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, '').slice(0, 7)
          onChange(digits ? Math.min(Number(digits), 1_000_000) : 0)
        }}
        onFocus={(e) => e.target.select()}
      />
      <button type="button" aria-label="Increase" onClick={() => onChange(value + step)}>
        +
      </button>
    </div>
  )
}

export default function Approvals({ pos, held }: { pos: PO[]; held: Held[] }) {
  const router = useRouter()
  const [qtys, setQtys] = useState<Record<string, number>>({})
  const [open, setOpen] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [gone, setGone] = useState<Set<string>>(new Set())
  const [leaving, setLeaving] = useState<Set<string>>(new Set())
  const [toast, setToast] = useState<ToastState | null>(null)
  const [checking, setChecking] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(timer.current), [])

  const flash = (t: ToastState, ms = 8000) => {
    clearTimeout(timer.current)
    setToast(t)
    timer.current = setTimeout(() => setToast(null), ms)
  }

  const qtyOf = (po: PO, l: POLine) => qtys[`${po.id}:${l.skuId}`] ?? l.qty
  const totalOf = (po: PO) => po.lines.reduce((sum, l) => sum + qtyOf(po, l), 0)

  const visible = pos.filter((p) => !gone.has(p.id))
  const active = visible.filter((p) => !leaving.has(p.id))
  const totalUnits = active.reduce((sum, p) => sum + totalOf(p), 0)
  const lowCount = active.reduce((sum, p) => sum + p.lines.filter((l) => l.action === 'REORDER_NOW').length, 0)

  function leave(id: string) {
    setLeaving((s) => new Set(s).add(id))
    setTimeout(() => {
      setGone((s) => new Set(s).add(id))
      setLeaving((s) => {
        const next = new Set(s)
        next.delete(id)
        return next
      })
    }, 350)
  }

  async function run(po: PO, action: 'approve' | 'reject', body: unknown) {
    setBusy(po.id)
    const res = await post(`/api/pos/${po.id}/${action}`, body)
    setBusy(null)
    if (res.status === 401) {
      router.push('/login')
      return false
    }
    if (!res.ok) {
      flash({ text: res.data.error ?? 'Something went wrong', tone: 'bad' })
      router.refresh()
      return false
    }
    return true
  }

  async function approve(po: PO) {
    const total = totalOf(po)
    const qtysBody = Object.fromEntries(po.lines.map((l) => [l.skuId, qtyOf(po, l)]))
    if (!(await run(po, 'approve', { qtys: qtysBody }))) return
    leave(po.id)
    flash({ text: `Approved ${po.distributorName} · ${units(total)} units`, action: { label: 'Undo', run: () => undo(po, 'Moved back to approvals') } })
    router.refresh()
  }

  async function reject(po: PO, reason: string) {
    if (!(await run(po, 'reject', { reason }))) return
    setRejecting(null)
    leave(po.id)
    flash({ text: `Rejected ${po.distributorName}`, action: { label: 'Undo', run: () => undo(po, 'Moved back to approvals') } })
    router.refresh()
  }

  async function undo(po: PO, message: string) {
    const res = await post(`/api/pos/${po.id}/undo`)
    if (!res.ok) {
      flash({ text: res.data.error ?? 'Could not undo', tone: 'bad' })
      return
    }
    setGone((s) => {
      const next = new Set(s)
      next.delete(po.id)
      return next
    })
    flash({ text: message }, 3500)
    router.refresh()
  }

  async function check() {
    setChecking(true)
    const res = await post('/api/plan')
    setChecking(false)
    if (!res.ok) return flash({ text: res.data.error ?? 'Could not check right now', tone: 'bad' })
    flash({ text: res.data.created || res.data.updated ? 'Orders are up to date' : 'Nothing new to order' }, 3500)
    router.refresh()
  }

  return (
    <>
      <section className="hero">
        {active.length > 0 ? (
          <>
            <h1>
              {active.length} {active.length === 1 ? 'order' : 'orders'} to approve
            </h1>
            <p>
              {units(totalUnits)} units
              {lowCount > 0 && ` · ${lowCount} ${lowCount === 1 ? 'product' : 'products'} running low`}
            </p>
          </>
        ) : (
          <>
            <h1>All caught up</h1>
            <p>No orders needed right now.</p>
          </>
        )}
      </section>

      {visible.map((po) => (
        <div className="leave" data-leaving={leaving.has(po.id)} key={po.id}>
          <div>
            <article className="glass card" aria-label={po.distributorName}>
              <header className="card-head">
                <div>
                  <h2>{po.distributorName}</h2>
                  <p className="meta">
                    {po.region} · {po.number}
                  </p>
                </div>
                <div className="total">
                  {units(totalOf(po))}
                  <small>units</small>
                </div>
              </header>

              <ul className="lines">
                {po.lines.map((l) => {
                  const key = `${po.id}:${l.skuId}`
                  const q = qtyOf(po, l)
                  const s = l.snapshot
                  const after = Math.round(coverAfter(l, q) * 10) / 10
                  const short = after < s.minWeeks
                  return (
                    <li className="line" key={l.skuId}>
                      <button
                        className="line-main"
                        aria-expanded={open === key}
                        aria-controls={`why-${key}`}
                        onClick={() => setOpen(open === key ? null : key)}
                      >
                        <span className="name">
                          {trimBrand(l.skuName)}
                          {isCritical(l) && (
                            <>
                              <span className="dot" aria-hidden="true" />
                              <span className="sr" style={{ position: 'absolute', left: -9999 }}>
                                Running low
                              </span>
                            </>
                          )}
                        </span>
                        <span className="sub">
                          {weeks(s.coverWeeks)} wks left →{' '}
                          <span className={short ? 'warn' : undefined}>
                            {weeks(after)} wks after{short ? `, under ${s.minWeeks}` : ''}
                          </span>
                        </span>
                      </button>
                      <Stepper
                        value={q}
                        step={stepFor(s.standardQty)}
                        label={trimBrand(l.skuName)}
                        onChange={(n) => setQtys((m) => ({ ...m, [key]: n }))}
                      />
                      {open === key && (
                        <div className="why" id={`why-${key}`}>
                          <p>
                            <b>Selling about {units(Math.round(s.effDemand))} a week</b>
                            {s.festival && ' (festival demand +25% included)'}
                          </p>
                          <p>
                            {units(s.onHand)} in stock{s.onOrder > 0 && `, ${units(s.onOrder)} already on order`}
                          </p>
                          <p>
                            Last 4 weeks averaged {Math.round(s.avgShort)} a week against {Math.round(s.avgLong)} over the last 12 (
                            {percent(s.trend)})
                          </p>
                          <p>
                            {l.action === 'REORDER_NOW'
                              ? `Stock covers fewer than ${s.minWeeks} weeks, so it needs reordering.`
                              : 'Stock is fine, but demand is climbing.'}
                            {s.highDemand && ` Demand is rising, so the suggestion is 1.5× the usual ${units(s.standardQty)}.`}
                            {s.perishable && ` Short shelf life, so we keep ${s.minWeeks} to ${s.maxWeeks} weeks of stock.`}
                          </p>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>

              {rejecting === po.id ? (
                <div className="actions">
                  <div className="reasons">
                    <span>Why?</span>
                    {REASONS.map((r) => (
                      <button key={r} className="chip" disabled={busy === po.id} onClick={() => reject(po, r)}>
                        {r}
                      </button>
                    ))}
                    <button className="chip" onClick={() => setRejecting(null)}>
                      Back
                    </button>
                  </div>
                </div>
              ) : (
                <div className="actions">
                  <button className="btn quiet" disabled={busy === po.id} onClick={() => setRejecting(po.id)}>
                    Reject
                  </button>
                  <button className="btn primary" disabled={busy === po.id || totalOf(po) === 0} onClick={() => approve(po)}>
                    {busy === po.id ? 'Approving…' : `Approve · ${units(totalOf(po))} units`}
                  </button>
                </div>
              )}
            </article>
          </div>
        </div>
      ))}

      <div className="foot">
        {held.length > 0 && (
          <details>
            <summary>
              Holding back {held.length}: {held.map((h) => plain(h.name)).join(', ')}
            </summary>
            <ul>
              {held.map((h) => (
                <li key={h.skuId}>
                  {trimBrand(h.name)} · {weeks(h.coverWeeks)} weeks of stock, more than the {h.maxWeeks} we keep
                </li>
              ))}
            </ul>
          </details>
        )}
        <button className="link" onClick={check} disabled={checking}>
          {checking ? 'Checking…' : 'Check for new orders'}
        </button>
      </div>

      <Toast toast={toast} />
    </>
  )
}
