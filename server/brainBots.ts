// The market brain: what real pump.fun traders did, learned from recordings (scripts/market-recorder.ts →
// scripts/market-learner.ts → server/data/market-brain.json). World bots ask it how people like them trade: which
// moments they buy in, how much, when they sell, and how often a coin's dev dumps. It holds only odds and ranges per
// style and skill level, never anyone's wallet. Without the file the bots fall back to their old fixed rules.
import { TREND_MAX_AGE_DAYS } from '../src/game/dataSources'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { TrendFeed, Narrative, Token } from '../src/types'
import type { Rng } from '../src/utils/rng'

export type Tier = 'pro' | 'good' | 'average' | 'bad' | 'degen'
export const TIERS: Tier[] = ['pro', 'good', 'average', 'bad', 'degen']

/** Five values at the 10th, 25th, 50th, 75th and 90th percentile. */
type Spread = [number, number, number, number, number]
export interface BrainGroup {
  wallets: number
  bags: number
  medianReturn: number
  buyLift: Record<string, number> // situation key → how much more often than normal this group bought there
  buySizeSol: Spread
  entryAgeSec: Spread
  exitMultiple: Spread
  exitAfterSec: Spread
  sellFraction: Spread
  holdsToEnd: number
  cutsLosers: number
}
export interface MarketBrain {
  v: number
  learnedAt: string
  minutes: number
  buckets: { age: string[]; mcap: string[]; move: string[] }
  dumps: { coinsWithDevSellShare: number; devSellAfterSec: Spread; devSellImpact: Spread; cascadesPerCoin: number; rugShare: number }
  groups: Record<string, BrainGroup>
  trends?: { word: string; narrative: Narrative; launches: number; volumeSol: number }[] // approved themes only (server/trendThemes.ts)
}

const FILE = join(import.meta.dirname, 'data', 'market-brain.json')
export const BRAIN: MarketBrain | null = (() => {
  try {
    if (!existsSync(FILE)) return null
    const b = JSON.parse(readFileSync(FILE, 'utf8')) as MarketBrain
    return b?.v === 1 && b.groups ? b : null
  } catch {
    return null
  }
})()

const edges = (xs: string[]) => xs.map((x) => (x === 'Infinity' ? Infinity : Number(x)))
const AGE = BRAIN ? edges(BRAIN.buckets.age) : []
const MCAP = BRAIN ? edges(BRAIN.buckets.mcap) : []
const MOVE = BRAIN ? edges(BRAIN.buckets.move) : []
const bucket = (v: number, e: number[]) => Math.max(0, e.findIndex((x) => v < x))

/** The group a bot learns from: its own style and level, else the same style at another level, else none. */
export function groupFor(style: string, tier: Tier): BrainGroup | null {
  if (!BRAIN) return null
  const g = BRAIN.groups
  const order: Tier[] = [tier, 'average', ...TIERS.filter((t) => t !== tier && t !== 'average')]
  for (const t of order) if (g[`${style}/${t}`]) return g[`${style}/${t}`]
  return null
}

/** A moment in a coin's life, described the way the brain was taught (age × market cap in SOL × last-minute move). */
export function situation(t: Token, now: number, solUsd: number) {
  const age = Math.max(0, now - t.createdAt)
  const mcapSol = solUsd > 0 ? t.mcap / solUsd : 0
  return `${bucket(age, AGE)}${bucket(mcapSol, MCAP)}${bucket((t.change['1m'] ?? 0) / 100, MOVE)}`
}

/** A random value within a learned spread (between two neighbouring percentiles, so the extremes stay rare). */
export function draw(s: Spread, rng: Rng) {
  const i = rng.int(0, 3)
  return s[i] + (s[i + 1] - s[i]) * rng.next()
}

/** How many coins a wallet like this opens per minute, from the recordings. */
export function buysPerMinute(g: BrainGroup) {
  return BRAIN && g.wallets > 0 && BRAIN.minutes > 0 ? g.bags / g.wallets / BRAIN.minutes : 0.1
}

/** The plan a bot makes when it buys: what it hopes for, how long it will wait, and how it gets out. */
export interface ExitPlan { target: number; stop?: number; after: number; holdToEnd: boolean; cutsLoss: boolean; frac: number }
export function planExit(g: BrainGroup, rng: Rng, patience: number): ExitPlan {
  const frac = draw(g.sellFraction, rng)
  const x = g.exitMultiple
  // Take profit from the upper half of where this group really sold, give up from the bottom of it. A pro's upper half
  // runs to 2-4×; a degen's rarely clears 1×, so a degen basically never takes profit and rides bags down instead.
  const hi = x[2] + (x[4] - x[2]) * rng.next()
  const lo = x[0] + (x[1] - x[0]) * rng.next()
  return {
    target: hi > 1.02 ? hi : Infinity,
    stop: Math.min(0.95, Math.max(0.03, lo)),
    after: Math.max(5, draw(g.exitAfterSec, rng) * patience),
    holdToEnd: rng.chance(g.holdsToEnd),
    cutsLoss: rng.chance(g.cutsLosers),
    frac: frac > 0.9 ? 1 : Math.max(0.25, frac),
  }
}

/**
 * How safe a coin looks from what players can see. Measured in the World market (scripts/crowd-test.ts notes): coins
 * with a high risk score, few holders, thin liquidity, a heavy dev bag or concentrated top 10 die far more often in
 * the next ten minutes, and ones that just pumped hard tend to fall back.
 */
export function safety(t: Token) {
  return -(t.riskScore ?? 50) / 100 - (t.devPct ?? 0) / 50 - (t.top10Pct ?? 0) / 100 + Math.log10((t.holders ?? 0) + 1) / 3 + Math.log10((t.liquidity ?? 0) + 1) / 6 - Math.max(0, t.change['5m'] ?? 0) / 200
}

/**
 * How much a bot of this level likes a coin, given where it ranks on safety among the coins it is looking at
 * (rank 1 = safest). Real pros win by reading the dev and the holders, not just by timing; degens chase what is
 * already pumping and don't check.
 */
export function eye(tier: Tier, rank: number, t: Token) {
  const pumped = Math.max(0, t.change['5m'] ?? 0) / 100
  switch (tier) {
    case 'pro': return rank ** 6
    case 'good': return rank ** 3
    case 'average': return 1
    case 'bad': return (1.1 - rank) ** 1.5
    case 'degen': return (1.05 - rank) ** 2 * (1 + pumped)
  }
}

/** When (seconds after launch) a dev like this dumps their bag, from real dev sells. */
export function devDumpAfter(rng: Rng) {
  return BRAIN ? Math.max(5, draw(BRAIN.dumps.devSellAfterSec, rng)) : rng.int(20, 120)
}

/** Real pump.fun bets are small; World wallets start at $10,000, so bot bets are this many times the real size. */
export const SIZE_SCALE = 8
/** Bots open bags at the real rate × this (1 = as often as the recorded wallets did). */
export const BUY_PACE = 1

/** How often a chef of each level dumps their coin early (the rest sell into runs, or when the coin is old). */
export const DEV_DUMP_CHANCE: Record<Tier, number> = { pro: 0.3, good: 0.4, average: 0.5, bad: 0.7, degen: 0.85 }

/** How many big sells by bots may land on one coin within 10 seconds (real pile-ons happen; bots mustn't all join). */
export const PILE_ON_LIMIT = 2

// ─── Trend coins ─────────────────────────────────────────────────────────────
/** Share of chef launches that ride a current real-market trend (the rest get the game's usual random names). */
export const TREND_SHARE = 0.6
/** Trends older than this many days are treated as stale (refresh the brain to bring them back). */
export { TREND_MAX_AGE_DAYS } // (one number for "too old", shared with the story engine: src/game/dataSources.ts)
/** A theme with this many live coins already is crowded: chefs pick another, or a random name. */
export const TREND_CROWDED = 2
const ICON: Partial<Record<string, string>> = { horse: '🐴', squirrel: '🐿️', mink: '🦦', cat: '🐱', dog: '🐶', frog: '🐸', agent: '🕵️', bot: '🤖', robot: '🤖', artificial: '🧠', rocket: '🚀', moon: '🌙', alien: '👽', pizza: '🍕', burger: '🍔', banana: '🍌', ghost: '👻', wizard: '🧙', dragon: '🐉', shark: '🦈', whale: '🐋', ape: '🦍', monkey: '🐒', owl: '🦉', duck: '🦆', penguin: '🐧', hamster: '🐹', panda: '🐼', goblin: '👺', ninja: '🥷', pirate: '🏴‍☠️', cowboy: '🤠', clown: '🤡', rogue: '🗡️', trencher: '⛏️', renter: '🏠', cache: '📦', chill: '🧊', giga: '💪', pump: '⛽' }
const BY_NARRATIVE: Record<Narrative, string> = { dogs: '🐶', cats: '🐱', frogs: '🐸', ai: '🤖', food: '🍔', space: '🚀', absurd: '🌀', retro: '👾' }

/**
 * The recorded trends as the story engine takes them (see src/data/trends.ts): the approved themes, hottest first,
 * with the date they were recorded so nothing presents them as a live feed. Null without a brain.
 */
export function worldTrends(): TrendFeed | null {
  if (trendFeed !== undefined) return trendFeed
  const list = BRAIN?.trends ?? []
  if (!BRAIN || !list.length) return (trendFeed = null)
  const top = Math.max(...list.map((t) => Math.sqrt(t.volumeSol + 1)))
  return (trendFeed = { source: 'recorded', asOf: BRAIN.learnedAt.slice(0, 10), themes: list.map((t) => ({ word: t.word, narrative: t.narrative, weight: Math.sqrt(t.volumeSol + 1) / top })).sort((a, b) => b.weight - a.weight).slice(0, 25) })
}
let trendFeed: TrendFeed | null | undefined // worked out once: the brain is read when the server starts

/**
 * A coin idea from the trends: a theme picked by how much the real market traded it, dressed up the way pump.fun names
 * go ("Baby Horse", "HORSEAI"…). Never a real launch's name, only the approved theme word. Null when there are no trends.
 */
export function trendCoin(rng: Rng, taken: (ticker: string) => boolean, liveTickers: string[] = []): { name: string; ticker: string; emoji: string; narrative: Narrative; theme: string } | null {
  // Out of ideas means the game's usual random coins: trends older than TREND_MAX_AGE_DAYS are stale, and a theme
  // that already has TREND_CROWDED live coins is skipped.
  const fresh = !!BRAIN && Date.now() - Date.parse(BRAIN.learnedAt) < TREND_MAX_AGE_DAYS * 86_400_000
  const trends = (fresh ? (BRAIN?.trends ?? []) : []).filter((t) => liveTickers.filter((x) => x.includes(t.word.toUpperCase())).length < TREND_CROWDED)
  if (!trends.length) return null
  // Square root of volume: the hottest theme comes up most, but not every time.
  let r = rng.next() * trends.reduce((a, t) => a + Math.sqrt(t.volumeSol + 1), 0)
  const t = trends.find((x) => (r -= Math.sqrt(x.volumeSol + 1)) <= 0) ?? trends[0]
  const W = t.word[0].toUpperCase() + t.word.slice(1)
  const U = t.word.toUpperCase()
  const looks: [string, string][] = [[W, U], [`Baby ${W}`, `B${U}`], [`${W} Inu`, `${U}INU`], [`${W}AI`, `${U}AI`], [`Based ${W}`, `BASED${U}`], [`Giga ${W}`, `G${U}`], [`${W} Coin`, `${U}C`], [`Lil ${W}`, `L${U}`], [`${W} Wif Hat`, `${U}WIF`], [`Super ${W}`, `S${U}`]]
  for (let k = 0; k < 12; k++) {
    const [name, base] = looks[rng.int(0, looks.length - 1)]
    const ticker = (k < 6 ? base : `${base}${k}`).slice(0, 10)
    if (!taken(ticker)) return { name, ticker, emoji: ICON[t.word] ?? BY_NARRATIVE[t.narrative], narrative: t.narrative, theme: t.word }
  }
  return null
}
