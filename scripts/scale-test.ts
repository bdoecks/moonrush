// Sending each World player less (V2 stage 5): the tick carries no chart points and only real players' trades; each
// player gets the chart and tape of the coin they have open; a coin's hidden state and the dice never leave the server.
//   npx tsx scripts/scale-test.ts [minutes of World=10] [warm-up minutes=30]
import { Room } from '../server/room'
import { candleStore, rebuildCandles, SUPPLY } from '../src/game/marketEngine'
import { WORLD_CODE, type ServerMsg } from '../src/net/protocol'
import type { MarketState, TapeTrade } from '../src/types'

// (STORY_MARKET=1: the same with the story market on, as it is once the owner's switch is.)
if (process.env.STORY_MARKET === '1') Room.storyMarket = true

const minutes = Number(process.argv[2] ?? 10)
const warm = Number(process.argv[3] ?? 30)
let failed = 0
const ok = (cond: boolean, what: string) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${what}`); if (!cond) failed++ }
type Box = { msgs: ServerMsg[]; bytes: number }
const sock = (box: Box) => ({ readyState: 1, send: (d: string | Buffer) => { box.bytes += d.length; box.msgs.push(JSON.parse(String(d))) }, close() {} }) as never
type R = { tick(): void; handle(pid: string, m: unknown): void; market: MarketState }

const world = new Room(WORLD_CODE, true)
const w = world as unknown as R
for (let i = 0; i < warm * 60; i++) w.tick()

// Two players: one looks at a coin, one looks at nothing in particular.
const a: Box = { msgs: [], bytes: 0 }
const b: Box = { msgs: [], bytes: 0 }
world.join(sock(a), { t: 'hello', name: 'Looker', avatar: '🐸', level: 1, playerId: 'u-look', verified: true })
world.join(sock(b), { t: 'hello', name: 'Idler', avatar: '🦉', level: 1, playerId: 'u-idle', verified: true })
const welcome = a.msgs.find((m) => m.t === 'welcome') as Extract<ServerMsg, { t: 'welcome' }>
ok(!!welcome && welcome.market.seed === 0 && !('sparkSim' in welcome.market) && welcome.market.tokens.every((t) => JSON.stringify(t.sim) === '{"archetype":"chaotic"}'), "the welcome carries no coin's hidden state (every coin shows the same stand-in), not the market's dice, and no post's hidden side")

// A joining browser sketches every coin's chart from the welcome until the real one is fetched: with the hidden state
// held back that sketch must still work. (Stripping it bare once crashed the join.)
{
  const kept = new Map(candleStore)
  let threw = ''
  try { rebuildCandles(JSON.parse(JSON.stringify(welcome.market))) } catch (e) { threw = String(e) }
  candleStore.clear()
  for (const [k, v] of kept) candleStore.set(k, v)
  ok(!threw, `a joining browser can build its opening charts from the welcome${threw ? `: ${threw.slice(0, 80)}` : ''}`)
}

// The busiest coin on a curve is the one to open.
const busy = [...w.market.tokens].filter((t) => t.status === 'bonding' || t.status === 'graduated').sort((x, y) => y.volume - x.volume)[0]
w.handle('u-look', { t: 'candles', tokenId: busy.id })
const answer = [...a.msgs].reverse().find((m) => m.t === 'candles') as Extract<ServerMsg, { t: 'candles' }>
ok(!!answer?.candles && Array.isArray(answer.tape) && answer.tape.length === busy.tape.length, `opening a coin brings its chart and its whole tape (${answer?.tape?.length} trades)`)

// What a browser would hold for that coin's tape, built the way the game builds it.
const merge = (x: TapeTrade[], y: TapeTrade[]) => { const seen = new Set<number>(); return [...x, ...y].filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true))).sort((p, q) => q.id - p.id).slice(0, 40) }
let lookerTape: TapeTrade[] = answer?.tape ?? []
let idlerTape: TapeTrade[] = []
a.msgs.length = 0; b.msgs.length = 0; a.bytes = 0; b.bytes = 0
let points = 0, anon = 0, focusMsgs = 0, focusPts = 0, wrongOrder = 0, simSent = 0, mcapDiffs = 0, badMcap = 0, ticks = 0, hidden = 0
let pendingFocus: TapeTrade[] = []
const price = new Map<string, number>()
const n = minutes * 60
for (let i = 0; i < n; i++) {
  w.tick()
  for (const m of a.msgs) {
    if (m.t === 'focus') {
      focusMsgs++
      if (m.tokenId !== busy.id) wrongOrder++
      focusPts += m.points?.length ?? 0
      pendingFocus = m.tape ?? []
    } else if (m.t === 'tick') {
      ticks++
      points += Object.keys(m.points).length
      if (('seed' in m.market && (m.market as { seed?: number }).seed) || 'sparkSim' in m.market) hidden++
      for (const d of m.market.tokens) {
        anon += (d.tape ?? []).filter((e) => !e.pid && !e.addr).length
        if (d.sim && JSON.stringify(d.sim) !== '{"archetype":"chaotic"}') simSent++
        if (d.price !== undefined) price.set(d.id, d.price)
        if (d.mcap !== undefined && d.price !== undefined && Math.abs(d.mcap / (d.price * SUPPLY) - 1) > 1e-4) badMcap++
        if (d.mcap !== undefined && d.name === undefined) mcapDiffs++
        if (d.id === busy.id) lookerTape = merge(pendingFocus, merge(d.tape ?? [], lookerTape))
      }
      pendingFocus = []
    }
  }
  for (const m of b.msgs) if (m.t === 'tick') for (const d of m.market.tokens) if (d.id === busy.id) idlerTape = merge(d.tape ?? [], idlerTape)
  if (b.msgs.some((m) => m.t === 'focus')) wrongOrder++
  a.msgs.length = 0
  b.msgs.length = 0
}
const live = w.market.tokens.find((t) => t.id === busy.id)
ok(points === 0 && anon === 0, `a World tick carries no chart points, and of the tapes only real players' trades (${points} points, ${anon} simulated trades in ${ticks} ticks)`)
ok(focusMsgs > 0 && focusPts > 0 && wrongOrder === 0, `the player with a coin open is sent that coin's chart points and trades, and nobody else is (${focusMsgs} messages, ${focusPts} points)`)
ok(!live || (lookerTape.length > 0 && lookerTape.map((e) => e.id).join() === live.tape.slice(0, lookerTape.length).map((e) => e.id).join()), live ? `their tape of that coin is the server's, trade for trade (${lookerTape.length} trades)` : 'the coin they had open was delisted during the test (nothing to compare)')
ok(idlerTape.length < lookerTape.length || !live, `a player not looking at it holds only the real players' trades on it (${idlerTape.length})`)
ok(simSent === 0 && hidden === 0, "no tick carries a coin's hidden state or the dice")
ok(mcapDiffs === 0 && badMcap === 0, 'a market cap is not sent with a price change (it is the price times the supply), and where it is sent it agrees')
const kb = b.bytes / 1024 / Math.max(1, n)
const kbA = a.bytes / 1024 / Math.max(1, n)
ok(kb < 34, `a player receives ${kb.toFixed(1)} KB a second before compression (it was about 43 with the same World; the budget is 34)`)
ok(kbA - kb < 6, `having a busy coin open costs ${(kbA - kb).toFixed(1)} KB a second more`)
world.dispose()
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed')
process.exit(0)
