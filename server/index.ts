// MOONRUSH multiplayer server: private rooms with a shared market. Run with `npm run server`.
// In production it also serves the built game (dist/), so one deploy hosts everything on one port.
import { createServer } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { WebSocketServer, type WebSocket } from 'ws'
import { MP_PATH, type ClientMsg, type ServerMsg } from '../src/net/protocol'
import { Room } from './room'

const PORT = Number(process.env.PORT) || 8787
const DIST = join(import.meta.dirname, '..', 'dist')
const ROOM_IDLE_MS = 15 * 60_000
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

const rooms = new Map<string, Room>()

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
  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, players: [...rooms.values()].reduce((a, r) => a + [...r.members.values()].filter((m) => m.info.online).length, 0) }))
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
    if (!room) {
      if (msg.t !== 'hello' || !msg.playerId) return fail('Say hello first')
      const name = String(msg.name ?? '').trim().slice(0, 16) || 'Anon'
      if (msg.create) {
        const code = newCode()
        room = new Room(code)
        rooms.set(code, room)
      } else {
        room = rooms.get(String(msg.room ?? '').toUpperCase()) ?? null
        if (!room) return fail('No room with that code')
        if (!room.members.has(msg.playerId) && room.members.size >= 12) return fail('Room is full (12 players)')
      }
      playerId = msg.playerId
      room.join(ws, { ...msg, name })
      return
    }
    room.handle(playerId, msg)
  })
  ws.on('close', () => room?.leave(playerId, ws))
})

// Close rooms nobody has been in for a while.
setInterval(() => {
  for (const [code, r] of rooms) {
    if (r.emptySince && Date.now() - r.emptySince > ROOM_IDLE_MS) {
      r.dispose()
      rooms.delete(code)
    }
  }
}, 60_000)

http.listen(PORT, () => console.log(`MOONRUSH multiplayer server on http://localhost:${PORT} (ws path ${MP_PATH})`))
