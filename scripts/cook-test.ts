// Cooking in the World plays by the simulated market's rules (what it pays is measured by scripts/cook-report.ts).
//   npx tsx scripts/cook-test.ts
import { Room } from '../server/room'
import { cookToken, createMarket, launchBlock, SNIPE_AHEAD } from '../src/game/marketEngine'
import { Rng } from '../src/utils/rng'
import { WORLD_CODE, type ServerMsg } from '../src/net/protocol'

let failed = 0
const ok = (cond: boolean, what: string) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${what}`)
  if (!cond) failed++
}
type Tok = { id: string; status: string; snipers: number; holders: number; volume: number; sim: { flow?: { botDev?: boolean; sniped?: boolean; q: number } } }
type R = { tick(): void; handle(pid: string, m: unknown): void; market: { tokens: Tok[] }; timer: ReturnType<typeof setInterval> }
const sock = () => ({ readyState: 1, send: (_: string) => {}, close() {} }) as never
const spec = (ticker: string, devBuy: number) => ({ name: `${ticker} Coin`, ticker, emoji: '🧪', hue: 100, description: 'A coin made with care for this very test.', chain: 'sol', pad: 'pump', tax: { buy: 0, sell: 0 }, devBuy, marketing: 0, narrative: 'dogs', socials: { x: true, tg: true, web: true }, style: 'hyped' }) as never

// ── The World ────────────────────────────────────────────────────────────────
const world = new Room(WORLD_CODE, true)
const w = world as unknown as R
clearInterval(w.timer)
for (let i = 0; i < 120; i++) w.tick()
world.join(sock(), { t: 'hello', name: 'Chef', avatar: '🍳', level: 5, playerId: 'u-chef', verified: true })
w.tick()
world.grant('u-chef', 50_000, 'usd')
w.handle('u-chef', { t: 'op', seq: 1, op: { kind: 'swap', from: 'usd', to: 'sol', amount: 20_000, walletId: 'w-main' } })
const cook = (r: R, room: Room, pid: string, ticker: string, devBuy: number, seq: number) => {
  const c = cookToken(room.market, new Rng(seq * 31 + 7), spec(ticker, devBuy))
  r.handle(pid, { t: 'cook', seq, ref: seq, token: c.token, money: { devWallet: 'w-main', devBuy, marketing: 0, style: 'hyped' } })
  return r.market.tokens.find((t) => t.id === c.token.id)
}
const mine = cook(w, world, 'u-chef', 'FAIRA', 0, 2)
ok(!!mine?.sim.flow?.botDev, "a player's World launch plays by the simulated market's rules")
ok(!!mine?.sim.flow?.sniped, 'its snipers are in before the coin is shown to anybody (nobody but its dev is ahead of them)')
world.dispose()

// ── A friends room keeps the cook's own game ─────────────────────────────────
const room = new Room('COOKS')
const r = room as unknown as R
clearInterval(r.timer)
room.join(sock(), { t: 'hello', name: 'Host', avatar: '🐸', level: 5, playerId: 'p1' })
r.handle('p1', { t: 'start', mode: 'practice', durationTicks: null, engine: 'realistic' })
r.handle('p1', { t: 'op', seq: 1, op: { kind: 'swap', from: 'usd', to: 'sol', amount: 2000, walletId: 'w-main' } })
const theirs = cook(r, room, 'p1', 'ROOMA', 0, 2)
ok(!!theirs?.sim.flow && !theirs.sim.flow.botDev, 'a launch in a friends room is left as it was')
room.dispose()

// ── Snipers pass on a coin whose dev took a big bag ──────────────────────────
const sniped = (aheadPct: number) => {
  let n = 0, usd = 0
  const market = createMarket(4242, undefined, 'realistic')
  for (let i = 0; i < 300; i++) {
    const c = cookToken(market, new Rng(i * 97 + 3), spec(`S${i}`, 0))
    const flow = { ...c.token.sim.flow!, q: 0.6, botDev: true }
    const m = launchBlock({ ...c.market, tokens: c.market.tokens.map((t) => (t.id === c.token.id ? { ...t, sim: { ...t.sim, flow } } : t)) }, c.token.id, new Rng(i * 13 + 1), aheadPct)
    const t = m.tokens.find((x) => x.id === c.token.id)!
    n += t.snipers
    usd += t.volume
  }
  return { n: n / 300, usd: usd / 300 }
}
const none = sniped(0), small = sniped(1), big = sniped(10), huge = sniped(30)
ok(none.n > 6 && none.usd > 300, `a strong launch with no dev bag gets its snipers: ${none.n.toFixed(1)} on average, $${none.usd.toFixed(0)}`)
ok(small.n > none.n * 0.7 && small.n < none.n, `a small dev bag (1% of supply) costs few of them: ${small.n.toFixed(1)}`)
ok(big.n < none.n * 0.15 && huge.n < 0.05, `a big one sends them away: ${big.n.toFixed(2)} at 10% of supply, ${huge.n.toFixed(2)} at 30% (so there is nobody to dump it on)`)
ok(Math.abs(small.n / none.n - Math.exp(-1 / SNIPE_AHEAD)) < 0.08, 'by the rule written down (SNIPE_AHEAD)')
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed')
process.exit(0)
