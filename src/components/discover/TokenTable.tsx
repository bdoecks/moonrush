import clsx from 'clsx'
import { Boxes, ChefHat, ChevronDown, ChevronUp, Crosshair, Eye, Ghost, Star, UserRound, Users } from 'lucide-react'
import { HideButton } from '../HideButton'
import { useHidden } from '../../game/hidden'
import { memo, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { useGame } from '../../game/store'
import { publicBundlePct } from '../../game/devTools'
import { devPctOf, top10Of } from '../../game/ledger'
import { ChainBadge, QuickBuyButton } from '../chain'
import type { Token } from '../../types'
import { winBuys, winSells, winVolume } from '../../game/windows'
import { fmtAge, fmtCompact, fmtNum } from '../../utils/format'
import { EmptyState, Pct, RiskBadge, TokenIcon } from '../ui'
import type { ChangeTf, SortKey } from './filters'
import { useWindowed } from '../../hooks/useWindowed'

// Laid out like Axiom's Discover / GMGN's Trending: pair info, market cap with its change, liquidity, volume, txns,
// then the token's audit ("Token Info"), and the quick buy. Every header sorts; "Token Info" sorts by risk.
interface Col {
  key: SortKey
  label: string
  align?: 'left' | 'right'
  tip?: string
  also?: { key: SortKey; label: string; tip?: string } // a second sort in the same header
}

const COLS: Col[] = [
  { key: 'token', label: 'Pair info', align: 'left', also: { key: 'age', label: 'Age', tip: 'Sort by age' } },
  { key: 'mcap', label: 'Market cap', tip: 'Market cap, with its change over the selected window', also: { key: 'change', label: '%', tip: 'Sort by change' } },
  { key: 'liquidity', label: 'Liquidity', tip: 'Pool liquidity — thin liquidity means big slippage' },
  { key: 'volume', label: 'Volume', tip: 'Volume in the selected window' },
  { key: 'buys', label: 'Txns', tip: 'Buys / sells in the selected window' },
  { key: 'risk', label: 'Token info', align: 'left', tip: 'Audit: top 10 holders, dev, snipers, insiders, bundlers, holders. Sorts by risk', also: { key: 'holders', label: 'Holders', tip: 'Sort by holders' } },
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

  // Only the rows on screen are drawn (see useWindowed). Moving the keyboard cursor scrolls to its row, drawn or not;
  // a row never scrolls itself into view, or the list would jump every time the highlighted row was drawn again.
  const win = useWindowed<HTMLDivElement>(tokens.length, compact ? 46 : 62)
  const { reveal } = win
  useEffect(() => {
    if (cursor >= 0) reveal(cursor)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor])

  // The table sizes its columns from the rows that are drawn, so they would shift sideways as rows scroll in and out.
  // So each column keeps the widest it has been, until the box is resized or the layout changes.
  // - When the table fits its box, "Pair info" is left free to take up the slack, and if holding the others ever
  //   pushes the table past the box they are let go and measured afresh.
  // - When it can't fit (the box is narrower than the table's minimum, or than the rows themselves need), it scrolls
  //   sideways whatever we do, so every column is held.
  const headRef = useRef<HTMLTableRowElement>(null)
  useLayoutEffect(() => {
    const row = headRef.current
    const table = row?.closest('table')
    const box = table?.parentElement
    if (!row || !table || !box) return
    const cells = [...row.children] as HTMLElement[]
    const over = table.offsetWidth > box.clientWidth + 1
    const key = `${box.clientWidth}|${compact}|${tf}`
    if (row.dataset.widths !== key) {
      for (const c of cells) c.style.minWidth = c.style.width = ''
      row.dataset.widths = key
      delete row.dataset.wide
      return // measured afresh on the next draw
    }
    // Wider than the box with nothing held: the rows themselves need the room. Remembered until the next resize or
    // layout change; without it the widths would be let go on every draw here and never hold.
    if (over && !cells.some((c) => c.style.width)) row.dataset.wide = '1'
    const fits = !row.dataset.wide && box.clientWidth >= (parseFloat(getComputedStyle(table).minWidth) || 0)
    if (fits && over) {
      for (const c of cells) c.style.minWidth = c.style.width = ''
      return
    }
    cells.forEach((c, i) => {
      if (i < (fits ? 2 : 1)) return
      const w = c.getBoundingClientRect().width
      // Width as well as minimum: a column with a set width stays put, and spare room goes to the free column.
      if (w > (parseFloat(c.style.minWidth) || 0) + 0.5) c.style.minWidth = c.style.width = `${w}px`
    })
  })

  if (!tokens.length) return <EmptyState icon="🔭" title="No tokens match" hint="Try another filter or clear the search" />

  const arrow = (k: SortKey) => sortKey === k && (sortDir === 'desc' ? <ChevronDown size={11} /> : <ChevronUp size={11} />)
  return (
    <div ref={win.ref} className="h-full overflow-auto">
      <table className="w-full min-w-[760px] border-separate border-spacing-0 text-[12px] sm:min-w-[980px]">
        <thead className="sticky top-0 z-10 bg-panel">
          <tr ref={headRef}>
            <th className="sticky left-0 z-20 w-8 border-b border-line bg-panel" />
            {COLS.map((c) => (
              <th
                key={c.key}
                className={clsx(
                  'select-none whitespace-nowrap border-b border-line px-2 py-2 text-[10px] font-semibold uppercase tracking-wider text-dim',
                  c.align === 'left' ? 'text-left' : 'text-right',
                  c.key === 'token' && 'sticky left-8 z-20 bg-panel',
                )}
              >
                <span className={clsx('inline-flex items-center gap-2', c.align !== 'left' && 'justify-end')}>
                  <button title={c.tip} onClick={() => onSort(c.key)} className={clsx('inline-flex items-center gap-0.5 uppercase hover:text-ink', sortKey === c.key && 'text-accent')}>
                    {c.key === 'volume' || c.key === 'buys' ? `${c.label} ${tf}` : c.label}
                    {arrow(c.key)}
                  </button>
                  {c.also && (
                    <button title={c.also.tip} onClick={() => onSort(c.also!.key)} className={clsx('inline-flex items-center gap-0.5 uppercase hover:text-ink', sortKey === c.also.key && 'text-accent')}>
                      {c.also.key === 'change' ? `${tf} %` : c.also.label}
                      {arrow(c.also.key)}
                    </button>
                  )}
                </span>
              </th>
            ))}
            <th className="border-b border-line px-2 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-dim">Action</th>
          </tr>
        </thead>
        <tbody>
          {win.padTop > 0 && <tr aria-hidden style={{ height: win.padTop }}><td colSpan={COLS.length + 2} /></tr>}
          {tokens.slice(win.start, win.end).map((t, k) => (
            <Row key={t.id} t={t} tf={tf} now={now} watched={watchlist.includes(t.id)} held={!!held[t.id]} active={win.start + k === cursor} compact={compact} />
          ))}
          {win.padBottom > 0 && <tr aria-hidden style={{ height: win.padBottom }}><td colSpan={COLS.length + 2} /></tr>}
        </tbody>
      </table>
    </div>
  )
}

const Row = memo(function Row({ t, tf, now, watched, held, active, compact }: { t: Token; tf: ChangeTf; now: number; watched: boolean; held: boolean; active: boolean; compact: boolean }) {
  const select = useGame((s) => s.select)
  const toggleWatch = useGame((s) => s.toggleWatch)
  const hidden = useHidden((s) => s.ids.includes(t.id))
  const dead = t.status === 'rugged' || t.status === 'dead'
  const buys = winBuys(t, tf, now)
  const sells = winSells(t, tf, now)
  const total = buys + sells
  const buyShare = total > 0 ? buys / total : 0.5
  const py = compact ? 'py-1' : 'py-2'
  const age = now - t.createdAt
  const top10 = top10Of(t)
  const dev = devPctOf(t)
  const bundler = publicBundlePct(t)
  const watchers = Math.round(t.hype * 0.6 + Math.sqrt(t.holders) * 2)
  const cell = clsx('border-b border-line/60 px-2', py)

  return (
    <tr
      data-win
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

      {/* Pair info: picture, ticker + name, then age, chain and how many are watching. */}
      <td className={clsx('sticky left-8 z-[1] border-b border-line/60 px-2', py, active ? 'bg-raise' : 'bg-bg group-hover:bg-panel2')}>
        <div className="flex min-w-[132px] items-center gap-2 sm:min-w-[230px] sm:gap-2.5">
          <TokenIcon token={t} size={compact ? 28 : 36} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[13px] font-bold text-ink">{t.ticker}</span>
              <span className="hidden max-w-[120px] truncate text-[11px] text-dim sm:inline">{t.name}</span>
              {held && <span className="rounded bg-accent/15 px-1 text-[9px] font-bold text-accent">HELD</span>}
              {t.hype > 75 && <span title="Social activity is spiking">🔥</span>}
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[10px]">
              <span className={clsx('num font-semibold', age < 600 ? 'text-up' : 'text-muted')}>{fmtAge(age)}</span>
              <ChainBadge chain={t.chain} />
              {t.status === 'bonding' && <span className="num rounded bg-warn/10 px-1 text-[9px] font-semibold text-warn" title="Bonding curve progress">{t.bondingProgress.toFixed(0)}%</span>}
              {t.status === 'rugged' && <span className="rounded bg-down/15 px-1 text-[9px] font-bold text-down">RUGGED</span>}
              {t.status === 'dead' && <span className="rounded bg-line2 px-1 text-[9px] font-bold text-muted">DEAD</span>}
              <span className="hidden items-center gap-0.5 text-dim sm:flex" title="Watching (simulated)"><Eye size={10} /><span className="num">{watchers}</span></span>
            </div>
          </div>
          <HideButton id={t.id} ticker={t.ticker} className={clsx('ml-auto hidden sm:block', !hidden && 'md:opacity-0 md:group-hover:opacity-100')} />
        </div>
      </td>

      {/* Market cap with its change underneath. */}
      <td className={clsx(cell, 'text-right')}>
        <div className="num text-[13px] font-bold text-ink">{fmtCompact(t.mcap)}</div>
        <Pct v={t.change[tf]} className="text-[11px]" />
      </td>
      <td className={clsx(cell, 'text-right num text-[13px] font-semibold', t.liquidity / t.mcap < 0.06 ? 'text-warn' : 'text-ink')}>{fmtCompact(t.liquidity)}</td>
      <td className={clsx(cell, 'text-right num text-[13px] font-semibold text-ink')}>{fmtCompact(winVolume(t, tf, now))}</td>
      <td className={clsx(cell, 'text-right')}>
        <div className="num text-[13px] font-semibold text-ink">{fmtNum(total)}</div>
        <div className="num text-[11px]">
          <span className="text-up">{fmtNum(buys)}</span>
          <span className="text-dim"> / </span>
          <span className="text-down">{fmtNum(sells)}</span>
        </div>
        <div className="ml-auto mt-0.5 flex h-[3px] w-14 overflow-hidden rounded-full bg-down/70">
          <div className="bg-up transition-all duration-500" style={{ width: `${buyShare * 100}%` }} />
        </div>
      </td>

      {/* Token info: the audit (red = worth a second look), then holders and risk. */}
      <td className={cell}>
        <div className="flex items-center gap-2">
          <div className="grid grid-cols-[auto_auto_auto] gap-x-1 gap-y-1">
            <Audit icon={<UserRound size={10} />} label="Top 10 holders" value={`${top10.toFixed(1)}%`} bad={top10 > 40} />
            <Audit icon={<ChefHat size={10} />} label="Dev holdings" value={`${dev.toFixed(dev < 10 ? 1 : 0)}%`} bad={dev > 8} />
            <Audit icon={<Crosshair size={10} />} label="Snipers" value={String(t.snipers)} bad={t.snipers > 10} />
            <Audit icon={<Ghost size={10} />} label="Insiders" value={`${t.insidersPct.toFixed(0)}%`} bad={t.insidersPct > 15} />
            <Audit icon={<Boxes size={10} />} label="Bundlers" value={`${bundler.toFixed(0)}%`} bad={bundler > 12} />
            <span className="num inline-flex items-center gap-0.5 rounded border border-line2 px-1 py-px text-[10px] text-muted" title="Holders"><Users size={10} />{fmtNum(t.holders)}</span>
          </div>
          <RiskBadge level={t.riskLevel} />
        </div>
      </td>

      <td className={clsx(cell, 'text-right')}>
        <QuickBuyButton t={t} label="Buy " className="px-3 py-1.5" />
      </td>
    </tr>
  )
})

function Audit({ icon, label, value, bad }: { icon: ReactNode; label: string; value: string; bad: boolean }) {
  return (
    <span title={label} className={clsx('num inline-flex items-center gap-0.5 rounded border px-1 py-px text-[10px]', bad ? 'border-down/30 bg-down/5 text-down' : 'border-up/20 bg-up/5 text-up')}>
      {icon}
      {value}
    </span>
  )
}
