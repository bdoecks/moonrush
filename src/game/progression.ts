import type { Accent, GameMode, ModeConfig } from '../types'

// ─── Levels ──────────────────────────────────────────────────────────────────
export const xpForLevel = (level: number) => Math.round(40 * Math.pow(Math.max(0, level - 1), 1.8))

export function levelFromXp(xp: number) {
  let lvl = 1
  while (lvl < 99 && xp >= xpForLevel(lvl + 1)) lvl++
  const cur = xpForLevel(lvl)
  const next = xpForLevel(lvl + 1)
  return { level: lvl, into: xp - cur, span: next - cur, progress: (xp - cur) / (next - cur) }
}

const TITLES: [number, string][] = [
  [50, 'Meme Lord'], [35, 'Alpha Caller'], [25, 'Whale'], [20, 'Diamond Hands'], [15, 'Chart Wizard'],
  [10, 'Trencher'], [8, 'Ape'], [5, 'Degenerate'], [3, 'Paper Hands'], [1, 'Rookie'],
]
export const titleFor = (level: number) => TITLES.find(([l]) => level >= l)![1]

// ─── Cosmetic unlocks ────────────────────────────────────────────────────────
export const ACCENTS: { id: Accent; name: string; color: string; level: number }[] = [
  { id: 'acid', name: 'Acid', color: '#c6ff3d', level: 1 },
  { id: 'plasma', name: 'Plasma', color: '#38e1ff', level: 3 },
  { id: 'vapor', name: 'Vapor', color: '#ff5ce1', level: 10 },
  { id: 'gold', name: 'Whale Gold', color: '#ffc93d', level: 25 },
  { id: 'prism', name: 'Prism', color: '#a78bfa', level: 50 },
]

export const UNLOCKS: { level: number; label: string }[] = [
  { level: 3, label: 'Plasma accent theme' },
  { level: 5, label: 'Hardcore mode' },
  { level: 10, label: 'Vapor accent theme' },
  { level: 25, label: 'Whale Gold accent theme' },
  { level: 50, label: 'Prism accent theme' },
]

// ─── Game modes ──────────────────────────────────────────────────────────────
export const MODES: Record<GameMode, ModeConfig> = {
  practice: { id: 'practice', name: 'Practice', tagline: 'Big bankroll, no clock, no pressure. Learn the tape.', startBalance: 100_000, durationTicks: null, rugMult: 1, unlockLevel: 1 },
  challenge: { id: 'challenge', name: 'Challenge', tagline: 'Turn $10,000 into $25,000 in 20 minutes.', startBalance: 10_000, durationTicks: 1200, target: 25_000, rugMult: 1, unlockLevel: 1 },
  arena: { id: 'arena', name: 'Arena', tagline: '15-minute round vs 20 simulated rivals. Ranked by % return.', startBalance: 10_000, durationTicks: 900, rugMult: 1, unlockLevel: 1 },
  hardcore: { id: 'hardcore', name: 'Hardcore', tagline: '$5,000, double rug rate, 15 minutes. Busted below $500.', startBalance: 5_000, durationTicks: 900, rugMult: 2, unlockLevel: 5 },
}

// ─── Round length ────────────────────────────────────────────────────────────
/** Round-length choices on the mode picker. 'default' = the mode's own clock; null = no time limit. Ticks are 1s at 1x. */
export type RoundLength = 'default' | 900 | 1800 | 3600 | null
export const ROUND_LENGTHS: { value: RoundLength; label: string }[] = [
  { value: 'default', label: 'Mode default' },
  { value: 900, label: '15 min' },
  { value: 1800, label: '30 min' },
  { value: 3600, label: '1 hour' },
  { value: null, label: 'No limit' },
]
export const lengthTicks = (mode: GameMode, len: RoundLength): number | null => (len === 'default' ? MODES[mode].durationTicks : len)

const lengthText = (ticks: number) => (ticks >= 3600 ? `${ticks / 3600 === 1 ? '1 hour' : `${ticks / 3600} hours`}` : `${Math.round(ticks / 60)} minutes`)

/** Mode description for a given round length (the MODES taglines assume the default clock). */
export function modeTagline(mode: GameMode, ticks: number | null): string {
  const t = ticks ? lengthText(ticks) : null
  switch (mode) {
    case 'practice':
      return t ? `Big bankroll, ${t} on the clock. Learn the tape.` : MODES.practice.tagline
    case 'challenge':
      return t ? `Turn $10,000 into $25,000 in ${t}.` : 'Turn $10,000 into $25,000. No clock: take your time.'
    case 'arena':
      return `${t ? `${t[0].toUpperCase()}${t.slice(1)} round` : 'Open-ended round'} vs 20 simulated rivals. Ranked by % return.`
    case 'hardcore':
      return `$5,000, double rug rate${t ? `, ${t}` : ', no clock'}. Busted below $500.`
  }
}
