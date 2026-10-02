// World leaderboards: everyone in the World (online or not, bots labeled) by net worth and by this week's profit,
// where you stand, and the bankruptcy restart for when you're broke.
import clsx from 'clsx'
import { RotateCcw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useValuation } from '../hooks/useDerived'
import { fmtCountdown, seasonEnds } from '../game/season'
import { useGame } from '../game/store'
import { WORLD_BROKE_BELOW, WORLD_RESTART_BALANCE, type BoardRow } from '../net/protocol'
import { useWorldBoard } from '../net/worldBoard'
import { fmtUsd, toneClass } from '../utils/format'
import { EmptyState } from './ui'

const signed = (n: number) => `${n >= 0 ? '+' : '-'}${fmtUsd(Math.abs(n), Math.abs(n) < 100 ? 2 : 0)}`
const MEDAL = ['🥇', '🥈', '🥉']

export function WorldBoard() {
  const board = useWorldBoard((s) => s.board)
  const you = useGame((s) => s.online?.you)
  const spectator = useGame((s) => !!s.online?.spectator)
  const send = useGame((s) => s.requestBoard)
  const [tab, setTab] = useState<'worth' | 'week'>('worth')
  const [now, setNow] = useState(() => Date.now())
  // Ask on open, then every 10s while this page is showing.
  useEffect(() => {
    send()
    const id = setInterval(() => {
      send()
      setNow(Date.now())
    }, 10_000)
    return () => clearInterval(id)
  }, [send])

  if (!board) return <EmptyState icon="🌍" title="Loading the World leaderboards…" />
  const rows = tab === 'worth' ? board.worth : board.weekly
  const me = board.me
  const myRank = me ? (tab === 'worth' ? me.worthRank : me.weekRank) : 0
  const inList = !!me && rows.some((r) => r.id === me.row.id)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md border border-line bg-panel px-4 py-2.5">
        {me ? (
          <>
            <Stat label="Net worth rank" value={`#${me.worthRank}`} sub={`of ${board.total}`} />
            <Stat label="This week" value={`#${me.weekRank}`} sub={signed(me.row.week)} tone={me.row.week} />
            <Stat label="Net worth" value={fmtUsd(me.row.equity, 0)} />
            <Stat label="All-time profit" value={signed(me.row.pnl)} tone={me.row.pnl} />
          </>
        ) : (
          <span className="text-[12px] text-muted">{spectator ? 'You are watching as a guest. Sign in to get a wallet and a place on the board.' : 'Make a trade to get on the board.'}</span>
        )}
        <span className="ml-auto text-right text-[10px] text-dim">
          Week {board.week} · resets the weekly list in {fmtCountdown(seasonEnds().getTime() - now)}
          <br />
          {board.total} traders ranked · bots are labeled 🤖
        </span>
      </div>

      {me && <RestartBar restartAt={me.restartAt} now={now} />}

      <div className="flex items-center gap-1">
        {([['worth', '💰 Net worth (all time)'], ['week', '📈 This week\'s profit']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} className={clsx('rounded-md border px-3 py-1 text-[12px] font-bold', tab === id ? 'border-accent/60 bg-accent/10 text-accent' : 'border-line2 text-muted hover:text-ink')}>{label}</button>
        ))}
        <span className="ml-2 text-[11px] text-dim">{tab === 'worth' ? 'Everything you hold, valued now.' : 'Profit since Monday (deposits and gifts don\'t count).'}</span>
      </div>

      <div className="overflow-hidden rounded-md border border-line bg-panel">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-line text-left text-[10px] uppercase tracking-wider text-dim">
              <th className="w-14 px-3 py-2">Rank</th>
              <th className="px-2 py-2">Trader</th>
              <th className="px-2 py-2 text-right">Net worth</th>
              <th className="px-2 py-2 text-right">This week</th>
              <th className="hidden px-2 py-2 text-right sm:table-cell">All-time profit</th>
              <th className="hidden px-3 py-2 text-right md:table-cell">Restarts</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => <Line key={r.id} r={r} rank={i + 1} you={r.id === you} />)}
            {me && !inList && (
              <>
                <tr><td colSpan={6} className="border-t border-line px-3 py-1 text-center text-[10px] text-dim">· · ·</td></tr>
                <Line r={me.row} rank={myRank} you />
              </>
            )}
          </tbody>
        </table>
        {!rows.length && <div className="p-6 text-center text-[12px] text-dim">Nobody on the board yet.</div>}
      </div>
    </div>
  )
}

function Line({ r, rank, you }: { r: BoardRow; rank: number; you: boolean }) {
  return (
    <tr className={clsx('border-t border-line/60', you && 'bg-accent/5')}>
      <td className="num px-3 py-2 font-bold">{MEDAL[rank - 1] ?? `#${rank}`}</td>
      <td className="px-2 py-2">
        <span className="flex items-center gap-2">
          <span className="relative grid size-7 shrink-0 place-items-center rounded-md bg-raise text-[15px]">
            {r.avatar}
            <span className={clsx('absolute -bottom-0.5 -right-0.5 size-2 rounded-full ring-2 ring-panel', r.online ? 'bg-up' : 'bg-line2')} title={r.online ? 'Online' : 'Offline'} />
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-1 font-semibold">
              <span className="truncate">{r.name}</span>
              {r.verified && <span className="text-[10px] font-bold text-up" title="Signed in">✓</span>}
              {r.bot && <span className="rounded bg-raise px-1 text-[9px] font-bold text-muted" title="A bot player: trades by the same rules as you">BOT</span>}
              {you && <span className="text-[10px] text-accent">(you)</span>}
            </span>
            <span className="text-[10px] text-dim">Lv {r.level}</span>
          </span>
        </span>
      </td>
      <td className="num px-2 py-2 text-right font-bold">{fmtUsd(r.equity, 0)}</td>
      <td className={clsx('num px-2 py-2 text-right font-semibold', toneClass(r.week))}>{signed(r.week)}</td>
      <td className={clsx('num hidden px-2 py-2 text-right sm:table-cell', toneClass(r.pnl))}>{signed(r.pnl)}</td>
      <td className="num hidden px-3 py-2 text-right text-muted md:table-cell">{r.restarts || '—'}</td>
    </tr>
  )
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: number }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-dim">{label}</div>
      <div className="flex items-baseline gap-1.5">
        <span className={clsx('num font-display text-[18px] font-bold', tone !== undefined && toneClass(tone))}>{value}</span>
        {sub && <span className={clsx('num text-[11px]', tone !== undefined ? toneClass(tone) : 'text-muted')}>{sub}</span>}
      </div>
    </div>
  )
}

/** Shown when you're broke: start over with the restart balance, once a day. */
export function RestartBar({ restartAt, now }: { restartAt: number | null; now: number }) {
  const v = useValuation()
  const bankrupt = useGame((s) => s.bankruptRestart)
  const [confirm, setConfirm] = useState(false)
  if (v.equity >= WORLD_BROKE_BELOW) return null
  const wait = restartAt ? restartAt - now : 0
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-warn/40 bg-warn/10 px-4 py-2.5 text-[12px]">
      <span className="text-[20px]">💀</span>
      <div className="min-w-0 flex-1">
        <div className="font-bold text-warn">You're broke ({fmtUsd(v.equity)} left)</div>
        <div className="text-muted">
          {wait > 0
            ? `You already restarted today. Next restart in ${fmtCountdown(wait)}.`
            : `Start over with ${fmtUsd(WORLD_RESTART_BALANCE, 0)}. Your wallet is wiped, your losses stay on your record, and you can only do this once every 24 hours.`}
        </div>
      </div>
      {wait <= 0 && (confirm ? (
        <span className="flex gap-1.5">
          <button onClick={() => { bankrupt(); setConfirm(false) }} className="h-8 rounded-md bg-warn px-3 text-[12px] font-bold text-black">Yes, restart with {fmtUsd(WORLD_RESTART_BALANCE, 0)}</button>
          <button onClick={() => setConfirm(false)} className="h-8 rounded-md border border-line2 px-3 text-[12px] text-muted">Cancel</button>
        </span>
      ) : (
        <button onClick={() => setConfirm(true)} className="flex h-8 items-center gap-1.5 rounded-md border border-warn/60 px-3 text-[12px] font-bold text-warn hover:bg-warn/10"><RotateCcw size={13} /> Restart</button>
      ))}
    </div>
  )
}

/** A strip across the top when you're broke in the World, pointing at the restart (it lives on the Leaderboard). */
export function BrokeBanner() {
  const inWorld = useGame((s) => !!s.online?.round.world && !s.online.spectator && s.runStatus === 'running')
  const view = useGame((s) => s.view)
  const setView = useGame((s) => s.setView)
  const v = useValuation()
  if (!inWorld || v.equity >= WORLD_BROKE_BELOW || view === 'leaderboard') return null
  return (
    <div className="flex flex-wrap items-center justify-center gap-2 border-b border-warn/40 bg-warn/10 px-3 py-1.5 text-[12px]">
      <span>💀 You're down to <b>{fmtUsd(v.equity)}</b>.</span>
      <span className="text-muted">You can start over with {fmtUsd(WORLD_RESTART_BALANCE, 0)} once every 24 hours.</span>
      <button onClick={() => setView('leaderboard')} className="rounded border border-warn/60 px-2 py-0.5 text-[11px] font-bold text-warn hover:bg-warn/10">Restart…</button>
    </div>
  )
}
