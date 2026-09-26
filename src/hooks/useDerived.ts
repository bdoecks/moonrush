import { useMemo } from 'react'
import { portfolioStats, valuePortfolio } from '../game/portfolioEngine'
import { useGame } from '../game/store'
import type { Token } from '../types'

export function useTokenMap(): Map<string, Token> {
  const tokens = useGame((s) => s.market.tokens)
  return useMemo(() => new Map(tokens.map((t) => [t.id, t])), [tokens])
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
