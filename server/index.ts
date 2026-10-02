// MOONRUSH multiplayer server: private rooms with a shared market. Run with `npm run server`.
// In production it also serves the built game (dist/), so one deploy hosts everything on one port.
import { createServer } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { WebSocketServer, type WebSocket } from 'ws'
import { MP_PATH, WORLD_CODE, type ClientMsg, type ServerMsg } from '../src/net/protocol'
import { Room, type RoomSnapshot } from './room'
import { isBanned, nameTaken, verifyToken } from './auth'
import { bannedGuests, handleAdmin } from './admin'
import { deleteRoom, loadRoom, persistOn, saveRoom } from './persist'
import { nameBlocked } from './moderation'

/**
 * Who's joining: signed in (token checks out) → their account id and name; otherwise a guest, who can't use an
 * account's id (u-…) or a registered name.
 */
async function identify(msg: Extract<ClientMsg, { t: 'hello' }>): Promise<{ playerId: string; name: string; avatar: string; verified: boolean; banned?: boolean }> {
  const v = await verifyToken(msg.token)
  if (v && (await isBanned(v.id))) return { playerId: `u-${v.id}`, name: v.username, avatar: '', verified: true, banned: true }
  if (v) return { playerId: `u-${v.id}`, name: v.username, avatar: String(msg.avatar || v.avatar).slice(0, 8), verified: true }
  const pid = String(msg.playerId).startsWith('u-') ? `g-${String(msg.playerId).slice(2, 14)}` : String(msg.playerId).slice(0, 64)
  let name = String(msg.name ?? '').trim().slice(0, 16) || 'Anon'
  if (nameBlocked(name)) name = 'Anon'
  if (await nameTaken(name)) name = `${name.slice(0, 11)}_guest`
  return { playerId: pid, name, avatar: String(msg.avatar ?? '🐸').slice(0, 8), verified: false }
}

const PORT = Number(process.env.PORT) || 8787
const DIST = join(import.meta.dirname, '..', 'dist')
const ROOM_IDLE_MS = 15 * 60_000
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

const rooms = new Map<string, Room>()

// ─── The World: one public room, always on ───────────────────────────────────
/** Load the World as it was saved (however long ago), or start a fresh one. Joiners wait for this. */
const worldReady: Promise<void> = (async () => {
  const saved = await loadRoom(WORLD_CODE, 10 * 365 * 24 * 3600_000)
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
  }
  rooms.set(WORLD_CODE, world)
})()

function newCode() {
  for (;;) {
    let code = ''
    for (let i = 0; i < 5; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
    if (!rooms.has(code)) return code
  }
}

const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' }

const http = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x')
  if (url.pathname.startsWith('/admin/api/')) {
    void handleAdmin(req, res, url.pathname, rooms)
    return
  }
  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, saving: persistOn, rooms: rooms.size, players: [...rooms.values()].reduce((a, r) => a + [...r.members.values()].filter((m) => m.info.online).length, 0) }))
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

const wss = new WebSocketServer({ server: http, path: MP_PATH, perMessageDeflate: { threshold: 1024 }, maxPayload: 2 * 1024 * 1024 })

wss.on('connection', (ws: WebSocket) => {
  let room: Room | null = null
  let playerId = ''
  let joining: ClientMsg[] | null = null // messages that arrive while we check who's joining
  const fail = (message: string) => {
    ws.send(JSON.stringify({ t: 'error', message } satisfies ServerMsg))
    ws.close(4001, message)
  }
  ws.on('message', (raw) => {
    let msg: ClientMsg
    try {
      msg = JSON.parse(String(raw))
    } catch {
      return
    }
    if (joining) {
      joining.push(msg)
      return
    }
    if (!room) {
      if (msg.t !== 'hello' || !msg.playerId) return fail('Say hello first')
      joining = []
      const code = String(msg.room ?? '').toUpperCase()
      void Promise.all([identify(msg), msg.create ? null : code === WORLD_CODE ? worldReady : revive(code)]).then(([who]) => {
        const queued = joining ?? []
        joining = null
        if (ws.readyState !== ws.OPEN) return
        if (who.banned || bannedGuests.has(who.playerId)) return fail('You are banned from MOONRUSH rooms')
        enter({ ...msg, ...who })
        for (const m of queued) if (room) room.handle(playerId, m)
      })
      return
    }
    room.handle(playerId, msg)
  })
  const enter = (msg: Extract<ClientMsg, { t: 'hello' }> & { verified: boolean }) => {
    const name = String(msg.name ?? '').trim().slice(0, 16) || 'Anon'
    if (msg.create) {
      const code = newCode()
      room = new Room(code)
      rooms.set(code, room)
    } else {
      room = rooms.get(String(msg.room ?? '').toUpperCase()) ?? null
      if (!room) return fail('No room with that code')
      if (!room.world && !room.members.has(msg.playerId) && room.members.size >= 12) return fail('Room is full (12 players)')
    }
    playerId = msg.playerId
    room.join(ws, { ...msg, name })
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

/** Save every room (charts too when asked; they're bigger, so only every few minutes and at shutdown). */
async function saveAll(withCharts: boolean, world = true) {
  await Promise.all([...rooms.values()].filter((r) => world || !r.world).map((r) => saveRoom(r.code, r.snapshot(), withCharts ? r.chartSnapshot() : undefined)))
}
// Rooms save every 20s (charts every 3 min). The World's save is much bigger, so it goes every minute (its charts
// every 3 min too); everything is saved again at shutdown.
let lastCharts = 0
let saves = 0
setInterval(() => {
  const charts = Date.now() - lastCharts > 3 * 60_000
  if (charts) lastCharts = Date.now()
  void saveAll(charts, ++saves % 3 === 0 || charts)
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

http.listen(PORT, () => console.log(`MOONRUSH multiplayer server on http://localhost:${PORT} (ws path ${MP_PATH}) · saving rooms: ${persistOn ? 'on' : 'off (no SUPABASE_SECRET_KEY)'}`))
