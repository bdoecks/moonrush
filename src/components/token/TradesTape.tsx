import clsx from 'clsx'
import { ArrowDownUp, Filter, X, Zap } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { CHAINS, fmtNative } from '../../data/chains'
import { LAUNCHPADS } from '../../data/launchpads'
import { bookOf, devHistory, devPctOf, displayAddress, gasUsd, rowOf, top10Of, walletMeta, type Holder, type HolderRow, type HolderTag } from '../../game/ledger'
import { SUPPLY } from '../../game/marketEngine'
import { useGame } from '../../game/store'
import { nativePrice } from '../../game/tradingEngine'
import type { Portfolio, Token } from '../../types'
import { fmtAge, fmtCompact, fmtNum, fmtTime, fmtUsd, toneClass } from '../../utils/format'
import { EmptyState } from '../ui'

const TAG: Record<HolderTag, { icon: string; label: string; cls: string }> = {
  dev: { icon: '🧑‍💻', label: 'Dev', cls: 'text-down' },
  you: { icon: '⭐', label: 'You', cls: 'text-accent' },
  whale: { icon: '🐋', label: 'Whale', cls: 'text-info' },
  smart: { icon: '🧠', label: 'Smart money', cls: 'text-accent' },
  kol: { icon: '📣', label: 'KOL', cls: 'text-info' },
  sniper: { icon: '🎯', label: 'Sniper', cls: 'text-warn' },
  insider: { icon: '🐀', label: 'Insider', cls: 'text-warn' },
  fresh: { icon: '🌱', label: 'Fresh wallet (funded < 1 day ago)', cls: 'text-up' },
  agent: { icon: '🌀', label: 'Mayhem AI', cls: 'text-down' },
}

type Tab = 'trades' | 'positions' | 'holders' | 'traders' | 'dev'
const th = 'h-7 px-2.5 text-[11px] font-medium text-dim whitespace-nowrap'
const td = 'px-2.5 py-1 whitespace-nowrap'
const row = 'h-9 border-b border-line/30 hover:bg-panel2/70'

const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '-' : ''}${fmtUsd(Math.abs(v))}`

export function TradesTape({ token }: { token: Token }) {
  const now = useGame((s) => s.market.time)
  const portfolio = useGame((s) => s.portfolio)
  const instantOpen = useGame((s) => s.instantOpen)
  const toggleInstant = useGame((s) => s.toggleInstant)
  const [tab, setTab] = useState<Tab>('trades')
  const [walletFilter, setWalletFilter] = useState<string | null>(null)
  const book = bookOf(token, now)
  const mineCount = (portfolio.accounts ?? []).filter((a) => (a.positions[token.id]?.qty ?? 0) > 0).length
  const holderCount = Math.max(token.holders, [...book.holders.values()].filter((h) => h.boughtQty - h.soldQty > 1).length)

  const filterWallet = (w: string) => {
    setWalletFilter(w)
    setTab('trades')
  }
  const tabs: { id: Tab; label: ReactNode }[] = [
    { id: 'trades', label: 'Trades' },
    { id: 'positions', label: <>Positions{mineCount > 0 && <Count n={mineCount} />}</> },
    { id: 'holders', label: <>Holders<Count n={holderCount} /></> },
    { id: 'traders', label: 'Top Traders' },
    { id: 'dev', label: 'Dev Token' },
  ]
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-5 overflow-x-auto border-b border-line px-3 no-scrollbar">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={clsx('relative flex h-full shrink-0 items-center text-[13px] font-semibold transition-colors', tab === t.id ? 'text-ink' : 'text-dim hover:text-muted')}
          >
            {t.label}
            {tab === t.id && <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-ink" />}
          </button>
        ))}
        <span className="ml-auto" />
        <button
          onClick={() => toggleInstant()}
          title="Instant trade panel (I)"
          className={clsx(
            'flex shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-bold transition-colors',
            instantOpen ? 'border-up bg-up text-black' : 'border-up/50 text-up hover:bg-up/10',
          )}
        >
          <Zap size={11} fill="currentColor" /> Instant trade
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {tab === 'trades' && <TradesTab token={token} walletFilter={walletFilter} setWalletFilter={setWalletFilter} />}
        {tab === 'positions' && <PositionsTab token={token} />}
        {tab === 'holders' && <HoldersTab token={token} onFilter={filterWallet} />}
        {tab === 'traders' && <TopTradersTab token={token} onFilter={filterWallet} />}
        {tab === 'dev' && <DevTokenTab token={token} />}
      </div>
    </div>
  )
}

function Count({ n }: { n: number }) {
  return <span className="ml-1 text-[11px] font-medium text-dim">{fmtNum(n)}</span>
}

function Chip({ on, onClick, children, title }: { on: boolean; onClick: () => void; children: ReactNode; title?: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={clsx('flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold transition-colors', on ? 'bg-raise text-ink' : 'text-dim hover:bg-panel2 hover:text-muted')}
    >
      {children}
    </button>
  )
}

function Toolbar({ children }: { children: ReactNode }) {
  return <div className="sticky left-0 top-0 z-[2] flex h-8 items-center gap-1 overflow-x-auto border-b border-line/40 bg-panel px-2 no-scrollbar">{children}</div>
}

/** Two stacked values, GMGN-style: main figure on top, context under it. */
function Stack({ top, bottom, align = 'right', topCls }: { top: ReactNode; bottom?: ReactNode; align?: 'left' | 'right'; topCls?: string }) {
  return (
    <div className={clsx('leading-tight', align === 'right' ? 'text-right' : 'text-left')}>
      <div className={clsx('num text-[12px]', topCls)}>{top}</div>
      {bottom !== undefined && <div className="num text-[10px] text-dim">{bottom}</div>}
    </div>
  )
}

function WalletCell({ h, chain, onFilter, walletCount }: { h: Pick<Holder, 'wallet' | 'tags' | 'walletId'>; chain: Token['chain']; onFilter?: (w: string) => void; walletCount?: number }) {
  const openWallet = useGame((s) => s.openWallet)
  const tags = h.tags.filter((t) => TAG[t])
  const main = tags[0] ? TAG[tags[0]] : undefined
  const name = displayAddress(h.wallet, chain)
  return (
    <div className="group flex items-center gap-1">
      {tags.slice(0, 3).map((t) => <span key={t} title={TAG[t].label} className="text-[11px]">{TAG[t].icon}</span>)}
      {h.walletId ? (
        <button onClick={() => openWallet(h.walletId!)} className={clsx('num underline decoration-dotted underline-offset-2 hover:text-accent', main?.cls ?? 'text-ink')} title="Open wallet profile (copy trade)">{name}</button>
      ) : (
        <span className={clsx('num', main?.cls ?? (h.wallet === 'YOU' ? 'text-accent font-semibold' : 'text-muted'))}>{name}</span>
      )}
      {walletCount !== undefined && walletCount > 1 && <span className="rounded bg-panel2 px-1 text-[9px] font-semibold text-dim" title="This wallet's trades on this coin">{walletCount}</span>}
      {onFilter && (
        <button onClick={() => onFilter(h.wallet)} className="text-dim opacity-0 transition-opacity hover:text-accent group-hover:opacity-100" title="Show only this wallet's trades">
          <Filter size={11} />
        </button>
      )}
    </div>
  )
}

// ─── Trades ──────────────────────────────────────────────────────────────────

type SideFilter = 'all' | 'buy' | 'sell'
const TRADE_TAGS: HolderTag[] = ['dev', 'whale', 'smart', 'kol', 'sniper']

function TradesTab({ token, walletFilter, setWalletFilter }: { token: Token; walletFilter: string | null; setWalletFilter: (w: string | null) => void }) {
  const now = useGame((s) => s.market.time)
  const nativeUsd = useGame((s) => nativePrice(s.market, token.chain))
  const [side, setSide] = useState<SideFilter>('all')
  const [tag, setTag] = useState<HolderTag | 'you' | null>(null)
  const [minUsd, setMinUsd] = useState(0)
  const [clock, setClock] = useState(false)
  const [inNative, setInNative] = useState(false)
  const book = bookOf(token, now)
  const coin = CHAINS[token.chain].native
  const rows = book.log.filter(
    (t) =>
      (side === 'all' || t.side === side) &&
      t.usd >= minUsd &&
      (!walletFilter || t.wallet === walletFilter) &&
      (!tag || (tag === 'you' ? t.wallet === 'YOU' : t.tag === tag || book.holders.get(t.wallet)?.tags.includes(tag))),
  )
  const filtered = walletFilter ? book.holders.get(walletFilter) : undefined
  return (
    <>
      <Toolbar>
        {(['all', 'buy', 'sell'] as SideFilter[]).map((s) => (
          <Chip key={s} on={side === s} onClick={() => setSide(s)}>
            <span className={s === 'buy' ? 'text-up' : s === 'sell' ? 'text-down' : undefined}>{s === 'all' ? 'All' : s === 'buy' ? 'Buys' : 'Sells'}</span>
          </Chip>
        ))}
        <span className="mx-1 h-3 w-px bg-line2" />
        <Chip on={tag === 'you'} onClick={() => setTag(tag === 'you' ? null : 'you')}>⭐ Mine</Chip>
        {TRADE_TAGS.map((k) => (
          <Chip key={k} on={tag === k} onClick={() => setTag(tag === k ? null : k)} title={TAG[k].label}>{TAG[k].icon} {k === 'smart' ? 'Smart' : TAG[k].label}</Chip>
        ))}
        <span className="mx-1 h-3 w-px bg-line2" />
        {[0, 100, 500, 1000].map((v) => (
          <Chip key={v} on={minUsd === v} onClick={() => setMinUsd(v)}>{v === 0 ? 'Any size' : `≥$${fmtNum(v)}`}</Chip>
        ))}
        {walletFilter && (
          <span className="ml-1 flex shrink-0 items-center gap-1 rounded-md bg-accent/10 px-2 py-0.5 text-[11px] font-semibold text-accent">
            <Filter size={10} /> {displayAddress(walletFilter, token.chain)}
            {filtered && (
              <span className="font-normal text-muted">
                · {filtered.buys}B/{filtered.sells}S · <span className={toneClass(rowOf(filtered, token.price).pnl)}>{signed(rowOf(filtered, token.price).pnl)}</span>
              </span>
            )}
            <button onClick={() => setWalletFilter(null)} className="hover:text-ink" aria-label="Clear wallet filter"><X size={11} /></button>
          </span>
        )}
      </Toolbar>
      {!rows.length ? (
        <EmptyState icon="📭" title={book.log.length ? 'No trades match these filters' : 'No trades yet'} />
      ) : (
        <table className="w-full min-w-[720px] text-[12px]">
          <thead className="sticky top-8 z-[1] bg-panel">
            <tr>
              <th className={clsx(th, 'text-left')}>
                <button onClick={() => setClock((v) => !v)} className="inline-flex items-center gap-1 hover:text-ink" title="Switch between age and time">{clock ? 'Time' : 'Age'} <ArrowDownUp size={10} /></button>
              </th>
              <th className={clsx(th, 'text-left')}>Type</th>
              <th className={clsx(th, 'text-right')}>MC</th>
              <th className={clsx(th, 'text-right')}>Amount</th>
              <th className={clsx(th, 'text-right')}>
                <button onClick={() => setInNative((v) => !v)} className="inline-flex items-center gap-1 hover:text-ink" title={`Show totals in USD or ${coin}`}>Total {inNative ? coin : 'USD'} <ArrowDownUp size={10} /></button>
              </th>
              <th className={clsx(th, 'text-right')}>Gas</th>
              <th className={clsx(th, 'text-left pl-5')}>Trader</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((tr) => {
              const buy = tr.side === 'buy'
              const h = book.holders.get(tr.wallet)
              // Size bar behind the total: log scale, $1 → 0%, $100K → 100%.
              const bar = Math.min(100, Math.max(4, (Math.log10(Math.max(1, tr.usd)) / 5) * 100))
              return (
                <tr key={tr.id} className={clsx(row, 'slide-in', tr.wallet === 'YOU' && 'bg-accent/5')}>
                  <td className={clsx(td, 'num text-muted')}>{clock ? fmtTime(tr.time) : fmtAge(now - tr.time)}</td>
                  <td className={clsx(td, 'font-semibold', buy ? 'text-up' : 'text-down')}>{buy ? 'Buy' : 'Sell'}</td>
                  <td className={clsx(td, 'num text-right text-ink')}>{fmtCompact(tr.price * SUPPLY)}</td>
                  <td className={clsx(td, 'num text-right text-muted')}>{fmtNum(tr.qty)}</td>
                  <td className={clsx(td, 'relative num text-right', buy ? 'text-up' : 'text-down', tr.usd >= 1000 && 'font-bold')}>
                    <span className={clsx('absolute inset-y-1 right-0', buy ? 'bg-up/12' : 'bg-down/12')} style={{ width: `${bar}%` }} />
                    <span className="relative">{inNative ? fmtNative(tr.usd / nativeUsd, token.chain, false) : fmtUsd(tr.usd, tr.usd < 10 ? 3 : 2)}</span>
                  </td>
                  <td className={clsx(td, 'num text-right text-dim')}>{fmtUsd(gasUsd(tr, token.chain), 3)}</td>
                  <td className={clsx(td, 'pl-5')}>
                    <WalletCell h={h ?? { wallet: tr.wallet, tags: tr.tag ? [tr.tag] : [], walletId: tr.walletId }} chain={token.chain} walletCount={h ? h.buys + h.sells : undefined} onFilter={walletFilter ? undefined : setWalletFilter} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </>
  )
}

// ─── Holders & Top Traders ───────────────────────────────────────────────────

/** Your combined position across all your wallets, from your own trade history. */
function youHolder(p: Portfolio, tokenId: string, first: number): Holder | undefined {
  const trades = p.trades.filter((t) => t.tokenId === tokenId)
  if (!trades.length) return undefined
  const h: Holder = { wallet: 'YOU', tags: ['you'], boughtUsd: 0, boughtQty: 0, soldUsd: 0, soldQty: 0, buys: 0, sells: 0, first, last: trades[0].time }
  for (const t of trades) {
    if (t.side === 'buy') {
      h.boughtUsd += t.value + (t.gas ?? 0)
      h.boughtQty += t.qty
      h.buys++
    } else {
      h.soldUsd += t.value - t.fee - (t.gas ?? 0)
      h.soldQty += t.qty
      h.sells++
    }
  }
  // Remaining must match what your wallets actually hold.
  h.boughtQty = Math.max(h.boughtQty, h.soldQty + (p.positions[tokenId]?.qty ?? 0))
  return h
}

function useRows(token: Token) {
  const now = useGame((s) => s.market.time)
  const portfolio = useGame((s) => s.portfolio)
  const book = bookOf(token, now)
  const you = youHolder(portfolio, token.id, token.createdAt)
  const list = [...book.holders.values()].filter((h) => h.wallet !== 'YOU')
  if (you) list.push(you)
  return { now, rows: list.map((h) => rowOf(h, token.price)) }
}

const HOLDER_FILTERS: (HolderTag | null)[] = [null, 'dev', 'sniper', 'insider', 'fresh', 'whale', 'smart', 'you']

function HolderColumns({ pnlLabel = 'PnL', realizedCol }: { pnlLabel?: string; realizedCol?: boolean }) {
  return (
    <thead className="sticky top-8 z-[1] bg-panel">
      <tr>
        <th className={clsx(th, 'w-8 text-left')}>#</th>
        <th className={clsx(th, 'text-left')}>Wallet</th>
        <th className={clsx(th, 'text-right')}>Bal / Last active</th>
        <th className={clsx(th, 'text-right')}>Bought / Avg MC</th>
        <th className={clsx(th, 'text-right')}>Sold / Avg MC</th>
        {realizedCol && <th className={clsx(th, 'text-right')}>Realized</th>}
        <th className={clsx(th, 'text-right')}>Unrealized</th>
        <th className={clsx(th, 'text-right')}>{pnlLabel}</th>
        <th className={clsx(th, 'text-right')}>Remaining</th>
        <th className={clsx(th, 'text-right')}>Funding</th>
      </tr>
    </thead>
  )
}

function HolderLine({ r, rank, token, now, onFilter, realizedCol }: { r: HolderRow; rank: number; token: Token; now: number; onFilter: (w: string) => void; realizedCol?: boolean }) {
  const walletBal = useGame((s) => (r.wallet === 'YOU' ? s.portfolio.balances[token.chain] : undefined))
  const meta = walletMeta(r.wallet, token.chain, r.tags)
  const bal = walletBal ?? meta.balance
  return (
    <tr className={clsx(row, r.wallet === 'YOU' && 'bg-accent/5')}>
      <td className={clsx(td, 'num text-dim')}>{rank}</td>
      <td className={td}><WalletCell h={r} chain={token.chain} onFilter={onFilter} /></td>
      <td className={td}><Stack top={fmtNative(bal, token.chain, false)} bottom={fmtAge(now - r.last)} topCls="text-muted" /></td>
      <td className={td}><Stack top={r.boughtUsd ? fmtUsd(r.boughtUsd) : '$0'} bottom={<>{r.boughtQty ? fmtCompact(r.avgBuy * SUPPLY) : '—'} · {r.buys} TX</>} topCls="text-up" /></td>
      <td className={td}><Stack top={r.soldUsd ? fmtUsd(r.soldUsd) : '$0'} bottom={<>{r.soldQty ? fmtCompact(r.avgSell * SUPPLY) : '—'} · {r.sells} TX</>} topCls="text-down" /></td>
      {realizedCol && <td className={clsx(td, 'num text-right', toneClass(r.realized))}>{signed(r.realized)}</td>}
      <td className={clsx(td, 'num text-right', toneClass(r.unrealized))}>{r.remaining > 1 ? signed(r.unrealized) : '—'}</td>
      <td className={td}><Stack top={signed(r.pnl)} bottom={`${r.pnlPct >= 0 ? '+' : ''}${(r.pnlPct * 100).toFixed(1)}%`} topCls={clsx('font-semibold', toneClass(r.pnl))} /></td>
      <td className={td}>
        <div className="ml-auto w-24">
          <div className="flex items-baseline justify-between gap-2">
            <span className="num text-[12px] text-ink">{r.remaining > 1 ? fmtCompact(r.remaining * token.price) : '$0'}</span>
            <span className="num text-[10px] text-dim">{r.pct >= 0.01 ? `${r.pct.toFixed(2)}%` : r.remaining > 1 ? '<0.01%' : '0%'}</span>
          </div>
          <div className="mt-0.5 h-[3px] overflow-hidden rounded-full bg-line2">
            <div className="h-full rounded-full bg-info" style={{ width: `${Math.min(100, r.pct * 5)}%` }} />
          </div>
        </div>
      </td>
      <td className={td}>
        {r.wallet === 'YOU' ? <span className="block text-right text-[11px] text-dim">—</span> : (
          <Stack top={<span className={meta.cex ? 'text-warn' : 'text-muted'}>{meta.fundedBy}</span>} bottom={<>{fmtAge(meta.fundedAgo)} · {fmtNative(meta.fundedAmount, token.chain)}</>} />
        )}
      </td>
    </tr>
  )
}

function HoldersTab({ token, onFilter }: { token: Token; onFilter: (w: string) => void }) {
  const { now, rows } = useRows(token)
  const [only, setOnly] = useState<HolderTag | null>(null)
  const holding = useMemo(() => rows.filter((r) => r.remaining > 1).sort((a, b) => b.remaining - a.remaining), [rows])
  const shown = (only ? holding.filter((r) => r.tags.includes(only)) : holding).slice(0, 100)
  const myQty = useGame((s) => s.portfolio.positions[token.id]?.qty ?? 0)
  const top10 = top10Of(token, myQty)
  const devPct = devPctOf(token)
  const graduated = token.status !== 'bonding'
  const pad = LAUNCHPADS[token.pad]
  const poolPct = graduated ? Math.min(40, (token.liquidity / 2 / token.mcap) * 100) : Math.max(1, 100 - token.bondingProgress * (pad ? pad.curveTokens / SUPPLY : 0.8))
  return (
    <>
      <Toolbar>
        {HOLDER_FILTERS.map((k) => (
          <Chip key={k ?? 'all'} on={only === k} onClick={() => setOnly(k)} title={k ? TAG[k].label : undefined}>
            {k ? <>{TAG[k].icon} {k === 'you' ? 'Mine' : k === 'smart' ? 'Smart' : TAG[k].label.split(' ')[0]}</> : 'All'}
          </Chip>
        ))}
        <span className="ml-auto shrink-0 pl-3 text-[11px] text-dim">
          Top 10 <span className="num text-ink">{top10.toFixed(1)}%</span> · Dev <span className="num text-ink">{devPct.toFixed(1)}%</span> · Snipers <span className="num text-ink">{token.snipers}</span> · Insiders <span className="num text-ink">{token.insidersPct.toFixed(1)}%</span>
        </span>
      </Toolbar>
      <table className="w-full min-w-[960px] text-[12px]">
        <HolderColumns />
        <tbody>
          {!only && (
            <tr className={clsx(row, 'bg-panel2/40')}>
              <td className={clsx(td, 'text-[12px]')}>🏦</td>
              <td className={clsx(td, 'font-semibold text-ink')} colSpan={6}>
                {graduated ? `${pad?.dex ?? CHAINS[token.chain].dex} pool` : `${pad?.name ?? 'Launchpad'} bonding curve`}
                <span className="ml-2 text-[11px] font-normal text-dim">{graduated ? 'liquidity pool' : `${token.bondingProgress.toFixed(1)}% of the curve sold`}</span>
              </td>
              <td className={td}>
                <div className="ml-auto w-24">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="num text-[12px] text-ink">{fmtCompact((poolPct / 100) * token.mcap)}</span>
                    <span className="num text-[10px] text-dim">{poolPct.toFixed(2)}%</span>
                  </div>
                  <div className="mt-0.5 h-[3px] overflow-hidden rounded-full bg-line2"><div className="h-full rounded-full bg-warn" style={{ width: `${Math.min(100, poolPct)}%` }} /></div>
                </div>
              </td>
              <td className={td} />
            </tr>
          )}
          {shown.map((r, i) => <HolderLine key={r.wallet} r={r} rank={i + 1} token={token} now={now} onFilter={onFilter} />)}
        </tbody>
      </table>
      {!shown.length && <EmptyState icon="👥" title="No holders match this filter" />}
    </>
  )
}

function TopTradersTab({ token, onFilter }: { token: Token; onFilter: (w: string) => void }) {
  const { now, rows } = useRows(token)
  const [only, setOnly] = useState<HolderTag | null>(null)
  const sorted = useMemo(() => rows.filter((r) => r.boughtUsd > 0).sort((a, b) => b.pnl - a.pnl), [rows])
  const shown = (only ? sorted.filter((r) => r.tags.includes(only)) : sorted).slice(0, 100)
  const winners = sorted.filter((r) => r.pnl > 0).length
  return (
    <>
      <Toolbar>
        {HOLDER_FILTERS.map((k) => (
          <Chip key={k ?? 'all'} on={only === k} onClick={() => setOnly(k)} title={k ? TAG[k].label : undefined}>
            {k ? <>{TAG[k].icon} {k === 'you' ? 'Mine' : k === 'smart' ? 'Smart' : TAG[k].label.split(' ')[0]}</> : 'All'}
          </Chip>
        ))}
        <span className="ml-auto shrink-0 pl-3 text-[11px] text-dim">
          In profit <span className="num text-up">{winners}</span> / <span className="num text-ink">{sorted.length}</span> traders
        </span>
      </Toolbar>
      {!shown.length ? <EmptyState icon="🏁" title="No traders yet" /> : (
        <table className="w-full min-w-[1020px] text-[12px]">
          <HolderColumns pnlLabel="Total PnL" realizedCol />
          <tbody>{shown.map((r, i) => <HolderLine key={r.wallet} r={r} rank={i + 1} token={token} now={now} onFilter={onFilter} realizedCol />)}</tbody>
        </table>
      )}
    </>
  )
}

// ─── Positions (your wallets) ────────────────────────────────────────────────

function PositionsTab({ token }: { token: Token }) {
  const portfolio = useGame((s) => s.portfolio)
  const now = useGame((s) => s.market.time)
  const sell = useGame((s) => s.sell)
  const accounts = portfolio.accounts ?? []
  const trades = portfolio.trades.filter((t) => t.tokenId === token.id)
  const primary = accounts[0]?.id
  const lines = accounts
    .map((a) => {
      const mine = trades.filter((t) => (t.walletId ?? primary) === a.id)
      const pos = a.positions[token.id]
      if (!mine.length && !pos) return null
      const buys = mine.filter((t) => t.side === 'buy')
      const sells = mine.filter((t) => t.side === 'sell')
      const bUsd = buys.reduce((s, t) => s + t.value, 0)
      const bQty = buys.reduce((s, t) => s + t.qty, 0)
      const sUsd = sells.reduce((s, t) => s + t.value, 0)
      const sQty = sells.reduce((s, t) => s + t.qty, 0)
      const realized = sells.reduce((s, t) => s + (t.pnl ?? 0), 0)
      const qty = pos?.qty ?? 0
      const unrealized = pos ? qty * token.price - pos.costBasis : 0
      return { a, qty, bUsd, bQty, sUsd, sQty, buys: buys.length, sells: sells.length, realized, unrealized, cost: pos?.costBasis ?? 0 }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
  if (!lines.length) return <EmptyState icon="🪙" title="You haven't traded this token" hint="Press B to buy, or use Instant trade" />
  const total = lines.reduce((s, l) => ({ qty: s.qty + l.qty, realized: s.realized + l.realized, unrealized: s.unrealized + l.unrealized }), { qty: 0, realized: 0, unrealized: 0 })
  return (
    <>
      <table className="w-full min-w-[900px] text-[12px]">
        <thead className="sticky top-0 z-[1] bg-panel">
          <tr>
            <th className={clsx(th, 'text-left')}>Wallet</th>
            <th className={clsx(th, 'text-right')}>Bought / Avg MC</th>
            <th className={clsx(th, 'text-right')}>Sold / Avg MC</th>
            <th className={clsx(th, 'text-right')}>Balance</th>
            <th className={clsx(th, 'text-right')}>Unrealized</th>
            <th className={clsx(th, 'text-right')}>Realized</th>
            <th className={clsx(th, 'text-right')}>Total PnL</th>
            <th className={clsx(th, 'text-right')}>Sell</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => {
            const pnl = l.realized + l.unrealized
            return (
              <tr key={l.a.id} className={row}>
                <td className={clsx(td, 'font-semibold text-ink')}>{l.a.emoji} {l.a.name}</td>
                <td className={td}><Stack top={fmtUsd(l.bUsd)} bottom={<>{l.bQty ? fmtCompact((l.bUsd / l.bQty) * SUPPLY) : '—'} · {l.buys} TX</>} topCls="text-up" /></td>
                <td className={td}><Stack top={fmtUsd(l.sUsd)} bottom={<>{l.sQty ? fmtCompact((l.sUsd / l.sQty) * SUPPLY) : '—'} · {l.sells} TX</>} topCls="text-down" /></td>
                <td className={td}><Stack top={fmtUsd(l.qty * token.price)} bottom={`${fmtNum(l.qty)} ${token.ticker}`} topCls="text-ink" /></td>
                <td className={clsx(td, 'num text-right', toneClass(l.unrealized))}>{l.qty > 0 ? signed(l.unrealized) : '—'}</td>
                <td className={clsx(td, 'num text-right', toneClass(l.realized))}>{signed(l.realized)}</td>
                <td className={td}><Stack top={signed(pnl)} bottom={l.bUsd ? `${pnl >= 0 ? '+' : ''}${((pnl / l.bUsd) * 100).toFixed(1)}%` : undefined} topCls={clsx('font-semibold', toneClass(pnl))} /></td>
                <td className={clsx(td, 'text-right')}>
                  {l.qty > 0 ? (
                    <span className="inline-flex gap-1">
                      {[0.5, 1].map((f) => (
                        <button key={f} onClick={() => sell(l.qty * f, token.id, undefined, l.a.id)} className="rounded border border-down/40 px-1.5 py-0.5 text-[10px] font-bold text-down hover:bg-down/10">
                          {f === 1 ? '100%' : '50%'}
                        </button>
                      ))}
                    </span>
                  ) : <span className="text-[11px] text-dim">closed</span>}
                </td>
              </tr>
            )
          })}
          {lines.length > 1 && (
            <tr className="h-8 border-b border-line/30 bg-panel2/40 font-semibold">
              <td className={clsx(td, 'text-muted')}>All wallets</td>
              <td className={td} colSpan={2} />
              <td className={clsx(td, 'num text-right text-ink')}>{fmtUsd(total.qty * token.price)}</td>
              <td className={clsx(td, 'num text-right', toneClass(total.unrealized))}>{signed(total.unrealized)}</td>
              <td className={clsx(td, 'num text-right', toneClass(total.realized))}>{signed(total.realized)}</td>
              <td className={clsx(td, 'num text-right', toneClass(total.realized + total.unrealized))}>{signed(total.realized + total.unrealized)}</td>
              <td className={td} />
            </tr>
          )}
        </tbody>
      </table>
      <div className="px-3 pb-1 pt-3 text-[11px] font-semibold text-dim">My trades · {trades.length}</div>
      <table className="w-full min-w-[900px] text-[12px]">
        <thead>
          <tr>
            <th className={clsx(th, 'text-left')}>Age</th>
            <th className={clsx(th, 'text-left')}>Type</th>
            <th className={clsx(th, 'text-left')}>Wallet</th>
            <th className={clsx(th, 'text-right')}>MC</th>
            <th className={clsx(th, 'text-right')}>Amount</th>
            <th className={clsx(th, 'text-right')}>Total</th>
            <th className={clsx(th, 'text-right')}>Fees</th>
            <th className={clsx(th, 'text-right')}>PnL</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((t) => {
            const a = accounts.find((x) => x.id === (t.walletId ?? primary))
            return (
              <tr key={t.id} className={row}>
                <td className={clsx(td, 'num text-muted')} title={fmtTime(t.time)}>{fmtAge(now - t.time)}</td>
                <td className={clsx(td, 'font-semibold', t.side === 'buy' ? 'text-up' : 'text-down')}>{t.side === 'buy' ? 'Buy' : 'Sell'}</td>
                <td className={clsx(td, 'text-muted')}>{a ? `${a.emoji} ${a.name}` : '—'}</td>
                <td className={clsx(td, 'num text-right text-ink')}>{fmtCompact(t.price * SUPPLY)}</td>
                <td className={clsx(td, 'num text-right text-muted')}>{fmtNum(t.qty)}</td>
                <td className={td}><Stack top={fmtUsd(t.value)} bottom={t.native ? fmtNative(t.native, token.chain) : undefined} topCls={t.side === 'buy' ? 'text-up' : 'text-down'} /></td>
                <td className={clsx(td, 'num text-right text-dim')}>{fmtUsd(t.fee + (t.gas ?? 0))}</td>
                <td className={clsx(td, 'num text-right', toneClass(t.pnl ?? 0))}>{t.pnl !== undefined ? signed(t.pnl) : '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </>
  )
}

// ─── Dev Token ───────────────────────────────────────────────────────────────

const STATUS: Record<string, { label: string; cls: string }> = {
  migrated: { label: 'Migrated', cls: 'text-up bg-up/10' },
  graduated: { label: 'Migrated', cls: 'text-up bg-up/10' },
  bonding: { label: 'On curve', cls: 'text-info bg-info/10' },
  rugged: { label: 'Rugged', cls: 'text-down bg-down/10' },
  dead: { label: 'Dead', cls: 'text-dim bg-panel2' },
}

function DevTokenTab({ token }: { token: Token }) {
  const now = useGame((s) => s.market.time)
  const launches = useGame((s) => s.launches)
  const tokens = useGame((s) => s.market.tokens)
  const book = bookOf(token, now)
  const yours = token.creator === 'you'
  const others = yours
    ? launches.filter((l) => l.tokenId !== token.id).map((l) => {
        const live = tokens.find((x) => x.id === l.tokenId)
        return { ticker: l.ticker, name: l.name, emoji: l.emoji, ago: now - l.launchedTime, athMc: l.peakMcap, mc: live?.mcap ?? l.lastMcap, status: live?.status ?? l.status, holders: live?.holders ?? 0 }
      })
    : devHistory(token)
  const all = [{ ticker: token.ticker, name: token.name, emoji: token.emoji, ago: now - token.createdAt, athMc: token.ath, mc: token.mcap, status: token.status as string, holders: token.holders, current: true }, ...others]
  const migrated = all.filter((c) => c.status === 'migrated' || c.status === 'graduated').length
  const rugged = all.filter((c) => c.status === 'rugged').length
  const devAddr = yours ? 'You' : displayAddress(book.devWallet, token.chain)
  return (
    <>
      <Toolbar>
        <span className="flex shrink-0 items-center gap-1.5 px-1 text-[11px] text-dim">
          🧑‍💻 Dev <span className="num font-semibold text-ink">{devAddr}</span>
          <span className="mx-1 h-3 w-px bg-line2" />
          Created <span className="num text-ink">{all.length}</span>
          · Migrated <span className="num text-up">{migrated}</span>
          · Rugged <span className={clsx('num', rugged ? 'text-down' : 'text-ink')}>{rugged}</span>
          · Holds <span className="num text-ink">{token.devPct.toFixed(2)}%</span> of this coin
        </span>
        {!yours && rugged >= 3 && <span className="ml-auto shrink-0 rounded bg-down/10 px-2 py-0.5 text-[10px] font-bold text-down">⚠ Serial rugger</span>}
      </Toolbar>
      <table className="w-full min-w-[640px] text-[12px]">
        <thead className="sticky top-8 z-[1] bg-panel">
          <tr>
            <th className={clsx(th, 'text-left')}>Token</th>
            <th className={clsx(th, 'text-left')}>Launched</th>
            <th className={clsx(th, 'text-left')}>Status</th>
            <th className={clsx(th, 'text-right')}>ATH MC</th>
            <th className={clsx(th, 'text-right')}>MC</th>
            <th className={clsx(th, 'text-right')}>Holders</th>
          </tr>
        </thead>
        <tbody>
          {all.map((c, i) => (
            <tr key={`${c.ticker}-${i}`} className={clsx(row, 'current' in c && 'bg-accent/5')}>
              <td className={td}>
                <span className="mr-1.5">{c.emoji}</span>
                <span className="font-semibold text-ink">${c.ticker}</span>
                <span className="ml-1.5 text-[11px] text-dim">{c.name}</span>
                {'current' in c && <span className="ml-2 rounded bg-accent/10 px-1 text-[9px] font-bold text-accent">THIS COIN</span>}
              </td>
              <td className={clsx(td, 'num text-muted')}>{fmtAge(c.ago)} ago</td>
              <td className={td}><span className={clsx('rounded px-1.5 py-0.5 text-[10px] font-semibold', STATUS[c.status]?.cls)}>{STATUS[c.status]?.label ?? c.status}</span></td>
              <td className={clsx(td, 'num text-right text-ink')}>{fmtCompact(c.athMc)}</td>
              <td className={clsx(td, 'num text-right text-muted')}>{fmtCompact(c.mc)}</td>
              <td className={clsx(td, 'num text-right text-muted')}>{fmtNum(c.holders)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
