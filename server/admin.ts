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
  | { action: 'grant'; room: string; playerId: string; usd?: number; asset?: 'usd' | 'sol' | 'bsc' | 'hood'; amount?: number }
  | { action: 'market'; room: string; market: AdminMarketAction }
  | { action: 'mute'; room: string; playerId: string; minutes: number } // 0 = unmute
  | { action: 'dismissReport'; room: string; id: number }
  | { action: 'reset'; room: string; playerId?: string } // wipe a wallet back to the start (no player = everyone)

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
        const asset = a.asset && ['usd', 'sol', 'bsc', 'hood'].includes(a.asset) ? a.asset : 'usd'
        const amount = Math.max(0, Math.min(1e9, Number(a.amount ?? a.usd) || 0))
        if (!amount) return json(res, 400, { error: 'Amount must be more than 0' })
        return json(res, room.grant(a.playerId, amount, asset) ? 200 : 404, { ok: true })
      }
      case 'mute':
        return json(res, room.mute(String(a.playerId), Math.max(0, Math.min(60 * 24 * 30, Number(a.minutes) || 0))) ? 200 : 404, { ok: true })
      case 'dismissReport':
        return json(res, room.dismissReport(Number(a.id)) ? 200 : 404, { ok: true })
      case 'reset': {
        const n = room.resetWallets(a.playerId ? String(a.playerId) : undefined)
        return json(res, n ? 200 : 404, n ? { ok: true, reset: n } : { error: a.playerId ? 'That player has no wallet in this room' : 'No wallets to reset (is a round running?)' })
      }
      case 'market': {
        const r = room.adminMarket(a.market)
        return json(res, r.error ? 400 : 200, r.error ? { error: r.error } : { ok: true, tokenId: r.tokenId })
      }
    }
  }
  return json(res, 404, { error: 'Unknown admin request' })
}
