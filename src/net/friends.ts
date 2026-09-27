// Watching the other players in your room, like on-chain in real life: everyone's main wallet is public (their
// name shows on the tape, the leaderboard shows their bags and trades), while side wallets trade under a bare
// address. You can only follow a side wallet if you know its address (they gave it to you, or you spotted it).
import { create } from 'zustand'
import type { Chain, TapeTrade, Token } from '../types'
import { walletAddress } from '../utils/address'

export interface PlayerTrade {
  key: string // tokenId:tradeId (dedupe)
  pid?: string // set for main-wallet trades
  addr?: string
  name: string
  tokenId: string
  ticker: string
  emoji: string
  hue: number
  image?: string
  chain: Chain
  side: 'buy' | 'sell'
  usd: number
  price: number
  mcap: number
  time: number
}

/** Something you follow: `p:<playerId>` (a player's main wallet) or `a:<address>` (any wallet by address). */
export interface Watch {
  key: string
  label: string
}

const LOG_LEN = 400
const STORE_KEY = 'moonrush:friendWatch'

function loadWatch(): Watch[] {
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY) ?? '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

interface FriendsState {
  trades: PlayerTrade[]
  watch: Watch[]
  toggle: (w: Watch) => boolean
  rename: (key: string, label: string) => void
  clearTrades: () => void
}

export const useFriends = create<FriendsState>((set, get) => ({
  trades: [],
  watch: loadWatch(),
  toggle: (w) => {
    const on = !get().watch.some((x) => x.key === w.key)
    const watch = on ? [...get().watch, w] : get().watch.filter((x) => x.key !== w.key)
    set({ watch })
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(watch))
    } catch {
      /* storage blocked */
    }
    return on
  },
  rename: (key, label) => {
    const watch = get().watch.map((x) => (x.key === key ? { ...x, label } : x))
    set({ watch })
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(watch))
    } catch {
      /* storage blocked */
    }
  },
  clearTrades: () => set({ trades: [] }),
}))

export const playerKey = (pid: string) => `p:${pid}`
export const addrKey = (addr: string) => `a:${addr}`

/** Is this tape trade by a wallet you follow? Returns the watch entry. */
export function watchOf(e: Pick<TapeTrade, 'pid' | 'addr'>, watch: Watch[]): Watch | undefined {
  return watch.find((w) => (e.pid && w.key === playerKey(e.pid)) || (e.addr && w.key === addrKey(e.addr)))
}

/** Your own wallet addresses on a chain (so your side-wallet trades still show as YOU). */
export function myAddresses(pid: string, walletIds: string[], chains: Chain[]): Set<string> {
  const out = new Set<string>()
  for (const id of walletIds) for (const c of chains) out.add(walletAddress(pid, id, c))
  return out
}

/** Log other players' trades from new tape entries; returns the ones by wallets you follow. */
export function recordPlayerTrades(fresh: { t: Token; e: TapeTrade }[]): { trade: PlayerTrade; watch: Watch }[] {
  if (!fresh.length) return []
  const st = useFriends.getState()
  const known = new Set(st.trades.slice(0, 80).map((x) => x.key))
  const add: PlayerTrade[] = []
  const hits: { trade: PlayerTrade; watch: Watch }[] = []
  for (const { t, e } of fresh) {
    const key = `${t.id}:${e.id}`
    if (known.has(key)) continue
    known.add(key)
    const trade: PlayerTrade = {
      key, pid: e.pid, addr: e.addr, name: e.wallet, tokenId: t.id, ticker: t.ticker, emoji: t.emoji, hue: t.hue, image: t.image, chain: t.chain,
      side: e.side, usd: e.usd, price: e.price, mcap: t.price > 0 ? (t.mcap * e.price) / t.price : t.mcap, time: e.time,
    }
    add.push(trade)
    const w = watchOf(e, st.watch)
    if (w) hits.push({ trade, watch: w })
  }
  if (add.length) useFriends.setState({ trades: [...add.reverse(), ...st.trades].slice(0, LOG_LEN) })
  return hits
}
