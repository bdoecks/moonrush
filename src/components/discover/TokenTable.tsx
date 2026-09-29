import clsx from 'clsx'
import { ChevronDown, ChevronUp, Star } from 'lucide-react'
import { HideButton } from '../HideButton'
import { useHidden } from '../../game/hidden'
import { memo, useEffect, useRef } from 'react'
import { useGame } from '../../game/store'
import { ChainBadge, QuickBuyButton } from '../chain'
import type { Token } from '../../types'
import { winBuys, winSells, winVolume } from '../../game/windows'
import { fmtAge, fmtCompact, fmtNum, fmtPrice } from '../../utils/format'
import { EmptyState, FlashNum, HypeMeter, MomentumBar, Pct, RiskBadge, TokenIcon } from '../ui'
import type { ChangeTf, SortKey } from './filters'

interface Col {
  key: SortKey
  label: string
  cls?: string
  align?: 'left' | 'right'
  tip?: string
}

const COLS: Col[] = [
  { key: 'token', label: 'Token', align: 'left' },
  { key: 'price', label: 'Price' },
  { key: 'change', label: 'Change' },
  { key: 'mcap', label: 'MC', tip: 'Market cap' },
  { key: 'liquidity', label: 'Liq', tip: 'Pool liquidity — thin liquidity means big slippage' },
  { key: 'volume', label: 'Vol', tip: 'Volume in the selected window' },
  { key: 'buys', label: 'Txns', tip: 'Buys / sells in the selected window' },
  { key: 'holders', label: 'Holders' },
  { key: 'age', label: 'Age' },
  { key: 'momentum', label: 'Momentum' },
  { key: 'risk', label: 'Risk' },
  { key: 'hype', label: 'Social' },
]

interface Props {
  tokens: Token[]
  tf: ChangeTf
  sortKey: SortKey | null
  sortDir: 'asc' | 'desc'
  onSort: (k: SortKey) => void
  cursor: number
}

export function TokenTable({ tokens, tf, sortKey, sortDir, onSort, cursor }: Props) {
  const now = useGame((s) => s.market.time)
  const watchlist = useGame((s) => s.watchlist)
  const held = useGame((s) => s.portfolio.positions)
  const compact = useGame((s) => s.settings.compact)

  if (!tokens.length) return <EmptyState icon="🔭" title="No tokens match" hint="Try another filter or clear the search" />

  return (
    <div className="h-full overflow-auto">
      <table className="w-full min-w-[1080px] border-separate border-spacing-0 text-[12px]">
        <thead className="sticky top-0 z-10 bg-panel">
          <tr>
            <th className="sticky left-0 z-20 w-8 border-b border-line bg-panel" />
            {COLS.map((c) => (
              <th
                key={c.key}
                title={c.tip}
                onClick={() => onSort(c.key)}
                className={clsx(
                  'cursor-pointer select-none whitespace-nowrap border-b border-line px-2 py-2 text-[10px] font-semibold uppercase tracking-wider text-dim hover:text-ink',
                  c.align === 'left' ? 'text-left sticky left-8 z-20 bg-panel' : 'text-right',
                  sortKey === c.key && 'text-accent',
                )}
              >
                <span className="inline-flex items-center gap-0.5">
                  {c.key === 'change' ? `${tf} %` : c.key === 'volume' || c.key === 'buys' ? `${c.label} ${tf}` : c.label}
                  {sortKey === c.key && (sortDir === 'desc' ? <ChevronDown size={11} /> : <ChevronUp size={11} />)}
                </span>
              </th>
            ))}
            <th className="border-b border-line px-2 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-dim">Quick</th>
          </tr>
        </thead>
        <tbody>
          {tokens.map((t, i) => (
            <Row key={t.id} t={t} tf={tf} now={now} watched={watchlist.includes(t.id)} held={!!held[t.id]} active={i === cursor} compact={compact} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

const Row = memo(function Row({ t, tf, now, watched, held, active, compact }: { t: Token; tf: ChangeTf; now: number; watched: boolean; held: boolean; active: boolean; compact: boolean }) {
  const select = useGame((s) => s.select)
  const toggleWatch = useGame((s) => s.toggleWatch)
  const hidden = useHidden((s) => s.ids.includes(t.id))
  const ref = useRef<HTMLTableRowElement>(null)
  const dead = t.status === 'rugged' || t.status === 'dead'
  const buys = winBuys(t, tf, now)
  const sells = winSells(t, tf, now)
  const total = buys + sells
  const buyShare = total > 0 ? buys / total : 0.5
  const py = compact ? 'py-1' : 'py-1.5'

  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [active])

  return (
    <tr
      ref={ref}
      onClick={() => select(t.id)}
      className={clsx('group cursor-pointer transition-colors', active ? 'bg-raise' : 'hover:bg-panel2', (dead || hidden) && 'opacity-55')}
    >
      <td className={clsx('sticky left-0 z-[1] border-b border-line/60 pl-2', active ? 'bg-raise' : 'bg-bg group-hover:bg-panel2')}>
        <button
          onClick={(e) => {
            e.stopPropagation()
            toggleWatch(t.id)
          }}
          className={clsx('p-0.5 transition-colors', watched ? 'text-warn' : 'text-dim hover:text-warn')}
          aria-label={watched ? 'Remove from watchlist' : 'Add to watchlist'}
        >
          <Star size={13} fill={watched ? 'currentColor' : 'none'} />
        </button>
      </td>
      <td className={clsx('sticky left-8 z-[1] border-b border-line/60 px-2', py, active ? 'bg-raise' : 'bg-bg group-hover:bg-panel2')}>
        <div className="flex items-center gap-2 min-w-[190px]">
          <TokenIcon token={t} size={compact ? 24 : 30} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-ink">${t.ticker}</span>
              <ChainBadge chain={t.chain} />
              {held && <span className="rounded bg-accent/15 px-1 text-[9px] font-bold text-accent">HELD</span>}
              {t.status === 'bonding' && <span className="rounded bg-warn/10 px-1 text-[9px] font-semibold text-warn num">{t.bondingProgress.toFixed(0)}%</span>}
              {t.status === 'rugged' && <span className="rounded bg-down/15 px-1 text-[9px] font-bold text-down">RUGGED</span>}
              {t.status === 'dead' && <span className="rounded bg-line2 px-1 text-[9px] font-bold text-muted">DEAD</span>}
            </div>
            <div className="truncate text-[10px] text-dim max-w-[150px]">{t.name}</div>
          </div>
          <HideButton id={t.id} ticker={t.ticker} className={clsx('ml-auto', !hidden && 'md:opacity-0 md:group-hover:opacity-100')} />
        </div>
      </td>
      <td className={clsx('border-b border-line/60 px-2 text-right', py)}>
        <FlashNum value={t.price} format={fmtPrice} className="rounded px-1" />
      </td>
      <td className={clsx('border-b border-line/60 px-2 text-right', py)}>
        <Pct v={t.change[tf]} />
      </td>
      <td className={clsx('border-b border-line/60 px-2 text-right num font-semibold', py)}>{fmtCompact(t.mcap)}</td>
      <td className={clsx('border-b border-line/60 px-2 text-right num', py, t.liquidity / t.mcap < 0.06 ? 'text-warn' : 'text-muted')}>{fmtCompact(t.liquidity)}</td>
      <td className={clsx('border-b border-line/60 px-2 text-right num text-muted', py)}>{fmtCompact(winVolume(t, tf, now))}</td>
      <td className={clsx('border-b border-line/60 px-2 text-right', py)}>
        <div className="num text-[11px]">
          <span className="text-dim">{fmtNum(total)} </span>
          <span className="text-up">{fmtNum(buys)}</span>
          <span className="text-dim">/</span>
          <span className="text-down">{fmtNum(sells)}</span>
        </div>
        <div className="ml-auto mt-0.5 flex h-[3px] w-16 overflow-hidden rounded-full bg-down/70">
          <div className="bg-up transition-all duration-500" style={{ width: `${buyShare * 100}%` }} />
        </div>
      </td>
      <td className={clsx('border-b border-line/60 px-2 text-right num text-muted', py)}>{fmtNum(t.holders)}</td>
      <td className={clsx('border-b border-line/60 px-2 text-right num', py, now - t.createdAt < 600 ? 'text-accent' : 'text-muted')}>{fmtAge(now - t.createdAt)}</td>
      <td className={clsx('border-b border-line/60 px-2', py)}>
        <div className="flex justify-end"><MomentumBar score={t.momentumScore} /></div>
      </td>
      <td className={clsx('border-b border-line/60 px-2 text-right', py)}>
        <RiskBadge level={t.riskLevel} />
      </td>
      <td className={clsx('border-b border-line/60 px-2', py)}>
        <div className="flex justify-end"><HypeMeter hype={t.hype} /></div>
      </td>
      <td className={clsx('border-b border-line/60 px-2 text-right', py)}>
        <QuickBuyButton t={t} />
      </td>
    </tr>
  )
})
