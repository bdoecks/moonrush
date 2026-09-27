// Friends you track (room players' main wallets, and side-wallet addresses you know) as Wallet Tracker rows, in the
// same shape as the simulated wallets' trades so both trackers can list them together.
import { useMemo } from 'react'
import { secPerTickOf } from '../../game/marketEngine'
import { useGame } from '../../game/store'
import { addrKey, playerKey, useFriends } from '../../net/friends'
import type { SimWallet, WalletTrade } from '../../types'

export interface TrackerRow {
  w: SimWallet
  tr: WalletTrade
  friend?: boolean // a real player's wallet: opens the leaderboard instead of a bot wallet profile
}

export function useFriendRows(): { rows: TrackerRow[]; count: number } {
  const trades = useFriends((s) => s.trades)
  const watch = useFriends((s) => s.watch)
  const players = useGame((s) => s.online?.players)
  const tick = useGame((s) => s.market.tick)
  const time = useGame((s) => s.market.time)
  const market = useGame((s) => s.market)
  const spt = secPerTickOf(market)
  const rows = useMemo(() => {
    if (!watch.length) return []
    const avatar = new Map((players ?? []).map((p) => [p.id, p.avatar]))
    const out: TrackerRow[] = []
    // Oldest first, so we can tell a first buy from buying more (and a partial sell from selling out).
    const bought = new Map<string, number>()
    for (const t of [...trades].reverse()) {
      const w = watch.find((x) => (t.pid && x.key === playerKey(t.pid)) || (t.addr && x.key === addrKey(t.addr)))
      if (!w) continue
      const k = `${w.key}|${t.tokenId}`
      const had = bought.get(k) ?? 0
      const qty = t.price > 0 ? t.usd / t.price : 0
      const left = t.side === 'buy' ? had + qty : Math.max(0, had - qty)
      bought.set(k, left)
      const action = t.side === 'buy' ? (had > 0 ? 'more' : 'first') : left <= had * 0.02 ? 'all' : 'partial'
      const wallet = { id: w.key, name: w.label, avatar: t.pid ? avatar.get(t.pid) ?? '🧑' : '🕶', trades: [], positions: {} } as unknown as SimWallet
      out.push({
        w: wallet,
        friend: true,
        tr: {
          id: Number(t.key.split(':').pop()) || 0, tick: tick - Math.round((time - t.time) / spt), time: t.time, tokenId: t.tokenId, ticker: t.ticker, emoji: t.emoji, hue: t.hue,
          side: t.side, usd: t.usd, qty, price: t.price, mcap: t.mcap, action,
        },
      })
    }
    return out.reverse()
  }, [trades, watch, players, tick, time, spt])
  return { rows, count: watch.length }
}
