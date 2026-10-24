import Link from 'next/link'
import SignOut from './SignOut'

export default function Shell({
  active,
  pending,
  demo,
  children,
}: {
  active: 'approvals' | 'history'
  pending: number
  demo: boolean
  children: React.ReactNode
}) {
  return (
    <main className="wrap">
      <nav className="bar glass" aria-label="Main">
        <span className="brand">Freshroots</span>
        {demo && (
          <span className="demo" title="Running on built-in sample data. Decisions are not saved permanently.">
            Sample data
          </span>
        )}
        <div className="seg">
          <Link href="/" aria-current={active === 'approvals' ? 'page' : undefined}>
            To approve
            {pending > 0 && <span className="count">{pending}</span>}
          </Link>
          <Link href="/history" aria-current={active === 'history' ? 'page' : undefined}>
            History
          </Link>
        </div>
        <SignOut />
      </nav>
      {demo && <p className="demo-note">Sample data · decisions are not saved permanently</p>}
      {children}
    </main>
  )
}
