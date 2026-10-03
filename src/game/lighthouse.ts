// Market Lighthouse (like Axiom's / GMGN's): the whole market at a glance — transactions, traders, volume split into
// buys and sells, coins created and migrated, and the top launchpads / DEXes — for a time window, with the change
// against the window before it.
//
// How it's measured: every market tick, what each coin traded THAT tick is added to running totals per launchpad
// (so a coin that later dies or is delisted still counts for the time it traded). A copy of the totals is kept
// every few game-seconds; a window's number is "total now − total one window ago", and the change compares it with
// the window before that. Until this browser has watched a market for a full window, the per-coin rolling numbers
// stand in (they miss coins that already died), and the change shows as unknown.
import { CHAIN_IDS } from '../data/chains'
import { LAUNCHPADS, PAD_IDS } from '../data/launchpads'
import type { Chain, MarketState, PadId, Token, Win } from '../types'
import { secPerTickOf } from './marketEngine'
import { winBuys, winSells, winVolume } from './windows'

export const WIN_SEC: Record<Win, number> = { '1m': 60, '5m': 300, '1h': 3600, '24h': 86400 }
const SAMPLE_EVERY_SEC = 15 // game-seconds between saved copies of the totals
const KEEP_SEC = 2 * 86400 + 600

/** Running totals for one launchpad since this browser started watching the market. */
interface Totals {
  volume: number
  buys: number
  sells: number
  gradVolume: number // the part traded by coins that had already graduated (their DEX's volume)
  created: number
  migrated: number
}
const zero = (): Totals => ({ volume: 0, buys: 0, sells: 0, gradVolume: 0, created: 0, migrated: 0 })
type PadTotals = Partial<Record<PadId, Totals>>

interface Sample {
  time: number // market time
  totals: PadTotals
}

interface Book {
  lastTick: number // a tick lower than this (or a big jump) means a different market: new round, joined a room
  startTime: number
  samples: Sample[]
  totals: PadTotals
  // Each coin as last seen: its 1h rolling sums (what this tick added = new − old × decay) and status.
  seen: Map<string, { volume: number; buys: number; sells: number; graduated: boolean }>
}
let book: Book | null = null

const live = (t: Token) => t.status === 'bonding' || t.status === 'graduated'
const snap = (t: Token) => ({ volume: t.volume, buys: t.buys, sells: t.sells, graduated: t.status === 'graduated' })

/** Call once per market tick: adds this tick's trading, launches and migrations to the totals. */
export function sampleLighthouse(m: MarketState) {
  if (!book || m.tick < book.lastTick || m.tick - book.lastTick > 600) {
    // A new market: start from here. Coins already on it aren't "created now", and their past trading isn't ours to count.
    book = { lastTick: m.tick, startTime: m.time, samples: [{ time: m.time, totals: {} }], totals: {}, seen: new Map(m.tokens.map((t) => [t.id, snap(t)])) }
    return
  }
  const b = book
  // Missed ticks (a short disconnect) decay the old sums by that many steps.
  const steps = Math.max(1, m.tick - b.lastTick)
  const decay = (1 - secPerTickOf(m) / 3600) ** steps
  b.lastTick = m.tick
  const next = new Map<string, ReturnType<typeof snap>>()
  for (const t of m.tokens) {
    const old = b.seen.get(t.id)
    const tot = (b.totals[t.pad] ??= zero())
    if (!old) tot.created++
    else if (t.status === 'graduated' && !old.graduated) tot.migrated++
    // Signed on purpose: numbers arrive rounded in rooms, so a quiet coin's tiny "negative" ticks cancel its tiny
    // positive ones instead of piling up. A real drop (a sum that was reset) is ignored.
    const added = (nowV: number, oldV: number | undefined) => {
      const d = nowV - (oldV ?? 0) * decay
      return oldV !== undefined && d < -oldV * 0.01 ? 0 : d
    }
    const vol = added(t.volume, old?.volume)
    tot.volume += vol
    tot.buys += added(t.buys, old?.buys)
    tot.sells += added(t.sells, old?.sells)
    if (t.status === 'graduated') tot.gradVolume += vol
    next.set(t.id, snap(t))
  }
  b.seen = next
  const last = b.samples[b.samples.length - 1]
  if (m.time - last.time < SAMPLE_EVERY_SEC) return
  const copy: PadTotals = {}
  for (const p of PAD_IDS) if (b.totals[p]) copy[p] = { ...b.totals[p]! }
  b.samples.push({ time: m.time, totals: copy })
  while (b.samples.length > 2 && m.time - b.samples[0].time > KEEP_SEC) b.samples.shift()
}

/** The saved totals at (or just before) `time`; null if this browser wasn't watching yet. */
function totalsAt(time: number): PadTotals | null {
  const s = book?.samples
  if (!s?.length || s[0].time > time) return null
  let lo = 0
  let hi = s.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (s[mid].time <= time) lo = mid
    else hi = mid - 1
  }
  return s[lo].totals
}

export interface Stat {
  value: number
  change: number | null // vs the window before; null until we've watched long enough to know
}
export interface PadRow {
  pad: PadId
  volume: Stat
}
export interface DexRow {
  dex: string
  pad: PadId // a launchpad that migrates there (for its badge colours)
  volume: Stat
}
export interface Lighthouse {
  txns: Stat
  traders: Stat
  volume: Stat
  buys: number
  sells: number
  buyVolume: number
  sellVolume: number
  created: Stat
  migrated: Stat
  pads: PadRow[]
  dexes: DexRow[]
  /** True once the numbers are exact counts for the whole window (this browser has watched that long). */
  exact: boolean
}

const pct = (now: number, before: number | null): number | null => (before === null ? null : before > 0 ? now / before - 1 : now > 0 ? null : 0)
const add = (rec: PadTotals | null, pads: PadId[], k: keyof Totals) => pads.reduce((a, p) => a + (rec?.[p]?.[k] ?? 0), 0)
/** Roughly how many different wallets made this many trades (a busy market has many repeat traders). */
export const tradersOf = (txns: number) => Math.round(txns > 40 ? 12 + (txns - 40) * 0.29 : txns * 0.55)

/**
 * The Lighthouse numbers for a window. `chain` narrows it to one chain's launchpads; `only` to a single launchpad
 * (pointing at one in the panel).
 */
export function lighthouse(m: MarketState, win: Win, chain: 'all' | Chain, only?: PadId): Lighthouse {
  const chainPads = PAD_IDS.filter((p) => chain === 'all' || LAUNCHPADS[p].chain === chain)
  const pads = only ? [only] : chainPads
  const sec = WIN_SEC[win]
  const now = book?.totals ?? null
  const a = totalsAt(m.time - sec) // one window ago
  const b = totalsAt(m.time - 2 * sec) // two windows ago
  const exact = !!a

  // Exact: totals now − totals a window ago. Before that: the per-coin rolling sums of coins still trading.
  const rolling = (scope: PadId[], k: 'volume' | 'buys' | 'sells' | 'gradVolume') => {
    let v = 0
    for (const t of m.tokens) {
      if (!live(t) || !scope.includes(t.pad) || (k === 'gradVolume' && t.status !== 'graduated')) continue
      v += k === 'buys' ? winBuys(t, win, m.time) : k === 'sells' ? winSells(t, win, m.time) : winVolume(t, win, m.time)
    }
    return v
  }
  const flow = (scope: PadId[], k: 'volume' | 'buys' | 'sells' | 'gradVolume'): Stat =>
    a ? { value: Math.max(0, add(now, scope, k) - add(a, scope, k)), change: b ? pct(add(now, scope, k) - add(a, scope, k), add(a, scope, k) - add(b, scope, k)) : null } : { value: rolling(scope, k), change: null }
  // Launches / migrations: exact once a window has been watched; before that, what's been counted so far, or the
  // young coins still on the market if that's more (dead ones that already left are missed, so it can run low).
  const counted = (k: 'created' | 'migrated'): Stat => {
    if (a) return { value: add(now, pads, k) - add(a, pads, k), change: b ? pct(add(now, pads, k) - add(a, pads, k), add(a, pads, k) - add(b, pads, k)) : null }
    const present = m.tokens.filter((t) => pads.includes(t.pad) && (k === 'created' ? m.time - t.createdAt <= sec : t.status === 'graduated' && m.time - (t.graduatedAt ?? 0) <= sec)).length
    return { value: Math.max(add(now, pads, k), present), change: null }
  }

  const volume = flow(pads, 'volume')
  const buys = flow(pads, 'buys')
  const sells = flow(pads, 'sells')
  const txns: Stat = { value: buys.value + sells.value, change: a && b ? pct(buys.value + sells.value, add(a, pads, 'buys') + add(a, pads, 'sells') - add(b, pads, 'buys') - add(b, pads, 'sells')) : null }
  const share = txns.value > 0 ? buys.value / txns.value : 0.5
  const prevTx = a && b ? add(a, pads, 'buys') + add(a, pads, 'sells') - add(b, pads, 'buys') - add(b, pads, 'sells') : null

  const padRows: PadRow[] = chainPads.map((p) => ({ pad: p, volume: flow([p], 'volume') })).sort((x, y) => y.volume.value - x.volume.value)
  const byDex = new Map<string, PadId[]>()
  for (const p of chainPads) byDex.set(LAUNCHPADS[p].dex, [...(byDex.get(LAUNCHPADS[p].dex) ?? []), p])
  const dexRows: DexRow[] = [...byDex.entries()].map(([dex, ps]) => ({ dex, pad: ps[0], volume: flow(ps, 'gradVolume') })).sort((x, y) => y.volume.value - x.volume.value)

  return {
    txns, traders: { value: tradersOf(txns.value), change: prevTx === null ? null : pct(tradersOf(txns.value), tradersOf(prevTx)) },
    volume, buys: buys.value, sells: sells.value, buyVolume: volume.value * share, sellVolume: volume.value * (1 - share),
    created: counted('created'), migrated: counted('migrated'),
    pads: padRows, dexes: dexRows, exact,
  }
}

export const LIGHTHOUSE_CHAINS: ('all' | Chain)[] = ['all', ...CHAIN_IDS]

// ─── Market Movement (Axiom's uVolume) ───────────────────────────────────────
// The same running totals, for any window length (6h too), per chain, and how busy the market is right now compared
// with its daily average.

export interface WinCounts {
  volume: number
  txns: number
  created: number
  migrated: number
}
export interface WinStats extends WinCounts {
  prev: WinCounts | null // the window before (null until watched that long)
  exact: boolean
}

/** One window's numbers for some chains: exact once this browser has watched that long, else an estimate. */
export function windowStats(m: MarketState, sec: number, chains: Chain[]): WinStats {
  const pads = PAD_IDS.filter((p) => chains.includes(LAUNCHPADS[p].chain))
  const now = book?.totals ?? null
  const a = totalsAt(m.time - sec)
  const b = totalsAt(m.time - 2 * sec)
  const between = (x: PadTotals | null, y: PadTotals | null): WinCounts => ({
    volume: Math.max(0, add(x, pads, 'volume') - add(y, pads, 'volume')),
    txns: Math.max(0, add(x, pads, 'buys') + add(x, pads, 'sells') - add(y, pads, 'buys') - add(y, pads, 'sells')),
    created: Math.max(0, add(x, pads, 'created') - add(y, pads, 'created')),
    migrated: Math.max(0, add(x, pads, 'migrated') - add(y, pads, 'migrated')),
  })
  if (a) return { ...between(now, a), prev: b ? between(a, b) : null, exact: true }
  // Not watched that long yet: the coins still trading, from their rolling sums.
  const w: Win = sec <= 300 ? '5m' : sec <= 3600 ? '1h' : '24h'
  const scale = w === '24h' ? sec / 86400 : sec / WIN_SEC[w]
  let volume = 0
  let txns = 0
  let created = 0
  let migrated = 0
  for (const t of m.tokens) {
    if (!pads.includes(t.pad)) continue
    if (m.time - t.createdAt <= sec) created++
    if (t.status === 'graduated' && m.time - (t.graduatedAt ?? 0) <= sec) migrated++
    if (!live(t)) continue
    volume += winVolume(t, w, m.time) * scale
    txns += (winBuys(t, w, m.time) + winSells(t, w, m.time)) * scale
  }
  return { volume, txns, created: Math.max(created, add(now, pads, 'created')), migrated: Math.max(migrated, add(now, pads, 'migrated')), prev: null, exact: false }
}

/**
 * How busy the last `sec` was against the daily average (volume per second; 1 = normal, 2 = twice as busy).
 * Until this browser has watched a full day, "daily average" means the average since it started watching.
 */
export function vsDailyAverage(m: MarketState, sec: number, chains: Chain[]): number | null {
  const samples = book?.samples
  if (!book || !samples?.length) return null
  const watched = m.time - samples[0].time
  if (watched < Math.max(120, sec)) return null
  const pads = PAD_IDS.filter((p) => chains.includes(LAUNCHPADS[p].chain))
  const base = Math.min(86400, watched)
  const now = add(book.totals, pads, 'volume')
  const recent = now - add(totalsAt(m.time - sec), pads, 'volume')
  const day = now - add(totalsAt(m.time - base) ?? samples[0].totals, pads, 'volume')
  return day > 0 ? recent / sec / (day / base) : null
}
