// Weekly missions and the career ladder (the Missions page). Like the daily challenges they are counted from the
// player's own fills in any mode, are saved with their rewards (so they follow the account), and pay XP only: XP is
// never money, so nothing here has to run on the server. Pure.
//  - Weekly: four goals a week (Monday to Sunday), the same for everyone that week, bigger than a day's.
//  - Career: nine ladders of five tiers each that never reset. Each tier pays once.
import type { Trade } from '../types'
import { dayKey } from './daily'

// ─── Weekly ──────────────────────────────────────────────────────────────────
export interface WeeklyState {
  week: string // the Monday this week began (YYYY-MM-DD, local time)
  trades: number
  volume: number
  wins: number
  pnl: number
  peakPnl: number
  bestPct: number
  coins: string[]
  days: string[] // days with at least one trade
  sweeps: number // daily sweeps (all three dailies) finished this week
  done: string[]
  swept?: boolean
}
export interface WeeklyDef {
  id: string
  icon: string
  title: string
  desc: string
  xp: number
  target: number
  unit?: '%' | '$'
  progress: (s: WeeklyState) => number
}
export const WEEKLY_SWEEP_XP = 500
const MAX_COINS = 60

/** Four groups; one goal from each every week. The group sizes (3, 3, 2, 4) make the same four come back after 12 weeks. */
const WEEKLY: WeeklyDef[][] = [
  [
    { id: 'w-trades75', icon: '🔁', title: 'Make 75 trades', desc: 'Any 75 buys or sells this week.', xp: 250, target: 75, progress: (s) => s.trades },
    { id: 'w-vol25k', icon: '📊', title: 'Trade $25,000 of volume', desc: 'Buys and sells both count.', xp: 250, target: 25_000, unit: '$', progress: (s) => s.volume },
    { id: 'w-coins20', icon: '🧺', title: 'Trade 20 different coins', desc: 'See more of the market.', xp: 250, target: 20, progress: (s) => s.coins.length },
  ],
  [
    { id: 'w-wins15', icon: '🎯', title: 'Close 15 trades in profit', desc: 'Fifteen sells in the green.', xp: 300, target: 15, progress: (s) => s.wins },
    { id: 'w-profit500', icon: '💵', title: 'Bank $500 profit', desc: 'Be up $500 on the week from closed trades.', xp: 300, target: 500, unit: '$', progress: (s) => s.peakPnl },
    { id: 'w-pump50', icon: '🚀', title: 'Catch a 50% pump', desc: 'Close a single trade at +50% or better.', xp: 300, target: 50, unit: '%', progress: (s) => s.bestPct },
  ],
  [
    { id: 'w-days4', icon: '📅', title: 'Trade on 4 different days', desc: 'Show up four days this week.', xp: 300, target: 4, progress: (s) => s.days.length },
    { id: 'w-sweeps2', icon: '🧹', title: 'Sweep the dailies twice', desc: 'Finish all three daily challenges on two days.', xp: 300, target: 2, progress: (s) => s.sweeps },
  ],
  [
    { id: 'w-vol100k', icon: '🐳', title: 'Trade $100,000 of volume', desc: 'Whale week. Buys and sells both count.', xp: 500, target: 100_000, unit: '$', progress: (s) => s.volume },
    { id: 'w-wins40', icon: '🏹', title: 'Close 40 trades in profit', desc: 'Forty sells in the green.', xp: 500, target: 40, progress: (s) => s.wins },
    { id: 'w-profit2k', icon: '💰', title: 'Bank $2,000 profit', desc: 'Be up $2,000 on the week from closed trades.', xp: 500, target: 2_000, unit: '$', progress: (s) => s.peakPnl },
    { id: 'w-pump100', icon: '🌕', title: 'Hit a 2x', desc: 'Close a single trade at +100% or better.', xp: 500, target: 100, unit: '%', progress: (s) => s.bestPct },
  ],
]

/** The Monday of the week `d` is in, as a day key. */
export function weekKey(d = new Date()): string {
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7))
  return dayKey(monday)
}
export const freshWeekly = (week: string): WeeklyState => ({ week, trades: 0, volume: 0, wins: 0, pnl: 0, peakPnl: 0, bestPct: 0, coins: [], days: [], sweeps: 0, done: [] })
export const weeklyFor = (state: WeeklyState | undefined, now = new Date()): WeeklyState => (state?.week === weekKey(now) ? state : freshWeekly(weekKey(now)))

/** The four goals of a week. */
export function weeklyMissions(week: string): WeeklyDef[] {
  const [y, m, d] = week.split('-').map(Number)
  const n = Math.floor(Date.UTC(y, m - 1, d) / (7 * 86_400_000))
  return WEEKLY.map((group) => group[n % group.length])
}
/** Milliseconds until next Monday, when the next four arrive. */
export const msToNextWeek = (now = new Date()) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7) + 7).getTime() - now.getTime()

// ─── Career ──────────────────────────────────────────────────────────────────
export interface CareerState {
  trades: number
  volume: number
  wins: number // sells in profit
  bestPct: number // best single sell, %
  bigWin: number // best single sell, USD
  quick: number // profitable sells held under a minute (60 ticks)
  patient: number // profitable sells held over ten minutes (600 ticks)
  sweeps: number // daily sweeps, all time
  streak: number // days in a row with a trade, counting today
  bestStreak: number
  lastDay: string // the last day with a trade
  tiers: Record<string, number> // ladder id → tiers already paid
}
export interface CareerLadder {
  id: string
  icon: string
  name: string
  what: string // what it counts, e.g. "trades made"
  unit?: '%' | '$'
  steps: number[] // what each of the five tiers needs
  value: (s: CareerState) => number
}
export const TIER_NAMES = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond']
export const TIER_XP = [50, 150, 400, 1000, 2500]
export const TIER_COLOR = ['#cd7f32', '#b4bed2', '#ffc93d', '#7fe3e0', '#b9a3ff']

export const CAREER: CareerLadder[] = [
  { id: 'trader', icon: '🔁', name: 'Trader', what: 'trades made', steps: [10, 100, 500, 2_500, 10_000], value: (s) => s.trades },
  { id: 'volume', icon: '📊', name: 'Volume', what: 'traded', unit: '$', steps: [5_000, 50_000, 500_000, 5_000_000, 50_000_000], value: (s) => s.volume },
  { id: 'winner', icon: '🎯', name: 'Winner', what: 'trades closed in profit', steps: [5, 50, 250, 1_000, 5_000], value: (s) => s.wins },
  { id: 'eye', icon: '🚀', name: 'Sharp eye', what: 'best single trade', unit: '%', steps: [25, 50, 100, 300, 1_000], value: (s) => s.bestPct },
  { id: 'big', icon: '💰', name: 'Big game', what: 'biggest single win', unit: '$', steps: [50, 250, 1_000, 5_000, 25_000], value: (s) => s.bigWin },
  { id: 'quick', icon: '⚡', name: 'Quick hands', what: 'winning trades held under a minute', steps: [5, 25, 100, 400, 1_500], value: (s) => s.quick },
  { id: 'patient', icon: '💎', name: 'Diamond hands', what: 'winning trades held over ten minutes', steps: [3, 15, 60, 200, 600], value: (s) => s.patient },
  { id: 'streak', icon: '🔥', name: 'Streak', what: 'days in a row with a trade', steps: [2, 5, 10, 20, 40], value: (s) => s.bestStreak },
  { id: 'sweeper', icon: '🧹', name: 'Sweeper', what: 'daily sweeps', steps: [1, 5, 15, 40, 100], value: (s) => s.sweeps },
]

export const freshCareer = (): CareerState => ({ trades: 0, volume: 0, wins: 0, bestPct: 0, bigWin: 0, quick: 0, patient: 0, sweeps: 0, streak: 0, bestStreak: 0, lastDay: '', tiers: {} })
/** How many tiers of a ladder the numbers have reached. */
export const tiersReached = (l: CareerLadder, s: CareerState) => l.steps.filter((need) => l.value(s) >= need).length
/** Every badge earned so far, across the ladders. */
export const badgeCount = (s: CareerState | undefined) => Object.values(s?.tiers ?? {}).reduce((a, n) => a + n, 0)
/** Is the streak still alive today? (It dies when a whole day passes without a trade.) */
export function streakNow(s: CareerState | undefined, now = new Date()): number {
  if (!s?.lastDay) return 0
  const yesterday = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))
  return s.lastDay === dayKey(now) || s.lastDay === yesterday ? s.streak : 0
}

// ─── Counting ────────────────────────────────────────────────────────────────
export interface MissionPay {
  title: string
  xp: number
  icon: string
  kind: 'weekly' | 'weeklySweep' | 'career'
}

/**
 * Add fills (and a daily sweep, when one was just finished) to the week and to the career. Returns the new numbers and
 * what was earned just now. A career ladder can pay several tiers at once (a first big trade).
 */
export function foldMissions(weekly: WeeklyState | undefined, career: CareerState | undefined, fills: Trade[], dailySweep = false, now = new Date()): { weekly: WeeklyState; career: CareerState; paid: MissionPay[] } {
  // (Spread over fresh numbers: a save from before a number was added must still count.)
  const w = { ...freshWeekly(weekKey(now)), ...weeklyFor(weekly, now) }
  const c = { ...freshCareer(), ...(career ?? {}), tiers: { ...(career?.tiers ?? {}) } }
  const today = dayKey(now)
  const coins = new Set(w.coins)
  for (const t of fills) {
    w.trades++
    c.trades++
    w.volume += t.value
    c.volume += t.value
    if (coins.size < MAX_COINS) coins.add(t.tokenId)
    if (t.side !== 'sell') continue
    const pnl = t.pnl ?? 0
    const pct = (t.pnlPct ?? 0) * 100
    w.pnl += pnl
    w.bestPct = Math.max(w.bestPct, pct)
    c.bestPct = Math.max(c.bestPct, pct)
    if (!(pnl > 0)) continue
    w.wins++
    c.wins++
    c.bigWin = Math.max(c.bigWin, pnl)
    if ((t.holdTicks ?? Infinity) < 60) c.quick++
    if ((t.holdTicks ?? 0) > 600) c.patient++
  }
  w.peakPnl = Math.max(w.peakPnl, w.pnl)
  w.coins = [...coins]
  if (fills.length) {
    if (!w.days.includes(today)) w.days = [...w.days, today]
    if (c.lastDay !== today) {
      const yesterday = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))
      c.streak = c.lastDay === yesterday ? c.streak + 1 : 1
      c.lastDay = today
    }
    c.bestStreak = Math.max(c.bestStreak, c.streak)
  }
  if (dailySweep) {
    w.sweeps++
    c.sweeps++
  }
  const paid: MissionPay[] = []
  const defs = weeklyMissions(w.week)
  const finished = defs.filter((d) => !w.done.includes(d.id) && d.progress(w) >= d.target)
  if (finished.length) w.done = [...w.done, ...finished.map((d) => d.id)]
  for (const d of finished) paid.push({ title: d.title, xp: d.xp, icon: d.icon, kind: 'weekly' })
  if (!w.swept && defs.every((d) => w.done.includes(d.id))) {
    w.swept = true
    paid.push({ title: 'All four weekly missions', xp: WEEKLY_SWEEP_XP, icon: '🏅', kind: 'weeklySweep' })
  }
  for (const l of CAREER) {
    const had = c.tiers[l.id] ?? 0
    const now2 = tiersReached(l, c)
    for (let i = had; i < now2; i++) paid.push({ title: `${l.name}: ${TIER_NAMES[i]}`, xp: TIER_XP[i], icon: l.icon, kind: 'career' })
    if (now2 > had) c.tiers[l.id] = now2
  }
  return { weekly: w, career: c, paid }
}
