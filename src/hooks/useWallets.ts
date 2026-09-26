import { useMemo } from 'react'
import { useGame } from '../game/store'
import type { Account, Chain, Position } from '../types'

/** Your wallets and which are selected for trading (GMGN multi-wallet). */
export function useWallets() {
  const accounts = useGame((s) => s.portfolio.accounts)
  const active = useGame((s) => s.portfolio.active)
  return useMemo(() => {
    const all: Account[] = accounts ?? []
    const selected = all.filter((a) => active?.includes(a.id))
    return { all, selected, activeIds: active ?? [], primary: selected[0] ?? all[0] }
  }, [accounts, active])
}

/** Combined position of the selected wallets in one token (what the trade panels act on). */
export function useActivePosition(tokenId?: string): Position | undefined {
  const { selected } = useWallets()
  return useMemo(() => {
    if (!tokenId) return undefined
    let pos: Position | undefined
    for (const a of selected) {
      const p = a.positions[tokenId]
      if (!p) continue
      if (!pos) pos = { ...p }
      else {
        const qty = pos.qty + p.qty
        const costBasis = pos.costBasis + p.costBasis
        pos = { ...pos, qty, costBasis, avgEntry: costBasis / qty, openedAt: Math.min(pos.openedAt, p.openedAt), realized: pos.realized + p.realized }
      }
    }
    return pos
  }, [selected, tokenId])
}

/** Chain-coin balance across the selected wallets, plus the smallest single-wallet balance (multi-buys need it in each). */
export function useActiveBalance(chain: Chain) {
  const { selected } = useWallets()
  return useMemo(() => {
    const each = selected.map((a) => a.balances[chain] ?? 0)
    return { total: each.reduce((a, b) => a + b, 0), min: each.length ? Math.min(...each) : 0, count: Math.max(1, selected.length) }
  }, [selected, chain])
}
