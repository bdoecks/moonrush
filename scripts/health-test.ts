// The safety net: the health watch's verdicts, which backups are kept, taking and reading backups (against a stand-in
// database), putting a World backup back, and a tick that throws.
//   npx tsx scripts/health-test.ts
import { fresh, judge, LIMITS, type HealthState } from '../server/health'
import { WORLD_CODE, type ServerMsg } from '../src/net/protocol'
import { candleStore } from '../src/game/marketEngine'

const ok = (cond: boolean, what: string) => console.log(`${cond ? 'PASS' : 'FAIL'} ${what}`)
const MIN = 60_000
const HOUR = 3600_000
const T0 = 1_800_000_000_000

// ─── The verdicts ────────────────────────────────────────────────────────────
const codes = (s: HealthState, now: number) => judge(s, now).map((p) => p.code).join(',')
const well = (now: number): HealthState => ({
  ...fresh(T0, true), worldLoaded: true, db: { okAt: now - 30_000, fails: 0, ms: 120 }, save: { okAt: now - 4 * MIN, fails: 0, ms: 900, kb: 4800 },
  ticks: Array.from({ length: 60 }, () => 12), tickAt: now - 500, memoryMb: 300, backup: { set: true, okAt: now - 5 * HOUR, error: null },
})
const now = T0 + 6 * HOUR
ok(codes(well(now), now) === '', 'a healthy server has nothing to report')
ok(codes(fresh(T0, true), T0 + 30_000) === '', 'just started, World still loading: nothing yet')
ok(codes(fresh(T0, true), T0 + LIMITS.worldLoadMs + 1000).includes('world-loading'), 'the World not loaded two minutes after start is a problem')
ok(codes({ ...well(now), db: { okAt: now - 4 * MIN, fails: 3, ms: 10_000 } }, now) === 'db-down', 'three failed database checks in a row: database down')
ok(codes({ ...well(now), db: { okAt: now - 2 * MIN, fails: 2, ms: 10_000 } }, now) === '', 'two failed checks are not yet a problem')
ok(codes({ ...well(now), db: { okAt: now - 1000, fails: 0, ms: 7000 } }, now) === 'db-slow', 'a 7 second answer: database slow')
ok(codes({ ...well(now), save: { okAt: now - 17 * MIN, fails: 3, ms: 15_000, kb: 4800 } }, now) === 'save-stale', 'no World save for 17 minutes is a problem')
ok(codes({ ...well(now), saving: false, save: { okAt: null, fails: 0, ms: null, kb: null }, db: { okAt: null, fails: 9, ms: null } }, now) === '', 'with no database at all (local play) saves and database are not judged')
ok(codes({ ...well(now), ticks: Array.from({ length: 60 }, () => 520) }, now) === 'tick-slow', 'ticks taking half their second: struggling')
ok(codes({ ...well(now), tickAt: now - 9000 }, now) === 'tick-stalled', 'no tick for 9 seconds: the market has stopped')
ok(codes({ ...well(now), tickErrors: [now - 1000, now - 2000, now - 3000] }, now) === 'tick-errors', 'three tick errors in a minute is a problem')
ok(codes({ ...well(now), tickErrors: [now - 70_000, now - 80_000, now - 90_000] }, now) === '', 'old tick errors are forgotten')
ok(codes({ ...well(now), memoryMb: 480 }, now) === 'memory', 'memory near the 512 MB limit is a problem')
ok(codes({ ...well(now), loopLagMs: 2500 }, now) === 'lag', 'a 2.5 second freeze is a problem')
const noTable = judge({ ...well(now), backup: { set: false, okAt: null, error: null } }, now)
ok(noTable.length === 1 && noTable[0].code === 'backup-setup' && noTable[0].warning === true, 'backups not set up yet is a warning, not an alarm')
ok(codes({ ...well(now), backup: { set: true, okAt: now - 50 * HOUR, error: 'database answered 500' } }, now) === 'backup-stale', 'no backup for two days is a problem')
const oneError = judge({ ...well(now), errors: [now - 1000] }, now)
ok(oneError.length === 1 && oneError[0].code === 'errors' && oneError[0].warning === true, 'one unexpected error is a note for the admin, not an alarm')
ok(judge({ ...well(now), errors: [now - 1000, now - 2000, now - 3000] }, now).some((p) => p.code === 'errors' && !p.warning), 'three unexpected errors in ten minutes is an alarm')
ok(codes({ ...well(now), errors: [now - 11 * MIN, now - 12 * MIN, now - 13 * MIN] }, now) === '', 'unexpected errors older than ten minutes are forgotten')
ok(codes({ ...well(now), backup: { set: true, okAt: now - 5 * HOUR, error: 'database answered 500' } }, now) === 'backup-failed', 'a failed backup is reported even while the last good one is recent')
const noCopy = judge({ ...well(now), backup: { set: true, okAt: null, error: null } }, now)
ok(noCopy.length === 1 && noCopy[0].code === 'backup-none' && noCopy[0].warning === true, 'set up but no backup taken yet is a note, not an alarm')
ok(judge({ ...well(now), db: { okAt: null, fails: 5, ms: null }, memoryMb: 500 }, now).every((p) => /[a-z]/.test(p.text) && !/undefined|NaN/.test(p.text)), 'every problem reads as a plain sentence')

// ─── The database stand-in (so the real backup code can run with no database) ──
process.env.SUPABASE_SECRET_KEY = 'test-key-that-is-long-enough-000000'
type Row = { id: number; kind: string; taken_at: string; bytes: number; note: string | null; data: string }
const db = { rows: [] as Row[], nextId: 1, mode: 'ok' as 'ok' | 'no-table' | 'down' | 'no-read', clock: T0 }
const tables: Record<string, unknown[]> = { profiles: [{ id: 'a', username: 'bdoecks' }, { id: 'b', username: 'noah' }], saves: [{ user_id: 'a', profile: { xp: 900 } }], app_flags: [{ key: 'world', value: true }] }
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: unknown, init: RequestInit = {}) => {
  const url = new URL(String(input))
  const table = url.pathname.split('/').pop()!
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  if (db.mode === 'down') throw new Error('fetch failed')
  // Logins: one admin token, one ordinary player's token.
  const token = String((init.headers as Record<string, string> | undefined)?.Authorization ?? '').replace('Bearer ', '')
  if (url.pathname === '/auth/v1/user') return token === 'admin-token' || token === 'player-token' ? json({ id: token === 'admin-token' ? 'a' : 'b' }) : json({}, 401)
  if (url.pathname === '/rest/v1/rpc/is_admin') return json(token === 'admin-token')
  if (table !== 'backups') {
    if (!(table in tables)) return json({ message: 'no such table' }, 404)
    const offset = Number(url.searchParams.get('offset') ?? 0)
    return json(tables[table].slice(offset, offset + Number(url.searchParams.get('limit') ?? 1000)))
  }
  if (db.mode === 'no-table') return json({ code: 'PGRST205', message: "Could not find the table 'public.backups'" }, 404)
  const method = init.method ?? 'GET'
  if (method === 'POST') {
    const b = JSON.parse(String(init.body)) as Omit<Row, 'id' | 'taken_at'>
    db.rows.push({ ...b, id: db.nextId++, taken_at: new Date(db.clock).toISOString() })
    return new Response(null, { status: 201 })
  }
  if (method === 'DELETE') {
    const ids = (/in\.\(([\d,]+)\)/.exec(url.searchParams.get('id') ?? '')?.[1] ?? '').split(',').map(Number)
    db.rows = db.rows.filter((r) => !ids.includes(r.id))
    return new Response(null, { status: 204 })
  }
  const id = /^eq\.(\d+)$/.exec(url.searchParams.get('id') ?? '')?.[1]
  if (id && db.mode === 'no-read') throw new Error('The operation was aborted due to timeout')
  const list = [...db.rows].sort((a, b) => Date.parse(b.taken_at) - Date.parse(a.taken_at))
  return json(id ? list.filter((r) => r.id === Number(id)) : list.map(({ data: _d, ...r }) => r))
}) as typeof fetch

const { backupNow, checkBackups, listBackups, loadBackup, pack, unpack, restoreWorldFrom, swapWorld, toPrune, KEEP_DAILY, KEEP_WEEKLY } = await import('../server/backup')
const { health, noteTick } = await import('../server/health')
const { Room } = await import('../server/room')

// ─── Squeezing ───────────────────────────────────────────────────────────────
const sample = { name: 'Baby Horse 🐴', nested: { n: [1, 2.5, -3], s: 'x'.repeat(5000) } }
const p = await pack(sample)
ok(JSON.stringify(await unpack(p.text)) === JSON.stringify(sample) && p.text.length < p.bytes / 5, `a copy survives being squeezed and opened (${p.bytes} bytes kept as ${p.text.length})`)

// ─── Which copies are kept ───────────────────────────────────────────────────
const daily = (kind: 'world' | 'accounts', n: number, start: number) => Array.from({ length: n }, (_, i) => ({ id: start + i, kind, taken_at: new Date(now - i * 24 * HOUR - HOUR).toISOString(), bytes: 1, note: null }))
const sixty = [...daily('world', 60, 1), ...daily('accounts', 60, 1000)]
const gone = new Set(toPrune(sixty, now))
const kept = sixty.filter((r) => !gone.has(r.id))
const keptWorld = kept.filter((r) => r.kind === 'world')
ok(keptWorld.length <= KEEP_DAILY + KEEP_WEEKLY + 1 && keptWorld.length >= KEEP_DAILY + KEEP_WEEKLY - 1, `of 60 daily World copies, ${keptWorld.length} are kept (a week of days, then about a month of weeks)`)
ok([1, 2, 3, 4, 5, 6, 7].every((id) => !gone.has(id)), 'the seven newest are always kept')
ok(keptWorld.every((r) => now - Date.parse(r.taken_at) < (KEEP_WEEKLY + 1) * 7 * 24 * HOUR), 'nothing older than about five weeks is kept')
ok(kept.filter((r) => r.kind === 'accounts').length === keptWorld.length, 'account copies follow the same rule, counted separately')
ok(toPrune(daily('world', 3, 1), now).length === 0 && toPrune([], now).length === 0, 'a few copies: nothing is thrown away')
// An incident: the owner takes seven extra copies in one afternoon. None of the week's daily copies may go.
const week = daily('world', 7, 1)
const incident = Array.from({ length: 7 }, (_, i) => ({ id: 100 + i, kind: 'world' as const, taken_at: new Date(now - (i + 2) * 600_000).toISOString(), bytes: 1, note: 'taken by hand' }))
ok(toPrune([...week, ...incident], now).length === 0, 'seven extra copies in one afternoon push none of the week\'s daily copies out')
const nextDay = toPrune([...week, ...incident], now + 30 * HOUR)
ok([2, 3, 4, 5, 6, 7].every((id) => !nextDay.includes(id)) && nextDay.length === 7 && !nextDay.includes(106) === false, 'a day later that afternoon is thinned to its newest copy, and every other day still has its own')
const afterAgain = toPrune(kept, now)
ok(afterAgain.length === 0, 'pruning twice throws nothing more away')

// ─── Taking and reading copies ───────────────────────────────────────────────
db.mode = 'no-table'
const r0 = await backupNow(() => ({ state: { a: 1 }, charts: {}, players: 2 }))
ok(!r0.ok && /008_backups\.sql/.test(r0.error ?? '') && health.backup.set === false, 'with no backups table it says which SQL file to run')
db.mode = 'ok'
const r1 = await backupNow(() => ({ state: { hello: 'world', big: 'y'.repeat(20_000) }, charts: { c: [1, 2, 3] }, players: 2 }))
const list1 = (await listBackups())!
ok(r1.ok && list1.length === 2 && list1.some((r) => r.kind === 'world') && list1.some((r) => r.kind === 'accounts'), `a backup stores a World copy and an accounts copy (${r1.taken.join(', ')})`)
ok(health.backup.set === true && health.backup.okAt !== null && health.backup.error === null, 'the health watch is told the backup worked')
const w1 = await loadBackup(list1.find((r) => r.kind === 'world')!.id)
ok(JSON.stringify((w1!.data as { state: unknown }).state) === JSON.stringify({ hello: 'world', big: 'y'.repeat(20_000) }), 'the World copy reads back exactly as it was stored')
const a1 = await loadBackup(list1.find((r) => r.kind === 'accounts')!.id)
const acc = a1!.data as { tables: Record<string, unknown[]>; skipped: string[] }
ok(acc.tables.profiles.length === 2 && acc.tables.saves.length === 1 && acc.skipped.includes('friends'), `the accounts copy holds every readable table and names the ones it could not read (${acc.skipped.join(', ')})`)
ok((await loadBackup(99_999)) === null, 'asking for a copy that is not there gives nothing')
// Sixty days of daily backups: the table stays small.
for (let d = 1; d <= 60; d++) {
  db.clock = T0 + d * 24 * HOUR
  await backupNow(() => ({ state: { day: d }, charts: {}, players: 1 }))
}
// (the real clock decides what is old, so only check that pruning ran and the newest is there)
const list2 = (await listBackups())!
ok(list2.filter((r) => r.kind === 'world').length < 62 && (await loadBackup(list2.find((r) => r.kind === 'world')!.id))?.data !== undefined, `after 60 more backups the table holds ${list2.length} copies, newest readable`)
db.mode = 'down'
const okBefore = health.backup.okAt
const r2 = await backupNow(() => ({ state: {}, charts: {}, players: 0 }))
ok(!r2.ok && !!health.backup.error && health.backup.okAt === okBefore, 'a backup while the database is down fails cleanly and keeps the last good time')
db.mode = 'ok'
health.backup = { set: null, okAt: null, error: null }
await checkBackups()
ok(health.backup.set === true && health.backup.okAt !== null, 'on start-up it finds the table and when the last World copy was taken')

// ─── Putting a World back ────────────────────────────────────────────────────
type R = { tick(): void; market: { tick: number; tokens: { id: string; status: string }[] }; members: Map<string, { ws: unknown; info: { bot?: boolean } }>; snapshot(): unknown; chartSnapshot(): unknown; dispose(): void; join(ws: unknown, m: unknown): boolean }
const rooms = new Map<string, InstanceType<typeof Room>>()
const first = new Room(WORLD_CODE, true)
rooms.set(WORLD_CODE, first)
const world = () => rooms.get(WORLD_CODE) as unknown as R
for (let i = 0; i < 120; i++) world().tick()
const copy = JSON.parse(JSON.stringify({ state: world().snapshot(), charts: world().chartSnapshot() }))
const tickAtCopy = world().market.tick
for (let i = 0; i < 200; i++) world().tick()
const got: ServerMsg[] = []
let closed = false
world().join({ readyState: 1, send: (d: string) => got.push(JSON.parse(d)), close: () => (closed = true) }, { t: 'hello', name: 'Watcher', avatar: '👀', level: 1, playerId: 'g-watch', verified: false })
const rowsBefore = db.rows.length
const s1 = await swapWorld(rooms, copy, 'The World was put back. Join again.')
const liveCoin = world().market.tokens.find((t) => t.status === 'bonding' || t.status === 'graduated')
ok(s1.ok && world() !== (first as unknown as R) && world().market.tick === tickAtCopy, `restoring puts the World back to the copy (tick ${tickAtCopy}, it had reached ${tickAtCopy + 200})`)
ok(got.some((m) => m.t === 'kicked') && closed, 'players who were connected are told and sent back to the menu')
ok(!!liveCoin && !!candleStore.get(liveCoin.id), 'the restored World has its charts')
ok(db.rows.length === rowsBefore + 1 && /before a restore/.test(db.rows[db.rows.length - 1].note ?? ''), 'the World that was replaced is itself kept as a backup first')
world().tick()
ok(world().market.tick === tickAtCopy + 1 && [...world().members.values()].some((m) => m.info.bot), 'the restored World ticks on, bots included')
const s2 = await swapWorld(rooms, { state: { code: 'ABCDE', world: false } }, 'x')
ok(!s2.ok && world().market.tick === tickAtCopy + 1, 'a copy that is not a World is refused and nothing changes')
const tickBeforeBad = world().market.tick
const s3 = await swapWorld(rooms, { state: { v: 1, code: WORLD_CODE, world: true, market: null }, charts: null }, 'x')
ok(!s3.ok && /put back/.test(s3.error ?? '') && world().market.tick === tickBeforeBad, 'a broken copy is refused and the World that was running is put back')

db.mode = 'down'
const tickBeforeDown = world().market.tick
const sDown = await swapWorld(rooms, copy, 'x')
db.mode = 'ok'
ok(!sDown.ok && /nothing was changed/i.test(sDown.error ?? '') && world().market.tick === tickBeforeDown, 'if the World as it is now cannot be backed up first, the restore is refused and nothing changes')
const [o1, o2] = await Promise.all([swapWorld(rooms, copy, 'x'), swapWorld(rooms, copy, 'x')])
ok([o1, o2].filter((r) => r.ok).length === 1 && [o1, o2].some((r) => !r.ok && /changed while/.test(r.error ?? '')), 'two restores at once: one goes through, the other is refused')
// After all of that (a good restore, a refused one, a broken copy, two at once) exactly one World may be ticking.
const ticking = new Set<unknown>()
let tickErrors = 0
Room.onTick = (room, _ms, error) => { ticking.add(room); if (error) tickErrors++ }
await new Promise((r) => setTimeout(r, 2300))
Room.onTick = null
ok(ticking.size === 1 && ticking.has(rooms.get(WORLD_CODE)) && tickErrors === 0, `only the real World is ticking, with no errors (${ticking.size} room(s) seen)`)

// ─── A tick that throws ──────────────────────────────────────────────────────
const seen: { ms: number; error?: unknown }[] = []
Room.onTick = (_room, ms, error) => seen.push({ ms, error })
const timed = world() as unknown as { timedTick(): void; tick(): void }
timed.timedTick()
const realTick = timed.tick
timed.tick = () => { throw new Error('boom') }
const quiet = console.error
console.error = () => undefined
let threw = false
try { timed.timedTick() } catch { threw = true }
console.error = quiet
timed.tick = realTick
ok(seen.length === 2 && seen[0].error === undefined && seen[0].ms >= 0 && seen[1].error instanceof Error && !threw, 'a tick that throws is caught and reported, and does not stop the server')
noteTick(15, now)
ok(health.ticks[health.ticks.length - 1] === 15 && health.tickAt === now, 'tick times reach the health watch')

// ─── The admin panel's requests ──────────────────────────────────────────────
const { handleAdmin } = await import('../server/admin')
const { report } = await import('../server/health')
const { Readable } = await import('node:stream')
const ops = {
  health: () => report(),
  listBackups,
  takeBackup: (note?: string) => backupNow(() => ({ state: world().snapshot(), charts: world().chartSnapshot(), players: 1 }), note),
  loadBackup,
  restoreWorld: (id: number) => restoreWorldFrom(rooms, id),
}
async function call(method: string, path: string, token: string, body?: unknown, rawBody?: string): Promise<{ code: number; body: any; headers: Record<string, string> }> {
  const req = Object.assign(Readable.from(rawBody !== undefined ? [rawBody] : body ? [JSON.stringify(body)] : []), { method, headers: { authorization: `Bearer ${token}` } })
  return new Promise((resolve) => {
    const out = { code: 0, headers: {} as Record<string, string> }
    const res = { writeHead: (code: number, headers: Record<string, string>) => Object.assign(out, { code, headers }), end: (text: string) => resolve({ ...out, body: JSON.parse(text) }) }
    void handleAdmin(req as never, res as never, path, rooms as never, ops as never)
  })
}
const nobody = await call('GET', '/admin/api/health', 'player-token')
const noLogin = await call('GET', '/admin/api/backups', '')
ok(nobody.code === 403 && noLogin.code === 403, 'health and backups are for admins only: a player and a visitor get nothing')
// Every wallet of a player (side and dev too) is the admin's to see and nobody else's.
const peekPlayer = await call('POST', '/admin/api/wallets', 'player-token', { room: 'WORLD', playerId: 'u-anyone' })
const peekVisitor = await call('POST', '/admin/api/wallets', '', { room: 'WORLD', playerId: 'u-anyone' })
ok(peekPlayer.code === 403 && peekVisitor.code === 403, 'a player and a visitor cannot look into another player\'s wallets')
ok((await call('POST', '/admin/api/wallets', 'admin-token', { room: 'WORLD', playerId: 'u-nobody-at-all' })).code === 404, 'the admin asking about nobody gets a plain "no wallet"')
const hr = await call('GET', '/admin/api/health', 'admin-token')
ok(hr.code === 200 && (hr.body.status === 'ok' || hr.body.status === 'degraded') && Array.isArray(hr.body.problems) && hr.body.memoryMb > 0, `the admin sees the health report (${hr.body.status}, ${hr.body.memoryMb} MB)`)
db.clock += HOUR // the stand-in stamps copies with this clock: make the next one the newest
const took = await call('POST', '/admin/api/backup', 'admin-token', { action: 'take' })
const listed = await call('GET', '/admin/api/backups', 'admin-token')
const newest = listed.body.backups.find((b: { kind: string }) => b.kind === 'world')
ok(took.code === 200 && listed.body.set === true && newest?.note === 'taken by hand', `"Back up now" takes a backup (${(took.body.taken ?? []).join(', ')})`)
const dl = await call('GET', `/admin/api/backups/${newest.id}`, 'admin-token')
ok(dl.code === 200 && /attachment; filename="moonrush-world-\d{4}-\d\d-\d\d\.json"/.test(dl.headers['content-disposition'] ?? '') && dl.body.data.state.code === WORLD_CODE, 'a backup downloads as a named file holding the World')
ok((await call('GET', '/admin/api/backups/99999', 'admin-token')).code === 404, 'a backup that is not there: 404')
const tickNow = world().market.tick
const noWord = await call('POST', '/admin/api/backup', 'admin-token', { action: 'restoreWorld', id: newest.id })
ok(noWord.code === 400 && world().market.tick === tickNow, 'Restore without typing RESTORE does nothing')
for (let i = 0; i < 25; i++) world().tick()
const did = await call('POST', '/admin/api/backup', 'admin-token', { action: 'restoreWorld', id: newest.id, confirm: 'RESTORE' })
ok(did.code === 200 && world().market.tick === tickNow, 'Restore with the word typed puts the World back')
ok((await call('POST', '/admin/api/backup', 'player-token', { action: 'restoreWorld', id: newest.id, confirm: 'RESTORE' })).code === 403, 'a player cannot restore')
db.mode = 'no-read'
const tickUnread = world().market.tick
const unread = await call('POST', '/admin/api/backup', 'admin-token', { action: 'restoreWorld', id: newest.id, confirm: 'RESTORE' })
db.mode = 'ok'
ok(unread.code === 500 && /could not be read/.test(unread.body.error ?? '') && world().market.tick >= tickUnread && world().market.tick <= tickUnread + 3, 'Restore while the database will not hand over the copy: an error in words, the World untouched, the server still up')
const [press1, press2] = await Promise.all([call('POST', '/admin/api/backup', 'admin-token', { action: 'restoreWorld', id: newest.id, confirm: 'RESTORE' }), call('POST', '/admin/api/backup', 'admin-token', { action: 'restoreWorld', id: newest.id, confirm: 'RESTORE' })])
ok([press1, press2].filter((r) => r.code === 200).length === 1 && [press1, press2].some((r) => /already running/.test(r.body.error ?? '')), 'pressing Restore twice: the second press is told one is already running')
ok((await call('POST', '/admin/api/backup', 'admin-token', undefined, 'null')).code === 400, 'a nonsense request body is refused, not fatal')

Room.onTick = null
for (const r of rooms.values()) r.dispose()
globalThis.fetch = realFetch
process.exit(0)
