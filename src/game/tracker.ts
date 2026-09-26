// Wallet tracker rules, shared by the Track feed, the dock tab and the trade alerts.
import type { SimWallet, Token, TrackerSettings, WalletActionKind, WalletLabel } from '../types'

export const DEFAULT_TRACKER: TrackerSettings = {
  chains: [],
  side: 'all',
  minUsd: 0,
  minMcap: null,
  maxMcap: null,
  maxAgeMin: null,
  firstBuyOnly: false,
  group: 'all',
  groups: ['Smart money', 'KOLs', 'Snipers'],
  alerts: true,
  alertBuys: true,
  alertSells: true,
  alertMinUsd: 0,
  alertFirstBuyOnly: false,
  alertUseFilters: true,
  alertPopup: true,
  alertSound: true,
  alertPosition: 'bottom-right',
  clusterMin: 3,
}

export interface TrackedTrade {
  walletId: string
  side: 'buy' | 'sell'
  usd: number
  kind?: WalletActionKind
  mcap?: number // MC at the trade
}

/** Does this trade pass the feed filters? `t` is the coin now (undefined once it's delisted). */
export function passesFeed(f: TrackerSettings, tr: TrackedTrade, t: Token | undefined, now: number, labels: Record<string, WalletLabel>): boolean {
  if (f.side !== 'all' && tr.side !== f.side) return false
  if (tr.usd < f.minUsd) return false
  if (f.firstBuyOnly && tr.side === 'buy' && tr.kind && tr.kind !== 'first') return false
  if (f.group !== 'all' && labels[tr.walletId]?.group !== f.group) return false
  if (f.chains.length && (!t || !f.chains.includes(t.chain))) return false
  const mc = tr.mcap ?? t?.mcap
  if (f.minMcap !== null && (mc === undefined || mc < f.minMcap)) return false
  if (f.maxMcap !== null && (mc === undefined || mc > f.maxMcap)) return false
  if (f.maxAgeMin !== null && (!t || (now - t.createdAt) / 60 > f.maxAgeMin)) return false
  return true
}

/** Should this trade ping you? */
export function shouldAlert(f: TrackerSettings, tr: TrackedTrade, t: Token | undefined, now: number, labels: Record<string, WalletLabel>): boolean {
  if (!f.alerts) return false
  const lb = labels[tr.walletId]
  if (lb?.notify === false) return false
  if (tr.side === 'buy' ? !f.alertBuys || lb?.buys === false : !f.alertSells || lb?.sells === false) return false
  if (tr.usd < f.alertMinUsd) return false
  if (f.alertFirstBuyOnly && tr.side === 'buy' && tr.kind && tr.kind !== 'first') return false
  return !f.alertUseFilters || passesFeed(f, tr, t, now, labels)
}

/** How many tracked wallets hold each coin right now. */
export function trackedHolders(wallets: SimWallet[], tracked: string[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const w of wallets) {
    if (!tracked.includes(w.id)) continue
    for (const [id, p] of Object.entries(w.positions)) if (p.qty > 0) out.set(id, (out.get(id) ?? 0) + 1)
  }
  return out
}

/** Number of feed filters that differ from "show everything". */
export function activeFilterCount(f: TrackerSettings): number {
  return [f.chains.length > 0, f.side !== 'all', f.minUsd > 0, f.minMcap !== null, f.maxMcap !== null, f.maxAgeMin !== null, f.firstBuyOnly, f.group !== 'all'].filter(Boolean).length
}
