import { useMemo } from 'react'
import { portfolioStats, valuePortfolio } from '../game/portfolioEngine'
import { useGame } from '../game/store'
import type { Token } from '../types'

// One id → coin map per market state, shared by everything that asks. (Each component used to build its own on every
// tick: dozens of feed rows × a few hundred coins.)
const maps = new WeakMap<Token[], Map<string, Token>>()
export function tokenMapOf(tokens: Token[]): Map<string, Token> {
  let m = maps.get(tokens)
  if (!m) {
    m = new Map(tokens.map((t) => [t.id, t]))
    maps.set(tokens, m)
  }
  return m
}

export function useTokenMap(): Map<string, Token> {
  return tokenMapOf(useGame((s) => s.market.tokens))
}

export function useSelectedToken(): Token | undefined {
  const id = useGame((s) => s.selectedId)
  const map = useTokenMap()
  return id ? map.get(id) : undefined
}

export function useValuation() {
  const portfolio = useGame((s) => s.portfolio)
  const map = useTokenMap()
  return useMemo(() => {
    const v = valuePortfolio(portfolio, map)
    return { ...v, stats: portfolioStats(portfolio, v), portfolio }
  }, [portfolio, map])
}
