import type { Chain, PadId } from '../types'

// Launchpads per chain. Names refer to real platforms so the sim feels familiar, but the badges are our own simple
// monograms (not their logos) and every number here is a game approximation of how each curve works — not live data.
//
// Every pad is a constant-product bonding curve with *virtual* reserves (the pump.fun model): the curve starts with
// `vNative` virtual coin and `vTokens` virtual tokens, sells `curveTokens` of the 1B supply, and migrates to a DEX pool
// once they're gone. Progress is tokens sold ÷ curveTokens, and the raise at graduation is fixed in the chain's coin.
export interface Launchpad {
  id: PadId
  chain: Chain
  name: string
  mono: string // badge monogram
  color: string
  bg: string
  dex: string // where it migrates
  vNative: number // virtual native reserve at launch
  vTokens: number // virtual token reserve at launch
  curveTokens: number // tokens sold on the curve before migration
  lpTokens?: number // tokens paired with the raise in the DEX pool at migration (default: supply − curveTokens)
  fee: number // trading fee on the curve
  dexFee: number // trading fee after migration
  // Market-cap-tiered DEX fee: [market cap in the chain's coin, fee]. Below each cap the step applies; the last
  // segment eases (log-linearly) down to the final fee. Overrides dexFee.
  dexFeeTiers?: [number, number][]
  creatorFee: number // share of volume paid to the creator
  weight: number // share of launches on its chain
  blurb: string
  tax?: boolean // coins can have buy/sell taxes paid to the creator
  mayhem?: boolean // an AI agent trades the coin for its first day
}

// Curve parameters are taken from each platform's published docs / contracts where they exist (researched Sept 2026):
// pump.fun program README, Raydium LaunchLab SDK defaults, Bags/Meteora DBC docs, four.meme docs, Flap's bonding-curve
// docs, Pons v2 docs. Where a platform uses a curve shape other than x·y = k (Bags' two price bands, four.meme's
// unpublished curve) the virtual reserves are fitted so start MC, raise and migration MC match the real ones.
// long.xyz publishes nothing, so its numbers remain a game approximation.
const PUMP = { vNative: 30, vTokens: 1_073_000_000, curveTokens: 793_100_000 } // ≈28 SOL start, 85 SOL raise, ≈411 SOL MC at migration
// PumpSwap canonical-pool fee by market cap in SOL (pump.fun fee docs): 1.25% under 420, 1.20% to 1,470, down to 0.30%.
const PUMPSWAP_TIERS: [number, number][] = [[420, 0.0125], [1_470, 0.012], [98_240, 0.003]]

export const LAUNCHPADS: Record<PadId, Launchpad> = {
  pump: {
    id: 'pump', chain: 'sol', name: 'pump.fun', mono: 'P', color: '#4ade80', bg: '#0f2a1b', dex: 'PumpSwap', ...PUMP,
    fee: 0.0125, dexFee: 0.003, dexFeeTiers: PUMPSWAP_TIERS, creatorFee: 0.003, weight: 0.46,
    blurb: 'The classic curve: starts ~28 SOL MC, 85 SOL raise, migrates to PumpSwap at ~411 SOL MC. Tiered DEX fee after.',
  },
  bonk: {
    id: 'bonk', chain: 'sol', name: 'bonk.fun', mono: 'B', color: '#ff9d2e', bg: '#2e1a06', dex: 'Raydium', ...PUMP,
    fee: 0.01, dexFee: 0.0025, creatorFee: 0.002, weight: 0.22,
    blurb: 'LaunchLab-style curve with the same ~85 SOL raise, migrates to a Raydium pool.',
  },
  stonk: {
    id: 'stonk', chain: 'sol', name: 'stonk.fun', mono: 'S', color: '#38bdf8', bg: '#08202e', dex: 'Raydium', ...PUMP,
    fee: 0.01, dexFee: 0.0025, creatorFee: 0.005, weight: 0.1,
    blurb: 'Raydium LaunchLab curve (same 85 SOL raise as pump), migrates to a Raydium CPMM pool with locked LP.',
  },
  bags: {
    // Meteora two-band curve fitted as x·y = k: ≈29 SOL start, 85 SOL raise, ≈500 SOL MC; the pool gets ≈170M tokens.
    id: 'bags', chain: 'sol', name: 'Bags', mono: 'BG', color: '#a3e635', bg: '#1c2808', dex: 'Meteora', vNative: 26.96, vTokens: 929_800_000, curveTokens: 705_900_000, lpTokens: 170_000_000,
    fee: 0.02, dexFee: 0.02, creatorFee: 0.01, weight: 0.12,
    blurb: 'Creator-royalty pad: 1% of all volume goes to the creator forever. 85 SOL raise, migrates at ~500 SOL MC.',
  },
  mayhem: {
    id: 'mayhem', chain: 'sol', name: 'Mayhem', mono: 'M', color: '#f43f5e', bg: '#2e0a12', dex: 'PumpSwap', ...PUMP,
    fee: 0.0125, dexFee: 0.003, dexFeeTiers: PUMPSWAP_TIERS, creatorFee: 0.003, weight: 0.1, mayhem: true,
    blurb: 'pump.fun curve plus an AI agent that trades the coin for its first 24h. Much wilder candles.',
  },
  four: {
    // four.meme's curve isn't published; fitted to its docs: 800M sold for ~18 BNB, then 200M + the raise seed the pool.
    id: 'four', chain: 'bsc', name: 'OpenFour', mono: '4', color: '#facc15', bg: '#2a2306', dex: 'PancakeSwap', vNative: 6, vTokens: 1_066_666_667, curveTokens: 800_000_000, lpTokens: 200_000_000,
    fee: 0.01, dexFee: 0.0025, creatorFee: 0, weight: 0.6,
    blurb: 'Starts ~5.6 BNB MC, sells 800M for an ~18 BNB raise, then lists on PancakeSwap at ~90 BNB MC.',
  },
  flap: {
    // Flap's published BSC curve: (x + 107,036,752)(y + 6.14) = K. 16 BNB raise; the pool opens at 16 BNB / 200M tokens.
    id: 'flap', chain: 'bsc', name: 'Flap', mono: 'F', color: '#c084fc', bg: '#1f0f2e', dex: 'PancakeSwap', vNative: 6.14, vTokens: 1_107_036_752, curveTokens: 800_000_000, lpTokens: 200_000_000,
    fee: 0.01, dexFee: 0.0025, creatorFee: 0, weight: 0.4, tax: true,
    blurb: 'Tax coins (tax goes to the creator). ~5.5 BNB start, 16 BNB raise; the pool opens ~11% above the curve’s end.',
  },
  pons: {
    // Pons v2: phantom 1.68 ETH reserve, 5/7 of supply sold for 4.2 ETH, ~204M tokens + the raise go to a Uniswap v4 pool.
    id: 'pons', chain: 'hood', name: 'Pons v2', mono: 'PN', color: '#34d399', bg: '#07261c', dex: 'Uniswap v4', vNative: 1.68, vTokens: 1_000_000_000, curveTokens: 714_285_714, lpTokens: 204_000_000,
    fee: 0.01, dexFee: 0.01, creatorFee: 0.003, weight: 0.6,
    blurb: 'ETH curve on Robinhood Chain: ~1.7 ETH start, 4.2 ETH raise, migrates to Uniswap v4 at ~20.6 ETH MC.',
  },
  long: {
    id: 'long', chain: 'hood', name: 'long.xyz', mono: 'L', color: '#e2e8f0', bg: '#1a1e25', dex: 'Uniswap v4', vNative: 3, vTokens: 1_073_000_000, curveTokens: 793_100_000,
    fee: 0.01, dexFee: 0.003, creatorFee: 0.005, weight: 0.4,
    blurb: 'Longer ETH curve (~8.5 ETH raise). long.xyz doesn’t publish its curve, so these numbers are a game estimate.',
  },
}

export const PAD_IDS = Object.keys(LAUNCHPADS) as PadId[]
export const padsFor = (chain: Chain) => PAD_IDS.filter((id) => LAUNCHPADS[id].chain === chain).map((id) => LAUNCHPADS[id])
export const defaultPad = (chain: Chain): PadId => padsFor(chain)[0].id

/** Stable pad for tokens from saves made before launchpads existed. */
export function padFromId(id: string, chain: Chain): PadId {
  const pads = padsFor(chain)
  const h = [...id].reduce((a, c) => (a * 33 + c.charCodeAt(0)) >>> 0, 11)
  let r = (h % 1000) / 1000
  for (const p of pads) if ((r -= p.weight) < 0) return p.id
  return pads[0].id
}
