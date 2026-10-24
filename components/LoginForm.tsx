'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { post } from './api'

export default function LoginForm() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const res = await post('/api/login', { password })
    if (res.ok) {
      router.push('/')
      router.refresh()
      return
    }
    setError(res.data.error ?? 'Could not sign in')
    setBusy(false)
  }

  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 14 }}>
      <input
        id="password"
        className="field"
        type="password"
        placeholder="Password"
        aria-label="Password"
        autoComplete="current-password"
        autoFocus
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {error && (
        <p className="error" role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      )}
      <button className="btn primary" disabled={busy || !password}>
        {busy ? 'Signing in…' : 'Continue'}
      </button>
    </form>
  )
}
