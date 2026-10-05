import { fmtUpTo } from '../utils/format'
import type { Chain } from '../types'

// Chains are flavour for the simulation: native coin prices here are simulated, not live market data.
export interface ChainMeta {
  id: Chain
  name: string
  short: string // chip label
  native: string // coin you pay with
  color: string
  glyph: string
  launchpad: string
  dex: string
  basePrice: number // simulated USD anchor for the native coin (set from real prices, 2026-09-23)
  decimals: number // display decimals for native amounts
  quick: number[] // quick-buy amounts (P1/P2/P3) in native units
  presets: number[][] // trade-panel amount chips per P slot, in native units
  weight: number // share of launches
}

export const CHAINS: Record<Chain, ChainMeta> = {
  sol: {
    id: 'sol', name: 'Solana', short: 'SOL', native: 'SOL', color: '#9b6bff', glyph: '◎', launchpad: 'MoonPad', dex: 'MoonSwap',
    basePrice: 115, decimals: 3, quick: [0.25, 1, 5], presets: [[0.1, 0.25, 0.5, 1], [0.5, 1, 2, 5], [2, 5, 10, 25]], weight: 0.5,
  },
  bsc: {
    id: 'bsc', name: 'BNB Chain', short: 'BNB', native: 'BNB', color: '#f3ba2f', glyph: '◆', launchpad: 'BeanPad', dex: 'BeanSwap',
    basePrice: 767, decimals: 3, quick: [0.05, 0.25, 1], presets: [[0.02, 0.05, 0.1, 0.25], [0.1, 0.25, 0.5, 1], [0.5, 1, 2.5, 5]], weight: 0.3,
  },
  hood: {
    id: 'hood', name: 'Robinhood Chain', short: 'HOOD', native: 'ETH', color: '#c3f53c', glyph: '⟠', launchpad: 'HoodPad', dex: 'HoodSwap',
    basePrice: 2688, decimals: 4, quick: [0.01, 0.05, 0.25], presets: [[0.005, 0.01, 0.025, 0.05], [0.025, 0.05, 0.1, 0.25], [0.1, 0.25, 0.5, 1]], weight: 0.2,
  },
}
export const CHAIN_IDS: Chain[] = ['sol', 'bsc', 'hood']

export function fmtNative(amount: number, chain: Chain, withUnit = true) {
  const c = CHAINS[chain]
  const a = Math.abs(amount)
  const digits = a >= 1000 ? 0 : a >= 100 ? 1 : a >= 1 ? 2 : c.decimals
  const s = fmtUpTo(amount, digits)
  return withUnit ? `${s} ${c.native}` : s
}
