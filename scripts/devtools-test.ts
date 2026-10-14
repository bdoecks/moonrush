// A dev's tools on the server: the volume bot (a package, real trades, what it costs and brings back) and the airdrop
// (to the dev's own fresh wallets, or to tracked traders the dev picks).
//   npx tsx scripts/devtools-test.ts
import { Room } from '../server/room'
import { AIRDROP_MAX_KOLS, airdropFeePerWallet, BOT_PACKS, botPackCost, canReceive } from '../src/game/devTools'
import { GIFT_WHY } from '../src/game/walletEngine'
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

// ─── The airdrop ─────────────────────────────────────────────────────────────
const B = cook('DROPTEST', 2)
const bag = () => me().wallet.positions[B]?.qty ?? 0
const bag0 = bag()
ok(bag0 > 0, 'a second coin, with a dev bag')
const fee1 = airdropFeePerWallet('sol')
const shill0 = (r.market.shillQueue ?? []).length

// To the dev's own fresh wallets: only the network fee, the coins stay the dev's.
let solA = sol()
r.handle('pDev', { t: 'airdrop', seq: ++seq, tokenId: B, walletId: main, qty: bag0 * 0.5, wallets: 20, target: 'own' })
ok(bag() === bag0, 'moving part of the bag to wallets of your own gives nothing away (the coins can still be sold)')
ok(Math.abs(solA - sol() - fee1 * 20) < 1e-9, 'it costs the network fee for each wallet')
solA = sol()
r.handle('pDev', { t: 'airdrop', seq: ++seq, tokenId: B, walletId: main, qty: 1, wallets: 1e9, target: 'own' })
ok(solA - sol() <= fee1 * 50 + 1e-9, 'however many wallets a message asks for, fees are for 50 at most')
r.handle('pDev', { t: 'airdrop', seq: ++seq, tokenId: A, walletId: main, qty: 1, wallets: 5, target: 'holders', queue: [{ tokenId: A, atTick: r.market.tick + 1, usd: 0, wallet: 'x', side: 'sell', qty: 1e11 }] })
ok((r.market.shillQueue ?? []).filter((q) => q.wallet === 'x').length === 0 && (r.market.shillQueue ?? []).length <= shill0 + 50, 'the old kind of airdrop message does nothing: nobody\'s sells can be queued from a browser')

// To known traders the dev picks.
const can = () => r.wallets.filter((w) => canReceive(w, B))
const kols = can().filter((w) => w.style === 'kol')
ok(kols.length >= 3, `there are known traders to pick from (${can().length}, ${kols.length} of them KOLs)`)
const picks = kols.slice(0, 3).map((w) => w.id)
const botW = r.wallets.find((w) => w.bot)
const give = bag0 * 0.3
solA = sol()
const tapeB = new Set(tok(B)!.tape.map((x) => x.id))
r.handle('pDev', { t: 'airdrop', seq: ++seq, tokenId: B, walletId: main, qty: give, wallets: 99, target: 'kols', to: [...picks, 'no-such-wallet', ...(botW ? [botW.id] : [])] })
const posOf = (id: string) => r.wallets.find((w) => w.id === id)?.positions[B]
ok(Math.abs(bag() - (bag0 - give)) < 1e-3, 'tokens sent to known traders leave the dev wallet for good')
ok(picks.every((id) => Math.abs((posOf(id)?.qty ?? 0) - give / 3) < 1e-3 && posOf(id)?.gift), 'each picked trader now really holds its share, marked as sent by the dev')
ok(Math.abs(solA - sol() - fee1 * 3) < 1e-9, 'the fee is for the traders who received, not for what the message claimed')
ok(!botW || !r.wallets.find((w) => w.id === botW.id)?.positions[B]?.gift, 'a World bot (somebody\'s real wallet) cannot be sent tokens this way')
ok(tok(B)!.tape.every((x) => tapeB.has(x.id)), 'receiving is not a trade: nothing on the tape, so nothing for followers to copy')
const many = can().slice(0, 30).map((w) => w.id)
const before = r.wallets.filter((w) => w.positions[B]?.gift).length
r.handle('pDev', { t: 'airdrop', seq: ++seq, tokenId: B, walletId: main, qty: bag() * 0.1, wallets: 30, target: 'kols', to: many })
ok(r.wallets.filter((w) => w.positions[B]?.gift).length - before === Math.min(AIRDROP_MAX_KOLS, many.length), `one airdrop reaches ${AIRDROP_MAX_KOLS} traders at most`)
r.handle('pDev', { t: 'airdrop', seq: ++seq, tokenId: B, walletId: main, qty: bag(), wallets: 3, target: 'kols', to: picks })
ok(bag() > 0, 'a trader who already holds the coin cannot be sent more (nothing leaves the dev wallet)')
// They sell what they were sent, under their own names, as real trades.
const got0 = r.wallets.filter((w) => w.positions[B]?.gift).length
let soon = 0
for (let i = 0; i < 400; i++) {
  r.tick()
  if (i === 14) soon = got0 - r.wallets.filter((w) => w.positions[B]?.gift).length
}
const left = r.wallets.filter((w) => w.positions[B]?.gift).length
ok(soon >= 2 && soon < got0, `some sell what they were sent right away, the others hold a while (${soon} of ${got0} gone in 15 s)`)
ok(left < got0 * 0.5, `and most have sold within a few minutes (${got0 - left} of ${got0})`)
const sellers = r.wallets.filter((w) => w.trades.some((x) => x.tokenId === B && x.side === 'sell' && x.why === GIFT_WHY))
ok(sellers.length >= 3, `a trader's page says why it sold: "${GIFT_WHY}" (${sellers.length} traders)`)
// (Its first trade of the coin is that sell: no buy before it. It may choose to buy the coin later, like anybody.)
ok(sellers.every((w) => { const mine = w.trades.filter((x) => x.tokenId === B); return mine[mine.length - 1]?.why === GIFT_WHY }), 'none of them shows a buy of the coin before selling what it was sent')

console.log(bad ? `${bad} check(s) failed` : 'all checks passed')
process.exit(bad ? 1 : 0)
