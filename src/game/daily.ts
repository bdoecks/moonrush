// Real-calendar-day PnL history for the portfolio's PnL calendar (GMGN-style). Rounds reset the portfolio, but the
// calendar is lifetime: every fill is added to the real day it happened on and saved with the profile.
import type { Trade } from '../types'

export interface DayStat {
  pnl: number // realized USD
  buys: number
  sells: number
  wins: number // sells in profit
  volume: number // USD traded
  best?: { ticker: string; pnl: number }
  worst?: { ticker: string; pnl: number }
}

export type Daily = Record<string, DayStat> // key: YYYY-MM-DD (local time)

export const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** Add fills to today's entry. Returns a new object only when something changed. */
export function foldDaily(daily: Daily | undefined, fills: Trade[], now = new Date()): Daily {
  const key = dayKey(now)
  const d: DayStat = { ...(daily?.[key] ?? { pnl: 0, buys: 0, sells: 0, wins: 0, volume: 0 }) }
  for (const t of fills) {
    d.volume += t.value
    if (t.side === 'buy') {
      d.buys++
      continue
    }
    const pnl = t.pnl ?? 0
    d.sells++
    d.pnl += pnl
    if (pnl > 0) d.wins++
    if (!d.best || pnl > d.best.pnl) d.best = { ticker: t.ticker, pnl }
    if (!d.worst || pnl < d.worst.pnl) d.worst = { ticker: t.ticker, pnl }
  }
  return { ...daily, [key]: d }
}

/** Trades at the front of `next` that weren't in `prev` (both newest first). A reset or reload returns none. */
export function newTrades(next: Trade[], prev: Trade[]): Trade[] {
  if (next === prev || !next.length) return []
  const head = prev[0]
  if (!head) return next.length <= 12 ? next : [] // first fills of a fresh round (one per selected wallet)
  const i = next.indexOf(head)
  return i > 0 ? next.slice(0, i) : []
}

/** Sum a set of days. */
export function sumDays(daily: Daily | undefined, keys: string[]) {
  const out = { pnl: 0, buys: 0, sells: 0, wins: 0, volume: 0, days: 0, upDays: 0, downDays: 0, best: undefined as undefined | { key: string; pnl: number } }
  for (const k of keys) {
    const d = daily?.[k]
    if (!d) continue
    out.pnl += d.pnl
    out.buys += d.buys
    out.sells += d.sells
    out.wins += d.wins
    out.volume += d.volume
    out.days++
    if (d.pnl > 0) out.upDays++
    else if (d.pnl < 0) out.downDays++
    if (d.sells && (!out.best || d.pnl > out.best.pnl)) out.best = { key: k, pnl: d.pnl }
  }
  return out
}
