import clsx from 'clsx'
import { Star, X } from 'lucide-react'
import { useTokenMap } from '../hooks/useDerived'
import { SIM_SEC_PER_TICK } from '../game/marketEngine'
import { useGame } from '../game/store'
import { fmtAge, fmtCompact, fmtNum, fmtPct, fmtPrice, fmtTime, fmtUsd, toneClass } from '../utils/format'
import { EmptyState, FlashNum, MomentumBar, Pct, TokenIcon } from './ui'

const th = 'px-2 py-1.5 text-[9px] font-semibold uppercase tracking-wider text-dim whitespace-nowrap'
const td = 'px-2 py-1.5 border-b border-line/50 whitespace-nowrap'

export function PositionsTable() {
  const positions = useGame((s) => s.portfolio.positions)
  const tick = useGame((s) => s.market.tick)
  const select = useGame((s) => s.select)
  const sell = useGame((s) => s.sell)
  const map = useTokenMap()
  const list = Object.values(positions)
  if (!list.length) return <EmptyState icon="🎒" title="No open positions" hint="Pick a token and press B to buy" />
  return (
    <table className="w-full min-w-[820px] text-[11px]">
      <thead className="sticky top-0 z-[1] bg-panel">
        <tr>
          <th className={clsx(th, 'text-left')}>Token</th>
          <th className={clsx(th, 'text-right')}>Amount</th>
          <th className={clsx(th, 'text-right')}>Avg entry</th>
          <th className={clsx(th, 'text-right')}>Current</th>
          <th className={clsx(th, 'text-right')}>Value</th>
          <th className={clsx(th, 'text-right')}>Unrealized P&amp;L</th>
          <th className={clsx(th, 'text-right')}>P&amp;L %</th>
          <th className={clsx(th, 'text-right')}>Hold</th>
          <th className={clsx(th, 'text-right')}>Actions</th>
        </tr>
      </thead>
      <tbody>
        {list.map((p) => {
          const t = map.get(p.tokenId)
          const price = t?.price ?? 0
          const value = p.qty * price
          const pnl = value - p.costBasis
          const pct = p.costBasis > 0 ? value / p.costBasis - 1 : 0
          return (
            <tr key={p.tokenId} onClick={() => t && select(t.id)} className="cursor-pointer transition-colors hover:bg-panel2">
              <td className={td}>
                <div className="flex items-center gap-2">
                  {t && <TokenIcon token={t} size={22} />}
                  <span className="font-bold">${t?.ticker ?? '???'}</span>
                  {t?.status === 'rugged' && <span className="rounded bg-down/15 px-1 text-[9px] font-bold text-down">RUGGED</span>}
                </div>
              </td>
              <td className={clsx(td, 'text-right num')}>{fmtNum(p.qty)}</td>
              <td className={clsx(td, 'text-right num text-muted')}>{fmtPrice(p.avgEntry)}</td>
              <td className={clsx(td, 'text-right')}><FlashNum value={price} format={fmtPrice} /></td>
              <td className={clsx(td, 'text-right num font-semibold')}>{fmtUsd(value)}</td>
              <td className={clsx(td, 'text-right num', toneClass(pnl))}>{pnl >= 0 ? '+' : ''}{fmtUsd(pnl)}</td>
              <td className={clsx(td, 'text-right')}><span className={clsx('num rounded px-1 font-bold', pct >= 0 ? 'bg-up/10 text-up' : 'bg-down/10 text-down')}>{fmtPct(pct)}</span></td>
              <td className={clsx(td, 'text-right num text-muted')}>{fmtAge((tick - p.openedAt) * SIM_SEC_PER_TICK)}</td>
              <td className={clsx(td, 'text-right')}>
                <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => sell(p.qty / 2, p.tokenId, undefined, 'all')} className="rounded border border-line2 px-1.5 py-0.5 text-[10px] font-semibold text-muted hover:border-down/50 hover:text-down">50%</button>
                  <button onClick={() => sell(p.qty, p.tokenId, undefined, 'all')} className="rounded border border-down/40 bg-down/10 px-1.5 py-0.5 text-[10px] font-bold text-down hover:bg-down hover:text-white">Close</button>
                </div>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

export function WatchlistTable() {
  const watchlist = useGame((s) => s.watchlist)
  const select = useGame((s) => s.select)
  const toggleWatch = useGame((s) => s.toggleWatch)
  const map = useTokenMap()
  const list = watchlist.map((id) => map.get(id)).filter((t) => !!t)
  if (!list.length) return <EmptyState icon={<Star />} title="Watchlist is empty" hint="Star tokens in the table, or press F on a token" />
  return (
    <table className="w-full min-w-[640px] text-[11px]">
      <thead className="sticky top-0 z-[1] bg-panel">
        <tr>
          <th className={clsx(th, 'text-left')}>Token</th>
          <th className={clsx(th, 'text-right')}>Price</th>
          <th className={clsx(th, 'text-right')}>5m</th>
          <th className={clsx(th, 'text-right')}>Market cap</th>
          <th className={clsx(th, 'text-right')}>Momentum</th>
          <th className={clsx(th, 'text-right')}>Vol 1h</th>
          <th className={th} />
        </tr>
      </thead>
      <tbody>
        {list.map((t) => (
          <tr key={t.id} onClick={() => select(t.id)} className="cursor-pointer hover:bg-panel2">
            <td className={td}><div className="flex items-center gap-2"><TokenIcon token={t} size={22} /><span className="font-bold">${t.ticker}</span>{t.status === 'rugged' && <span className="text-[9px] font-bold text-down">RUGGED</span>}</div></td>
            <td className={clsx(td, 'text-right')}><FlashNum value={t.price} format={fmtPrice} /></td>
            <td className={clsx(td, 'text-right')}><Pct v={t.change['5m']} /></td>
            <td className={clsx(td, 'text-right num')}>{fmtCompact(t.mcap)}</td>
            <td className={td}><div className="flex justify-end"><MomentumBar score={t.momentumScore} /></div></td>
            <td className={clsx(td, 'text-right num text-muted')}>{fmtCompact(t.volume)}</td>
            <td className={clsx(td, 'text-right')}>
              <button onClick={(e) => { e.stopPropagation(); toggleWatch(t.id) }} className="text-dim hover:text-down" aria-label="Remove from watchlist"><X size={12} /></button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function HistoryTable({ limit }: { limit?: number }) {
  const trades = useGame((s) => s.portfolio.trades)
  const accounts = useGame((s) => s.portfolio.accounts)
  const select = useGame((s) => s.select)
  const map = useTokenMap()
  const walletOf = (id?: string) => (accounts && accounts.length > 1 ? accounts.find((a) => a.id === (id ?? accounts[0].id)) : undefined)
  const list = limit ? trades.slice(0, limit) : trades
  if (!list.length) return <EmptyState icon="🧾" title="No trades yet" hint="Every simulated fill shows up here" />
  return (
    <table className="w-full min-w-[760px] text-[11px]">
      <thead className="sticky top-0 z-[1] bg-panel">
        <tr>
          <th className={clsx(th, 'text-left')}>Time</th>
          <th className={clsx(th, 'text-left')}>Token</th>
          <th className={clsx(th, 'text-left')}>Side</th>
          <th className={clsx(th, 'text-right')}>Price</th>
          <th className={clsx(th, 'text-right')}>Amount</th>
          <th className={clsx(th, 'text-right')}>Value</th>
          <th className={clsx(th, 'text-right')}>Fee</th>
          <th className={clsx(th, 'text-right')}>P&amp;L</th>
          <th className={clsx(th, 'text-right')}>Status</th>
        </tr>
      </thead>
      <tbody>
        {list.map((tr) => (
          <tr key={tr.id} onClick={() => map.has(tr.tokenId) && select(tr.tokenId)} className="cursor-pointer hover:bg-panel2">
            <td className={clsx(td, 'num text-muted')}>{fmtTime(tr.time)}</td>
            <td className={td}><div className="flex items-center gap-1.5"><TokenIcon token={{ emoji: tr.emoji, hue: tr.hue, image: tr.image, status: 'graduated' }} size={18} /><span className="font-bold">${tr.ticker}</span></div></td>
            <td className={td}><span className={clsx('rounded px-1.5 py-px text-[10px] font-bold', tr.side === 'buy' ? 'bg-up/15 text-up' : 'bg-down/15 text-down')}>{tr.side.toUpperCase()}</span></td>
            <td className={clsx(td, 'text-right num')}>{fmtPrice(tr.price)}</td>
            <td className={clsx(td, 'text-right num text-muted')}>{fmtNum(tr.qty)}</td>
            <td className={clsx(td, 'text-right num')}>{fmtUsd(tr.value)}</td>
            <td className={clsx(td, 'text-right num text-dim')}>{fmtUsd(tr.fee)}</td>
            <td className={clsx(td, 'text-right num', toneClass(tr.pnl ?? 0))}>{tr.pnl !== undefined ? `${tr.pnl >= 0 ? '+' : ''}${fmtUsd(tr.pnl)} (${fmtPct(tr.pnlPct ?? 0)})` : '—'}</td>
            <td className={clsx(td, 'text-right')}>
              {walletOf(tr.walletId) && <span className="mr-1.5 rounded bg-raise px-1 text-[9px] font-semibold text-muted" title="Wallet">{walletOf(tr.walletId)!.emoji} {walletOf(tr.walletId)!.name}</span>}
              {tr.via && <span className="mr-1.5 rounded bg-info/10 px-1 text-[9px] font-semibold text-info" title="Executed by copy trading">⚡ {tr.via}</span>}
              <span className={clsx('text-[10px] font-semibold', tr.status === 'RUGGED' ? 'text-down' : 'text-up')}>{tr.status}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export { EventFeed } from './EventFeed'
