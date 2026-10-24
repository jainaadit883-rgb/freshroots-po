import { redirect } from 'next/navigation'
import LoginForm from '@/components/LoginForm'
import { authConfigured, isAuthed } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export default async function LoginPage() {
  if (await isAuthed()) redirect('/')
  const ready = authConfigured()
  return (
    <main className="login">
      <div className="glass">
        <div>
          <p className="meta" style={{ marginBottom: 6 }}>
            Freshroots
          </p>
          <h1>{ready ? 'Sign in' : 'Almost ready'}</h1>
        </div>
        {ready ? (
          <LoginForm />
        ) : (
          <p className="meta" style={{ fontSize: 15 }}>
            Sign-in is not set up yet. Add APPROVER_PASSWORD and SESSION_SECRET in the project settings, then reload.
          </p>
        )}
      </div>
    </main>
  )
}
