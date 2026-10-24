import { cookies } from 'next/headers'
import { json } from '@/lib/api'
import { authConfigured, checkPassword, COOKIE, createSessionValue, SESSION_DAYS } from '@/lib/auth'

export async function POST(req: Request) {
  const origin = req.headers.get('origin')
  if (origin && new URL(origin).host !== req.headers.get('host')) return json({ error: 'Forbidden' }, 403)
  if (!authConfigured()) return json({ error: 'Sign-in is not set up yet' }, 503)

  const body = await req.json().catch(() => null)
  const password = typeof body?.password === 'string' ? body.password : ''
  if (!checkPassword(password)) {
    await new Promise((r) => setTimeout(r, 600))
    return json({ error: 'That password is not right' }, 401)
  }

  ;(await cookies()).set(COOKIE, createSessionValue(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_DAYS * 86_400,
  })
  return json({ ok: true })
}
