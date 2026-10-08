// Fair-odds test: does the market itself pay whoever buys what is running?
//   npx tsx scripts/fair-test.ts [hours=6] [warm-up hours=0.5] [--json out.json]   one World with its bots
//   npx tsx scripts/fair-test.ts sum a.json b.json …                               several runs added up
//   npx tsx scripts/fair-test.ts classic [ticks=12000] [seed=4242]                 the classic engine (solo play's default) on its own
//   FAIR_REPO=<another copy of the game> npx tsx scripts/fair-test.ts …            measure that copy instead (read only)
// A paper trader puts $100 (fees included, at what the curve / pool really gives) on simple rules anybody could
// follow with no skill: a coin crossing a line on its curve, a coin whose price is running (on a curve or in a pool),
// a KOL's call, a "trending" event, a coin that has just bonded, a coin that has just crashed, a bot chef's launch. For each rule: how often the coin went on to bond next to the odds its price
// implied, and what the $100 made after 30 s, 1, 2 and 5 minutes and at the end (the coin bonds, dies, or 15 minutes
// pass). A rule that makes money on average is a hole in the market: no rule here should.
// A coin that bonds pays several times the stake, so an average needs thousands of trades to settle: run several
// Worlds at once and add them up (`sum`). Also prints the shape of the market, to read next to `market-report`.
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { MarketState, Token } from '../src/types'

// The game's code: this copy's, or another copy's when FAIR_REPO names its folder (read only: nothing is written there).
const REPO = process.env.FAIR_REPO ?? resolve(import.meta.dirname, '..')
const load = (p: string) => import(pathToFileURL(join(REPO, p)).href)
const { Room } = (await load('server/room.ts')) as typeof import('../server/room')
const { gradPriceNative, startPriceNative } = (await load('src/game/curve.ts')) as typeof import('../src/game/curve')
const { LAUNCHPADS } = (await load('src/data/launchpads.ts')) as typeof import('../src/data/launchpads')
const { quoteBuy, quoteSell, createMarket, setClock, secPerTickOf, tickMarket } = (await load('src/game/marketEngine.ts')) as typeof import('../src/game/marketEngine')
const { nativePrice, tradeFee } = (await load('src/game/tradingEngine.ts')) as typeof import('../src/game/tradingEngine')
const { WORLD_CODE } = (await load('src/net/protocol.ts')) as typeof import('../src/net/protocol')
const { Rng } = (await load('src/utils/rng.ts')) as typeof import('../src/utils/rng')

const HORIZONS = [30, 60, 120, 300]
const END = HORIZONS.length // index of "at the end"
const END_CAP = 900 // seconds: a trade still open then is closed at what it is worth
const LINES = [5, 10, 16, 22, 30, 40, 50, 60, 70, 80, 90]
const EVERY = [22, 40, 60]
const COOKED = [16, 22, 40, 60] // the same lines, for coins somebody cooked (in a World on its own: the bot chefs)
const STAKE = 100
const TRACKED = ['smart', 'kol', 'sniper', 'whale', 'bot'] // kinds of wallet a player can track
const RUNS = ['a curve coin up 25% in half a minute', 'a migrated coin up 10% in a minute', 'a migrated coin up 25% in a minute']
const EVENTS = ['trending', 'viral', 'momentum', 'whale', 'kol', 'smartmoney']

interface Tally { n: number; fair: number; resolved: number; bonded: number; sum: number[]; sq: number[]; won: number[]; cnt: number[] }
interface Totals {
  hours: number
  launches: number
  bonded: number
  crashes: number
  unsealed?: number // coins of the simulated market first seen without their launch block (snipers) in
  bondAges: number[]
  stretch: number[]
  migrated: number[]
  newCol: number[]
  rules: Record<string, Tally>
}
const blank = (): Tally => ({ n: 0, fair: 0, resolved: 0, bonded: 0, sum: HORIZONS.map(() => 0).concat(0), sq: HORIZONS.map(() => 0).concat(0), won: HORIZONS.map(() => 0).concat(0), cnt: HORIZONS.map(() => 0).concat(0) })

const pct = (x: number, d = 1) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(d)}%`
const q = (a: number[], p: number) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : NaN)
const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length)

function run(hours: number, warm: number): Totals {
  const world = new Room(WORLD_CODE, true)
  const w = world as unknown as { tick(): void; market: MarketState; events: { id: number; kind: string; tokenId?: string }[]; wallets: { id: string; style: string; bot?: boolean }[] }
  for (let i = 0; i < warm * 3600; i++) w.tick()
  const heard = new Set(w.events.map((e) => e.id))
  const tot: Totals = { hours, launches: 0, bonded: 0, crashes: 0, unsealed: 0, bondAges: [], stretch: [], migrated: [], newCol: [], rules: {} }
  const tally = (rule: string) => (tot.rules[rule] ??= blank())
  const dice = new Rng(20261007)

  interface Paper { id: string; qty: number; cost: number; at: number; rule: string; done: number; curve: boolean }
  let papers: Paper[] = []
  const paper = (t: Token, m: MarketState, rule: string) => {
    const fee = tradeFee(t, 'buy')
    const b = quoteBuy(t, STAKE * (1 - fee))
    if (!(b.qty > 0) || !(b.used > 0)) return
    const r = tally(rule)
    r.n++
    // The odds a fair price implies: a coin that fails is still worth the bottom of its curve, so the odds of bonding
    // that make the price right are (price − bottom) ÷ (end − bottom).
    if (t.status === 'bonding') r.fair += Math.max(0, (t.price / nativePrice(m, t.chain) - startPriceNative(t.pad)) / (gradPriceNative(t.pad) - startPriceNative(t.pad)))
    papers.push({ id: t.id, qty: b.qty, cost: b.used / (1 - fee), at: m.time, rule, done: 0, curve: t.status === 'bonding' })
  }
  // What the bag fetches, had it really been bought: its coins would be out of the curve / pool on top of everyone
  // else's, so selling them walks the price back down from that much higher (a paper bag quoted against the market
  // as it stands would be sold into coins that were never taken out, and a curve everybody has left would pay
  // nothing for it).
  const worth = (t: Token | undefined, p: Paper) => {
    if (!t) return -1
    const Q = Math.max(1, t.liquidity / 2)
    const T = Q / t.price
    // (A coin that has bonded since: its pool was seeded from the curve as it stood, and the bag is simply sold into it.)
    if (t.status !== 'bonding') return (quoteSell(t, p.qty).usdOut * (1 - tradeFee(t, 'sell'))) / p.cost - 1
    const floor = LAUNCHPADS[t.pad].vTokens - LAUNCHPADS[t.pad].curveTokens // (a curve never has less than this left)
    const left = Math.max(T - p.qty, floor, T * 0.05)
    if (!(left < T)) return (quoteSell(t, p.qty).usdOut * (1 - tradeFee(t, 'sell'))) / p.cost - 1
    return (((Q * (T - left)) / left) * (1 - tradeFee(t, 'sell'))) / p.cost - 1
  }
  const note = (rule: string, i: number, r: number) => {
    const x = tally(rule)
    x.sum[i] += r
    x.sq[i] += r * r
    x.cnt[i]++
    if (r > 0) x.won[i]++
  }

  // What each coin on a curve has done so far.
  interface Seen { last: number; reached: number[]; cooked: number[]; status: string; born: boolean; prices: number[]; crashAt: number; beat: number; hist: number[]; ranAt: number[] }
  const seen = new Map<string, Seen>()
  for (const t of w.market.tokens) seen.set(t.id, { last: t.bondingProgress, reached: LINES.filter((l) => t.bondingProgress >= l).map(() => -1), cooked: [...COOKED], status: t.status, born: false, prices: [], crashAt: -1e9, beat: t.beats?.[0]?.id ?? 0, hist: [], ranAt: [-1e9, -1e9, -1e9] })
  const resolve = (s: Seen, bonded: boolean) => {
    for (const l of s.reached) {
      if (l < 0) continue // (it was past that line before we started watching)
      const r = tally(`first ${l}%`)
      r.resolved++
      if (bonded) r.bonded++
    }
    s.reached = []
  }

  // V2 stage 2 shows each tracked wallet's trades on the chart in its own colour: copying one must not pay either.
  // The first time a wallet with an identity buys a coin (what a player tracking it would see), by the kind of wallet.
  const copied = new Set<string>()
  let styles = new Map<string, string>()
  const n = Math.round(hours * 3600)
  for (let i = 0; i < n; i++) {
    const idBefore = w.market.nextTradeId
    w.tick()
    const m = w.market
    const byId = new Map(m.tokens.map((t) => [t.id, t]))
    for (const t of m.tokens) {
      let s = seen.get(t.id)
      if (!s) {
        s = { last: 0, reached: [], cooked: [], status: t.status, born: true, prices: [], crashAt: -1e9, beat: 0, hist: [], ranAt: [-1e9, -1e9, -1e9] }
        seen.set(t.id, s)
        if (t.status === 'bonding') tot.launches++
        // In a World on its own every coin is the simulated market's: a crowd launch or a bot chef's. Its snipers (and a
        // chef's first readers) must be in before anybody is shown the coin, or being first in is free money.
        if (t.status === 'bonding' && t.sim.flow && !t.sim.flow.sniped) tot.unsealed = (tot.unsealed ?? 0) + 1
      }
      if (t.status === 'bonding') {
        for (const l of LINES) {
          if (s.last < l && t.bondingProgress >= l) {
            if (!s.reached.includes(l) && !s.reached.includes(-l)) {
              s.reached.push(l)
              paper(t, m, `first ${l}%`)
            }
            if (EVERY.includes(l)) paper(t, m, `every ${l}%`)
            if (COOKED.includes(l) && t.creator === 'you' && !s.cooked.includes(l)) { s.cooked.push(l); paper(t, m, `cooked ${l}%`) }
          }
        }
        s.last = t.bondingProgress
        // A crash: a third or more off within three seconds.
        s.prices.push(t.price)
        if (s.prices.length > 4) s.prices.shift()
        if (t.price < s.prices[0] * 0.67 && m.time - s.crashAt > 30) {
          s.crashAt = m.time
          tot.crashes++
          paper(t, m, 'just crashed (a third off in 3 s)')
        }
      }
      if (s.status === 'bonding' && t.status !== 'bonding') {
        const bonded = t.status === 'graduated'
        if (bonded) {
          tot.bonded++
          if (s.born) tot.bondAges.push((m.time - t.createdAt) / 60)
          paper(t, m, 'just bonded')
        }
        resolve(s, bonded)
      }
      s.status = t.status
      // "It is running", read off the price alone: up 25% in half a minute on a curve; up 10%, or 25%, in a minute in a pool.
      if (t.status === 'bonding' || t.status === 'graduated') {
        s.hist.push(t.price)
        if (s.hist.length > 61) s.hist.shift()
        const was = (ago: number) => s.hist[s.hist.length - 1 - ago]
        const run = (k: number, ago: number, up: number, gap: number, rule: string) => {
          if (s.hist.length > ago && t.price >= was(ago) * up && m.time - s.ranAt[k] > gap) { s.ranAt[k] = m.time; paper(t, m, rule) }
        }
        if (t.status === 'bonding') run(0, 30, 1.25, 120, RUNS[0])
        else { run(1, 60, 1.1, 300, RUNS[1]); run(2, 60, 1.25, 300, RUNS[2]) }
      }
      // The game's own signals (and the story's), as its feed shows them.
      const top = t.beats?.[0]?.id ?? 0
      if (top > s.beat && (t.status === 'bonding' || t.status === 'graduated')) {
        for (const b of t.beats ?? []) {
          if (b.id <= s.beat) break
          if (b.src === 'story' && !b.arc && b.kind === 'call') paper(t, m, 'a KOL / channel call')
          else if (b.src === 'story' && !b.arc && b.kind === 'trend') paper(t, m, t.status === 'bonding' ? '"king of the hill" (a curve)' : '"going parabolic" (a pool)')
          else if (b.arc && b.tone === 'up') paper(t, m, 'a story post')
          else if (b.kind === 'bigbuy') paper(t, m, 'a large buy on the feed')
        }
      }
      s.beat = Math.max(s.beat, top)
      if (t.status === 'bonding' || t.status === 'graduated') {
        for (const e of t.tape) {
          if (e.id < idBefore) break
          if (!e.walletId || e.side !== 'buy' || copied.has(`${e.walletId}|${t.id}`)) continue
          copied.add(`${e.walletId}|${t.id}`)
          const who = styles.get(e.walletId) ?? (styles = new Map(w.wallets.map((x) => [x.id, x.bot ? 'bot' : x.style]))).get(e.walletId)
          if (who && TRACKED.includes(who)) paper(t, m, `tracked: ${who}`)
        }
      }
    }
    // The game's own Events tab (switched off in the live game since September, on the suspicion that it was a tip sheet).
    for (const e of w.events) {
      if (heard.has(e.id)) continue
      heard.add(e.id)
      const t = e.tokenId ? byId.get(e.tokenId) : undefined
      if (t && EVENTS.includes(e.kind) && (t.status === 'bonding' || t.status === 'graduated')) paper(t, m, `event: ${e.kind}`)
    }
    // Coins that left the lists without bonding.
    if (i % 20 === 0) for (const [id, s] of seen) if (!byId.has(id)) { if (s.status === 'bonding') resolve(s, false); seen.delete(id) }

    papers = papers.filter((p) => {
      const t = byId.get(p.id)
      while (p.done < HORIZONS.length && m.time - p.at >= HORIZONS[p.done]) note(p.rule, p.done++, worth(t, p))
      // The end: it bonded, it died, it is gone, or time is up.
      if (!t || (p.curve && t.status !== 'bonding') || t.status === 'dead' || t.status === 'rugged' || m.time - p.at >= END_CAP) {
        note(p.rule, END, worth(t, p))
        while (p.done < HORIZONS.length) note(p.rule, p.done++, worth(t, p)) // (what it was worth at the end stands for the later looks)
        return false
      }
      return true
    })

    const live = m.tokens.filter((t) => t.status === 'bonding' || t.status === 'graduated')
    if (dice.chance(0.2) && live.length) {
      const t = dice.pick(live)
      paper(t, m, t.status === 'bonding' ? 'any coin on a curve, any moment' : 'any migrated coin, any moment')
    }
    if (i % 20 === 0) {
      tot.newCol.push(m.tokens.filter((t) => t.status === 'bonding' && t.bondingProgress < 40).length)
      tot.stretch.push(m.tokens.filter((t) => t.status === 'bonding' && t.bondingProgress >= 40).length)
      tot.migrated.push(m.tokens.filter((t) => t.status === 'graduated').length)
    }
  }
  world.dispose()
  return tot
}

function add(a: Totals, b: Totals): Totals {
  const rules: Record<string, Tally> = {}
  for (const k of new Set([...Object.keys(a.rules), ...Object.keys(b.rules)])) {
    const x = a.rules[k] ?? blank()
    const y = b.rules[k] ?? blank()
    const z = (f: 'sum' | 'sq' | 'won' | 'cnt') => x[f].map((v, i) => v + y[f][i])
    rules[k] = { n: x.n + y.n, fair: x.fair + y.fair, resolved: x.resolved + y.resolved, bonded: x.bonded + y.bonded, sum: z('sum'), sq: z('sq'), won: z('won'), cnt: z('cnt') }
  }
  return { hours: a.hours + b.hours, launches: a.launches + b.launches, bonded: a.bonded + b.bonded, crashes: a.crashes + b.crashes, unsealed: (a.unsealed ?? 0) + (b.unsealed ?? 0), bondAges: [...a.bondAges, ...b.bondAges], stretch: [...a.stretch, ...b.stretch], migrated: [...a.migrated, ...b.migrated], newCol: [...a.newCol, ...b.newCol], rules }
}

function report(t: Totals) {
  const ok = (cond: boolean, what: string) => console.log(`${cond ? 'PASS' : 'FAIL'} ${what}`)
  console.log(`THE WORLD WITH ITS BOTS, ${t.hours} h in all`)
  console.log(`  launches ${(t.launches / t.hours).toFixed(0)} an hour; bonded ${(t.bonded / t.hours).toFixed(0)} an hour = ${((100 * t.bonded) / Math.max(1, t.launches)).toFixed(2)}% of launches; minutes to bond: a quarter within ${q(t.bondAges, 0.25).toFixed(1)}, half within ${q(t.bondAges, 0.5).toFixed(1)}, three quarters within ${q(t.bondAges, 0.75).toFixed(1)}`)
  console.log(`  New column ${avg(t.newCol).toFixed(0)} coins on average; Final Stretch ${avg(t.stretch).toFixed(1)} (${q(t.stretch, 0.05)} to ${q(t.stretch, 0.95)}, empty ${((100 * t.stretch.filter((x) => x === 0).length) / Math.max(1, t.stretch.length)).toFixed(0)}% of the time); migrated ${avg(t.migrated).toFixed(0)}; crashes on a curve (a third off in 3 s): ${(t.crashes / t.hours).toFixed(0)} an hour`)

  console.log('\n  how far launches get, and how often a coin that got there went on to bond (next to the most a fair price allows: the odds if a coin that fails were worth only the bottom of its curve; one that keeps part of its price bonds less often than that)')
  for (const l of LINES) {
    const r = t.rules[`first ${l}%`]
    if (!r?.n) continue
    console.log(`    reached ${String(l).padStart(2)}% of the curve: ${((100 * r.n) / Math.max(1, t.launches)).toFixed(1).padStart(5)}% of launches; of those ${((100 * r.bonded) / Math.max(1, r.resolved)).toFixed(1).padStart(5)}% bonded (a fair price allows ${((100 * r.fair) / r.n).toFixed(1).padStart(5)}%)`)
  }

  const head = `    ${'rule'.padEnd(36)} ${'trades'.padStart(7)}  ${[...HORIZONS.map((h) => (h < 60 ? `${h} s` : `${h / 60} min`)), 'the end'].map((x) => x.padStart(22)).join('')}`
  console.log(`\n  $${STAKE} on a rule anybody can follow: what it made on average after fees (± is how far chance alone can move it), and how often it won`)
  console.log(head)
  const stats = (r: Tally, i: number) => {
    const n = Math.max(1, r.cnt[i])
    const mean = r.sum[i] / n
    const se = Math.sqrt(Math.max(0, r.sq[i] / n - mean * mean) / n)
    return { mean, se, won: r.won[i] / n, n: r.cnt[i] }
  }
  const order = [...LINES.map((l) => `first ${l}%`), ...EVERY.map((l) => `every ${l}%`), ...COOKED.map((l) => `cooked ${l}%`), ...RUNS, ...TRACKED.map((k) => `tracked: ${k}`), 'just bonded', 'just crashed (a third off in 3 s)', 'a KOL / channel call', '"king of the hill" (a curve)', '"going parabolic" (a pool)', ...EVENTS.map((k) => `event: ${k}`), 'a large buy on the feed', 'a story post', 'any coin on a curve, any moment', 'any migrated coin, any moment']
  const label = (k: string) => (k.startsWith('tracked: ') ? `copying a ${k.slice(9) === 'bot' ? 'World bot' : k.slice(9) === 'smart' ? 'smart-money wallet' : k.slice(9) === 'kol' ? 'KOL' : k.slice(9)}'s first buy` : k.startsWith('event: ') ? `the Events tab says "${k.slice(7)}"` : k.startsWith('first ') ? `its curve first reaches ${k.slice(6)}` : k.startsWith('every ') ? `its curve crosses ${k.slice(6)} (every time)` : k.startsWith('cooked ') ? `a bot chef's coin first reaches ${k.slice(7)}` : k)
  for (const k of order) {
    const r = t.rules[k]
    if (!r?.n) continue
    console.log(`    ${label(k).padEnd(36)} ${String(r.n).padStart(7)}  ${[...HORIZONS.map((_, i) => i), END].map((i) => { const s = stats(r, i); return `${pct(s.mean)} ±${(200 * s.se).toFixed(0)} (${(100 * s.won).toFixed(0)}%)`.padStart(22) }).join('')}`)
  }

  // The verdict. A hole is a rule whose average is clearly above what chance and fees explain: more than +3% even
  // after taking two standard errors off. A rule with too few trades to judge is said to be so.
  console.log('')
  const holes: string[] = []
  const thin: string[] = []
  for (const k of order) {
    if (k.startsWith('any ')) continue
    const r = t.rules[k]
    if (!r?.n) continue
    if (r.n < 400) { thin.push(`${label(k)} (${r.n})`); continue }
    const worst = Math.max(...[...HORIZONS.map((_, i) => i), END].map((i) => { const s = stats(r, i); return s.mean - 2 * s.se }))
    if (worst > 0.03) holes.push(`${label(k)} (at least ${pct(worst)})`)
  }
  if (thin.length) console.log(`  too few trades to judge: ${thin.join(', ')}`)
  ok(holes.length === 0, holes.length ? `rules that make money on average: ${holes.join('; ')}` : 'no rule here makes money on average: the market does not pay for buying what is running')
  ok((t.unsealed ?? 0) === 0, `every coin of the simulated market is first seen with its launch block in: ${t.unsealed ?? 0} of ${t.launches} were not`)
  // And is the price fair where it matters most: a coin's odds of bonding from the middle of its curve.
  const odds = [22, 40, 60, 80].map((l) => { const r = t.rules[`first ${l}%`]; return r?.resolved ? { l, got: r.bonded / r.resolved, fair: r.fair / r.n, n: r.resolved } : null }).filter((x) => x && x.n >= 100) as { l: number; got: number; fair: number; n: number }[]
  ok(odds.length > 0 && odds.every((o) => o.got <= o.fair * 1.25 + 0.01), `a coin bonds no more often than its price allows: ${odds.map((o) => `from ${o.l}% ${(100 * o.got).toFixed(1)}% (a fair price allows ${(100 * o.fair).toFixed(1)}%)`).join(', ')}`)
}

/**
 * The classic engine on its own (solo play's default: 6 simulated seconds a tick, every coin moved by the regime
 * model), with its events, tracked wallets, their posts and the stories: the same kind of paper trades.
 */
async function classic(ticks: number, seed: number) {
  const { rollEvents } = (await load('src/game/eventEngine.ts')) as typeof import('../src/game/eventEngine')
  const { createWallets, tickWallets } = (await load('src/game/walletEngine.ts')) as typeof import('../src/game/walletEngine')
  const { tickSocial } = (await load('src/game/socialEngine.ts')) as typeof import('../src/game/socialEngine')
  // (A copy of the game from before V2 has no stories.)
  const tickStories = await load('src/game/storyEngine.ts').then((x) => (x as typeof import('../src/game/storyEngine')).tickStories, () => null)
  let m = createMarket(seed, 1_760_000_000, 'classic')
  setClock(secPerTickOf(m))
  let wallets = createWallets(new Rng((m.seed ^ 0xa11ce) >>> 0))
  interface Paper { id: string; qty: number; cost: number; at: number; rule: string; done: number; curve: boolean }
  let open: Paper[] = []
  const rules: Record<string, Tally> = {}
  const tally = (rule: string) => (rules[rule] ??= blank())
  const worth = (t: Token | undefined, p: Paper) => {
    if (!t) return -1
    const Q = Math.max(1, t.liquidity / 2)
    const T = Q / t.price
    const plain = (quoteSell(t, p.qty).usdOut * (1 - tradeFee(t, 'sell'))) / p.cost - 1
    if (t.status !== 'bonding') return plain
    const left = Math.max(T - p.qty, LAUNCHPADS[t.pad].vTokens - LAUNCHPADS[t.pad].curveTokens, T * 0.05)
    return left < T ? (((Q * (T - left)) / left) * (1 - tradeFee(t, 'sell'))) / p.cost - 1 : plain
  }
  const paper = (t: Token, rule: string) => {
    const fee = tradeFee(t, 'buy')
    const b = quoteBuy(t, STAKE * (1 - fee))
    if (!(b.qty > 0) || !(b.used > 0)) return
    tally(rule).n++
    open.push({ id: t.id, qty: b.qty, cost: b.used / (1 - fee), at: m.time, rule, done: 0, curve: t.status === 'bonding' })
  }
  const seen = new Map<string, { last: number; reached: number[]; status: string; hist: number[]; ranAt: number }>()
  for (const t of m.tokens) seen.set(t.id, { last: 100, reached: [], status: t.status, hist: [], ranAt: -1e9 })
  const dice = new Rng(20261007)
  let launches = 0
  let bonded = 0
  let live = 0
  for (let i = 0; i < ticks; i++) {
    const rng = new Rng(m.seed)
    const before = m
    const held = new Map<string, number>()
    for (const w of wallets) for (const [id, p] of Object.entries(w.positions)) held.set(id, (held.get(id) ?? 0) + p.qty)
    const r = tickMarket(m, rng, { rugMult: 1, protectedIds: new Set(), held })
    m = r.market
    const e2 = rollEvents(m, rng)
    const wr = tickWallets(wallets, m, rng)
    wallets = wr.wallets
    const posts = tickSocial(m, rng, wr.actions, [...r.events, ...e2])
    if (tickStories) tickStories(m, { before, events: [...r.events, ...e2], actions: wr.actions, posts, wallets })
    m.seed = rng.s
    const byId = new Map(m.tokens.map((t) => [t.id, t]))
    for (const t of m.tokens) {
      let s = seen.get(t.id)
      if (!s) {
        s = { last: 0, reached: [], status: t.status, hist: [], ranAt: -1e9 }
        seen.set(t.id, s)
        if (t.status === 'bonding') launches++
      }
      if (t.status === 'bonding') {
        for (const l of [22, 40, 60, 80]) if (s.last < l && t.bondingProgress >= l && !s.reached.includes(l)) { s.reached.push(l); paper(t, `first ${l}%`) }
        s.last = t.bondingProgress
      }
      if (s.status === 'bonding' && t.status === 'graduated') { bonded++; paper(t, 'just bonded') }
      s.status = t.status
      if (t.status === 'bonding' || t.status === 'graduated') {
        // "It is running": up a quarter or more over the last five ticks (half a minute).
        s.hist.push(t.price)
        if (s.hist.length > 6) s.hist.shift()
        if (s.hist.length === 6 && t.price > s.hist[0] * 1.25 && m.time - s.ranAt > 120) { s.ranAt = m.time; paper(t, t.status === 'bonding' ? RUNS[0] : 'a migrated coin up 25% in half a minute') }
      }
    }
    for (const e of [...r.events, ...e2]) {
      const t = e.tokenId ? byId.get(e.tokenId) : undefined
      if (t && EVENTS.includes(e.kind) && (t.status === 'bonding' || t.status === 'graduated')) paper(t, `event: ${e.kind}`)
    }
    const liveNow = m.tokens.filter((t) => t.status === 'bonding' || t.status === 'graduated')
    live += liveNow.length
    if (dice.chance(0.5) && liveNow.length) { const t = dice.pick(liveNow); paper(t, t.status === 'bonding' ? 'any coin on a curve, any moment' : 'any migrated coin, any moment') }
    open = open.filter((p) => {
      const t = byId.get(p.id)
      const note = (k: number, v: number) => { const x = tally(p.rule); x.sum[k] += v; x.sq[k] += v * v; x.cnt[k]++; if (v > 0) x.won[k]++ }
      while (p.done < HORIZONS.length && m.time - p.at >= HORIZONS[p.done]) note(p.done++, worth(t, p))
      if (!t || (p.curve && t.status !== 'bonding') || t.status === 'dead' || t.status === 'rugged' || m.time - p.at >= END_CAP) {
        const v = worth(t, p)
        note(END, v)
        while (p.done < HORIZONS.length) note(p.done++, v)
        return false
      }
      return true
    })
  }
  const label = (k: string) => (k.startsWith('event: ') ? `the Events tab says "${k.slice(7)}"` : k.startsWith('first ') ? `its curve first reaches ${k.slice(6)}` : k)
  console.log(`THE CLASSIC ENGINE, ${ticks} ticks (${((ticks * secPerTickOf(m)) / 3600).toFixed(1)} h of market time, seed ${seed}): ${launches} launches, ${bonded} bonded, ${(live / ticks).toFixed(0)} coins trading on average`)
  console.log(`\n  $${STAKE} on a rule anybody can follow: what it made on average after fees (± is how far chance alone can move it), and how often it won`)
  console.log(`    ${'rule'.padEnd(40)} ${'trades'.padStart(7)}  ${[...HORIZONS.map((h) => (h < 60 ? `${h} s` : `${h / 60} min`)), 'the end'].map((x) => x.padStart(22)).join('')}`)
  const holes: string[] = []
  for (const k of Object.keys(rules).sort()) {
    const r = rules[k]
    const cells = [...HORIZONS.map((_, i) => i), END].map((i) => {
      const n = Math.max(1, r.cnt[i])
      const mean = r.sum[i] / n
      const se = Math.sqrt(Math.max(0, r.sq[i] / n - mean * mean) / n)
      return { mean, se, won: r.won[i] / n }
    })
    console.log(`    ${label(k).padEnd(40)} ${String(r.n).padStart(7)}  ${cells.map((c) => `${pct(c.mean)} ±${(200 * c.se).toFixed(0)} (${(100 * c.won).toFixed(0)}%)`.padStart(22)).join('')}`)
    const worst = Math.max(...cells.map((c) => c.mean - 2 * c.se))
    if (!k.startsWith('any ') && r.n >= 200 && worst > 0.03) holes.push(`${label(k)} (at least ${pct(worst)})`)
  }
  console.log('')
  console.log(`${holes.length ? 'FAIL' : 'PASS'} ${holes.length ? `rules that make money on average on the classic engine: ${holes.join('; ')}` : 'on the classic engine too, no rule here makes money on average (rules with 200 trades or more)'}`)
}

const args = process.argv.slice(2)
if (args[0] === 'classic') {
  await classic(Number(args[1] ?? 12000), Number(args[2] ?? 4242))
} else if (args[0] === 'sum') {
  report(args.slice(1).map((f) => JSON.parse(readFileSync(f, 'utf8')) as Totals).reduce(add))
} else {
  const json = args.indexOf('--json')
  const out = json >= 0 ? args[json + 1] : null
  const nums = args.filter((_, i) => json < 0 || (i !== json && i !== json + 1)).map(Number)
  const t = run(nums[0] ?? 6, nums[1] ?? 0.5)
  if (out) writeFileSync(out, JSON.stringify(t))
  else report(t)
}
process.exit(0)
