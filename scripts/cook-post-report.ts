// What launching a coin ON a post pays (story market, stage 4). Not pass/fail: read it before and after touching
// anything a launch on a post lives by, several runs added up. A crew of chefs in the World, with its bots, launches
// one coin on every post from an account of 20K followers or more, two seconds after it appears, by one recipe:
//   npx tsx scripts/cook-post-report.ts [hours=6] [recipe=exact] [--json]
//   npx tsx scripts/cook-post-report.ts sum a.json b.json …
// Recipes (the dev's own buy is in SOL, from the dev wallet, ahead of the snipers as in every launch):
//   exact        the post's exact name, no dev buy: the launch fee against creator fees and the bonding bonus
//   exact-hold   the exact name, 1 SOL dev buy, sold when the post settles
//   exact-dump   the exact name, 3 SOL dev buy, sold three seconds later (on the snipers)
//   exact-quick  the exact name, 1 SOL dev buy, sold three seconds later
//   wrong-hold   a name that only borrows the subject, 1 SOL dev buy, sold when the post settles (the lazy cook)
// (The chef's part, knowing the right name, is taken from the server's hidden side: this stands in for somebody who
// reads the post correctly.)
import { readFileSync } from 'node:fs'
import { Room } from '../server/room'
import { cookToken } from '../src/game/marketEngine'
import { nativePrice } from '../src/game/tradingEngine'
import { tickerOf } from '../src/game/sparks'
import { WORLD_CODE } from '../src/net/protocol'
import { Rng } from '../src/utils/rng'
import type { MarketState } from '../src/types'

const RECIPES: Record<string, { exact: boolean; devBuy: number; sell: 'none' | 'quick' | 'settle' }> = {
  exact: { exact: true, devBuy: 0, sell: 'none' },
  'exact-hold': { exact: true, devBuy: 1, sell: 'settle' },
  'exact-dump': { exact: true, devBuy: 3, sell: 'quick' },
  'exact-quick': { exact: true, devBuy: 1, sell: 'quick' },
  'wrong-hold': { exact: false, devBuy: 1, sell: 'settle' },
}
type Out = { recipe: string; hours: number; launches: number; refused: number; pnl: number; picked: number; bonded: number; best: number }
const show = (o: Out) => console.log(`RECIPE "${o.recipe}", ${o.hours.toFixed(0)} World hours: ${o.launches} launches (${o.refused} refused), ${o.pnl / Math.max(1, o.launches) >= 0 ? '+' : '-'}$${Math.abs(o.pnl / Math.max(1, o.launches)).toFixed(0)} a launch ($${Math.round(o.pnl).toLocaleString('en-US')} in all), picked by the timeline ${((100 * o.picked) / Math.max(1, o.launches)).toFixed(0)}%, bonded ${((100 * o.bonded) / Math.max(1, o.launches)).toFixed(1)}%`)

if (process.argv[2] === 'sum') {
  const by = new Map<string, Out>()
  for (const f of process.argv.slice(3)) for (const line of readFileSync(f, 'utf8').split('\n').filter((l) => l.startsWith('{'))) {
    const j = JSON.parse(line) as Out
    const c = by.get(j.recipe) ?? { recipe: j.recipe, hours: 0, launches: 0, refused: 0, pnl: 0, picked: 0, bonded: 0, best: 0 }
    by.set(j.recipe, { ...c, hours: c.hours + j.hours, launches: c.launches + j.launches, refused: c.refused + j.refused, pnl: c.pnl + j.pnl, picked: c.picked + j.picked, bonded: c.bonded + j.bonded, best: Math.max(c.best, j.best) })
  }
  for (const o of by.values()) show(o)
  process.exit(0)
}

const hours = Number(process.argv[2] ?? 6)
const name = process.argv[3] ?? 'exact'
const recipe = RECIPES[name]
if (!recipe) throw new Error(`no recipe "${name}"`)
type Mem = { wallet: { cash: number; positions: Record<string, { qty: number }>; accounts: { id: string; balances: Record<string, number> }[] }; cashback?: { sol?: number } }
type R = { tick(): void; handle(pid: string, m: unknown): void; members: Map<string, Mem>; market: MarketState; cooked: Map<string, { pid: string; vault: number }>; timer: ReturnType<typeof setInterval> }

Room.storyMarket = true
Room.playersCook = true
const world = new Room(WORLD_CODE, true)
const r = world as unknown as R
clearInterval(r.timer)
for (let i = 0; i < 1500; i++) r.tick()
const CHEFS = Array.from({ length: 14 }, (_, i) => `u-chef${i}`)
for (const id of CHEFS) world.join({ readyState: 1, send: (_: string) => {}, close() {} } as never, { t: 'hello', name: `Chef${id.slice(6)}`, avatar: '🍳', level: 9, playerId: id, verified: true })
r.tick()
const sol0 = nativePrice(r.market, 'sol')
let seq = 1
for (const id of CHEFS) {
  world.grant(id, 100_000, 'usd')
  world.grant(id, 500, 'sol')
}
const worth = () => {
  let v = 0
  for (const id of CHEFS) {
    const m = r.members.get(id)!
    v += m.wallet.cash + (m.wallet.accounts[0].balances.sol ?? 0) * sol0 + (m.cashback?.sol ?? 0) * sol0
  }
  for (const c of r.cooked.values()) if (CHEFS.includes(c.pid)) v += c.vault * sol0
  return v
}
const start = worth()
const free = new Map(CHEFS.map((id) => [id, { last: -999, hour: [] as number[] }]))
const coins: { id: string; chef: string; spark: string; at: number; sold: boolean; bonded: boolean; seen?: boolean }[] = []
const done = new Set((r.market.sparks ?? []).map((s) => s.id))
const out: Out = { recipe: name, hours, launches: 0, refused: 0, pnl: 0, picked: 0, bonded: 0, best: 0 }
const rng = new Rng(12345)
const sell = (c: (typeof coins)[number]) => {
  const q = r.members.get(c.chef)!.wallet.positions[c.id]?.qty ?? 0
  if (q > 0) r.handle(c.chef, { t: 'order', seq: seq++, ref: seq, order: { side: 'sell', tokenId: c.id, legs: [{ walletId: 'w-main', qty: q }] } })
  c.sold = true
}
const ticks = Math.round(hours * 3600)
for (let i = 0; i < ticks; i++) {
  r.tick()
  const m = r.market
  for (const s of m.sparks ?? []) {
    if (done.has(s.id) || m.time - s.time < 2) continue
    done.add(s.id)
    const sim = m.sparkSim?.[s.id]
    if (!sim || sim.tool || s.by.followers < Number(process.env.MIN ?? 20_000)) continue
    const chef = CHEFS.find((id) => { const f = free.get(id)!; return m.tick - f.last >= 31 && f.hour.filter((t) => m.tick - t < 3600).length < 10 })
    if (!chef) continue
    const coinName = recipe.exact ? sim.name : `The ${sim.word.charAt(0).toUpperCase()}${sim.word.slice(1)}`
    const spec = { name: coinName, ticker: recipe.exact ? sim.ticker : tickerOf(sim.word), emoji: sim.emoji, hue: 200, description: 'Launched on the post, by somebody who read it.', chain: 'sol', pad: 'pump', tax: { buy: 0, sell: 0 }, devBuy: recipe.devBuy, marketing: 0, narrative: m.meta ?? 'dogs', socials: { x: true, tg: true, web: true }, style: 'stealth', bundle: { wallets: 0, perWallet: 0, stagger: false } }
    const c = cookToken(m, new Rng(Math.floor(rng.next() * 2 ** 31)), spec as never)
    const before = r.market.tokens.length
    r.handle(chef, { t: 'cook', seq: seq++, ref: seq, token: c.token, money: { devWallet: 'w-main', devBuy: recipe.devBuy, marketing: 0, style: 'stealth', onPost: s.id } })
    const f = free.get(chef)!
    if (r.market.tokens.length > before && r.cooked.has(c.token.id)) {
      f.last = m.tick
      f.hour = [...f.hour.filter((t) => m.tick - t < 3600), m.tick]
      coins.push({ id: c.token.id, chef, spark: s.id, at: m.time, sold: false, bonded: false })
      out.launches++
    } else out.refused++
  }
  for (const c of coins) {
    const t = r.market.tokens.find((x) => x.id === c.id)
    if (t?.status === 'graduated' && !c.bonded) { c.bonded = true; out.bonded++ }
    const s = r.market.sparks?.find((x) => x.id === c.spark)
    const over = !s || !!s.picked || s.over !== undefined
    if (over && !c.seen) { c.seen = true; if (s?.picked?.tokenId === c.id) out.picked++ }
    if (c.sold || recipe.sell === 'none') continue
    if (recipe.sell === 'quick' ? r.market.time - c.at >= 3 : over) sell(c)
  }
}
for (const c of coins) if (!c.sold && recipe.sell !== 'none') sell(c)
out.pnl = worth() - start
world.dispose()
if (process.argv.includes('--json')) console.log(JSON.stringify(out))
else show(out)
process.exit(0)
