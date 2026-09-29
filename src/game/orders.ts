// Money moves on a player's wallets, as pure functions shared by the game (solo rounds, and the instant on-screen
// result in rooms) and the room server (which is the judge in rooms). Same code on both sides = same rules.
import type { Account, Chain, MarketState, Portfolio, Position, Trade, TradeSetting } from '../types'
import { accountOf, aggregate, commitView, ensureAccounts, primaryId, viewOf, withAccount } from './accounts'
import { newPortfolio } from './portfolioEngine'
import { emptyBalances, executeBuy, executeSell, nativePrice, swap, type Asset } from './tradingEngine'

export interface Who {
  name: string
  pid?: string
  addr?: string
}

export interface OrderResult {
  portfolio: Portfolio
  market: MarketState
  fills: Trade[]
  failures: string[]
  firstTimeToken: boolean
  swappedUsd: number
}

/** A failed order can still burn its priority fee, like a failed on-chain transaction. */
export function burnFee(p: Portfolio, m: MarketState, walletId: string, burn?: { chain: Chain; native: number }): Portfolio {
  if (!burn || !(burn.native > 0)) return p
  const view = viewOf(p, walletId)
  const balances = { ...view.balances }
  const burned = Math.min(balances[burn.chain], burn.native)
  balances[burn.chain] -= burned
  return commitView(p, walletId, { ...view, balances, feesPaid: view.feesPaid + burned * nativePrice(m, burn.chain) })
}

/** Buy `usdEach` of a coin from each of these wallets, one after another against the same pool. */
export function runBuy(p: Portfolio, m: MarketState, walletIds: string[], usdEach: number, tokenId: string, opts: { autoSwap?: boolean; setting?: TradeSetting; who?: (walletId: string) => Who | undefined; rand?: () => number }): OrderResult {
  let portfolio = p
  let market = m
  const fills: Trade[] = []
  const failures: string[] = []
  let firstTimeToken = false
  let swappedUsd = 0
  for (const wid of walletIds) {
    const a = accountOf(portfolio, wid)
    if (!a) continue
    const { res, portfolio: next } = withAccount(portfolio, a.id, (view) => executeBuy(view, market, tokenId, usdEach, portfolio.trades.length + 1, { autoSwap: opts.autoSwap, setting: opts.setting, who: opts.who?.(a.id), rand: opts.rand }))
    if (!res.ok) {
      portfolio = burnFee(portfolio, market, a.id, res.burn)
      failures.push(`${a.emoji} ${a.name}: ${res.error}`)
      continue
    }
    portfolio = next
    market = res.market
    fills.push({ ...res.trade, walletId: a.id })
    firstTimeToken ||= res.firstTimeToken
    swappedUsd += res.swapped?.usd ?? 0
  }
  return { portfolio, market, fills, failures, firstTimeToken, swappedUsd }
}

/** Sell these amounts of a coin, each from its own wallet. */
export function runSell(p: Portfolio, m: MarketState, legs: { walletId: string; qty: number }[], tokenId: string, opts: { setting?: TradeSetting; who?: (walletId: string) => Who | undefined; rand?: () => number }): OrderResult {
  let portfolio = p
  let market = m
  const fills: Trade[] = []
  const failures: string[] = []
  for (const leg of legs) {
    const a = accountOf(portfolio, leg.walletId)
    if (!a || !(leg.qty > 0)) continue
    const { res, portfolio: next } = withAccount(portfolio, a.id, (view) => executeSell(view, market, tokenId, leg.qty, portfolio.trades.length + 1, { setting: opts.setting, who: opts.who?.(a.id), rand: opts.rand }))
    if (!res.ok) {
      portfolio = burnFee(portfolio, market, a.id, res.burn)
      failures.push(`${a.emoji} ${a.name}: ${res.error}`)
      continue
    }
    portfolio = next
    market = res.market
    fills.push({ ...res.trade, walletId: a.id })
  }
  return { portfolio, market, fills, failures, firstTimeToken: false, swappedUsd: 0 }
}

/** Swap between USD and a chain coin inside one wallet. */
export function runSwap(p: Portfolio, m: MarketState, from: Asset, to: Asset, amount: number, walletId: string): { ok: true; portfolio: Portfolio; received: number } | { ok: false; error: string } {
  const { res, portfolio } = withAccount(p, walletId, (view) => swap(view, m, from, to, amount))
  return res.ok ? { ok: true, portfolio, received: res.received } : { ok: false, error: res.error }
}

/** Move a chain coin between two of your wallets (the receiving wallet remembers who funded it). */
export function runTransfer(p: Portfolio, fromId: string, toId: string, chain: Chain, amount: number, tick: number): { ok: true; portfolio: Portfolio; amount: number } | { ok: false; error: string } {
  const from = accountOf(p, fromId)
  const to = accountOf(p, toId)
  if (!from || !to || fromId === toId || !(amount > 0)) return { ok: false, error: 'Pick two wallets and an amount' }
  if (amount > from.balances[chain] + 1e-12) return { ok: false, error: `${from.name} only has ${from.balances[chain]} ${chain}` }
  const amt = Math.min(amount, from.balances[chain])
  const accounts = (p.accounts ?? []).map((a) =>
    a.id === fromId
      ? { ...a, balances: { ...a.balances, [chain]: a.balances[chain] - amt } }
      : a.id === toId
        ? { ...a, balances: { ...a.balances, [chain]: a.balances[chain] + amt }, fundedBy: { ...(a.fundedBy ?? {}), [fromId]: tick } }
        : a,
  )
  return { ok: true, portfolio: ensureAccounts({ ...p, accounts }), amount: amt }
}

// ─── Wallet layout and state (rooms) ─────────────────────────────────────────
export interface WalletLayout {
  accounts: { id: string; name: string; emoji: string; createdAt: number }[]
  active?: string[]
}

/** Your wallet names / order, without balances (the server keeps balances; you choose the layout). */
export const layoutOf = (p: Portfolio): WalletLayout => ({ accounts: (p.accounts ?? []).map((a) => ({ id: a.id, name: a.name, emoji: a.emoji, createdAt: a.createdAt })), active: p.active })

/** A fresh round's wallet: the bank holds the start balance, every wallet starts empty. */
export function freshWallet(startBalance: number, layout?: WalletLayout): Portfolio {
  const accounts: Account[] = (layout?.accounts?.length ? layout.accounts : [{ id: 'w-main', name: 'Main', emoji: '🟢', createdAt: Date.now() }]).map((a) => ({ ...a, balances: emptyBalances(), positions: {} }))
  return ensureAccounts({ ...newPortfolio(startBalance), accounts, active: layout?.active ?? [accounts[0].id] })
}

/** Apply a new layout: add / rename / reorder wallets, keeping balances; wallets that still hold money aren't removed. */
export function applyLayout(p: Portfolio, layout: WalletLayout): Portfolio {
  const old = new Map((p.accounts ?? []).map((a) => [a.id, a]))
  const next: Account[] = layout.accounts.slice(0, 12).map((l) => {
    const a = old.get(l.id)
    return a ? { ...a, name: String(l.name).slice(0, 18), emoji: String(l.emoji).slice(0, 4) } : { id: String(l.id).slice(0, 40), name: String(l.name).slice(0, 18), emoji: String(l.emoji).slice(0, 4), createdAt: Number(l.createdAt) || Date.now(), balances: emptyBalances(), positions: {} }
  })
  for (const a of p.accounts ?? []) {
    const hasMoney = Object.values(a.balances).some((b) => b > 1e-9) || Object.keys(a.positions).length > 0
    if (!next.some((x) => x.id === a.id) && hasMoney) next.push(a)
  }
  const active = (layout.active ?? []).filter((id) => next.some((a) => a.id === id))
  return ensureAccounts({ ...p, accounts: next, active: active.length ? active : [next[0].id] })
}

/** The money part of a wallet the server sends back (no trade history: the new fills come with it). */
export interface WalletState {
  cash: number
  accounts: Account[]
  active?: string[]
  realized: number
  feesPaid: number
  tradedTokens: string[]
  tradeCount: number
  cashback?: Record<Chain, number> // rooms: cashback earned and not yet claimed (the server counts it)
  vaults?: Record<string, number> // rooms: creator fees waiting in each of your coins' vaults, in the chain coin
}

export const walletStateOf = (p: Portfolio): WalletState => ({
  cash: p.cash, accounts: p.accounts ?? [], active: p.active, realized: p.realized, feesPaid: p.feesPaid, tradedTokens: p.tradedTokens, tradeCount: p.trades.length,
})

/** Put the server's wallet state onto your local portfolio (charts, equity history etc. stay yours). */
export function mergeWalletState(local: Portfolio, w: WalletState): Portfolio {
  return aggregate({ ...local, cash: w.cash, accounts: w.accounts, active: w.active ?? local.active, realized: w.realized, feesPaid: w.feesPaid, tradedTokens: w.tradedTokens })
}

// ─── Wallet differences ───────────────────────────────────────────────────────
/** What changed between two versions of a wallet (test copies use it to flag changes the server didn't run). */
export interface WalletDelta {
  cash: number
  realized: number
  feesPaid: number
  balances: Record<string, Partial<Record<Chain, number>>> // walletId → chain → change
  positions: Record<string, Record<string, Position | null>> // walletId → tokenId → new position (null = closed)
  trades: Trade[] // new trades
  tradedTokens: string[]
}

export function diffWallet(before: Portfolio, after: Portfolio): WalletDelta | null {
  const d: WalletDelta = { cash: after.cash - before.cash, realized: after.realized - before.realized, feesPaid: after.feesPaid - before.feesPaid, balances: {}, positions: {}, trades: [], tradedTokens: [] }
  let changed = Math.abs(d.cash) > 1e-9 || Math.abs(d.realized) > 1e-9
  const b = new Map((before.accounts ?? []).map((a) => [a.id, a]))
  for (const a of after.accounts ?? []) {
    const o = b.get(a.id)
    for (const c of Object.keys(a.balances) as Chain[]) {
      const diff = a.balances[c] - (o?.balances[c] ?? 0)
      if (Math.abs(diff) > 1e-12) {
        ;(d.balances[a.id] ??= {})[c] = diff
        changed = true
      }
    }
    const ids = new Set([...Object.keys(a.positions), ...Object.keys(o?.positions ?? {})])
    for (const id of ids) {
      const now = a.positions[id]
      const was = o?.positions[id]
      if (now === was) continue
      if (!now || !was || now.qty !== was.qty || now.costBasis !== was.costBasis || now.realized !== was.realized) {
        ;(d.positions[a.id] ??= {})[id] = now ?? null
        changed = true
      }
    }
  }
  if (after.trades.length > before.trades.length) {
    d.trades = after.trades.slice(0, after.trades.length - before.trades.length)
    changed = true
  }
  d.tradedTokens = after.tradedTokens.filter((t) => !before.tradedTokens.includes(t))
  return changed ? d : null
}

/** Add (or, with a negative amount, take) USD or a chain coin: USD to the bank, coins to a wallet (default: main). */
export function addFunds(p: Portfolio, asset: 'usd' | 'usdc' | Chain, amount: number, walletId?: string): Portfolio {
  if (!Number.isFinite(amount) || amount === 0) return p
  if (asset === 'usd' || asset === 'usdc') return { ...p, cash: Math.max(0, p.cash + amount) }
  const id = walletId && accountOf(p, walletId) ? walletId : p.accounts?.[0]?.id
  return aggregate({ ...p, accounts: (p.accounts ?? []).map((a) => (a.id === id ? { ...a, balances: { ...a.balances, [asset]: Math.max(0, a.balances[asset] + amount) } } : a)) })
}

/** What one wallet can send of an asset (USDC comes from the shared USD bank). */
export function fundsIn(p: Portfolio, asset: 'usd' | 'usdc' | Chain, walletId?: string): number {
  if (asset === 'usd' || asset === 'usdc') return p.cash
  return accountOf(p, walletId ?? p.accounts?.[0]?.id ?? '')?.balances[asset] ?? 0
}

// ─── Dev tools and rewards (rooms run these on the server too) ───────────────
/**
 * Airdrop: `qty` of a coin leaves this wallet for nothing (its cost is written off as a realized loss), and the
 * network fee comes out of the wallet's chain coin.
 */
export function runGiveAway(p: Portfolio, walletId: string, tokenId: string, qty: number, chain: Chain, fee: number): { ok: true; portfolio: Portfolio; qty: number } | { ok: false; error: string } {
  const acc = accountOf(p, walletId)
  const pos = acc?.positions[tokenId]
  if (!acc || !pos || !(qty > 0)) return { ok: false, error: 'No tokens to give away' }
  if (acc.balances[chain] < fee - 1e-12) return { ok: false, error: 'Not enough for network fees' }
  const give = Math.min(qty, pos.qty)
  const lost = pos.costBasis * (give / pos.qty)
  const left = pos.qty - give
  const positions = { ...acc.positions }
  if (left > 0) positions[tokenId] = { ...pos, qty: left, costBasis: pos.costBasis - lost, realized: pos.realized - lost }
  else delete positions[tokenId]
  const portfolio = aggregate({
    ...p,
    realized: p.realized - lost,
    accounts: (p.accounts ?? []).map((a) => (a.id === walletId ? { ...a, positions, balances: { ...a.balances, [chain]: Math.max(0, a.balances[chain] - fee) } } : a)),
  })
  return { ok: true, portfolio, qty: give }
}

/** Pay chain-coin rewards (cashback, creator fees): into a wallet as the coin (default: primary), or as USDC. */
export function payNative(p: Portfolio, m: MarketState, lines: [Chain, number][], as: 'coin' | 'usdc', walletId?: string) {
  const out = lines.filter(([, n]) => n > 0).map(([chain, native]) => ({ chain, native, usd: native * nativePrice(m, chain) }))
  const usd = out.reduce((a, l) => a + l.usd, 0)
  if (!out.length) return { portfolio: p, usd: 0, lines: out }
  if (as === 'usdc') return { portfolio: { ...p, cash: p.cash + usd }, usd, lines: out }
  const id = walletId && accountOf(p, walletId) ? walletId : primaryId(p)
  const view = viewOf(p, id)
  const balances = { ...view.balances }
  for (const l of out) balances[l.chain] += l.native
  return { portfolio: commitView(p, id, { ...view, balances }), usd, lines: out }
}
