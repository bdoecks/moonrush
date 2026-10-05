// Backups: once a day the server puts a copy of the World (wallets, coins, charts) and of the account tables into the
// `backups` table (supabase/008_backups.sql), and keeps a week of daily copies plus a month of weekly ones. They are
// there for the day a bad save, a bug or a mistake overwrites the real thing: an admin can download any copy, or put
// a World copy back with one click.
//
// What a copy can't bring back: logins. Emails and passwords live in Supabase's own auth tables, which this server
// can't read. A copy saves every player's progress and wallet, not their ability to sign in.
import { promisify } from 'node:util'
import { gunzip, gzip } from 'node:zlib'
import { SUPABASE_URL } from '../src/net/supabaseConfig'
import { WORLD_CODE } from '../src/net/protocol'
import { health } from './health'
import { Room, type RoomSnapshot } from './room'

const KEY = process.env.SUPABASE_SECRET_KEY?.trim() ?? ''
const on = KEY.length > 20
const headers = () => ({ apikey: KEY, Authorization: `Bearer ${KEY}`, 'content-type': 'application/json' })

export type BackupKind = 'world' | 'accounts'
export interface BackupRow {
  id: number
  kind: BackupKind
  taken_at: string
  bytes: number // size before squeezing
  note: string | null
}

const DAY = 24 * 3600_000
export const KEEP_DAILY = 7
export const KEEP_WEEKLY = 4

const gz = promisify(gzip)
const gunz = promisify(gunzip)
/**
 * Squeeze a copy for storing (JSON, gzipped, as base64 text) and open it again. The squeezing runs off the main
 * thread: a World copy is several MB, and doing it in place would hold up the market tick.
 */
export async function pack(data: unknown): Promise<{ text: string; bytes: number }> {
  const json = JSON.stringify(data)
  return { text: (await gz(json)).toString('base64'), bytes: json.length }
}
export async function unpack(text: string): Promise<unknown> {
  return JSON.parse((await gunz(Buffer.from(text, 'base64'))).toString('utf8'))
}

/**
 * Which copies to throw away. Of each kind, kept are: every copy from the last 24 hours (the ones taken by hand or
 * just before a restore during an incident), the newest copy of each of the last `KEEP_DAILY` days that have one, and
 * the newest copy of each of the `KEEP_WEEKLY` weeks before that. Counting days, not rows, matters: a dozen copies
 * taken in one afternoon must not push the week's daily copies out.
 */
export function toPrune(rows: BackupRow[], now: number): number[] {
  const out: number[] = []
  const dayOf = (r: BackupRow) => r.taken_at.slice(0, 10) // UTC date
  for (const kind of ['world', 'accounts'] as const) {
    const list = rows.filter((r) => r.kind === kind).sort((a, b) => Date.parse(b.taken_at) - Date.parse(a.taken_at))
    const days = [...new Set(list.map(dayOf))].slice(0, KEEP_DAILY) // the newest days that have a copy
    const seenDay = new Set<string>()
    const seenWeek = new Set<number>()
    for (const r of list) {
      const age = now - Date.parse(r.taken_at)
      if (age < DAY) continue
      const day = dayOf(r)
      if (days.includes(day)) {
        if (!seenDay.has(day)) seenDay.add(day)
        else out.push(r.id)
        continue
      }
      const week = Math.floor(age / (7 * DAY))
      if (week <= KEEP_WEEKLY && !seenWeek.has(week)) seenWeek.add(week)
      else out.push(r.id)
    }
  }
  return out
}

async function rest(path: string, init: RequestInit = {}, timeoutMs = 60_000): Promise<Response> {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { ...headers(), ...(init.headers ?? {}) }, signal: AbortSignal.timeout(timeoutMs) })
}

/** The copies there are, newest first. Throws if the database doesn't answer; `null` if the table isn't there yet. */
export async function listBackups(): Promise<BackupRow[] | null> {
  if (!on) return []
  const res = await rest('backups?select=id,kind,taken_at,bytes,note&order=taken_at.desc&limit=200', {}, 20_000)
  if (res.status === 404 || res.status === 400) return null // no such table: 008_backups.sql hasn't been run
  if (!res.ok) throw new Error(`database answered ${res.status}`)
  return (await res.json()) as BackupRow[]
}

export async function saveBackup(kind: BackupKind, data: unknown, note?: string): Promise<{ ok: boolean; bytes: number; error?: string }> {
  if (!on) return { ok: false, bytes: 0, error: 'no database' }
  const { text, bytes } = await pack(data)
  try {
    const res = await rest('backups', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ kind, bytes, note: note ?? null, data: text }) })
    return res.ok ? { ok: true, bytes } : { ok: false, bytes, error: `database answered ${res.status} ${(await res.text().catch(() => '')).slice(0, 120)}` }
  } catch (e) {
    return { ok: false, bytes, error: e instanceof Error ? e.message : String(e) }
  }
}

/** One copy, opened. */
export async function loadBackup(id: number): Promise<{ row: BackupRow; data: unknown } | null> {
  if (!on || !Number.isInteger(id)) return null
  const res = await rest(`backups?id=eq.${id}&select=id,kind,taken_at,bytes,note,data`)
  if (!res.ok) return null
  const rows = (await res.json()) as (BackupRow & { data: string })[]
  if (!rows[0]) return null
  const { data, ...row } = rows[0]
  return { row, data: await unpack(data) }
}

async function prune(rows: BackupRow[]) {
  const ids = toPrune(rows, Date.now())
  if (ids.length) await rest(`backups?id=in.(${ids.join(',')})`, { method: 'DELETE' }, 20_000).catch(() => undefined)
}

// The account tables worth keeping (not `presence`, which is who's online right now, nor `rooms`, which is the live save).
const TABLES = ['profiles', 'saves', 'admins', 'bans', 'app_flags', 'gifts', 'friends', 'invites', 'referrals', 'activity']
const PAGE = 1000
const MAX_ROWS = 100_000

/** Every row of the account tables. A table that can't be read is left out and named in `skipped`. */
export async function exportAccounts(): Promise<{ tables: Record<string, unknown[]>; skipped: string[] }> {
  const tables: Record<string, unknown[]> = {}
  const skipped: string[] = []
  for (const t of TABLES) {
    const rows: unknown[] = []
    try {
      for (let from = 0; from < MAX_ROWS; from += PAGE) {
        const res = await rest(`${t}?select=*&limit=${PAGE}&offset=${from}`, {}, 30_000)
        if (!res.ok) throw new Error(String(res.status))
        const page = (await res.json()) as unknown[]
        rows.push(...page)
        if (page.length < PAGE) break
      }
      tables[t] = rows
    } catch {
      skipped.push(t)
    }
  }
  return { tables, skipped }
}

export interface WorldCopy {
  state: unknown
  charts: unknown
  players: number
}

/**
 * Take both copies now. `world` gives the World as it is this moment (null if it hasn't loaded: then only the accounts
 * are copied). Notes the result for the health watch.
 */
export async function backupNow(world: (() => WorldCopy) | null, note?: string): Promise<{ ok: boolean; error?: string; taken: string[] }> {
  const taken: string[] = []
  let error: string | undefined
  try {
    const before = await listBackups()
    if (before === null) {
      health.backup = { set: false, okAt: null, error: null }
      return { ok: false, error: 'The backups table is missing: run supabase/008_backups.sql', taken }
    }
    if (world) {
      const w = world()
      const r = await saveBackup('world', { state: w.state, charts: w.charts }, note ?? `${w.players} players`)
      if (r.ok) taken.push(`world (${Math.round(r.bytes / 1024)} KB)`)
      else error = `World: ${r.error}`
    }
    const acc = await exportAccounts()
    if (Object.keys(acc.tables).length) {
      const rows = Object.values(acc.tables).reduce((a, t) => a + t.length, 0)
      const r = await saveBackup('accounts', acc, `${rows} rows${acc.skipped.length ? ` (not read: ${acc.skipped.join(', ')})` : ''}`)
      if (r.ok) taken.push(`accounts (${rows} rows)`)
      else error ??= `Accounts: ${r.error}`
    } else error ??= 'Accounts: no table could be read'
    const after = await listBackups()
    if (after) await prune(after)
  } catch (e) {
    error ??= e instanceof Error ? e.message : String(e)
  }
  // Counts as done when the World copy went in (or there was no World to copy and the accounts did).
  const ok = taken.some((t) => t.startsWith('world')) || (!world && taken.length > 0)
  health.backup = { set: true, okAt: ok ? Date.now() : health.backup.okAt, error: error ?? null }
  return { ok, error, taken }
}

/**
 * Put a World copy in place of the running World. Everyone connected is sent back to the menu with `reason` (their
 * browsers hold the old World); bots and wallets come from the copy. If the copy can't be brought to life, the World
 * that was running is put back and the error is returned.
 */
export async function swapWorld(rooms: Map<string, Room>, copy: unknown, reason: string): Promise<{ ok: boolean; error?: string }> {
  const c = copy as { state?: RoomSnapshot; charts?: unknown } | null
  if (!c?.state || c.state.code !== WORLD_CODE || !c.state.world) return { ok: false, error: 'That copy is not a World' }
  const old = rooms.get(WORLD_CODE)
  const was = old ? { state: old.snapshot(), charts: old.chartSnapshot() } : null
  // Keep what is being replaced, in case the restore itself was the mistake. If that copy can't be stored, stop here:
  // on a day the database is refusing writes, the World in memory may be the only up-to-date one there is.
  if (was) {
    const kept = await saveBackup('world', was, 'the World as it was just before a restore')
    if (!kept.ok) return { ok: false, error: `The World as it is now could not be backed up first (${kept.error ?? 'no answer'}), so nothing was changed. Try again when the database is answering.` }
  }
  // Only ever replace the World this call looked at: if another restore finished while that copy was being stored,
  // acting on the stale one would leave a second World running outside the list.
  if (rooms.get(WORLD_CODE) !== old) return { ok: false, error: 'The World changed while this restore was getting ready (another restore?). Nothing was changed by this one.' }
  if (old) {
    for (const [id, m] of [...old.members]) if (m.ws) old.kick(id, reason)
    // Coins keep their ids from one copy to the next and charts are kept by coin id, so the old World has to let go
    // of its charts before the new one loads its own.
    old.dispose()
    rooms.delete(WORLD_CODE)
  }
  try {
    rooms.set(WORLD_CODE, Room.restore(c.state, c.charts as never))
    return { ok: true }
  } catch (e) {
    const error = `That copy could not be loaded (${e instanceof Error ? e.message : e})`
    try {
      rooms.set(WORLD_CODE, was ? Room.restore(was.state, was.charts as never) : new Room(WORLD_CODE, true))
      return { ok: false, error: `${error}. The World that was running has been put back.` }
    } catch {
      rooms.set(WORLD_CODE, new Room(WORLD_CODE, true))
      return { ok: false, error: `${error}, and neither could the World that was running: a fresh World was started. Its last save is still in the database.` }
    }
  }
}

let restoring = false
export const isRestoring = () => restoring
/**
 * The admin's Restore: read backup `id` and put it in place of the running World. One at a time. Whatever goes wrong
 * (the database not answering, a copy that can't be read or loaded) comes back as an error in words, with the World
 * that was running still in place.
 */
export async function restoreWorldFrom(rooms: Map<string, Room>, id: number): Promise<{ ok: boolean; error?: string }> {
  if (restoring) return { ok: false, error: 'A restore is already running' }
  restoring = true
  try {
    const b = await loadBackup(id)
    if (!b || b.row.kind !== 'world') return { ok: false, error: 'No World backup with that number' }
    return await swapWorld(rooms, b.data, `The World was put back to its ${new Date(b.row.taken_at).toISOString().slice(0, 16).replace('T', ' ')} UTC backup. Join again.`)
  } catch (e) {
    return { ok: false, error: `That backup could not be read (${e instanceof Error ? e.message : e}). Nothing was changed.` }
  } finally {
    restoring = false
  }
}

/** On start-up: is the table there, and when was the last World copy. */
export async function checkBackups(): Promise<void> {
  if (!on) return
  try {
    const rows = await listBackups()
    if (rows === null) health.backup = { set: false, okAt: null, error: null }
    else {
      const last = rows.find((r) => r.kind === 'world')
      health.backup = { set: true, okAt: last ? Date.parse(last.taken_at) : null, error: null }
    }
  } catch {
    /* the database didn't answer: asked again at the next daily check */
  }
}
