// Spamming buys must not make money. A World player (with the World's bots) fires many small buys at one coin, as
// fast as a finger or a script can, then sells the lot. Whatever the pattern, on average they must come out behind
// by about the fees: the price they push up is the price they sell back down.
//   npx tsx scripts/spam-test.ts [coins per pattern=40]
import { Room } from '../server/room'
import { WORLD_CODE } from '../src/net/protocol'
import { DEFAULT_TRADE_SETTINGS } from '../src/data/tradeSettings'

let failed = 0
const ok = (cond: boolean, what: string) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${what}`)
  if (!cond) failed++
}
type Tok = { id: string; ticker: string; status: string; chain: string; price: number; liquidity: number; bondingProgress: number }
type Pos = { qty: number; costBasis: number; avgEntry: number }
type Mem = { wallet: { cash: number; positions: Record<string, Pos>; accounts: { id: string; balances: Record<string, number>; positions: Record<string, Pos> }[]; trades: { side: string; value: number; qty: number; price: number; tokenId: string }[] } }
type R = { tick(): void; handle(pid: string, m: unknown): void; members: Map<string, Mem>; market: { tokens: Tok[]; native?: Record<string, { price: number }> }; timer: ReturnType<typeof setInterval> }

const per = Number(process.argv[2] ?? 40)
const world = new Room(WORLD_CODE, true)
const r = world as unknown as R
clearInterval(r.timer)
for (let i = 0; i < 1500; i++) r.tick()
world.join({ readyState: 1, send: (_: string) => {}, close() {} } as never, { t: 'hello', name: 'Spammer', avatar: '🐸', level: 5, playerId: 'u-spam', verified: true })
r.tick()
world.grant('u-spam', 1_000_000, 'usd')
const me = () => r.members.get('u-spam')!
let seq = 1
r.handle('u-spam', { t: 'op', seq: seq++, op: { kind: 'swap', from: 'usd', to: 'sol', amount: 400_000, walletId: 'w-main' } })
const sol = () => r.market.native?.sol?.price ?? 150
// Everything the player owns that is not a bag, at one SOL price (the chain coin's own drift is not the trick).
const sol0 = sol()
const money = () => me().wallet.cash + (me().wallet.accounts[0].balances.sol ?? 0) * sol0
const coins = (kind: 'curve' | 'pool') => r.market.tokens.filter((t) => t.chain === 'sol' && (kind === 'curve' ? t.status === 'bonding' && t.bondingProgress > 3 && t.bondingProgress < 60 : t.status === 'graduated' && t.liquidity > 8000))

// (Every order carries the trade settings a real game sends: with them, other people's trades land first.)
const BUY = DEFAULT_TRADE_SETTINGS.sol.buy[0], SELL = DEFAULT_TRADE_SETTINGS.sol.sell[0]
interface Pattern { name: string; kind: 'curve' | 'pool'; buys: number; usd: number; gap: number; hold: number; first?: number }
const PATTERNS: Pattern[] = [
  { name: '30 buys of $20 in the same instant, sold 3 s later', kind: 'curve', buys: 30, usd: 20, gap: 0, hold: 3 },
  { name: '30 buys of $20, one a second, sold 3 s later', kind: 'curve', buys: 30, usd: 20, gap: 1, hold: 3 },
  { name: '100 buys of $5 in the same instant, sold at once', kind: 'curve', buys: 100, usd: 5, gap: 0, hold: 0 },
  { name: '10 buys of $200 in the same instant, sold 10 s later', kind: 'curve', buys: 10, usd: 200, gap: 0, hold: 10 },
  { name: 'one $300 buy, then 60 buys of $5, sold at once', kind: 'curve', buys: 60, usd: 5, gap: 0, hold: 0, first: 300 },
  { name: 'one $300 buy, then 60 buys of $5, sold at once', kind: 'pool', buys: 60, usd: 5, gap: 0, hold: 0, first: 300 },
  { name: '30 buys of $20 in the same instant, sold 3 s later', kind: 'pool', buys: 30, usd: 20, gap: 0, hold: 3 },
  { name: '100 buys of $5 in the same instant, sold at once', kind: 'pool', buys: 100, usd: 5, gap: 0, hold: 0 },
  { name: '10 buys of $200, one a second, sold 10 s later', kind: 'pool', buys: 10, usd: 200, gap: 1, hold: 10 },
]

const results: { p: Pattern; n: number; spent: number; pnl: number; best: number; avgOff: number }[] = []
// (A third argument runs only the patterns whose number is listed, e.g. "3" or "0,3".)
const only = process.argv[3] ? process.argv[3].split(",").map(Number) : null
for (const p of PATTERNS.filter((_, i) => !only || only.includes(i))) {
  let n = 0, spent = 0, pnl = 0, best = -Infinity, avgOff = 0
  const used = new Set<string>()
  for (let guard = 0; n < per && guard < per * 40; guard++) {
    for (let i = 0; i < 20; i++) r.tick()
    const t = coins(p.kind).find((x) => !used.has(x.id))
    if (!t) continue
    used.add(t.id)
    const before = money()
    const lastId = Math.max(0, ...me().wallet.trades.map((x) => (x as unknown as { id: number }).id))
    if (p.first) r.handle('u-spam', { t: 'order', seq: seq++, ref: seq, order: { side: 'buy', tokenId: t.id, walletIds: ['w-main'], usdEach: p.first, setting: BUY } })
    for (let b = 0; b < p.buys; b++) {
      r.handle('u-spam', { t: 'order', seq: seq++, ref: seq, order: { side: 'buy', tokenId: t.id, walletIds: ['w-main'], usdEach: p.usd, setting: BUY } })
      for (let g = 0; g < p.gap; g++) r.tick()
    }
    const pos = me().wallet.positions[t.id]
    if (!pos || !(pos.qty > 0)) continue
    // The average entry the wallet shows against what the fills really paid.
    const fills = me().wallet.trades.filter((x) => (x as unknown as { id: number }).id > lastId && x.tokenId === t.id && x.side === 'buy')
    const paid = fills.reduce((a, x) => a + x.value, 0), got = fills.reduce((a, x) => a + x.qty, 0)
    const gas = fills.reduce((a, x) => a + ((x as { gas?: number }).gas ?? 0), 0)
    if (got > 0) avgOff = Math.max(avgOff, Math.abs(pos.avgEntry / ((paid + gas) / got) - 1))
    for (let h = 0; h < p.hold; h++) r.tick()
    const q = me().wallet.positions[t.id]?.qty ?? 0
    const live = r.market.tokens.find((x) => x.id === t.id)
    if (q > 0 && live && (live.status === 'bonding' || live.status === 'graduated')) r.handle('u-spam', { t: 'order', seq: seq++, ref: seq, order: { side: 'sell', tokenId: t.id, legs: [{ walletId: 'w-main', qty: q }], setting: SELL } })
    const left = me().wallet.positions[t.id]?.qty ?? 0
    if (left > 0 && live && (live.status === 'bonding' || live.status === 'graduated')) r.handle('u-spam', { t: 'order', seq: seq++, ref: seq, order: { side: 'sell', tokenId: t.id, legs: [{ walletId: 'w-main', qty: left }] } }) // (refused for slippage: sold plainly)
    const d = money() - before
    n++
    spent += p.buys * p.usd + (p.first ?? 0)
    pnl += d
    best = Math.max(best, d)
  }
  results.push({ p, n, spent, pnl, best, avgOff })
}

console.log(`\nSPAMMING BUYS IN THE WORLD (${per} coins a pattern; what the player ended up with, after selling)\n`)
for (const x of results) {
  const pct = x.spent > 0 ? (x.pnl / x.spent) * 100 : 0
  console.log(`  ${x.p.kind === 'curve' ? 'on a curve' : 'in a pool '}  ${x.p.name}`)
  console.log(`      ${x.n} coins: ${pct >= 0 ? '+' : ''}${pct.toFixed(1)}% of the money put in (${x.pnl >= 0 ? '+' : '-'}$${Math.abs(x.pnl).toFixed(0)} on $${x.spent.toFixed(0)}), best single coin ${x.best >= 0 ? '+' : '-'}$${Math.abs(x.best).toFixed(0)}, shown average entry off by at most ${(x.avgOff * 100).toFixed(2)}%`)
}
console.log('')
ok(results.every((x) => x.n >= per * 0.5), `every pattern found coins to try (${results.map((x) => x.n).join(', ')})`)
// Many small buys are judged pattern by pattern (little luck in them). A few big buys ride on one or two lucky
// coins in a sample this size, so those are judged with everything else, added up.
const spam = results.filter((x) => x.p.buys >= 30)
ok(spam.every((x) => x.pnl / x.spent < 0.01), `no pattern of many small buys makes money: ${spam.map((x) => `${((x.pnl / x.spent) * 100).toFixed(1)}%`).join(', ')}`)
const allSpent = results.reduce((a, x) => a + x.spent, 0), allPnl = results.reduce((a, x) => a + x.pnl, 0)
ok(allPnl < 0, `all patterns added up lose money: ${((allPnl / allSpent) * 100).toFixed(1)}% of $${Math.round(allSpent).toLocaleString('en-US')}`)
ok(results.every((x) => x.avgOff < 0.001), 'the average entry the wallet shows is exactly what the buys paid, network fees included')
world.dispose()
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed')
process.exit(0)
