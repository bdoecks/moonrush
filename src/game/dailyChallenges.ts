// Daily challenges: three goals a day (one easy, one medium, one hard), the same for everyone on that calendar day.
// Progress comes from your own fills in any mode (solo rounds, rooms, the World) and is saved with your rewards, so it
// follows your account. They pay XP only: XP is never money, so nothing here has to run on the server.
import type { Trade } from '../types'
import { dayKey } from './daily'

export interface DailyState {
  date: string // YYYY-MM-DD (local time), the day these numbers belong to
  trades: number
  volume: number // USD
  wins: number // sells in profit
  pnl: number // realized USD, net
  peakPnl: number // the highest `pnl` got today (a later loss doesn't undo a finished goal's progress bar)
  bestPct: number // best single sell, in %
  coins: string[] // different coins traded (token ids)
  cooked: number
  done: string[] // challenge ids already paid
  swept?: boolean // the all-three bonus was paid
}

export type DailyTier = 'easy' | 'medium' | 'hard'

export interface DailyDef {
  id: string
  tier: DailyTier
  icon: string
  title: string
  desc: string
  xp: number
  target: number
  unit?: '%' | '$'
  progress: (s: DailyState) => number
}

export const DAILY_SWEEP_XP = 150
const MAX_COINS = 40 // enough for any goal; keeps the save small

const POOL: Record<DailyTier, DailyDef[]> = {
  easy: [
    { id: 'trades5', tier: 'easy', icon: '🔁', title: 'Make 5 trades', desc: 'Any 5 buys or sells.', xp: 50, target: 5, progress: (s) => s.trades },
    { id: 'coins3', tier: 'easy', icon: '🧺', title: 'Trade 3 different coins', desc: 'Buy or sell 3 different coins.', xp: 50, target: 3, progress: (s) => s.coins.length },
    { id: 'win1', tier: 'easy', icon: '✅', title: 'Close a trade in profit', desc: 'Sell something for more than you paid.', xp: 50, target: 1, progress: (s) => s.wins },
    { id: 'vol2k', tier: 'easy', icon: '📊', title: 'Trade $2,000 of volume', desc: 'Buys and sells both count.', xp: 50, target: 2_000, unit: '$', progress: (s) => s.volume },
    { id: 'pump10', tier: 'easy', icon: '📈', title: 'Catch a 10% pump', desc: 'Close a single trade at +10% or better.', xp: 50, target: 10, unit: '%', progress: (s) => s.bestPct },
  ],
  medium: [
    { id: 'win3', tier: 'medium', icon: '🎯', title: 'Close 3 trades in profit', desc: 'Three sells in the green.', xp: 100, target: 3, progress: (s) => s.wins },
    { id: 'vol10k', tier: 'medium', icon: '📊', title: 'Trade $10,000 of volume', desc: 'Buys and sells both count.', xp: 100, target: 10_000, unit: '$', progress: (s) => s.volume },
    { id: 'coins6', tier: 'medium', icon: '🧺', title: 'Trade 6 different coins', desc: 'Spread the risk. Or the degeneracy.', xp: 100, target: 6, progress: (s) => s.coins.length },
    { id: 'pump25', tier: 'medium', icon: '🚀', title: 'Catch a 25% pump', desc: 'Close a single trade at +25% or better.', xp: 100, target: 25, unit: '%', progress: (s) => s.bestPct },
    { id: 'profit250', tier: 'medium', icon: '💵', title: 'Bank $250 profit', desc: 'Be up $250 on the day from closed trades.', xp: 100, target: 250, unit: '$', progress: (s) => s.peakPnl },
    { id: 'cook1', tier: 'medium', icon: '🍳', title: 'Cook a coin', desc: 'Launch your own memecoin from the Cooking tab.', xp: 100, target: 1, progress: (s) => s.cooked },
    { id: 'trades20', tier: 'medium', icon: '🔁', title: 'Make 20 trades', desc: 'Any 20 buys or sells.', xp: 100, target: 20, progress: (s) => s.trades },
  ],
  hard: [
    { id: 'pump100', tier: 'hard', icon: '🌕', title: 'Hit a 2x', desc: 'Close a single trade at +100% or better.', xp: 200, target: 100, unit: '%', progress: (s) => s.bestPct },
    { id: 'profit1k', tier: 'hard', icon: '💰', title: 'Bank $1,000 profit', desc: 'Be up $1,000 on the day from closed trades.', xp: 200, target: 1_000, unit: '$', progress: (s) => s.peakPnl },
    { id: 'win8', tier: 'hard', icon: '🏹', title: 'Close 8 trades in profit', desc: 'Eight sells in the green.', xp: 200, target: 8, progress: (s) => s.wins },
    { id: 'vol50k', tier: 'hard', icon: '🐳', title: 'Trade $50,000 of volume', desc: 'Whale hours. Buys and sells both count.', xp: 200, target: 50_000, unit: '$', progress: (s) => s.volume },
  ],
}

export const freshDaily = (date: string): DailyState => ({ date, trades: 0, volume: 0, wins: 0, pnl: 0, peakPnl: 0, bestPct: 0, coins: [], cooked: 0, done: [] })

/** Today's numbers, or a clean sheet if the saved ones are from another day. */
export const dailyFor = (state: DailyState | undefined, now = new Date()): DailyState => {
  const date = dayKey(now)
  return state?.date === date ? state : freshDaily(date)
}

/**
 * The three challenges for a day. Each tier steps through its list one a day, so a goal never repeats two days running,
 * and the list lengths (5, 7, 4) share no factor: the same trio only comes back after 140 days.
 */
export function dailyChallenges(date: string, noCooking = false): DailyDef[] {
  const [y, m, d] = date.split('-').map(Number)
  const n = Math.floor(Date.UTC(y, m - 1, d) / 86_400_000)
  // (`noCooking`: while the Cooking page is closed, a day whose turn is "Cook a coin" gets the next goal on the list.)
  return (['easy', 'medium', 'hard'] as const).map((tier) => {
    const pick = POOL[tier][n % POOL[tier].length]
    return noCooking && pick.id === 'cook1' ? POOL[tier][(n + 1) % POOL[tier].length] : pick
  })
}

/** Add fills and cooked coins to today. Returns the new numbers, the challenges that finished just now, and the bonus. */
export function foldDailies(state: DailyState | undefined, fills: Trade[], cooked = 0, now = new Date(), noCooking = false): { state: DailyState; completed: DailyDef[]; swept: boolean } {
  const s = { ...dailyFor(state, now) }
  const coins = new Set(s.coins)
  for (const t of fills) {
    s.trades++
    s.volume += t.value
    if (coins.size < MAX_COINS) coins.add(t.tokenId)
    if (t.side !== 'sell') continue
    const pnl = t.pnl ?? 0
    s.pnl += pnl
    if (pnl > 0) s.wins++
    s.bestPct = Math.max(s.bestPct, (t.pnlPct ?? 0) * 100)
  }
  s.peakPnl = Math.max(s.peakPnl, s.pnl)
  s.coins = [...coins]
  s.cooked += cooked
  const defs = dailyChallenges(s.date, noCooking)
  const completed = defs.filter((d) => !s.done.includes(d.id) && d.progress(s) >= d.target)
  if (completed.length) s.done = [...s.done, ...completed.map((d) => d.id)]
  const swept = !s.swept && defs.every((d) => s.done.includes(d.id))
  if (swept) s.swept = true
  return { state: s, completed, swept }
}

/** Milliseconds until the device's midnight, when the next three arrive. */
export const msToNextDaily = (now = new Date()) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime()
