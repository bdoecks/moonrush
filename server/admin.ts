// Admin API for the admin panel: rooms and players, kicks and bans, notices, money, and market god mode.
// Every request must carry the admin's login token; anyone else gets 403.
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AdminMarketAction } from '../src/game/marketEngine'
import { isAdmin } from './auth'
import type { AdminOps } from './index'
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
  | { action: 'startBalance'; room: string; usd: number } // World: what a new (or reset) wallet starts with from now on
  | { action: 'resetWorld'; room: string; confirm?: string } // World: every wallet back to the start, players' coins off the market, records to zero

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

export async function handleAdmin(req: IncomingMessage, res: ServerResponse, path: string, rooms: Map<string, Room>, ops: AdminOps) {
  const token = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '')
  if (!(await isAdmin(token))) return json(res, 403, { error: 'Admins only' })

  // Health watch and backups.
  if (req.method === 'GET' && path === '/admin/api/health') return json(res, 200, ops.health())
  if (req.method === 'GET' && path === '/admin/api/backups') {
    try {
      const rows = await ops.listBackups()
      return json(res, 200, { set: rows !== null, backups: rows ?? [] })
    } catch {
      return json(res, 503, { error: "The database didn't answer" })
    }
  }
  const one = /^\/admin\/api\/backups\/(\d+)$/.exec(path)
  if (req.method === 'GET' && one) {
    const b = await ops.loadBackup(Number(one[1])).catch(() => null)
    if (!b) return json(res, 404, { error: 'No backup with that number' })
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', 'content-disposition': `attachment; filename="moonrush-${b.row.kind}-${b.row.taken_at.slice(0, 10)}.json"` })
    return res.end(JSON.stringify({ ...b.row, data: b.data }))
  }
  if (req.method === 'POST' && path === '/admin/api/backup') {
    const a = ((await readBody(req)) ?? {}) as { action?: string; id?: number; confirm?: string }
    if (a.action === 'take') {
      const r = await ops.takeBackup('taken by hand')
      return json(res, r.ok ? 200 : 500, r.ok ? { ok: true, taken: r.taken } : { error: r.error ?? 'The backup failed' })
    }
    if (a.action === 'restoreWorld') {
      // Replaces the running World: the admin has to type the word.
      if (a.confirm !== 'RESTORE') return json(res, 400, { error: 'Type RESTORE to confirm' })
      const r = await ops.restoreWorld(Number(a.id))
      return json(res, r.ok ? 200 : 500, r.ok ? { ok: true } : { error: r.error ?? 'The restore failed' })
    }
    return json(res, 400, { error: 'Unknown backup action' })
  }

  if (req.method === 'GET' && path === '/admin/api/rooms') {
    return json(res, 200, { rooms: [...rooms.values()].map((r) => r.summary()), bannedGuests: bannedGuests.size })
  }
  // Every wallet of one player in a room, side and dev wallets too (the admin's eyes only).
  if (req.method === 'POST' && path === '/admin/api/wallets') {
    const a = ((await readBody(req)) ?? {}) as { room?: string; playerId?: string }
    const r = rooms.get(String(a.room ?? '').toUpperCase())?.adminWallets(String(a.playerId ?? ''))
    return json(res, r ? 200 : 404, r ?? { error: 'That player has no wallet in this room' })
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
      case 'startBalance': {
        const v = room.world ? ops.setWorldStart(Number(a.usd)) : null
        return json(res, v === null ? 400 : 200, v === null ? { error: 'Only the World has a starting balance to set, and it must be a number' } : { ok: true, startBalance: v })
      }
      case 'resetWorld': {
        // Wipes every player's World wallet, coins and records: the admin has to type the word.
        if (!room.world) return json(res, 400, { error: 'Only the World can be reset this way' })
        if (a.confirm !== 'RESET') return json(res, 400, { error: 'Type RESET to confirm' })
        const r = await ops.resetWorld()
        return json(res, r.ok ? 200 : 500, r.ok ? r : { error: r.error ?? 'The reset failed' })
      }
      case 'market': {
        const r = room.adminMarket(a.market)
        return json(res, r.error ? 400 : 200, r.error ? { error: r.error } : { ok: true, tokenId: r.tokenId })
      }
    }
  }
  return json(res, 404, { error: 'Unknown admin request' })
}
