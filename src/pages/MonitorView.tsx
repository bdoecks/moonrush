import clsx from 'clsx'
import { ChevronDown, ChevronUp, Radar, Users } from 'lucide-react'
import { ChainBadge, QuickBuyButton, QuickSlotPicker } from '../components/chain'
import { useMemo, useState, type ReactNode } from 'react'
import { EmptyState, Pct, Segmented, TokenIcon } from '../components/ui'
import { STYLE_META } from '../data/wallets'
import { useTokenMap } from '../hooks/useDerived'
import { SIM_SEC_PER_TICK } from '../game/marketEngine'
import { useGame, type WalletFeedItem } from '../game/store'
import type { SimWallet, Token, WalletActionKind } from '../types'
import { fmtAge, fmtCompact, fmtNum, toneClass } from '../utils/format'

type MTab = 'track' | 'smart' | 'kol' | 'skyeye'
type SortBy = 'latest' | 'wallets' | 'inflow'
const TABS: { id: MTab; label: string; hint: string }[] = [
  { id: 'track', label: 'Track', hint: 'Wallets you track or copy' },
  { id: 'smart', label: 'Smart', hint: 'Smart money and whales' },
  { id: 'kol', label: 'KOL', hint: 'Callers whose buys move charts' },
  { id: 'skyeye', label: 'SkyEye', hint: 'Every wallet on the board' },
]
// Window lengths in simulated seconds; converted to ticks with the market's clock when used.
const WINDOWS: { id: string; sec: number }[] = [
  { id: '1m', sec: 60 },
  { id: '5m', sec: 300 },
  { id: '15m', sec: 900 },
  { id: '1h', sec: 3600 },
  { id: '6h', sec: 21600 },
  { id: '24h', sec: 86400 },
]

const ACTION_LABEL: Record<WalletActionKind, { label: string; icon: string; cls: string }> = {
  first: { label: 'First Buy', icon: '💰', cls: 'text-up' },
  more: { label: 'Buy More', icon: '➕', cls: 'text-up' },
  partial: { label: 'Sell Partial', icon: '✂️', cls: 'text-warn' },
  all: { label: 'Sell All', icon: '🚪', cls: 'text-down' },
}
const actionOf = (f: { side: 'buy' | 'sell'; kind?: WalletActionKind; fraction: number }): WalletActionKind =>
  f.kind ?? (f.side === 'buy' ? 'first' : f.fraction >= 1 ? 'all' : 'partial')

interface WalletRow {
  w: SimWallet
  buys: number
  sells: number
  inflow: number
  lastTick: number
  last: WalletActionKind
  lastFraction: number
  bal: number
}
interface TokenCard {
  tokenId: string
  ticker: string
  emoji: string
  hue: number
  t?: Token
  rows: WalletRow[]
  inflow: number
  buys: number
  sells: number
  firstMcap: number
  lastTick: number
}

function useWalletSet(tab: MTab) {
  const wallets = useGame((s) => s.wallets)
  const tracked = useGame((s) => s.trackedWallets)
  const copies = useGame((s) => s.copies)
  return useMemo(() => {
    const followed = new Set([...tracked, ...copies.map((c) => c.walletId)])
    return wallets.filter((w) =>
      tab === 'track' ? followed.has(w.id) : tab === 'smart' ? w.style === 'smart' || w.style === 'whale' : tab === 'kol' ? w.style === 'kol' : true,
    )
  }, [wallets, tracked, copies, tab])
}

export function MonitorView() {
  const [tab, setTab] = useState<MTab>('smart')
  const [win, setWin] = useState('1h')
  const [sortBy, setSortBy] = useState<SortBy>('latest')
  const [minWallets, setMinWallets] = useState(1)
  const [hideDead, setHideDead] = useState(true)
  const [mobilePane, setMobilePane] = useState<'cards' | 'feed' | 'inflow'>('cards')
  const tick = useGame((s) => s.market.tick)
  const setView = useGame((s) => s.setView)
  const map = useTokenMap()
  const chainFilter = useGame((s) => s.chainFilter)
  const set = useWalletSet(tab)
  const windowTicks = WINDOWS.find((w) => w.id === win)!.sec / SIM_SEC_PER_TICK

  // Aggregate the selected wallets' trades inside the window into per-token cards.
  const cards = useMemo(() => {
    const byToken = new Map<string, TokenCard>()
    for (const w of set) {
      for (const tr of w.trades) {
        if (tr.tick < tick - windowTicks) break
        let card = byToken.get(tr.tokenId)
        if (!card) {
          card = { tokenId: tr.tokenId, ticker: tr.ticker, emoji: tr.emoji, hue: tr.hue, t: map.get(tr.tokenId), rows: [], inflow: 0, buys: 0, sells: 0, firstMcap: 0, lastTick: 0 }
          byToken.set(tr.tokenId, card)
        }
        let row = card.rows.find((r) => r.w.id === w.id)
        if (!row) {
          const pos = w.positions[tr.tokenId]
          row = { w, buys: 0, sells: 0, inflow: 0, lastTick: -1, last: 'first', lastFraction: 1, bal: pos && card.t ? pos.qty * card.t.price : 0 }
          card.rows.push(row)
        }
        const signed = tr.side === 'buy' ? tr.usd : -tr.usd
        row.inflow += signed
        card.inflow += signed
        if (tr.side === 'buy') {
          row.buys++
          card.buys++
          // Trades are newest-first, so the last buy we see is the earliest in the window.
          if (tr.mcap) card.firstMcap = tr.mcap
        } else {
          row.sells++
          card.sells++
        }
        if (tr.tick > row.lastTick) {
          row.lastTick = tr.tick
          row.last = tr.action ?? (tr.side === 'buy' ? 'first' : 'all')
          row.lastFraction = tr.side === 'sell' && tr.action === 'partial' ? 0.5 : 1
        }
        card.lastTick = Math.max(card.lastTick, tr.tick)
      }
    }
    let list = [...byToken.values()].filter((c) => (chainFilter === 'all' || c.t?.chain === chainFilter) && c.rows.length >= minWallets && (!hideDead || (c.t && c.t.status !== 'rugged' && c.t.status !== 'dead')))
    for (const c of list) c.rows.sort((a, b) => b.lastTick - a.lastTick)
    list = list.sort((a, b) => (sortBy === 'latest' ? b.lastTick - a.lastTick : sortBy === 'wallets' ? b.rows.length - a.rows.length || b.lastTick - a.lastTick : b.inflow - a.inflow))
    return list
  }, [set, tick, windowTicks, map, minWallets, hideDead, sortBy, chainFilter])

  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-line bg-panel px-3 py-2">
        <div className="flex items-center gap-4">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} title={t.hint} className={clsx('font-display text-[17px] font-bold transition-colors', tab === t.id ? 'text-ink' : 'text-dim hover:text-muted')}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-0.5">
          {WINDOWS.map((w) => (
            <button key={w.id} onClick={() => setWin(w.id)} className={clsx('rounded px-2 py-0.5 text-[11px] font-semibold', win === w.id ? 'bg-raise text-ink' : 'text-dim hover:text-muted')}>{w.id}</button>
          ))}
        </div>
        <Segmented value={sortBy} onChange={setSortBy} options={[{ value: 'latest', label: 'Latest' }, { value: 'wallets', label: 'Most wallets' }, { value: 'inflow', label: 'Inflow' }]} />
        <div className="flex items-center gap-1 text-[11px] text-dim">
          <Users size={12} />≥
          {[1, 2, 3].map((n) => (
            <button key={n} onClick={() => setMinWallets(n)} className={clsx('num rounded px-1.5 font-semibold', minWallets === n ? 'bg-raise text-ink' : 'hover:text-muted')}>{n}</button>
          ))}
        </div>
        <label className="flex cursor-pointer items-center gap-1 text-[11px] text-dim">
          <input type="checkbox" checked={hideDead} onChange={(e) => setHideDead(e.target.checked)} className="accent-[var(--accent)]" /> Hide dead
        </label>
        <div className="ml-auto"><QuickSlotPicker /></div>
      </div>

      <div className="border-b border-line p-2 lg:hidden">
        <Segmented value={mobilePane} onChange={setMobilePane} options={[{ value: 'cards', label: 'Tokens' }, { value: 'feed', label: 'Live feed' }, { value: 'inflow', label: 'Net inflow' }]} className="w-full [&>button]:flex-1" />
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Left rail */}
        <aside className={clsx('w-full shrink-0 flex-col border-r border-line bg-panel lg:flex lg:w-[300px]', mobilePane === 'cards' ? 'hidden' : 'flex')}>
          <div className={clsx('min-h-0 flex-1 flex-col lg:flex', mobilePane === 'feed' ? 'flex' : 'hidden')}>
            <RailTitle>{TABS.find((t) => t.id === tab)!.label} feed</RailTitle>
            <LiveFeed walletIds={new Set(set.map((w) => w.id))} />
          </div>
          <div className={clsx('min-h-0 flex-col border-t border-line lg:flex lg:h-[42%]', mobilePane === 'inflow' ? 'flex flex-1' : 'hidden')}>
            <RailTitle>{win} net inflow</RailTitle>
            <InflowRank cards={cards} />
          </div>
        </aside>

        {/* Token cards */}
        <div className={clsx('min-w-0 flex-1 overflow-y-auto p-2 lg:block', mobilePane === 'cards' ? 'block' : 'hidden')}>
          {cards.length === 0 ? (
            tab === 'track' && set.length === 0 ? (
              <EmptyState icon={<Radar />} title="You're not tracking any wallets" hint={<button onClick={() => setView('copytrade')} className="text-accent underline">Track or copy wallets on CopyTrade →</button>} />
            ) : (
              <EmptyState icon={<Radar />} title={`No ${TABS.find((t) => t.id === tab)!.label} activity in the last ${win}`} hint="Try a longer window" />
            )
          ) : (
            <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(min(100%,380px),1fr))]">
              {cards.map((c) => <Card key={c.tokenId} c={c} win={win} tabLabel={TABS.find((t) => t.id === tab)!.label} />)}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function RailTitle({ children }: { children: ReactNode }) {
  return <div className="shrink-0 px-3 pb-1 pt-2.5 text-[11px] font-bold uppercase tracking-wider text-muted">{children}</div>
}

function Card({ c, win, tabLabel }: { c: TokenCard; win: string; tabLabel: string }) {
  const now = useGame((s) => s.market.time)
  const tick = useGame((s) => s.market.tick)
  const select = useGame((s) => s.select)
  const openWallet = useGame((s) => s.openWallet)
  const [expanded, setExpanded] = useState(false)
  const t = c.t
  const mult = t && c.firstMcap ? t.mcap / c.firstMcap : 1
  const hot = c.rows.length >= 3 || mult >= 2
  const dead = !t || t.status === 'rugged' || t.status === 'dead'
  const rows = expanded ? c.rows : c.rows.slice(0, 3)
  const multLabel = mult >= 1.5 ? `+${mult.toFixed(1)}X` : mult <= 0.67 ? `${((mult - 1) * 100).toFixed(0)}%` : '≈1X'

  return (
    <div className={clsx('rounded-lg border bg-panel transition-colors', hot ? 'border-warn/50 shadow-[0_0_20px_-10px_#ffb020]' : 'border-line', dead && 'opacity-60')}>
      {/* Header */}
      <div className="flex gap-2.5 p-2.5">
        <button onClick={() => t && select(t.id)} disabled={!t} className="shrink-0">
          <TokenIcon token={t ?? { emoji: c.emoji, hue: c.hue, status: 'dead' }} size={40} />
        </button>
        <div className="min-w-0 flex-1">
          <button onClick={() => t && select(t.id)} disabled={!t} className="flex items-center gap-1.5 text-left">
            <span className="text-[14px] font-bold">{c.ticker}</span>
            {t && <ChainBadge chain={t.chain} />}
            {t?.creator === 'you' && <span className="text-[10px] text-warn">🍳</span>}
            {t && t.status !== 'graduated' && <span className="text-[10px] text-dim">{t.status === 'bonding' ? `curve ${t.bondingProgress.toFixed(0)}%` : t.status.toUpperCase()}</span>}
          </button>
          {t && (
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 text-[11px] text-dim">
              <span className="num text-up">{fmtAge(now - t.createdAt)}</span>
              <span className="flex items-center gap-0.5"><Users size={10} /><span className="num">{fmtNum(t.holders)}</span></span>
              <span>V <span className="num text-muted">{fmtCompact(t.volume)}</span></span>
              <span>MC <span className="num text-ink">{fmtCompact(t.mcap)}</span></span>
              <Pct v={t.change['1h']} className="text-[11px]" />
            </div>
          )}
        </div>
        <div className="shrink-0 text-right">
          <div className="flex items-center justify-end gap-1.5 text-[13px] font-bold">
            <span className="flex items-center gap-0.5 text-warn"><Users size={12} />{c.rows.length}</span>
            <span className={clsx('num', toneClass(c.inflow))}>{c.inflow >= 0 ? '+' : '-'}{fmtCompact(Math.abs(c.inflow))}</span>
          </div>
          <div className="text-[10px] text-dim">{win} {tabLabel} inflow</div>
          <span className={clsx('mt-1 inline-block rounded px-1.5 py-px text-[10px] font-bold', mult >= 1.5 ? 'bg-info/15 text-info' : mult <= 0.67 ? 'bg-down/15 text-down' : 'bg-raise text-muted')} title="Market cap now vs at the first tracked buy in this window">
            🚀 {multLabel}
          </span>
        </div>
      </div>

      {/* Wallet table */}
      <table className="w-full text-[11px]">
        <thead>
          <tr className="border-y border-line text-[9px] uppercase tracking-wider text-dim">
            <th className="px-2.5 py-1 text-left font-semibold">Wallet</th>
            <th className="px-2 py-1 text-right font-semibold">Bal</th>
            <th className="px-2 py-1 text-right font-semibold">{win} TXs</th>
            <th className="px-2 py-1 text-right font-semibold">{win} Inflow</th>
            <th className="px-2.5 py-1 text-right font-semibold">Age</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const a = ACTION_LABEL[r.last]
            return (
              <tr key={r.w.id} className="border-b border-line/40 hover:bg-panel2">
                <td className="px-2.5 py-1">
                  <button onClick={() => openWallet(r.w.id)} className="flex items-center gap-1.5 hover:text-accent" title={STYLE_META[r.w.style].label}>
                    <span>{r.w.avatar}</span><span className="max-w-[110px] truncate font-semibold">{r.w.name}</span>
                  </button>
                </td>
                <td className="px-2 py-1 text-right num">{r.bal > 0 ? <span className="text-ink">{fmtCompact(r.bal)}</span> : <span className="text-down">Sold</span>}</td>
                <td className="px-2 py-1 text-right num"><span className="text-up">{r.buys}</span>/<span className="text-down">{r.sells}</span></td>
                <td className={clsx('px-2 py-1 text-right num', toneClass(r.inflow))}>{r.inflow >= 0 ? '+' : '-'}{fmtCompact(Math.abs(r.inflow))}</td>
                <td className="px-2.5 py-1 text-right">
                  <span className="num text-dim">{fmtAge((tick - r.lastTick) * SIM_SEC_PER_TICK)} </span>
                  <span className={a.cls}>{a.label}</span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <div className="flex items-center justify-between px-2.5 py-1.5">
        {c.rows.length > 3 ? (
          <button onClick={() => setExpanded((v) => !v)} className="flex items-center gap-0.5 text-[11px] text-dim hover:text-ink">
            {expanded ? <><ChevronUp size={13} /> Less</> : <><ChevronDown size={13} /> {c.rows.length - 3} more</>}
          </button>
        ) : <span />}
        <QuickBuyButton t={dead ? undefined : t} label="Buy " className="px-3 text-[12px]" />
      </div>
    </div>
  )
}

function LiveFeed({ walletIds }: { walletIds: Set<string> }) {
  const feed = useGame((s) => s.walletFeed)
  const wallets = useGame((s) => s.wallets)
  const now = useGame((s) => s.market.time)
  const select = useGame((s) => s.select)
  const openWallet = useGame((s) => s.openWallet)
  const map = useTokenMap()
  const byId = new Map(wallets.map((w) => [w.id, w]))
  const items = feed.filter((f) => walletIds.has(f.walletId)).slice(0, 50)
  if (!items.length) return <EmptyState icon="📡" title="Waiting for activity…" />
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {items.map((f: WalletFeedItem) => {
        const w = byId.get(f.walletId)
        const a = ACTION_LABEL[actionOf(f)]
        const t = map.get(f.tokenId)
        const bal = w && t && w.positions[t.id] ? w.positions[t.id].qty * t.price : 0
        return (
          <div key={f.id} className={clsx('slide-in border-b border-line/50 px-3 py-1.5', f.copied && 'bg-up/5')}>
            <div className="flex items-center gap-1.5 text-[11px]">
              <button onClick={() => w && openWallet(w.id)} className="flex min-w-0 items-center gap-1 hover:text-accent">
                <span>{w?.avatar}</span><span className="truncate font-semibold">{w?.name}</span>
              </button>
              <span className={clsx('shrink-0 font-semibold', a.cls)}>{a.icon} {a.label}{actionOf(f) === 'partial' ? ` ${Math.round(f.fraction * 100)}%` : ''}</span>
              {f.copied && <span className="shrink-0 text-[9px] font-bold text-up">⚡</span>}
              <span className="ml-auto shrink-0 num text-[10px] text-dim">{fmtAge(now - f.time)}</span>
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[11px]">
              <span className={clsx('num', f.side === 'buy' ? 'text-up' : 'text-down')}>{f.side === 'buy' ? '+' : '-'}{fmtCompact(f.usd)}</span>
              <button onClick={() => t && select(t.id)} disabled={!t} className="flex items-center gap-1 hover:text-accent">
                <TokenIcon token={{ emoji: f.emoji, hue: f.hue, status: 'graduated' }} size={16} /><span className="font-semibold">{f.ticker}</span>
              </button>
              <span className="num text-[10px] text-dim">bal {bal ? fmtCompact(bal) : '0'}</span>
              <span className="ml-auto num text-[10px] text-muted">MC {fmtCompact(t?.mcap ?? f.mcap ?? 0)}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function InflowRank({ cards }: { cards: TokenCard[] }) {
  const now = useGame((s) => s.market.time)
  const select = useGame((s) => s.select)
  const ranked = [...cards].sort((a, b) => b.inflow - a.inflow).slice(0, 15)
  if (!ranked.length) return <EmptyState icon="💧" title="No flows yet" />
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 px-3 pb-1 text-[9px] uppercase tracking-wider text-dim">
        <span>Token / TXs</span><span className="text-right">S-Flow</span><span className="w-12 text-right">1h</span>
      </div>
      {ranked.map((c) => (
        <button key={c.tokenId} disabled={!c.t} onClick={() => c.t && select(c.t.id)} className="grid w-full grid-cols-[1fr_auto_auto] items-center gap-x-3 border-b border-line/40 px-3 py-1.5 text-left hover:bg-panel2">
          <span className="flex min-w-0 items-center gap-1.5">
            <TokenIcon token={c.t ?? { emoji: c.emoji, hue: c.hue, status: 'dead' }} size={22} />
            <span className="min-w-0">
              <span className="flex items-center gap-1 text-[11px] font-bold">{c.ticker}<span className="flex items-center gap-0.5 text-[10px] font-normal text-warn"><Users size={9} />{c.rows.length}</span></span>
              <span className="num block text-[10px] text-dim">{c.t ? fmtAge(now - c.t.createdAt) : '—'} · <span className="text-up">{c.buys}</span>/<span className="text-down">{c.sells}</span></span>
            </span>
          </span>
          <span className={clsx('num text-right text-[11px] font-semibold', toneClass(c.inflow))}>{c.inflow >= 0 ? '+' : '-'}{fmtCompact(Math.abs(c.inflow))}</span>
          <span className="w-12 text-right">{c.t ? <Pct v={c.t.change['1h']} className="text-[10px]" /> : '—'}</span>
        </button>
      ))}
    </div>
  )
}
