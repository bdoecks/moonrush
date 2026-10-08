// The story engine: what happens on a coin, in words, tied to the trades.
//
// A coin's page shows a feed of "beats" and the chart marks them. A beat's `src` says where it comes from, and the
// three are never mixed up (the page shows which is which):
//   market = the simulated market's own facts, read off what really happened: a large trade on the tape, a tracked
//            wallet opening or closing a position, a volume spike, a market-cap milestone, the dev selling, a warning;
//   story  = generated narrative: invented accounts noticing the coin, a rumour, a call, a made-up news piece, drama,
//            the timeline moving on. A story develops in steps, bigger accounts joining as it heats up, and it can
//            turn sour at any step;
//   trend  = outside data: a theme real launches were riding, with the date it was recorded.
//
// The market and the story feed each other, which is the point: a post brings followers, their buying is a volume
// spike and a milestone, and a coin that is running gets posted about. Nothing here moves a price by hand (rule 7 in
// CLAUDE.md). A development's followers are orders like anybody's (`gain`): they buy on the curve / in the pool, and
// nearly all of them are there for the flip, so the coins they bought come back to the market a little later. What
// stays is whatever the coin's own crowd makes of the bump.
//
// A beat is not a buy signal. A post is stamped with the moment it was made, and it reaches the feed a few seconds
// later (`STORY.seenAfter`): by then its fastest followers are in, the way a real post has been read by alert bots
// before anybody else sees it. Most posts go nowhere, and a story turns sour without notice. `scripts/story-test.ts`
// measures that a story hands a follower nothing: the same beats pay no more with stories acting on the market than
// with stories that nobody acts on.
import { ARC_TEXT, BRANDS, MID_POSTERS, OUTLETS, SMALL_POSTERS, STORY_TEXT, type Poster } from '../data/stories'
import { SAFE_THEMES, themeOf } from '../data/themeWords'
import { SAMPLE_TRENDS } from '../data/trends'
import { feedLabel, isStale } from './dataSources'
import { LAUNCHPADS } from '../data/launchpads'
import type { Beat, BeatDraft, BeatKind, BeatPatch, MarketEvent, MarketState, Narrative, SimWallet, SocialPost, StoryArc, Token, WalletAction } from '../types'
import { fmtCompact } from '../utils/format'
import { clamp, Rng } from '../utils/rng'
import { secPerTickOf, SUPPLY, walletName } from './marketEngine'
import { ACCOUNTS } from './socialEngine'
import { winVolume } from './windows'

export const BEATS_KEPT = 16 // a coin's feed keeps this many (newest first)
const MOVE_AFTER = 60 // seconds after a beat when "what the price did next" is filled in
const WHY_WINDOW = 60 // a market move this soon after a story development is traced back to it
export const MILESTONES = [2.5e4, 1e5, 2.5e5, 5e5, 1e6, 2.5e6, 5e6, 1e7, 2.5e7, 5e7, 1e8, 2.5e8, 5e8, 1e9]
/** The least time between two beats of one kind on one coin (seconds): a feed is for news, not for every trade. */
const GAP: Partial<Record<BeatKind, number>> = { bigbuy: 45, bigsell: 45, enter: 20, exit: 20, volume: 180, dev: 10, warn: 20, trend: 60, call: 30 }

type Tier = 'small' | 'mid' | 'big'
/**
 * Everything about stories that is a matter of tuning, in one place. Read `npx tsx scripts/story-test.ts` before and
 * after changing any of it (how many stories run, what a post does to trading, what a follower makes).
 */
export const STORY = {
  pull: 1, // how hard stories act on the market (the test sets 0: the same beats are told and nobody acts on them)
  seenAfter: [2, 5] as [number, number], // seconds between a development and its beat reaching the feed
  early: 0.7, // the share of a post's followers who are in before anybody else can read it
  hold: { early: 25, late: 70 }, // seconds a follower typically keeps what they bought (the early ones flip to the late ones)
  stay: 0.1, // the share of followers who are not there for the flip: they keep their coins
  size: 0.18, // a post's followers bring this share of the pool's money side per unit of strength…
  cap: { small: 1500, mid: 12_000, big: 60_000 } as Record<Tier, number>, // …but no more than accounts that size can move ($)
  eyes: 0.15, // attention a coin on a curve gains per unit of strength (people looking, beyond the ones who follow)
  themeMin: 0.3, // an outside theme counts as running from this weight up (the tail of the list is noise)
  rest: 600, // seconds a coin goes without a new story after one has run its course
  // The odds per second that somebody notices a coin: one with a crowd on its curve, one that is filling up, one in a
  // pool, one that has just bonded; and how much likelier when its theme is running outside the game.
  spark: { crowd: 0.0012, filling: 0.004, pool: 0.0001, bonded: 0.004, hot: 1.6 },
  reach: { small: [0.12, 0.3], mid: [0.32, 0.6], big: [0.62, 1] } as Record<Tier, [number, number]>, // how far a post travels
  flop: { small: 0.38, mid: 0.24, big: 0.12 } as Record<Tier, number>, // the share of posts nobody reads
}

export interface StoryInput {
  before: MarketState // the market as it was before this tick (milestones are crossings)
  events: MarketEvent[] // this tick's events
  actions: WalletAction[] // this tick's trades by tracked wallets (and, in the World, the bots' from the tick before)
  posts: SocialPost[] // this tick's posts
  wallets: SimWallet[] // who those wallets are
}
export interface NewBeat {
  tokenId: string
  beat: Beat
}
type Queue = NonNullable<MarketState['shillQueue']>

const live = (t: Token) => t.status === 'bonding' || t.status === 'graduated'
const GENERIC_WORD: Record<Narrative, string> = { dogs: 'dog', cats: 'cat', frogs: 'frog', ai: 'AI', food: 'food', space: 'space', absurd: 'animal', retro: 'retro' }

/** The highest milestone a market cap has reached (its place in MILESTONES; -1 = none yet). */
function milestoneAt(mcap: number) {
  let i = -1
  while (i + 1 < MILESTONES.length && mcap >= MILESTONES[i + 1]) i++
  return i
}

/** The theme word in a coin's name ("Baby Horse" → horse), if it has an approved one. */
export function themeWordOf(t: Pick<Token, 'name'>): string | null {
  for (const w of t.name.split(/[^A-Za-z]+/)) {
    const theme = w && themeOf(w)
    if (theme) return theme
  }
  return null
}
/** What a coin is about: the narrative its launcher chose, or the one its name points to. */
export function catOf(t: Pick<Token, 'name' | 'narrative'>): Narrative | undefined {
  if (t.narrative) return t.narrative
  const w = themeWordOf(t)
  return w ? SAFE_THEMES.get(w) : undefined
}

/** A coin's beats as a browser keeps them: new and changed ones from the server laid over the ones it has. */
export function mergeBeats(have: Beat[] | undefined, fresh: (Beat | BeatPatch)[] | undefined): Beat[] | undefined {
  if (!fresh?.length) return have
  const byId = new Map((have ?? []).map((b) => [b.id, b]))
  for (const b of fresh) {
    const old = byId.get(b.id)
    if ('text' in b) byId.set(b.id, b)
    else if (old) byId.set(b.id, { ...old, ...b }) // (a change to a beat we never got is nothing to us)
  }
  return [...byId.values()].sort((a, b) => b.id - a.id).slice(0, BEATS_KEPT)
}

/**
 * One tick of every coin's story. `m` is this tick's market (its tokens are fresh copies, changed in place): beats are
 * added, stories move on, and their followers' orders are queued. Returns the new beats.
 */
export function tickStories(m: MarketState, input: StoryInput): NewBeat[] {
  const out: NewBeat[] = []
  if (!m.trends) m.trends = SAMPLE_TRENDS // (the World's server puts its own recording here)
  // Its own dice, from the market's seed and the tick: stories never disturb the market's own random numbers.
  const rng = new Rng(((m.seed ^ 0x9e3779b9) + Math.imul(m.tick, 0x85ebca6b)) >>> 0)
  const before = new Map(input.before.tokens.map((t) => [t.id, t]))
  const walletOf = new Map(input.wallets.map((w) => [w.id, w]))
  const group = <T extends { tokenId?: string }>(list: T[]) => {
    const by = new Map<string, T[]>()
    for (const x of list) if (x.tokenId) by.set(x.tokenId, [...(by.get(x.tokenId) ?? []), x])
    return by
  }
  const eventsOf = group(input.events)
  const actionsOf = group(input.actions)
  const postsOf = group(input.posts)
  // Trades are read once: everything on the tapes since the last tick (a player's or a bot's order between ticks too).
  const firstRun = m.beatTape === undefined
  const cursor = m.beatTape ?? m.nextTradeId - 1
  const queue: Queue = []
  // Story beats made a few seconds ago reach the feed now; the rest wait their turn.
  const showOf = group((m.beatQueue ?? []).filter((p) => p.at <= m.time))
  const coming = (m.beatQueue ?? []).filter((p) => p.at > m.time)
  const waiting = new Set(coming.map((p) => p.tokenId))
  const sec = secPerTickOf(m)
  const later: Later = (t, beat, label, wait) => {
    coming.push({ tokenId: t.id, at: m.time + wait, label, beat, time: m.time, mcap: t.mcap, price: t.price })
    waiting.add(t.id)
  }

  /** Put a beat on a coin's feed. `when` = the moment it is stamped with, if that is not now (a post made a few seconds ago). */
  const push = (t: Token, b: BeatDraft, when?: { time: number; mcap: number }) => {
    const id = (m.nextBeatId = (m.nextBeatId ?? 0) + 1)
    const beat: Beat = { ...b, id, seq: id, time: when?.time ?? m.time, mcap: when?.mcap ?? t.mcap }
    t.beats = [beat, ...(t.beats ?? [])].slice(0, BEATS_KEPT)
    t.sim.beatAt = { ...t.sim.beatAt, [b.kind]: m.time }
    out.push({ tokenId: t.id, beat })
    return beat
  }
  const due = (t: Token, kind: BeatKind) => m.time - (t.sim.beatAt?.[kind] ?? -1e9) >= (GAP[kind] ?? 0)
  /** What a market move gets traced back to: the story's latest development, if it is recent. */
  const why = (t: Token) => {
    const last = t.sim.story?.last
    return last && m.time - last.time <= WHY_WINDOW ? { why: `after ${last.label}` } : {}
  }

  for (const t of m.tokens) {
    const old = before.get(t.id)

    // ─── The market's own beats ────────────────────────────────────────────
    if (!firstRun && (live(t) || old?.status !== t.status)) {
      // Wallets people follow (KOLs, smart money, whales) opening or closing a position; a World bot's only when the
      // trade is big for the coin (it would be on the feed as a large trade anyway: this says whose and what it was).
      const big = Math.max(t.status === 'bonding' ? 600 : 2000, t.liquidity * 0.04)
      const told = new Set<string>()
      for (const a of actionsOf.get(t.id) ?? []) {
        const w = walletOf.get(a.walletId)
        if (!w) continue
        const known = (w.style === 'kol' || w.style === 'smart' || w.style === 'whale') && !w.bot
        if ((!known && !w.bot) || a.usd < (known ? Math.max(200, t.liquidity * 0.01) : big)) continue
        if (a.side === 'buy' && a.kind === 'first' && due(t, 'enter')) {
          push(t, { kind: 'enter', tone: 'up', src: 'market', text: `${w.name} opened a position: ${fmtCompact(a.usd)}`, usd: a.usd, by: { name: w.name, avatar: w.avatar }, ...(a.why ? { why: a.why } : why(t)) })
          told.add(`${a.walletId}:buy`)
        } else if (a.side === 'sell' && a.kind === 'all' && due(t, 'exit')) {
          push(t, { kind: 'exit', tone: 'down', src: 'market', text: `${w.name} sold their whole bag (${fmtCompact(a.usd)})`, usd: a.usd, by: { name: w.name, avatar: w.avatar }, ...(a.why ? { why: a.why } : why(t)) })
          told.add(`${a.walletId}:sell`)
        }
      }
      // Large trades: the biggest buy and the biggest sell since the last tick, if they are big for this coin (a trade
      // that moves its price by a tenth or so on its own).
      let topBuy: Token['tape'][number] | undefined
      let topSell: Token['tape'][number] | undefined
      for (const x of t.tape) {
        if (x.id <= cursor || x.usd < big || x.tag === 'you' || told.has(`${x.walletId}:${x.side}`)) continue
        if (x.side === 'buy') {
          if (!topBuy || x.usd > topBuy.usd) topBuy = x
        } else if (!topSell || x.usd > topSell.usd) topSell = x
      }
      for (const e of [topBuy, topSell]) {
        if (!e) continue
        const side = e.side
        const kind = side === 'buy' ? 'bigbuy' : 'bigsell'
        if (!due(t, kind)) continue
        const w = e.walletId ? walletOf.get(e.walletId) : undefined
        const who = w?.name ?? e.wallet
        const label = e.tag === 'dev' ? 'The dev' : e.tag === 'whale' || e.usd >= big * 4 ? `Whale ${who}` : who
        push(t, { kind, tone: side === 'buy' ? 'up' : 'down', src: 'market', text: `${label} ${side === 'buy' ? 'bought' : 'sold'} ${fmtCompact(e.usd)}`, usd: e.usd, by: { name: who, avatar: w?.avatar ?? (e.tag === 'dev' ? DEV : '🐋') }, ...why(t) })
      }
      // A volume spike: the last minute against the four before it.
      if (live(t) && due(t, 'volume') && m.time - t.createdAt > 120) {
        const v1 = winVolume(t, '1m', m.time)
        const earlier = Math.max(0, winVolume(t, '5m', m.time) - v1) / 4
        if (v1 >= Math.max(4000, t.liquidity * 0.25) && v1 > earlier * 4) push(t, { kind: 'volume', tone: 'info', src: 'market', text: `Volume spike: ${fmtCompact(v1)} traded in the last minute${earlier > 50 ? ` (about ${Math.round(v1 / earlier)}x the minutes before)` : ''}`, usd: v1, ...why(t) })
      }
      // Market-cap milestones, each announced once (and a coin that bonds).
      if (old && live(t)) {
        // (The first look at a coin only notes where it stands: a milestone is a crossing seen from then on, and the
        // mark only ever goes up, so a coin that dips under a line and comes back doesn't announce it twice.)
        if (t.sim.beatMark === undefined) t.sim.beatMark = milestoneAt(old.mcap)
        const reached = milestoneAt(t.mcap)
        if (reached > t.sim.beatMark) {
          t.sim.beatMark = reached
          push(t, { kind: 'milestone', tone: 'up', src: 'market', text: `Crossed ${fmtCompact(MILESTONES[reached])} market cap`, ...why(t) })
        }
      }
      for (const e of eventsOf.get(t.id) ?? []) {
        if (e.kind === 'graduation') push(t, { kind: 'milestone', tone: 'up', src: 'market', text: `Bonded: migrated to ${LAUNCHPADS[t.pad].dex} at ${fmtCompact(t.mcap)}` })
        else if (e.kind === 'devsell' && due(t, 'dev')) push(t, { kind: 'dev', tone: 'down', src: 'market', text: e.text.replace(`$${t.ticker} `, '').replace(/^dev /, 'The dev '), by: { name: 'Dev wallet', avatar: DEV } })
        else if ((e.kind === 'liquidity' || e.kind === 'bundle' || e.kind === 'wash') && due(t, 'warn')) push(t, { kind: 'warn', tone: 'warn', src: 'market', text: e.text })
        else if (e.kind === 'rug') push(t, { kind: 'warn', tone: 'down', src: 'market', text: 'Rugged: the insiders dumped their bags' })
        else if ((e.kind === 'trending' || e.kind === 'viral') && due(t, 'trend')) push(t, { kind: 'trend', tone: 'up', src: 'story', text: e.text, heat: Math.round(t.hype) })
      }
      // Calls: a KOL posting the coin they just bought, a channel calling it, a player's own call.
      for (const p of postsOf.get(t.id) ?? []) {
        if (!p.isCall || !due(t, 'call')) continue
        const acc = p.accountId === 'player' ? null : ACCOUNTS.find((a) => a.id === p.accountId)
        if (p.accountId !== 'player' && (!acc || acc.kind === 'news')) continue
        const by = acc ? { name: acc.name, avatar: acc.avatar, followers: acc.followers } : { name: p.author?.name ?? 'Player', avatar: p.author?.avatar ?? '🧑', followers: p.author?.followers }
        push(t, { kind: 'call', tone: 'up', src: 'story', text: p.text.split('\n')[0].slice(0, 140), by, heat: clamp(Math.round(Math.log10(1 + (by.followers ?? 0)) * 18), 5, 100) })
      }
    }

    // ─── The story ─────────────────────────────────────────────────────────
    if (live(t)) {
      for (const p of showOf.get(t.id) ?? []) {
        push(t, p.beat, p)
        // What the market does from here is traced back to it (and the next development looks at how it was taken).
        if (t.sim.story && p.label) t.sim.story = { ...t.sim.story, last: { time: p.time, price: p.price, label: p.label } }
      }
      if (!waiting.has(t.id)) stepStory(t, m, rng, later, queue, sec)
    }

    // ─── What the price did next ───────────────────────────────────────────
    if (t.beats?.some((b) => b.move === undefined && m.time - b.time >= MOVE_AFTER)) {
      t.beats = t.beats.map((b) => (b.move === undefined && m.time - b.time >= MOVE_AFTER && b.mcap > 0 ? { ...b, move: t.mcap / b.mcap - 1, seq: (m.nextBeatId = (m.nextBeatId ?? 0) + 1) } : b))
    }
  }
  if (queue.length) m.shillQueue = [...(m.shillQueue ?? []), ...queue]
  if (coming.length || m.beatQueue) m.beatQueue = coming
  m.beatTape = m.nextTradeId - 1
  return out
}

// ─── A coin's story, one development at a time ───────────────────────────────
const DEV = '🧑‍💻'
/** Put a story beat on its way to the feed: `label` is how later moves name it ("after @x's post"), `wait` the seconds until it shows. */
type Later = (t: Token, b: BeatDraft, label: string, wait: number) => void
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "2026-10-03" → "3 Oct 2026". */
const dayOf = (iso: string) => {
  const [y, mo, d] = iso.slice(0, 10).split('-').map(Number)
  return y && mo && d ? `${d} ${MONTHS[mo - 1]} ${y}` : iso
}

/** What a coin is about, and whether that is running outside the game (its own word on the list, or its whole kind near the top). */
function themeFacts(t: Token, m: MarketState) {
  const themeWord = themeWordOf(t)
  const cat = t.narrative ?? (themeWord ? SAFE_THEMES.get(themeWord) : undefined)
  // (A list that is out of date is not what is running now: it is still shown with its date where the game lists its
  // sources, and no story leans on it.)
  const feed = m.trends && !isStale(m.trends, Date.now()) ? m.trends : undefined
  const rank = themeWord && feed ? feed.themes.findIndex((x) => x.word === themeWord && x.weight >= STORY.themeMin) : -1
  return { themeWord, cat, rank, hot: rank >= 0 || (!!cat && !!feed?.themes.some((x) => x.narrative === cat && x.weight >= 0.6)) }
}

function stepStory(t: Token, m: MarketState, rng: Rng, later: Later, queue: Queue, sec: number) {
  const s = t.sim
  const flow = s.flow
  const onCurve = t.status === 'bonding' && !!flow
  let story = s.story
  // (A coin's theme takes reading its name: that is done only for a coin somebody may notice, or whose story moves on.)
  let facts: ReturnType<typeof themeFacts> | undefined

  // No story yet (or the last one is over and the coin has had its rest): does somebody notice it?
  if (!story || (story.over && m.time >= story.nextAt)) {
    const run = t.change['5m'] ?? 0
    const k = STORY.spark
    // The odds are per second (a tick is 1 s in the World, 6 s in solo play).
    const p = onCurve
      ? k.crowd * Math.min(2, flow!.q) * clamp(flow!.att / 0.5, 0.2, 1.5) + (t.bondingProgress > 22 ? k.filling : 0)
      : k.pool * (0.5 + t.hype / 100) * (1 + Math.max(0, run) * 3) + (t.status === 'bonding' ? (t.bondingProgress > 22 ? k.filling : k.pool) : m.time - (t.graduatedAt ?? 0) < 120 ? k.bonded : 0)
    const roll = rng.next()
    const odds = (boost: number) => 1 - Math.pow(1 - Math.min(0.5, p * boost), sec)
    if (roll >= odds(k.hot)) return // not even if its theme is running
    facts = themeFacts(t, m)
    if (roll >= odds(facts.hot ? k.hot : 1)) return
    const sold = (t.devTrades ?? []).some((d) => d.side === 'sell')
    const arc = rng.weighted<StoryArc>({ meme: 4, caller: 2.5, community: sold ? 2.5 : 0.6, builder: t.devPct > 1 && !sold ? 2 : 0.4, whale: 1 })
    story = { arc, step: 0, heat: rng.range(8, 22), nextAt: m.time, cat: facts.cat, themed: s.story?.themed }
  }
  if (story.over || m.time < story.nextAt) return
  const { themeWord, cat, rank, hot } = (facts ??= themeFacts(t, m))
  story = { ...story }
  s.story = story

  // How the market took the last development decides a lot of what comes next.
  const resp = story.last ? t.price / story.last.price - 1 : 0
  const rest = () => {
    story!.over = true
    story!.nextAt = m.time + STORY.rest
  }
  const word = themeWord ?? (cat ? GENERIC_WORD[cat] : null)
  // Outside data, said once per coin and with its date: this theme is one real launches were riding.
  if (rank >= 0 && !story.themed && m.trends) {
    story.themed = true
    const text = m.trends.source === 'recorded'
      ? `"${themeWord}" coins were running in real launches: theme #${rank + 1} by money traded, recorded ${dayOf(m.trends.asOf)}`
      : m.trends.source === 'provider'
      ? `"${themeWord}" is theme #${rank + 1} in real launches according to ${feedLabel(m.trends)} (data from ${dayOf(m.trends.asOf)})`
      : `"${themeWord}" is on the game's sample list of themes that ran in real launches (as of ${dayOf(m.trends.asOf)})`
    later(t, { kind: 'theme', tone: 'info', src: 'trend', text }, '', 0)
  }
  if (story.from === undefined) story.from = t.price
  const from = story.from
  const say = (kind: BeatKind) => {
    // (A line that refers back to something is for a story that something happened in.)
    const done = new Set((t.beats ?? []).filter((b) => b.arc).map((b) => b.kind as string))
    const all = [...(ARC_TEXT[story!.arc]?.[kind] ?? []), ...STORY_TEXT[kind]].filter((x) => (word || !x.includes('{W}')) && (!NEEDS.test(x) || done.has(NEEDS.exec(x)![1])))
    // A story does not say the same thing twice (until it has said everything there is).
    const unsaid = all.filter((x) => !story!.said?.includes(hashOf(x)))
    const line = rng.pick(unsaid.length ? unsaid : all)
    story!.said = [...(story!.said ?? []), hashOf(line)].slice(-16)
    const brand = rng.pick(BRANDS)
    return line.replace(NEEDS, '').replaceAll('{T}', `$${t.ticker}`).replaceAll('{N}', t.name).replaceAll('{M}', fmtCompact(t.mcap)).replaceAll('{X}', `${Math.max(1.1, t.price / from).toFixed(1)}x`)
      .replaceAll('{W}', word ?? '').replaceAll('{O}', rng.pick(OUTLETS)).replaceAll('{B}', brand)
  }
  const after = Math.abs(resp) >= 0.15 && story.step > 0 ? { why: `after a ${resp > 0 ? '+' : ''}${Math.round(resp * 100)}% move` } : {}
  const next = (lo: number, hi: number) => (story!.nextAt = m.time + rng.range(lo, hi) * (onCurve ? 1 : 2.5))
  const wait = rng.int(...STORY.seenAfter)
  const waitTicks = Math.max(1, Math.ceil(wait / sec))

  // The timeline loses interest on its own.
  story.heat = Math.max(0, story.heat - (story.last ? (m.time - story.last.time) * 0.04 : 0))

  // Sour: drama, a debunked rumour, a deleted call. Likelier after a drop, at a peak, and late in a story.
  const sour = story.step > 0 && rng.chance(0.09 + (resp < -0.2 ? 0.25 : 0) + (story.heat > 80 ? 0.2 : 0) + (story.step >= 6 ? 0.15 : 0))
  if (sour) {
    const r = rng.range(0.3, 0.8)
    const poster = rng.pick(story.heat > 45 ? MID_POSTERS : SMALL_POSTERS)
    later(t, { kind: 'drama', tone: 'down', src: 'story', arc: story.arc, text: say('drama'), by: byOf(poster), heat: Math.round(story.heat), ...after }, `@${poster.name}'s post`, wait)
    lose(t, m, rng, r, waitTicks, sec, queue)
    story.heat *= rng.range(0.3, 0.6)
    story.step++
    if (story.heat < 12 || rng.chance(0.6)) rest()
    else next(20, 70)
    return
  }
  if (story.step > 0 && (story.heat < 6 || story.step >= 9)) {
    later(t, { kind: 'fade', tone: 'info', src: 'story', arc: story.arc, text: say('fade'), heat: Math.round(story.heat) }, 'the timeline moving on', 0)
    if (onCurve) flow!.att *= 1 - 0.08 * Math.min(1, STORY.pull)
    return rest()
  }

  // A development, by whoever the story is big enough to reach.
  const tier: Tier = story.heat < 28 ? 'small' : story.heat < 58 ? 'mid' : 'big'
  const kind: BeatKind =
    tier === 'small' ? (rng.chance(0.82) ? 'post' : 'rumor')
    : tier === 'mid' ? rng.weighted<BeatKind>({ post: 5, rumor: 2, call: story.arc === 'caller' ? 3 : 1, partner: story.arc === 'builder' ? 1.5 : 0.4 })
    : story.heat > 82 ? rng.weighted<BeatKind>({ trend: 5, news: 2, call: 2 })
    : rng.weighted<BeatKind>({ call: story.arc === 'caller' ? 5 : 3, news: 2, partner: story.arc === 'builder' ? 2 : 0.7, post: 2 })
  const big = ACCOUNTS.filter((a) => a.kind === 'kol' || a.kind === 'caller')
  const poster: Poster = kind === 'news' ? { name: 'news', avatar: '📰', followers: 0 } : tier === 'big' && kind === 'call' ? rng.pick(big) : rng.pick(tier === 'small' ? SMALL_POSTERS : MID_POSTERS)
  const flop = rng.chance(STORY.flop[tier])
  const reach = rng.range(...STORY.reach[tier])
  // A post lands harder on a coin that answered the last one, and on a theme that is running outside the game.
  const strength = flop ? reach * 0.08 : reach * Math.exp(0.45 * rng.gauss()) * (1 + clamp(resp * 1.5, -0.4, 0.8)) * (hot ? 1.2 : 1)
  story.heat = clamp(story.heat + (flop ? -rng.range(2, 8) : reach * rng.range(10, 30) * (1 + clamp(resp * 2, -0.5, 1))), 0, 100)
  const text = say(kind)
  const label = kind === 'news' ? 'the news piece' : kind === 'trend' ? 'it started trending' : `@${poster.name}'s ${kind === 'call' ? 'call' : kind === 'rumor' ? 'rumour' : 'post'}`
  later(t, { kind, tone: 'up', src: 'story', arc: story.arc, text, ...(kind === 'news' ? {} : { by: byOf(poster) }), heat: Math.round(flop ? Math.min(story.heat, rng.range(2, 9)) : story.heat), ...after }, label, wait)
  gain(t, m, rng, strength, tier, waitTicks, sec, queue)
  story.step++
  if (kind === 'trend') next(40, 110) // the top of a story: what follows is usually the way down
  else next(tier === 'small' ? 15 : 20, tier === 'small' ? 50 : 80)
}

const byOf = (p: Poster) => ({ name: p.name, avatar: p.avatar, followers: p.followers })
const NEEDS = /^\[(\w+)\]/ // a line's mark for "only after a beat of this kind" (see src/data/stories.ts)
/** A line of story text as one number (FNV-1a), to remember which have been used. */
const hashOf = (s: string) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

/**
 * A development that brings people. Its followers are orders like anybody's: most are in before the beat can be read
 * (`waitTicks`), the rest over the seconds after it, and nearly all of them are there for the flip, so each sells
 * what it bought a little later (`sellAfter`: the market engine queues that sale with exactly the coins the buy got).
 * A few more of the coin's own crowd look at it too. What is left when the followers are gone is what that crowd
 * made of the bump: on a coin people want, a run; on the rest, a spike on the chart.
 */
function gain(t: Token, m: MarketState, rng: Rng, strength: number, tier: Tier, waitTicks: number, sec: number, queue: Queue) {
  const pull = STORY.pull
  if (!(pull > 0)) return
  const flow = t.sim.flow
  if (t.status === 'bonding' && flow) flow.att += strength * STORY.eyes * pull
  else t.hype = clamp(t.hype + strength * 10 * pull, 0, 100)
  const money = Math.min(STORY.cap[tier], (t.liquidity / 2) * STORY.size) * strength * pull
  const n = clamp(Math.round(2 + 9 * strength), 2, 28)
  for (let k = 0; k < n; k++) {
    const usd = (money / n) * Math.exp(0.6 * rng.gauss() - 0.18)
    if (usd < 2) continue
    const early = rng.chance(STORY.early)
    const atTick = m.tick + (early ? rng.int(1, waitTicks) : waitTicks + 1 + Math.floor((-Math.log(1 - rng.next()) * 12) / sec))
    const hold = (early ? STORY.hold.early : STORY.hold.late) * Math.exp(0.8 * rng.gauss())
    queue.push({ tokenId: t.id, atTick, usd, wallet: walletName(rng), ...(rng.chance(STORY.stay) ? {} : { sellAfter: Math.max(1, Math.round(hold / sec)) }) })
  }
}

/** A development that drives people off: fewer of the crowd look, and some of the holders it had sell (the quick ones before the beat can be read). */
function lose(t: Token, m: MarketState, rng: Rng, r: number, waitTicks: number, sec: number, queue: Queue) {
  const pull = STORY.pull
  if (!(pull > 0)) return
  const flow = t.sim.flow
  const inPool = t.liquidity / 2 / t.price // coins in the curve / pool
  const at = () => m.tick + (rng.chance(0.5) ? rng.int(1, waitTicks) : waitTicks + 1 + Math.floor(rng.range(0, 20) / sec))
  if (t.status === 'bonding' && flow) {
    flow.att *= 1 - 0.4 * r * Math.min(1, pull)
    const out = Math.max(0, LAUNCHPADS[t.pad].vTokens - inPool - (t.sim.held ?? 0)) // what the crowd itself holds
    for (let n = rng.poisson((1.5 + 4 * r) * pull); n > 0; n--) queue.push({ tokenId: t.id, atTick: at(), usd: 0, wallet: walletName(rng), side: 'sell', qty: out * rng.range(0.01, 0.05) })
  } else {
    t.sim.pressure -= r * 0.004 * pull
    t.hype = clamp(t.hype - 20 * r * Math.min(1, pull), 0, 100)
    for (let n = rng.poisson((1.5 + 3.5 * r) * pull); n > 0; n--) queue.push({ tokenId: t.id, atTick: at(), usd: 0, wallet: walletName(rng), side: 'sell', qty: Math.min(SUPPLY * 0.01, (t.liquidity * 0.004 * Math.exp(0.7 * rng.gauss())) / t.price) })
  }
}
