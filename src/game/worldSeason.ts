// World seasons: one calendar month each (UTC). Season 1 is October 2026, the month the World opened. Shared by the
// server (who ranks, when a season closes) and the game (the countdown), so it must stay pure.

const FIRST = { year: 2026, month: 9 } // October (0-based month)
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export const dayKey = (d = new Date()) => d.toISOString().slice(0, 10) // UTC day, e.g. 2026-10-03
export const monthKey = (d = new Date()) => d.toISOString().slice(0, 7) // UTC month, e.g. 2026-10

export interface WorldSeason {
  n: number // season number (1 = October 2026)
  key: string // its month key
  name: string // e.g. "October 2026"
  endsAt: number // ms when it closes (next month, 00:00 UTC)
}

export function worldSeason(d = new Date()): WorldSeason {
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth()
  return { n: Math.max(1, (y - FIRST.year) * 12 + (m - FIRST.month) + 1), key: monthKey(d), name: `${MONTHS[m]} ${y}`, endsAt: Date.UTC(y, m + 1, 1) }
}

/** End of today (UTC), when the daily board resets. */
export const dayEndsAt = (d = new Date()) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)
