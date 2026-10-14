// A dev's tools on the server: the volume bot (a package, real trades, what it costs and brings back) and the airdrop
// (to the dev's own fresh wallets, or to tracked traders the dev picks).
//   npx tsx scripts/devtools-test.ts
import { Room } from '../server/room'
import { BOT_PACKS, botPackCost } from '../src/game/devTools'
import { cookToken } from '../src/game/marketEngine'
import { creatorRate, nativePrice } from '../src/game/tradingEngine'
import { WORLD_CODE, type ServerMsg } from '../src/net/protocol'
import { Rng } from '../src/utils/rng'
import type { MarketState, SimWallet, Token } from '../src/types'

let bad = 0
const ok = (cond: boolean, what: string) => {
  if (!cond) bad++
  console.log(`${cond ? 'PASS' : 'FAIL'} ${what}`)
}
process.env.WORLD_GUESTS_PLAY = '1'
type Mem = { wallet: { cash: number; feesPaid: number; balances: Record<string, number>; positions: Record<string, { qty: number }> } }
type R = { tick(): void; handle(pid: string, m: unknown): void; members: Map<string, Mem>; market: MarketState; wallets: SimWallet[]; bots: Map<string, { on: boolean; volume: number; spent: number; target?: number; pack?: string }>; timer: ReturnType<typeof setInterval> }
const room = new Room(WORLD_CODE, true)
const r = room as unknown as R
clearInterval(r.timer)
const got: ServerMsg[] = []
room.join({ readyState: 1, send: (d: string) => got.push(JSON.parse(String(d))), close() {} } as never, { t: 'hello', name: 'dev', avatar: '🐸', level: 1, playerId: 'pDev', key: 'k', verified: false } as never)
for (let i = 0; i < 30; i++) r.tick()
const me = () => r.members.get('pDev')!
const tok = (id: string) => r.market.tokens.find((t) => t.id === id) as Token | undefined
let seq = 0
// Money in the dev wallet for a dev buy and the bot's trading fees.
const main = 'w-main'
room.grant('pDev', 50_000, 'usd')
r.handle('pDev', { t: 'op', seq: ++seq, op: { kind: 'swap', from: 'usd', to: 'sol', amount: 5000, walletId: main } })
const cook = (ticker: string, devBuy: number) => {
  const built = cookToken(r.market, new Rng(7), { chain: 'sol', pad: 'pump', tax: { buy: 0, sell: 0 }, name: `Test ${ticker}`, ticker, emoji: '🧪', hue: 100, description: '', narrative: 'absurd', socials: { x: false, tg: false, web: false }, style: 'fair', marketing: 0, devBuy, bundle: { wallets: 0, perWallet: 0, stagger: false }, plain: true }).token
  const id = `${ticker}-${Math.random().toString(36).slice(2, 6)}`
  r.handle('pDev', { t: 'cook', seq: ++seq, ref: seq, token: { ...built, id }, money: { devWallet: main, devBuy, marketing: 0 } })
  return id
}
const sol = () => me().wallet.balances.sol ?? 0
ok(sol() > 10, `the dev wallet holds ${sol().toFixed(1)} SOL`)

// ─── The volume bot ──────────────────────────────────────────────────────────
const A = cook('BOTTEST', 1)
ok(!!tok(A), 'a coin is launched')
const pack = BOT_PACKS[0]
const cash0 = me().wallet.cash
r.handle('pDev', { t: 'bot', tokenId: A, bot: { on: true, pack: 'no-such-package' } })
ok(!r.bots.get(A) && me().wallet.cash === cash0, 'a package that is not on the list is not started and costs nothing')
r.handle('pDev', { t: 'bot', tokenId: A, bot: { on: true, pack: pack.id, rate: 1e9, volume: -5, spent: -100, target: 1 } })
const bot0 = r.bots.get(A)!
ok(!!bot0?.on && me().wallet.cash === cash0 - pack.fee, `buying the ${pack.label} package takes its $${pack.fee} service fee, up front`)
ok(bot0.target === pack.volume && bot0.volume === 0 && bot0.spent === pack.fee, 'its speed, volume and counts are the server\'s (what the message claimed is ignored)')
r.handle('pDev', { t: 'bot', tokenId: A, bot: { on: true, pack: pack.id } })
ok(me().wallet.cash === cash0 - pack.fee, 'asking again while it runs does not charge twice')

const t0 = tok(A)!
const tapeBefore = new Set(t0.tape.map((x) => x.id))
const sol0 = sol()
const fees0 = t0.creatorFees ?? 0
let drift = 0
let ticks = 0
let botVol = 0
while (r.bots.get(A)?.on && ticks < 900) {
  const before = r.bots.get(A)!.volume
  r.tick()
  botVol = r.bots.get(A)?.volume ?? botVol
  ticks++
  void before
}
const t1 = tok(A)!
ok(t1.status === 'bonding' || t1.status === 'graduated', 'a coin its bot is trading is not written off as dead meanwhile')
ok(!r.bots.get(A) && botVol >= pack.volume, `the bot stops by itself once the package is delivered ($${Math.round(botVol)} of $${pack.volume}, in ${ticks} s for a ${pack.minutes}-minute package)`)
ok(ticks > pack.minutes * 60 * 0.6 && ticks < pack.minutes * 60 * 1.6, 'and takes about as long as the package says')
const fresh = t1.tape.filter((x) => !tapeBefore.has(x.id))
// Its trades are on the tape as real fills: the same wallet buys and then sells the same money's worth.
const byWallet = new Map<string, { buy: number; sell: number }>()
for (const x of fresh) {
  const e = byWallet.get(x.wallet) ?? { buy: 0, sell: 0 }
  e[x.side] += x.usd
  byWallet.set(x.wallet, e)
}
const pairs = [...byWallet.values()].filter((e) => e.buy > 0 && e.sell > 0 && Math.abs(e.buy - e.sell) / e.buy < 0.02)
ok(pairs.length >= 5, `the tape shows the bot's wallets buying and selling the same size (${pairs.length} such wallets among the last ${fresh.length} trades)`)
void drift
const paid = (sol0 - sol()) * nativePrice(r.market, 'sol')
const want = botPackCost(t1, pack)
ok(paid > want * 0.8 && paid < want * 1.25, `the dev wallet paid the trading fees on the bot's trades: $${paid.toFixed(0)} for $${Math.round(botVol)} of volume (the fee both ways comes to $${want.toFixed(0)})`)
const back = (t1.creatorFees ?? 0) - fees0
ok(back >= botVol * creatorRate(t1) * 0.9, `the dev earns the creator fee on that volume like on any other: $${back.toFixed(2)}`)
ok(pack.fee + paid > back * 2, `and the package costs far more than it brings back ($${(pack.fee + paid).toFixed(0)} against $${back.toFixed(0)})`)
for (const p of BOT_PACKS) ok(p.fee + botPackCost(t1, p) > p.volume * creatorRate(t1) * 2, `the ${p.label} package cannot pay for itself in creator fees`)

console.log(bad ? `${bad} check(s) failed` : 'all checks passed')
process.exit(bad ? 1 : 0)
