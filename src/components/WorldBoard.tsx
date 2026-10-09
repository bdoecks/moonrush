// World leaderboards: everyone in the World (online or not, bots labeled), ranked by net worth, today's / this
// week's / this season's profit, profit on each chain, and the best devs. Seasons are calendar months: when one ends,
// the winners get a trophy next to their name and a place in the Hall of Fame.
import clsx from 'clsx'
import { RotateCcw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useValuation } from '../hooks/useDerived'
import { fmtCountdown, seasonEnds } from '../game/season'
import { dayEndsAt } from '../game/worldSeason'
import { useGame } from '../game/store'
import { useOpenPlayer } from './PlayerCard'
import { WORLD_BROKE_BELOW, WORLD_RESTART_BALANCE, worldStartOf, type BoardList, type BoardRow, type HallEntry } from '../net/protocol'
import { nextWorldRank, WORLD_RANKS, worldRank } from '../game/worldRank'
import { useWorldBoard } from '../net/worldBoard'
import { fmtCompact, fmtUsd, toneClass } from '../utils/format'
import { load, save } from '../utils/storage'
import { EmptyState } from './ui'

const signed = (n: number) => `${n >= 0 ? '+' : '-'}${Math.abs(n) >= 100_000 ? fmtCompact(Math.abs(n)) : fmtUsd(Math.abs(n), Math.abs(n) < 100 ? 2 : 0)}`
const MEDAL = ['🥇', '🥈', '🥉']

type Tab = BoardList | 'hall'
const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: 'season', label: '🏆 Season', hint: 'Profit this season (this calendar month). Top 3 win a trophy.' },
  { id: 'day', label: '📅 Today', hint: 'Profit since midnight UTC.' },
  { id: 'week', label: '📈 This week', hint: 'Profit since Monday.' },
  { id: 'worth', label: '💰 Net worth', hint: 'Everything you hold, valued now.' },
  { id: 'sol', label: '◎ SOL traders', hint: 'Profit taken on Solana coins this season.' },
  { id: 'bsc', label: '◆ BNB traders', hint: 'Profit taken on BNB Chain coins this season.' },
  { id: 'hood', label: '⟠ ETH traders', hint: 'Profit taken on Robinhood Chain (ETH) coins this season.' },
  { id: 'dev', label: '🍳 Devs', hint: 'Coins launched this season: migrations, creator fees, best coin.' },
  { id: 'hall', label: '🏛 Hall of Fame', hint: 'Past seasons and their winners.' },
]
const COLUMN: Record<BoardList, string> = { season: 'Season profit', day: 'Today', week: 'This week', worth: 'Net worth', sol: 'SOL profit', bsc: 'BNB profit', hood: 'ETH profit', dev: 'Fees' }
const value = (list: BoardList, r: BoardRow) => (list === 'worth' ? r.equity : list === 'day' ? r.day : list === 'week' ? r.week : list === 'season' ? r.season : list === 'dev' ? r.dev?.season.fees ?? 0 : r.chains[list])

export function WorldBoard() {
  const board = useWorldBoard((s) => s.board)
  const you = useGame((s) => s.online?.you)
  const spectator = useGame((s) => !!s.online?.spectator)
  const round = useGame((s) => s.online?.round)
  const send = useGame((s) => s.requestBoard)
  const [tab, setTab0] = useState<Tab>(() => load<Tab>('worldBoardTab') ?? 'season')
  const setTab = (t: Tab) => (setTab0(t), save('worldBoardTab', t))
  const list: BoardList = tab === 'hall' ? 'season' : tab
  const [now, setNow] = useState(() => Date.now())
  // Ask on open (and when the list changes), then every 10s while this page is showing.
  useEffect(() => {
    send(list)
    const id = setInterval(() => {
      send(list)
      setNow(Date.now())
    }, 10_000)
    return () => clearInterval(id)
  }, [send, list])

  if (!board) return <EmptyState icon="🌍" title="Loading the World leaderboards…" />
  const fresh = board.list === list
  const rows = fresh ? board.rows : []
  const me = fresh ? board.me : undefined
  const inList = !!me && rows.some((r) => r.id === me.row.id)
  const showMe = !!me && !inList && me.rank > 0 // rank 0: not on this list (e.g. Devs before your first launch)
  const info = TABS.find((t) => t.id === tab)!
  const start = worldStartOf(round) // what a World wallet starts with: the ranks are measured against it

  return (
    <div className="space-y-3">
      {/* Season banner */}
      <div className="relative overflow-hidden rounded-lg border border-warn/30 bg-[radial-gradient(circle_at_0%_0%,rgba(255,176,32,0.18),transparent_55%),#0c0e11] px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-warn">World season {board.season.n}</div>
            <div className="font-display text-[20px] font-bold">{board.season.name}</div>
            <div className="text-[11px] text-muted">Ends in <b className="num text-ink">{fmtCountdown(board.season.endsAt - now)}</b> · top 3 by season profit, the best trader on each chain, the top dev and the richest player win a trophy shown next to their name for good.</div>
          </div>
          {board.me && (
            <div className="ml-auto flex gap-5">
              <Stat label="Season profit" value={signed(board.me.row.season)} tone={board.me.row.season} />
              <Stat label="Today" value={signed(board.me.row.day)} tone={board.me.row.day} />
              <Stat label="Net worth" value={fmtUsd(board.me.row.equity, 0)} />
            </div>
          )}
        </div>
        {board.me && <MyRank season={board.me.row.season} start={start} />}
        {board.me?.row.trophies?.length ? <div className="mt-2 flex flex-wrap gap-1">{board.me.row.trophies.map((t, i) => <span key={i} className="rounded-full border border-warn/40 bg-warn/10 px-2 py-0.5 text-[10px] font-bold text-warn">{t}</span>)}</div> : null}
      </div>

      {board.me ? <RestartBar restartAt={board.me.restartAt} now={now} /> : (
        <div className="rounded-md border border-line bg-panel px-4 py-2 text-[12px] text-muted">{spectator ? 'You are watching as a guest. Sign in to get a wallet and a place on the board.' : 'Make a trade to get on the board.'}</div>
      )}

      <div className="no-scrollbar flex items-center gap-1 overflow-x-auto">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={clsx('shrink-0 rounded-md border px-3 py-1 text-[12px] font-bold', tab === t.id ? 'border-accent/60 bg-accent/10 text-accent' : 'border-line2 text-muted hover:text-ink')}>{t.label}</button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-dim">
        <span>{info.hint}</span>
        <span className="ml-auto">
          {tab === 'day' ? <>Resets in {fmtCountdown(dayEndsAt() - now)}</> : tab === 'week' ? <>Week {board.week} · resets in {fmtCountdown(seasonEnds().getTime() - now)}</> : null}
          {tab !== 'hall' && <> · {board.total} ranked · real players only</>}
        </span>
      </div>

      {tab !== 'hall' && fresh && <Podium rows={rows} list={list} you={you} start={start} />}

      {tab === 'hall' ? <Hall hall={board.hall} /> : (
        <div className="overflow-x-auto rounded-md border border-line bg-panel">
          <table className="w-full min-w-[560px] text-[12px]">
            <thead>
              {tab === 'dev' ? (
                <tr className="border-b border-line text-left text-[10px] uppercase tracking-wider text-dim">
                  <th className="w-14 px-3 py-2">Rank</th><th className="px-2 py-2">Dev</th>
                  <th className="px-2 py-2 text-right">Fees earned</th><th className="px-2 py-2 text-right">Launched</th><th className="px-2 py-2 text-right">Migrated</th>
                  <th className="hidden px-2 py-2 text-right sm:table-cell">Best coin (ATH)</th><th className="hidden px-3 py-2 text-right md:table-cell">All-time fees</th>
                </tr>
              ) : (
                <tr className="border-b border-line text-left text-[10px] uppercase tracking-wider text-dim">
                  <th className="w-14 px-3 py-2">Rank</th><th className="px-2 py-2">Trader</th>
                  <th className="px-2 py-2 text-right">{COLUMN[list]}</th>
                  <th className="px-2 py-2 text-right">Net worth</th>
                  <th className="hidden px-2 py-2 text-right sm:table-cell">All-time profit</th>
                  <th className="hidden px-3 py-2 text-right md:table-cell">Restarts</th>
                </tr>
              )}
            </thead>
            <tbody>
              {rows.map((r, i) => <Line key={r.id} r={r} rank={i + 1} you={r.id === you} list={list} start={start} />)}
              {me && showMe && (
                <>
                  <tr><td colSpan={7} className="border-t border-line px-3 py-1 text-center text-[10px] text-dim">· · ·</td></tr>
                  <Line r={me.row} rank={me.rank} you list={list} start={start} />
                </>
              )}
            </tbody>
          </table>
          {!fresh ? <div className="p-6 text-center text-[12px] text-dim">Loading…</div> : !rows.length && <div className="p-6 text-center text-[12px] text-dim">{tab === 'dev' ? 'No devs yet: launch a coin in the World to get on this board.' : 'Nobody on the board yet.'}</div>}
        </div>
      )}
    </div>
  )
}

function Who({ r, you, start }: { r: BoardRow; you: boolean; start: number }) {
  return (
    <span className="flex items-center gap-2">
      <span className="relative grid size-7 shrink-0 place-items-center rounded-md bg-raise text-[15px]">
        {r.avatar}
        <span className={clsx('absolute -bottom-0.5 -right-0.5 size-2 rounded-full ring-2 ring-panel', r.online ? 'bg-up' : 'bg-line2')} title={r.online ? 'Online' : 'Offline'} />
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1 font-semibold">
          <span className="truncate">{r.name}</span>
          {r.verified && <span className="text-[10px] font-bold text-up" title="Signed in">✓</span>}
          {r.trophies?.slice(-3).map((t, i) => <span key={i} className="rounded bg-warn/10 px-1 text-[9px] font-bold text-warn" title="Season trophy">{t}</span>)}
          {you && <span className="text-[10px] text-accent">(you)</span>}
        </span>
        <span className="flex items-center gap-1.5 text-[10px] text-dim"><RankBadge season={r.season} start={start} /> Lv {r.level}</span>
      </span>
    </span>
  )
}

function Line({ r, rank, you, list, start }: { r: BoardRow; rank: number; you: boolean; list: BoardList; start: number }) {
  // A row opens that player's card (your own row: your Portfolio). Also for players who are off line.
  const open = useOpenPlayer()
  const row = { onClick: open ? () => open(r.id) : undefined, title: open ? (you ? 'Open your Portfolio' : `Open ${r.name}'s card`) : undefined }
  const rankCell = <td className="num px-3 py-2 font-bold">{MEDAL[rank - 1] ?? `#${rank}`}</td>
  if (list === 'dev') {
    const d = r.dev
    return (
      <tr {...row} className={clsx('border-t border-line/60', you && 'bg-accent/5', open && 'cursor-pointer hover:bg-panel2')}>
        {rankCell}
        <td className="px-2 py-2"><Who r={r} you={you} start={start} /></td>
        <td className="num px-2 py-2 text-right font-bold text-up">{fmtUsd(d?.season.fees ?? 0, 0)}</td>
        <td className="num px-2 py-2 text-right">{d?.season.cooked ?? 0}</td>
        <td className="num px-2 py-2 text-right">{d?.season.migrated ?? 0}{d && d.season.cooked > 0 ? <span className="text-[10px] text-dim"> ({Math.round((d.season.migrated / d.season.cooked) * 100)}%)</span> : null}</td>
        <td className="num hidden px-2 py-2 text-right sm:table-cell">{d?.bestTicker ? <>${d.bestTicker} <span className="text-dim">{fmtCompact(d.bestAth)}</span></> : '—'}</td>
        <td className="num hidden px-3 py-2 text-right text-muted md:table-cell">{fmtUsd(d?.fees ?? 0, 0)}</td>
      </tr>
    )
  }
  const v = value(list, r)
  return (
    <tr {...row} className={clsx('border-t border-line/60', you && 'bg-accent/5', open && 'cursor-pointer hover:bg-panel2')}>
      {rankCell}
      <td className="px-2 py-2"><Who r={r} you={you} start={start} /></td>
      <td className={clsx('num px-2 py-2 text-right font-bold', list === 'worth' ? 'text-ink' : toneClass(v))}>{list === 'worth' ? fmtUsd(v, 0) : signed(v)}</td>
      <td className="num px-2 py-2 text-right">{fmtUsd(r.equity, 0)}</td>
      <td className={clsx('num hidden px-2 py-2 text-right sm:table-cell', toneClass(r.pnl))}>{signed(r.pnl)}</td>
      <td className="num hidden px-3 py-2 text-right text-muted md:table-cell">{r.restarts || '—'}</td>
    </tr>
  )
}

/** A player's season rank as a small badge (see game/worldRank.ts). */
function RankBadge({ season, start, big }: { season: number; start: number; big?: boolean }) {
  const rank = worldRank(season, start)
  return <span className={clsx('inline-flex items-center gap-0.5 rounded border font-bold', rank.cls, big ? 'px-1.5 py-0.5 text-[11px]' : 'px-1 text-[9px]')} title={`Season rank: ${rank.name}. Ranks follow season profit, measured against a starting wallet (${fmtUsd(start, 0)}).`}>{rank.icon} {rank.name}</span>
}

/** Your own rank in the season banner, and how far the next one is. */
function MyRank({ season, start }: { season: number; start: number }) {
  const next = nextWorldRank(season, start)
  const [ladder, setLadder] = useState(false)
  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className="text-dim">Your rank</span>
        <RankBadge season={season} start={start} big />
        {next ? <span className="text-muted"><b className="num text-ink">{fmtUsd(next.need, 0)}</b> more season profit to {next.rank.icon} <b className="text-ink">{next.rank.name}</b></span> : <span className="text-warn">The top rank. Nothing above you but the podium.</span>}
        <button onClick={() => setLadder((v) => !v)} className="ml-auto text-[10px] text-dim underline hover:text-ink">{ladder ? 'Hide the ranks' : 'All ranks'}</button>
      </div>
      {next && <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line2"><div className="h-full bg-warn transition-all" style={{ width: `${Math.round(next.progress * 100)}%` }} /></div>}
      {ladder && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {WORLD_RANKS.map((r) => (
            <span key={r.id} className={clsx('rounded border px-1.5 py-0.5 text-[10px]', r.cls, worldRank(season, start).id === r.id && 'bg-white/5 font-bold')}>
              {r.icon} {r.name} <span className="num text-dim">{!Number.isFinite(r.from) ? `down more than ${fmtUsd(0.05 * start, 0)}` : r.from <= 0 ? 'the start' : `from +${fmtUsd(r.from * start, 0)}`}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/** The top three of a list, on a podium. An empty step is an open spot, said so: a young season is not a broken page. */
function Podium({ rows, list, you, start }: { rows: BoardRow[]; list: BoardList; you?: string; start: number }) {
  const open = useOpenPlayer()
  // Shown 2nd, 1st, 3rd, as a podium stands, on every screen (three narrow steps on a phone).
  const order = [1, 0, 2]
  const HEIGHT = ['pt-0', 'pt-4', 'pt-6']
  const PLACE = ['1st', '2nd', '3rd']
  const RING = ['border-warn/70 bg-[radial-gradient(circle_at_50%_0%,rgba(255,201,61,0.18),transparent_70%)]', 'border-[#b4bed2]/50 bg-[radial-gradient(circle_at_50%_0%,rgba(180,190,210,0.12),transparent_70%)]', 'border-[#cd7f32]/50 bg-[radial-gradient(circle_at_50%_0%,rgba(205,127,50,0.14),transparent_70%)]']
  return (
    <div className="grid grid-cols-3 items-end gap-1.5 md:gap-2" role="list" aria-label="Podium">
      {order.map((i) => {
        const r = rows[i]
        const v = r ? value(list, r) : 0
        return (
          <div key={i} role="listitem" className={clsx('min-w-0', HEIGHT[i])}>
            <div
              onClick={r && open ? () => open(r.id) : undefined}
              className={clsx('rounded-lg border px-1.5 py-2 text-center md:px-3 md:py-3', RING[i], r && open && 'cursor-pointer hover:brightness-125', !r && 'border-dashed opacity-70', r?.id === you && 'ring-1 ring-accent')}
            >
              <div className="text-[22px] leading-none">{MEDAL[i]}</div>
              <div className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-dim">{PLACE[i]}</div>
              {r ? (
                <>
                  <div className="mt-1 text-[26px] leading-none">{r.avatar}</div>
                  <div className="mt-1 truncate text-[13px] font-bold text-ink">{r.name}{r.id === you && <span className="ml-1 text-[10px] text-accent">(you)</span>}</div>
                  <div className="mt-0.5 flex flex-wrap items-center justify-center gap-x-1.5 text-[10px] text-dim"><RankBadge season={r.season} start={start} /> <span>Lv {r.level}</span></div>
                  <div className={clsx('num mt-1 font-display text-[14px] font-bold md:text-[17px]', list === 'worth' || list === 'dev' ? 'text-ink' : toneClass(v))}>{list === 'worth' || list === 'dev' ? fmtUsd(v, 0) : signed(v)}</div>
                  <div className="text-[9px] uppercase tracking-wider text-dim">{COLUMN[list]}</div>
                </>
              ) : (
                <>
                  <div className="mt-1 text-[26px] leading-none opacity-40">👤</div>
                  <div className="mt-1 text-[13px] font-bold text-muted">Open spot</div>
                  <div className="mt-0.5 text-[10px] leading-tight text-dim">{list === 'dev' ? 'Launch a coin to take it' : 'Trade to take it'}</div>
                </>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

const HALL_LABEL: Record<BoardList, string> = { season: 'Season profit', sol: 'Top SOL trader', bsc: 'Top BNB trader', hood: 'Top ETH trader', dev: 'Top dev', worth: 'Richest', day: 'Today', week: 'This week' }

function Hall({ hall }: { hall: HallEntry[] }) {
  if (!hall.length) return <EmptyState icon="🏛" title="No finished seasons yet" hint="The first World season ends when this month does. Its winners will be honoured here." />
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {hall.map((h) => (
        <div key={h.n} className="rounded-lg border border-warn/30 bg-panel p-3">
          <div className="mb-2 flex items-baseline justify-between"><span className="font-display text-[15px] font-bold">Season {h.n}</span><span className="text-[11px] text-dim">{h.name}</span></div>
          <div className="space-y-1">
            {h.winners.map((w, i) => (
              <div key={i} className="flex items-center gap-2 text-[12px]">
                <span className="w-28 shrink-0 text-[10px] uppercase tracking-wider text-dim">{w.list === 'season' ? `${MEDAL[h.winners.filter((x) => x.list === 'season').indexOf(w)] ?? ''} Season` : HALL_LABEL[w.list]}</span>
                <span className="text-[14px]">{w.avatar}</span>
                <span className="min-w-0 flex-1 truncate font-semibold">{w.name}</span>
                <span className={clsx('num', w.list === 'worth' ? 'text-ink' : 'text-up')}>{w.list === 'worth' || w.list === 'dev' ? fmtUsd(w.value, 0) : signed(w.value)}</span>
              </div>
            ))}
            {!h.winners.length && <div className="text-[11px] text-dim">Nobody qualified.</div>}
          </div>
        </div>
      ))}
    </div>
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
