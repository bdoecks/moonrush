// V2 stage 2: the coin page's Tracked tab. The wallets you follow that have traded this coin (then the KOLs and smart
// money seen on it), each with its own colour, position, share of the supply, average entry, profit and history.
// Clicking a row picks that trader out on the chart: only that wallet's trades and its average-entry line are drawn.
import clsx from 'clsx'
import { ChevronDown, ChevronRight, Crosshair, Eye, EyeOff } from 'lucide-react'
import { Fragment, useMemo, useState } from 'react'
import { SUPPLY } from '../../game/marketEngine'
import { useGame } from '../../game/store'
import { tradersOn, type TraderOnCoin } from '../../game/traderView'
import { MIND_META } from '../../game/traderMinds'
import type { Token } from '../../types'
import { fmtAge, fmtCompact, fmtNum, fmtUsd, toneClass } from '../../utils/format'
import { EmptyState } from '../ui'
import { focusFor, useTraderFocus } from './traderFocus'

const th = 'h-7 px-2.5 text-[11px] font-medium text-dim whitespace-nowrap'
const td = 'px-2.5 py-1 whitespace-nowrap'
const STYLE_ICON: Partial<Record<TraderOnCoin['style'], string>> = { kol: '📣', smart: '🧠', sniper: '🎯', whale: '🐋' }
const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '-' : ''}${fmtUsd(Math.abs(v))}`

/** How many wallets you track have traded or hold this coin (the tab's count). */
export function useTrackedCount(token: Token) {
  const wallets = useGame((s) => s.wallets)
  const tracked = useGame((s) => s.trackedWallets)
  return useMemo(() => wallets.filter((w) => tracked.includes(w.id) && ((w.positions[token.id]?.qty ?? 0) > 0 || w.trades.some((t) => t.tokenId === token.id))).length, [wallets, tracked, token.id])
}

export function TrackedTab({ token }: { token: Token }) {
  const wallets = useGame((s) => s.wallets)
  const tracked = useGame((s) => s.trackedWallets)
  const now = useGame((s) => s.market.time)
  const toggleTrack = useGame((s) => s.toggleTrackWallet)
  const openWallet = useGame((s) => s.openWallet)
  const focus = useTraderFocus((s) => focusFor(s.focus, token.id))
  const setFocus = useTraderFocus((s) => s.set)
  const [open, setOpen] = useState<string | null>(null)
  const rows = useMemo(() => tradersOn(token, wallets, tracked), [token, wallets, tracked])
  const mine = rows.filter((r) => r.tracked)
  const held = mine.reduce((a, r) => a + r.sharePct, 0)
  const pick = (id: string) => setFocus(focus === id ? null : { tokenId: token.id, walletId: id })

  if (!rows.length) return <EmptyState icon="👁" title="No tracked trader has touched this coin" hint="Track wallets on the Track tab (or from any wallet profile). Their trades, average entry and position on a coin show up here and on its chart." />
  return (
    <>
      <div className="sticky left-0 top-0 z-[2] flex h-8 items-center gap-3 overflow-x-auto border-b border-line/40 bg-panel px-3 text-[11px] text-dim no-scrollbar">
        <span>Tracked on this coin <span className="num text-ink">{mine.length}</span></span>
        <span>They hold <span className="num text-ink">{held.toFixed(2)}%</span> of the supply</span>
        {focus && (
          <button onClick={() => setFocus(null)} className="flex items-center gap-1 rounded border border-info/50 px-1.5 py-px font-semibold text-info hover:bg-info/10">
            <Crosshair size={10} /> Showing one trader on the chart · show all
          </button>
        )}
        <span className="ml-auto shrink-0">Click a row to pick that trader out on the chart</span>
      </div>
      <table className="w-full min-w-[900px] text-[12px]">
        <thead>
          <tr className="border-b border-line/40 text-left">
            <th className={th}>Trader</th>
            <th className={clsx(th, 'text-right')}>Position</th>
            <th className={clsx(th, 'text-right')}>% of supply</th>
            <th className={clsx(th, 'text-right')}>Avg entry (MC)</th>
            <th className={clsx(th, 'text-right')}>Unrealized</th>
            <th className={clsx(th, 'text-right')}>Realized</th>
            <th className={clsx(th, 'text-right')}>Buys / sells</th>
            <th className={clsx(th, 'text-right')}>Last</th>
            <th className={th} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const firstOther = !r.tracked && (i === 0 || rows[i - 1].tracked)
            const isOpen = open === r.id
            return (
              <Fragment key={r.id}>
                {firstOther && (
                  <tr className="border-b border-line/30 bg-panel2/40">
                    <td colSpan={9} className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-dim">Not tracked: KOLs and smart money seen on this coin</td>
                  </tr>
                )}
                <tr onClick={() => pick(r.id)} className={clsx('h-9 cursor-pointer border-b border-line/30 hover:bg-panel2/70', focus === r.id && 'bg-info/10')} title="Pick this trader out on the chart (click again to show everyone)">
                  <td className={td}>
                    <div className="flex items-center gap-1.5">
                      <button onClick={(e) => { e.stopPropagation(); setOpen(isOpen ? null : r.id) }} className="text-dim hover:text-ink" title="This trader's trades on this coin" aria-label="Show this trader's trades on this coin" aria-expanded={isOpen}>
                        {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      </button>
                      <span className="size-2.5 shrink-0 rounded-full" style={{ background: r.color }} title={r.tracked ? 'This trader’s colour on every chart' : 'Not tracked'} />
                      <span className="text-[13px] leading-none">{r.avatar}</span>
                      <button onClick={(e) => { e.stopPropagation(); openWallet(r.id) }} className="font-semibold text-ink underline decoration-dotted underline-offset-2 hover:text-accent" title="Open wallet profile">{r.name}</button>
                      {STYLE_ICON[r.style] && <span className="text-[11px]" title={r.style}>{STYLE_ICON[r.style]}</span>}
                      {r.mind && <span className="rounded bg-panel2 px-1 py-px text-[9px] font-semibold text-muted" title={`${MIND_META[r.mind].label}: ${MIND_META[r.mind].blurb}`}>{MIND_META[r.mind].icon} {MIND_META[r.mind].label}</span>}
                      {r.bot && <span className="rounded bg-panel2 px-1 text-[9px] font-semibold text-dim" title="Simulated trader">SIM</span>}
                    </div>
                  </td>
                  <td className={clsx(td, 'num text-right', r.qty > 0 ? 'text-ink' : 'text-dim')}>{r.qty > 0 ? fmtUsd(r.value) : 'out'}</td>
                  <td className={clsx(td, 'num text-right text-muted')}>{r.qty > 0 ? `${r.sharePct.toFixed(r.sharePct < 0.1 ? 3 : 2)}%` : '—'}</td>
                  <td className={clsx(td, 'num text-right text-muted')}>{r.qty > 0 ? fmtCompact(r.avgEntry * SUPPLY) : '—'}</td>
                  <td className={clsx(td, 'num text-right', r.qty > 0 ? toneClass(r.unrealized) : 'text-dim')}>{r.qty > 0 ? <>{signed(r.unrealized)} <span className="text-[10px]">({r.cost > 0 ? `${((r.unrealized / r.cost) * 100).toFixed(0)}%` : '—'})</span></> : '—'}</td>
                  <td className={clsx(td, 'num text-right', r.sells ? toneClass(r.realized) : 'text-dim')}>{r.sells ? signed(r.realized) : '—'}</td>
                  <td className={clsx(td, 'num text-right')}><span className="text-up">{r.buys}</span> <span className="text-dim">/</span> <span className="text-down">{r.sells}</span></td>
                  <td className={clsx(td, 'num text-right text-dim')}>{r.lastAt ? <><span className={r.lastSide === 'buy' ? 'text-up' : 'text-down'}>{r.lastSide === 'buy' ? 'bought' : 'sold'}</span> {fmtAge(Math.max(0, now - r.lastAt))} ago</> : '—'}</td>
                  <td className={clsx(td, 'text-right')}>
                    <button onClick={(e) => { e.stopPropagation(); toggleTrack(r.id) }} className={clsx('inline-flex items-center gap-1 rounded border px-1.5 py-px text-[10px] font-semibold', r.tracked ? 'border-line2 text-dim hover:text-ink' : 'border-info/50 text-info hover:bg-info/10')} title={r.tracked ? 'Stop tracking this wallet' : 'Track this wallet: it gets its own colour and an average-entry line'}>
                      {r.tracked ? <><EyeOff size={10} /> Untrack</> : <><Eye size={10} /> Track</>}
                    </button>
                  </td>
                </tr>
                {isOpen && (
                  <tr className="border-b border-line/30 bg-panel2/30">
                    <td colSpan={9} className="px-9 py-2">
                      {!r.trades.length ? (
                        <span className="text-[11px] text-dim">Holds a bag, but its trades here are older than the wallet's remembered history.</span>
                      ) : (
                        <div className="grid gap-x-6 gap-y-0.5 text-[11px] sm:grid-cols-2">
                          {r.trades.slice(0, 20).map((t) => (
                            <div key={t.id} className="flex flex-wrap items-center gap-x-2 num">
                              <span className="w-12 text-dim">{fmtAge(Math.max(0, now - t.time))}</span>
                              <span className={clsx('w-9 font-semibold', t.side === 'buy' ? 'text-up' : 'text-down')}>{t.side === 'buy' ? 'Buy' : 'Sell'}</span>
                              <span className="w-16 text-right text-ink">{fmtUsd(t.usd)}</span>
                              <span className="text-dim">at {fmtCompact((t.mcap ?? t.price * SUPPLY))} MC</span>
                              <span className="text-dim">{fmtNum(t.qty)} coins</span>
                              {t.side === 'sell' && t.pnl !== undefined && <span className={clsx('ml-auto', toneClass(t.pnl))}>{signed(t.pnl)}</span>}
                              {t.why && <span className="basis-full truncate pl-14 font-sans text-[10px] text-dim" title={t.why}>↳ {t.why}</span>}
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
      <p className="px-3 py-2 text-[10px] leading-snug text-dim">Read off the wallets' public trades. A tracked wallet's buy is not a signal to buy: the crowd trades against it, and by the time it shows here the price has answered.</p>
    </>
  )
}
