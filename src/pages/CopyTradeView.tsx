import clsx from 'clsx'
import { Bell, BellOff, ChevronDown, ChevronUp, Crown, Pause, Play, Search, Settings2, Square, X, Zap } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { EmptyState, Modal, Segmented, TokenIcon, Toggle } from '../components/ui'
import { STYLE_META } from '../data/wallets'
import { useTokenMap } from '../hooks/useDerived'
import { SIM_SEC_PER_TICK } from '../game/marketEngine'
import { useGame } from '../game/store'
import { walletStats, type Period, type WalletStats } from '../game/walletEngine'
import { MIND_META, mindOf } from '../game/traderMinds'
import type { CopyConfig, SimWallet, WalletStyle } from '../types'
import { fmtAge, fmtCompact, fmtNum, fmtPct, fmtUsd, toneClass } from '../utils/format'

type Tab = 'rank' | 'mine' | 'activity'
type SortKey = 'pnl' | 'pnlPct' | 'winRate' | 'txs' | 'volume' | 'inflow' | 'balance' | 'active'
const CATS: { id: 'all' | WalletStyle; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'smart', label: 'Smart Money' },
  { id: 'kol', label: 'KOL' },
  { id: 'sniper', label: 'Sniper' },
  { id: 'whale', label: 'Whale' },
  { id: 'degen', label: 'Degen' },
  { id: 'fresh', label: 'Fresh Wallet' },
]

export function CopyTradeView() {
  const [tab, setTab] = useState<Tab>('rank')
  const [period, setPeriod] = useState<Period>('24H')
  const copies = useGame((s) => s.copies)
  const drawer = useGame((s) => s.walletDrawer)
  const openWallet = useGame((s) => s.openWallet)
  const [copyFor, setCopyFor] = useState<string | null>(null)

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-1 border-b border-line bg-panel px-3 py-2">
        {([['rank', 'Rank'], ['mine', `My Copies${copies.length ? ` ${copies.length}` : ''}`], ['activity', 'Activity']] as [Tab, string][]).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} className={clsx('font-display text-[16px] font-bold transition-colors', tab === id ? 'text-ink' : 'text-dim hover:text-muted')}>
            {label}
          </button>
        ))}
        <span className="hidden text-[11px] text-dim md:inline">Mirror simulated trader wallets automatically. Your copies fill after theirs, at their price impact.</span>
        <div className="ml-auto">
          <Segmented value={period} onChange={setPeriod} options={(['1H', '24H', '7D'] as Period[]).map((p) => ({ value: p, label: p }))} />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {tab === 'rank' && <RankTable period={period} onCopy={setCopyFor} />}
        {tab === 'mine' && <MyCopies onEdit={setCopyFor} />}
        {tab === 'activity' && <Activity />}
      </div>
      {drawer && <WalletDrawer walletId={drawer} period={period} onClose={() => openWallet(null)} onCopy={setCopyFor} />}
      {copyFor && <CopyModal walletId={copyFor} onClose={() => setCopyFor(null)} />}
    </div>
  )
}

function useStats(period: Period) {
  const wallets = useGame((s) => s.wallets)
  const tick = useGame((s) => s.market.tick)
  const map = useTokenMap()
  return useMemo(() => new Map(wallets.map((w) => [w.id, walletStats(w, period, map, tick)])), [wallets, period, map, tick])
}

function StyleBadge({ style }: { style: WalletStyle }) {
  const m = STYLE_META[style]
  return <span className={clsx('whitespace-nowrap rounded border px-1 text-[9px] font-semibold leading-[14px]', m.cls)} title={m.blurb}>{m.icon} {m.label}</span>
}

function RankTable({ period, onCopy }: { period: Period; onCopy: (id: string) => void }) {
  const wallets = useGame((s) => s.wallets)
  const tick = useGame((s) => s.market.tick)
  const copies = useGame((s) => s.copies)
  const tracked = useGame((s) => s.trackedWallets)
  const toggleTrack = useGame((s) => s.toggleTrackWallet)
  const openWallet = useGame((s) => s.openWallet)
  const stats = useStats(period)
  const [cat, setCat] = useState<'all' | WalletStyle>('all')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'pnl', dir: -1 })

  const val = (w: SimWallet, st: WalletStats): number => {
    switch (sort.key) {
      case 'pnl': return st.pnl
      case 'pnlPct': return st.pnlPct
      case 'winRate': return st.winRate
      case 'txs': return st.buys + st.sells
      case 'volume': return st.volume
      case 'inflow': return st.inflow
      case 'balance': return st.balance
      case 'active': return w.lastActive
    }
  }
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return wallets
      .filter((w) => (cat === 'all' || w.style === cat) && (!needle || w.name.toLowerCase().includes(needle)))
      .map((w) => ({ w, st: stats.get(w.id)! }))
      .sort((a, b) => (val(a.w, a.st) - val(b.w, b.st)) * sort.dir)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallets, stats, cat, q, sort])

  const onSort = (k: SortKey) => setSort((s) => ({ key: k, dir: s.key === k ? (-s.dir as 1 | -1) : -1 }))
  const medal = ['bg-[linear-gradient(90deg,rgba(255,201,61,0.14),transparent_60%)] shadow-[inset_3px_0_0_#ffc93d]', 'bg-[linear-gradient(90deg,rgba(180,190,210,0.12),transparent_60%)] shadow-[inset_3px_0_0_#b4bed2]', 'bg-[linear-gradient(90deg,rgba(205,127,50,0.14),transparent_60%)] shadow-[inset_3px_0_0_#cd7f32]']
  const crown = ['text-[#ffc93d]', 'text-[#b4bed2]', 'text-[#cd7f32]']

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-3 py-2">
        {CATS.map((c) => (
          <button key={c.id} onClick={() => setCat(c.id)} className={clsx('rounded-md px-2 py-1 text-[11px] font-semibold transition-colors', cat === c.id ? 'bg-raise text-ink' : 'text-dim hover:text-muted')}>
            {c.label}
          </button>
        ))}
        <div className="relative ml-auto w-full sm:w-56">
          <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-dim" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search wallet name" className="h-7 w-full rounded-md border border-line2 bg-bg pl-7 pr-2 text-[12px] outline-none placeholder:text-dim focus:border-accent/60" aria-label="Search wallets" />
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-[12px]">
          <thead className="sticky top-0 z-[1] bg-panel">
            <tr className="border-b border-line">
              <th className="w-10 px-3 py-2 text-left text-[10px] font-semibold text-dim">#</th>
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-dim">Wallet / Balance</th>
              <Th k="pnl" sort={sort} onSort={onSort}>{period} PnL</Th>
              <Th k="winRate" sort={sort} onSort={onSort}>{period} Win rate</Th>
              <Th k="txs" sort={sort} onSort={onSort}>{period} TXs</Th>
              <Th k="volume" sort={sort} onSort={onSort}>{period} Volume</Th>
              <Th k="inflow" sort={sort} onSort={onSort}>{period} Net inflow</Th>
              <Th k="active" sort={sort} onSort={onSort}>Last active</Th>
              <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-dim">Copy</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ w, st }, i) => {
              const copying = copies.some((c) => c.walletId === w.id)
              const isTracked = tracked.includes(w.id)
              return (
                <tr key={w.id} onClick={() => openWallet(w.id)} className={clsx('cursor-pointer border-b border-line/50 transition-colors hover:bg-panel2', sort.key === 'pnl' && sort.dir === -1 && cat === 'all' && !q && i < 3 && medal[i])}>
                  <td className="px-3 py-2.5 num text-muted">{sort.key === 'pnl' && sort.dir === -1 && cat === 'all' && !q && i < 3 ? <Crown size={15} className={crown[i]} fill="currentColor" /> : i + 1}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <div className="grid size-9 place-items-center rounded-full bg-raise text-[18px] ring-1 ring-line2">{w.avatar}</div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-ink">{w.name}</span>
                          <StyleBadge style={w.style} />
                          {copying && <span className="rounded bg-up/15 px-1 text-[9px] font-bold text-up">COPYING</span>}
                        </div>
                        <div className="num text-[10px] text-dim">{fmtUsd(st.balance, 0)} · {st.holdings} open</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right num">
                    <div className={clsx('whitespace-nowrap font-semibold', toneClass(st.pnl))}>{fmtPct(st.pnlPct)} / {st.pnl >= 0 ? '+' : '-'}{fmtCompact(Math.abs(st.pnl))}</div>
                  </td>
                  <td className="px-3 py-2.5 text-right num">{st.buys + st.sells ? `${(st.winRate * 100).toFixed(1)}%` : '—'}</td>
                  <td className="px-3 py-2.5 text-right num"><span className="text-up">{fmtNum(st.buys)}</span><span className="text-dim"> / </span><span className="text-down">{fmtNum(st.sells)}</span></td>
                  <td className="px-3 py-2.5 text-right num text-info">{fmtCompact(st.volume)}</td>
                  <td className={clsx('px-3 py-2.5 text-right num', toneClass(st.inflow))}>{st.inflow >= 0 ? '' : '-'}{fmtCompact(Math.abs(st.inflow))}</td>
                  <td className="px-3 py-2.5 text-right num text-muted">{fmtAge(Math.max(0, tick - w.lastActive) * SIM_SEC_PER_TICK)}</td>
                  <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-1">
                      <button onClick={() => toggleTrack(w.id)} title={isTracked ? 'Stop tracking' : 'Track: toast when they trade'} className={clsx('rounded-md border p-1', isTracked ? 'border-accent/50 text-accent' : 'border-line2 text-dim hover:text-ink')} aria-label="Track wallet">
                        {isTracked ? <Bell size={13} /> : <BellOff size={13} />}
                      </button>
                      <button onClick={() => onCopy(w.id)} className={clsx('flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-bold transition-all', copying ? 'border border-up/50 text-up hover:bg-up/10' : 'bg-up text-black hover:brightness-110')}>
                        <Zap size={11} fill="currentColor" /> {copying ? 'Edit' : 'Copy'}
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="px-3 py-2 text-[10px] text-dim">All wallets are simulated traders in this game. 24H/7D include their pre-session history; 1H is live. Past PnL does not guarantee they'll keep winning, even here.</p>
    </div>
  )
}

function Th({ k, sort, onSort, children }: { k: SortKey; sort: { key: SortKey; dir: 1 | -1 }; onSort: (k: SortKey) => void; children: ReactNode }) {
  return (
    <th onClick={() => onSort(k)} className={clsx('cursor-pointer select-none whitespace-nowrap px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wider hover:text-ink', sort.key === k ? 'text-accent' : 'text-dim')}>
      <span className="inline-flex items-center gap-0.5">{children}{sort.key === k && (sort.dir === -1 ? <ChevronDown size={11} /> : <ChevronUp size={11} />)}</span>
    </th>
  )
}

function WalletDrawer({ walletId, period, onClose, onCopy }: { walletId: string; period: Period; onClose: () => void; onCopy: (id: string) => void }) {
  const w = useGame((s) => s.wallets.find((x) => x.id === walletId))
  const tick = useGame((s) => s.market.tick)
  const now = useGame((s) => s.market.time)
  const copying = useGame((s) => s.copies.some((c) => c.walletId === walletId))
  const tracked = useGame((s) => s.trackedWallets.includes(walletId))
  const toggleTrack = useGame((s) => s.toggleTrackWallet)
  const select = useGame((s) => s.select)
  const map = useTokenMap()
  if (!w) return null
  const st = walletStats(w, period, map, tick)
  const meta = STYLE_META[w.style]
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/50 fade-in" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="sheet-up flex h-full w-full max-w-[460px] flex-col border-l border-line2 bg-panel shadow-2xl md:animate-none">
        <div className="flex items-center gap-3 border-b border-line p-3">
          <div className="grid size-12 place-items-center rounded-full bg-raise text-[24px] ring-1 ring-line2">{w.avatar}</div>
          <div className="min-w-0 flex-1">
            <div className="font-display text-[17px] font-bold">{w.name}</div>
            <div className="mt-0.5 flex items-center gap-1.5"><StyleBadge style={w.style} /><span className="text-[10px] text-dim">skill hidden · judge the stats</span></div>
            {mindOf(w) && <div className="mt-1 text-[11px] text-muted" title="How this wallet reacts to what a coin's feed says"><span className="font-semibold text-ink">{MIND_META[mindOf(w)!].icon} {MIND_META[mindOf(w)!].label}.</span> {MIND_META[mindOf(w)!].blurb}.</div>}
          </div>
          <button onClick={onClose} className="rounded p-1 text-muted hover:bg-raise hover:text-ink" aria-label="Close"><X size={16} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <p className="px-3 pt-3 text-[11px] text-muted">{meta.blurb}</p>
          {w.bot && <p className="mx-3 mt-2 rounded-md border border-line2 bg-panel2 px-2 py-1.5 text-[11px] text-muted"><span className="font-semibold text-ink">Simulated trader.</span> A computer player in the World: its own wallet, the same rules and fees as yours. It is not on the leaderboards.</p>}
          <div className="grid grid-cols-3 gap-2 p-3">
            <Box label={`${period} PnL`}><span className={toneClass(st.pnl)}>{st.pnl >= 0 ? '+' : '-'}{fmtCompact(Math.abs(st.pnl))}</span></Box>
            <Box label={`${period} PnL %`}><span className={toneClass(st.pnl)}>{fmtPct(st.pnlPct)}</span></Box>
            <Box label="Win rate">{st.buys + st.sells ? `${(st.winRate * 100).toFixed(1)}%` : '—'}</Box>
            <Box label="Balance">{fmtCompact(st.balance)}</Box>
            <Box label="Unrealized"><span className={toneClass(st.unrealized)}>{st.unrealized >= 0 ? '+' : '-'}{fmtCompact(Math.abs(st.unrealized))}</span></Box>
            <Box label="TXs"><span className="text-up">{fmtNum(st.buys)}</span>/<span className="text-down">{fmtNum(st.sells)}</span></Box>
          </div>
          <Sub title={`Holdings (${Object.keys(w.positions).length})`}>
            {Object.keys(w.positions).length === 0 ? <EmptyState icon="💤" title="No open positions" /> : Object.entries(w.positions).map(([id, p]) => {
              const t = map.get(id)
              const value = t ? p.qty * t.price : 0
              const pct = p.cost > 0 ? value / p.cost - 1 : 0
              return (
                <button key={id} disabled={!t} onClick={() => t && select(t.id)} className="flex w-full items-center gap-2 border-b border-line/50 px-3 py-1.5 text-left hover:bg-panel2">
                  {t && <TokenIcon token={t} size={22} />}
                  <span className="font-bold">{t?.ticker ?? '?'}</span>
                  <span className="num text-[10px] text-dim">{fmtAge((tick - p.openedTick) * SIM_SEC_PER_TICK)}</span>
                  <span className="ml-auto num text-[11px]">{fmtUsd(value)}</span>
                  <span className={clsx('num w-16 text-right text-[11px] font-semibold', toneClass(pct))}>{fmtPct(pct)}</span>
                </button>
              )
            })}
          </Sub>
          <Sub title="Recent trades">
            {w.trades.length === 0 ? <EmptyState icon="📭" title="No trades this session yet" /> : w.trades.slice(0, 25).map((tr) => (
              <div key={tr.id} className="border-b border-line/50 px-3 py-1.5 text-[11px]">
              <div className="flex items-center gap-2">
                <span className="num w-9 text-dim">{fmtAge(now - tr.time)}</span>
                <span className={clsx('w-8 font-semibold', tr.side === 'buy' ? 'text-up' : 'text-down')}>{tr.side === 'buy' ? 'Buy' : 'Sell'}</span>
                <TokenIcon token={{ emoji: tr.emoji, hue: tr.hue, status: 'graduated' }} size={18} />
                <span className="font-semibold">{tr.ticker}</span>
                <span className="ml-auto num">{fmtUsd(tr.usd)}</span>
                <span className={clsx('num w-16 text-right', tr.pnl !== undefined ? toneClass(tr.pnl) : 'text-dim')}>{tr.pnl !== undefined ? `${tr.pnl >= 0 ? '+' : '-'}${fmtCompact(Math.abs(tr.pnl))}` : '—'}</span>
              </div>
              {tr.why && <div className="mt-0.5 truncate pl-[44px] text-[10px] text-dim" title={tr.why}>↳ {tr.why}</div>}
              </div>
            ))}
          </Sub>
        </div>
        <div className="grid grid-cols-2 gap-2 border-t border-line p-3">
          <button onClick={() => toggleTrack(w.id)} className={clsx('flex h-10 items-center justify-center gap-1.5 rounded-md border text-[13px] font-semibold', tracked ? 'border-accent/50 text-accent' : 'border-line2 text-muted hover:text-ink')}>
            {tracked ? <Bell size={14} /> : <BellOff size={14} />} {tracked ? 'Tracking' : 'Track'}
          </button>
          <button onClick={() => onCopy(w.id)} className="flex h-10 items-center justify-center gap-1.5 rounded-md bg-up text-[13px] font-extrabold text-black hover:brightness-110">
            <Zap size={14} fill="currentColor" /> {copying ? 'Edit copy' : 'Copy trade'}
          </button>
        </div>
      </aside>
    </div>
  )
}

function Box({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-md border border-line bg-bg px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wider text-dim">{label}</div>
      <div className="num text-[13px] font-bold">{children}</div>
    </div>
  )
}
function Sub({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-t border-line">
      <div className="px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-muted">{title}</div>
      {children}
    </div>
  )
}

const LIQ_OPTIONS = [0, 2_500, 5_000, 10_000, 25_000, 50_000]

function CopyModal({ walletId, onClose }: { walletId: string; onClose: () => void }) {
  const w = useGame((s) => s.wallets.find((x) => x.id === walletId))
  const existing = useGame((s) => s.copies.find((c) => c.walletId === walletId))
  const cash = useGame((s) => s.portfolio.cash)
  const running = useGame((s) => s.runStatus === 'running')
  const startCopy = useGame((s) => s.startCopy)
  const [mode, setMode] = useState<'fixed' | 'ratio'>(existing?.mode ?? 'fixed')
  const [amount, setAmount] = useState(existing ? (existing.mode === 'ratio' ? existing.amount * 100 : existing.amount) : 250)
  const [maxPerTrade, setMaxPerTrade] = useState(existing?.maxPerTrade ?? 1000)
  const [budget, setBudget] = useState(existing?.budget ?? Math.min(5000, Math.floor(cash)))
  const [copySells, setCopySells] = useState(existing?.copySells ?? true)
  const [tp, setTp] = useState<string>(existing?.tp != null ? String(existing.tp) : '')
  const [sl, setSl] = useState<string>(existing?.sl != null ? String(existing.sl) : '')
  const [skipExtreme, setSkipExtreme] = useState(existing?.skipExtreme ?? true)
  const [minLiquidity, setMinLiquidity] = useState(existing?.minLiquidity ?? 2_500)
  if (!w) return null

  const valid = amount > 0 && maxPerTrade > 0 && budget > 0
  const submit = () => {
    if (!valid) return
    startCopy({
      walletId, mode, amount: mode === 'ratio' ? amount / 100 : amount, maxPerTrade, budget, copySells,
      tp: tp ? Math.max(1, Number(tp)) : null, sl: sl ? Math.min(99, Math.max(1, Number(sl))) : null, skipExtreme, minLiquidity,
    })
    onClose()
  }
  const num = (v: number, set: (n: number) => void, suffix?: string, prefix = '$') => (
    <div className="flex items-center rounded-md border border-line2 bg-bg px-2 focus-within:border-accent/60">
      {prefix && <span className="text-dim">{prefix}</span>}
      <input inputMode="decimal" value={v || ''} onChange={(e) => set(Number(e.target.value.replace(/[^0-9.]/g, '')) || 0)} className="num h-8 w-full bg-transparent px-1 text-right text-[13px] font-semibold outline-none" />
      {suffix && <span className="text-[11px] text-dim">{suffix}</span>}
    </div>
  )

  return (
    <Modal title={<span className="flex items-center gap-2"><Zap size={14} className="text-up" fill="currentColor" /> Copy trade {w.avatar} {w.name}</span>} onClose={onClose}>
      <div className="space-y-3 text-[12px]">
        <div className="flex items-center gap-2"><StyleBadge style={w.style} /><span className="text-[11px] text-muted">{STYLE_META[w.style].blurb}</span></div>

        <Row label="Buy size">
          <Segmented value={mode} onChange={setMode} options={[{ value: 'fixed', label: 'Fixed $' }, { value: 'ratio', label: '% of theirs' }]} />
        </Row>
        <Row label={mode === 'fixed' ? 'Amount per buy' : 'Share of their buy'} hint={mode === 'ratio' ? 'e.g. 50% means you buy half of what they buy' : undefined}>
          <div className="w-32">{mode === 'fixed' ? num(amount, setAmount) : num(amount, setAmount, '%', '')}</div>
        </Row>
        <Row label="Max per trade"><div className="w-32">{num(maxPerTrade, setMaxPerTrade)}</div></Row>
        <Row label="Total budget" hint="Copying stops buying once this much has been spent"><div className="w-32">{num(budget, setBudget)}</div></Row>
        <Row label="Copy their sells" hint="Sell the same share of your copied bag when they sell"><Toggle label="Copy sells" on={copySells} onChange={setCopySells} /></Row>
        <div className="grid grid-cols-2 gap-2">
          <label className="block"><span className="mb-0.5 block text-[10px] text-dim">Take profit (optional)</span>
            <div className="flex items-center rounded-md border border-line2 bg-bg px-2"><span className="text-up">+</span><input inputMode="decimal" value={tp} onChange={(e) => setTp(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="off" className="num h-8 w-full bg-transparent px-1 text-right outline-none placeholder:text-dim" /><span className="text-dim">%</span></div>
          </label>
          <label className="block"><span className="mb-0.5 block text-[10px] text-dim">Stop loss (optional)</span>
            <div className="flex items-center rounded-md border border-line2 bg-bg px-2"><span className="text-down">−</span><input inputMode="decimal" value={sl} onChange={(e) => setSl(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="off" className="num h-8 w-full bg-transparent px-1 text-right outline-none placeholder:text-dim" /><span className="text-dim">%</span></div>
          </label>
        </div>
        <Row label="Skip EXTREME-risk tokens"><Toggle label="Skip extreme risk" on={skipExtreme} onChange={setSkipExtreme} /></Row>
        <Row label="Min liquidity" hint="Thin pools mean brutal slippage for followers">
          <select value={minLiquidity} onChange={(e) => setMinLiquidity(Number(e.target.value))} className="num rounded-md border border-line2 bg-bg px-2 py-1 text-[12px] outline-none">
            {LIQ_OPTIONS.map((l) => <option key={l} value={l}>{l ? fmtCompact(l) : 'Any'}</option>)}
          </select>
        </Row>
        <p className="rounded-md border border-warn/30 bg-warn/5 p-2 text-[10px] leading-snug text-warn">
          Copies fill <b>after</b> the wallet's own trade, so you pay their price impact plus the 1% fee on every buy and sell. KOLs in particular often sell into their followers.
        </p>
        {running ? (
          <button disabled={!valid} onClick={submit} className="flex h-10 w-full items-center justify-center gap-1.5 rounded-md bg-up text-[13px] font-extrabold text-black hover:brightness-110 disabled:opacity-40">
            <Zap size={14} fill="currentColor" /> {existing ? 'Save copy settings' : `Start copying ${w.name}`}
          </button>
        ) : (
          <div className="rounded-md border border-line2 p-2 text-center text-muted">Start a round to copy trade</div>
        )}
      </div>
    </Modal>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <div className="font-semibold">{label}</div>
        {hint && <div className="text-[10px] text-dim">{hint}</div>}
      </div>
      {children}
    </div>
  )
}

function MyCopies({ onEdit }: { onEdit: (walletId: string) => void }) {
  const copies = useGame((s) => s.copies)
  const wallets = useGame((s) => s.wallets)
  const positions = useGame((s) => s.portfolio.positions)
  const updateCopy = useGame((s) => s.updateCopy)
  const stopCopy = useGame((s) => s.stopCopy)
  const openWallet = useGame((s) => s.openWallet)
  const select = useGame((s) => s.select)
  const map = useTokenMap()
  const [confirm, setConfirm] = useState<string | null>(null)
  if (!copies.length) return <EmptyState icon="⚡" title="You're not copying anyone yet" hint="Pick a wallet on the Rank tab and hit Copy" />
  return (
    <div className="grid gap-3 p-3 xl:grid-cols-2">
      {copies.map((c: CopyConfig) => {
        const w = wallets.find((x) => x.id === c.walletId)
        let value = 0
        let cost = 0
        const bags = Object.entries(c.holdings).map(([id, qty]) => {
          const t = map.get(id)
          const pos = positions[id]
          const v = t ? qty * t.price : 0
          const k = pos ? qty * pos.avgEntry : 0
          value += v
          cost += k
          return { id, t, qty, v, pct: k > 0 ? v / k - 1 : 0 }
        })
        const pnl = c.stats.realized + (value - cost)
        return (
          <div key={c.id} className={clsx('rounded-md border bg-panel', c.paused ? 'border-line opacity-80' : 'border-up/30')}>
            <div className="flex items-center gap-2.5 border-b border-line p-3">
              <button onClick={() => w && openWallet(w.id)} className="grid size-10 place-items-center rounded-full bg-raise text-[20px] ring-1 ring-line2">{w?.avatar}</button>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="font-bold">{w?.name}</span>
                  {w && <StyleBadge style={w.style} />}
                  <span className={clsx('rounded px-1 text-[9px] font-bold', c.paused ? 'bg-warn/15 text-warn' : 'bg-up/15 text-up')}>{c.paused ? 'PAUSED' : '● LIVE'}</span>
                </div>
                <div className="text-[10px] text-dim">
                  {c.mode === 'fixed' ? `${fmtUsd(c.amount, 0)}/buy` : `${Math.round(c.amount * 100)}% of theirs`} · max {fmtUsd(c.maxPerTrade, 0)} · {c.copySells ? 'copies sells' : 'buys only'}
                  {c.tp !== null && ` · TP +${c.tp}%`}{c.sl !== null && ` · SL −${c.sl}%`}{c.skipExtreme && ' · skips EXTREME'}
                </div>
              </div>
              <div className="text-right">
                <div className="text-[9px] uppercase tracking-wider text-dim">Copy PnL</div>
                <div className={clsx('num text-[15px] font-bold', toneClass(pnl))}>{pnl >= 0 ? '+' : ''}{fmtUsd(pnl)}</div>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-2 border-b border-line p-3 text-[11px]">
              <div><div className="text-[9px] text-dim">Budget used</div><div className="num">{fmtCompact(c.stats.spent)} / {fmtCompact(c.budget)}</div>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-line2"><div className="h-full bg-accent" style={{ width: `${Math.min(100, (c.stats.spent / c.budget) * 100)}%` }} /></div></div>
              <div><div className="text-[9px] text-dim">Buys / Sells</div><div className="num"><span className="text-up">{c.stats.buys}</span> / <span className="text-down">{c.stats.sells}</span></div></div>
              <div><div className="text-[9px] text-dim">Realized</div><div className={clsx('num', toneClass(c.stats.realized))}>{c.stats.realized >= 0 ? '+' : ''}{fmtUsd(c.stats.realized)}</div></div>
              <div><div className="text-[9px] text-dim">Skipped</div><div className="num text-muted" title="Buys skipped by your risk / min-liquidity filters, budget or cash. Lots of skips? Lower Min liquidity in Edit.">{c.stats.skipped}</div></div>
            </div>
            <div className="max-h-40 overflow-y-auto">
              {bags.length === 0 ? <div className="px-3 py-3 text-center text-[11px] text-dim">No copied bags open</div> : bags.map((b) => (
                <button key={b.id} disabled={!b.t} onClick={() => b.t && select(b.t.id)} className="flex w-full items-center gap-2 border-b border-line/50 px-3 py-1.5 text-left text-[11px] hover:bg-panel2">
                  {b.t && <TokenIcon token={b.t} size={20} />}
                  <span className="font-bold">{b.t?.ticker ?? '?'}</span>
                  <span className="num text-dim">{fmtNum(b.qty)}</span>
                  <span className="ml-auto num">{fmtUsd(b.v)}</span>
                  <span className={clsx('num w-16 text-right font-semibold', toneClass(b.pct))}>{fmtPct(b.pct)}</span>
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5 p-3">
              <button onClick={() => updateCopy(c.id, { paused: !c.paused })} className="flex items-center gap-1 rounded-md border border-line2 px-2.5 py-1 text-[11px] font-semibold text-muted hover:text-ink">
                {c.paused ? <><Play size={12} /> Resume</> : <><Pause size={12} /> Pause</>}
              </button>
              <button onClick={() => onEdit(c.walletId)} className="flex items-center gap-1 rounded-md border border-line2 px-2.5 py-1 text-[11px] font-semibold text-muted hover:text-ink"><Settings2 size={12} /> Edit</button>
              {confirm === c.id ? (
                <>
                  <button onClick={() => { stopCopy(c.id, true); setConfirm(null) }} className="rounded-md bg-down px-2.5 py-1 text-[11px] font-bold text-white">Stop & sell bags</button>
                  <button onClick={() => { stopCopy(c.id, false); setConfirm(null) }} className="rounded-md border border-line2 px-2.5 py-1 text-[11px] font-semibold text-muted hover:text-ink">Stop, keep bags</button>
                  <button onClick={() => setConfirm(null)} className="px-1.5 text-[11px] text-dim hover:text-ink">Cancel</button>
                </>
              ) : (
                <button onClick={() => setConfirm(c.id)} className="ml-auto flex items-center gap-1 rounded-md border border-down/40 px-2.5 py-1 text-[11px] font-semibold text-down hover:bg-down/10"><Square size={11} /> Stop</button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Activity() {
  const feed = useGame((s) => s.walletFeed)
  const wallets = useGame((s) => s.wallets)
  const tracked = useGame((s) => s.trackedWallets)
  const copies = useGame((s) => s.copies)
  const now = useGame((s) => s.market.time)
  const openWallet = useGame((s) => s.openWallet)
  const select = useGame((s) => s.select)
  const map = useTokenMap()
  const [onlyMine, setOnlyMine] = useState(false)
  const followed = new Set([...tracked, ...copies.map((c) => c.walletId)])
  const rows = onlyMine ? feed.filter((f) => followed.has(f.walletId)) : feed
  const byId = new Map(wallets.map((w) => [w.id, w]))
  return (
    <div>
      <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-[11px]">
        <Segmented value={onlyMine ? 'mine' : 'all'} onChange={(v) => setOnlyMine(v === 'mine')} options={[{ value: 'all', label: 'All wallets' }, { value: 'mine', label: `Tracked & copied (${followed.size})` }]} />
        <span className="ml-auto flex items-center gap-1 text-dim"><span className="size-1.5 rounded-full bg-up pulse-dot" /> live</span>
      </div>
      {rows.length === 0 ? <EmptyState icon="📡" title="Waiting for wallet activity…" /> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-[12px]">
            <tbody>
              {rows.map((f) => {
                const w = byId.get(f.walletId)
                const t = map.get(f.tokenId)
                return (
                  <tr key={f.id} className={clsx('slide-in border-b border-line/40 hover:bg-panel2', f.copied && 'bg-up/5')}>
                    <td className="w-12 px-3 py-1.5 num text-dim">{fmtAge(now - f.time)}</td>
                    <td className="px-3 py-1.5">
                      <button onClick={() => w && openWallet(w.id)} className="flex items-center gap-1.5 hover:text-accent">
                        <span>{w?.avatar}</span><span className="font-semibold">{w?.name}</span>
                      </button>
                    </td>
                    <td className={clsx('px-3 py-1.5 font-semibold', f.side === 'buy' ? 'text-up' : 'text-down')}>{f.side === 'buy' ? 'Bought' : f.fraction >= 1 ? 'Sold all' : `Sold ${Math.round(f.fraction * 100)}%`}</td>
                    <td className="px-3 py-1.5">
                      <button disabled={!t} onClick={() => t && select(t.id)} className="flex items-center gap-1.5 hover:text-accent">
                        <TokenIcon token={{ emoji: f.emoji, hue: f.hue, status: 'graduated' }} size={18} /><span className="font-bold">{f.ticker}</span>
                      </button>
                    </td>
                    <td className="px-3 py-1.5 text-right num">{fmtUsd(f.usd)}</td>
                    <td className="px-3 py-1.5 text-right num text-muted">{t ? fmtCompact(t.mcap) : '—'}</td>
                    <td className="w-24 px-3 py-1.5 text-right">{f.copied && <span className="rounded bg-up/15 px-1.5 text-[9px] font-bold text-up">⚡ COPIED</span>}</td>
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
