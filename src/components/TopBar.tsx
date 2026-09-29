import clsx from 'clsx'
import { CircleHelp, Gift, PanelLeft, PanelRight, Pause, Play, Settings as SettingsIcon, Timer, Volume2, VolumeX } from 'lucide-react'
import { CHAIN_IDS, CHAINS, fmtNative } from '../data/chains'
import { cashbackOf, pendingUsd } from '../game/rewardsEngine'
import type { Chain } from '../types'
import { save } from '../utils/storage'
import { useDockPrefs } from './tracker/TrackerDock'
import { useTokenMap, useValuation } from '../hooks/useDerived'
import { chainView } from '../game/chainPnl'
import { levelFromXp, MODES, titleFor } from '../game/progression'
import { selectSpeed, useGame, type View } from '../game/store'
import { fmtClock, fmtUsd, toneClass } from '../utils/format'
import { FlashNum } from './ui'
import { WalletChip } from './chain'
import { WalletSelector } from './wallets'
import { GlobalSearch } from './GlobalSearch'
import { RoomChip } from './Multiplayer'
import { AccountButton, AdminButton } from './Account'

const UNITS = ['usd', 'sol', 'bsc', 'hood'] as const

export function Logo({ small }: { small?: boolean }) {
  return (
    <div className="flex items-center gap-2 select-none">
      <div className="relative grid size-7 place-items-center rounded-md bg-accent/10 ring-1 ring-accent/40">
        <svg viewBox="0 0 32 32" className="size-5">
          <circle cx="16" cy="16" r="10" fill="var(--accent)" />
          <circle cx="21" cy="12" r="9" fill="var(--color-panel)" />
          <path d="M6 27 L13 20" stroke="var(--accent)" strokeWidth="2.6" strokeLinecap="round" />
        </svg>
      </div>
      <div className="leading-none">
        <div className="font-display text-[15px] font-bold tracking-[0.12em]">
          MOON<span className="text-accent">RUSH</span>
        </div>
        {!small && <div className="mt-0.5 whitespace-nowrap text-[7px] font-semibold tracking-[0.22em] text-dim">MEME TRADING ARENA</div>}
      </div>
    </div>
  )
}

const NAV: { id: View; label: string; short: string; key: string }[] = [
  { id: 'discover', label: 'Discover', short: 'Market', key: 'D' },
  { id: 'trenches', label: 'Trenches', short: 'Trenches', key: 'T' },
  { id: 'cooking', label: '🍳 Cooking', short: '🍳 Cook', key: 'C' },
  { id: 'copytrade', label: 'CopyTrade', short: 'Copy', key: 'Y' },
  { id: 'sniper', label: '🎯 Sniper', short: '🎯 Snipe', key: 'N' },
  { id: 'monitor', label: 'Monitor', short: 'Monitor', key: 'O' },
  { id: 'track', label: 'Track', short: 'Track', key: 'K' },
  { id: 'portfolio', label: 'Portfolio', short: 'Portfolio', key: 'P' },
  { id: 'rewards', label: 'Rewards', short: 'Rewards', key: 'R' },
  { id: 'missions', label: 'Missions', short: 'Missions', key: 'M' },
  { id: 'leaderboard', label: 'Leaderboard', short: 'Ranks', key: 'L' },
]

export function MarketStatus() {
  const paused = useGame((s) => s.paused)
  const sentiment = useGame((s) => s.market.sentiment)
  const togglePause = useGame((s) => s.togglePause)
  const mood = sentiment > 0.35 ? 'EUPHORIC' : sentiment > 0.1 ? 'BULLISH' : sentiment < -0.35 ? 'PANIC' : sentiment < -0.1 ? 'BEARISH' : 'NEUTRAL'
  return (
    <button onClick={togglePause} className="group flex items-center gap-2 rounded-md border border-line bg-panel2 px-2 py-1 hover:border-line2" title="Pause / resume market (Space)">
      <span className={clsx('size-1.5 rounded-full', paused ? 'bg-warn' : 'bg-up pulse-dot')} />
      <span className="text-[10px] font-bold tracking-wider">{paused ? 'PAUSED' : 'LIVE'}</span>
      <span className="hidden xl:inline text-[10px] text-dim">|</span>
      <span className={clsx('hidden xl:inline num text-[10px]', toneClass(sentiment))}>{mood}</span>
      <span className="text-muted group-hover:text-ink">{paused ? <Play size={11} /> : <Pause size={11} />}</span>
    </button>
  )
}

export function RunClock() {
  const mode = useGame((s) => s.mode)
  const runTicks = useGame((s) => s.runTicks)
  const status = useGame((s) => s.runStatus)
  const speed = useGame(selectSpeed)
  const setModal = useGame((s) => s.setModal)
  const runDuration = useGame((s) => s.runDuration)
  const online = useGame((s) => !!s.online)
  const cfg = MODES[mode]
  const remaining = runDuration ? (runDuration - runTicks) / speed : null
  return (
    <button onClick={() => setModal(online ? 'lobby' : 'mode')} className="flex items-center gap-1.5 rounded-md border border-line bg-panel2 px-2 py-1 hover:border-line2" title="Game mode">
      <span className="text-[10px] font-bold tracking-wider text-accent">{cfg.name.toUpperCase()}</span>
      {status === 'running' && remaining !== null && (
        <span className={clsx('num flex items-center gap-1 text-[11px]', remaining < 60 ? 'text-down' : 'text-ink')}>
          <Timer size={11} />
          {fmtClock(remaining)}
        </span>
      )}
      {status === 'running' && remaining === null && mode !== 'practice' && <span className="text-[10px] text-muted">NO LIMIT</span>}
      {status === 'finished' && <span className="text-[10px] text-warn">ENDED</span>}
      {status === 'select' && <span className="text-[10px] text-muted">SELECT</span>}
    </button>
  )
}

function LevelChip() {
  const xp = useGame((s) => s.profile.xp)
  const setView = useGame((s) => s.setView)
  const l = levelFromXp(xp)
  return (
    <button onClick={() => setView('missions')} className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-panel2" title={`${l.into}/${l.span} XP to next level`}>
      <div className="grid size-7 place-items-center rounded-md bg-accent text-accent-ink font-display text-[12px] font-bold">{l.level}</div>
      <div className="hidden 2xl:block w-24 text-left">
        <div className="text-[10px] font-semibold leading-none">{titleFor(l.level)}</div>
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-line2">
          <div className="h-full bg-accent transition-all duration-500" style={{ width: `${l.progress * 100}%` }} />
        </div>
      </div>
    </button>
  )
}

/** Shows / hides the wallet + social tracker dock (desktop). */
function DockToggle() {
  const [p, set] = useDockPrefs()
  const Icon = p.side === 'left' ? PanelLeft : PanelRight
  return (
    <button onClick={() => set({ open: !p.open })} aria-pressed={p.open} className={clsx('hidden rounded-md p-1.5 hover:bg-panel2 lg:block', p.open ? 'text-accent' : 'text-muted hover:text-ink')} aria-label="Toggle trackers" title="Wallet & social trackers">
      <Icon size={15} />
    </button>
  )
}

/** Claimable trading cashback (SOL / BNB / ETH); click to open Rewards → Cashback. */
function CashbackChip() {
  const rewards = useGame((s) => s.rewards)
  const native = useGame((s) => s.market.native)
  const running = useGame((s) => s.runStatus === 'running')
  const setView = useGame((s) => s.setView)
  const cb = cashbackOf(rewards)
  const price = (c: Chain) => native?.[c]?.price ?? CHAINS[c].basePrice
  const usd = cb.auto === 'off' ? pendingUsd(cb, price) : cb.roundUsd
  if (!running) return null
  const has = CHAIN_IDS.filter((c) => cb.pending[c] > 1e-9)
  const tip = cb.auto === 'off'
    ? `Claimable cashback: ${has.length ? has.map((c) => fmtNative(cb.pending[c], c)).join(' · ') : 'none yet'}. Click to claim.`
    : `Auto-claiming cashback as ${cb.auto === 'coin' ? 'coins' : 'USDC'}: ${fmtUsd(cb.roundUsd, 4)} this round.`
  return (
    <button
      onClick={() => {
        save('rewardsTab', 'cashback')
        setView('rewards')
      }}
      title={tip}
      className={clsx('hidden items-center gap-1.5 rounded-md border px-2 py-1 text-left sm:flex', usd >= 0.0001 && cb.auto === 'off' ? 'border-up/40 bg-up/10' : 'border-line bg-panel2 hover:border-line2')}
    >
      <Gift size={13} className="text-up" />
      <span>
        <span className="block text-[9px] uppercase leading-none tracking-wider text-dim">{cb.auto === 'off' ? 'Cashback' : 'Cashback · auto'}</span>
        {/* Claimable cashback is shown in the coins you'll get (like GMGN / Axiom), so it only changes when you earn more. */}
        <span className="num block text-[12px] font-semibold leading-tight text-up">{cb.auto !== 'off' ? fmtUsd(usd, usd < 10 ? 4 : 2) : has.length ? `${fmtNative(cb.pending[has[0]], has[0])}${has.length > 1 ? ` +${has.length - 1}` : ''}` : fmtNative(0, 'sol')}</span>
      </span>
      {has.length > 0 && (
        <span className="flex -space-x-1">
          {has.map((c) => <span key={c} className="size-2 rounded-full ring-1 ring-panel" style={{ background: CHAINS[c].color }} />)}
        </span>
      )}
    </button>
  )
}

export function TopBar() {
  const v = useValuation()
  const view = useGame((s) => s.view)
  const backView = useGame((s) => s.backView)
  const setView = useGame((s) => s.setView)
  const setModal = useGame((s) => s.setModal)
  const sound = useGame((s) => s.settings.sound)
  const updateSettings = useGame((s) => s.updateSettings)
  const pnl = v.stats.totalPnl
  // Show the top-bar numbers in USD or in a chain coin (Settings, or tap "Portfolio" to cycle).
  const unit = useGame((s) => s.settings.portfolioUnit ?? 'usd')
  const market = useGame((s) => s.market)
  // In a chain coin (GMGN-style): your wallet on that chain, and P&L from the coin your trades actually paid and got
  // back, so nothing moves with the coin's price unless you still hold a bag.
  const map = useTokenMap()
  const cv = unit === 'usd' ? null : chainView(v.portfolio, market, unit, map)
  const coin = (n: number, signed = false) => (signed && n >= 0 ? '+' : '') + fmtNative(n, unit as Chain)
  const money = (usd: number, signed = false) => (signed && usd >= 0 ? '+' : '') + fmtUsd(usd)
  const pnlPct = cv ? (cv.spent > 0 ? cv.pnl / cv.spent : 0) : v.stats.totalPnlPct
  const pnlTone = cv ? cv.pnl : pnl
  const cycleUnit = () => updateSettings({ portfolioUnit: UNITS[(UNITS.indexOf(unit) + 1) % UNITS.length] })
  const rewardReady = useGame((s) => s.rewards.commissionPending >= 0.01 || s.rewards.checkIn.lastDate !== new Date().toDateString())

  return (
    <header className="shrink-0 border-b border-line bg-panel">
    <div className="flex h-12 items-center gap-3 px-3">
      <Logo />
      <GlobalSearch className="hidden w-52 shrink-0 transition-[width] focus-within:w-72 xl:block" />
      <div className="ml-auto hidden lg:flex items-center gap-2">
        <MarketStatus />
        <RunClock />
      </div>
      <RoomChip />

      <div className="ml-auto lg:ml-3 flex items-center gap-4 whitespace-nowrap">
        <div className="text-right">
          <button onClick={cycleUnit} className="block w-full text-right text-[9px] uppercase tracking-wider text-dim hover:text-ink" title="Show in USD / SOL / BNB / ETH">Portfolio · {unit === 'usd' ? 'USD' : CHAINS[unit].native}</button>
          <FlashNum value={cv ? Math.round(cv.total * 1000) : Math.round(v.equity)} className="text-[14px] font-bold"><span title={cv ? `Your ${CHAINS[unit as Chain].native} wallet plus your ${CHAINS[unit as Chain].name} coins. USD bank (${fmtUsd(v.portfolio.cash)}) not included.` : undefined}>{cv ? coin(cv.total) : money(v.equity)}</span></FlashNum>
          <div className={clsx('num text-[10px] leading-none sm:hidden', toneClass(pnlTone))}>
            {cv ? coin(cv.pnl, true) : money(pnl, true)} ({pnlTone >= 0 ? '+' : ''}{(pnlPct * 100).toFixed(2)}%)
          </div>
        </div>
        <div className="hidden sm:block text-right">
          <div className="text-[9px] uppercase tracking-wider text-dim">Total P&amp;L</div>
          <div className={clsx('num text-[12px] font-semibold', toneClass(pnlTone))}>
            {cv ? coin(cv.pnl, true) : money(pnl, true)} <span className="text-[10px] opacity-80">({pnlTone >= 0 ? '+' : ''}{(pnlPct * 100).toFixed(2)}%)</span>
          </div>
        </div>
        <WalletSelector compact className="hidden sm:block" />
        <div className="hidden xl:block">
          <WalletChip compact />
        </div>
        <div className="hidden xl:block text-right">
          <div className="text-[9px] uppercase tracking-wider text-dim">Unrealized</div>
          <div className={clsx('num text-[12px]', toneClass(cv ? cv.unrealized : v.unrealized))}>{cv ? coin(cv.unrealized, true) : money(v.unrealized, true)}</div>
        </div>
        <div className="hidden xl:block text-right">
          <div className="text-[9px] uppercase tracking-wider text-dim">Realized</div>
          <div className={clsx('num text-[12px]', toneClass(cv ? cv.realized : v.portfolio.realized))}>{cv ? coin(cv.realized, true) : money(v.portfolio.realized, true)}</div>
        </div>
        <CashbackChip />
        <AdminButton />
        <AccountButton />
      </div>

      <div className="flex items-center gap-0.5 border-l border-line pl-2">
        <div className="hidden md:block"><LevelChip /></div>
        <DockToggle />
        <button onClick={() => updateSettings({ sound: !sound })} className="rounded-md p-1.5 text-muted hover:bg-panel2 hover:text-ink" aria-label="Toggle sound" title="Sound">
          {sound ? <Volume2 size={15} /> : <VolumeX size={15} />}
        </button>
        <button onClick={() => setModal('help')} className="hidden sm:block rounded-md p-1.5 text-muted hover:bg-panel2 hover:text-ink" aria-label="Help" title="Help & shortcuts (?)">
          <CircleHelp size={15} />
        </button>
        <button onClick={() => setModal('settings')} className="rounded-md p-1.5 text-muted hover:bg-panel2 hover:text-ink" aria-label="Settings" title="Settings">
          <SettingsIcon size={15} />
        </button>
      </div>
    </div>
      {/* Tabs get their own row so the stats above can never squeeze them out of view. */}
      <nav className="no-scrollbar hidden items-center gap-0.5 overflow-x-auto border-t border-line px-2 py-1 md:flex">
        {NAV.map((n) => (
          <button
            key={n.id}
            onClick={() => setView(n.id)}
            title={`${n.label} (${n.key})`}
            className={clsx(
              'relative flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1 text-[12px] font-semibold transition-colors',
              view === n.id || (view === 'token' && n.id === (backView === 'trenches' ? 'trenches' : 'discover'))
                ? n.id === 'cooking' ? 'text-warn bg-warn/10' : 'text-accent bg-accent/5'
                : n.id === 'cooking' ? 'text-warn/80 hover:text-warn hover:bg-warn/5' : 'text-muted hover:text-ink hover:bg-panel2',
            )}
          >
            {n.label}
            {n.id === 'rewards' && rewardReady && <span className="absolute right-0.5 top-1 size-1.5 rounded-full bg-warn" />}
          </button>
        ))}
      </nav>
    </header>
  )
}
