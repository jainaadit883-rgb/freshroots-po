import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

export const COOKIE = 'fr_session'
export const SESSION_DAYS = 30

function secret(): string | null {
  const s = process.env.SESSION_SECRET
  if (s && s.length >= 24) return s
  return process.env.NODE_ENV !== 'production' ? 'dev-only-secret-not-for-production' : null
}

export function authConfigured(): boolean {
  return Boolean(process.env.APPROVER_PASSWORD) && secret() !== null
}

const digest = (s: string) => createHash('sha256').update(s).digest()

export function checkPassword(input: string): boolean {
  const expected = process.env.APPROVER_PASSWORD
  if (!expected) return false
  return timingSafeEqual(digest(input), digest(expected))
}

// Cookie value is "<expiry>.<signature>"; the signature also covers the password, so changing the password signs everyone out.
function sign(expiry: number): string {
  return createHmac('sha256', secret()!).update(`${expiry}.${process.env.APPROVER_PASSWORD}`).digest('base64url')
}

export function createSessionValue(now = Date.now()): string {
  const expiry = now + SESSION_DAYS * 86_400_000
  return `${expiry}.${sign(expiry)}`
}

export function verifySessionValue(value: string | undefined | null, now = Date.now()): boolean {
  if (!value || !authConfigured()) return false
  const [expiryText, sig] = value.split('.')
  const expiry = Number(expiryText)
  if (!sig || !Number.isFinite(expiry) || expiry < now) return false
  const a = Buffer.from(sig)
  const b = Buffer.from(sign(expiry))
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function isAuthed(): Promise<boolean> {
  return verifySessionValue((await cookies()).get(COOKIE)?.value)
}

export async function requireSession(): Promise<void> {
  if (!(await isAuthed())) redirect('/login')
}
