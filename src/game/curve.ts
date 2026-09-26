// Virtual-reserve bonding curves (x · y = k), priced in the chain's coin. See data/launchpads.ts.
import { LAUNCHPADS } from '../data/launchpads'
import type { PadId } from '../types'

const SUPPLY = 1_000_000_000

export interface CurveState {
  x: number // virtual native reserve
  y: number // virtual token reserve
  sold: number // tokens bought off the curve
  raised: number // real native in the curve
  progress: number // 0..100
}

export const curveK = (pad: PadId) => LAUNCHPADS[pad].vNative * LAUNCHPADS[pad].vTokens

/** Starting price in native per token. */
export const startPriceNative = (pad: PadId) => LAUNCHPADS[pad].vNative / LAUNCHPADS[pad].vTokens

/** Price (native per token) at which the curve runs out of tokens and migrates. */
export function gradPriceNative(pad: PadId) {
  const p = LAUNCHPADS[pad]
  const y = p.vTokens - p.curveTokens
  return curveK(pad) / y / y
}

/** Native raised when the curve completes. */
export function gradRaise(pad: PadId) {
  const p = LAUNCHPADS[pad]
  return curveK(pad) / (p.vTokens - p.curveTokens) - p.vNative
}

export const launchMcapUsd = (pad: PadId, nativeUsd: number) => startPriceNative(pad) * SUPPLY * nativeUsd
export const gradMcapUsd = (pad: PadId, nativeUsd: number) => gradPriceNative(pad) * SUPPLY * nativeUsd

/** Curve state for a price in native per token (clamped to the curve's range). */
export function curveAt(pad: PadId, priceNative: number): CurveState {
  const p = LAUNCHPADS[pad]
  const k = curveK(pad)
  const pr = Math.min(Math.max(priceNative, startPriceNative(pad)), gradPriceNative(pad))
  const x = Math.sqrt(k * pr)
  const y = Math.sqrt(k / pr)
  const sold = p.vTokens - y
  return { x, y, sold, raised: x - p.vNative, progress: Math.min(100, (sold / p.curveTokens) * 100) }
}

/**
 * Pool liquidity in USD that makes the generic constant-product quotes (Q = liquidity / 2) match the curve exactly:
 * Q = x · nativeUsd and T = Q / price = y.
 */
export const curveLiquidityUsd = (pad: PadId, priceNative: number, nativeUsd: number) => 2 * curveAt(pad, priceNative).x * nativeUsd

/** Tokens the DEX pool is seeded with at migration. */
export const lpTokens = (pad: PadId) => LAUNCHPADS[pad].lpTokens ?? SUPPLY - LAUNCHPADS[pad].curveTokens

/**
 * Price (native per token) the DEX pool opens at: the raise over the LP tokens. Equals the curve's end price on pads
 * designed for a seamless handoff (pump, four, Pons); on Flap the pool opens ~11% higher.
 */
export const migrationPriceNative = (pad: PadId) => gradRaise(pad) / lpTokens(pad)

/** Liquidity of the DEX pool right after migration: the raise paired with the tokens left for LP. */
export const migratedLiquidityUsd = (pad: PadId, nativeUsd: number) => 2 * gradRaise(pad) * nativeUsd
