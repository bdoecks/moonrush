// Shared by the admin page and the floating admin panel.
import { adminMarket, type AdminMarketAction } from '../game/marketEngine'
import { useGame } from '../game/store'
import type { Chain } from '../types'
import type { ChatReport, RoomPlayer } from './protocol'
import { Rng } from '../utils/rng'
import { accessToken } from './account'
import { supabase } from './supabase'

export interface RoomSummary {
  code: string
  hostId: string
  round: { state: string; mode: string; engine: string; tick: number; startBalance?: number }
  players: RoomPlayer[]
  emptySince: number | null
  coins: { id: string; ticker: string; emoji: string; chain: Chain; mcap: number; status: string; creator: string | null }[]
  sentiment: number
  reports?: ChatReport[]
  muted?: { id: string; name: string; until: number }[]
}

/** Call the game server's admin API with your login. */
export async function adminApi<T>(path: string, body?: unknown): Promise<{ ok: boolean; data?: T; error?: string }> {
  const token = await accessToken()
  try {
    const res = await fetch(path, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${token ?? ''}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
    const data = await res.json().catch(() => ({}))
    return res.ok ? { ok: true, data: data as T } : { ok: false, error: (data as { error?: string }).error ?? `Error ${res.status}` }
  } catch {
    return { ok: false, error: 'Could not reach the game server' }
  }
}

const say = (ok: boolean, body: string) =>
  useGame.getState().notify(ok ? { title: 'ADMIN', body, tone: 'info', icon: '🛠' } : { title: 'ADMIN FAILED', body, tone: 'warn', icon: '⚠️' })

/** A server admin action (kick, notice, grant, market in a room…), with a toast either way. */
export async function adminAct(body: unknown, done = 'Done'): Promise<boolean> {
  const r = await adminApi('/admin/api/action', body)
  say(r.ok, r.ok ? done : r.error ?? 'Failed')
  return r.ok
}

/**
 * God mode on a market: `target` is a room code, or 'solo' for the game running in your own browser.
 */
export async function adminMarketOn(target: string, a: AdminMarketAction, done: string): Promise<boolean> {
  if (target !== 'solo') return adminAct({ action: 'market', room: target, market: a }, done)
  const s = useGame.getState()
  if (s.online) {
    say(false, "You're in a room: act on the room instead")
    return false
  }
  const r = adminMarket(s.market, a, new Rng((Date.now() ^ s.market.seed) >>> 0))
  if (r.error) {
    say(false, r.error)
    return false
  }
  s.patchState({ market: r.market })
  say(true, done)
  return true
}

/** Ban a player you see in a room: accounts go on the ban list, then they're removed. */
export async function adminBan(p: RoomPlayer, room: string) {
  if (p.verified && p.id.startsWith('u-') && supabase) await supabase.from('bans').insert({ user_id: p.id.slice(2), reason: 'Banned by admin' })
  return adminAct({ action: 'kick', room, playerId: p.id, reason: 'You are banned from MOONRUSH rooms' }, `Banned ${p.name}`)
}

// ─── Health watch and backups (server/health.ts, server/backup.ts) ───────────
export interface ServerHealth {
  status: 'ok' | 'degraded'
  problems: { code: string; text: string; warning?: boolean }[]
  upMin: number
  memoryMb: number
  tickMs: { avg: number; max: number } | null
  loopLagMs: number
  saving: boolean
  worldLoaded: boolean
  db: { ms: number | null; fails: number; okAgoSec: number | null }
  save: { okAgoSec: number | null; ms: number | null; kb: number | null; fails: number }
  backup: { set: boolean | null; okAgoHours: number | null; error: string | null }
}
export interface BackupRow {
  id: number
  kind: 'world' | 'accounts'
  taken_at: string
  bytes: number
  note: string | null
}

/**
 * The server's public verdict on itself (`/status`): no login needed. The admin health route asks the database who you
 * are, so on a day the database is not answering it refuses everyone; this still works then.
 */
/** What a new World wallet starts with right now, as the game server says (null: no answer, so the usual figure is shown). */
export async function worldStartNow(): Promise<number | null> {
  try {
    const res = await fetch('/status', { cache: 'no-store' })
    if (!/json/.test(res.headers.get('content-type') ?? '')) return null
    const v = ((await res.json()) as { worldStart?: unknown }).worldStart
    return typeof v === 'number' && v > 0 ? v : null
  } catch {
    return null
  }
}

export async function serverStatus(): Promise<{ status: 'ok' | 'degraded'; problems: string[] } | null> {
  try {
    const res = await fetch('/status', { cache: 'no-store' })
    if (!/json/.test(res.headers.get('content-type') ?? '')) return null // no game server here (solo play)
    const j = (await res.json()) as { status?: string; problems?: string[] }
    return j.status === 'ok' || j.status === 'degraded' ? { status: j.status, problems: j.problems ?? [] } : null
  } catch {
    return null
  }
}

/** Fetch a file from the admin API with your login and hand it to the browser to save. */
export async function adminDownload(path: string, filename: string): Promise<boolean> {
  const token = await accessToken()
  try {
    const res = await fetch(path, { headers: { Authorization: `Bearer ${token ?? ''}` } })
    if (!res.ok) throw new Error(String(res.status))
    const url = URL.createObjectURL(await res.blob())
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
    return true
  } catch {
    say(false, 'Could not download that backup')
    return false
  }
}
