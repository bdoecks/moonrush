// V2 stage 2: a tracked trader on one coin. What the coin page's Tracked tab lists and the chart draws: each trader's
// own colour, position, share of the supply, average entry, profit and history on this coin. Pure: everything is read
// off the public wallets (`SimWallet`), which is all anybody could read off a chain.
// A wallet remembers its last trades only, so a trader's history on a coin can start part-way: the position and its
// cost are always whole (they are the wallet's own books), the realized side is what the remembered trades show.
import { SUPPLY } from './marketEngine'
import type { SimWallet, Token, WalletTrade } from '../types'
import { mindOf, type TraderMind } from './traderMinds'

/** Told apart at a glance on a dark chart, next to the green and red of buys and sells. */
export const TRADER_COLORS = ['#4da3ff', '#ffb020', '#b36bff', '#2ee6d6', '#ff7ad9', '#c6ff3d', '#ff8a4c', '#9aa7ff']

/** A tracked wallet keeps its colour on every coin: its place in the list you track decides it. */
export const traderColor = (tracked: string[], walletId: string) => {
  const i = tracked.indexOf(walletId)
  return i < 0 ? '#8b93a1' : TRADER_COLORS[i % TRADER_COLORS.length]
}

export interface TraderOnCoin {
  id: string
  name: string
  avatar: string
  style: SimWallet['style']
  mind: TraderMind | null // how it reacts to what the coin's feed says (stage 3)
  bot: boolean
  tracked: boolean // you follow this wallet (the others are KOLs and smart money seen on this coin)
  color: string
  qty: number // coins held now
  cost: number // dollars paid for what is held
  avgEntry: number // price per coin of what is held (0 when out)
  value: number // what the position is worth at the current price
  sharePct: number // of the whole supply
  unrealized: number
  realized: number // from the sells the wallet still remembers
  boughtUsd: number
  soldUsd: number
  buys: number
  sells: number
  firstAt: number // market time of the oldest remembered trade here
  lastAt: number
  lastSide: 'buy' | 'sell' | null
  trades: WalletTrade[] // on this coin, newest first
}

/**
 * The traders worth showing on a coin: the wallets you track that have traded or hold it, then (not tracked) the KOLs
 * and smart money seen on it. Biggest position first, then the most recent trade.
 */
export function tradersOn(token: Pick<Token, 'id' | 'price'>, wallets: SimWallet[], tracked: string[]): TraderOnCoin[] {
  const out: TraderOnCoin[] = []
  for (const w of wallets) {
    const mine = tracked.includes(w.id)
    if (!mine && w.style !== 'kol' && w.style !== 'smart') continue
    const trades = w.trades.filter((t) => t.tokenId === token.id)
    const pos = w.positions[token.id]
    const qty = pos?.qty ?? 0
    if (!trades.length && !(qty > 0)) continue
    const cost = qty > 0 ? pos!.cost : 0
    const value = qty * token.price
    let realized = 0, boughtUsd = 0, soldUsd = 0, buys = 0, sells = 0
    for (const t of trades) {
      if (t.side === 'buy') { buys++; boughtUsd += t.usd } else { sells++; soldUsd += t.usd; realized += t.pnl ?? 0 }
    }
    out.push({
      id: w.id, name: w.name, avatar: w.avatar, style: w.style, mind: mindOf(w), bot: !!w.bot, tracked: mine, color: mine ? traderColor(tracked, w.id) : '#8b93a1',
      qty, cost, avgEntry: qty > 0 ? cost / qty : 0, value, sharePct: (qty / SUPPLY) * 100, unrealized: qty > 0 ? value - cost : 0, realized,
      boughtUsd, soldUsd, buys, sells, firstAt: trades.length ? trades[trades.length - 1].time : 0, lastAt: trades[0]?.time ?? 0, lastSide: trades[0]?.side ?? null, trades,
    })
  }
  return out.sort((a, b) => Number(b.tracked) - Number(a.tracked) || b.value - a.value || b.lastAt - a.lastAt)
}
