// Money in a chain's own coin (SOL / BNB / ETH), GMGN-style: from the coin amounts your trades actually paid and
// received, not your dollar figures divided by today's coin price (which made finished trades drift).
import type { Chain, MarketState, Portfolio, Token, Trade } from '../types'
import { nativePrice } from './tradingEngine'

/** The chain coin's USD price when a trade happened, from what it actually paid or received. */
export function tradePx(tr: Trade): number | undefined {
  if (!tr.native) return undefined
  const usd = tr.side === 'buy' ? tr.value + tr.fee + (tr.gas ?? 0) : tr.value - tr.fee - (tr.gas ?? 0)
  return usd > 0 ? usd / tr.native : undefined
}

export interface ChainView {
  wallet: number // coins sitting in your wallets on this chain
  bags: number // your coins on this chain, valued in the chain coin now (live: they're still open)
  total: number // wallet + bags
  realized: number // profit from sells, at each sell's own coin price (fixed once sold)
  unrealized: number // open bags vs what they cost (live)
  pnl: number // realized + unrealized
  spent: number // coin spent on buys (for the %)
}

export function chainView(p: Portfolio, market: MarketState, chain: Chain, tokens: Map<string, Token>): ChainView {
  const live = nativePrice(market, chain)
  const onChain = (id: string, tr?: Trade) => (tokens.get(id)?.chain ?? tr?.chain) === chain
  let realized = 0
  let spent = 0
  for (const tr of p.trades) {
    if (!onChain(tr.tokenId, tr)) continue
    if (tr.side === 'buy') spent += tr.native ?? (tr.value + tr.fee) / live
    else if (tr.pnl) realized += tr.pnl / (tradePx(tr) ?? live)
  }
  let bagsUsd = 0
  let costUsd = 0
  for (const pos of Object.values(p.positions)) {
    const t = tokens.get(pos.tokenId)
    if (!t || t.chain !== chain) continue
    bagsUsd += pos.qty * t.price
    costUsd += pos.costBasis
  }
  const wallet = p.balances[chain] ?? 0
  const bags = bagsUsd / live
  const unrealized = (bagsUsd - costUsd) / live
  return { wallet, bags, total: wallet + bags, realized, unrealized, pnl: realized + unrealized, spent }
}
