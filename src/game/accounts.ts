// GMGN-style multi-wallet. Each wallet (Account) holds its own chain coins and positions; USD cash is a shared bank.
// Portfolio.balances / .positions are always the sum over wallets, so valuation, charts and missions stay unchanged.
// Engine calls (buy, sell, swap) run on a single-wallet *view* of the portfolio and are committed back.
import type { Account, Chain, Portfolio, Position } from '../types'

export const MAX_WALLETS = 10
export const WALLET_EMOJIS = ['🟢', '🔵', '🟣', '🟠', '🔴', '🟡', '⚫', '⚪', '🐸', '🐋', '🦊', '🤖']
const empty = (): Record<Chain, number> => ({ sol: 0, bsc: 0, hood: 0 })

export function makeAccount(name: string, emoji: string, id?: string): Account {
  return { id: id ?? `w-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`, name, emoji, balances: empty(), positions: {}, createdAt: Date.now() }
}

/** Saves from before multi-wallet: everything moves into one "Main" wallet. */
export function ensureAccounts(p: Portfolio): Portfolio {
  if (p.accounts?.length) {
    const active = (p.active ?? []).filter((id) => p.accounts!.some((a) => a.id === id))
    return aggregate({ ...p, active: active.length ? active : [p.accounts[0].id] })
  }
  const main: Account = { ...makeAccount('Main', '🟢', 'w-main'), balances: { ...empty(), ...(p.balances ?? {}) }, positions: { ...(p.positions ?? {}) } }
  return aggregate({ ...p, accounts: [main], active: [main.id] })
}

/** Recompute the combined balances / positions from the wallets. */
export function aggregate(p: Portfolio): Portfolio {
  const accounts = p.accounts ?? []
  const balances = empty()
  const positions: Record<string, Position> = {}
  for (const a of accounts) {
    for (const c of Object.keys(balances) as Chain[]) balances[c] += a.balances[c] ?? 0
    for (const [id, pos] of Object.entries(a.positions)) {
      const cur = positions[id]
      if (!cur) positions[id] = { ...pos }
      else {
        const qty = cur.qty + pos.qty
        const costBasis = cur.costBasis + pos.costBasis
        positions[id] = { tokenId: id, qty, costBasis, avgEntry: costBasis / Math.max(1e-18, qty), openedAt: Math.min(cur.openedAt, pos.openedAt), realized: cur.realized + pos.realized }
      }
    }
  }
  return { ...p, balances, positions }
}

export const primaryId = (p: Portfolio) => p.active?.[0] ?? p.accounts?.[0]?.id ?? 'w-main'
export const accountOf = (p: Portfolio, id: string) => p.accounts?.find((a) => a.id === id)
export const activeAccounts = (p: Portfolio) => (p.accounts ?? []).filter((a) => p.active?.includes(a.id))

/** A single-wallet view: the portfolio as if this wallet were the only one. */
export function viewOf(p: Portfolio, id: string): Portfolio {
  const a = accountOf(p, id)
  return a ? { ...p, balances: { ...a.balances }, positions: { ...a.positions } } : p
}

/** Write a single-wallet view back: its coins and bags go to the wallet, shared fields (cash, trades, fees…) to the portfolio. */
export function commitView(p: Portfolio, id: string, view: Portfolio, tagTradesFrom?: number): Portfolio {
  const accounts = (p.accounts ?? []).map((a) => (a.id === id ? { ...a, balances: { ...view.balances }, positions: { ...view.positions } } : a))
  // Tag new trades (those added on top of the old list) with the wallet that made them.
  const added = tagTradesFrom === undefined ? 0 : view.trades.length - tagTradesFrom
  const trades = added > 0 ? [...view.trades.slice(0, added).map((t) => ({ ...t, walletId: t.walletId ?? id })), ...view.trades.slice(added)] : view.trades
  return aggregate({ ...view, trades, accounts, active: p.active })
}

/** Run an engine step on one wallet's view and commit it (no-op on failure). */
export function withAccount<R extends { ok: boolean; portfolio?: Portfolio }>(p: Portfolio, id: string, fn: (view: Portfolio) => R): { res: R; portfolio: Portfolio } {
  const view = viewOf(p, id)
  const res = fn(view)
  if (!res.ok || !res.portfolio) return { res, portfolio: p }
  return { res, portfolio: commitView(p, id, res.portfolio, view.trades.length) }
}

/** Value of one wallet's coins + bags (USD). */
export function accountValue(a: Account, price: (tokenId: string) => number, nativeUsd: (c: Chain) => number) {
  let v = 0
  for (const c of Object.keys(a.balances) as Chain[]) v += a.balances[c] * nativeUsd(c)
  for (const pos of Object.values(a.positions)) v += pos.qty * price(pos.tokenId)
  return v
}
