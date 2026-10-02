import clsx from 'clsx'
import { BarChart3, ChefHat, ChevronDown, Copy, Crosshair, Eye, Flame, Gift, LineChart, Maximize2, Minimize2, Radar, ChevronUp, Compass, Radio, Target, Trophy, Wallet, X } from 'lucide-react'
import { SocialTracker } from './SocialTracker'
import { TrackerFeed } from './tracker/TrackerFeed'
import { GlobalSearch } from './GlobalSearch'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSelectedToken, useValuation } from '../hooks/useDerived'
import { selectSpeed, useGame, type DockTab, type View } from '../game/store'
import { fmtUsd, toneClass } from '../utils/format'
import { load, save } from '../utils/storage'
import { EventFeed, HistoryTable, PositionsTable, WatchlistTable } from './tables'
import { ChainSwitcher, WalletChip } from './chain'
import { WalletSelector } from './wallets'
import { CHAIN_IDS, CHAINS } from '../data/chains'
import { MarketStatus, RunClock } from './TopBar'
import { FlowStats } from './token/FlowStats'
import { RiskPanel } from './token/RiskPanel'
import { TradePanel } from './token/TradePanel'
import { Kbd, Pct } from './ui'
import { LighthouseButton } from './Lighthouse'

// ─── Bottom dock (tablet/desktop) ────────────────────────────────────────────
export function Dock() {
  const tab = useGame((s) => s.dockTab)
  const setTab = useGame((s) => s.setDockTab)
  const nPos = useGame((s) => Object.keys(s.portfolio.positions).length)
  const nWatch = useGame((s) => s.watchlist.length)
  const nTrades = useGame((s) => s.portfolio.trades.length)
  const nTracked = useGame((s) => s.trackedWallets.length)
  const [collapsed, setCollapsed] = useState(() => load<boolean>('dockCollapsed') ?? false)
  const [tall, setTall] = useState(() => load<boolean>('dockTall') ?? false) // bigger panel (easier to read the Events feed)
  useEffect(() => save('dockTall', tall), [tall])
  useEffect(() => save('dockCollapsed', collapsed), [collapsed])
  const firstTab = useRef(tab)
  useEffect(() => {
    if (tab !== firstTab.current) setCollapsed(false)
    firstTab.current = tab
  }, [tab])

  const tabs: { id: DockTab; label: string; count?: number; key?: string }[] = [
    { id: 'positions', label: 'Positions', count: nPos },
    { id: 'watchlist', label: 'Watchlist', count: nWatch, key: 'W' },
    { id: 'history', label: 'History', count: nTrades },
    { id: 'feed', label: 'Events' },
    { id: 'tracker', label: 'Wallet tracker', count: nTracked || undefined },
    { id: 'social', label: 'Social tracker' },
  ]
  return (
    <div data-dock className={clsx('hidden shrink-0 flex-col border-t border-line bg-panel md:flex transition-[height] duration-200', collapsed ? 'h-8' : tall ? 'h-[clamp(220px,45vh,480px)]' : 'h-[clamp(130px,25vh,250px)]')}>
      <div className="flex h-8 shrink-0 items-center gap-0.5 border-b border-line px-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={clsx('flex h-full items-center gap-1.5 border-b-2 px-2.5 text-[11px] font-semibold transition-colors', tab === t.id ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink')}
          >
            {t.label}
            {t.count !== undefined && <span className="num rounded bg-raise px-1 text-[9px] text-muted">{t.count}</span>}
            {t.key && <span className="hidden xl:inline"><Kbd>{t.key}</Kbd></span>}
          </button>
        ))}
        {/* Market Lighthouse sits with the tabs (Positions, Watchlist, Events, trackers…). */}
        <span className="ml-1 flex items-center border-l border-line pl-2"><LighthouseButton /></span>
        <PnlButton className="ml-auto" />
        {!collapsed && (
          <button onClick={() => setTall((v) => !v)} className="rounded p-1 text-muted hover:bg-raise hover:text-ink" aria-label={tall ? 'Make panel smaller' : 'Make panel taller'} title={tall ? 'Smaller panel' : 'Taller panel'}>
            {tall ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
        )}
        <button onClick={() => setCollapsed((c) => !c)} className="rounded p-1 text-muted hover:bg-raise hover:text-ink" aria-label={collapsed ? 'Expand panel' : 'Collapse panel'}>
          {collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>
      {!collapsed && (
        <div className="min-h-0 flex-1 overflow-auto">
          {tab === 'positions' && <PositionsTable />}
          {tab === 'watchlist' && <WatchlistTable />}
          {tab === 'history' && <HistoryTable limit={100} />}
          {tab === 'feed' && <EventFeed />}
          {tab === 'tracker' && <TrackerFeed compact />}
          {tab === 'social' && <SocialTracker />}
        </div>
      )}
    </div>
  )
}

/** Opens the floating PnL card (GMGN-style). */
export function PnlButton({ className }: { className?: string }) {
  const open = useGame((s) => s.pnlOpen)
  const setOpen = useGame((s) => s.setPnlOpen)
  const v = useValuation()
  const pnl = v.stats.totalPnl
  return (
    <button onClick={() => setOpen(!open)} aria-pressed={open} title="Floating PnL card" className={clsx('flex h-6 items-center gap-1.5 rounded border px-2 text-[11px] font-bold transition-colors', open ? 'border-accent/50 bg-accent/10 text-accent' : 'border-line2 text-muted hover:text-ink', className)}>
      <LineChart size={12} /> PnL <span className={clsx('num font-semibold', toneClass(pnl))}>{pnl >= 0 ? '+' : ''}{fmtUsd(pnl, 0)}</span>
    </button>
  )
}

// ─── Right sidebar (desktop) ─────────────────────────────────────────────────
export function Sidebar() {
  return (
    <aside className="hidden w-[320px] shrink-0 flex-col border-l border-line bg-panel lg:flex xl:w-[340px]">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="border-b border-line"><FlowStats /></div>
        <TradePanel />
        <div className="border-t border-line"><RiskPanel /></div>
        <div className="border-t border-line">
          <div className="flex items-center gap-1.5 px-3 pt-3 pb-1 text-[11px] font-bold uppercase tracking-wider text-muted">
            <Radio size={12} className="text-accent" /> Live feed
          </div>
          <EventFeed limit={25} compact toolbar={false} />
        </div>
      </div>
    </aside>
  )
}

// ─── Movers ticker strip ─────────────────────────────────────────────────────
/** The scrolling "MOVERS 5M" coin % marquee: switched off for now. */
const SHOW_MOVERS = false

export function TickerStrip() {
  const allTokens = useGame((s) => s.market.tokens)
  const chainFilter = useGame((s) => s.chainFilter)
  const tokens = chainFilter === 'all' ? allTokens : allTokens.filter((t) => t.chain === chainFilter)
  const select = useGame((s) => s.select)
  // Recompute the list every ~10s so the marquee doesn't reflow every tick.
  const bucket = useGame((s) => Math.floor(s.market.tick / 10))
  const movers = useMemo(
    () => tokens.filter((t) => t.status === 'bonding' || t.status === 'graduated').sort((a, b) => Math.abs(b.change['5m']) - Math.abs(a.change['5m'])).slice(0, 14).map((t) => t.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bucket, chainFilter],
  )
  const map = new Map(tokens.map((t) => [t.id, t]))
  const items = movers.map((id) => map.get(id)).filter((t) => !!t)
  return (
    // Only for screens too narrow for the top bar to hold everything: status and search move down here, and on
    // phones (no tab row) the chain filter too. Wide screens don't get this bar at all.
    <div className={clsx('flex h-7 shrink-0 items-center border-b border-line bg-bg', !SHOW_MOVERS && 'xl:hidden')}>
      <div className="flex items-center gap-1.5 px-2 lg:hidden">
        <MarketStatus />
        <RunClock />
      </div>
      <div className="flex h-full shrink-0 items-center border-r border-line px-2 md:hidden"><ChainSwitcher /></div>
      <div className="flex h-full shrink-0 items-center border-r border-line px-1.5 xl:hidden"><GlobalSearch small className="w-40 transition-[width] focus-within:w-64 sm:w-48" /></div>
      {SHOW_MOVERS && <div className="hidden h-full items-center border-r border-line px-2 text-[9px] font-bold tracking-[0.2em] text-dim lg:flex">MOVERS 5M</div>}
      {SHOW_MOVERS && <div className="relative min-w-0 flex-1 overflow-hidden">
        <div className="marquee flex w-max gap-5 px-3">
          {[...items, ...items].map((t, i) => (
            <button key={`${t.id}-${i}`} onClick={() => select(t.id)} className="flex items-center gap-1.5 text-[11px] hover:text-accent">
              <span>{t.emoji}</span>
              <span className="font-semibold">${t.ticker}</span>
              <Pct v={t.change['5m']} arrow />
            </button>
          ))}
        </div>
      </div>}
    </div>
  )
}

// ─── Status bar (desktop) ────────────────────────────────────────────────────
export function StatusBar() {
  const tick = useGame((s) => s.market.tick)
  const nTokens = useGame((s) => s.market.tokens.length)
  const speed = useGame(selectSpeed)
  return (
    <footer className="hidden h-6 shrink-0 items-center gap-4 border-t border-line bg-panel px-3 text-[10px] text-dim md:flex">
      <span className="flex items-center gap-1"><span className="size-1.5 rounded-full bg-up" /> SIMULATION</span>
      <span className="num">tick {tick}</span>
      <span className="num">{nTokens} tokens</span>
      <span className="num">{speed}× speed</span>
      <NativePrices />
      <PnlButton className="ml-auto h-5" />
      <span>Fictional tokens · virtual money · no real transactions</span>
      <span className="hidden xl:flex items-center gap-1"><Kbd>/</Kbd> search <Kbd>B</Kbd>/<Kbd>S</Kbd> trade <Kbd>Space</Kbd> pause <Kbd>?</Kbd> help</span>
    </footer>
  )
}

function NativePrices() {
  const native = useGame((s) => s.market.native)
  return (
    <span className="flex items-center gap-3">
      {CHAIN_IDS.map((c) => {
        const q = native?.[c]
        if (!q) return null
        const ch = q.price / q.open - 1
        return (
          <span key={c} className="num flex items-center gap-1" title={`${CHAINS[c].native} (simulated price)`}>
            <span style={{ color: CHAINS[c].color }}>{CHAINS[c].glyph}</span>
            <span className="text-muted">{fmtUsd(q.price, q.price < 1000 ? 2 : 0)}</span>
            <span className={ch >= 0 ? 'text-up' : 'text-down'}>{ch >= 0 ? '+' : ''}{(ch * 100).toFixed(2)}%</span>
          </span>
        )
      })}
    </span>
  )
}

// ─── Mobile nav + trade sheet ────────────────────────────────────────────────
const MOBILE_NAV: { id: View; label: string; icon: typeof Compass }[] = [
  { id: 'discover', label: 'Market', icon: Compass },
  { id: 'trenches', label: 'Trenches', icon: Flame },
  { id: 'token', label: 'Chart', icon: BarChart3 },
  { id: 'cooking', label: 'Cook', icon: ChefHat },
  { id: 'copytrade', label: 'Copy', icon: Copy },
  { id: 'sniper', label: 'Sniper', icon: Crosshair },
  { id: 'monitor', label: 'Monitor', icon: Radar },
  { id: 'track', label: 'Track', icon: Eye },
  { id: 'rewards', label: 'Rewards', icon: Gift },
  { id: 'portfolio', label: 'Wallet', icon: Wallet },
  { id: 'missions', label: 'Missions', icon: Target },
  { id: 'leaderboard', label: 'Ranks', icon: Trophy },
]

export function MobileNav() {
  const view = useGame((s) => s.view)
  const setView = useGame((s) => s.setView)
  return (
    <nav className="shrink-0 border-t border-line bg-panel pb-[env(safe-area-inset-bottom)] md:hidden">
      <div className="flex items-center justify-between border-b border-line px-3 py-1 text-[10px]">
        <WalletChip compact />
        <WalletSelector compact dropUp align="left" />
        <PnlButton />
      </div>
      <div className="no-scrollbar flex overflow-x-auto">
        {MOBILE_NAV.map((n) => (
          <button key={n.id} onClick={() => setView(n.id)} className={clsx('flex min-w-[56px] flex-1 flex-col items-center gap-0.5 py-1.5 text-[10px] font-semibold', view === n.id ? 'text-accent' : 'text-muted')}>
            <n.icon size={17} />
            {n.label}
          </button>
        ))}
      </div>
    </nav>
  )
}

export function MobileTradeSheet() {
  const open = useGame((s) => s.sheetOpen)
  const setOpen = useGame((s) => s.setSheetOpen)
  const t = useSelectedToken()
  if (!open || !t) return null
  return (
    <div className="fixed inset-0 z-40 md:hidden">
      <div className="absolute inset-0 bg-black/60 fade-in" onClick={() => setOpen(false)} />
      <div className="sheet-up absolute inset-x-0 bottom-0 max-h-[88vh] overflow-y-auto rounded-t-xl border-t border-line2 bg-panel pb-[env(safe-area-inset-bottom)]">
        <div className="sticky top-0 flex items-center justify-center bg-panel pt-2">
          <div className="h-1 w-10 rounded-full bg-line2" />
          <button onClick={() => setOpen(false)} className="absolute right-2 top-1.5 p-1 text-muted" aria-label="Close"><X size={16} /></button>
        </div>
        <TradePanel />
      </div>
    </div>
  )
}
