import { cookies } from 'next/headers'
import { json } from '@/lib/api'
import { COOKIE } from '@/lib/auth'

export async function POST() {
  ;(await cookies()).delete(COOKIE)
  return json({ ok: true })
}
