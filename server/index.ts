// MOONRUSH multiplayer server: private rooms with a shared market. Run with `npm run server`.
// In production it also serves the built game (dist/), so one deploy hosts everything on one port.
import { trendSource } from './trendSource'
import { createServer } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { WebSocketServer, type WebSocket } from 'ws'
import { MP_PATH, WORLD_CODE, type ClientMsg, type ServerMsg } from '../src/net/protocol'
import { Room, type RoomSnapshot } from './room'
import { isBanned, nameTaken, verifyToken } from './auth'
import { bannedGuests, handleAdmin } from './admin'
import { deleteRoom, loadRoom, loadWorld, persistOn, pingDb, readFlag, saveRoom } from './persist'
import { health, noteDb, noteError, noteSave, noteTick, noteTickError, report, watchLoop } from './health'
import { backupNow, checkBackups, isRestoring, listBackups, loadBackup, restoreWorldFrom, type WorldCopy } from './backup'
import { nameBlocked } from './moderation'
import { cut, isEmoji, tidyText, whole } from '../src/game/textRules'

// What the database will not store inside a room (see the message handler below).
const UNSAVEABLE = /[\u0000\uD800-\uDFFF]/
const NUL = /\u0000/g
// The same two things written as JSON escapes in the raw text of a message.
const ESCAPED = /\\u(?:0000|d[89a-f])/i
/** A message field as text: anything that isn't text (a number, a list, an object) counts as empty. */
const text = (v: unknown) => (typeof v === 'string' ? v : '')
/** A player picture is an emoji and nothing else: it is shown beside every chat line and in the server's own event lines. */
const face = (v: string) => {
  const a = cut(tidyText(v), 8)
  return isEmoji(a) ? a : '🐸'
}
const cleanText = (v: string) => (UNSAVEABLE.test(v) ? whole(v).replace(NUL, '') : v)
/** Clean every text value inside a parsed message, in place. (A JSON.parse reviver does the same but is called once per value: half a second for a 2 MB list of zeros.) */
const cleanDeep = (v: unknown): unknown => {
  if (typeof v === 'string') return cleanText(v)
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    for (const k of Object.keys(o)) {
      const x = o[k]
      if (typeof x === 'string' || (x && typeof x === 'object')) o[k] = cleanDeep(x)
    }
  }
  return v
}

/**
 * Who's joining: signed in (token checks out) → their account id and name; otherwise a guest, who can't use an
 * account's id (u-…) or a registered name.
 */
async function identify(msg: Extract<ClientMsg, { t: 'hello' }>): Promise<{ playerId: string; name: string; avatar: string; verified: boolean; banned?: boolean }> {
  const v = await verifyToken(msg.token)
  if (v && (await isBanned(v.id))) return { playerId: `u-${v.id}`, name: v.username, avatar: '', verified: true, banned: true }
  if (v) return { playerId: `u-${v.id}`, name: v.username, avatar: face(text(msg.avatar) || v.avatar), verified: true }
  // A guest can't sit in an account's seat (u-…) or a World bot's (bot-…): claiming a bot's id used to take the bot
  // over and knock it out of the World.
  const raw = text(msg.playerId)
  const pid = raw.startsWith('u-') ? `g-${raw.slice(2, 14)}` : raw.startsWith('bot-') ? `g-${raw.slice(4, 16)}` : raw.slice(0, 64)
  let name = cut(tidyText(text(msg.name)), 16).trim() || 'Anon'
  if (nameBlocked(name)) name = 'Anon'
  if (await nameTaken(name)) name = `${name.slice(0, 11)}_guest`
  return { playerId: pid, name, avatar: face(text(msg.avatar)), verified: false }
}

const PORT = Number(process.env.PORT) || 8787
const DIST = join(import.meta.dirname, '..', 'dist')
const ROOM_IDLE_MS = 15 * 60_000
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

const rooms = new Map<string, Room>()

// ─── The World: one public room, always on ───────────────────────────────────
/** Load the World as it was saved (however long ago), or start a fresh one. Joiners wait for this. */
const worldReady: Promise<void> = (async () => {
  // If the database doesn't answer, wait and ask again, for as long as it takes. Starting a fresh World here would
  // get saved over the real one. (Solo play and friends' rooms don't wait for this; only joining the World does.)
  let saved: Awaited<ReturnType<typeof loadWorld>> = null
  for (let attempt = 1; ; attempt++) {
    try {
      saved = await loadWorld(WORLD_CODE)
      break
    } catch (e) {
      console.warn(`[world] the database didn't answer (try ${attempt}): ${e instanceof Error ? e.message : e}. Trying again in 20s…`)
      await new Promise((r) => setTimeout(r, 20_000))
    }
  }
  let world: Room | null = null
  if (saved) {
    try {
      world = Room.restore(saved.state as RoomSnapshot, saved.charts as never)
      console.log(`[world] restored (${world.members.size} players)`)
    } catch (e) {
      console.warn('[world] could not restore, starting fresh:', e instanceof Error ? e.message : e)
    }
  }
  if (!world) {
    world = new Room(WORLD_CODE, true)
    console.log('[world] started fresh')
    // Load testing only (scripts/load-test.ts): grow the brand-new World to a realistic size before anyone joins.
    // Only ever with no database, so it can never run on, or be saved over, a real World.
    const warm = persistOn ? 0 : Math.min(20_000, Math.max(0, Number(process.env.WORLD_WARM_TICKS) || 0))
    if (warm) {
      world.fastForward(warm)
      console.log(`[world] warmed up ${warm} ticks for a load test`)
    }
  }
  rooms.set(WORLD_CODE, world)
  health.worldLoaded = true
})()

// ─── Health watch and backups ────────────────────────────────────────────────
health.saving = persistOn
watchLoop()
Room.onTick = (room, ms, error) => {
  if (!room.world) return
  noteTick(ms)
  if (error) noteTickError()
}
const worldCopy = (): WorldCopy | null => {
  const w = rooms.get(WORLD_CODE)
  return w ? { state: w.snapshot(), charts: w.chartSnapshot(), players: [...w.members.values()].filter((m) => !m.info.bot).length } : null
}
let backingUp = false
/** Take a backup now (the daily timer and the admin's button both come through here, one at a time). */
async function takeBackup(note?: string) {
  if (backingUp) return { ok: false, error: 'A backup is already running', taken: [] as string[] }
  if (isRestoring()) return { ok: false, error: 'A restore is running', taken: [] as string[] }
  backingUp = true
  try {
    const copy = worldCopy()
    const r = await backupNow(copy ? () => copy : null, note)
    console.log(`[backup] ${r.ok ? 'done' : 'failed'}: ${r.taken.join(', ') || 'nothing saved'}${r.error ? ` · ${r.error}` : ''}`)
    return r
  } finally {
    backingUp = false
  }
}
// The story market on a test copy with no database to ask (`node scripts/world-dev.mjs stories`). Never set this on
// Render: there the owner's `sparks` switch decides, and its answer replaces this within seconds.
if (process.env.STORY_MARKET === '1') Room.storyMarket = true
if (persistOn) {
  // Once a minute: does the database answer.
  setInterval(() => void pingDb().then((r) => noteDb(r.ok, r.ms)), 60_000).unref()
  void pingDb().then((r) => noteDb(r.ok, r.ms))
  // The owner's `cooking` switch: while it is off the rooms refuse players' launches (the game hides the page; this
  // is for a browser that does not). Asked once a minute; an answer that does not come changes nothing.
  const askCooking = () => void readFlag('cooking').then((on) => { if (on !== null) Room.playersCook = on })
  askCooking()
  setInterval(askCooking, 60_000).unref()
  // The `sparks` switch the same way: the story market in the World and in rooms.
  const askStories = () => void readFlag('sparks').then((on) => { if (on !== null) Room.storyMarket = on })
  askStories()
  setInterval(askStories, 60_000).unref()
  // Backups are daily. Whether one is due is asked two minutes after the World has loaded and every ten minutes
  // after that, not on a long timer: on Render's free plan the server rarely stays awake a whole hour. Skipped while
  // the database is struggling: a backup is a big write.
  let lastBackupTry = 0
  const backupIfDue = () => {
    if (!health.worldLoaded || health.db.fails > 0) return
    if (health.backup.set !== true) return void checkBackups() // table not there yet (or never asked): look again
    if (Date.now() - (health.backup.okAt ?? 0) <= 24 * 3600_000) return
    // One try an hour at most: a backup that keeps failing must not hammer a struggling database with big writes.
    if (Date.now() - lastBackupTry < 3600_000) return
    lastBackupTry = Date.now()
    void takeBackup().catch((e) => console.error('[backup]', e))
  }
  void worldReady.then(checkBackups).then(() => setTimeout(backupIfDue, 2 * 60_000).unref())
  setInterval(backupIfDue, 10 * 60_000).unref()
}
/** Put a World backup back in place of the running World (the admin panel's Restore). */
async function restoreWorld(id: number): Promise<{ ok: boolean; error?: string }> {
  if (backingUp) return { ok: false, error: 'A backup is running: try again in a minute' }
  const r = await restoreWorldFrom(rooms, id)
  if (r.ok) {
    const w = rooms.get(WORLD_CODE)!
    void saveRoom(WORLD_CODE, w.snapshot(), w.chartSnapshot())
    console.log(`[backup] the World was restored from backup #${id}`)
  }
  return r
}
/** Save the World now (after an admin changed something that must not be lost to a restart). */
const saveWorldNow = () => {
  const w = rooms.get(WORLD_CODE)
  if (w && persistOn) void saveRoom(WORLD_CODE, w.snapshot(), w.chartSnapshot())
}
/** Admin: the World's starting balance from now on (see Room.setStartBalance). */
function setWorldStart(usd: number): number | null {
  const v = rooms.get(WORLD_CODE)?.setStartBalance(usd) ?? null
  if (v !== null) {
    saveWorldNow()
    console.log(`[admin] the World's starting balance is now $${v}`)
  }
  return v
}
/**
 * Admin: start the World's players over (see Room.resetWorld). A backup is taken first, and without one there is no
 * reset: it is the only way back.
 */
async function resetWorld(): Promise<{ ok: boolean; error?: string; wallets?: number; coins?: number; backup?: boolean }> {
  const w = rooms.get(WORLD_CODE)
  if (!w) return { ok: false, error: 'The World is not running' }
  if (isRestoring()) return { ok: false, error: 'A restore is running' }
  let backup = false
  if (persistOn) {
    const b = await takeBackup('before a World reset')
    if (!b.ok) return { ok: false, error: `Nothing was reset: the backup that has to come first failed (${b.error ?? 'no reason given'}). Try again in a minute.` }
    backup = true
  }
  const r = w.resetWorld()
  if (!r) return { ok: false, error: 'The World could not be reset' }
  saveWorldNow()
  console.log(`[admin] the World was reset: ${r.wallets} wallets, ${r.coins} player coins removed`)
  return { ok: true, ...r, backup }
}
const adminOps = { health: () => report(), listBackups, takeBackup, loadBackup, restoreWorld, setWorldStart, resetWorld }
export type AdminOps = typeof adminOps

function newCode() {
  for (;;) {
    let code = ''
    for (let i = 0; i < 5; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
    if (!rooms.has(code)) return code
  }
}

const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' }

// Nothing a visitor sends may stop the server. An error with nothing waiting to catch it would end the process: every
// player dropped, and (being a crash, not a shutdown) the last minutes of the World not saved. So such errors are
// logged, counted for the health watch, and the server carries on.
process.on('uncaughtException', (e) => {
  console.error('[server] unexpected error:', e)
  noteError()
})
process.on('unhandledRejection', (e) => {
  console.error('[server] unexpected error (promise):', e)
  noteError()
})

const http = createServer((req, res) => {
  // A path like "//" is not a valid address and makes URL throw; it used to take the whole server down.
  let url: URL
  try {
    url = new URL(req.url ?? '/', 'http://x')
  } catch {
    res.writeHead(400, { 'content-type': 'text/plain' })
    res.end('Bad request')
    return
  }
  if (url.pathname.startsWith('/admin/api/')) {
    handleAdmin(req, res, url.pathname, rooms, adminOps).catch((e) => {
      console.error('[admin] request failed:', e)
      noteError()
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'The server hit an error handling that. Nothing was changed.' }))
    })
    return
  }
  const online = () => [...rooms.values()].reduce((a, r) => a + [...r.members.values()].filter((m) => m.info.online).length, 0)
  // /health is Render's "is the process alive" check: it always says ok, or Render would restart a server whose only
  // problem is a slow database. /status is the real verdict, for the outside checker and for people: 200 when all is
  // well, 503 with the problems in plain words when it isn't.
  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, saving: persistOn, rooms: rooms.size, players: online() }))
    return
  }
  // Where the World's outside data comes from right now (see server/trendSource.ts). No secrets: a provider's
  // address is never in it, only its name and whether it answered.
  if (url.pathname === '/sources') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(JSON.stringify(trendSource.status()))
    return
  }
  if (url.pathname === '/status') {
    const r = report()
    res.writeHead(r.status === 'ok' ? 200 : 503, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    // tickMs: how long this server takes over one market tick. Comparing it with the same World on another machine
    // says how fast this one is (scripts/load-test.ts --render-tick-ms).
    res.end(JSON.stringify({ status: r.status, problems: r.problems.filter((p) => !p.warning).map((p) => p.text), upMin: r.upMin, players: online(), world: r.worldLoaded, worldStart: rooms.get(WORLD_CODE)?.worldStart, tickMs: r.tickMs?.avg ?? null, memoryMb: r.memoryMb }))
    return
  }
  // Serve the built game if there is one (production); otherwise a small status page.
  if (existsSync(DIST)) {
    const path = normalize(join(DIST, url.pathname === '/' ? 'index.html' : url.pathname))
    const file = path.startsWith(DIST) && existsSync(path) && statSync(path).isFile() ? path : join(DIST, 'index.html')
    // Built assets have content hashes in their names, so browsers (phones!) can keep them forever; the page itself
    // is always re-checked so a new deploy shows up on the next load.
    const cache = url.pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache'
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': cache })
    res.end(readFileSync(file))
    return
  }
  res.writeHead(200, { 'content-type': 'text/html' })
  res.end(`<body style="font:14px system-ui;background:#07080a;color:#e7e9ee;padding:24px"><h2>MOONRUSH multiplayer server</h2><p>${rooms.size} room(s) open. Play through the game (npm run dev) and pick "Play with friends".</p></body>`)
})

// Every message is compressed separately for each connected browser, and with a World tick near 100 KB that was the
// server's biggest cost per player. Level 1 (fastest) does most of the squeezing for a fraction of the processor
// time: measured with scripts/load-test.ts. WS_DEFLATE_LEVEL overrides it (the load test uses it to compare).
const DEFLATE_LEVEL = Math.min(9, Math.max(1, Number(process.env.WS_DEFLATE_LEVEL) || 1))
const wss = new WebSocketServer({ server: http, path: MP_PATH, perMessageDeflate: { threshold: 1024, zlibDeflateOptions: { level: DEFLATE_LEVEL } }, maxPayload: 2 * 1024 * 1024 })

wss.on('connection', (ws: WebSocket) => {
  let room: Room | null = null
  let playerId = ''
  let joining: ClientMsg[] | null = null // messages that arrive while we check who's joining
  const fail = (message: string) => {
    ws.send(JSON.stringify({ t: 'error', message } satisfies ServerMsg))
    ws.close(4001, message)
  }
  // One bad message must never take the server down: an error thrown here is outside any try, so Node would exit and
  // drop every player in every room and the World. Log it and carry on.
  const handle = (m: ClientMsg) => {
    try {
      room?.handle(playerId, m)
    } catch (e) {
      console.error(`[room ${room?.code}] "${m?.t}" from ${playerId} failed:`, e)
    }
  }
  ws.on('message', (raw) => {
    let msg: ClientMsg
    try {
      // Text is cleaned as it comes in: half an emoji or a NUL character anywhere in a message would end up in the
      // room's save, and the database refuses to store either (see saveSafe in persist.ts).
      const s = String(raw)
      msg = JSON.parse(s)
      if (UNSAVEABLE.test(s) || ESCAPED.test(s)) msg = cleanDeep(msg) as ClientMsg
    } catch {
      return
    }
    if (!msg || typeof msg !== 'object') return
    if (joining) {
      joining.push(msg)
      return
    }
    if (!room) {
      if (msg.t !== 'hello' || !msg.playerId) return fail('Say hello first')
      joining = []
      const code = text(msg.room).toUpperCase()
      void Promise.all([identify(msg), msg.create ? null : code === WORLD_CODE ? worldReady : revive(code)]).then(([who]) => {
        const queued = joining ?? []
        joining = null
        if (ws.readyState !== ws.OPEN) return
        if (who.banned || bannedGuests.has(who.playerId)) return fail('You are banned from MOONRUSH rooms')
        enter({ ...msg, ...who })
        for (const m of queued) handle(m)
      })
      return
    }
    handle(msg)
  })
  const enter = (msg: Extract<ClientMsg, { t: 'hello' }> & { verified: boolean }) => {
    const name = cut(tidyText(text(msg.name)), 16).trim() || 'Anon'
    if (msg.create) {
      const code = newCode()
      room = new Room(code)
      rooms.set(code, room)
    } else {
      room = rooms.get(text(msg.room).toUpperCase()) ?? null
      if (!room) return fail('No room with that code')
      if (!room.world && !room.members.has(msg.playerId) && room.members.size >= 12) return fail('Room is full (12 players)')
    }
    if (!room.join(ws, { ...msg, name })) {
      room = null
      return fail('That player is already in this room on another device')
    }
    playerId = msg.playerId
  }
  ws.on('close', () => room?.leave(playerId, ws))
})

// ─── Saving rooms (Phase 2) ──────────────────────────────────────────────────
/** A room that isn't running here (e.g. after an update restarted the server): bring it back from the database. */
const reviving = new Map<string, Promise<void>>()
function revive(code: string): Promise<void> {
  if (!persistOn || rooms.has(code) || code === WORLD_CODE || !/^[A-Z0-9]{5}$/.test(code)) return Promise.resolve()
  let p = reviving.get(code)
  if (!p) {
    p = loadRoom(code).then((saved) => {
      if (saved && !rooms.has(code)) {
        try {
          rooms.set(code, Room.restore(saved.state as RoomSnapshot, saved.charts as never))
          console.log(`[persist] room ${code} restored`)
        } catch (e) {
          console.warn(`[persist] couldn't restore ${code}:`, e instanceof Error ? e.message : e)
        }
      }
    }).finally(() => reviving.delete(code))
    reviving.set(code, p)
  }
  return p
}

/** Save rooms (charts too when asked; they're bigger, so only every few minutes and at shutdown). */
async function saveAll(withCharts: boolean, world = true, worldCharts = withCharts) {
  await Promise.all([...rooms.values()].filter((r) => world || !r.world).map(async (r) => {
    if (!r.world) return saveRoom(r.code, r.snapshot(), withCharts ? r.chartSnapshot() : undefined)
    // The World's save is the one the health watch keeps an eye on.
    const t0 = performance.now()
    let kb = 0
    const ok = await saveRoom(r.code, r.snapshot(), worldCharts ? r.chartSnapshot() : undefined, (bytes) => (kb = Math.round(bytes / 1024)))
    if (persistOn) noteSave(ok, performance.now() - t0, kb)
    return ok
  }))
}
// Rooms save every 20s (charts every 3 min). The World's save is several MB, and every save rewrites the whole row in
// the database: at once a minute that was gigabytes of writes a day, enough to slow the database for everything else
// (sign-in included). So the World saves every 5 minutes and its charts every 15; everything is saved again at
// shutdown, so an update or restart still loses nothing.
const WORLD_SAVE_MS = 5 * 60_000
const WORLD_CHARTS_MS = 15 * 60_000
let lastCharts = 0
let lastWorld = Date.now()
let lastWorldCharts = Date.now()
setInterval(() => {
  const now = Date.now()
  const charts = now - lastCharts > 3 * 60_000
  if (charts) lastCharts = now
  const world = now - lastWorld >= WORLD_SAVE_MS
  if (world) lastWorld = now
  const worldCharts = world && now - lastWorldCharts >= WORLD_CHARTS_MS
  if (worldCharts) lastWorldCharts = now
  void saveAll(charts, world, worldCharts)
}, 20_000)

// An update or restart: save everything (with charts) before the server stops, so everyone picks up where they were.
let stopping = false
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    if (stopping) return
    stopping = true
    console.log(`[persist] ${sig}: saving ${rooms.size} room(s)…`)
    const done = () => process.exit(0)
    setTimeout(done, 20_000).unref() // don't hang forever
    void saveAll(true).then(done, done)
  })
}

// Close rooms nobody has been in for a while; hand out gifts admins sent to players who are in a round.
setInterval(() => {
  for (const r of rooms.values()) void r.pullGifts()
  for (const [code, r] of rooms) {
    if (!r.world && r.emptySince && Date.now() - r.emptySince > ROOM_IDLE_MS) {
      r.dispose()
      rooms.delete(code)
      void deleteRoom(code)
    }
  }
}, 60_000)

void trendSource.start() // (asks a provider only if one is configured)
http.listen(PORT, () => console.log(`MOONRUSH multiplayer server on http://localhost:${PORT} (ws path ${MP_PATH}) · saving rooms: ${persistOn ? 'on' : 'off (no SUPABASE_SECRET_KEY)'}`))
