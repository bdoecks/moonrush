import type { MarketState, Portfolio, Token } from '../types'
import { emptyBalances, nativeValue } from './tradingEngine'

export function newPortfolio(balance: number): Portfolio {
  return {
    cash: balance,
    balances: emptyBalances(),
    startBalance: balance,
    positions: {},
    trades: [],
    realized: 0,
    feesPaid: 0,
    equityHistory: [],
    peakEquity: balance,
    maxDrawdown: 0,
    dayStartEquity: balance,
    tradedTokens: [],
  }
}

export interface Valuation {
  invested: number // mark-to-market value of positions
  cost: number
  unrealized: number
  equity: number
  greenPositions: number
  nativeUsd: number // USD value of SOL / BNB / ETH balances
}

/** Equity = USD cash + chain-coin balances at simulated prices + token positions. */
export function valuePortfolio(p: Portfolio, tokens: Map<string, Token>, m?: Partial<Pick<MarketState, 'native'>>): Valuation {
  let invested = 0
  let cost = 0
  let green = 0
  for (const pos of Object.values(p.positions)) {
    const t = tokens.get(pos.tokenId)
    const v = t ? pos.qty * t.price : 0
    invested += v
    cost += pos.costBasis
    if (v > pos.costBasis) green++
  }
  const nativeUsd = nativeValue(p, m)
  return { invested, cost, unrealized: invested - cost, equity: p.cash + nativeUsd + invested, greenPositions: green, nativeUsd }
}

export interface PortfolioStats {
  totalPnl: number
  totalPnlPct: number
  todayPnl: number
  winRate: number
  closedTrades: number
  wins: number
  tradeCount: number
  best?: { ticker: string; pnl: number; pnlPct: number }
  worst?: { ticker: string; pnl: number; pnlPct: number }
  avgHoldTicks: number
  bestSellPct: number
  profitableSells: number
}

export function portfolioStats(p: Portfolio, v: Valuation): PortfolioStats {
  const sells = p.trades.filter((t) => t.side === 'sell')
  const wins = sells.filter((t) => (t.pnl ?? 0) > 0)
  let best: PortfolioStats['best']
  let worst: PortfolioStats['worst']
  let hold = 0
  let bestSellPct = 0
  for (const s of sells) {
    const pnl = s.pnl ?? 0
    if (!best || pnl > best.pnl) best = { ticker: s.ticker, pnl, pnlPct: s.pnlPct ?? 0 }
    if (!worst || pnl < worst.pnl) worst = { ticker: s.ticker, pnl, pnlPct: s.pnlPct ?? 0 }
    hold += s.holdTicks ?? 0
    bestSellPct = Math.max(bestSellPct, s.pnlPct ?? 0)
  }
  const totalPnl = v.equity - p.startBalance
  return {
    totalPnl,
    totalPnlPct: totalPnl / p.startBalance,
    todayPnl: v.equity - p.dayStartEquity,
    winRate: sells.length ? wins.length / sells.length : 0,
    closedTrades: sells.length,
    wins: wins.length,
    tradeCount: p.trades.length,
    best,
    worst,
    avgHoldTicks: sells.length ? hold / sells.length : 0,
    bestSellPct,
    profitableSells: wins.length,
  }
}

const MAX_HISTORY = 1800

/** Record an equity sample and update peak / drawdown. */
export function snapshot(p: Portfolio, equity: number, tick: number, time: number): Portfolio {
  let hist = [...p.equityHistory, { tick, time, equity }]
  if (hist.length > MAX_HISTORY) hist = hist.filter((_, i) => i % 2 === 0 || i > hist.length - 200)
  const peakEquity = Math.max(p.peakEquity, equity)
  const dd = peakEquity > 0 ? 1 - equity / peakEquity : 0
  return { ...p, equityHistory: hist, peakEquity, maxDrawdown: Math.max(p.maxDrawdown, dd) }
}
