import type { Token } from '../../types'
import { winBuys, winSells, winVolume } from '../../game/windows'

export type FilterId = 'trending' | 'new' | 'gainers' | 'losers' | 'volume' | 'momentum' | 'lowcap' | 'bought' | 'sold' | 'graduation' | 'watchlist'
export type ChangeTf = '1m' | '5m' | '1h' | '24h'
export type SortKey = 'token' | 'price' | 'change' | 'mcap' | 'liquidity' | 'volume' | 'buys' | 'sells' | 'holders' | 'age' | 'momentum' | 'risk' | 'hype'

export const FILTERS: { id: FilterId; label: string; icon: string }[] = [
  { id: 'trending', label: 'Trending', icon: '🔥' },
  { id: 'new', label: 'New', icon: '🆕' },
  { id: 'gainers', label: 'Gainers', icon: '📈' },
  { id: 'losers', label: 'Losers', icon: '📉' },
  { id: 'volume', label: 'High Volume', icon: '💧' },
  { id: 'momentum', label: 'High Momentum', icon: '🚀' },
  { id: 'lowcap', label: 'Low Cap', icon: '🐜' },
  { id: 'bought', label: 'Most Bought', icon: '🟢' },
  { id: 'sold', label: 'Most Sold', icon: '🔴' },
  { id: 'graduation', label: 'Graduation', icon: '🎓' },
  { id: 'watchlist', label: 'Watchlist', icon: '⭐' },
]

const live = (t: Token) => t.status === 'bonding' || t.status === 'graduated'
export const trendScore = (t: Token) => t.hype * 0.6 + t.momentumScore * 0.4 + Math.log10(Math.max(10, t.volume)) * 4

export function sortValue(t: Token, key: SortKey, tf: ChangeTf, now: number): number | string {
  switch (key) {
    case 'token': return t.ticker
    case 'price': return t.price
    case 'change': return t.change[tf]
    case 'mcap': return t.mcap
    case 'liquidity': return t.liquidity
    case 'volume': return winVolume(t, tf, now)
    case 'buys': return winBuys(t, tf, now)
    case 'sells': return winSells(t, tf, now)
    case 'holders': return t.holders
    case 'age': return now - t.createdAt
    case 'momentum': return t.momentumScore
    case 'risk': return t.riskScore
    case 'hype': return t.hype
  }
}

/** Apply a quick filter; returns tokens in the filter's natural order. */
export function applyFilter(tokens: Token[], f: FilterId, tf: ChangeTf, now: number, watchlist: string[]): Token[] {
  const by = (fn: (t: Token) => number) => (a: Token, b: Token) => fn(b) - fn(a)
  switch (f) {
    case 'trending': return tokens.filter(live).sort(by(trendScore))
    case 'new': return tokens.filter((t) => now - t.createdAt < 3600).sort((a, b) => b.createdAt - a.createdAt)
    case 'gainers': return tokens.filter((t) => live(t) && t.change[tf] > 0).sort(by((t) => t.change[tf]))
    case 'losers': return tokens.filter((t) => t.change[tf] < 0).sort((a, b) => a.change[tf] - b.change[tf])
    case 'volume': return tokens.filter(live).sort(by((t) => t.volume))
    case 'momentum': return tokens.filter((t) => live(t) && t.momentumScore >= 58).sort(by((t) => t.momentumScore))
    case 'lowcap': return tokens.filter((t) => live(t) && t.mcap < 250_000).sort(by(trendScore))
    case 'bought': return tokens.filter(live).sort(by((t) => t.buys))
    case 'sold': return tokens.filter(live).sort(by((t) => t.sells))
    case 'graduation': return tokens.filter((t) => t.status === 'bonding').sort(by((t) => t.bondingProgress))
    case 'watchlist': return tokens.filter((t) => watchlist.includes(t.id)).sort(by(trendScore))
  }
}
