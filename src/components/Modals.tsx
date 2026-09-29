import clsx from 'clsx'
import { Lock, RotateCcw, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { lengthTicks, levelFromXp, modeTagline, MODES, ROUND_LENGTHS } from '../game/progression'
import { useGame } from '../game/store'
import type { GameMode, MarketEngine } from '../types'
import { fmtClock, fmtPct, fmtUsd, toneClass } from '../utils/format'
import { Logo } from './TopBar'
import { Kbd, Modal, Segmented, Toggle } from './ui'
import { LobbyModal } from './Multiplayer'
import { useFlags } from '../game/flags'
import { useAccount } from '../net/account'

const MODE_ICON: Record<GameMode, string> = { practice: '🧪', challenge: '🎯', arena: '⚔️', hardcore: '☠️' }

export function Modals() {
  const modal = useGame((s) => s.modal)
  if (modal === 'mode') return <ModeModal />
  if (modal === 'results') return <ResultsModal />
  if (modal === 'settings') return <SettingsModal />
  if (modal === 'help') return <HelpModal />
  if (modal === 'lobby') return <LobbyModal />
  return null
}

function ModeModal() {
  const runStatus = useGame((s) => s.runStatus)
  const mode = useGame((s) => s.mode)
  const xp = useGame((s) => s.profile.xp)
  const practiceBalance = useGame((s) => s.settings.practiceBalance)
  const startRun = useGame((s) => s.startRun)
  const setModal = useGame((s) => s.setModal)
  const roundLength = useGame((s) => s.roundLength)
  const setRoundLength = useGame((s) => s.setRoundLength)
  const endRun = useGame((s) => s.endRun)
  const runTicks = useGame((s) => s.runTicks)
  const level = levelFromXp(xp).level
  const [confirm, setConfirm] = useState<GameMode | null>(null)
  const [confirmEnd, setConfirmEnd] = useState(false)
  const closable = runStatus !== 'select'

  const mpOn = useFlags((s) => s.multiplayer)
  const isAdmin = useAccount((s) => s.admin)
  const choose = (m: GameMode) => {
    if (runStatus === 'running' && !confirm) return setConfirm(m)
    startRun(m)
  }

  return (
    <Modal title={<Logo />} onClose={() => setModal(null)} wide closable={closable}>
      <div className="mb-4">
        <h2 className="font-display text-[22px] font-bold leading-tight">Pick your arena.</h2>
        <p className="mt-1 text-[12px] text-muted">
          Trade fictional memecoins in a live simulated market. Spot momentum, dodge rugs, climb the board. <span className="text-dim">Virtual money only: nothing here is real.</span>
        </p>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[11px] font-semibold text-muted">Round length</span>
        {ROUND_LENGTHS.map((o) => (
          <button
            key={String(o.value)}
            onClick={() => setRoundLength(o.value)}
            aria-pressed={roundLength === o.value}
            className={clsx('rounded-md border px-2.5 py-1 text-[11px] font-semibold transition-colors', roundLength === o.value ? 'border-accent/60 bg-accent/10 text-accent' : 'border-line2 text-muted hover:text-ink')}
          >
            {o.label}
          </button>
        ))}
      </div>
      {/* The shared claude.ai copy has no game server behind it, so it's solo only (built with VITE_NO_MP=1). */}
      {!import.meta.env.VITE_NO_MP && (mpOn || isAdmin) && <button onClick={() => setModal('lobby')} className="mb-3 flex w-full items-center gap-3 rounded-lg border border-accent/40 bg-accent/5 p-3 text-left transition-all hover:-translate-y-0.5 hover:bg-accent/10">
        <span className="text-[22px]">👥</span>
        <span>
          <span className="block font-display text-[15px] font-bold text-accent">Play with friends</span>
          <span className="block text-[11px] text-muted">Create or join a room with a code. Same live market, real rivals, trade against each other.</span>
        </span>
        <span className="ml-auto rounded bg-accent/15 px-1.5 py-0.5 text-[9px] font-bold text-accent">NEW</span>
      </button>}
      <EnginePicker />
      <div className="grid gap-2 sm:grid-cols-2">
        {(Object.keys(MODES) as GameMode[]).map((m) => {
          const cfg = MODES[m]
          const locked = level < cfg.unlockLevel
          const bal = m === 'practice' ? practiceBalance : cfg.startBalance
          const ticks = lengthTicks(m, roundLength)
          return (
            <button
              key={m}
              disabled={locked}
              onClick={() => choose(m)}
              className={clsx(
                'group relative rounded-lg border p-3 text-left transition-all',
                locked ? 'cursor-not-allowed border-line opacity-50' : 'border-line2 bg-panel2 hover:-translate-y-0.5 hover:border-accent/60 hover:bg-raise',
                confirm === m && 'border-warn',
              )}
            >
              <div className="flex items-center gap-2">
                <span className="text-[22px]">{MODE_ICON[m]}</span>
                <div>
                  <div className="font-display text-[15px] font-bold">{cfg.name}</div>
                  <div className="num text-[11px] text-accent">{fmtUsd(bal, 0)} · {ticks ? (ticks >= 3600 ? `${ticks / 3600}:00:00` : fmtClock(ticks)) : 'no timer'}</div>
                </div>
                {locked && <span className="ml-auto flex items-center gap-1 text-[10px] text-muted"><Lock size={11} /> Lv {cfg.unlockLevel}</span>}
                {!locked && mode === m && runStatus === 'running' && <span className="ml-auto rounded bg-accent/15 px-1.5 text-[9px] font-bold text-accent">CURRENT</span>}
              </div>
              <p className="mt-2 text-[11px] text-muted">{modeTagline(m, ticks)}</p>
              {confirm === m && <p className="mt-2 text-[11px] font-semibold text-warn">Click again to abandon your current round and start fresh.</p>}
            </button>
          )
        })}
      </div>
      <div className="mt-4 grid gap-2 rounded-md border border-line bg-bg p-3 text-[11px] text-muted sm:grid-cols-3">
        <div><span className="text-ink font-semibold">Read the tape.</span> Momentum, volume and buy/sell pressure drive prices. Moves persist, then revert.</div>
        <div><span className="text-ink font-semibold">Mind the risk.</span> Thin liquidity means slippage. Warning events often come before a rug.</div>
        <div><span className="text-ink font-semibold">Go fast.</span> <Kbd>/</Kbd> search, <Kbd>B</Kbd> buy, <Kbd>S</Kbd> sell, <Kbd>↵</Kbd> confirm, <Kbd>?</Kbd> help.</div>
      </div>
      {runStatus === 'running' && (
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
          {confirmEnd && (
            <span className="text-[11px] text-warn">
              End your {MODES[mode].name} round now and see results?{runTicks < 300 ? ' Rounds under 5 minutes earn no round bonus.' : ''}
            </span>
          )}
          <button
            onClick={() => (confirmEnd ? endRun() : setConfirmEnd(true))}
            className={clsx('rounded-md border px-3 py-1.5 text-[11px] font-bold', confirmEnd ? 'border-warn bg-warn/15 text-warn' : 'border-line2 text-muted hover:text-ink')}
          >
            {confirmEnd ? 'Yes, end round' : 'End round'}
          </button>
        </div>
      )}
    </Modal>
  )
}

/** Classic (fast-forward, regime-driven) or Realistic (real-time, pump.fun order flow) market for your next round. */
export function EnginePicker({ value, onChange }: { value?: MarketEngine; onChange?: (e: MarketEngine) => void } = {}) {
  const saved = useGame((s) => s.settings.engine ?? 'classic')
  const current = useGame((s) => s.market.engine ?? 'classic')
  const update = useGame((s) => s.updateSettings)
  const engine = value ?? saved
  const pick = onChange ?? ((e: MarketEngine) => update({ engine: e }))
  return (
    <div className="mb-3 rounded-md border border-line2 bg-bg p-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold text-muted">Market</span>
        <Segmented value={engine} onChange={pick} options={[{ value: 'classic', label: '⏩ Classic' }, { value: 'realistic', label: '💊 Realistic pump.fun' }]} />
        {!value && engine !== current && <span className="text-[10px] text-warn">Starts fresh with your next round</span>}
      </div>
      <p className="mt-1 text-[10px] text-dim">
        {engine === 'realistic'
          ? 'Real-time clock. pump.fun coins launch ~24/min and trade by real order flow: $10–$50 trades, most coins dead in a minute, ~3% graduate. Other launchpads stay classic.'
          : 'Fast-forward clock (1 second = 6 in-game seconds) with simulated price moods. More action per minute.'}
      </p>
    </div>
  )
}

function ResultsModal() {
  const r = useGame((s) => s.result)
  const startRun = useGame((s) => s.startRun)
  const setModal = useGame((s) => s.setModal)
  const online = useGame((s) => !!s.online)
  if (!r) return null
  const cfg = MODES[r.mode]
  return (
    <Modal title={`${cfg.name} — round over`} onClose={() => setModal(null)}>
      <div className="text-center">
        <div className="text-[44px] leading-none">{r.won ? (r.rank === 1 ? '🏆' : '🚀') : '💀'}</div>
        <div className={clsx('mt-2 font-display text-[22px] font-bold', r.won ? 'text-up' : 'text-down')}>{r.won ? 'GG — you made it' : 'Rekt (virtually)'}</div>
        <div className="text-[12px] text-muted">{r.reason}</div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 text-[11px]">
        <Cell label="Final equity" value={fmtUsd(r.finalEquity)} />
        <Cell label="Return" value={fmtPct(r.returnPct, 2)} tone={r.returnPct} />
        <Cell label="Rank" value={`#${r.rank} of ${r.field}`} />
        <Cell label="Trades / win rate" value={`${r.trades} · ${(r.winRate * 100).toFixed(0)}%`} />
      </div>
      {r.xpBonus > 0 && <div className="mt-3 rounded-md border border-accent/30 bg-accent/10 p-2 text-center text-[12px] font-bold text-accent">+{r.xpBonus} XP round bonus</div>}
      {(r.seasonPoints ?? 0) > 0 && <div className="mt-2 rounded-md border border-warn/30 bg-warn/10 p-2 text-center text-[12px] font-bold text-warn">+{r.seasonPoints} season points · see Leaderboard</div>}
      {online ? (
        // Online, the host starts the next round for everyone.
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button onClick={() => setModal('lobby')} className="h-10 rounded-md bg-accent font-bold text-accent-ink hover:brightness-110">Back to the room</button>
          <button onClick={() => setModal(null)} className="h-10 rounded-md border border-line2 font-semibold hover:bg-raise">Watch the market</button>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button onClick={() => startRun(r.mode)} className="h-10 rounded-md bg-accent font-bold text-accent-ink hover:brightness-110">Play again</button>
          <button onClick={() => setModal('mode')} className="h-10 rounded-md border border-line2 font-semibold hover:bg-raise">Change mode</button>
        </div>
      )}
    </Modal>
  )
}

function Cell({ label, value, tone }: { label: string; value: string; tone?: number }) {
  return (
    <div className="rounded-md border border-line bg-bg p-2">
      <div className="text-[9px] uppercase tracking-wider text-dim">{label}</div>
      <div className={clsx('num text-[14px] font-bold', tone !== undefined && toneClass(tone))}>{value}</div>
    </div>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <div>
        <div className="text-[12px] font-semibold">{label}</div>
        {hint && <div className="text-[10px] text-dim">{hint}</div>}
      </div>
      {children}
    </div>
  )
}

function SettingsModal() {
  const settings = useGame((s) => s.settings)
  const update = useGame((s) => s.updateSettings)
  const setModal = useGame((s) => s.setModal)
  const resetGame = useGame((s) => s.resetGame)
  const resetProgress = useGame((s) => s.resetProgress)
  const [confirm, setConfirm] = useState<null | 'game' | 'all'>(null)
  const online = useGame((s) => !!s.online)
  const realTime = useGame((s) => !!s.online || s.market.engine === 'realistic')

  return (
    <Modal title="Settings" onClose={() => setModal(null)}>
      <div className="divide-y divide-line">
        <Row label="Sound effects" hint="Synth blips for trades, alerts and level-ups"><Toggle label="Sound" on={settings.sound} onChange={(v) => update({ sound: v })} /></Row>
        <Row label="Animations" hint="Price flashes, slide-ins, marquee"><Toggle label="Animations" on={settings.animations} onChange={(v) => update({ animations: v })} /></Row>
        <Row label="Compact mode" hint="Denser rows and smaller type"><Toggle label="Compact mode" on={settings.compact} onChange={(v) => update({ compact: v })} /></Row>
        <Row label="Notifications" hint="All pop-up toasts (trades, alerts, events)"><Toggle label="Notifications" on={settings.notifications} onChange={(v) => update({ notifications: v })} /></Row>
        <Row label="Open coin after quick buy" hint="Like GMGN: off keeps you on the list, on jumps to the coin's page"><Toggle label="Open coin after quick buy" on={!!settings.quickBuyOpen} onChange={(v) => update({ quickBuyOpen: v })} /></Row>
        <Row label="Market event pop-ups" hint="Parabolic runs, whales, KOLs, market moves. Off still warns if your bag rugs"><Toggle label="Market event pop-ups" on={settings.eventToasts !== false} onChange={(v) => update({ eventToasts: v })} /></Row>
        <Row label="Auto-swap when short" hint="Top up SOL / BNB / ETH from USD if a buy needs more"><Toggle label="Auto-swap" on={settings.autoSwap} onChange={(v) => update({ autoSwap: v })} /></Row>
        <Row label="Show portfolio in" hint="Top bar: portfolio, P&L, realized / unrealized">
          <Segmented value={settings.portfolioUnit ?? 'usd'} onChange={(v) => update({ portfolioUnit: v })} options={[{ value: 'usd', label: 'USD' }, { value: 'sol', label: 'SOL' }, { value: 'bsc', label: 'BNB' }, { value: 'hood', label: 'ETH' }]} />
        </Row>
        <Row label="Chart style">
          <Segmented value={settings.chartStyle} onChange={(v) => update({ chartStyle: v })} options={[{ value: 'candles', label: 'Candles' }, { value: 'line', label: 'Line' }]} />
        </Row>
        <div className="py-2.5"><EnginePicker /></div>
        <Row label="Market speed" hint={realTime ? 'Realistic markets and rooms always run in real time' : 'Timers scale with speed'}>
          <div className={clsx(realTime && 'pointer-events-none opacity-40')}>
            <Segmented value={settings.speed} onChange={(v) => update({ speed: v })} options={[{ value: 1, label: '1×' }, { value: 2, label: '2×' }, { value: 4, label: '4×' }]} />
          </div>
        </Row>
        <Row label="Practice starting balance" hint="Applies to your next Practice round">
          <select value={settings.practiceBalance} onChange={(e) => update({ practiceBalance: Number(e.target.value) })} className="num rounded-md border border-line2 bg-bg px-2 py-1 text-[12px] outline-none focus:border-accent/60" aria-label="Starting balance">
            {[10_000, 25_000, 50_000, 100_000, 250_000, 1_000_000].map((b) => <option key={b} value={b}>{fmtUsd(b, 0)}</option>)}
          </select>
        </Row>
      </div>

      <div className="mt-3 rounded-md border border-down/30 bg-down/5 p-3">
        <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-down"><TriangleAlert size={12} /> Danger zone</div>
        {online ? (
          // The market is shared in a room, so resetting here would only break your side of it.
          <p className="mt-2 text-[12px] text-muted">
            You're in a room. To start over, the host starts a new round (fresh market, everyone's balance reset) from the room chip. To reset your solo game, leave the room first.
          </p>
        ) : confirm ? (
          <div className="mt-2">
            <p className="text-[12px]">{confirm === 'game' ? 'Reset the market, your balance, positions and history? XP and level are kept.' : 'Erase EVERYTHING including XP, level and unlocks?'}</p>
            <div className="mt-2 flex gap-2">
              <button onClick={() => { if (confirm === 'game') resetGame(); else resetProgress() }} className="rounded-md bg-down px-3 py-1.5 text-[12px] font-bold text-white hover:brightness-110">Yes, reset</button>
              <button onClick={() => setConfirm(null)} className="rounded-md border border-line2 px-3 py-1.5 text-[12px] hover:bg-raise">Cancel</button>
            </div>
          </div>
        ) : (
          <div className="mt-2 flex flex-wrap gap-2">
            <button onClick={() => setConfirm('game')} className="flex items-center gap-1 rounded-md border border-down/40 px-3 py-1.5 text-[12px] font-semibold text-down hover:bg-down/10"><RotateCcw size={12} /> Reset game</button>
            <button onClick={() => setConfirm('all')} className="rounded-md border border-line2 px-3 py-1.5 text-[12px] text-muted hover:text-down">Reset all progress</button>
          </div>
        )}
      </div>
    </Modal>
  )
}

function HelpModal() {
  const setModal = useGame((s) => s.setModal)
  const keys: [string, string][] = [
    ['/', 'Search token / CA / wallet'], ['N', 'Sniper'], ['↑ ↓ ↵', 'Move through table / open token'], ['B', 'Buy panel'], ['S', 'Sell panel'], ['↵', 'Confirm trade (in amount box)'],
    ['F', 'Star / unstar token'], ['I', 'Instant trade panel'], ['W', 'Watchlist panel'], ['D', 'Discover'], ['C', 'Cooking (launch a token)'], ['Y', 'CopyTrade'], ['O', 'Monitor (smart money flows)'], ['K', 'Track (wallets, calls, alerts, X/TG)'], ['R', 'Rewards (referrals, cashback, check-in)'], ['T', 'Trenches'], ['P', 'Portfolio'], ['M', 'Missions'], ['L', 'Leaderboard'],
    ['Space', 'Pause market'], ['Esc', 'Close / back'], ['?', 'This help'],
  ]
  return (
    <Modal title="How to play" onClose={() => setModal(null)} wide>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2 text-[12px] text-muted">
          <p><span className="font-semibold text-ink">MOONRUSH is a game.</span> Every token, price, trade, wallet and rival is simulated. No wallets, no blockchain, no real money.</p>
          <p><span className="font-semibold text-ink">The market has memory.</span> Tokens move through regimes (accumulation, pumps, distribution, dumps, recoveries), so moves tend to persist. Stretched prices tend to revert.</p>
          <p><span className="font-semibold text-ink">Liquidity is everything.</span> Fills use a constant-product pool: size up in a thin pool and slippage will eat you. There's a 1% arena fee on every trade.</p>
          <p><span className="font-semibold text-ink">Rugs happen.</span> High-risk tokens (concentrated holders, big dev bags, thin liquidity) can collapse. ⚠️ liquidity warnings and 🧑‍💻 dev sells often come first.</p>
          <p><span className="font-semibold text-ink">Graduation.</span> New tokens start on a bonding curve and graduate once their launchpad's curve sells out (around $50–120K market cap depending on the pad), then trade in a DEX pool.</p>
          <p><span className="font-semibold text-ink">Progress.</span> Earn XP from profitable trades, early discoveries, missions and milestones. Levels unlock themes and Hardcore mode.</p>
        </div>
        <div>
          <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted">Keyboard</div>
          <ul className="space-y-1">
            {keys.map(([k, d]) => (
              <li key={k} className="flex items-center justify-between text-[12px]">
                <span className="text-muted">{d}</span>
                <Kbd>{k}</Kbd>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Modal>
  )
}
