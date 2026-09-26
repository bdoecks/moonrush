import { lazy, Suspense, useEffect } from 'react'
import { Dock, MobileNav, MobileTradeSheet, Sidebar, StatusBar, TickerStrip } from './components/layout'
import { Modals } from './components/Modals'
import { SwapModal } from './components/chain'
import { WalletManager } from './components/wallets'
import { Toasts } from './components/Toasts'
import { TopBar } from './components/TopBar'
import { TrackerDock } from './components/tracker/TrackerDock'
import { useGameLoop } from './hooks/useGameLoop'
import { useKeyboard } from './hooks/useKeyboard'
import { useGame } from './game/store'
import { syncMarket } from './game/ledger'
import { foldDaily, newTrades } from './game/daily'
import { rankMap, watchRanks } from './game/rankWatch'
import { isRanked } from './game/season'
import { valuePortfolio } from './game/portfolioEngine'
import { resumeRoom } from './net/client'
import { CookingView } from './pages/CookingView'
import { CopyTradeView } from './pages/CopyTradeView'
import { SniperView } from './pages/SniperView'
import { PnlCard } from './components/PnlCard'
import { MonitorView } from './pages/MonitorView'
import { TrackView } from './pages/TrackView'
import { DiscoverView } from './pages/DiscoverView'
import { TrenchesView } from './pages/TrenchesView'
import { LeaderboardView } from './pages/LeaderboardView'
import { MissionsView } from './pages/MissionsView'
import { TokenView } from './pages/TokenView'

// Recharts is only needed on the portfolio page — keep it out of the initial bundle.
const PortfolioView = lazy(() => import('./pages/PortfolioView').then((m) => ({ default: m.PortfolioView })))
const RewardsView = lazy(() => import('./pages/RewardsView').then((m) => ({ default: m.RewardsView })))

function PageSkeleton() {
  return (
    <div className="grid gap-2 p-3 sm:grid-cols-3 lg:grid-cols-5">
      {Array.from({ length: 10 }, (_, i) => <div key={i} className="skeleton h-16 rounded-md" />)}
      <div className="skeleton col-span-full h-60 rounded-md" />
    </div>
  )
}

export default function App() {
  useGameLoop()
  useKeyboard()
  const view = useGame((s) => s.view)
  const accent = useGame((s) => s.settings.accent)
  const compact = useGame((s) => s.settings.compact)
  const animations = useGame((s) => s.settings.animations)

  // First run with the PnL calendar: start today's cell from the round in progress.
  useEffect(() => {
    const s = useGame.getState()
    if (!s.profile.daily && s.portfolio.trades.length) useGame.setState({ profile: { ...s.profile, daily: foldDaily(undefined, s.portfolio.trades) } })
  }, [])

  // Keep every token's holder/trader ledger current (Holders tab, top-10 figures), not just the one on screen.
  useEffect(() => useGame.subscribe((s, prev) => {
    if (s.market !== prev.market) syncMarket(s.market)
    // PnL calendar: add new fills to today's entry (the profile is saved with the rest of the game).
    // Only fills stamped with the current market time count, so loading a save never re-adds old trades.
    const fills = s.portfolio.trades !== prev.portfolio.trades && s.mode === prev.mode
      ? newTrades(s.portfolio.trades, prev.portfolio.trades).filter((t) => t.time >= s.market.time - 12)
      : []
    if (fills.length) useGame.setState({ profile: { ...s.profile, daily: foldDaily(s.profile.daily, fills) } })
    // Leaderboard: track rank movement; cheer when you overtake a rival mid-round.
    if (s.players !== prev.players && s.players.length) {
      const map = new Map(s.market.tokens.map((t) => [t.id, t]))
      const ret = valuePortfolio(s.portfolio, map, s.market).equity / s.portfolio.startBalance - 1
      const passed = watchRanks(s.players, ret, s.market.tick)
      if (passed && s.runStatus === 'running' && isRanked(s.mode)) {
        const rank = rankMap(s.players, ret).get('you')
        s.notify({ title: `YOU PASSED ${passed.name.toUpperCase()}`, body: `${passed.avatar} Now #${rank} of ${s.players.length + 1}`, tone: 'up', icon: '🏁' })
      }
    }
  }), [])

  // Start (or roll over to) this week's ranked season.
  useEffect(() => useGame.getState().checkSeason(), [])

  // Were you in a multiplayer room before this reload? Go back in.
  useEffect(() => resumeRoom(), [])

  useEffect(() => {
    const root = document.documentElement
    root.dataset.accent = accent
    root.dataset.compact = String(compact)
    root.dataset.anim = String(animations)
  }, [accent, compact, animations])

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <TickerStrip />
      <div className="flex min-h-0 flex-1">
        {/* Wallet + social trackers; places itself on the left or right edge. */}
        <TrackerDock />
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1">
            {view === 'discover' && <DiscoverView />}
            {view === 'trenches' && <TrenchesView />}
            {view === 'token' && <TokenView />}
            {view === 'portfolio' && (
              <Suspense fallback={<PageSkeleton />}>
                <PortfolioView />
              </Suspense>
            )}
            {view === 'missions' && <MissionsView />}
            {view === 'cooking' && <CookingView />}
            {view === 'copytrade' && <CopyTradeView />}
            {view === 'sniper' && <SniperView />}
            {view === 'monitor' && <MonitorView />}
            {view === 'track' && <TrackView />}
            {view === 'rewards' && (
              <Suspense fallback={<PageSkeleton />}>
                <RewardsView />
              </Suspense>
            )}
            {view === 'leaderboard' && <LeaderboardView />}
          </div>
          {(view === 'discover' || view === 'trenches') && <Dock />}
        </main>
        {/* The buy / sell sidebar only belongs next to a coin's chart. */}
        {view === 'token' && <Sidebar />}
      </div>
      <StatusBar />
      <MobileNav />
      <MobileTradeSheet />
      <Toasts />
      <Modals />
      <SwapModal />
      <WalletManager />
      <PnlCard />
    </div>
  )
}
