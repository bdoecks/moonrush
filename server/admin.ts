// Admin API for the admin panel: rooms and players, kicks and bans, notices, money, and market god mode.
// Every request must carry the admin's login token; anyone else gets 403.
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AdminMarketAction } from '../src/game/marketEngine'
import { isAdmin } from './auth'
import type { Room } from './room'

export type AdminAction =
  | { action: 'kick'; room: string; playerId: string; reason?: string }
  | { action: 'close'; room: string }
  | { action: 'notice'; room?: string; text: string } // no room = every room
  | { action: 'grant'; room: string; playerId: string; usd: number }
  | { action: 'market'; room: string; market: AdminMarketAction }

/** Guests banned from this server (until it restarts); accounts are banned in the database. */
export const bannedGuests = new Set<string>()

const json = (res: ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    let raw = ''
    req.on('data', (c) => {
      raw += c
      if (raw.length > 100_000) req.destroy()
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'))
      } catch {
        resolve({})
      }
    })
  })
}

export async function handleAdmin(req: IncomingMessage, res: ServerResponse, path: string, rooms: Map<string, Room>) {
  const token = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '')
  if (!(await isAdmin(token))) return json(res, 403, { error: 'Admins only' })

  if (req.method === 'GET' && path === '/admin/api/rooms') {
    return json(res, 200, { rooms: [...rooms.values()].map((r) => r.summary()), bannedGuests: bannedGuests.size })
  }
  if (req.method === 'POST' && path === '/admin/api/action') {
    const a = (await readBody(req)) as AdminAction
    if (a.action === 'notice') {
      const text = String(a.text ?? '').trim()
      if (!text) return json(res, 400, { error: 'Empty message' })
      const targets = a.room ? [rooms.get(a.room)].filter(Boolean) : [...rooms.values()]
      targets.forEach((r) => r!.notice(text))
      return json(res, 200, { ok: true, rooms: targets.length })
    }
    const room = rooms.get(String((a as { room?: string }).room ?? '').toUpperCase())
    if (!room) return json(res, 404, { error: 'No room with that code' })
    switch (a.action) {
      case 'kick': {
        const ban = /ban/i.test(a.reason ?? '')
        if (ban && !a.playerId.startsWith('u-')) bannedGuests.add(a.playerId)
        return json(res, room.kick(a.playerId, a.reason || 'Removed by an admin') ? 200 : 404, { ok: true })
      }
      case 'close': {
        for (const id of [...room.members.keys()]) room.kick(id, 'This room was closed')
        room.dispose()
        rooms.delete(room.code)
        return json(res, 200, { ok: true })
      }
      case 'grant': {
        const usd = Math.max(-1e9, Math.min(1e9, Number(a.usd) || 0))
        return json(res, room.grant(a.playerId, usd) ? 200 : 404, { ok: true })
      }
      case 'market': {
        const r = room.adminMarket(a.market)
        return json(res, r.error ? 400 : 200, r.error ? { error: r.error } : { ok: true, tokenId: r.tokenId })
      }
    }
  }
  return json(res, 404, { error: 'Unknown admin request' })
}
