// Saving rooms to Supabase (table `rooms`) so an update or restart doesn't end anyone's round. Needs the project's
// secret key in the server's environment (SUPABASE_SECRET_KEY on Render); without it, saving is simply off.
import { SUPABASE_URL } from '../src/net/supabaseConfig'

const KEY = process.env.SUPABASE_SECRET_KEY?.trim() ?? ''
export const persistOn = KEY.length > 20
const TIMEOUT = 15_000
const MAX_AGE_MS = 3 * 60 * 60_000 // rooms nobody saved for 3h aren't brought back

const headers = () => ({ apikey: KEY, Authorization: `Bearer ${KEY}`, 'content-type': 'application/json' })

/**
 * The database keeps a room as jsonb, which refuses two things JSON itself allows: half an emoji (it arrives as a lone
 * \udXXX escape) and the NUL character (\u0000). Text is cleaned where it comes in (server/index.ts), but one stray
 * character anywhere in a multi-megabyte World must never block every save until the next restart: whatever is left is
 * swapped for the "unknown character" mark. (An even number of backslashes before the "u" is a real backslash followed
 * by ordinary letters, and is left alone.)
 */
export const saveSafe = (json: string) => json.replace(/\\+u(?:d[89a-f][0-9a-f]{2}|0000)/g, (m) => (m.indexOf('u') % 2 ? m.slice(0, -4) + 'fffd' : m))

export async function saveRoom(code: string, state: unknown, charts?: unknown, sent?: (bytes: number) => void): Promise<boolean> {
  if (!persistOn) return false
  try {
    const body: Record<string, unknown> = { code, state, updated_at: new Date().toISOString() }
    if (charts !== undefined) body.charts = charts
    const text = saveSafe(JSON.stringify(body))
    sent?.(text.length)
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rooms?on_conflict=code`, {
      method: 'POST',
      headers: { ...headers(), Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: text,
      signal: AbortSignal.timeout(TIMEOUT),
    })
    if (!res.ok) console.warn(`[persist] save ${code} failed: ${res.status} ${await res.text().catch(() => '')}`)
    return res.ok
  } catch (e) {
    console.warn(`[persist] save ${code} failed:`, e instanceof Error ? e.message : e)
    return false
  }
}

export async function loadRoom(code: string, maxAgeMs = MAX_AGE_MS): Promise<{ state: unknown; charts: unknown } | null> {
  if (!persistOn || !/^[A-Z0-9]{5}$/.test(code)) return null
  try {
    const since = new Date(Date.now() - maxAgeMs).toISOString()
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rooms?code=eq.${code}&updated_at=gte.${encodeURIComponent(since)}&select=state,charts`, { headers: headers(), signal: AbortSignal.timeout(TIMEOUT) })
    if (!res.ok) return null
    const rows = (await res.json()) as { state: unknown; charts: unknown }[]
    return rows[0] ?? null
  } catch {
    return null
  }
}

/**
 * The World's save, for starting up. Unlike `loadRoom`, this tells "there is no save" (null) apart from "the database
 * didn't answer" (it throws): the server must never mistake a slow database for an empty one, or it would start a
 * fresh World and save it over everyone's wallets.
 */
export async function loadWorld(code: string, timeoutMs = 90_000): Promise<{ state: unknown; charts: unknown } | null> {
  if (!persistOn) return null
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rooms?code=eq.${code}&select=state,charts`, { headers: headers(), signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) throw new Error(`database answered ${res.status}`)
  const rows = (await res.json()) as { state: unknown; charts: unknown }[]
  return rows[0] ?? null
}

/** A tiny question for the health watch: does the database answer, and how fast. */
export async function pingDb(timeoutMs = 10_000): Promise<{ ok: boolean; ms: number }> {
  const t0 = performance.now()
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/app_flags?select=key&limit=1`, { headers: headers(), signal: AbortSignal.timeout(timeoutMs) })
    return { ok: res.ok, ms: performance.now() - t0 }
  } catch {
    return { ok: false, ms: performance.now() - t0 }
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

/**
 * Rooms: claim the gifts an admin sent this account (marks them received, like the game's `claim_gifts()`), so the
 * server can add them to the player's wallet in the round.
 */
export async function claimGifts(userId: string): Promise<{ asset: 'usd' | 'sol' | 'bsc' | 'hood'; amount: number }[]> {
  if (!persistOn || !/^[0-9a-f-]{36}$/i.test(userId)) return []
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/gifts?user_id=eq.${userId}&claimed_at=is.null&select=asset,amount`, {
      method: 'PATCH',
      headers: { ...headers(), Prefer: 'return=representation' },
      body: JSON.stringify({ claimed_at: new Date().toISOString() }),
      signal: AbortSignal.timeout(TIMEOUT),
    })
    if (!res.ok) return []
    const rows = (await res.json()) as { asset: string; amount: number | string }[]
    return rows.filter((r) => ['usd', 'sol', 'bsc', 'hood'].includes(r.asset) && Number(r.amount) > 0).map((r) => ({ asset: r.asset as 'usd', amount: Number(r.amount) }))
  } catch {
    return []
  }
}
