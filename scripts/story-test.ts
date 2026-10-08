// Story test: a coin's story feed, what it does to trading, and that copying it is not free money.
//   npx tsx scripts/story-test.ts [World hours=2] [warm-up hours=0.5] [A/B hours=3]
// 1. The feed itself, on both engines with no server: every beat is well formed and says where it comes from, the
//    market's own beats are true to the tape, story accounts are the game's invented ones, the story engine's dice are
//    its own, and it never touches a price (everything it does reaches the market as trades).
// 2. What a story hands a follower: the real-time engine twice, once with stories acting on the market and once with
//    the same kind of beats told and nobody acting on them. A paper trader puts $100 on every story beat the moment
//    it shows; the story may not pay them more than the market does anyway.
// 3. The World with its bots: how many stories run, how busy a coin's feed is, what a post and a drama do to trading.
//    (Numbers that go to the owner come from here: the World is not the engine alone.)
// 4. The wire: a browser that only gets the welcome and the ticks ends up with the feed the server holds, and what
//    that costs in bytes.
import { Room } from '../server/room'
import { BOT_ROSTER } from '../server/bots'
import { MID_POSTERS, SMALL_POSTERS } from '../src/data/stories'
import { rollEvents } from '../src/game/eventEngine'
import { createMarket, quoteBuy, quoteSell, secPerTickOf, setClock, tickMarket } from '../src/game/marketEngine'
import { ACCOUNTS, tickSocial } from '../src/game/socialEngine'
import { BEATS_KEPT, mergeBeats, MILESTONES, STORY, tickStories } from '../src/game/storyEngine'
import { tradeFee } from '../src/game/tradingEngine'
import { createWallets, tickWallets } from '../src/game/walletEngine'
import { winVolume } from '../src/game/windows'
import { WORLD_CODE, type TickMsg, type TokenDiff } from '../src/net/protocol'
import { fmtCompact } from '../src/utils/format'
import { Rng } from '../src/utils/rng'
import type { Beat, BeatKind, MarketEngine, MarketState, SimWallet, Token, WalletAction } from '../src/types'

const hours = Number(process.argv[2] ?? 2)
const warm = Number(process.argv[3] ?? 0.5)
const abHours = Number(process.argv[4] ?? 3)
const ok = (cond: boolean, what: string) => console.log(`${cond ? 'PASS' : 'FAIL'} ${what}`)
const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length)
const med = (a: number[]) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : NaN)
const pct = (x: number, d = 1) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(d)}%`
/** Standard error of a mean: how far the average of this many samples can be off by chance. */
const se = (a: number[]) => {
  const m = avg(a)
  return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1) / Math.max(1, a.length))
}
/** A return with the rare giant win cut to +200%: a few coins that bond decide a plain average, and they are the market's doing. */
const cut = (r: number) => Math.min(r, 2)

const MARKET_KINDS = new Set<BeatKind>(['bigbuy', 'bigsell', 'enter', 'exit', 'volume', 'milestone', 'dev', 'warn'])
const STORY_KINDS = new Set<BeatKind>(['post', 'call', 'trend', 'rumor', 'partner', 'news', 'drama', 'fade'])
const HOPEFUL = new Set<BeatKind>(['post', 'call', 'trend', 'rumor', 'partner', 'news'])
const INVENTED = new Set([...SMALL_POSTERS, ...MID_POSTERS].map((p) => p.name).concat(ACCOUNTS.map((a) => a.name)))
const HORIZONS = [30, 60, 120, 300] // seconds a paper trade is held
const hz = (i: number) => (HORIZONS[i] < 60 ? `${HORIZONS[i]} s` : `${HORIZONS[i] / 60} min`)
const STAKE = 100
const LINES = [22, 40, 60] // curve progress lines: what "buy whatever is running" makes with no story to go on

interface Paper { tokenId: string; qty: number; cost: number; at: number; group: string; heat: number; r: number[] }
interface Seen { tokenId: string; id: number; time: number; mcap: number; kind: BeatKind; arc: boolean; vol: number }

/** Watches a market tick by tick: checks every new beat, follows what happens after it, and paper-trades the hopeful ones. */
class Book {
  lastId = 0
  bad: string[] = []
  kinds: Record<string, number> = {}
  srcs: Record<string, number> = {}
  papers: Paper[] = []
  done: Paper[] = []
  open: Seen[] = []
  after: { kind: BeatKind; arc: boolean; move: number; volBefore: number; volAfter: number }[] = []
  jumps: number[] = [] // a story development: how far the price went between the post and its beat reaching the feed
  moves = { due: 0, missing: 0, wrong: 0 }
  trades = { n: 0, off: 0 }
  enters = { n: 0, off: 0 }
  milestones = new Set<string>()
  twice = 0
  storied: number[] = [] // coins with a story running, sampled
  liveCoins: number[] = []
  withBeats: number[] = []
  perCoin = new Map<string, number>() // beats a coin got in all
  told = { beats: 0, seconds: 0 } // on coins with a story running: beats they got, and coin-seconds watched
  life = new Map<string, number>() // seconds each coin with a feed was watched
  progress = new Map<string, number>()
  dice = new Rng(20261006)
  all: Beat[] = []
  seconds = 0
  constructor(readonly exact: boolean, readonly names: Set<string> = INVENTED) {}
  fail(what: string) {
    if (this.bad.length < 8) this.bad.push(what)
    else this.bad.length++
  }
  paper(t: Token, m: MarketState, group: string, heat = 0) {
    const fee = tradeFee(t, 'buy')
    const q = quoteBuy(t, STAKE * (1 - fee))
    if (!(q.qty > 0) || !(q.used > 0)) return
    this.papers.push({ tokenId: t.id, qty: q.qty, cost: q.used / (1 - fee), at: m.time, group, heat, r: [] })
  }
  see(m: MarketState, more?: { actions: WalletAction[]; wallets: SimWallet[] }) {
    const sec = secPerTickOf(m)
    this.seconds += sec
    const byId = new Map(m.tokens.map((t) => [t.id, t]))
    const live = m.tokens.filter((t) => t.status === 'bonding' || t.status === 'graduated')
    for (const t of m.tokens) {
      if (t.sim.story && !t.sim.story.over && (t.status === 'bonding' || t.status === 'graduated')) this.told.seconds += sec
      if (t.beats?.length) this.life.set(t.id, (this.life.get(t.id) ?? 0) + sec)
      // With no story to go on: a coin crossing a line on its curve.
      if (t.status === 'bonding') {
        const p0 = this.progress.get(t.id)
        if (p0 !== undefined) for (const line of LINES) if (p0 < line && t.bondingProgress >= line) this.paper(t, m, `curve crosses ${line}%`)
        this.progress.set(t.id, t.bondingProgress)
      }
      const beats = t.beats
      if (!beats?.length) continue
      if (beats.length > BEATS_KEPT) this.fail(`$${t.ticker} keeps ${beats.length} beats`)
      for (let i = 1; i < beats.length; i++) if (beats[i - 1].id <= beats[i].id) this.fail(`$${t.ticker}: feed is not newest first`)
      for (const b of beats) {
        if (b.id <= this.lastId) continue
        this.all.push(b)
        this.perCoin.set(t.id, (this.perCoin.get(t.id) ?? 0) + 1)
        if (t.sim.story && !t.sim.story.over) this.told.beats++
        this.kinds[b.kind] = (this.kinds[b.kind] ?? 0) + 1
        this.srcs[b.src] = (this.srcs[b.src] ?? 0) + 1
        // Well formed, and honest about where it comes from.
        const want = MARKET_KINDS.has(b.kind) ? 'market' : STORY_KINDS.has(b.kind) ? 'story' : 'trend'
        if (b.src !== want) this.fail(`a ${b.kind} beat says it comes from "${b.src}"`)
        if (!b.text || b.text.length < 6 || b.text.length > 200 || /[{}]|^\[|undefined|NaN/.test(b.text)) this.fail(`bad text: "${b.text}"`)
        // A market fact is stamped with now; a post with when it was made, a few seconds before it shows.
        const late = m.time - b.time
        if (!(b.mcap > 0) || b.seq !== b.id || (b.arc || b.src === 'trend' ? late < 0 || late > Math.max(sec, STORY.seenAfter[1]) : late !== 0)) this.fail(`a ${b.kind} beat with a bad time (${late}s late), market cap or number`)
        if (b.src === 'story' && b.by && !this.names.has(b.by.name)) this.fail(`a story beat by an account that is not one of the game's: ${b.by.name}`)
        if (b.src === 'trend' && !(m.trends && b.text.includes(m.trends.asOf.slice(0, 4)) && m.trends.themes.some((x) => b.text.includes(`"${x.word}"`)))) this.fail(`a theme beat without its source's theme and date: "${b.text}"`)
        // The market's own beats are true.
        if (b.kind === 'bigbuy' || b.kind === 'bigsell') {
          this.trades.n++
          const side = b.kind === 'bigbuy' ? 'buy' : 'sell'
          if (!t.tape.some((e) => e.side === side && Math.abs(e.usd - (b.usd ?? -1)) <= 0.01 + e.usd * 1e-9)) this.trades.off++
        }
        if (b.kind === 'milestone' && b.text.startsWith('Crossed')) {
          const i = MILESTONES.findIndex((x) => b.text === `Crossed ${fmtCompact(x)} market cap`)
          if (i < 0 || b.mcap < MILESTONES[i]) this.fail(`a milestone the coin is not at: "${b.text}" at ${fmtCompact(b.mcap)}`)
          if (this.milestones.has(`${t.id}:${i}`)) this.twice++
          this.milestones.add(`${t.id}:${i}`)
        }
        if (more && (b.kind === 'enter' || b.kind === 'exit')) {
          this.enters.n++
          const names = new Map(more.wallets.map((w) => [w.id, w.name]))
          if (!more.actions.some((a) => a.tokenId === t.id && names.get(a.walletId) === b.by?.name && a.side === (b.kind === 'enter' ? 'buy' : 'sell') && Math.abs(a.usd - (b.usd ?? -1)) < 0.01)) this.enters.off++
        }
        this.open.push({ tokenId: t.id, id: b.id, time: b.time, mcap: b.mcap, kind: b.kind, arc: !!b.arc, vol: winVolume(t, '1m', m.time) })
        if (b.arc && HOPEFUL.has(b.kind)) this.jumps.push(t.mcap / b.mcap - 1)
        if (b.src === 'story' && HOPEFUL.has(b.kind)) this.paper(t, m, b.arc ? `story ${b.kind}` : `other ${b.kind}`, b.heat)
      }
    }
    this.lastId = m.nextBeatId ?? 0
    // A minute on: the beat says what the price did next, and we note what trading did.
    this.open = this.open.filter((o) => {
      if (m.time - o.time < 60) return true
      const t = byId.get(o.tokenId)
      const b = t?.beats?.find((x) => x.id === o.id)
      if (t && b && (t.status === 'bonding' || t.status === 'graduated')) {
        this.moves.due++
        if (b.move === undefined) this.moves.missing++
        else if (this.exact && m.time - o.time < 60 + sec && Math.abs(b.move - (t.mcap / o.mcap - 1)) > 1e-9) this.moves.wrong++
      }
      if (t) this.after.push({ kind: o.kind, arc: o.arc, move: t.mcap / o.mcap - 1, volBefore: o.vol, volAfter: winVolume(t, '1m', m.time) })
      return false
    })
    // Paper trades: sold at each horizon for what the curve / pool really gives, after the fee. A coin that is gone pays nothing.
    this.papers = this.papers.filter((p) => {
      while (p.r.length < HORIZONS.length && m.time - p.at >= HORIZONS[p.r.length]) {
        const t = byId.get(p.tokenId)
        p.r.push(t ? (quoteSell(t, p.qty).usdOut * (1 - tradeFee(t, 'sell'))) / p.cost - 1 : -1)
      }
      if (p.r.length < HORIZONS.length) return true
      this.done.push(p)
      return false
    })
    // The same $100 with nothing to go on: any coin at any moment, and a coin that has a story at any moment.
    if (this.dice.chance(Math.min(1, sec / 10)) && live.length) {
      this.paper(this.dice.pick(live), m, 'any coin, any moment')
      const told = live.filter((t) => t.sim.story && !t.sim.story.over)
      if (told.length) this.paper(this.dice.pick(told), m, 'a coin with a story, any moment')
    }
    if (m.tick % 30 === 0) {
      this.liveCoins.push(live.length)
      this.storied.push(live.filter((t) => t.sim.story && !t.sim.story.over).length)
      this.withBeats.push(live.filter((t) => t.beats?.length).length)
    }
  }
  returns(group: (p: Paper) => boolean) {
    const list = this.done.filter(group)
    return HORIZONS.map((_, i) => list.map((p) => p.r[i]))
  }
  /** Every story development a follower could have bought. */
  story = (p: Paper) => p.group.startsWith('story ')
  table(name: string) {
    console.log(`  ${name}: $${STAKE} in when the beat shows, out after…        ${HORIZONS.map((_, i) => hz(i).padStart(16)).join('')}       (average, and how often it made money)`)
    const row = (label: string, g: (p: Paper) => boolean) => {
      const r = this.returns(g)
      if (!r[0].length) return
      console.log(`    ${label.padEnd(36)} n=${String(r[0].length).padStart(5)}  ${r.map((x) => `${pct(avg(x)).padStart(8)} ${`(${((100 * x.filter((v) => v > 0).length) / x.length).toFixed(0)}%)`.padStart(6)}`).join('  ')}`)
    }
    row('every story beat', this.story)
    for (const k of HOPEFUL) row(`  ${k}`, (p) => p.group === `story ${k}`)
    row('  heat under 28 (small accounts)', (p) => this.story(p) && p.heat < 28)
    row('  heat 28 to 58', (p) => this.story(p) && p.heat >= 28 && p.heat < 58)
    row('  heat 58 and up', (p) => this.story(p) && p.heat >= 58)
    row('a KOL / channel call (the game\'s own)', (p) => p.group === 'other call')
    row('"trending" / "going parabolic"', (p) => p.group === 'other trend')
    row('a coin with a story, any moment', (p) => p.group === 'a coin with a story, any moment')
    row('any coin, any moment', (p) => p.group === 'any coin, any moment')
    for (const line of LINES) row(`no story: its curve crosses ${line}%`, (p) => p.group === `curve crosses ${line}%`)
  }
  /** The checks every run shares. */
  verdict(name: string) {
    const n = this.all.length
    ok(n > 20 && this.bad.length === 0, `${name}: ${n} beats, all well formed and from where they say (${Object.entries(this.srcs).map(([k, v]) => `${k} ${v}`).join(', ')})${this.bad.length ? ': ' + this.bad.slice(0, 8).join('; ') : ''}`)
    console.log('    by kind: ' + Object.entries(this.kinds).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', '))
    ok(this.trades.n > 0 && this.trades.off === 0, `${name}: every "bought / sold" beat is a trade on that coin's tape, same side and size (${this.trades.n} beats, ${this.trades.off} without one)`)
    ok(this.twice === 0, `${name}: a coin announces each market-cap milestone once (${this.milestones.size} announced, ${this.twice} repeated)`)
    ok(this.moves.due > 0 && this.moves.missing === 0 && this.moves.wrong === 0, `${name}: a minute on, every beat says what the price did next (${this.moves.due} beats, ${this.moves.missing} without it, ${this.moves.wrong} wrong)`)
    const mins = this.seconds / 60
    console.log(`    coins with a story running: ${avg(this.storied).toFixed(1)} of ${avg(this.liveCoins).toFixed(0)} live on average; with something on their feed: ${avg(this.withBeats).toFixed(0)}; new beats: ${(n / mins).toFixed(1)} a minute over all coins`)
    console.log(`    one coin's feed: ${this.perStory().toFixed(1)} lines a minute while its story runs; the busiest coin: ${this.busiest().toFixed(1)} a minute over the time it was on the lists`)
  }
  /** Lines a minute on the feed of a coin whose story is running. */
  perStory = () => (this.told.beats / Math.max(1, this.told.seconds)) * 60
  /** Lines a minute on the busiest coin's feed (coins watched for five minutes or more). */
  busiest = () => Math.max(0, ...[...this.perCoin].filter(([id]) => (this.life.get(id) ?? 0) >= 300).map(([id, n]) => (n / this.life.get(id)!) * 60))
  /** What a post and a drama do to trading. */
  effects(name: string) {
    const up = this.after.filter((a) => a.arc && HOPEFUL.has(a.kind))
    const down = this.after.filter((a) => a.kind === 'drama')
    const more = up.filter((a) => a.volAfter > a.volBefore).length / Math.max(1, up.length)
    console.log(`  ${name}: a story post: price ${pct(avg(this.jumps))} on average by the time it reaches the feed, ${pct(med(up.map((a) => a.move)))} a minute after it was made (the middle one; average ${pct(avg(up.map((a) => a.move)))}); volume ${fmtCompact(avg(up.map((a) => a.volBefore)))} → ${fmtCompact(avg(up.map((a) => a.volAfter)))} a minute, busier in ${(more * 100).toFixed(0)}% of cases (n=${up.length})`)
    console.log(`  ${name}: a drama: price ${pct(med(down.map((a) => a.move)))} a minute later (the middle one; average ${pct(avg(down.map((a) => a.move)))}), down in ${((100 * down.filter((a) => a.move < 0).length) / Math.max(1, down.length)).toFixed(0)}% of cases (n=${down.length})`)
    return { up, down }
  }
}

// ─── 1. The feed itself (no server) ──────────────────────────────────────────
function runEngine(engine: MarketEngine, ticks: number, seed: number, replay = false) {
  let m: MarketState = createMarket(seed, 1_760_000_000, engine)
  setClock(secPerTickOf(m))
  let wallets = createWallets(new Rng((m.seed ^ 0xa11ce) >>> 0))
  const book = new Book(true)
  let touched = 0, replays = 0, differ = 0
  const prices = (x: MarketState) => x.tokens.map((t) => `${t.id}:${t.price}:${t.liquidity}:${t.mcap}:${t.volume}:${t.tape[0]?.id}:${t.status}`).join('|')
  for (let i = 0; i < ticks; i++) {
    const rng = new Rng(m.seed)
    const before = m
    const held = new Map<string, number>()
    for (const w of wallets) for (const [id, p] of Object.entries(w.positions)) held.set(id, (held.get(id) ?? 0) + p.qty)
    const res = tickMarket(m, rng, { rugMult: 1, protectedIds: new Set(), held })
    m = res.market
    const e2 = rollEvents(m, rng)
    const wr = tickWallets(wallets, m, rng)
    wallets = wr.wallets
    const posts = tickSocial(m, rng, wr.actions, [...res.events, ...e2])
    const input = { before, events: [...res.events, ...e2], actions: wr.actions, posts, wallets }
    // The same market tells the same story: its dice come from the market's seed and tick, nothing else.
    const twin = replay && i % 25 === 0 ? structuredClone(m) : null
    const was = prices(m)
    const fresh = tickStories(m, input)
    if (prices(m) !== was) touched++
    if (twin) {
      replays++
      const again = tickStories(twin, input)
      if (JSON.stringify(again) !== JSON.stringify(fresh) || JSON.stringify(twin.shillQueue) !== JSON.stringify(m.shillQueue) || JSON.stringify(twin.beatQueue) !== JSON.stringify(m.beatQueue)) differ++
    }
    m.seed = rng.s
    book.see(m, { actions: wr.actions, wallets })
  }
  return { book, touched, replays, differ, market: m }
}
let live: Book | undefined // the real-time engine with stories acting on the market (kept for the comparison below)
for (const [engine, ticks, name] of [['classic', 4000, 'solo play (classic engine, 6 s a tick)'], ['realistic', Math.round(abHours * 3600), 'the real-time engine on its own (1 s a tick)']] as const) {
  const { book, touched, replays, differ, market } = runEngine(engine, ticks, 4242, true)
  console.log(`\n${name}: ${ticks} ticks = ${((ticks * secPerTickOf(market)) / 3600).toFixed(1)} h of market time`)
  book.verdict(name)
  ok(book.enters.n > 0 && book.enters.off === 0, `${name}: every "opened a position / sold their bag" beat is that tracked wallet's own trade (${book.enters.n} beats, ${book.enters.off} without one)`)
  ok(touched === 0, `${name}: the story engine itself never touched a price, a pool, a volume or a tape (${touched} ticks where it did): what it does arrives as trades`)
  ok(replays > 20 && differ === 0, `${name}: the same market tells the same story: beats, followers' orders and beats on their way (${replays} ticks replayed, ${differ} different)`)
  const { up, down } = book.effects(name)
  ok(down.length > 3 && med(down.map((a) => a.move)) < 0, `${name}: drama costs a coin: it is lower a minute later more often than not`)
  ok(up.length > 10 && avg(book.jumps) > 0.005, `${name}: a story post moves its coin before the post can be read (${pct(avg(book.jumps))} on average, ${pct(med(book.jumps))} the middle one)`)
  book.table(name)
  if (engine === 'classic') {
    const r = book.returns(book.story)
    ok(r[0].length > 30 && r.every((x) => avg(x) < 0), `${name}: buying every story beat loses money after fees: ${r.map((x, i) => `${pct(avg(x))} over ${hz(i)}`).join(', ')} (n=${r[0].length})`)
  } else live = book
}

// ─── 2. What a story hands a follower ────────────────────────────────────────
{
  const ticks = Math.round(abHours * 3600)
  STORY.pull = 0
  const quiet = runEngine('realistic', ticks, 4242).book
  STORY.pull = 1
  const loud = live!
  console.log(`\nwhat a story hands a follower: the real-time engine for ${abHours} h, with stories acting on the market and with the same kind of beats and nobody acting on them`)
  console.log(`  a story post by the time it reaches the feed: price ${pct(avg(loud.jumps))} with followers, ${pct(avg(quiet.jumps))} without`)
  const anyTime = (p: Paper) => p.group === 'a coin with a story, any moment'
  const line = (label: string, r: number[][]) => console.log(`    ${label.padEnd(44)} n=${String(r[0].length).padStart(5)}  ${r.map((x, i) => `${pct(avg(x)).padStart(7)} (${pct(avg(x.map(cut)))} capped, ${((100 * x.filter((v) => v <= -0.9).length) / Math.max(1, x.length)).toFixed(0)}% lost it all) over ${hz(i)}`).join('  ')}`)
  console.log(`  $${STAKE} in, out after… (average; "capped" counts a win as +200% at most, because a few coins that bond decide a plain average)`)
  line('with followers: every story beat', loud.returns(loud.story))
  line('with followers: the same coins, any moment', loud.returns(anyTime))
  line('nobody acts: every story beat', quiet.returns(quiet.story))
  line('nobody acts: the same coins, any moment', quiet.returns(anyTime))
  // Is the feed a signal to buy on? Then its beats would pay clearly more than the same coins bought at any moment.
  // (Chance alone moves a difference by about two standard errors; the test allows that and no more.)
  const a = loud.returns(loud.story).map((x) => x.map(cut))
  const b = loud.returns(anyTime).map((x) => x.map(cut))
  const diff = a.map((x, i) => avg(x) - avg(b[i]))
  const err = a.map((x, i) => Math.sqrt(se(x) ** 2 + se(b[i]) ** 2))
  const enough = a[0].length > 200 && b[0].length > 200
  if (!enough) console.log(`  (too few beats to judge: ${a[0].length} story beats and ${b[0].length} any-moment buys; run the comparison for an hour or more)`)
  ok(enough && diff.every((d, i) => d < 2 * err[i]), `a beat is not a buy signal: buying when it shows pays ${diff.map((d, i) => `${pct(d)} ±${(200 * err[i]).toFixed(1)} over ${hz(i)}`).join(', ')} next to buying the same coins at any moment`)
  // Does a story itself put money in a follower's pocket? Then the same beats would pay clearly more with followers acting.
  const q = quiet.returns(quiet.story).map((x) => x.map(cut))
  const d2 = a.map((x, i) => avg(x) - avg(q[i]))
  const e2 = a.map((x, i) => Math.sqrt(se(x) ** 2 + se(q[i]) ** 2))
  console.log(`  next to the same beats with nobody acting, a follower makes ${d2.map((d, i) => `${pct(d)} ±${(200 * e2[i]).toFixed(1)} over ${hz(i)}`).join(', ')}`)
  ok(avg(loud.jumps) > avg(quiet.jumps) + 0.01, 'and the story does move the market: the price is up by the time a post can be read, which it is not when nobody acts')
  console.log('  for the record, what the market itself pays a buyer of whatever is running (no story involved):')
  for (const line of LINES) {
    const r = loud.returns((p) => p.group === `curve crosses ${line}%`)
    if (r[0].length) console.log(`    a coin crossing ${line}% of its curve   n=${String(r[0].length).padStart(5)}  ${r.map((x, i) => `${pct(avg(x)).padStart(8)} over ${hz(i)} (${((100 * x.filter((v) => v > 0).length) / x.length).toFixed(0)}% won)`).join('  ')}`)
  }
}

// ─── 3 and 4. The World with its bots, and what a browser gets ───────────────
{
  const world = new Room(WORLD_CODE, true)
  const w = world as unknown as { tick(): void; market: MarketState }
  for (let i = 0; i < warm * 3600; i++) w.tick()

  // A browser: it keeps what the welcome and the ticks give it, the way the game does (src/net/client.ts).
  const client = new Map<string, Beat[]>()
  let tickBytes = 0, beatBytes = 0, tickMsgs = 0, welcomeBytes = 0, welcomeBeatBytes = 0, leaked = 0
  const take = (list: TokenDiff[]) => {
    const here = new Set<string>()
    for (const d of list) {
      here.add(d.id)
      if (!client.has(d.id) && !d.sim) continue // a stray partial coin waits for its next full send
      client.set(d.id, mergeBeats(client.get(d.id), d.beats) ?? [])
    }
    for (const id of client.keys()) if (!here.has(id)) client.delete(id)
  }
  const ws = {
    readyState: 1, close() {},
    send: (d: string | Buffer) => {
      const s = typeof d === 'string' ? d : d.toString('utf8')
      if (s.startsWith('{"t":"tick"')) {
        const msg = JSON.parse(s) as TickMsg
        tickMsgs++
        tickBytes += s.length
        for (const t of msg.market.tokens) if (t.beats) beatBytes += JSON.stringify(t.beats).length
        if ('shillQueue' in msg.market || 'beatQueue' in msg.market) leaked++
        take(msg.market.tokens)
      } else if (s.startsWith('{"t":"welcome"')) {
        const msg = JSON.parse(s) as { market: MarketState }
        welcomeBytes = s.length
        welcomeBeatBytes = msg.market.tokens.reduce((a, t) => a + (t.beats ? JSON.stringify(t.beats).length : 0), 0)
        if ('shillQueue' in msg.market || 'beatQueue' in msg.market) leaked++
        take(msg.market.tokens as TokenDiff[])
      }
    },
  }
  world.join(ws as never, { t: 'hello', name: 'Watcher', avatar: '👀', level: 1, playerId: 'g-story', verified: false })

  const near = (a?: number, b?: number) => a === b || (a !== undefined && b !== undefined && Math.abs(a - b) <= 1e-5 * Math.max(1e-9, Math.abs(a), Math.abs(b)))
  const same = (a: Beat[] = [], b: Beat[] = []) => a.length === b.length && a.every((x, i) => x.id === b[i].id && x.text === b[i].text && x.kind === b[i].kind && x.src === b[i].src && x.time === b[i].time && near(x.move, b[i].move) && near(x.mcap, b[i].mcap) && x.why === b[i].why && x.by?.name === b[i].by?.name)
  let compared = 0, differ = 0, firstDiff = ''
  const compare = () => {
    for (const t of w.market.tokens) {
      compared++
      if (same(t.beats, client.get(t.id))) continue
      differ++
      firstDiff ||= `$${t.ticker}: server ${JSON.stringify((t.beats ?? []).map((b) => [b.id, b.move?.toFixed(4)]))} browser ${JSON.stringify((client.get(t.id) ?? []).map((b) => [b.id, b.move?.toFixed(4)]))}`
    }
  }

  const book = new Book(false, new Set([...INVENTED, ...BOT_ROSTER.map((b) => b.name)]))
  book.lastId = w.market.nextBeatId ?? 0
  const n = Math.round(hours * 3600)
  const queued: number[] = []
  for (let i = 0; i < n; i++) {
    w.tick()
    book.see(w.market)
    queued.push((w.market.shillQueue?.length ?? 0) + (w.market.beatQueue?.length ?? 0))
    if (i % 300 === 299 || i === n - 1) compare()
  }
  const name = 'the World (with its bots)'
  console.log(`\n${name}: ${hours} h after ${warm} h of warm-up`)
  book.verdict(name)
  const m = w.market
  console.log(`    themes from outside: ${m.trends?.source} (${m.trends?.asOf}), ${m.trends?.themes.length} themes, top: ${m.trends?.themes.slice(0, 5).map((t) => t.word).join(', ')}`)
  ok(book.perStory() < 5 && book.busiest() < 8 && avg(book.storied) >= 4 && avg(book.storied) <= 30, `${name}: a feed is for news: ${book.perStory().toFixed(1)} lines a minute on a coin whose story is running, ${book.busiest().toFixed(1)} on the busiest coin; ${avg(book.storied).toFixed(1)} stories running at a time`)
  ok(Math.max(...queued) < 2000, `${name}: followers' orders and beats on their way stay a short list: ${avg(queued).toFixed(0)} waiting on average, ${Math.max(...queued)} at most`)
  const { up, down } = book.effects(name)
  ok(up.length > 10 && avg(book.jumps) > 0.005, `${name}: a story post moves its coin before the post can be read (${pct(avg(book.jumps))} on average, ${pct(med(book.jumps))} the middle one)`)
  ok(down.length > 3 && med(down.map((a) => a.move)) < 0, `${name}: drama costs a coin: it is lower a minute later more often than not`)
  book.table(name)

  console.log('\nwhat a browser gets')
  ok(compared > 0 && differ === 0, `a browser fed only the welcome and the ticks holds the same feed as the server for every coin (${compared} comparisons, ${differ} different)${firstDiff ? ': ' + firstDiff : ''}`)
  ok(leaked === 0, 'orders and story beats that have not happened yet are never sent to a browser (not in the welcome, not in a tick)')
  ok(beatBytes / tickBytes < 0.03, `the feed is ${((100 * beatBytes) / tickBytes).toFixed(1)}% of what a browser receives: ${(beatBytes / tickMsgs).toFixed(0)} bytes of ${(tickBytes / tickMsgs / 1024).toFixed(1)} KB a second on average; in the welcome ${(welcomeBeatBytes / 1024).toFixed(0)} of ${(welcomeBytes / 1024).toFixed(0)} KB`)
  world.dispose()
}
