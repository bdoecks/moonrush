// Checks who a player is when they join a room. Signed-in players send their Supabase login token; we ask Supabase
// whose it is and use their account name. Guests can still play, but can't take a registered name or account id.
import { SUPABASE_KEY, SUPABASE_URL } from '../src/net/supabaseConfig'

export interface Verified {
  id: string // Supabase user id
  username: string
  avatar: string
}

const TIMEOUT = 5000
const cache = new Map<string, { v: Verified; until: number }>() // token → account (tokens live about an hour)

async function get<T>(path: string, token?: string): Promise<T | null> {
  try {
    const res = await fetch(`${SUPABASE_URL}${path}`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token ?? SUPABASE_KEY}` },
      signal: AbortSignal.timeout(TIMEOUT),
    })
    return res.ok ? ((await res.json()) as T) : null
  } catch {
    return null // Supabase unreachable: the player just joins as a guest
  }
}

export async function verifyToken(token: string | undefined): Promise<Verified | null> {
  if (!token || token.length > 4096) return null
  const hit = cache.get(token)
  if (hit && hit.until > Date.now()) return hit.v
  const user = await get<{ id?: string }>('/auth/v1/user', token)
  if (!user?.id) return null
  const rows = await get<{ username: string; avatar: string }[]>(`/rest/v1/profiles?id=eq.${user.id}&select=username,avatar`, token)
  if (!rows?.[0]) return null
  const v = { id: user.id, username: rows[0].username, avatar: rows[0].avatar }
  cache.set(token, { v, until: Date.now() + 10 * 60_000 })
  if (cache.size > 2000) cache.clear()
  return v
}

/** Is this name someone's account? (Guests can't use it.) */
export async function nameTaken(name: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) return false
  const rows = await get<unknown[]>(`/rest/v1/profiles?username=ilike.${encodeURIComponent(name.replace(/_/g, '\_'))}&select=id&limit=1`)
  return !!rows?.length
}
