export async function post(path: string, body?: unknown) {
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    })
    const data = await res.json().catch(() => ({}))
    return { ok: res.ok, status: res.status, data: data as Record<string, any> }
  } catch {
    return { ok: false, status: 0, data: { error: 'No connection. Check your internet and try again.' } as Record<string, any> }
  }
}

export const plain = (name: string) =>
  name.replace(/^Freshroots\s+/, '').replace(/\s+\d[\d.]*\s*(g|kg|ml|l|bags?)\b.*$/i, '')

export const trimBrand = (name: string) => name.replace(/^Freshroots\s+/, '')
