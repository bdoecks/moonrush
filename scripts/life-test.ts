// Lifetime records in the World: the server counts every fill (buys, sells, volume, wins, best / worst trade), the
// record is on your board row and your player card, survives a restart, and the bots keep one too.
import { Room } from '../server/room'
import { WORLD_CODE, type ServerMsg } from '../src/net/protocol'

const ok = (cond: boolean, what: string) => console.log(`${cond ? 'PASS' : 'FAIL'} ${what}`)
const box: ServerMsg[] = []
const world = new Room(WORLD_CODE, true)
type Life = { trades: number; buys: number; sells: number; wins: number; volume: number; realized: number; bestPct: number; bestTicker?: string }
type M = { wallet: { accounts: { id: string; positions: Record<string, { qty: number }> }[] }; life?: Life; info: { bot?: boolean } }
const w = world as unknown as { tick(): void; handle(id: string, m: unknown): void; members: Map<string, M>; market: { tokens: { id: string; chain: string; status: string; liquidity: number }[] }; snapshot(): unknown; boardCache: unknown }
world.join({ readyState: 1, send: (d: string) => box.push(JSON.parse(d)), close() {} } as never, { t: 'hello', name: 'P', avatar: '🐸', level: 1, playerId: 'u-p', verified: true })
const me = () => w.members.get('u-p')!
const main = () => me().wallet.accounts[0]
let seq = 1
w.handle('u-p', { t: 'op', seq: seq++, op: { kind: 'swap', from: 'usd', to: 'sol', amount: 2000, walletId: main().id } })
const coin = w.market.tokens.find((t) => t.chain === 'sol' && (t.status === 'bonding' || t.status === 'graduated') && t.liquidity > 20_000)!
w.handle('u-p', { t: 'order', seq: seq++, ref: 1, order: { side: 'buy', tokenId: coin.id, walletIds: [main().id], usdEach: 200 } })
w.handle('u-p', { t: 'order', seq: seq++, ref: 2, order: { side: 'buy', tokenId: coin.id, walletIds: [main().id], usdEach: 100 } })
const qty = main().positions[coin.id]?.qty ?? 0
w.handle('u-p', { t: 'order', seq: seq++, ref: 3, order: { side: 'sell', tokenId: coin.id, legs: [{ walletId: main().id, qty }] } })
const l = me().life
ok(!!l && l.trades === 3 && l.buys === 2 && l.sells === 1 && l.volume > 290, `two buys and a sell recorded: ${l?.trades} trades (${l?.buys}/${l?.sells}), $${l?.volume.toFixed(0)} volume, realized ${l?.realized.toFixed(2)}`)

// A rejected order (selling a coin you do not hold) is not a trade.
const other = w.market.tokens.find((t) => t.id !== coin.id && !main().positions[t.id])!
w.handle('u-p', { t: 'order', seq: seq++, ref: 4, order: { side: 'sell', tokenId: other.id, legs: [{ walletId: main().id, qty: 1000 }] } })
ok(me().life?.trades === 3, 'an order that fails adds nothing')

// Your board row and your card carry it.
w.boardCache = null
w.handle('u-p', { t: 'board', list: 'worth' })
const b = [...box].reverse().find((m) => m.t === 'board') as Extract<ServerMsg, { t: 'board' }>
ok(b.me?.row.life?.trades === 3 && b.rows.filter((r) => r.id !== 'u-p').every((r) => !r.life), 'your own board row has your record (other rows don\'t carry theirs)')
w.handle('u-p', { t: 'card', id: 'u-p' })
const c = [...box].reverse().find((m) => m.t === 'card') as Extract<ServerMsg, { t: 'card' }>
ok(c.card?.life?.trades === 3, 'your player card shows the record')

// Bots keep one too, and it all survives a restart.
for (let i = 0; i < 600; i++) w.tick()
const botLives = [...w.members.values()].filter((m) => m.info.bot && (m.life?.trades ?? 0) > 0).length
ok(botLives > 0, `bots have lifetime records too (${botLives} so far)`)
const back = Room.restore(JSON.parse(JSON.stringify(world.snapshot())), null) as unknown as { members: Map<string, M>; dispose(): void }
ok(back.members.get('u-p')?.life?.trades === 3, 'the record is saved with the World')
back.dispose()
world.dispose()
process.exit(0)
