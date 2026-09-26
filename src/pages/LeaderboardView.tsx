import clsx from 'clsx'
import { Bell, BellOff, ChevronDown, ChevronUp, Crown, Timer, X } from 'lucide-react'
import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react'
import { EmptyState, TokenIcon } from '../components/ui'
import { ChainBadge } from '../components/chain'
import { STYLE_META } from '../data/wallets'
import { useTokenMap, useValuation } from '../hooks/useDerived'
import { levelFromXp, MODES } from '../game/progression'
import { movement, retOf } from '../game/rankWatch'
import { fmtCountdown, isRanked, nextTier, placementPoints, rivalPoints, seasonEnds, seasonNumber, tierFor, TIERS, type Tier } from '../game/season'
import { useGame } from '../game/store'
import { rivalWalletId, walletStats } from '../game/walletEngine'
import { SIM_SEC_PER_TICK } from '../game/marketEngine'
import { fmtAge, fmtCompact, fmtNum, fmtPct, fmtUsd, toneClass } from '../utils/format'

type Key = 'rank' | 'name' | 'equity' | 'pnl' | 'winRate' | 'trades' | 'level'

interface Row {
  id: string
  name: string
  avatar: string
  equity: number
  pnl: number
  ret: number
  winRate: number
  trades: number
  level: number
  tier: Tier
  isYou?: boolean
  rank: number
}

const PODIUM = [
  { ring: '#f5c542', glow: 'rgba(245,197,66,0.25)', label: '1st', medal: '🥇' },
  { ring: '#c9d2dc', glow: 'rgba(201,210,220,0.18)', label: '2nd', medal: '🥈' },
  { ring: '#d08a4f', glow: 'rgba(208,138,79,0.18)', label: '3rd', medal: '🥉' },
]

export function LeaderboardView() {
  const players = useGame((s) => s.players)
  const mode = useGame((s) => s.mode)
  const xp = useGame((s) => s.profile.xp)
  const season = useGame((s) => s.profile.season)
  const badges = useGame((s) => s.profile.badges)
  const checkSeason = useGame((s) => s.checkSeason)
  const v = useValuation()
  const [key, setKey] = useState<Key>('rank')
  const [dir, setDir] = useState<1 | -1>(1)
  const [profileId, setProfileId] = useState<string | null>(null)
  const roomCode = useGame((s) => s.online?.code)
  const setView = useGame((s) => s.setView)
  useEffect(() => checkSeason(), [checkSeason])
  // Click a trader to open their wallet profile; clicking yourself opens your Portfolio.
  const open = (r: Row) => (r.isYou ? setView('portfolio') : setProfileId(r.id))

  const points = season?.id === seasonNumber() ? season.points : 0
  const myTier = tierFor(points)
  const ranked = useMemo(() => {
    const you: Omit<Row, 'rank'> = {
      id: 'you', name: 'You', avatar: '🫵', equity: v.equity, pnl: v.equity - v.portfolio.startBalance, ret: v.equity / v.portfolio.startBalance - 1,
      winRate: v.stats.winRate, trades: v.stats.tradeCount, level: levelFromXp(xp).level, tier: myTier, isYou: true,
    }
    const all: Omit<Row, 'rank'>[] = [
      you,
      ...players.map((p) => ({ id: p.id, name: p.name, avatar: p.avatar, equity: p.equity, pnl: p.equity - p.startEquity, ret: retOf(p), winRate: p.trades ? p.wins / p.trades : 0, trades: p.trades, level: p.level, tier: tierFor(rivalPoints(p)) })),
    ]
    return [...all].sort((a, b) => b.ret - a.ret).map((r, i) => ({ ...r, rank: i + 1 }))
  }, [players, v, xp, myTier])

  const rows = useMemo(() => {
    const val = (r: Row): number | string => (key === 'name' ? r.name : key === 'pnl' ? r.ret : key === 'rank' ? r.rank : r[key])
    return [...ranked].sort((a, b) => {
      const va = val(a)
      const vb = val(b)
      return (typeof va === 'string' ? va.localeCompare(vb as string) : va - (vb as number)) * dir
    })
  }, [ranked, key, dir])

  const me = ranked.find((r) => r.isYou)!
  const onSort = (k: Key) => {
    if (k === key) setDir((d) => (d === 1 ? -1 : 1))
    else {
      setKey(k)
      setDir(k === 'rank' || k === 'name' ? 1 : -1)
    }
  }
  const cols: { k: Key; label: string; right?: boolean }[] = [
    { k: 'rank', label: 'Rank' }, { k: 'name', label: 'Player' }, { k: 'equity', label: 'Portfolio', right: true }, { k: 'pnl', label: 'P&L', right: true },
    { k: 'winRate', label: 'Win rate', right: true }, { k: 'trades', label: 'Trades', right: true }, { k: 'level', label: 'Level', right: true },
  ]
  const profile = profileId ? ranked.find((r) => r.id === profileId) : undefined
  const ranked_ = isRanked(mode)
  const ifEnded = ranked_ ? placementPoints(mode, me.rank, ranked.length, false) : 0

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1400px] space-y-3 p-3">
        <SeasonHero points={points} rounds={season?.id === seasonNumber() ? season.rounds : 0} bestRank={season?.id === seasonNumber() ? season.bestRank : null} firsts={season?.id === seasonNumber() ? season.firsts : 0} badges={badges ?? []} />

        {/* Round status */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-md border border-line bg-panel px-4 py-2.5">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-dim">{MODES[mode].name} round · ranked by % return</div>
            <div className="flex items-baseline gap-2">
              <span className="font-display text-[22px] font-bold">#{me.rank}</span>
              <span className="text-[12px] text-muted">of {ranked.length}</span>
              <Move id="you" big />
            </div>
          </div>
          <div className={clsx('num text-[18px] font-bold', toneClass(me.ret))}>{fmtPct(me.ret, 2)}</div>
          <div className="text-[11px] text-dim">
            {ranked_ ? (
              <>If the round ended now: <span className="num font-bold text-warn">+{ifEnded} season pts</span></>
            ) : (
              <>Practice isn't ranked. Play <span className="text-ink">Arena</span>, <span className="text-ink">Hardcore</span> or <span className="text-ink">Challenge</span> to earn season points.</>
            )}
          </div>
          <div className="ml-auto max-w-xs text-[10px] text-dim">{roomCode ? `Room ${roomCode}: everyone here is a real player on the same market.` : 'Rivals are simulated traders on the same fictional market.'}</div>
        </div>

        <Podium rows={ranked.slice(0, 3)} onOpen={open} />
        <Rivals ranked={ranked} me={me} startBalance={v.portfolio.startBalance} onOpen={open} />

        <div className="overflow-x-auto rounded-md border border-line bg-panel">
          <table className="w-full min-w-[720px] text-[12px]">
            <thead>
              <tr className="border-b border-line">
                {cols.map((c) => (
                  <th key={c.k} onClick={() => onSort(c.k)} className={clsx('cursor-pointer select-none px-3 py-2 text-[10px] font-semibold uppercase tracking-wider hover:text-ink', c.right ? 'text-right' : 'text-left', key === c.k ? 'text-accent' : 'text-dim')}>
                    <span className="inline-flex items-center gap-0.5">{c.label}{key === c.k && (dir === 1 ? <ChevronUp size={11} /> : <ChevronDown size={11} />)}</span>
                  </th>
                ))}
                <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-dim">Track</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} onClick={() => open(r)} title={r.isYou ? 'Open your portfolio' : `View ${r.name}'s wallet`} className={clsx('cursor-pointer border-b border-line/50 transition-colors', r.isYou ? 'bg-accent/10 shadow-[inset_3px_0_0_var(--accent)]' : 'hover:bg-panel2')}>
                  <td className="px-3 py-2 num font-bold">
                    <span className="inline-flex w-14 items-center gap-1.5">
                      {r.rank <= 3 ? PODIUM[r.rank - 1].medal : <span className="text-muted">#{r.rank}</span>}
                      <Move id={r.id} />
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="grid size-7 place-items-center rounded-md bg-raise text-[14px]">{r.avatar}</span>
                      <span className={clsx('font-semibold', r.isYou && 'text-accent')}>{r.name}</span>
                      <TierChip tier={r.tier} />
                      {movement(r.id) >= 3 && <span className="text-[11px]" title="Climbing fast">🔥</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right num">{fmtUsd(r.equity, 0)}</td>
                  <td className={clsx('px-3 py-2 text-right num', toneClass(r.pnl))}>
                    {r.pnl >= 0 ? '+' : ''}{fmtUsd(r.pnl, 0)} <span className="text-[10px] opacity-80">({fmtPct(r.ret)})</span>
                  </td>
                  <td className="px-3 py-2 text-right num text-muted">{r.trades ? `${(r.winRate * 100).toFixed(0)}%` : '—'}</td>
                  <td className="px-3 py-2 text-right num text-muted">{r.trades}</td>
                  <td className="px-3 py-2 text-right"><span className="num rounded bg-raise px-1.5 py-0.5 text-[10px]">Lv {r.level}</span></td>
                  <td className="px-3 py-2 text-right">{!r.isYou && <TrackButton id={r.id} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {profile && <RivalProfile r={profile} total={ranked.length} onClose={() => setProfileId(null)} />}
    </div>
  )
}

/** Quick-track a rival's wallet: their trades show in Track and alert you. */
function TrackButton({ id, label }: { id: string; label?: boolean }) {
  const wid = rivalWalletId(id)
  const tracked = useGame((s) => s.trackedWallets.includes(wid))
  const exists = useGame((s) => s.wallets.some((w) => w.id === wid))
  const toggle = useGame((s) => s.toggleTrackWallet)
  if (!exists) return null
  const onClick = (e: MouseEvent) => {
    e.stopPropagation()
    toggle(wid)
  }
  return (
    <button
      onClick={onClick}
      title={tracked ? 'Stop tracking' : 'Track: their trades show in Track and alert you'}
      aria-label={tracked ? 'Stop tracking wallet' : 'Track wallet'}
      aria-pressed={tracked}
      className={clsx(
        'inline-flex items-center gap-1 rounded-md border font-semibold transition-colors',
        label ? 'px-2 py-0.5 text-[11px]' : 'p-1',
        tracked ? 'border-accent/50 bg-accent/10 text-accent' : 'border-line2 text-dim hover:border-accent/40 hover:text-ink',
      )}
    >
      {tracked ? <Bell size={12} /> : <BellOff size={12} />}
      {label && (tracked ? 'Tracking' : 'Track')}
    </button>
  )
}

// ─── Rival wallet profile (GMGN-style) ───────────────────────────────────────

const BUCKETS: { label: string; min: number; cls: string }[] = [
  { label: '>500%', min: 5, cls: 'bg-up' },
  { label: '200%–500%', min: 2, cls: 'bg-up/75' },
  { label: '0%–200%', min: 0, cls: 'bg-up/45' },
  { label: '0% to -50%', min: -0.5, cls: 'bg-down/55' },
  { label: '< -50%', min: -Infinity, cls: 'bg-down' },
]

function RivalProfile({ r, total, onClose }: { r: Row; total: number; onClose: () => void }) {
  const w = useGame((s) => s.wallets.find((x) => x.id === rivalWalletId(r.id)))
  const tick = useGame((s) => s.market.tick)
  const now = useGame((s) => s.market.time)
  const select = useGame((s) => s.select)
  const map = useTokenMap()
  useEffect(() => {
    // Capture phase + stop, so Escape closes the drawer instead of also leaving the Leaderboard.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const st = w ? walletStats(w, '24H', map, tick) : null
  const holdings = w
    ? Object.entries(w.positions)
        .map(([id, p]) => {
          const t = map.get(id)
          const value = t ? p.qty * t.price : 0
          return { id, t, p, value, pnl: value - p.cost, pct: p.cost > 0 ? value / p.cost - 1 : 0 }
        })
        .sort((a, b) => b.value - a.value)
    : []
  const holdValue = holdings.reduce((a, h) => a + h.value, 0)
  // PnL distribution of this session's closed trades (GMGN's buckets).
  const closed = w ? w.trades.filter((tr) => tr.side === 'sell' && tr.pnlPct !== undefined) : []
  const dist = BUCKETS.map((b, i) => ({ ...b, n: closed.filter((tr) => tr.pnlPct! >= b.min && (i === 0 || tr.pnlPct! < BUCKETS[i - 1].min)).length }))
  const wins = Math.round(r.winRate * r.trades)

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/50 fade-in" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside role="dialog" aria-label={`${r.name} wallet`} className="sheet-up flex h-full w-full max-w-[480px] flex-col border-l border-line2 bg-panel shadow-2xl md:animate-none">
        <div className="flex items-center gap-3 border-b border-line p-3" style={{ backgroundImage: `radial-gradient(circle at 0% 0%, ${r.tier.color}26, transparent 60%)` }}>
          <div className="grid size-12 place-items-center rounded-full bg-raise text-[24px]" style={{ boxShadow: `0 0 0 2px ${r.tier.color}88` }}>{r.avatar}</div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate font-display text-[17px] font-bold">{r.name}</span>
              <span className="num rounded bg-raise px-1.5 py-px text-[10px] text-muted">#{r.rank} of {total}</span>
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
              <TierChip tier={r.tier} />
              <span className="num rounded bg-raise px-1.5 py-px text-[10px] text-muted">Lv {r.level}</span>
              {w && <span className={clsx('rounded border px-1 text-[9px] font-semibold leading-[14px]', STYLE_META[w.style].cls)}>{STYLE_META[w.style].icon} {STYLE_META[w.style].label}</span>}
            </div>
          </div>
          <TrackButton id={r.id} label />
          <button onClick={onClose} className="rounded p-1 text-muted hover:bg-raise hover:text-ink" aria-label="Close"><X size={16} /></button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* Round stats (what the leaderboard ranks) */}
          <div className="grid grid-cols-3 gap-2 p-3">
            <Box label="Round P&L"><span className={toneClass(r.pnl)}>{r.pnl >= 0 ? '+' : '-'}{fmtCompact(Math.abs(r.pnl))}</span></Box>
            <Box label="Return"><span className={toneClass(r.ret)}>{fmtPct(r.ret, 2)}</span></Box>
            <Box label="Portfolio">{fmtCompact(r.equity)}</Box>
            <Box label="Win rate"><span className={r.winRate >= 0.5 ? 'text-up' : r.trades ? 'text-down' : ''}>{r.trades ? `${(r.winRate * 100).toFixed(1)}%` : '—'}</span></Box>
            <Box label="Trades"><span className="text-up">{wins}</span><span className="text-dim"> W / </span><span className="text-down">{r.trades - wins}</span><span className="text-dim"> L</span></Box>
            <Box label="Holdings">{holdings.length ? fmtCompact(holdValue) : '—'}</Box>
          </div>
          {r.trades > 0 && (
            <div className="px-3">
              <div className="flex h-1.5 overflow-hidden rounded-full bg-down/60"><div className="bg-up" style={{ width: `${r.winRate * 100}%` }} /></div>
            </div>
          )}

          {/* Wallet activity */}
          {st && (
            <div className="grid grid-cols-3 gap-2 p-3">
              <Box label="24H wallet PnL"><span className={toneClass(st.pnl)}>{st.pnl >= 0 ? '+' : '-'}{fmtCompact(Math.abs(st.pnl))}</span></Box>
              <Box label="Unrealized"><span className={toneClass(st.unrealized)}>{st.unrealized >= 0 ? '+' : '-'}{fmtCompact(Math.abs(st.unrealized))}</span></Box>
              <Box label="24H TXs"><span className="text-up">{fmtNum(st.buys)}</span>/<span className="text-down">{fmtNum(st.sells)}</span></Box>
            </div>
          )}

          <Section title={`PnL distribution${closed.length ? ` · ${closed.length} closed` : ''}`}>
            {closed.length === 0 ? (
              <div className="px-3 pb-3 text-[11px] text-dim">No closed trades yet this session.</div>
            ) : (
              <div className="space-y-1 px-3 pb-3">
                {dist.map((d) => (
                  <div key={d.label} className="flex items-center gap-2 text-[11px]">
                    <span className="w-20 text-muted">{d.label}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-line2"><div className={clsx('h-full rounded-full', d.cls)} style={{ width: `${(d.n / closed.length) * 100}%` }} /></div>
                    <span className="num w-6 text-right">{d.n}</span>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title={`Coins they're in (${holdings.length})`}>
            {holdings.length === 0 ? <EmptyState icon="💤" title="No open positions right now" /> : holdings.map((h) => (
              <button key={h.id} disabled={!h.t} onClick={() => h.t && select(h.t.id)} title={h.t ? `Open ${h.t.ticker}` : undefined} className="flex w-full items-center gap-2 border-b border-line/50 px-3 py-1.5 text-left hover:bg-panel2">
                {h.t && <TokenIcon token={h.t} size={24} />}
                <span className="min-w-0">
                  <span className="flex items-center gap-1 text-[12px] font-bold">{h.t?.ticker ?? '?'}{h.t && <ChainBadge chain={h.t.chain} />}{h.t?.status === 'rugged' && <span className="text-[9px] text-down">RUGGED</span>}</span>
                  <span className="num block text-[10px] text-dim">{h.t ? `${fmtCompact(h.t.mcap)} MC · ` : ''}held {fmtAge(Math.max(0, tick - h.p.openedTick) * SIM_SEC_PER_TICK)}</span>
                </span>
                <span className="ml-auto text-right">
                  <span className="num block text-[12px] font-semibold">{fmtUsd(h.value, h.value < 10 ? 2 : 0)}</span>
                  <span className="num block text-[10px] text-dim">cost {fmtCompact(h.p.cost)}</span>
                </span>
                <span className={clsx('num w-16 text-right text-[11px] font-semibold', toneClass(h.pct))}>{fmtPct(h.pct)}</span>
              </button>
            ))}
          </Section>

          <Section title="Recent trades">
            {!w || w.trades.length === 0 ? <EmptyState icon="📭" title="No trades this session yet" /> : w.trades.slice(0, 25).map((tr) => (
              <button key={tr.id} onClick={() => map.get(tr.tokenId) && select(tr.tokenId)} className="flex w-full items-center gap-2 border-b border-line/50 px-3 py-1.5 text-left text-[11px] hover:bg-panel2">
                <span className="num w-9 text-dim">{fmtAge(now - tr.time)}</span>
                <span className={clsx('w-8 font-semibold', tr.side === 'buy' ? 'text-up' : 'text-down')}>{tr.side === 'buy' ? 'Buy' : 'Sell'}</span>
                <TokenIcon token={{ emoji: tr.emoji, hue: tr.hue, status: 'graduated' }} size={18} />
                <span className="font-semibold">{tr.ticker}</span>
                {tr.mcap !== undefined && <span className="num text-[10px] text-dim">@ {fmtCompact(tr.mcap)}</span>}
                <span className="ml-auto num">{fmtUsd(tr.usd)}</span>
                <span className={clsx('num w-16 text-right', tr.pnl !== undefined ? toneClass(tr.pnl) : 'text-dim')}>{tr.pnl !== undefined ? `${tr.pnl >= 0 ? '+' : '-'}${fmtCompact(Math.abs(tr.pnl))}` : '—'}</span>
              </button>
            ))}
          </Section>
          <p className="px-3 py-2 text-[10px] text-dim">Rivals are simulated traders. Their wallet trades the same market you do; the round P&L above is what the leaderboard ranks.</p>
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

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-t border-line">
      <div className="px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-muted">{title}</div>
      {children}
    </div>
  )
}

function Move({ id, big }: { id: string; big?: boolean }) {
  const n = movement(id)
  if (!n) return big ? <span className="text-[11px] text-dim">— last min</span> : <span className="w-6" />
  return (
    <span className={clsx('num inline-flex items-center font-bold', n > 0 ? 'text-up' : 'text-down', big ? 'text-[12px]' : 'text-[10px]')} title="Places moved in the last minute">
      {n > 0 ? '▲' : '▼'}{Math.abs(n)}{big && <span className="ml-1 font-normal text-dim">last min</span>}
    </span>
  )
}

function TierChip({ tier }: { tier: Tier }) {
  return (
    <span className="inline-flex items-center gap-0.5 rounded px-1 py-px text-[9px] font-bold uppercase tracking-wide" style={{ color: tier.color, background: `${tier.color}1f` }} title={`${tier.name} tier`}>
      {tier.icon} {tier.name}
    </span>
  )
}

// ─── Season hero ─────────────────────────────────────────────────────────────

function SeasonHero({ points, rounds, bestRank, firsts, badges }: { points: number; rounds: number; bestRank: number | null; firsts: number; badges: { season: number; tier: Tier['id']; points: number }[] }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])
  const n = seasonNumber()
  const tier = tierFor(points)
  const next = nextTier(points)
  const pct = next ? (points - tier.min) / (next.min - tier.min) : 1
  return (
    <div className="relative overflow-hidden rounded-lg border border-line bg-panel" style={{ backgroundImage: `radial-gradient(circle at 12% 0%, ${tier.color}33, transparent 55%)` }}>
      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1.6fr)_minmax(0,0.9fr)]">
        {/* You */}
        <div className="flex items-center gap-4">
          <div className="grid size-20 shrink-0 place-items-center rounded-2xl text-[42px]" style={{ background: `${tier.color}22`, boxShadow: `0 0 0 2px ${tier.color}88, 0 0 28px -6px ${tier.color}` }}>{tier.icon}</div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-dim">
              Season {n}
              <span className="flex items-center gap-1 normal-case tracking-normal text-muted"><Timer size={11} /> ends in {fmtCountdown(seasonEnds(n).getTime() - now)}</span>
            </div>
            <div className="font-display text-[26px] font-bold leading-tight" style={{ color: tier.color }}>{tier.name}</div>
            <div className="num text-[13px] text-ink">{points} <span className="text-muted">season pts</span></div>
            <div className="mt-1.5 h-2 w-56 max-w-full overflow-hidden rounded-full bg-line2">
              <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, pct * 100)}%`, background: next?.color ?? tier.color }} />
            </div>
            <div className="mt-1 text-[11px] text-dim">{next ? <><span className="num text-ink">{next.min - points}</span> pts to {next.icon} {next.name}</> : 'Top tier reached 👑'}</div>
          </div>
        </div>

        {/* Tier ladder with end-of-season rewards */}
        <div>
          <div className="mb-1.5 text-[10px] uppercase tracking-wider text-dim">Season rewards · paid when the season ends</div>
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
            {TIERS.map((t) => {
              const reached = points >= t.min
              const current = t.id === tier.id
              return (
                <div key={t.id} className={clsx('rounded-md border px-2 py-1.5 text-center transition-opacity', current ? 'border-2' : 'border-line', !reached && 'opacity-45')} style={current ? { borderColor: t.color, background: `${t.color}14` } : undefined}>
                  <div className="text-[20px] leading-none">{t.icon}</div>
                  <div className="mt-1 text-[11px] font-bold" style={{ color: reached ? t.color : undefined }}>{t.name}</div>
                  <div className="num text-[9px] text-dim">{t.min}+ pts</div>
                  <div className="num mt-0.5 text-[10px] font-semibold text-accent">+{t.xp} XP</div>
                </div>
              )
            })}
          </div>
          <div className="mt-1.5 text-[10px] text-dim">Points per round (of 21): #1 = 125 · #5 ≈ 70 · #11 ≈ 35 · last = 5 · Hardcore ×1.3 · Challenge ×0.7 (+30 if you hit the target)</div>
        </div>

        {/* Season stats + badges */}
        <div className="grid content-start gap-2">
          <div className="grid grid-cols-3 gap-1.5 text-center">
            <Stat label="Rounds" value={rounds} />
            <Stat label="Best finish" value={bestRank ? `#${bestRank}` : '—'} />
            <Stat label="#1 finishes" value={firsts} />
          </div>
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wider text-dim">Badges</div>
            {badges.length ? (
              <div className="flex flex-wrap gap-1">
                {badges.slice(0, 10).map((b) => {
                  const t = TIERS.find((x) => x.id === b.tier) ?? TIERS[0]
                  return <span key={b.season} className="rounded px-1.5 py-0.5 text-[10px] font-bold" style={{ color: t.color, background: `${t.color}1f` }} title={`${b.points} pts`}>{t.icon} S{b.season}</span>
                })}
              </div>
            ) : (
              <div className="text-[11px] text-dim">Finish a season in a tier to earn its badge.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-md border border-line bg-bg/50 px-2 py-1.5">
      <div className="num text-[16px] font-bold">{value}</div>
      <div className="text-[9px] uppercase tracking-wider text-dim">{label}</div>
    </div>
  )
}

// ─── Podium ──────────────────────────────────────────────────────────────────

function Podium({ rows, onOpen }: { rows: Row[]; onOpen: (r: Row) => void }) {
  // 2nd · 1st · 3rd, with 1st raised.
  const order = [rows[1], rows[0], rows[2]].filter(Boolean)
  return (
    <div className="grid items-end gap-3 sm:grid-cols-3">
      {order.map((r) => {
        const p = PODIUM[r.rank - 1]
        const first = r.rank === 1
        return (
          <div
            key={r.id}
            role="button"
            tabIndex={0}
            onClick={() => onOpen(r)}
            onKeyDown={(e) => e.key === 'Enter' && onOpen(r)}
            title={r.isYou ? 'Open your portfolio' : `View ${r.name}'s wallet`}
            className={clsx('relative cursor-pointer overflow-hidden rounded-lg border bg-panel text-center transition-transform hover:-translate-y-0.5', first ? 'pb-5 pt-6 sm:order-none' : 'pb-4 pt-4', r.isYou && 'ring-2 ring-accent')}
            style={{ borderColor: `${p.ring}66`, backgroundImage: `radial-gradient(circle at 50% -10%, ${p.glow}, transparent 70%)` }}
          >
            <div className="absolute left-3 top-2.5 font-display text-[12px] font-bold" style={{ color: p.ring }}>{p.label}</div>
            <div className="absolute right-3 top-2 flex items-center gap-1.5"><Move id={r.id} />{!r.isYou && <TrackButton id={r.id} label />}</div>
            {first && <Crown size={22} className="mx-auto -mt-2 mb-0.5" style={{ color: p.ring }} fill={p.ring} />}
            <div className={clsx('mx-auto grid place-items-center rounded-full bg-raise', first ? 'size-20 text-[40px]' : 'size-16 text-[32px]')} style={{ boxShadow: `0 0 0 3px ${p.ring}, 0 0 30px -4px ${p.ring}` }}>{r.avatar}</div>
            <div className={clsx('mt-2 truncate px-3 font-bold', first ? 'text-[17px]' : 'text-[15px]', r.isYou && 'text-accent')}>{r.name}</div>
            <div className="mt-0.5 flex items-center justify-center gap-1.5">
              <TierChip tier={r.tier} />
              <span className="num rounded bg-raise px-1.5 py-px text-[10px] text-muted">Lv {r.level}</span>
            </div>
            <div className={clsx('num mt-2 font-bold', first ? 'text-[26px]' : 'text-[22px]', toneClass(r.ret))}>{fmtPct(r.ret, 2)}</div>
            <div className={clsx('num text-[12px]', toneClass(r.pnl))}>{r.pnl >= 0 ? '+' : ''}{fmtUsd(r.pnl, 0)}</div>
            <div className="mx-auto mt-2 flex max-w-[220px] justify-around text-[10px] text-dim">
              <span><span className="num block text-[12px] text-ink">{r.trades ? `${(r.winRate * 100).toFixed(0)}%` : '—'}</span>win rate</span>
              <span><span className="num block text-[12px] text-ink">{r.trades}</span>trades</span>
              <span><span className="num block text-[12px] text-ink">{fmtUsd(r.equity, 0)}</span>portfolio</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Rivals around you ───────────────────────────────────────────────────────

function Rivals({ ranked, me, startBalance, onOpen }: { ranked: Row[]; me: Row; startBalance: number; onOpen: (r: Row) => void }) {
  const above = ranked.filter((r) => r.rank < me.rank).slice(-2)
  const below = ranked.filter((r) => r.rank > me.rank).slice(0, 2)
  if (!above.length && !below.length) return null
  return (
    <div className="rounded-md border border-line bg-panel p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-[12px] font-bold">Your race</span>
        <span className="text-[10px] text-dim">{me.rank === 1 ? 'You lead the round. Hold it.' : `Pass ${ranked[me.rank - 2].name} to move up to #${me.rank - 1}`}</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {above.map((r) => <RivalCard key={r.id} r={r} gap={r.ret - me.ret} startBalance={startBalance} kind="ahead" onOpen={onOpen} />)}
        <div className="flex flex-col justify-center rounded-md border-2 border-accent/60 bg-accent/10 p-2.5">
          <div className="flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-md bg-raise text-[16px]">{me.avatar}</span>
            <div>
              <div className="text-[12px] font-bold text-accent">You · #{me.rank}</div>
              <div className={clsx('num text-[12px] font-semibold', toneClass(me.ret))}>{fmtPct(me.ret, 2)}</div>
            </div>
            <span className="ml-auto"><Move id="you" /></span>
          </div>
        </div>
        {below.map((r) => <RivalCard key={r.id} r={r} gap={me.ret - r.ret} startBalance={startBalance} kind="behind" onOpen={onOpen} />)}
      </div>
    </div>
  )
}

function RivalCard({ r, gap, startBalance, kind, onOpen }: { r: Row; gap: number; startBalance: number; kind: 'ahead' | 'behind'; onOpen: (r: Row) => void }) {
  return (
    <div role="button" tabIndex={0} onClick={() => onOpen(r)} onKeyDown={(e) => e.key === 'Enter' && onOpen(r)} title={`View ${r.name}'s wallet`} className="cursor-pointer rounded-md border border-line bg-bg/40 p-2.5 transition-colors hover:border-line2 hover:bg-panel2">
      <div className="flex items-center gap-2">
        <span className="grid size-8 place-items-center rounded-md bg-raise text-[16px]">{r.avatar}</span>
        <div className="min-w-0">
          <div className="truncate text-[12px] font-semibold">#{r.rank} {r.name}</div>
          <div className={clsx('num text-[11px]', toneClass(r.ret))}>{fmtPct(r.ret, 2)}</div>
        </div>
        <span className="ml-auto flex items-center gap-1"><Move id={r.id} /><TrackButton id={r.id} /></span>
      </div>
      <div className="mt-1.5 text-[10px] text-dim">
        {kind === 'ahead' ? (
          <>Ahead by <span className="num font-semibold text-warn">{(gap * 100).toFixed(2)}%</span> · <span className="num text-ink">{fmtUsd(gap * startBalance, 0)}</span> more to pass</>
        ) : (
          <>Your lead <span className="num font-semibold text-up">{(gap * 100).toFixed(2)}%</span> · <span className="num text-ink">{fmtUsd(gap * startBalance, 0)}</span> cushion</>
        )}
      </div>
    </div>
  )
}
