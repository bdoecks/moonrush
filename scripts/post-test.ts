// What reading a post earns (the story market, src/game/sparks.ts). A player in the World, with its bots, follows ONE
// rule on every post for some hours: real orders, sent with the trade settings the game sends, fees and other
// people's trades landing first included. What they end up with, by the size of the account that posted.
//   npx tsx scripts/post-test.ts [hours=3] [rule=careful] [stake=100] [--json] [--loose]
//   npx tsx scripts/post-test.ts sum a.json b.json …        (several runs added up: one run is a few lucky coins)
// The rules (a rule is something a player, or a script, could do):
//   careful   the first coin on a post with the post's exact name AND a LOW risk tag, bought as it appears
//   slow      the same, by a person: bought 5 s after it appears, sold 2 s after the post settles
//   sure      the pickiest reader: only when the FIRST coin on a post has the exact name and a LOW tag (the coin
//             with the most money in it is also the right one), and nothing otherwise
//   checked   careful, and the account is looked at first: only posts from an account with a check mark that are
//             not a screenshot of somebody else's post (stage 2, real or larp: run with LARPS=1)
//   right     the first coin with the post's exact name, whatever its tag
//   wrong     the first coin whose name is NOT the post's (the trap)
//   first     the first coin on a post, whatever it is called
//   rich      12 s after the post, the coin on it with the highest market cap
//   any       every third coin launched on a post
//   news      the coin the timeline settled on, bought the second after, sold 30 s later
// Every position is sold when its post settles (a coin was picked, or the timeline moved on), or after 4 minutes.
// Orders go out with the game's first trade preset (20% slippage at the most): a big order into a small curve is
// refused by it, as it is in the game. `--loose` uses the preset with no slippage limit, which is how a big buyer
// would have to trade: use it for stakes of $500 and up.
// (The reader's part, knowing the right name, is taken from the server's hidden side: this test stands in for
// somebody who reads the post correctly. Nothing else it uses is hidden.)
// Not pass/fail: read it before and after touching a dial in SPARK, several runs added up.
import { readFileSync } from 'node:fs'
import { Room } from '../server/room'
import { DEFAULT_TRADE_SETTINGS } from '../src/data/tradeSettings'
import { fitOf } from '../src/game/sparks'
import { WORLD_CODE } from '../src/net/protocol'
import type { Chain, MarketState, Token } from '../src/types'

const SIZES = ['under 2K', '2K to 20K', '20K to 500K', '500K to 20M', 'over 20M'] as const
const sizeOf = (followers: number) => (followers < 2000 ? 0 : followers < 20_000 ? 1 : followers < 500_000 ? 2 : followers < 20_000_000 ? 3 : 4)
type Row = { n: number; spent: number; pnl: number; up: number; best: number; picked: number }
const blank = (): Row => ({ n: 0, spent: 0, pnl: 0, up: 0, best: 0, picked: 0 })
const show = (rule: string, stake: number, hours: number, rows: Row[]) => {
  const all = rows.reduce((a, r) => ({ n: a.n + r.n, spent: a.spent + r.spent, pnl: a.pnl + r.pnl, up: a.up + r.up, best: Math.max(a.best, r.best), picked: a.picked + r.picked }), blank())
  const line = (name: string, r: Row) => `  ${name.padEnd(14)} ${String(r.n).padStart(5)} trades  ${r.spent > 0 ? `${((100 * r.pnl) / r.spent >= 0 ? '+' : '') + ((100 * r.pnl) / r.spent).toFixed(1)}%`.padStart(7) : '      -'} of the money put in  ${(r.n ? `${r.pnl / r.n >= 0 ? '+' : '-'}$${Math.abs(r.pnl / r.n).toFixed(1)}` : '-').padStart(9)} a trade  ${r.n ? `${Math.round((100 * r.up) / r.n)}%`.padStart(4) : '   -'} ended up  ${r.n ? `${Math.round((100 * r.picked) / r.n)}%`.padStart(4) : '   -'} were the picked coin  best +$${r.best.toFixed(0)}`
  console.log(`\nRULE "${rule}", $${stake} a trade, ${hours.toFixed(1)} World hours (${(all.n / Math.max(0.01, hours)).toFixed(1)} trades an hour)`)
  console.log('  by the followers of the account that posted:')
  rows.forEach((r, i) => console.log(line(SIZES[i], r)))
  console.log(line('ALL POSTS', all))
}

if (process.argv[2] === 'sum') {
  const by = new Map<string, { stake: number; hours: number; rows: Row[] }>()
  for (const f of process.argv.slice(3)) {
    for (const text of readFileSync(f, 'utf8').split('\n').filter((l) => l.startsWith('{'))) {
      const j = JSON.parse(text) as { rule: string; stake: number; hours: number; rows: Row[] }
      const key = `${j.rule}@${j.stake}`
      const cur = by.get(key) ?? { stake: j.stake, hours: 0, rows: SIZES.map(blank) }
      cur.hours += j.hours
      j.rows.forEach((r, i) => { const c = cur.rows[i]; c.n += r.n; c.spent += r.spent; c.pnl += r.pnl; c.up += r.up; c.picked += r.picked; c.best = Math.max(c.best, r.best) })
      by.set(key, cur)
    }
  }
  for (const [key, v] of by) show(key.split('@')[0], v.stake, v.hours, v.rows)
  process.exit(0)
}

const hours = Number(process.argv[2] ?? 3)
const rule = process.argv[3] ?? 'careful'
const stake = Number(process.argv[4] ?? 100)
const json = process.argv.includes('--json')
const preset = process.argv.includes('--loose') ? 2 : 0
if (!['careful', 'checked', 'slow', 'sure', 'right', 'wrong', 'first', 'rich', 'any', 'news'].includes(rule)) throw new Error(`no rule "${rule}"`)

type Pos = { qty: number }
type Mem = { wallet: { cash: number; positions: Record<string, Pos>; accounts: { id: string; balances: Record<string, number> }[] } }
type R = { tick(): void; handle(pid: string, m: unknown): void; members: Map<string, Mem>; market: MarketState; timer: ReturnType<typeof setInterval> }

Room.storyMarket = true
if (process.env.LARPS === '1') Room.larps = true // real or larp: some posts are fakes
const world = new Room(WORLD_CODE, true)
const r = world as unknown as R
clearInterval(r.timer)
for (let i = 0; i < 1500; i++) r.tick()
const ME = 'u-reader'
world.join({ readyState: 1, send: (_: string) => {}, close() {} } as never, { t: 'hello', name: 'Reader', avatar: '🐸', level: 5, playerId: ME, verified: true })
r.tick()
const CHAINS: Chain[] = ['sol', 'bsc', 'hood']
const px0 = Object.fromEntries(CHAINS.map((c) => [c, r.market.native?.[c]?.price ?? 100])) as Record<Chain, number>
for (const c of CHAINS) world.grant(ME, 400_000 / px0[c], c)
const me = () => r.members.get(ME)!
// Everything the player has that is not a bag, each chain's coin at one price (its own drift is not the point).
const money = () => me().wallet.cash + CHAINS.reduce((a, c) => a + (me().wallet.accounts[0].balances[c] ?? 0) * px0[c], 0)
let seq = 1
const live = (t?: Token) => !!t && (t.status === 'bonding' || t.status === 'graduated')
const buy = (t: Token) => {
  const before = money()
  r.handle(ME, { t: 'order', seq: seq++, ref: seq, order: { side: 'buy', tokenId: t.id, walletIds: ['w-main'], usdEach: stake, setting: DEFAULT_TRADE_SETTINGS[t.chain].buy[preset] } })
  return before - money()
}
const sell = (id: string) => {
  const before = money()
  const t = r.market.tokens.find((x) => x.id === id)
  const q = me().wallet.positions[id]?.qty ?? 0
  // (A coin that has gone dead can still be sold back to its curve: only buying it is refused.)
  if (q > 0 && t) r.handle(ME, { t: 'order', seq: seq++, ref: seq, order: { side: 'sell', tokenId: id, legs: [{ walletId: 'w-main', qty: q }], setting: DEFAULT_TRADE_SETTINGS[t.chain].sell[preset] } })
  const left = me().wallet.positions[id]?.qty ?? 0
  // (Refused for slippage: sold plainly, as a player would on the second try.)
  if (left > 0 && t) r.handle(ME, { t: 'order', seq: seq++, ref: seq, order: { side: 'sell', tokenId: id, legs: [{ walletId: 'w-main', qty: left }] } })
  return money() - before
}

const rows = SIZES.map(blank)
interface Held { id: string; spark: string; size: number; spent: number; at: number; sellAt?: number }
const held: Held[] = []
const want: { id: string; spark: string; size: number; at: number }[] = [] // (the slow reader's orders, on their way)
const done = new Set<string>() // posts this rule has acted on
const seen = new Set(r.market.tokens.map((t) => t.id))
const settled = new Set((r.market.sparks ?? []).filter((s) => s.picked || s.over !== undefined).map((s) => s.id))
let nth = 0
const close = (h: Held) => {
  const got = sell(h.id)
  const row = rows[h.size]
  const pnl = got - h.spent
  row.n++
  row.spent += h.spent
  row.pnl += pnl
  if (pnl > 0) row.up++
  row.best = Math.max(row.best, pnl)
  if (r.market.sparks?.find((s) => s.id === h.spark)?.picked?.tokenId === h.id) row.picked++
}
const open = (t: Token, spark: string, size: number, sellAt?: number) => {
  const spent = buy(t)
  if (spent > 1) held.push({ id: t.id, spark, size, spent, at: r.market.time, sellAt })
}
const ticks = Math.round(hours * 3600)
for (let i = 0; i < ticks; i++) {
  r.tick()
  const m = r.market
  const now = m.time
  const sparkOf = new Map((m.sparks ?? []).map((s) => [s.id, s]))
  // New coins on posts.
  for (const t of m.tokens) {
    if (seen.has(t.id)) continue
    seen.add(t.id)
    const s = t.spark ? sparkOf.get(t.spark.id) : undefined
    const sim = t.spark ? m.sparkSim?.[t.spark.id] : undefined
    if (!t.spark || !s || !sim || !live(t)) continue
    const size = sizeOf(s.by.followers)
    const exact = fitOf(t, sim) === 'exact'
    if (rule === 'any') { if (nth++ % 3 === 0) open(t, s.id, size); continue }
    if (done.has(s.id)) continue
    const take =
      rule === 'careful' || rule === 'slow' ? exact && t.riskLevel === 'LOW'
      : rule === 'checked' ? exact && t.riskLevel === 'LOW' && s.by.verified && !s.quote
      : rule === 'sure' ? exact && t.riskLevel === 'LOW' && t.spark.n === 1
      : rule === 'right' ? exact
      : rule === 'wrong' ? !exact
      : rule === 'first' ? t.spark.n === 1
      : false
    if (rule === 'sure' && t.spark.n === 1) done.add(s.id)
    if (!take) continue
    done.add(s.id)
    if (rule === 'slow') want.push({ id: t.id, spark: s.id, size, at: now + 5 })
    else open(t, s.id, size)
  }
  for (let k = want.length - 1; k >= 0; k--) {
    const w = want[k]
    if (now < w.at) continue
    want.splice(k, 1)
    const t = m.tokens.find((x) => x.id === w.id)
    const s = sparkOf.get(w.spark)
    if (t && live(t) && s && !s.picked && s.over === undefined) open(t, w.spark, w.size) // (a person does not buy into a story that is over)
  }
  for (const s of m.sparks ?? []) {
    const over = !!s.picked || s.over !== undefined
    // The coin with the most money in it, twelve seconds after the post.
    if (rule === 'rich' && !over && !done.has(s.id) && now - s.time >= 12) {
      done.add(s.id)
      const top = m.tokens.filter((t) => t.spark?.id === s.id && t.status === 'bonding').sort((a, b) => b.mcap - a.mcap)[0]
      if (top) open(top, s.id, sizeOf(s.by.followers))
    }
    if (!over || settled.has(s.id)) continue
    settled.add(s.id)
    // The coin the timeline settled on, bought on the news.
    if (rule === 'news' && s.picked) {
      const t = m.tokens.find((x) => x.id === s.picked!.tokenId)
      if (t && live(t) && m.tokens.filter((x) => x.spark?.id === s.id).length > 1) open(t, s.id, sizeOf(s.by.followers), now + 30)
    }
  }
  // Sell: the post settled (or it is time).
  for (let k = held.length - 1; k >= 0; k--) {
    const h = held[k]
    const s = sparkOf.get(h.spark)
    const over = !s || !!s.picked || s.over !== undefined
    const when = h.sellAt ?? (over ? (rule === 'slow' ? (s?.picked?.time ?? s?.over ?? now) + 2 : now) : h.at + 240)
    if (now < when) continue
    held.splice(k, 1)
    close(h)
  }
}
for (const h of held) close(h)
world.dispose()
if (json) console.log(JSON.stringify({ rule: preset ? `${rule}, no slippage limit` : rule, stake, hours, rows }))
else show(preset ? `${rule}, no slippage limit` : rule, stake, hours, rows)
process.exit(0)
