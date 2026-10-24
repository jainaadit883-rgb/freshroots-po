import { isAuthed } from './auth'

export const json = (body: unknown, status = 200) => Response.json(body, { status })

// Every mutating route calls this first: same-origin requests from a signed-in approver only.
export async function guard(req: Request): Promise<Response | null> {
  const origin = req.headers.get('origin')
  if (origin && new URL(origin).host !== req.headers.get('host')) return json({ error: 'Forbidden' }, 403)
  if (!(await isAuthed())) return json({ error: 'Please sign in again' }, 401)
  return null
}
