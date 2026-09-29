import clsx from 'clsx'
import { Check as CheckIcon, Coins, Copy, Search, Share2, X } from 'lucide-react'
import { FundWalletsModal } from '../components/FundWallets'
import { useMemo, useState, type ReactNode } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ChainBadge, WalletChip } from '../components/chain'
import { LifetimeStats, PnlCalendar } from '../components/portfolio/PnlCalendar'
import { EmptyState, Modal, Segmented, TokenIcon } from '../components/ui'
import { useTokenMap, useValuation } from '../hooks/useDerived'
import { SIM_SEC_PER_TICK, SUPPLY } from '../game/marketEngine'
import { levelFromXp, MODES, titleFor } from '../game/progression'
import { useGame } from '../game/store'
import { GROUP_EMOJIS, useWalletGroups } from '../game/walletGroups'
import { accountValue } from '../game/accounts'
import type { Account, Chain, Position, Token, Trade } from '../types'
import { CHAIN_IDS, CHAINS, fmtNative } from '../data/chains'
import { load, save } from '../utils/storage'
import { fakeAddress } from '../utils/address'
import { fmtAge, fmtCompact, fmtNum, fmtPct, fmtPrice, fmtTime, fmtUsd, toneClass } from '../utils/format'

type Period = '1H' | '24H' | 'ALL'
type Tab = 'holding' | 'pnl' | 'activity' | 'deployed' | 'groups'
const PERIOD_SEC: Record<Period, number> = { '1H': 3600, '24H': 86400, ALL: Infinity } // converted with the market's clock when used

type Unit = 'usd' | 'native'
/** Money formatter: USD, or the amount in a chain's coin (signed = always show +/-). */
/** Money formatter: USD, or the amount in a chain's coin. `nat` = the exact coin amount (from the trades
 *  themselves); without it the USD figure is converted at today's coin price. */
type Money = (usd: number, chain?: Chain, signed?: boolean, nat?: number) => string

/** The chain coin's USD price when a trade happened, from what it actually paid or received. */
function tradePx(tr: Trade): number | undefined {
  if (!tr.native) return undefined
  const usd = tr.side === 'buy' ? tr.value + tr.fee + (tr.gas ?? 0) : tr.value - tr.fee - (tr.gas ?? 0)
  return usd > 0 ? usd / tr.native : undefined
}

/** Per-token rollup of every fill in the round. */
interface TokenPnl {
  tokenId: string
  chain: Chain
  ticker: string
  emoji: string
  hue: number
  t?: Token
  buys: number
  sells: number
  bought: number // USD spent incl. fees
  boughtQty: number
  sold: number // USD received after fees
  soldGross: number
  soldQty: number
  realized: number
  realizedInWindow: number
  // The same in the chain coin, at the price when each trade happened (NaN if an old trade didn't record it).
  boughtN: number
  soldN: number
  realizedN: number
  realizedInWindowN: number
  unrealizedN: number // open bag: live, at today's coin price
  totalN: number
  qty: number
  cost: number
  value: number
  unrealized: number
  total: number
  totalPct: number
  firstTick: number
  lastTick: number
  firstSellTick: number | null
  vias: Set<string>
}

function rollup(trades: Trade[], positions: Record<string, { qty: number; costBasis: number; openedAt: number }>, map: Map<string, Token>, fromTick: number, px: (c: Chain) => number): TokenPnl[] {
  const by = new Map<string, TokenPnl>()
  for (const tr of [...trades].reverse()) {
    let r = by.get(tr.tokenId)
    if (!r) {
      r = { tokenId: tr.tokenId, chain: map.get(tr.tokenId)?.chain ?? tr.chain ?? 'sol', ticker: tr.ticker, emoji: tr.emoji, hue: tr.hue, t: map.get(tr.tokenId), buys: 0, sells: 0, bought: 0, boughtQty: 0, sold: 0, soldGross: 0, soldQty: 0, realized: 0, realizedInWindow: 0, boughtN: 0, soldN: 0, realizedN: 0, realizedInWindowN: 0, unrealizedN: 0, totalN: 0, qty: 0, cost: 0, value: 0, unrealized: 0, total: 0, totalPct: 0, firstTick: tr.tick, lastTick: tr.tick, firstSellTick: null, vias: new Set() }
      by.set(tr.tokenId, r)
    }
    if (tr.via) r.vias.add(tr.via)
    r.lastTick = tr.tick
    if (tr.side === 'buy') {
      r.buys++
      r.bought += tr.value
      r.boughtQty += tr.qty
      r.boughtN += tr.native ?? NaN
    } else {
      r.sells++
      if (r.firstSellTick === null) r.firstSellTick = tr.tick
      r.sold += tr.value - tr.fee
      r.soldGross += tr.value
      r.soldQty += tr.qty
      r.realized += tr.pnl ?? 0
      if (tr.tick >= fromTick) r.realizedInWindow += tr.pnl ?? 0
      const p = tradePx(tr)
      r.soldN += tr.native ?? NaN
      r.realizedN += p ? (tr.pnl ?? 0) / p : NaN
      if (tr.tick >= fromTick) r.realizedInWindowN += p ? (tr.pnl ?? 0) / p : NaN
    }
  }
  for (const r of by.values()) {
    const pos = positions[r.tokenId]
    if (pos) {
      r.qty = pos.qty
      r.cost = pos.costBasis
      r.value = r.t ? pos.qty * r.t.price : 0
      r.unrealized = r.value - r.cost
    }
    r.total = r.realized + r.unrealized
    r.totalPct = r.bought > 0 ? r.total / r.bought : 0
    // Old trades without a recorded coin amount fall back to today's price.
    const live = px(r.chain)
    if (!Number.isFinite(r.boughtN)) r.boughtN = r.bought / live
    if (!Number.isFinite(r.soldN)) r.soldN = r.sold / live
    if (!Number.isFinite(r.realizedN)) r.realizedN = r.realized / live
    if (!Number.isFinite(r.realizedInWindowN)) r.realizedInWindowN = r.realizedInWindow / live
    r.unrealizedN = r.unrealized / live
    r.totalN = r.realizedN + r.unrealizedN
  }
  return [...by.values()]
}

const BUCKETS: { label: string; test: (p: number) => boolean; cls: string }[] = [
  { label: '>500%', test: (p) => p > 5, cls: 'bg-up' },
  { label: '200% ~ 500%', test: (p) => p > 2 && p <= 5, cls: 'bg-up/75' },
  { label: '0% ~ 200%', test: (p) => p >= 0 && p <= 2, cls: 'bg-up/45' },
  { label: '0% ~ -50%', test: (p) => p < 0 && p >= -0.5, cls: 'bg-down/55' },
  { label: '< -50%', test: (p) => p < -0.5, cls: 'bg-down' },
]

export function PortfolioView() {
  const v = useValuation()
  const p = v.portfolio
  const map = useTokenMap()
  const tick = useGame((s) => s.market.tick)
  const mode = useGame((s) => s.mode)
  const xp = useGame((s) => s.profile.xp)
  const launches = useGame((s) => s.launches)
  const native = useGame((s) => s.market.native)
  const setWalletsOpen = useGame((s) => s.setWalletsOpen)
  const [period, setPeriod] = useState<Period>('ALL')
  const [tab, setTab] = useState<Tab>('holding')
  const [share, setShare] = useState(false)
  const [funding, setFunding] = useState<string[] | null>(null) // wallets to pre-select ([] = default)
  // GMGN-style: show money in USD or in each coin's own chain coin; look at all wallets or one.
  const [unit, setUnitState] = useState<Unit>(() => load<Unit>('pfUnit') ?? 'usd')
  const setUnit = (u: Unit) => {
    setUnitState(u)
    save('pfUnit', u)
  }
  const [walletSel, setWalletSel] = useState<string>('all')
  const accounts = p.accounts ?? []
  const firstId = accounts[0]?.id
  const groups = useWalletGroups((s) => s.groups)
  const group = walletSel.startsWith('g:') ? groups.find((g) => `g:${g.id}` === walletSel) : undefined
  const groupAccs = useMemo(() => (group ? accounts.filter((a) => group.walletIds.includes(a.id)) : []), [group, accounts])
  const acc = accounts.find((a) => a.id === walletSel)
  const scopeTrades = useMemo(() => {
    if (acc) return p.trades.filter((t) => (t.walletId ?? firstId) === acc.id)
    if (group) return p.trades.filter((t) => groupAccs.some((a) => a.id === (t.walletId ?? firstId)))
    return p.trades
  }, [acc, group, groupAccs, p.trades, firstId])
  const scopePositions = useMemo(() => (acc ? acc.positions : group ? mergePositions(groupAccs) : p.positions), [acc, group, groupAccs, p.positions])
  const fromTick = period === 'ALL' ? -Infinity : tick - PERIOD_SEC[period] / SIM_SEC_PER_TICK
  const px = (c: Chain) => native?.[c]?.price ?? CHAINS[c].basePrice
  const m: Money = (usd, chain, signed, nat) => {
    if (unit === 'usd' || !chain) return `${signed ? (usd >= 0 ? '+' : '-') : usd < 0 ? '-' : ''}${fmtUsd(Math.abs(usd))}`
    const n = nat !== undefined && Number.isFinite(nat) ? nat : usd / px(chain)
    return `${signed ? (n >= 0 ? '+' : '-') : n < 0 ? '-' : ''}${fmtNative(Math.abs(n), chain)}`
  }

  const rows = useMemo(() => rollup(scopeTrades, scopePositions, map, fromTick, px), [scopeTrades, scopePositions, map, fromTick, native])
  const inWindow = rows.filter((r) => r.lastTick >= fromTick)
  const traded = inWindow.filter((r) => r.sells > 0)
  const realizedWin = inWindow.reduce((a, r) => a + r.realizedInWindow, 0)
  const unrealized = rows.reduce((a, r) => a + r.unrealized, 0)
  const totalPnl = acc || group ? rows.reduce((a, r) => a + r.total, 0) : v.stats.totalPnl
  // Multi-chain totals in coin mode: one figure per chain coin.
  // `pickN` gives each row's figure in its chain coin.
  const byChain = (pickN: (r: TokenPnl) => number, list = rows) => {
    const sums: Partial<Record<Chain, number>> = {}
    for (const r of list) sums[r.chain] = (sums[r.chain] ?? 0) + pickN(r)
    const parts = (Object.entries(sums) as [Chain, number][]).filter(([c, n]) => Math.abs(n * px(c)) > 0.005)
    return parts.length ? parts.map(([c, n]) => m(0, c, true, n)).join(' · ') : m(0, 'sol', true, 0)
  }
  const total = (usd: number, pickN: (r: TokenPnl) => number, list?: TokenPnl[]) => (unit === 'usd' ? m(usd, undefined, true) : byChain(pickN, list))
  const wins = traded.filter((r) => r.total > 0).length
  const winRate = traded.length ? wins / traded.length : 0
  const windowTrades = scopeTrades.filter((t) => t.tick >= fromTick)
  const buysN = windowTrades.filter((t) => t.side === 'buy').length
  const sellsN = windowTrades.length - buysN
  const fees = windowTrades.reduce((a, t) => a + t.fee, 0)
  const holdTicks = traded.map((r) => (r.qty > 0 ? tick : r.lastTick) - r.firstTick)
  const avgHold = holdTicks.length ? holdTicks.reduce((a, b) => a + b, 0) / holdTicks.length : 0
  const best = [...inWindow].sort((a, b) => b.total - a.total)[0]
  const worst = [...inWindow].sort((a, b) => a.total - b.total)[0]
  const dist = BUCKETS.map((b) => ({ ...b, n: traded.filter((r) => b.test(r.totalPct)).length }))
  const lvl = levelFromXp(xp).level
  const windowBuys = windowTrades.filter((t) => t.side === 'buy')
  const boughtUsd = windowBuys.reduce((a, t) => a + t.value, 0)
  const soldUsd = windowTrades.filter((t) => t.side === 'sell').reduce((a, t) => a + t.value - t.fee, 0)
  // GMGN-style trading-habit checks for this wallet / period.
  const flipTicks = 30 / SIM_SEC_PER_TICK
  const habits = [
    { label: 'Quick flips (sold < 30s)', n: inWindow.filter((r) => r.firstSellTick !== null && r.firstSellTick - r.firstTick <= flipTicks).length, bad: false },
    { label: 'Held into a rug', n: inWindow.filter((r) => r.t?.status === 'rugged' || (!r.t && r.qty > 0)).length, bad: true },
    { label: 'Closed below -50%', n: traded.filter((r) => r.qty <= 0 && r.totalPct < -0.5).length, bad: true },
    { label: 'Copy-trade fills', n: windowTrades.filter((t) => t.via).length, bad: false },
  ]

  return (
    <div className="h-full overflow-y-auto">
      {/* Wallet header */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-line bg-panel px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="relative grid size-12 place-items-center rounded-full bg-accent/15 text-[22px] ring-2 ring-accent/50">🫵
            <span className="absolute -bottom-1 -right-1 grid size-5 place-items-center rounded-full bg-accent font-display text-[10px] font-bold text-accent-ink">{lvl}</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-display text-[18px] font-bold">You</span>
              <span className="rounded bg-raise px-1.5 text-[10px] font-semibold text-muted">{titleFor(lvl)}</span>
              <span className="rounded bg-accent/15 px-1.5 text-[10px] font-bold text-accent">{MODES[mode].name.toUpperCase()}</span>
            </div>
            <div className="mt-0.5 flex items-center gap-1 num text-[11px] text-dim">
              {fakeAddress('player-wallet')}
              <button onClick={() => navigator.clipboard?.writeText(fakeAddress('player-wallet')).catch(() => {})} className="hover:text-ink" title="Copy (fictional) address"><Copy size={11} /></button>
            </div>
          </div>
        </div>
        <div>
          <div className="text-[10px] text-dim">Balance{acc ? ` · ${acc.emoji} ${acc.name}` : group ? ` · ${group.emoji} ${group.name} (${groupAccs.length} wallets)` : ''}</div>
          {group ? (
            <>
              <div className="num text-[22px] font-bold leading-none">{fmtUsd(rows.reduce((a, r) => a + r.value, 0) + CHAIN_IDS.reduce((a, c) => a + groupAccs.reduce((s, x) => s + x.balances[c], 0) * px(c), 0))}</div>
              <div className="num mt-0.5 text-[11px] text-muted">{CHAIN_IDS.map((c) => fmtNative(groupAccs.reduce((s, x) => s + x.balances[c], 0), c)).join(' · ')} · bags {fmtUsd(rows.reduce((a, r) => a + r.value, 0))}</div>
            </>
          ) : acc ? (
            <>
              <div className="num text-[22px] font-bold leading-none">{fmtUsd(rows.reduce((a, r) => a + r.value, 0) + CHAIN_IDS.reduce((a, c) => a + acc.balances[c] * px(c), 0))}</div>
              <div className="num mt-0.5 text-[11px] text-muted">{CHAIN_IDS.map((c) => fmtNative(acc.balances[c], c)).join(' · ')} · bags {fmtUsd(rows.reduce((a, r) => a + r.value, 0))}</div>
            </>
          ) : (
            <>
              <div className="num text-[22px] font-bold leading-none">{fmtUsd(v.equity)}</div>
              <div className="num mt-0.5 text-[11px] text-muted">USD {fmtUsd(p.cash)} · Chain coins {fmtUsd(v.nativeUsd)} · Invested {fmtUsd(v.invested)}</div>
            </>
          )}
          <div className="mt-1"><WalletChip /></div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Segmented value={unit} onChange={setUnit} options={[{ value: 'usd', label: 'USD' }, { value: 'native', label: 'SOL · BNB · ETH' }]} />
          <Segmented value={period} onChange={setPeriod} options={[{ value: '1H', label: '1H' }, { value: '24H', label: '24H' }, { value: 'ALL', label: 'All' }]} />
          <button onClick={() => setFunding([])} className="flex items-center gap-1 rounded-md border border-accent/50 bg-accent/10 px-2.5 py-1 text-[11px] font-semibold text-accent hover:bg-accent/20"><Coins size={12} /> Fund wallets</button>
          <button onClick={() => setShare(true)} className="flex items-center gap-1 rounded-md border border-line2 px-2.5 py-1 text-[11px] font-semibold text-muted hover:text-ink"><Share2 size={12} /> Share PnL</button>
        </div>
      </div>

      {/* Wallet filter */}
      {accounts.length > 1 && (
        <div className="no-scrollbar flex items-center gap-1 overflow-x-auto border-b border-line bg-panel px-3 py-1.5" role="group" aria-label="Wallet">
          <span className="mr-1 shrink-0 text-[10px] uppercase tracking-wider text-dim">Wallet</span>
          {[{ id: 'all', emoji: '👛', name: 'All wallets' }, ...accounts].map((a) => (
            <button
              key={a.id}
              onClick={() => setWalletSel(a.id)}
              aria-pressed={walletSel === a.id}
              className={clsx('flex shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold', walletSel === a.id ? 'border-accent/50 bg-accent/10 text-accent' : 'border-line2 text-muted hover:text-ink')}
            >
              <span>{a.emoji}</span>
              {a.name}
            </button>
          ))}
          {groups.length > 0 && <span className="mx-1 h-4 w-px shrink-0 bg-line2" />}
          {groups.map((g) => (
            <button
              key={g.id}
              onClick={() => setWalletSel(`g:${g.id}`)}
              aria-pressed={walletSel === `g:${g.id}`}
              title={`Group: ${accounts.filter((a) => g.walletIds.includes(a.id)).map((a) => a.name).join(', ') || 'no wallets'}`}
              className={clsx('flex shrink-0 items-center gap-1 rounded-md border border-dashed px-2 py-0.5 text-[11px] font-semibold', walletSel === `g:${g.id}` ? 'border-accent/60 bg-accent/10 text-accent' : 'border-line2 text-muted hover:text-ink')}
            >
              <span>{g.emoji}</span>
              {g.name}
              <span className="num text-[9px] text-dim">{accounts.filter((a) => g.walletIds.includes(a.id)).length}</span>
            </button>
          ))}
          <button onClick={() => setTab('groups')} className="ml-1 shrink-0 text-[11px] text-dim hover:text-ink">Groups…</button>
          <button onClick={() => setWalletsOpen(true)} className="ml-1 shrink-0 text-[11px] text-dim hover:text-ink">Manage…</button>
        </div>
      )}

      <div className="space-y-3 p-3">
        {/* GMGN-style overview: PnL + chart · Analysis · Distribution */}
        <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <PnlCard
            className="lg:col-span-2 xl:col-span-1"
            label={`${period === 'ALL' ? 'Round' : period} Realized PnL`}
            headline={
              <div className={clsx('num font-bold leading-tight', toneClass(realizedWin), unit === 'native' ? 'text-[20px]' : 'text-[28px]')}>
                {total(realizedWin, (r) => r.realizedInWindowN, inWindow)}
                {unit === 'usd' && !acc && !group && <span className="ml-2 text-[14px]">{fmtPct(realizedWin / p.startBalance, 2)}</span>}
              </div>
            }
            trades={scopeTrades}
            fromTick={fromTick}
          />

          <div className="rounded-md border border-line bg-panel p-3">
            <div className="mb-2 text-[12px] font-bold">Analysis</div>
            <div className="space-y-2 text-[12px]">
              <Line label="Total PnL"><span className={toneClass(totalPnl)}>{total(totalPnl, (r) => r.totalN)}{unit === 'usd' && !acc && !group && ` (${fmtPct(v.stats.totalPnlPct)})`}</span></Line>
              <Line label="Unrealized PnL"><span className={toneClass(unrealized)}>{total(unrealized, (r) => r.unrealizedN)}</span></Line>
              <Line label="Win rate"><span className={winRate >= 0.5 ? 'text-up' : 'text-ink'}>{traded.length ? `${(winRate * 100).toFixed(1)}%` : '--'}</span></Line>
              <Line label="TXs"><span className="text-up">{buysN}</span>/<span className="text-down">{sellsN}</span></Line>
              <Line label="Total bought">{fmtUsd(boughtUsd)}</Line>
              <Line label="Total sold">{fmtUsd(soldUsd)}</Line>
              <Line label="Avg buy size">{windowBuys.length ? fmtUsd(boughtUsd / windowBuys.length) : '--'}</Line>
              <Line label="Tokens traded">{inWindow.length}</Line>
              <Line label="Avg duration">{holdTicks.length ? fmtAge(avgHold * SIM_SEC_PER_TICK) : '--'}</Line>
              <Line label="Fees paid">{fmtUsd(fees)}</Line>
              <Line label="Best">{best && best.total > 0 ? <span className="text-up">{best.ticker} {m(best.total, best.chain, true, best.totalN)}</span> : '--'}</Line>
              <Line label="Worst">{worst && worst.total < 0 ? <span className="text-down">{worst.ticker} {m(worst.total, worst.chain, true, worst.totalN)}</span> : '--'}</Line>
            </div>
          </div>

          <div className="rounded-md border border-line bg-panel p-3">
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-[12px] font-bold">Distribution</span>
              <span className="text-[10px] text-dim">{traded.length} tokens with sells</span>
            </div>
            <div className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-line2">
              {traded.length > 0 && dist.map((d) => d.n > 0 && <div key={d.label} className={d.cls} style={{ width: `${(d.n / traded.length) * 100}%` }} title={`${d.label}: ${d.n}`} />)}
            </div>
            <div className="mt-2 space-y-1">
              {dist.map((d) => (
                <div key={d.label} className="flex items-center gap-2 text-[11px]">
                  <span className={clsx('size-2 rounded-sm', d.cls)} />
                  <span className="text-muted">{d.label}</span>
                  <span className="ml-auto num text-ink">{d.n}</span>
                  <span className="num w-10 text-right text-[10px] text-dim">{traded.length ? `${Math.round((d.n / traded.length) * 100)}%` : '--'}</span>
                </div>
              ))}
            </div>
            <div className="mb-1.5 mt-4 text-[12px] font-bold">Trading habits</div>
            <div className="space-y-1">
              {habits.map((h) => (
                <div key={h.label} className="flex items-center gap-2 text-[11px]">
                  <span className={clsx('size-1.5 rounded-full', h.n === 0 ? 'bg-line2' : h.bad ? 'bg-down' : 'bg-info')} />
                  <span className="text-muted">{h.label}</span>
                  <span className={clsx('ml-auto num', h.n && h.bad ? 'text-down' : 'text-ink')}>{h.n}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* PnL calendar (lifetime, by real day) */}
        <div className="grid gap-3 xl:grid-cols-[minmax(0,2.5fr)_minmax(0,1fr)]">
          <PnlCalendar />
          <LifetimeStats />
        </div>

        {/* Tabs */}
        <div className="rounded-md border border-line bg-panel">
          <div className="flex items-center gap-5 overflow-x-auto border-b border-line px-3 no-scrollbar">
            {([
              ['holding', `Holding ${Object.keys(scopePositions).length}`],
              ['pnl', `Recent PnL ${inWindow.length}`],
              ['activity', `Activity ${windowTrades.length}`],
              ['deployed', `Deployed ${launches.length}`],
              ['groups', `Wallet groups ${groups.length}`],
            ] as [Tab, string][]).map(([id, label]) => (
              <button key={id} onClick={() => setTab(id)} className={clsx('relative h-10 shrink-0 text-[13px] font-semibold', tab === id ? 'text-ink' : 'text-dim hover:text-muted')}>
                {label}
                {tab === id && <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-ink" />}
              </button>
            ))}
          </div>
          <div className="max-h-[560px] overflow-auto">
            {tab === 'holding' && <Holding rows={rows.filter((r) => r.qty > 0)} equity={v.equity} m={m} positions={scopePositions} scope={acc ? acc.id : group ? groupAccs.map((a) => a.id) : 'all'} />}
            {tab === 'pnl' && <RecentPnl rows={inWindow} m={m} />}
            {tab === 'activity' && <Activity trades={windowTrades} m={m} showWallet={!acc && accounts.length > 1} />}
            {tab === 'deployed' && <Deployed />}
            {tab === 'groups' && <Groups onView={(id) => setWalletSel(`g:${id}`)} onFund={(ids) => setFunding(ids)} viewing={group?.id} />}
          </div>
        </div>
      </div>
      {funding && <FundWalletsModal initialTo={funding.length ? funding : undefined} onClose={() => setFunding(null)} />}
      {share && <ShareCard onClose={() => setShare(false)} realized={realizedWin} total={v.stats.totalPnl} totalPct={v.stats.totalPnlPct} winRate={winRate} traded={traded.length} best={best} period={period} />}
    </div>
  )
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-dim">{label}</span>
      <span className="num truncate">{children}</span>
    </div>
  )
}

const th = 'px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-dim whitespace-nowrap'
const td = 'px-3 py-2 whitespace-nowrap border-b border-line/40'

function TokenCell({ r }: { r: TokenPnl }) {
  const select = useGame((s) => s.select)
  const now = useGame((s) => s.market.time)
  return (
    <button disabled={!r.t} onClick={() => r.t && select(r.t.id)} className="flex items-center gap-2 text-left hover:text-accent">
      <TokenIcon token={r.t ?? { emoji: r.emoji, hue: r.hue, status: 'dead' }} size={26} />
      <span className="min-w-0">
        <span className="flex items-center gap-1 font-bold">{r.ticker}{r.t && <ChainBadge chain={r.t.chain} />}{r.t?.creator === 'you' && <span className="text-[9px] text-warn">🍳</span>}{r.vias.size > 0 && <span className="rounded bg-info/10 px-1 text-[9px] text-info" title={`Copied from ${[...r.vias].join(', ')}`}>⚡ copy</span>}</span>
        <span className="num block text-[10px] text-dim">{r.t ? `${fmtCompact(r.t.mcap)} MC · ${fmtAge(now - r.t.createdAt)}` : 'delisted'}{r.t?.status === 'rugged' && <span className="ml-1 font-bold text-down">RUGGED</span>}</span>
      </span>
    </button>
  )
}

// ─── Wallet groups ───────────────────────────────────────────────────────────

/** All the bags of several wallets, added up per coin. */
function mergePositions(list: Account[]): Record<string, Position> {
  const out: Record<string, Position> = {}
  for (const a of list) {
    for (const [id, pos] of Object.entries(a.positions)) {
      const o = out[id]
      if (!o) out[id] = { ...pos }
      else {
        const qty = o.qty + pos.qty
        out[id] = { ...o, qty, costBasis: o.costBasis + pos.costBasis, avgEntry: qty > 0 ? (o.costBasis + pos.costBasis) / qty : 0, openedAt: Math.min(o.openedAt, pos.openedAt), realized: o.realized + pos.realized }
      }
    }
  }
  return out
}

/** Axiom-style wallet groups: bundle wallets, see them as one, and trade from the whole group in one click. */
function Groups({ onView, onFund, viewing }: { onView: (id: string) => void; onFund: (walletIds: string[]) => void; viewing?: string }) {
  const groups = useWalletGroups((s) => s.groups)
  const add = useWalletGroups((s) => s.add)
  const update = useWalletGroups((s) => s.update)
  const remove = useWalletGroups((s) => s.remove)
  const accounts = useGame((s) => s.portfolio.accounts) ?? []
  const active = useGame((s) => s.portfolio.active)
  const trades = useGame((s) => s.portfolio.trades)
  const market = useGame((s) => s.market)
  const setActive = useGame((s) => s.setActiveWallets)
  const setWalletsOpen = useGame((s) => s.setWalletsOpen)
  const notify = useGame((s) => s.notify)
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState(GROUP_EMOJIS[0])
  const [pick, setPick] = useState<string[]>([])
  const firstId = accounts[0]?.id
  const price = useMemo(() => new Map(market.tokens.map((t) => [t.id, t.price])), [market.tokens])
  const nativeUsd = (c: Chain) => market.native?.[c]?.price ?? CHAINS[c].basePrice
  const valueOf = (a: Account) => accountValue(a, (id) => price.get(id) ?? 0, nativeUsd)
  const activeIds = active ?? (firstId ? [firstId] : [])

  const create = () => {
    if (!pick.length) return notify({ title: 'WALLET GROUP', body: 'Pick at least one wallet for the group', tone: 'warn', icon: '📁' })
    add(name, emoji, pick)
    notify({ title: 'GROUP CREATED', body: `${emoji} ${name.trim() || 'New group'} · ${pick.length} wallet${pick.length > 1 ? 's' : ''}`, tone: 'up', icon: '📁' }, 'click')
    setName('')
    setPick([])
    setEmoji(GROUP_EMOJIS[(groups.length + 1) % GROUP_EMOJIS.length])
  }

  if (accounts.length < 2) {
    return (
      <div className="p-6 text-center text-[12px] text-dim">
        <div className="mb-1 text-[22px]">📁</div>
        Groups bundle several wallets together. You only have one wallet right now.
        <div className="mt-2"><button onClick={() => setWalletsOpen(true)} className="rounded-md border border-accent/50 bg-accent/10 px-3 py-1 text-[12px] font-semibold text-accent hover:bg-accent/20">Create more wallets</button></div>
      </div>
    )
  }

  return (
    <div className="space-y-3 p-3 text-[12px]">
      {/* New group */}
      <div className="rounded-md border border-line bg-bg/50 p-3">
        <div className="mb-2 text-[12px] font-bold">New group</div>
        <div className="flex flex-wrap items-center gap-1.5">
          <select value={emoji} onChange={(e) => setEmoji(e.target.value)} className="h-8 rounded-md border border-line2 bg-bg text-[14px]" aria-label="Group icon">
            {GROUP_EMOJIS.map((em) => <option key={em}>{em}</option>)}
          </select>
          <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} placeholder="Group name (e.g. Snipers, Stealth, Bundle)" className="h-8 min-w-0 flex-1 rounded-md border border-line2 bg-bg px-2 outline-none focus:border-accent/60" />
          <button onClick={create} className="h-8 rounded-md bg-accent px-3 text-[12px] font-bold text-accent-ink hover:brightness-110">Create</button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {accounts.map((a) => {
            const on = pick.includes(a.id)
            return (
              <button key={a.id} onClick={() => setPick(on ? pick.filter((x) => x !== a.id) : [...pick, a.id])} aria-pressed={on} className={clsx('flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold', on ? 'border-accent/60 bg-accent/10 text-accent' : 'border-line2 text-muted hover:text-ink')}>
                {on && <CheckIcon size={10} />}{a.emoji} {a.name}
              </button>
            )
          })}
        </div>
      </div>

      {groups.length === 0 && <EmptyState icon="📁" title="No groups yet" hint="Make one above, then trade from the whole group with one click." />}

      {groups.map((g) => {
        const members = accounts.filter((a) => g.walletIds.includes(a.id))
        const ids = members.map((a) => a.id)
        const value = members.reduce((s, a) => s + valueOf(a), 0)
        const pos = mergePositions(members)
        const bags = Object.values(pos).reduce((s, p) => s + p.qty * (price.get(p.tokenId) ?? 0), 0)
        const unreal = bags - Object.values(pos).reduce((s, p) => s + p.costBasis, 0)
        const mine = trades.filter((t) => ids.includes(t.walletId ?? firstId ?? ''))
        const realized = mine.reduce((s, t) => s + (t.pnl ?? 0), 0)
        const trading = ids.length > 0 && ids.length === activeIds.length && ids.every((id) => activeIds.includes(id))
        return (
          <div key={g.id} className={clsx('rounded-md border p-3', viewing === g.id ? 'border-accent/50 bg-accent/5' : 'border-line')}>
            <div className="flex flex-wrap items-center gap-2">
              <select value={g.emoji} onChange={(e) => update(g.id, { emoji: e.target.value })} className="h-7 rounded border border-line2 bg-bg text-[14px]" aria-label="Group icon">
                {GROUP_EMOJIS.map((em) => <option key={em}>{em}</option>)}
              </select>
              <input defaultValue={g.name} maxLength={20} onBlur={(e) => e.target.value.trim() && update(g.id, { name: e.target.value.trim() })} className="h-7 w-40 rounded border border-transparent bg-transparent px-1 font-bold outline-none hover:border-line2 focus:border-accent/60" aria-label="Group name" />
              <span className="text-[10px] text-dim">{members.length} wallet{members.length === 1 ? '' : 's'}</span>
              <span className="ml-auto flex items-center gap-1.5">
                <button
                  onClick={() => {
                    if (!ids.length) return
                    setActive(ids)
                    notify({ title: 'TRADING FROM GROUP', body: `${g.emoji} ${g.name}: buys split across ${ids.length} wallet${ids.length > 1 ? 's' : ''}`, tone: 'info', icon: '📁' }, 'click')
                  }}
                  disabled={!ids.length}
                  className={clsx('rounded-md border px-2 py-1 text-[11px] font-semibold disabled:opacity-40', trading ? 'border-accent bg-accent text-accent-ink' : 'border-accent/50 bg-accent/10 text-accent hover:bg-accent/20')}
                  title="Tick exactly these wallets in the trade panel"
                >
                  {trading ? '✓ Trading from group' : 'Trade from group'}
                </button>
                <button onClick={() => onFund(ids)} disabled={!ids.length} className="rounded-md border border-line2 px-2 py-1 text-[11px] font-semibold text-muted hover:text-ink disabled:opacity-40" title="Top up every wallet in this group">Fund</button>
                <button onClick={() => onView(g.id)} className="rounded-md border border-line2 px-2 py-1 text-[11px] font-semibold text-muted hover:text-ink" title="Show this group's PnL, holdings and activity above">View PnL</button>
                <button onClick={() => remove(g.id)} className="rounded p-1 text-dim hover:text-down" aria-label={`Delete ${g.name}`} title="Delete group (wallets are kept)"><X size={13} /></button>
              </span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Mini label="Value">{fmtUsd(value)}</Mini>
              <Mini label="Bags">{fmtUsd(bags)}</Mini>
              <Mini label="Unrealized"><span className={toneClass(unreal)}>{unreal >= 0 ? '+' : '-'}{fmtUsd(Math.abs(unreal))}</span></Mini>
              <Mini label="Realized"><span className={toneClass(realized)}>{realized >= 0 ? '+' : '-'}{fmtUsd(Math.abs(realized))}</span> <span className="text-[10px] font-normal text-dim">· {mine.length} TXs</span></Mini>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {accounts.map((a) => {
                const on = g.walletIds.includes(a.id)
                return (
                  <button key={a.id} onClick={() => update(g.id, { walletIds: on ? g.walletIds.filter((x) => x !== a.id) : [...g.walletIds, a.id] })} aria-pressed={on} title={on ? 'Remove from group' : 'Add to group'} className={clsx('flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px]', on ? 'border-line2 bg-raise font-semibold text-ink' : 'border-dashed border-line2 text-dim hover:text-muted')}>
                    {a.emoji} {a.name}
                    {on && <span className="num text-[10px] text-muted">{fmtUsd(valueOf(a), 0)}</span>}
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Mini({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-md border border-line bg-bg px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wider text-dim">{label}</div>
      <div className="num text-[13px] font-bold">{children}</div>
    </div>
  )
}

// ─── Table tools: search, chain chips, toggles, sortable headers ──────────────
type SortDir = 1 | -1
function useSort<K extends string>(initial: K) {
  const [key, setKey] = useState<K>(initial)
  const [dir, setDir] = useState<SortDir>(-1)
  const toggle = (k: K) => {
    if (k === key) setDir((d) => (d === 1 ? -1 : 1))
    else {
      setKey(k)
      setDir(-1)
    }
  }
  return { key, dir, toggle, by: <T,>(list: T[], val: (x: T, k: K) => number) => [...list].sort((a, b) => (val(a, key) - val(b, key)) * dir) }
}

function SortTh<K extends string>({ label, k, sort, left }: { label: string; k: K; sort: { key: K; dir: SortDir; toggle: (k: K) => void }; left?: boolean }) {
  const on = sort.key === k
  return (
    <th className={clsx(th, left ? 'text-left' : 'text-right')} aria-sort={on ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button onClick={() => sort.toggle(k)} className={clsx('inline-flex items-center gap-0.5 uppercase tracking-wider hover:text-ink', on && 'text-ink')}>
        {label}
        <span className={clsx('text-[9px]', !on && 'opacity-30')}>{on && sort.dir === 1 ? '▲' : '▼'}</span>
      </button>
    </th>
  )
}

function useTableFilter() {
  const [q, setQ] = useState('')
  const [chains, setChains] = useState<Chain[]>([])
  const needle = q.trim().toLowerCase().replace('$', '')
  const pass = (ticker: string, chain: Chain) => (!needle || ticker.toLowerCase().includes(needle)) && (!chains.length || chains.includes(chain))
  return { q, setQ, chains, setChains, pass }
}

function TableTools({ f, id, children }: { f: ReturnType<typeof useTableFilter>; id: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-3 py-2">
      <div className="relative w-40">
        <Search size={11} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-dim" />
        <input id={id} value={f.q} onChange={(e) => f.setQ(e.target.value)} placeholder="Search token" aria-label="Search token" className="h-7 w-full rounded-md border border-line2 bg-bg pl-6 pr-2 text-[11px] outline-none placeholder:text-dim focus:border-accent/60" />
      </div>
      {CHAIN_IDS.map((c) => {
        const on = f.chains.includes(c)
        return (
          <button key={c} onClick={() => f.setChains(on ? f.chains.filter((x) => x !== c) : [...f.chains, c])} aria-pressed={on} className={clsx('rounded-md border px-2 py-0.5 text-[11px] font-semibold', on ? 'border-accent/60 bg-accent/10 text-accent' : 'border-line2 text-muted hover:text-ink')}>
            {CHAINS[c].short}
          </button>
        )
      })}
      {children}
    </div>
  )
}

function Check({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="ml-1 flex cursor-pointer items-center gap-1 text-[11px] text-muted">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} className="accent-[var(--accent)]" /> {label}
    </label>
  )
}

type HoldKey = 'value' | 'share' | 'unrealized' | 'realized' | 'total' | 'held'

function Holding({ rows, equity, m, positions, scope }: { rows: TokenPnl[]; equity: number; m: Money; positions: Record<string, { qty: number; avgEntry: number; openedAt: number }>; scope: string | string[] }) {
  const tick = useGame((s) => s.market.tick)
  const sell = useGame((s) => s.sell)
  const f = useTableFilter()
  const sort = useSort<HoldKey>('value')
  const [hideSmall, setHideSmall] = useState(() => load<boolean>('pfHideSmall') ?? false)
  const [hideDead, setHideDead] = useState(false)
  if (!rows.length) return <EmptyState icon="🎒" title="No open positions" hint="Buy something from Discover or Trenches" />
  const held = (r: TokenPnl) => tick - (positions[r.tokenId]?.openedAt ?? r.firstTick)
  const list = rows.filter((r) => f.pass(r.ticker, r.chain) && (!hideSmall || r.value >= 1) && (!hideDead || (r.t && r.t.status !== 'rugged' && r.t.status !== 'dead')))
  const sorted = sort.by(list, (r, k) => (k === 'value' || k === 'share' ? r.value : k === 'unrealized' ? r.unrealized : k === 'realized' ? r.realized : k === 'total' ? r.total : held(r)))
  return (
    <div>
      <TableTools f={f} id="pf-hold-search">
        <Check on={hideSmall} onChange={(v) => { setHideSmall(v); save('pfHideSmall', v) }} label="Hide small (<$1)" />
        <Check on={hideDead} onChange={setHideDead} label="Hide rugged" />
        <span className="ml-auto num text-[11px] text-dim">{sorted.length} of {rows.length}</span>
      </TableTools>
      {sorted.length === 0 ? <EmptyState icon="🔎" title="No holdings match these filters" /> : (
    <div className="overflow-x-auto">
    <table className="w-full min-w-[1080px] text-[12px]">
      <thead className="sticky top-0 z-[1] bg-panel">
        <tr className="border-b border-line">
          <th className={clsx(th, 'text-left')}>Token</th>
          <SortTh label="Value / Amount" k="value" sort={sort} />
          <SortTh label="% of portfolio" k="share" sort={sort} />
          <th className={clsx(th, 'text-right')}>Avg cost → now</th>
          <SortTh label="Unrealized" k="unrealized" sort={sort} />
          <SortTh label="Realized" k="realized" sort={sort} />
          <SortTh label="Total profit" k="total" sort={sort} />
          <SortTh label="Holding" k="held" sort={sort} />
          <th className={clsx(th, 'text-right')}>Sell</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((r) => {
          const pos = positions[r.tokenId]
          const share = equity > 0 ? r.value / equity : 0
          return (
            <tr key={r.tokenId} className="hover:bg-panel2">
              <td className={td}><TokenCell r={r} /></td>
              <td className={clsx(td, 'text-right num')}><div className="font-semibold">{m(r.value, r.chain)}</div><div className="text-[10px] text-dim">{fmtNum(r.qty)} · {((r.qty / SUPPLY) * 100).toFixed(2)}% supply</div></td>
              <td className={clsx(td, 'text-right')}>
                <div className="num">{(share * 100).toFixed(1)}%</div>
                <div className="ml-auto mt-0.5 h-1 w-16 overflow-hidden rounded-full bg-line2"><div className="h-full bg-info" style={{ width: `${Math.min(100, share * 100)}%` }} /></div>
              </td>
              <td className={clsx(td, 'text-right num')}><span className="text-muted">{fmtPrice(pos?.avgEntry ?? 0)}</span><span className="text-dim"> → </span><span>{fmtPrice(r.t?.price ?? 0)}</span></td>
              <td className={clsx(td, 'text-right num', toneClass(r.unrealized))}><div>{m(r.unrealized, r.chain, true)}</div><div className="text-[10px]">{fmtPct(r.cost > 0 ? r.unrealized / r.cost : 0)}</div></td>
              <td className={clsx(td, 'text-right num', toneClass(r.realized))}>{r.sells ? m(r.realized, r.chain, true, r.realizedN) : '--'}</td>
              <td className={clsx(td, 'text-right num font-bold', toneClass(r.total))}><div>{m(r.total, r.chain, true, r.totalN)}</div><div className="text-[10px] font-normal">{fmtPct(r.totalPct)}</div></td>
              <td className={clsx(td, 'text-right num text-muted')}>{fmtAge((tick - (pos?.openedAt ?? r.firstTick)) * SIM_SEC_PER_TICK)}</td>
              <td className={clsx(td, 'text-right')}>
                <div className="flex justify-end gap-1">
                  <button onClick={() => pos && sell(pos.qty / 2, r.tokenId, undefined, scope)} className="rounded border border-line2 px-1.5 py-0.5 text-[10px] font-semibold text-muted hover:border-down/50 hover:text-down">50%</button>
                  <button onClick={() => pos && sell(pos.qty, r.tokenId, undefined, scope)} className="rounded border border-down/40 bg-down/10 px-1.5 py-0.5 text-[10px] font-bold text-down hover:bg-down hover:text-white">All</button>
                </div>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
    </div>
      )}
    </div>
  )
}

type PnlKey = 'last' | 'unrealized' | 'realized' | 'total' | 'pct' | 'bought' | 'txs' | 'held'

function RecentPnl({ rows, m }: { rows: TokenPnl[]; m: Money }) {
  const tick = useGame((s) => s.market.tick)
  const f = useTableFilter()
  const sort = useSort<PnlKey>('last')
  const [status, setStatus] = useState<'all' | 'open' | 'closed'>('all')
  if (!rows.length) return <EmptyState icon="📊" title="No trades in this period" />
  const held = (r: TokenPnl) => (r.qty > 0 ? tick : r.lastTick) - r.firstTick
  const list = rows.filter((r) => f.pass(r.ticker, r.chain) && (status === 'all' || (status === 'open' ? r.qty > 0 : r.qty <= 0)))
  const sorted = sort.by(list, (r, k) =>
    k === 'last' ? r.lastTick : k === 'unrealized' ? r.unrealized : k === 'realized' ? r.realized : k === 'total' ? r.total : k === 'pct' ? r.totalPct : k === 'bought' ? r.bought : k === 'txs' ? r.buys + r.sells : held(r),
  )
  return (
    <div>
      <TableTools f={f} id="pf-pnl-search">
        <Segmented value={status} onChange={setStatus} className="ml-1" options={[{ value: 'all', label: 'All' }, { value: 'open', label: 'Holding' }, { value: 'closed', label: 'Sold all' }]} />
        <span className="ml-auto num text-[11px] text-dim">{sorted.length} of {rows.length}</span>
      </TableTools>
      {sorted.length === 0 ? <EmptyState icon="🔎" title="No tokens match these filters" /> : (
      <div className="overflow-x-auto">
      <table className="w-full min-w-[1100px] text-[12px]">
        <thead className="sticky top-0 z-[1] bg-panel">
          <tr className="border-b border-line">
            <th className={clsx(th, 'text-left')}>Token</th>
            <SortTh label="Last active" k="last" sort={sort} />
            <SortTh label="Unrealized" k="unrealized" sort={sort} />
            <SortTh label="Realized" k="realized" sort={sort} />
            <SortTh label="Total profit" k="total" sort={sort} />
            <th className={clsx(th, 'text-right')}>Balance</th>
            <SortTh label="Bought / Avg" k="bought" sort={sort} />
            <th className={clsx(th, 'text-right')}>Sold / Avg</th>
            <SortTh label="TXs" k="txs" sort={sort} />
            <SortTh label="Held for" k="held" sort={sort} />
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.tokenId} className="hover:bg-panel2">
              <td className={td}><TokenCell r={r} /></td>
              <td className={clsx(td, 'text-right num text-muted')}>{fmtAge((tick - r.lastTick) * SIM_SEC_PER_TICK)}</td>
              <td className={clsx(td, 'text-right num', toneClass(r.unrealized))}>{r.qty > 0 ? m(r.unrealized, r.chain, true) : '--'}</td>
              <td className={clsx(td, 'text-right num', toneClass(r.realized))}>{r.sells ? m(r.realized, r.chain, true, r.realizedN) : '--'}</td>
              <td className={clsx(td, 'text-right num font-bold', toneClass(r.total))}><div>{m(r.total, r.chain, true, r.totalN)}</div><div className="text-[10px] font-normal">{fmtPct(r.totalPct)}</div></td>
              <td className={clsx(td, 'text-right num')}>{r.qty > 0 ? m(r.value, r.chain) : <span className="text-dim">Sold all</span>}</td>
              <td className={clsx(td, 'text-right num')}><div className="text-up">{m(r.bought, r.chain, false, r.boughtN)}</div><div className="text-[10px] text-dim">{fmtPrice(r.boughtQty ? r.bought / r.boughtQty : 0)}</div></td>
              <td className={clsx(td, 'text-right num')}>{r.sells ? <><div className="text-down">{m(r.sold, r.chain, false, r.soldN)}</div><div className="text-[10px] text-dim">{fmtPrice(r.soldQty ? r.soldGross / r.soldQty : 0)}</div></> : '--'}</td>
              <td className={clsx(td, 'text-right num')}><span className="text-up">{r.buys}</span>/<span className="text-down">{r.sells}</span></td>
              <td className={clsx(td, 'text-right num text-muted')}>{fmtAge(held(r) * SIM_SEC_PER_TICK)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      )}
    </div>
  )
}

// ─── Activity: every fill in this wallet / period ─────────────────────────────
function Activity({ trades, m, showWallet }: { trades: Trade[]; m: Money; showWallet: boolean }) {
  const tick = useGame((s) => s.market.tick)
  const select = useGame((s) => s.select)
  const accounts = useGame((s) => s.portfolio.accounts)
  const map = useTokenMap()
  const f = useTableFilter()
  const [side, setSide] = useState<'all' | 'buy' | 'sell'>('all')
  const list = trades.filter((t) => (side === 'all' || t.side === side) && f.pass(t.ticker, map.get(t.tokenId)?.chain ?? t.chain ?? 'sol')).slice(0, 300)
  const walletName = (id?: string) => {
    const a = accounts?.find((x) => x.id === id) ?? accounts?.[0]
    return a ? `${a.emoji} ${a.name}` : ''
  }
  return (
    <div>
      <TableTools f={f} id="pf-act-search">
        <Segmented value={side} onChange={setSide} className="ml-1" options={[{ value: 'all', label: 'All' }, { value: 'buy', label: 'Buys' }, { value: 'sell', label: 'Sells' }]} />
        <span className="ml-auto num text-[11px] text-dim">{list.length} fills</span>
      </TableTools>
      {list.length === 0 ? <EmptyState icon="🧾" title="No trades match" /> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-[12px]">
            <thead className="sticky top-0 z-[1] bg-panel">
              <tr className="border-b border-line">
                <th className={clsx(th, 'text-left')}>Age</th>
                <th className={clsx(th, 'text-left')}>Type</th>
                <th className={clsx(th, 'text-left')}>Token</th>
                <th className={clsx(th, 'text-right')}>Total</th>
                <th className={clsx(th, 'text-right')}>Amount</th>
                <th className={clsx(th, 'text-right')}>Price</th>
                <th className={clsx(th, 'text-right')}>MC</th>
                <th className={clsx(th, 'text-right')}>Profit</th>
                {showWallet && <th className={clsx(th, 'text-left')}>Wallet</th>}
              </tr>
            </thead>
            <tbody>
              {list.map((t) => {
                const tok = map.get(t.tokenId)
                const chain = tok?.chain ?? t.chain ?? 'sol'
                const buy = t.side === 'buy'
                return (
                  <tr key={t.id} className="hover:bg-panel2">
                    <td className={clsx(td, 'num text-dim')}>{fmtAge((tick - t.tick) * SIM_SEC_PER_TICK)}</td>
                    <td className={clsx(td, 'font-semibold', buy ? 'text-up' : 'text-down')}>
                      {buy ? 'Buy' : 'Sell'}
                      {t.via && <span className="ml-1 rounded bg-info/10 px-1 text-[9px] text-info" title={`Copied from ${t.via}`}>⚡</span>}
                      {t.status === 'RUGGED' && <span className="ml-1 text-[9px] font-bold text-down">RUG</span>}
                    </td>
                    <td className={td}>
                      <button disabled={!tok} onClick={() => tok && select(tok.id)} className="flex items-center gap-1.5 hover:text-accent">
                        <TokenIcon token={tok ?? { emoji: t.emoji, hue: t.hue, status: 'dead' }} size={20} />
                        <span className="font-bold">{t.ticker}</span>
                        <ChainBadge chain={chain} />
                      </button>
                    </td>
                    <td className={clsx(td, 'text-right num', buy ? 'text-up' : 'text-down')}>{m(t.value, chain, false, t.native)}</td>
                    <td className={clsx(td, 'text-right num text-muted')}>{fmtNum(t.qty)}</td>
                    <td className={clsx(td, 'text-right num')}>{fmtPrice(t.price)}</td>
                    <td className={clsx(td, 'text-right num text-muted')}>{fmtCompact(t.price * SUPPLY)}</td>
                    <td className={clsx(td, 'text-right num', t.pnl !== undefined ? toneClass(t.pnl) : 'text-dim')}>
                      {t.pnl !== undefined ? <>{m(t.pnl, chain, true, tradePx(t) ? t.pnl / tradePx(t)! : undefined)}{t.pnlPct !== undefined && <span className="ml-1 text-[10px]">{fmtPct(t.pnlPct)}</span>}</> : '--'}
                    </td>
                    {showWallet && <td className={clsx(td, 'text-muted')}>{walletName(t.walletId)}</td>}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Deployed() {
  const launches = useGame((s) => s.launches)
  const now = useGame((s) => s.market.time)
  const setView = useGame((s) => s.setView)
  const select = useGame((s) => s.select)
  const map = useTokenMap()
  if (!launches.length) return <EmptyState icon="🍳" title="You haven't deployed any tokens this round" hint={<button onClick={() => setView('cooking')} className="text-accent underline">Cook one →</button>} />
  return (
    <table className="w-full min-w-[720px] text-[12px]">
      <thead className="sticky top-0 z-[1] bg-panel">
        <tr className="border-b border-line">
          <th className={clsx(th, 'text-left')}>Token</th>
          <th className={clsx(th, 'text-right')}>Age</th>
          <th className={clsx(th, 'text-right')}>MC now</th>
          <th className={clsx(th, 'text-right')}>ATH MC</th>
          <th className={clsx(th, 'text-left')}>Status</th>
          <th className={clsx(th, 'text-right')}>Creator earnings</th>
        </tr>
      </thead>
      <tbody>
        {launches.map((l) => {
          const t = map.get(l.tokenId)
          return (
            <tr key={l.tokenId} className="hover:bg-panel2">
              <td className={td}>
                <button disabled={!t} onClick={() => t && select(t.id)} className="flex items-center gap-2 hover:text-accent">
                  <TokenIcon token={t ?? { emoji: l.emoji, hue: l.hue, image: l.image, status: 'dead' }} size={24} /><span className="font-bold">{l.ticker}</span><span className="text-[11px] text-dim">{l.name}</span>
                </button>
              </td>
              <td className={clsx(td, 'text-right num text-muted')}>{fmtAge(now - l.launchedTime)}</td>
              <td className={clsx(td, 'text-right num')}>{fmtCompact(t?.mcap ?? l.lastMcap)}</td>
              <td className={clsx(td, 'text-right num text-warn')}>{fmtCompact(Math.max(l.peakMcap, t?.ath ?? 0))}</td>
              <td className={td}>{l.graduated ? <span className="font-bold text-up">🎓 Graduated</span> : (t?.status ?? l.status) === 'bonding' ? <span className="text-warn">Curve {t?.bondingProgress.toFixed(0)}%</span> : <span className="text-muted">Dead</span>}</td>
              <td className={clsx(td, 'text-right num text-up')}>{fmtUsd(l.fees)}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

const TIP = { background: '#171b22', border: '1px solid #262c36', borderRadius: 6, fontSize: 11, fontFamily: 'JetBrains Mono' }

/** GMGN-style PnL card: realized headline, then a balance line or realized-PnL bars over the period. */
function PnlCard({ className, label, headline, trades, fromTick }: { className?: string; label: string; headline: ReactNode; trades: Trade[]; fromTick: number }) {
  const [view, setViewState] = useState<'balance' | 'bars'>(() => load<'balance' | 'bars'>('pfChart') ?? 'bars')
  const setView = (v: 'balance' | 'bars') => {
    setViewState(v)
    save('pfChart', v)
  }
  return (
    <div className={clsx('flex flex-col rounded-md border border-line bg-panel', className)}>
      <div className="flex flex-wrap items-start justify-between gap-2 px-3 pt-3">
        <div>
          <div className="text-[10px] text-dim">{label}</div>
          {headline}
        </div>
        <Segmented value={view} onChange={setView} options={[{ value: 'bars', label: 'PnL' }, { value: 'balance', label: 'Balance' }]} />
      </div>
      <div className="h-[230px] p-2">{view === 'bars' ? <PnlBars trades={trades} fromTick={fromTick} /> : <EquityChart />}</div>
    </div>
  )
}

/** Realized PnL per time bucket (about 24 bars across the period). */
function PnlBars({ trades, fromTick }: { trades: Trade[]; fromTick: number }) {
  const tick = useGame((s) => s.market.tick)
  const now = useGame((s) => s.market.time)
  const data = useMemo(() => {
    const sells = trades.filter((t) => t.side === 'sell' && t.pnl !== undefined && t.tick >= fromTick)
    if (!sells.length) return []
    const start = Number.isFinite(fromTick) ? fromTick : Math.min(...trades.map((t) => t.tick))
    const span = Math.max(1, tick - start)
    const step = Math.max(Math.ceil(span / 24 / (60 / SIM_SEC_PER_TICK)) * (60 / SIM_SEC_PER_TICK), 60 / SIM_SEC_PER_TICK) // whole minutes
    const n = Math.ceil(span / step) || 1
    const bars = Array.from({ length: n }, (_, i) => ({ t: now - (tick - (start + i * step)) * SIM_SEC_PER_TICK, pnl: 0 }))
    for (const s of sells) bars[Math.min(n - 1, Math.floor((s.tick - start) / step))].pnl += s.pnl!
    return bars
  }, [trades, fromTick, tick, now])
  if (!data.length) return <EmptyState icon="📊" title="Realized PnL bars appear after your first sell" />
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
        <XAxis dataKey="t" tickFormatter={(t: number) => fmtTime(t).slice(0, 5)} stroke="#5b6370" fontSize={10} tickLine={false} axisLine={false} minTickGap={30} />
        <YAxis tickFormatter={(v: number) => fmtCompact(v)} stroke="#5b6370" fontSize={10} tickLine={false} axisLine={false} width={52} />
        <ReferenceLine y={0} stroke="#3a414d" />
        <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} contentStyle={TIP} labelStyle={{ color: '#8b93a1' }} labelFormatter={(t) => `From ${fmtTime(Number(t))}`} formatter={(val) => [`${Number(val) >= 0 ? '+' : '-'}${fmtUsd(Math.abs(Number(val)))}`, 'Realized']} />
        <Bar dataKey="pnl" radius={[2, 2, 0, 0]} isAnimationActive={false}>
          {data.map((d, i) => <Cell key={i} fill={d.pnl >= 0 ? '#19d989' : '#ff4d6a'} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

function EquityChart() {
  const history = useGame((s) => s.portfolio.equityHistory)
  const start = useGame((s) => s.portfolio.startBalance)
  const data = useMemo(() => history.map((h) => ({ t: h.time, equity: h.equity })), [history])
  const last = data[data.length - 1]?.equity ?? start
  const color = last >= start ? '#19d989' : '#ff4d6a'
  return (
    <>
        {data.length < 2 ? <EmptyState icon="📈" title="Performance appears once the round is running" /> : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="eqFill2" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
              <XAxis dataKey="t" tickFormatter={(t: number) => fmtTime(t).slice(0, 5)} stroke="#5b6370" fontSize={10} tickLine={false} axisLine={false} minTickGap={40} />
              <YAxis domain={['auto', 'auto']} tickFormatter={(v: number) => fmtCompact(v)} stroke="#5b6370" fontSize={10} tickLine={false} axisLine={false} width={56} />
              <ReferenceLine y={start} stroke="#5b6370" strokeDasharray="4 4" />
              <Tooltip
                cursor={{ stroke: '#3a414d' }}
                contentStyle={{ background: '#171b22', border: '1px solid #262c36', borderRadius: 6, fontSize: 11, fontFamily: 'JetBrains Mono' }}
                labelStyle={{ color: '#8b93a1' }}
                labelFormatter={(t) => fmtTime(Number(t))}
                formatter={(val) => [`${fmtUsd(Number(val))} (${fmtPct(Number(val) / start - 1, 2)})`, 'Equity']}
              />
              <Area type="monotone" dataKey="equity" stroke={color} strokeWidth={2} fill="url(#eqFill2)" isAnimationActive={false} dot={false} activeDot={{ r: 4, stroke: '#0c0e11', strokeWidth: 2 }} />
            </AreaChart>
          </ResponsiveContainer>
        )}
    </>
  )
}

function ShareCard({ onClose, realized, total, totalPct, winRate, traded, best, period }: { onClose: () => void; realized: number; total: number; totalPct: number; winRate: number; traded: number; best?: TokenPnl; period: Period }) {
  const notify = useGame((s) => s.notify)
  const up = total >= 0
  const text = `MOONRUSH (simulated) · ${period === 'ALL' ? 'this round' : period}: ${up ? '+' : '-'}${fmtUsd(Math.abs(total))} (${fmtPct(totalPct)}) · realized ${realized >= 0 ? '+' : '-'}${fmtUsd(Math.abs(realized))} · win rate ${(winRate * 100).toFixed(0)}%${best && best.total > 0 ? ` · best $${best.ticker} ${fmtPct(best.totalPct)}` : ''}`
  return (
    <Modal title="Share PnL" onClose={onClose}>
      <div className={clsx('relative overflow-hidden rounded-xl border p-5', up ? 'border-up/40 bg-[radial-gradient(circle_at_20%_0%,rgba(25,217,137,0.25),transparent_60%),#0c0e11]' : 'border-down/40 bg-[radial-gradient(circle_at_20%_0%,rgba(255,77,106,0.25),transparent_60%),#0c0e11]')}>
        <div className="font-display text-[13px] font-bold tracking-[0.2em]">MOON<span className="text-accent">RUSH</span></div>
        <div className="mt-4 text-[11px] text-muted">{period === 'ALL' ? 'This round' : period} PnL</div>
        <div className={clsx('num text-[40px] font-bold leading-none', up ? 'text-up' : 'text-down')}>{fmtPct(totalPct)}</div>
        <div className={clsx('num mt-1 text-[16px] font-semibold', up ? 'text-up' : 'text-down')}>{up ? '+' : '-'}{fmtUsd(Math.abs(total))}</div>
        <div className="mt-4 grid grid-cols-3 gap-2 text-[11px]">
          <div><div className="text-dim">Realized</div><div className={clsx('num', toneClass(realized))}>{fmtCompact(realized)}</div></div>
          <div><div className="text-dim">Win rate</div><div className="num">{(winRate * 100).toFixed(0)}%</div></div>
          <div><div className="text-dim">Tokens</div><div className="num">{traded}</div></div>
        </div>
        {best && best.total > 0 && <div className="mt-3 text-[11px] text-muted">Best: <span className="font-bold text-ink">${best.ticker}</span> <span className="text-up">{fmtPct(best.totalPct)}</span></div>}
        <div className="absolute right-4 top-4 text-[40px] opacity-80">{up ? '🚀' : '💀'}</div>
        <div className="mt-4 text-[9px] text-dim">Simulated trading game · virtual money · fictional tokens</div>
      </div>
      <div className="mt-3 flex gap-2">
        <button onClick={() => { navigator.clipboard?.writeText(text).catch(() => {}); notify({ title: 'COPIED', body: 'PnL summary copied to clipboard', tone: 'info', icon: '📋' }) }} className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md bg-accent text-[12px] font-bold text-accent-ink"><Copy size={13} /> Copy summary</button>
        <button onClick={onClose} className="flex h-9 items-center gap-1 rounded-md border border-line2 px-3 text-[12px] text-muted hover:text-ink"><X size={13} /> Close</button>
      </div>
    </Modal>
  )
}
