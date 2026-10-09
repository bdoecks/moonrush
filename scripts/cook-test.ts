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
// ── Only the wallet that deployed a coin is its dev ──────────────────────────
{
  type Acc = { id: string; positions: Record<string, { qty: number }> }
  const me = () => (w as unknown as { members: Map<string, { wallet: { accounts: Acc[] } }> }).members.get('u-chef')!
  const now = Date.now()
  w.handle('u-chef', { t: 'layout', seq: 10, layout: { accounts: [{ id: 'w-main', name: 'Main', emoji: '🟢', createdAt: now }, { id: 'w-dev', name: 'Dev 1', emoji: '🧑‍💻', createdAt: now }, { id: 'w-side', name: 'Side', emoji: '🔵', createdAt: now }], active: ['w-main'] } })
  ok(me().wallet.accounts.length === 3, 'the player has a main, a dev and a side wallet')
  for (const id of ['w-dev', 'w-side']) w.handle('u-chef', { t: 'op', seq: 11, op: { kind: 'swap', from: 'usd', to: 'sol', amount: 3000, walletId: id } })
  for (let i = 0; i < 31; i++) w.tick() // (the kitchen cools down between launches)
  const c = cookToken(world.market, new Rng(991), spec('DEVONLY', 1))
  w.handle('u-chef', { t: 'cook', seq: 12, ref: 12, token: c.token, money: { devWallet: 'w-dev', devBuy: 1, marketing: 0, style: 'hyped' } })
  const coin = () => w.market.tokens.find((t) => t.id === c.token.id) as unknown as { devPct: number; hype: number; status: string }
  const qty = (id: string) => me().wallet.accounts.find((x) => x.id === id)?.positions[c.token.id]?.qty ?? 0
  w.tick()
  const dev0 = coin().devPct
  ok(qty('w-dev') > 0 && qty('w-main') === 0 && Math.abs(dev0 - (qty('w-dev') / 1e9) * 100) < 0.05, `the dev buy is in the dev wallet, and the coin shows it as the dev's share (${dev0.toFixed(2)}%)`)
  w.handle('u-chef', { t: 'order', seq: 13, ref: 13, order: { side: 'buy', tokenId: c.token.id, walletIds: ['w-side'], usdEach: 300 } })
  for (let i = 0; i < 3; i++) w.tick()
  ok(qty('w-side') > 0 && Math.abs(coin().devPct - dev0) < 0.05, `a buy from the side wallet is not the dev buying: the dev's share stays ${coin().devPct.toFixed(2)}%`)
  const hype0 = coin().hype
  w.handle('u-chef', { t: 'order', seq: 14, ref: 14, order: { side: 'sell', tokenId: c.token.id, legs: [{ walletId: 'w-side', qty: qty('w-side') }] } })
  ok(qty('w-side') === 0 && coin().hype === hype0, 'selling the side wallet out is not a dev sell (the coin loses none of its crowd for it)')
  w.handle('u-chef', { t: 'order', seq: 15, ref: 15, order: { side: 'sell', tokenId: c.token.id, legs: [{ walletId: 'w-dev', qty: qty('w-dev') / 2 }] } })
  ok(coin().hype < hype0, 'selling from the dev wallet is (half the bag: the coin loses some of its crowd)')
}
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

// ── The owner's `cooking` switch ─────────────────────────────────────────────
{
  const shut = new Room('SHUTT')
  const sr = shut as unknown as R
  clearInterval(sr.timer)
  shut.join(sock(), { t: 'hello', name: 'Host', avatar: '🐸', level: 5, playerId: 'p1' })
  sr.handle('p1', { t: 'start', mode: 'practice', durationTicks: null, engine: 'realistic' })
  const cash = () => (shut as unknown as { members: Map<string, { wallet: { cash: number } }> }).members.get('p1')!.wallet.cash
  const before = cash()
  Room.playersCook = false
  const refused = cook(sr, shut, 'p1', 'SHUTA', 0, 2)
  ok(!refused && cash() === before, 'with the cooking switch off the server refuses a launch, and charges nothing')
  Room.playersCook = true
  ok(!!cook(sr, shut, 'p1', 'SHUTB', 0, 3), 'with it on again the same launch goes through')
  shut.dispose()
}

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
