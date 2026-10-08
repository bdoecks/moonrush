// What cooking pays in the World (with its bots): a player launches coin after coin by one recipe, and every dollar is
// counted: launch costs, the dev bag bought and sold, creator fees, bond bonuses.
//   npx tsx scripts/cook-report.ts [hours=3] [recipe|all] [--json file]
// Read it before and after touching anything a cooked coin lives by (COOK_FLOW, stepFlow's `rules`, creator fees,
// GRAD_BONUS, cookQuality). The numbers the owner is told about cooking come from here.
import { writeFileSync } from 'node:fs'
import { Room } from '../server/room'
import { cookToken, GRAD_BONUS } from '../src/game/marketEngine'
import { nativePrice } from '../src/game/tradingEngine'
import { Rng } from '../src/utils/rng'
import { WORLD_CODE, type ServerMsg } from '../src/net/protocol'

interface Recipe {
  name: string
  what: string
  good: boolean // the best launch a player can make (hot theme, all socials, hyped, marketing) or the laziest
  devBuy: number // SOL
  marketing: number
  sellAfter: number | 'bond' // seconds after launch the whole dev bag is sold; 'bond': held until it bonds or dies
  bundle?: { wallets: number; perWallet: number }
}
const RECIPES: Recipe[] = [
  { name: 'lazy', what: 'nothing filled in, no dev buy', good: false, devBuy: 0, marketing: 0, sellAfter: 0 },
  { name: 'good-nobuy', what: 'best launch, no dev buy (fees only)', good: true, devBuy: 0, marketing: 100, sellAfter: 0 },
  { name: 'good-1sol-30s', what: 'best launch, 1 SOL dev buy, sold after 30 s', good: true, devBuy: 1, marketing: 100, sellAfter: 30 },
  { name: 'good-1sol-2m', what: 'best launch, 1 SOL dev buy, sold after 2 min', good: true, devBuy: 1, marketing: 100, sellAfter: 120 },
  { name: 'good-3sol-60s', what: 'best launch, 3 SOL dev buy, sold after 1 min', good: true, devBuy: 3, marketing: 100, sellAfter: 60 },
  { name: 'good-1sol-hold', what: 'best launch, 1 SOL dev buy, held to the bond', good: true, devBuy: 1, marketing: 100, sellAfter: 'bond' },
  { name: 'good-bundle', what: 'best launch, 1 SOL dev buy + 5 bundle wallets of 1 SOL, all sold after 1 min', good: true, devBuy: 1, marketing: 100, sellAfter: 60, bundle: { wallets: 5, perWallet: 1 } },
  { name: 'good-10sol-5s', what: 'best launch, 10 SOL dev buy, dumped after 5 s (on the launch snipers)', good: true, devBuy: 10, marketing: 0, sellAfter: 5 },
  { name: 'good-5sol-5s', what: 'best launch, 5 SOL dev buy, dumped after 5 s', good: true, devBuy: 5, marketing: 0, sellAfter: 5 },
  { name: 'good-2sol-5s', what: 'best launch, 2 SOL dev buy, dumped after 5 s', good: true, devBuy: 2, marketing: 0, sellAfter: 5 },
  { name: 'best-free', what: 'best launch, no dev buy, no marketing (creator fees only, the cheapest way to launch well)', good: true, devBuy: 0, marketing: 0, sellAfter: 0 },
  { name: 'best-half-hold', what: 'best launch, 0.5 SOL dev buy held to the bond, no marketing', good: true, devBuy: 0.5, marketing: 0, sellAfter: 'bond' },
  { name: 'lazy-1sol-30s', what: 'nothing filled in, 1 SOL dev buy, sold after 30 s', good: false, devBuy: 1, marketing: 0, sellAfter: 30 },
]

type Tok = { id: string; status: string; chain: string; price: number; bondingProgress: number; creatorFees?: number; ath: number }
type Mem = { wallet: { cash: number; startBalance: number; positions: Record<string, { qty: number }>; accounts: { id: string; balances: Record<string, number> }[] }; cashback?: Record<string, number> }
type R = { tick(): void; handle(pid: string, m: unknown): void; members: Map<string, Mem>; market: { tokens: Tok[]; tick: number; meta?: string; native: Record<string, number> }; cooked: Map<string, { pid: string; vault: number; grad: boolean }>; timer: ReturnType<typeof setInterval> }

function run(recipe: Recipe, hours: number) {
  const world = new Room(WORLD_CODE, true)
  const r = world as unknown as R
  clearInterval(r.timer)
  for (let i = 0; i < 1800; i++) r.tick()
  const box: ServerMsg[] = []
  world.join({ readyState: 1, send: (d: string) => { if (box.length < 50) box.push(JSON.parse(d)) }, close() {} } as never, { t: 'hello', name: 'Chef', avatar: '🍳', level: 9, playerId: 'u-chef', verified: true })
  r.tick()
  const me = () => r.members.get('u-chef')!
  // SOL is counted at one price throughout: the chain coin's own drift is not cooking profit.
  const sol0 = nativePrice(world.market, 'sol')
  const sol = () => sol0
  let seq = 1
  // Plenty of money, so a recipe is never cut short by an empty wallet: the result is profit, not what was left.
  world.grant('u-chef', 200_000, 'usd')
  r.handle('u-chef', { t: 'op', seq: seq++, op: { kind: 'swap', from: 'usd', to: 'sol', amount: 100_000, walletId: 'w-main' } })
  const worth = () => {
    const w = me().wallet
    const main = w.accounts[0]
    let v = w.cash + (main.balances.sol ?? 0) * sol()
    for (const [id, c] of r.cooked) if (c.pid === 'u-chef') v += c.vault * sol()
    v += (me().cashback?.sol ?? 0) * sol()
    return v
  }
  const start = worth()
  const coins: { id: string; at: number; sold: boolean; bonded: boolean; peak: number }[] = []
  const ticks = Math.round(hours * 3600)
  let n = 0, refused = 0
  for (let i = 0; i < ticks; i++) {
    // Ten launches an hour is the World's limit: one every six minutes.
    if (i % 360 === 5) {
      const ticker = `CK${recipe.name.length}${(n++).toString(36).toUpperCase()}X`.slice(0, 8)
      const spec = {
        name: `${ticker} Coin`, ticker, emoji: '🍳', hue: 30, description: recipe.good ? 'A coin made with care for this very test.' : '', chain: 'sol', pad: 'pump', tax: { buy: 0, sell: 0 },
        devBuy: recipe.devBuy, marketing: recipe.marketing, narrative: recipe.good ? r.market.meta ?? 'dogs' : (['dogs', 'cats', 'frogs'].find((x) => x !== r.market.meta) as string),
        socials: recipe.good ? { x: true, tg: true, web: true } : { x: false, tg: false, web: false }, style: recipe.good ? 'hyped' : 'fair',
      }
      const c = cookToken(world.market, new Rng(i * 7919 + 13), spec as never)
      const before = r.market.tokens.length
      r.handle('u-chef', { t: 'cook', seq: seq++, ref: seq, token: c.token, money: { devWallet: 'w-main', devBuy: recipe.devBuy, marketing: recipe.marketing, style: spec.style, bundle: recipe.bundle ? { ...recipe.bundle, stagger: false } : undefined } })
      if (r.market.tokens.length > before && r.cooked.has(c.token.id)) coins.push({ id: c.token.id, at: i, sold: false, bonded: false, peak: 0 })
      else refused++
    }
    r.tick()
    for (const c of coins) {
      const t = r.market.tokens.find((x) => x.id === c.id)
      if (t) c.peak = Math.max(c.peak, t.bondingProgress)
      if (t?.status === 'graduated') c.bonded = true
      if (c.sold) continue
      const qty = me().wallet.positions[c.id]?.qty ?? 0
      if (!(qty > 0)) { c.sold = true; continue }
      const due = recipe.sellAfter === 'bond' ? !t || t.status !== 'bonding' || i === ticks - 1 : i - c.at >= recipe.sellAfter
      if (due && t && (t.status === 'bonding' || t.status === 'graduated')) {
        r.handle('u-chef', { t: 'order', seq: seq++, ref: seq, order: { side: 'sell', tokenId: c.id, legs: [{ walletId: 'w-main', qty }] } })
        c.sold = true
      } else if (due) c.sold = true
    }
  }
  // Whatever is still held at the end is sold if it can be.
  for (const [id, p] of Object.entries(me().wallet.positions)) {
    const t = r.market.tokens.find((x) => x.id === id)
    if (p.qty > 0 && t && (t.status === 'bonding' || t.status === 'graduated')) r.handle('u-chef', { t: 'order', seq: seq++, ref: seq, order: { side: 'sell', tokenId: id, legs: [{ walletId: 'w-main', qty: p.qty }] } })
  }
  let fees = 0
  for (const [, c] of r.cooked) if (c.pid === 'u-chef') fees += c.vault * sol()
  const bonded = coins.filter((c) => c.bonded).length
  const bonus = bonded * GRAD_BONUS
  const total = worth() - start
  const out = { recipe: recipe.name, what: recipe.what, hours, launches: coins.length, refused, bonded, reached40: coins.filter((c) => c.peak >= 40).length, total, fees: fees - bonus, bonus, cashback: (me().cashback?.sol ?? 0) * sol(), rest: total - fees - (me().cashback?.sol ?? 0) * sol() }
  world.dispose()
  return out
}

const args = process.argv.slice(2)
const jsonAt = args.indexOf('--json')
const jsonFile = jsonAt >= 0 ? args[jsonAt + 1] : null
const plain = args.filter((_, i) => jsonAt < 0 || (i !== jsonAt && i !== jsonAt + 1))
const hours = Number(plain[0] ?? 3)
const which = plain[1] ?? 'all'
const list = RECIPES.filter((x) => which === 'all' || x.name === which)
const results = list.map((x) => run(x, hours))
if (jsonFile) writeFileSync(jsonFile, JSON.stringify(results))
const usd = (v: number) => `${v < 0 ? '-' : '+'}$${Math.abs(Math.round(v)).toLocaleString('en-US')}`
console.log(`\nCOOKING IN THE WORLD, ${hours} h each, ten launches an hour (the limit)\n`)
for (const x of results) {
  const per = x.launches ? x.total / x.launches : 0
  console.log(`${x.recipe.padEnd(16)} ${x.what}`)
  console.log(`    ${x.launches} launches, ${x.bonded} bonded, ${x.reached40} got to 40% of the curve${x.refused ? `, ${x.refused} refused` : ''}`)
  console.log(`    made ${usd(x.total)} in all = ${usd(per)} a launch = ${usd(x.total / hours)} an hour`)
  console.log(`    of it: creator fees ${usd(x.fees)}, bond bonuses ${usd(x.bonus)}, cashback ${usd(x.cashback)}, the dev bag after launch costs ${usd(x.rest)}\n`)
}
process.exit(0)
