// Saving rooms to Supabase (table `rooms`) so an update or restart doesn't end anyone's round. Needs the project's
// secret key in the server's environment (SUPABASE_SECRET_KEY on Render); without it, saving is simply off.
import { SUPABASE_URL } from '../src/net/supabaseConfig'

const KEY = process.env.SUPABASE_SECRET_KEY?.trim() ?? ''
export const persistOn = KEY.length > 20
const TIMEOUT = 15_000
const MAX_AGE_MS = 3 * 60 * 60_000 // rooms nobody saved for 3h aren't brought back

const headers = () => ({ apikey: KEY, Authorization: `Bearer ${KEY}`, 'content-type': 'application/json' })

export async function saveRoom(code: string, state: unknown, charts?: unknown): Promise<boolean> {
  if (!persistOn) return false
  try {
    const body: Record<string, unknown> = { code, state, updated_at: new Date().toISOString() }
    if (charts !== undefined) body.charts = charts
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rooms?on_conflict=code`, {
      method: 'POST',
      headers: { ...headers(), Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT),
    })
    if (!res.ok) console.warn(`[persist] save ${code} failed: ${res.status} ${await res.text().catch(() => '')}`)
    return res.ok
  } catch (e) {
    console.warn(`[persist] save ${code} failed:`, e instanceof Error ? e.message : e)
    return false
  }
}

export async function loadRoom(code: string): Promise<{ state: unknown; charts: unknown } | null> {
  if (!persistOn || !/^[A-Z0-9]{5}$/.test(code)) return null
  try {
    const since = new Date(Date.now() - MAX_AGE_MS).toISOString()
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rooms?code=eq.${code}&updated_at=gte.${encodeURIComponent(since)}&select=state,charts`, { headers: headers(), signal: AbortSignal.timeout(TIMEOUT) })
    if (!res.ok) return null
    const rows = (await res.json()) as { state: unknown; charts: unknown }[]
    return rows[0] ?? null
  } catch {
    return null
  }
}

export async function deleteRoom(code: string) {
  if (!persistOn) return
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/rooms?code=eq.${code}`, { method: 'DELETE', headers: headers(), signal: AbortSignal.timeout(TIMEOUT) })
  } catch {
    /* it just expires */
  }
}
