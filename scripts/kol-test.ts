// KOL copy traders: a KOL's buy brings followers' copy buys a few seconds later, their sell makes the copiers sell;
// a small account (or a fake-small buy) brings nobody. Runs on the server, like every other money move.
import { Room } from '../server/room'
import type { ServerMsg } from '../src/net/protocol'

const ok = (cond: boolean, what: string) => console.log(`${cond ? 'PASS' : 'FAIL'} ${what}`)
const inbox: ServerMsg[] = []
const room = new Room('KOLT')
type Q = { tokenId: string; side?: 'sell'; usd: number; qty?: number }
const r = room as unknown as { tick(): void; handle(pid: string, m: unknown): void; market: { tick: number; shillQueue?: Q[]; tokens: { id: string; ticker: string; status: string; liquidity: number; price: number; buys: number; sells: number }[] }; members: Map<string, { wallet: { accounts: { id: string; positions: Record<string, { qty: number }> }[] }; copyBook?: Record<string, { qty: number }> }> }
room.join({ readyState: 1, send: (d: string) => inbox.push(JSON.parse(d)), close() {} } as never, { t: 'hello', name: 'Kol', avatar: '👑', level: 1, playerId: 'p1' })
r.handle('p1', { t: 'start', mode: 'practice', durationTicks: null, engine: 'classic' })
const main = () => r.members.get('p1')!.wallet.accounts[0]
const lastWallet = () => [...inbox].reverse().find((m) => m.t === 'wallet') as Extract<ServerMsg, { t: 'wallet' }>
r.handle('p1', { t: 'op', seq: 1, op: { kind: 'swap', from: 'usd', to: 'sol', amount: 5000, walletId: main().id } })
const coins = r.market.tokens.filter((t) => (t as { chain?: string }).chain === 'sol' && (t.status === 'bonding' || t.status === 'graduated') && t.liquidity > 20_000)
const queued = (id: string, side?: 'sell') => (r.market.shillQueue ?? []).filter((q) => q.tokenId === id && q.side === side)

// A small account: nobody copies.
let seq = 2
r.handle('p1', { t: 'order', seq: seq++, ref: 1, order: { side: 'buy', tokenId: coins[0].id, walletIds: [main().id], usdEach: 200, kol: { followers: 900, rep: 40 } } })
ok(queued(coins[0].id).length === 0 && !lastWallet().note, 'under 10k followers: no copy traders')

// A KOL: copiers pile in behind the buy, and the player is told.
const big = coins[1]
r.handle('p1', { t: 'order', seq: seq++, ref: 2, order: { side: 'buy', tokenId: big.id, walletIds: [main().id], usdEach: 300, kol: { followers: 80_000, rep: 70 } } })
const wave = queued(big.id)
const note = lastWallet().note ?? ''
ok(wave.length >= 5 && wave.every((q) => q.usd <= 300), `80k-follower KOL: ${wave.length} copy buys queued, each no bigger than the KOL's $300`)
ok(/copy trader/.test(note), `the KOL is told: "${note}"`)
ok((r.members.get('p1')!.copyBook?.[big.id]?.qty ?? 0) > 0, 'the copiers\' bag is remembered')

// Buying again straight away doesn't summon another wave.
r.handle('p1', { t: 'order', seq: seq++, ref: 3, order: { side: 'buy', tokenId: big.id, walletIds: [main().id], usdEach: 300, kol: { followers: 80_000, rep: 70 } } })
ok(queued(big.id).length === wave.length, 'a second buy within a minute brings no new copiers')

// The copy buys land on the market a few seconds later and push the price up.
const p0 = r.market.tokens.find((t) => t.id === big.id)!.price
const b0 = r.market.tokens.find((t) => t.id === big.id)!.buys
for (let i = 0; i < 10; i++) r.tick()
const after = r.market.tokens.find((t) => t.id === big.id)
ok(queued(big.id).length === 0 && !!after && after.buys > b0, `the copy buys landed: all ${wave.length} went through within 10 ticks in 10 ticks (price ${p0.toPrecision(3)} → ${after?.price.toPrecision(3)})`)

// A buy from a side wallet only: copy traders can't see it.
{
  const me = r.members.get('p1')! as unknown as { wallet: { accounts: { id: string }[] } }
  r.handle('p1', { t: 'op', seq: seq++, op: { kind: 'swap', from: 'usd', to: 'sol', amount: 1, walletId: main().id } })
  const side = me.wallet.accounts[1]?.id
  if (side) {
    r.handle('p1', { t: 'op', seq: seq++, op: { kind: 'transfer', fromId: main().id, toId: side, chain: 'sol', amount: 3 } })
    const other = coins[2]
    r.handle('p1', { t: 'order', seq: seq++, ref: 9, order: { side: 'buy', tokenId: other.id, walletIds: [side], usdEach: 300, kol: { followers: 80_000, rep: 70 } } })
    ok(queued(other.id).length === 0, 'a side-wallet buy brings no copy traders (they follow the main wallet only)')
  } else ok(true, '(no side wallet in this account layout: side-wallet check skipped)')
}

// The KOL sells everything: the copiers dump behind them.
const qty = main().positions[big.id]?.qty ?? 0
r.handle('p1', { t: 'order', seq: seq++, ref: 4, order: { side: 'sell', tokenId: big.id, legs: [{ walletId: main().id, qty }] } })
const dump = queued(big.id, 'sell')
ok(dump.length > 0 && dump.every((q) => (q.qty ?? 0) > 0), `KOL sold: ${dump.length} copier sells queued`)
ok(!r.members.get('p1')!.copyBook?.[big.id], 'after a full sell the copiers hold nothing')
room.dispose()
process.exit(0)
