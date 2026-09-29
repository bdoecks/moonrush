// Real chart history for the coins you care about, saved with your solo round. Without it, reloading the page
// (every update does) re-drew each coin's past candles from scratch, and your buy/sell markers (at the prices you
// really paid) no longer lined up with the made-up candles.
import type { Candle, MarketState, Timeframe } from '../types'
import { TIMEFRAMES } from '../types'
import { load, remove, save } from '../utils/storage'
import { candleStore } from './marketEngine'

const KEY = 'charts'
const MAX_COINS = 8
type Packed = [number, number, number, number, number, number][] // time, open, high, low, close, volume

const sig = (n: number) => (n === 0 ? 0 : Number(n.toPrecision(7)))

/** Save the charts of these coins (holdings, coins you traded this round, the one you're looking at). */
export function saveCharts(ids: string[]) {
  const out: Record<string, Partial<Record<Timeframe, Packed>>> = {}
  for (const id of [...new Set(ids)].slice(0, MAX_COINS)) {
    const c = candleStore.get(id)
    if (!c) continue
    const packed: Partial<Record<Timeframe, Packed>> = {}
    for (const tf of TIMEFRAMES) packed[tf] = (c[tf] ?? []).map((k) => [k.time, sig(k.open), sig(k.high), sig(k.low), sig(k.close), sig(k.volume)])
    out[id] = packed
  }
  try {
    save(KEY, out)
  } catch {
    remove(KEY) // storage full: fall back to rebuilt charts rather than failing the save
  }
}

/** After rebuilding charts for a loaded round, put back the real history we saved for those coins. */
export function restoreCharts(m: MarketState) {
  const saved = load<Record<string, Partial<Record<Timeframe, Packed>>>>(KEY)
  if (!saved) return
  const live = new Set(m.tokens.map((t) => t.id))
  for (const [id, packed] of Object.entries(saved)) {
    if (!live.has(id)) continue
    const c = {} as Record<Timeframe, Candle[]>
    for (const tf of TIMEFRAMES) c[tf] = (packed[tf] ?? []).map(([time, open, high, low, close, volume]) => ({ time, open, high, low, close, volume }))
    if (c['1s'].length || c['1m'].length) candleStore.set(id, c)
  }
}

export function clearCharts() {
  remove(KEY)
}
