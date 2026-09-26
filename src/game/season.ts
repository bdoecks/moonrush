// Weekly ranked seasons: finished rounds earn season points by placement; points set your tier; when the week ends
// the tier you reached pays out XP and a badge. Seasons follow the real calendar (Monday 00:00 local).
import type { GameMode, Player } from '../types'

export interface Tier {
  id: 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond' | 'legend'
  name: string
  min: number // season points needed
  icon: string
  color: string
  xp: number // end-of-season reward
}

export const TIERS: Tier[] = [
  { id: 'bronze', name: 'Bronze', min: 0, icon: '🥉', color: '#c7844a', xp: 100 },
  { id: 'silver', name: 'Silver', min: 150, icon: '🥈', color: '#b9c3cf', xp: 250 },
  { id: 'gold', name: 'Gold', min: 400, icon: '🥇', color: '#f5c542', xp: 500 },
  { id: 'platinum', name: 'Platinum', min: 800, icon: '💠', color: '#5fe0d0', xp: 900 },
  { id: 'diamond', name: 'Diamond', min: 1400, icon: '💎', color: '#7aa7ff', xp: 1500 },
  { id: 'legend', name: 'Legend', min: 2200, icon: '👑', color: '#ff7ad9', xp: 2500 },
]

export const tierFor = (points: number) => [...TIERS].reverse().find((t) => points >= t.min) ?? TIERS[0]
export const nextTier = (points: number) => TIERS.find((t) => t.min > points)

export interface SeasonState {
  id: number // season number
  points: number
  rounds: number
  bestRank: number | null
  firsts: number
}

export interface SeasonBadge {
  season: number
  tier: Tier['id']
  points: number
}

// Season 1 started Monday 5 Jan 2026.
const EPOCH = new Date(2026, 0, 5).getTime()
const WEEK = 7 * 86400_000

export const seasonNumber = (now = new Date()) => Math.max(1, Math.floor((now.getTime() - EPOCH) / WEEK) + 1)
export const seasonEnds = (n = seasonNumber()) => new Date(EPOCH + n * WEEK)
export const freshSeason = (n = seasonNumber()): SeasonState => ({ id: n, points: 0, rounds: 0, bestRank: null, firsts: 0 })

const MODE_WEIGHT: Partial<Record<GameMode, number>> = { arena: 1, hardcore: 1.3, challenge: 0.7 }
export const isRanked = (mode: GameMode) => MODE_WEIGHT[mode] !== undefined

/** Season points for finishing a round at `rank` of `field`. Practice rounds aren't ranked. */
export function placementPoints(mode: GameMode, rank: number, field: number, won: boolean) {
  const w = MODE_WEIGHT[mode]
  if (!w) return 0
  const f = field > 1 ? 1 - (rank - 1) / (field - 1) : 1
  const base = 5 + 95 * f ** 1.6 + (rank === 1 ? 25 : 0) + (mode === 'challenge' && won ? 30 : 0)
  return Math.round(base * w)
}

/**
 * Simulated rivals' season tier, from their skill and level, so the board shows a spread of tiers.
 * Stable for the week (seeded by the season number).
 */
export function rivalPoints(p: Pick<Player, 'id' | 'skill' | 'level'>, season = seasonNumber()) {
  let h = season * 2654435761
  for (const c of p.id) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  const noise = ((h >>> 0) % 1000) / 1000
  return Math.max(0, Math.round(p.level * 28 + p.skill * 520 + 250 + noise * 300))
}

/** Countdown text like "3d 4h" or "5h 12m". */
export function fmtCountdown(ms: number) {
  const m = Math.max(0, Math.floor(ms / 60000))
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  return d > 0 ? `${d}d ${h}h` : `${h}h ${m % 60}m`
}
