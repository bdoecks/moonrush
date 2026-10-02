// Rolling 1m / 5m / 24h volume and txns, as exponentially-decaying sums (the 1h window is Token.volume/buys/sells).
// A sum that decays by 1/N per tick holds about N ticks' worth of activity, so N follows the market's clock:
// Classic ticks are 6 game-seconds (10 ticks = 1 minute), Realistic ticks are 1 second (60 ticks = 1 minute).
import type { Token, Win, WinStats } from '../types'

let K1M = 1 - 1 / 10
let K5M = 1 - 1 / 50
let K24H = 1 - 1 / 14400

/** Set by the market engine's `setClock`: how many game-seconds one tick is. */
export function setWinClock(secPerTick: number) {
  K1M = 1 - secPerTick / 60
  K5M = 1 - secPerTick / 300
  K24H = 1 - secPerTick / 86400
}

/** Estimate windows for a token that has none yet (new saves, fresh history) from its 1h numbers. */
export function seedWin(t: Pick<Token, 'volume' | 'buys' | 'sells' | 'createdAt'>, now: number): WinStats {
  const hours = Math.max(1, (now - t.createdAt) / 3600)
  const day = Math.min(24, hours) * 0.6 + 0.4 // older coins were usually quieter earlier in the day
  return {
    v1m: t.volume / 60, v5m: t.volume / 12, v24h: t.volume * day,
    b1m: t.buys / 60, s1m: t.sells / 60, b5m: t.buys / 12, s5m: t.sells / 12, b24h: t.buys * day, s24h: t.sells * day,
  }
}

export const getWin = (t: Token, now: number) => t.win ?? seedWin(t, now)

/** One tick of decay plus this tick's activity. Returns a new object. */
export function stepWin(w: WinStats, vol: number, buys: number, sells: number): WinStats {
  return {
    v1m: w.v1m * K1M + vol, v5m: w.v5m * K5M + vol, v24h: w.v24h * K24H + vol,
    b1m: w.b1m * K1M + buys, s1m: w.s1m * K1M + sells,
    b5m: w.b5m * K5M + buys, s5m: w.s5m * K5M + sells,
    b24h: w.b24h * K24H + buys, s24h: w.s24h * K24H + sells,
  }
}

/** Add trades mid-tick (your fills, bots) without decaying. */
export function addWin(w: WinStats, vol: number, buys: number, sells: number): WinStats {
  return {
    ...w,
    v1m: w.v1m + vol, v5m: w.v5m + vol, v24h: w.v24h + vol,
    b1m: w.b1m + buys, s1m: w.s1m + sells, b5m: w.b5m + buys, s5m: w.s5m + sells, b24h: w.b24h + buys, s24h: w.s24h + sells,
  }
}

// Decaying sums can drift slightly out of order; keep 1m ≤ 5m ≤ 1h ≤ 24h so the numbers always read sensibly.
const pick = (win: Win, h: number, m1: number, m5: number, d1: number) => {
  const five = Math.min(m5, h)
  return win === '1h' ? h : win === '24h' ? Math.max(d1, h) : win === '5m' ? five : Math.min(m1, five)
}
export function winVolume(t: Token, win: Win, now: number) {
  const w = getWin(t, now)
  return pick(win, t.volume, w.v1m, w.v5m, w.v24h)
}
export function winBuys(t: Token, win: Win, now: number) {
  const w = getWin(t, now)
  return pick(win, t.buys, w.b1m, w.b5m, w.b24h)
}
export function winSells(t: Token, win: Win, now: number) {
  const w = getWin(t, now)
  return pick(win, t.sells, w.s1m, w.s5m, w.s24h)
}
export const winTxns = (t: Token, win: Win, now: number) => winBuys(t, win, now) + winSells(t, win, now)
