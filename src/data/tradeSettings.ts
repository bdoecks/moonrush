import type { Chain, InstantPrefs, TradeSetting, TradeSettings } from '../types'
import { CHAINS } from './chains'

// Default GMGN-style execution settings per chain: P1 = cheap, P2 = protected, P3 = turbo.
const s = (slippage: number | null, priority: number, tip: number, antiMev: boolean): TradeSetting => ({ slippage, priority, tip, antiMev })

export const DEFAULT_TRADE_SETTINGS: TradeSettings = {
  sol: {
    buy: [s(20, 0.001, 0.001, false), s(25, 0.003, 0.003, true), s(null, 0.01, 0.01, false)],
    sell: [s(20, 0.001, 0.001, false), s(30, 0.003, 0.003, true), s(null, 0.01, 0.01, false)],
  },
  bsc: {
    buy: [s(15, 0.0002, 0, false), s(20, 0.0005, 0.0002, true), s(null, 0.0015, 0.0005, false)],
    sell: [s(15, 0.0002, 0, false), s(25, 0.0005, 0.0002, true), s(null, 0.0015, 0.0005, false)],
  },
  hood: {
    buy: [s(15, 0.00002, 0, false), s(20, 0.00005, 0.00002, true), s(null, 0.0002, 0.0001, false)],
    sell: [s(15, 0.00002, 0, false), s(25, 0.00005, 0.00002, true), s(null, 0.0002, 0.0001, false)],
  },
}

/** Fee labels and quick chips per chain (in the chain's coin). */
export const FEE_UI: Record<Chain, { priorityLabel: string; tipLabel: string; priorityChips: number[]; tipChips: number[]; step: number }> = {
  sol: { priorityLabel: 'Priority fee', tipLabel: 'Jito tip', priorityChips: [0.001, 0.003, 0.01], tipChips: [0, 0.001, 0.005], step: 0.0005 },
  bsc: { priorityLabel: 'Gas', tipLabel: 'Builder tip', priorityChips: [0.0002, 0.0005, 0.0015], tipChips: [0, 0.0002, 0.0005], step: 0.0001 },
  hood: { priorityLabel: 'Gas', tipLabel: 'Builder tip', priorityChips: [0.00002, 0.00005, 0.0002], tipChips: [0, 0.00002, 0.0001], step: 0.00001 },
}

export const SLIPPAGE_CHIPS = [5, 10, 20, 30, 50]

export const DEFAULT_INSTANT: InstantPrefs = {
  buyUnit: 'native',
  sellUnit: 'pct',
  statsUnit: 'usd',
  pnlUnit: 'value',
  pnlScope: 'total',
  buyUsd: [[10, 25, 50, 100], [50, 100, 250, 500], [250, 500, 1000, 2500]],
  sellUsd: [[10, 25, 50, 100], [50, 100, 250, 500], [250, 500, 1000, 2500]],
  sellNative: { sol: CHAINS.sol.presets, bsc: CHAINS.bsc.presets, hood: CHAINS.hood.presets },
}

// USD of priority fee + tip that gets median inclusion speed (same reference the engine uses).
export const SPEED_REF_USD: Record<Chain, number> = { sol: 0.3, bsc: 0.3, hood: 0.1 }

/** Rough inclusion speed from the fee (mirrors the engine's model). */
export function speedOf(s: TradeSetting, chain: Chain, nativeUsd: number) {
  const delay = (1 / (1 + ((s.priority + s.tip) * nativeUsd) / SPEED_REF_USD[chain])) * (s.antiMev ? 1.25 : 1)
  return delay < 0.35 ? { label: 'Turbo', cls: 'text-up', pct: 100 } : delay < 0.6 ? { label: 'Fast', cls: 'text-up', pct: 72 } : delay < 0.85 ? { label: 'Normal', cls: 'text-warn', pct: 45 } : { label: 'Slow', cls: 'text-down', pct: 20 }
}

/** Fill in missing or malformed settings (older saves). */
export function migrateTradeSettings(ts: Partial<TradeSettings> | undefined): TradeSettings {
  const out = {} as TradeSettings
  for (const c of Object.keys(DEFAULT_TRADE_SETTINGS) as Chain[]) {
    const d = DEFAULT_TRADE_SETTINGS[c]
    const cur = ts?.[c]
    const side = (k: 'buy' | 'sell') => d[k].map((def, i) => ({ ...def, ...(cur?.[k]?.[i] ?? {}) }))
    out[c] = { buy: side('buy'), sell: side('sell') }
  }
  return out
}
