import { CHAIN_IDS, CHAINS, fmtNative } from '../data/chains'
import { LAUNCHPADS, PUMPSWAP_FEES } from '../data/launchpads'
import { SPEED_REF_USD } from '../data/tradeSettings'
import type { Chain, MarketState, Portfolio, Position, Token, Trade, TradeSetting } from '../types'
import { applyPlayerTrade, quoteBuy, quoteSell } from './marketEngine'

export const FEE_RATE = 0.01 // fallback fee when a token has no launchpad
export const MIN_TRADE = 1

/**
 * What a trade costs on this token: the launchpad's curve fee while bonding, the DEX fee after migration, plus any
 * buy/sell tax on tax pads (Flap). Taxes go to the coin's creator.
 */
export function tradeFee(t: Pick<Token, 'status' | 'tax'> & { pad?: Token['pad']; mcap?: number; chain?: Chain }, side: 'buy' | 'sell') {
  const pad = t.pad ? LAUNCHPADS[t.pad] : undefined
  const base = !pad ? FEE_RATE : t.status === 'bonding' ? pad.fee : pad.pumpSwap ? pumpSwapTier(t)[2] : dexFee(pad.dexFeeTiers, pad.dexFee, t)
  return base + (t.tax ? (side === 'buy' ? t.tax.buy : t.tax.sell) : 0)
}

/** The PumpSwap fee tier a migrated pump.fun coin is in right now: [upper MC in SOL, creator fee, total fee]. */
export function pumpSwapTier(t: { mcap?: number; chain?: Chain }) {
  const mcSol = (t.mcap ?? 0) / CHAINS[t.chain ?? 'sol'].basePrice
  return PUMPSWAP_FEES.find((r) => mcSol < r[0]) ?? PUMPSWAP_FEES[PUMPSWAP_FEES.length - 1]
}

/** Market-cap-tiered DEX fee (PumpSwap-style). Market cap is measured in the chain's coin at its anchor price. */
function dexFee(tiers: [number, number][] | undefined, flat: number, t: { mcap?: number; chain?: Chain }) {
  if (!tiers || t.mcap === undefined || !t.chain) return flat
  const mc = t.mcap / CHAINS[t.chain].basePrice
  for (let i = 0; i < tiers.length - 1; i++) if (mc < tiers[i][0]) return tiers[i][1]
  const [[c0, f0], [c1, f1]] = [tiers[tiers.length - 2], tiers[tiers.length - 1]]
  if (mc >= c1) return f1
  return f0 + (f1 - f0) * (Math.log(mc / c0) / Math.log(c1 / c0))
}

/** Share of a token's volume paid to its creator: the pad's creator fee plus the average tax. */
export function creatorRate(t: Pick<Token, 'pad' | 'tax'> & { status?: Token['status']; mcap?: number; chain?: Chain }) {
  const pad = LAUNCHPADS[t.pad]
  // pump.fun after migration: PumpSwap's dynamic creator fee (0.95% just after, tapering to 0.05% as it grows).
  const base = pad?.pumpSwap && t.status === 'graduated' ? pumpSwapTier(t)[1] : pad?.creatorFee ?? 0
  return base + (t.tax ? (t.tax.buy + t.tax.sell) / 2 : 0)
}

export interface BuyPreview {
  total: number
  fee: number
  netIn: number
  qty: number
  avgPrice: number
  newPrice: number
  slippage: number
}

export interface SellPreview {
  qty: number
  gross: number
  fee: number
  net: number
  avgPrice: number
  newPrice: number
  slippage: number
  pnl: number
  pnlPct: number
}

export function previewBuy(t: Token, usd: number): BuyPreview {
  const fee = usd * tradeFee(t, 'buy')
  const netIn = Math.max(0, usd - fee)
  const q = quoteBuy(t, netIn)
  return { total: usd, fee, netIn, qty: q.qty, avgPrice: q.avgPrice, newPrice: q.newPrice, slippage: q.slippage }
}

export function previewSell(t: Token, qty: number, pos?: Position): SellPreview {
  const q = quoteSell(t, qty)
  const fee = q.usdOut * tradeFee(t, 'sell')
  const net = q.usdOut - fee
  const cost = pos ? pos.avgEntry * qty : 0
  return { qty, gross: q.usdOut, fee, net, avgPrice: q.avgPrice, newPrice: q.newPrice, slippage: q.slippage, pnl: net - cost, pnlPct: cost > 0 ? net / cost - 1 : 0 }
}

/**
 * Tokens to sell so you receive about `netUsd` after fees and price impact (sell-by-value). Capped at the position.
 * Bisection on the same constant-product quote the engine fills with.
 */
export function qtyForProceeds(t: Token, maxQty: number, netUsd: number) {
  if (!(netUsd > 0) || !(maxQty > 0)) return 0
  if (previewSell(t, maxQty).net <= netUsd) return maxQty
  let lo = 0
  let hi = maxQty
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (previewSell(t, mid).net < netUsd) lo = mid
    else hi = mid
  }
  return hi
}

type Result =
  | { ok: true; portfolio: Portfolio; market: MarketState; trade: Trade; firstTimeToken: boolean; swapped?: { usd: number; native: number; chain: Chain }; exec?: Friction }
  // A failed order can still burn its priority fee (like a failed on-chain tx).
  | { ok: false; error: string; burn?: { chain: Chain; native: number } }

export interface ExecOpts {
  autoSwap?: boolean
  setting?: TradeSetting // GMGN-style slippage / fees / anti-MEV; omitted for copy trades, bundles and bots
  rand?: () => number
  who?: { name: string; pid?: string; addr?: string } // rooms: the server tags the tape with who traded
}

// ─── Execution frictions ─────────────────────────────────────────────────────

export interface Friction {
  gasNative: number
  gasUsd: number
  lag: number // fraction the price moved against you while waiting to land
  mev: number // fraction lost to a sandwich
  sandwiched: boolean
  tolerance: number // max slippage allowed (fraction)
}

const gauss = (rand: () => number) => Math.sqrt(-2 * Math.log(Math.max(1e-12, rand()))) * Math.cos(2 * Math.PI * rand())

/**
 * What happens between clicking and landing. Higher priority fee + tip lands faster, so the price has less time to
 * run against you. Without anti-MEV, sizeable orders on thin pools can get sandwiched. Anti-MEV routes privately:
 * no sandwiches, but a little slower.
 */
export function frictions(t: Token, impact: number, s: TradeSetting, nativeUsd: number, rand: () => number = Math.random): Friction {
  const gasNative = s.priority + s.tip
  const gasUsd = gasNative * nativeUsd
  const delay = (1 / (1 + gasUsd / SPEED_REF_USD[t.chain])) * (s.antiMev ? 1.25 : 1)
  const heat = Math.min(1.5, Math.max(0.2, (t.hype / 100) * (t.status === 'bonding' ? 1.5 : 1)))
  const lag = Math.abs(gauss(rand)) * t.volatility * 0.9 * delay * heat
  const sandwichChance = s.antiMev || impact < 0.01 ? 0 : Math.min(0.5, impact * 3) * (t.status === 'bonding' ? 1 : 0.6)
  const sandwiched = rand() < sandwichChance
  const mev = sandwiched ? impact * (0.3 + 0.4 * rand()) : 0
  const tolerance = s.slippage === null ? Math.max(0.15, impact * 1.3 + 0.08) : s.slippage / 100
  return { gasNative, gasUsd, lag, mev, sandwiched, tolerance }
}

/** Expected (not random) frictions for previews: average lag and sandwich odds. */
export function expectedFrictions(t: Token, impact: number, s: TradeSetting, nativeUsd: number) {
  const gasUsd = (s.priority + s.tip) * nativeUsd
  const delay = (1 / (1 + gasUsd / SPEED_REF_USD[t.chain])) * (s.antiMev ? 1.25 : 1)
  const heat = Math.min(1.5, Math.max(0.2, (t.hype / 100) * (t.status === 'bonding' ? 1.5 : 1)))
  const sandwichChance = s.antiMev || impact < 0.01 ? 0 : Math.min(0.5, impact * 3) * (t.status === 'bonding' ? 1 : 0.6)
  return {
    gasUsd,
    lag: 0.8 * t.volatility * 0.9 * delay * heat,
    sandwichChance,
    tolerance: s.slippage === null ? Math.max(0.15, impact * 1.3 + 0.08) : s.slippage / 100,
    speed: delay < 0.35 ? 'Turbo' : delay < 0.6 ? 'Fast' : delay < 0.85 ? 'Normal' : 'Slow',
  }
}

const slipError = (eff: number, tol: number, burn: number, chain: Chain) =>
  `Slippage exceeded: price moved ${(eff * 100).toFixed(1)}% vs your ${+(tol * 100).toFixed(tol < 0.1 ? 1 : 0)}% max${burn > 0 ? ` · ${fmtNative(burn, chain)} priority fee burned` : ''}`

export const SWAP_FEE = 0.003 // fictional 0.3% swap fee between USD and chain coins
export const nativePrice = (m: MarketState, chain: Chain) => m.native?.[chain]?.price ?? CHAINS[chain].basePrice
export const emptyBalances = (): Record<Chain, number> => ({ sol: 0, bsc: 0, hood: 0 })

/** USD value of all chain-coin balances. */
export function nativeValue(p: Portfolio, m?: Partial<Pick<MarketState, 'native'>>) {
  let v = 0
  for (const c of CHAIN_IDS) v += (p.balances?.[c] ?? 0) * (m?.native?.[c]?.price ?? CHAINS[c].basePrice)
  return v
}

export type Asset = Chain | 'usd'

/** Swap between USD and chain coins at the simulated rate, minus a small fee. Amount is in the `from` asset. */
export function swap(p: Portfolio, m: MarketState, from: Asset, to: Asset, amount: number): { ok: true; portfolio: Portfolio; received: number } | { ok: false; error: string } {
  if (from === to) return { ok: false, error: 'Pick two different assets' }
  const have = from === 'usd' ? p.cash : p.balances[from]
  if (!(amount > 0)) return { ok: false, error: 'Enter an amount' }
  if (amount > have + 1e-12) return { ok: false, error: `Not enough ${from === 'usd' ? 'USD' : CHAINS[from].native}` }
  const usdIn = from === 'usd' ? amount : amount * nativePrice(m, from)
  const usdOut = usdIn * (1 - SWAP_FEE)
  const received = to === 'usd' ? usdOut : usdOut / nativePrice(m, to)
  const balances = { ...p.balances }
  let cash = p.cash
  if (from === 'usd') cash -= amount
  else balances[from] = Math.max(0, balances[from] - amount)
  if (to === 'usd') cash += received
  else balances[to] += received
  return { ok: true, portfolio: { ...p, cash, balances, feesPaid: p.feesPaid + usdIn * SWAP_FEE }, received }
}

/**
 * Buy with the token's chain coin. `usd` is the order size in USD terms; it's paid in SOL / BNB / ETH at the
 * current simulated rate. With autoSwap, any shortfall is swapped from USD first.
 */
export function executeBuy(p: Portfolio, m: MarketState, tokenId: string, usd: number, nextId: number, opts: ExecOpts = {}): Result {
  const t = m.tokens.find((x) => x.id === tokenId)
  if (!t) return { ok: false, error: 'Token not found' }
  if (t.status === 'rugged' || t.status === 'dead') return { ok: false, error: `$${t.ticker} is ${t.status} — trading halted` }
  const chain = t.chain ?? 'sol'
  const coin = CHAINS[chain].native
  const px = nativePrice(m, chain)
  const gasNative = opts.setting ? opts.setting.priority + opts.setting.tip : 0
  let swapped: { usd: number; native: number; chain: Chain } | undefined
  let needed = usd / px + gasNative
  const have = p.balances?.[chain] ?? 0
  if (needed > have + 1e-12 && opts.autoSwap && p.cash > 0) {
    // Swap just enough USD (plus the swap fee) to cover the gap.
    const usdForGap = Math.min(p.cash, ((needed - have) * px) / (1 - SWAP_FEE) + 0.01)
    const s = swap({ ...p, balances: p.balances ?? emptyBalances() }, m, 'usd', chain, usdForGap)
    if (s.ok) {
      p = s.portfolio
      swapped = { usd: usdForGap, native: s.received, chain }
    }
  }
  const bal = p.balances?.[chain] ?? 0
  // The order itself is whatever's left after the network fee.
  const spend = Math.max(0, Math.min(needed, bal) - gasNative)
  needed = spend
  usd = spend * px
  if (!(usd >= MIN_TRADE)) return { ok: false, error: bal * px < MIN_TRADE ? `Not enough ${coin} — swap some USD into ${coin} first` : `Minimum trade is $${MIN_TRADE}` }

  const q0 = previewBuy(t, usd)
  const f = opts.setting ? frictions(t, q0.slippage, opts.setting, px, opts.rand) : undefined
  const extra = f ? f.lag + f.mev : 0
  if (f && q0.slippage + extra > f.tolerance) {
    return { ok: false, error: slipError(q0.slippage + extra, f.tolerance, opts.setting!.priority, chain), burn: { chain, native: opts.setting!.priority } }
  }
  // You land after the price moved (lag) and, if sandwiched, after a bot bought ahead of you (mev).
  const q = { ...q0, qty: q0.qty / (1 + extra), avgPrice: q0.avgPrice * (1 + extra), newPrice: q0.newPrice * (1 + (f?.lag ?? 0)), slippage: q0.slippage + extra }
  const gasUsd = f?.gasUsd ?? 0
  const prev = p.positions[tokenId]
  const qty = (prev?.qty ?? 0) + q.qty
  const costBasis = (prev?.costBasis ?? 0) + usd + gasUsd
  const position: Position = {
    tokenId,
    qty,
    costBasis,
    avgEntry: costBasis / qty,
    openedAt: prev?.openedAt ?? m.tick,
    realized: prev?.realized ?? 0,
  }
  const trade: Trade = {
    id: nextId, tick: m.tick, time: m.time, tokenId, ticker: t.ticker, emoji: t.emoji, hue: t.hue, image: t.image,
    side: 'buy', price: q.avgPrice, qty: q.qty, value: usd, fee: q.fee, slippage: q.slippage, status: 'FILLED',
    chain, native: needed + gasNative,
    ...(f ? { gas: gasUsd, lag: f.lag, mev: f.sandwiched ? (usd * f.mev) / (1 + extra) : 0 } : {}),
  }
  const firstTimeToken = !p.tradedTokens.includes(tokenId)
  const portfolio: Portfolio = {
    ...p,
    balances: { ...(p.balances ?? emptyBalances()), [chain]: Math.max(0, bal - needed - gasNative) },
    positions: { ...p.positions, [tokenId]: position },
    trades: [trade, ...p.trades],
    feesPaid: p.feesPaid + q.fee + gasUsd,
    tradedTokens: firstTimeToken ? [...p.tradedTokens, tokenId] : p.tradedTokens,
  }
  return { ok: true, portfolio, market: applyPlayerTrade(m, tokenId, 'buy', usd, q.newPrice, opts.who), trade, firstTimeToken, swapped, exec: f }
}

export function executeSell(p: Portfolio, m: MarketState, tokenId: string, qty: number, nextId: number, opts: ExecOpts = {}): Result {
  const t = m.tokens.find((x) => x.id === tokenId)
  const pos = p.positions[tokenId]
  if (!t || !pos) return { ok: false, error: 'No position to sell' }
  qty = Math.min(qty, pos.qty)
  if (!(qty > 0)) return { ok: false, error: 'Enter an amount to sell' }

  const chain = t.chain ?? 'sol'
  const px = nativePrice(m, chain)
  const q0 = previewSell(t, qty, pos)
  const f = opts.setting ? frictions(t, q0.slippage, opts.setting, px, opts.rand) : undefined
  const extra = f ? f.lag + f.mev : 0
  if (f && q0.slippage + extra > f.tolerance) {
    return { ok: false, error: slipError(q0.slippage + extra, f.tolerance, opts.setting!.priority, chain), burn: { chain, native: opts.setting!.priority } }
  }
  // Price ran down before you landed (lag) and/or a sandwich bot sold ahead of you (mev). Network fee comes off the top.
  const gasUsd = f?.gasUsd ?? 0
  const gross = q0.gross * (1 - Math.min(0.95, extra))
  const fee = gross * tradeFee(t, 'sell')
  const net = gross - fee - gasUsd
  const cost = pos.avgEntry * qty
  const q = { ...q0, gross, fee, net, avgPrice: gross / qty, newPrice: q0.newPrice * (1 - (f?.lag ?? 0)), slippage: q0.slippage + extra, pnl: net - cost, pnlPct: cost > 0 ? net / cost - 1 : 0 }
  // Proceeds arrive in the token's chain coin.
  const balances = p.balances ?? emptyBalances()
  const nativeOut = q.net / px
  const costPart = pos.avgEntry * qty
  const remaining = pos.qty - qty
  const closed = remaining <= pos.qty * 1e-9 || remaining * t.price < 0.005
  const positions = { ...p.positions }
  if (closed) delete positions[tokenId]
  else positions[tokenId] = { ...pos, qty: remaining, costBasis: pos.costBasis - costPart, realized: pos.realized + q.pnl }

  const trade: Trade = {
    id: nextId, tick: m.tick, time: m.time, tokenId, ticker: t.ticker, emoji: t.emoji, hue: t.hue, image: t.image,
    side: 'sell', price: q.avgPrice, qty, value: q.gross, fee: q.fee, slippage: q.slippage,
    pnl: q.pnl, pnlPct: q.pnlPct, holdTicks: m.tick - pos.openedAt, status: t.status === 'rugged' ? 'RUGGED' : 'FILLED',
    chain, native: nativeOut,
    ...(f ? { gas: gasUsd, lag: f.lag, mev: f.sandwiched ? q0.gross * f.mev : 0 } : {}),
  }
  const portfolio: Portfolio = {
    ...p,
    balances: { ...balances, [chain]: Math.max(0, balances[chain] + nativeOut) },
    positions,
    trades: [trade, ...p.trades],
    realized: p.realized + q.pnl,
    feesPaid: p.feesPaid + q.fee + gasUsd,
  }
  return { ok: true, portfolio, market: applyPlayerTrade(m, tokenId, 'sell', q.gross, q.newPrice, opts.who), trade, firstTimeToken: false, exec: f }
}
