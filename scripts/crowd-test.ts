// Crowd check: the 100 World bots that play from the market brain (server/brainBots.ts). Runs the World for simulated
// hours and checks the crowd behaves like the real one it learned from: skill shows in results, devs dump, pile-ons
// stay limited, the original 20 bots are retired from an old save, and money stays sane.
//   npx tsx scripts/crowd-test.ts 3      # hours
import { Room } from '../server/room'
import { WORLD_CODE, type ServerMsg } from '../src/net/protocol'
import { ALL_BOTS, BOT_ROSTER } from '../server/bots'
import { BRAIN, groupFor, PILE_ON_LIMIT } from '../server/brainBots'
import { valuePortfolio } from '../src/game/portfolioEngine'

const hours = Number(process.argv[2] ?? 3)
const ok = (cond: boolean, what: string) => console.log(`${cond ? 'PASS' : 'FAIL'} ${what}`)
type W = { cash: number; startBalance: number; trades: { side: string; tokenId: string; time: number; value: number }[]; accounts?: { balances: Record<string, number>; positions: Record<string, { qty: number }> }[] }
type M = { info: { name: string; online: boolean; bot?: boolean; equity: number }; wallet?: W; brain?: { busts: number; plans?: object }; pnlCarry?: number }
type R = { tick(): void; members: Map<string, M>; wallets: { id: string; bot?: boolean }[]; market: { tick: number; time: number; tokens: { id: string; price: number; mcap: number; liquidity: number; status: string; creatorId?: string }[] }; snapshot(): unknown; dispose(): void }

ok(!!BRAIN, `the market brain is loaded (${BRAIN ? `${Object.keys(BRAIN.groups).length} groups, learned ${BRAIN.learnedAt.slice(0, 10)}` : 'missing'})`)
ok(ALL_BOTS.length === 100 && new Set(ALL_BOTS.map((b) => b.id)).size === 100 && ALL_BOTS.every((b) => b.name.endsWith('🤖')), '100 bots, unique ids, all labelled 🤖')
ok(BOT_ROSTER.filter((b) => b.style !== 'chef').every((b) => !!groupFor(b.style, b.tier)), 'every trading bot has a brain group for its style')

// An old save with the original 20 bots in it: they must leave, wallets and all.
const old = new Room(WORLD_CODE, true) as unknown as R
const snap = JSON.parse(JSON.stringify(old.snapshot())) as { members: { info: { id: string; bot?: boolean } }[]; wallets: { id: string; bot?: boolean }[] }
old.dispose()
for (const id of ['bot-sam', 'bot-wendy', 'bot-carl']) {
  snap.members.push({ info: { id, name: id, avatar: '🤖', level: 9, online: true, equity: 1e4, startEquity: 1e4, trades: 0, wins: 0, bot: true }, protect: [], wallet: undefined } as never)
  snap.wallets.push({ id, bot: true } as never)
}
const world = Room.restore(snap as never, null) as unknown as R
;(world as unknown as { ensureBots(): void }).ensureBots()
ok(!['bot-sam', 'bot-wendy', 'bot-carl'].some((id) => world.members.has(id) || world.wallets.some((x) => x.id === id)), 'the original bots are retired from an old save, public wallets too')

const box: ServerMsg[] = []
;(world as unknown as Room).join({ readyState: 1, send: (d: string) => box.push(JSON.parse(d)), close() {} } as never, { t: 'hello', name: 'Watcher', avatar: '👀', level: 1, playerId: 'g-watch', verified: false })

// Run, watching every bot sell that knocks a coin's price down hard, per coin per 10 seconds.
const bigDrops = new Map<string, number[]>()
let worstPile = 0
let devDumps = 0
let bad = ''
const t0 = Date.now()
for (let i = 0; i < hours * 3600; i++) {
  world.tick()
  const tick = world.market.tick
  for (const m of box.splice(0)) {
    if (m.t !== 'tick') continue
    for (const e of m.events) if (e.kind === 'devsell') devDumps++
    for (const a of m.actions) {
      if (!a.walletId.startsWith('bot-') || a.side !== 'sell') continue
      const t = world.market.tokens.find((x) => x.id === a.tokenId)
      if (!t || !(a.usd >= t.liquidity * 0.1)) continue
      const r = [...(bigDrops.get(t.id) ?? []).filter((at) => tick - at < 10), tick]
      bigDrops.set(t.id, r)
      worstPile = Math.max(worstPile, r.length)
    }
  }
  if (i % 300 === 0) {
    for (const [id, m] of world.members) {
      const w = m.wallet
      if (!m.info.bot || !w) continue
      const nums = [w.cash, ...(w.accounts ?? []).flatMap((a) => [...Object.values(a.balances), ...Object.values(a.positions).map((p) => p.qty)])]
      if (nums.some((n) => !Number.isFinite(n) || n < -1e-6)) bad ||= `${id} at tick ${tick}: ${JSON.stringify(nums.filter((n) => !Number.isFinite(n) || n < -1e-6))}`
    }
  }
  if (i % 3600 === 3599) console.log(`  hour ${(i + 1) / 3600}: ${[...world.members.values()].filter((m) => m.info.bot && m.info.online).length} bots online · ${((Date.now() - t0) / (i + 1)).toFixed(1)} ms/tick`)
}
const msPerTick = (Date.now() - t0) / (hours * 3600)

// Results by skill level: return on everything the bot ever had (busts count as losses).
const byId = new Map(world.market.tokens.map((t) => [t.id, t]))
const ret: Record<string, number[]> = {}
let fills = 0
for (const spec of BOT_ROSTER) {
  const m = world.members.get(spec.id)
  if (!m?.wallet || spec.style === 'chef') continue
  fills += m.wallet.trades.length
  const eq = valuePortfolio(m.wallet as never, byId as never, world.market as never).equity
  const r = (eq + (m.pnlCarry ?? 0)) / 10_000 - 1
  ;(ret[spec.tier] ??= []).push(r)
}
const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0 }
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
console.log(`  results after ${hours}h by level (median / average): ${['pro', 'good', 'average', 'bad', 'degen'].map((t) => `${t} ${(med(ret[t] ?? []) * 100).toFixed(1)}% / ${(mean(ret[t] ?? []) * 100).toFixed(1)}%`).join(' · ')}`)
ok(fills > hours * 300, `the crowd traded: ${fills} fills in ${hours}h`)
ok(mean(ret.pro ?? []) > mean(ret.degen ?? []), `pros ended ahead of degens on average (${(mean(ret.pro ?? []) * 100).toFixed(1)}% vs ${(mean(ret.degen ?? []) * 100).toFixed(1)}%)`)
ok(devDumps >= hours * 2, `devs dumped their own coins: ${devDumps} dev sells`)
ok(worstPile <= PILE_ON_LIMIT + 1, `big bot sells on one coin within 10s never went past the limit (worst ${worstPile}, limit ${PILE_ON_LIMIT} planned + 1 old-rule)`)
ok(!bad, bad ? `impossible money: ${bad}` : 'no bot wallet ever held an impossible amount')
ok(msPerTick < 50, `the World stays fast with the crowd: ${msPerTick.toFixed(1)} ms per 1-second tick`)
world.dispose()
process.exit(0)
