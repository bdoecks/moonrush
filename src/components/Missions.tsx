// The Missions page's weekly missions and career ladder (the daily ones are components/DailyChallenges.tsx; the
// rules are game/missions.ts). Everything here pays XP only.
import clsx from 'clsx'
import { Check } from 'lucide-react'
import { useEffect, useState } from 'react'
import { badgeCount, CAREER, freshCareer, msToNextWeek, streakNow, TIER_COLOR, TIER_NAMES, TIER_XP, tiersReached, WEEKLY_SWEEP_XP, weeklyFor, weeklyMissions, type CareerLadder } from '../game/missions'
import { useGame } from '../game/store'
import { fmtCompact } from '../utils/format'

const amount = (unit: '%' | '$' | undefined, n: number) => (unit === '$' ? fmtCompact(n) : unit === '%' ? `${n.toFixed(n >= 10 || n === 0 ? 0 : 1)}%` : Math.floor(n).toLocaleString())
const fmtLeft = (ms: number) => {
  const h = Math.max(1, Math.ceil(ms / 3_600_000))
  return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h`
}
function useNow(everyMs: number) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), everyMs)
    return () => clearInterval(id)
  }, [everyMs])
  return now
}

/** This week's four missions. */
export function WeeklyMissions() {
  const saved = useGame((s) => s.rewards.weekly)
  const now = useNow(60_000)
  const state = weeklyFor(saved, now)
  const defs = weeklyMissions(state.week)
  const done = defs.filter((d) => state.done.includes(d.id)).length
  return (
    <div className="rounded-md border border-line bg-panel">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-3 py-2">
        <div className="text-[12px] font-bold">Weekly missions</div>
        <div className="num text-[11px] text-muted">{done}/{defs.length} done</div>
        <div className="ml-auto num text-[11px] text-dim">New in {fmtLeft(msToNextWeek(now))}</div>
      </div>
      <ul className="divide-y divide-line/60">
        {defs.map((d) => {
          const isDone = state.done.includes(d.id)
          const value = isDone ? d.target : Math.max(0, Math.min(d.target, d.progress(state)))
          return (
            <li key={d.id} className={clsx('flex items-center gap-3 px-3 py-2.5', isDone && 'bg-up/5')}>
              <div className={clsx('grid size-7 shrink-0 place-items-center rounded-md border text-[14px]', isDone ? 'border-up bg-up text-black' : 'border-line2')}>{isDone ? <Check size={14} /> : d.icon}</div>
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-semibold">{d.title}</div>
                <div className="text-[10px] text-dim">{d.desc}</div>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-line2"><div className={clsx('h-full transition-all duration-500', isDone ? 'bg-up' : 'bg-accent')} style={{ width: `${(value / d.target) * 100}%` }} /></div>
              </div>
              <div className="text-right">
                <div className="num text-[11px] text-muted">{amount(d.unit, value)} / {amount(d.unit, d.target)}</div>
                <div className="num text-[10px] font-bold text-accent">+{d.xp} XP</div>
              </div>
            </li>
          )
        })}
      </ul>
      <div className={clsx('flex items-center justify-between border-t border-line px-3 py-2 text-[11px]', state.swept ? 'text-up' : 'text-muted')}>
        <span>{state.swept ? '🏅 Weekly sweep: all four done' : 'Finish all four for a bonus'}</span>
        <span className="num font-bold">+{WEEKLY_SWEEP_XP} XP</span>
      </div>
      <p className="border-t border-line/60 px-3 py-2 text-[10px] text-dim">Trades in any mode count. Four new missions every Monday.</p>
    </div>
  )
}

function Ladder({ l }: { l: CareerLadder }) {
  const career = useGame((s) => s.rewards.career) ?? freshCareer()
  const reached = tiersReached(l, career)
  const value = l.value(career)
  const next = l.steps[reached]
  const from = reached > 0 ? l.steps[reached - 1] : 0
  const pct = next === undefined ? 1 : Math.min(1, Math.max(0, (value - from) / Math.max(1e-9, next - from)))
  return (
    <li className="rounded-md border border-line bg-bg p-2.5">
      <div className="flex items-center gap-2">
        <span className="text-[16px]">{l.icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[12px] font-bold text-ink">{l.name}</span>
          <span className="block truncate text-[10px] text-dim">{amount(l.unit, value)} {l.what}</span>
        </span>
        <span className="flex gap-0.5" title={reached ? `${TIER_NAMES[reached - 1]} reached` : 'No tier yet'}>
          {l.steps.map((_, i) => <span key={i} className="size-2.5 rounded-full border" style={i < reached ? { background: TIER_COLOR[i], borderColor: TIER_COLOR[i] } : { borderColor: '#2a2f38' }} />)}
        </span>
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-line2"><div className="h-full transition-all duration-500" style={{ width: `${pct * 100}%`, background: TIER_COLOR[Math.min(reached, 4)] }} /></div>
      <div className="mt-1 flex justify-between text-[10px]">
        {next === undefined ? <span className="font-semibold" style={{ color: TIER_COLOR[4] }}>Diamond: the top of this ladder</span> : <span className="text-muted">Next: <b style={{ color: TIER_COLOR[reached] }}>{TIER_NAMES[reached]}</b> at {amount(l.unit, next)}</span>}
        {next !== undefined && <span className="num font-bold text-accent">+{TIER_XP[reached]} XP</span>}
      </div>
    </li>
  )
}

/** The career ladders: nine things worth getting good at, five tiers each, kept for good. */
export function CareerMissions() {
  const career = useGame((s) => s.rewards.career)
  const total = CAREER.length * 5
  return (
    <div className="rounded-md border border-line bg-panel">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-3 py-2">
        <div className="text-[12px] font-bold">Career</div>
        <div className="num text-[11px] text-muted">{badgeCount(career)}/{total} badges</div>
        <div className="ml-auto flex gap-2 text-[10px] text-dim">{TIER_NAMES.map((n, i) => <span key={n} className="flex items-center gap-1"><span className="size-2 rounded-full" style={{ background: TIER_COLOR[i] }} />{n}</span>)}</div>
      </div>
      <ul className="grid gap-2 p-2.5 sm:grid-cols-2 xl:grid-cols-3">{CAREER.map((l) => <Ladder key={l.id} l={l} />)}</ul>
      <p className="border-t border-line/60 px-3 py-2 text-[10px] text-dim">These never reset. Each tier pays its XP once, the moment you reach it, in any mode.</p>
    </div>
  )
}

/** The streak and badge count, for the top of the page. */
export function MissionSummary() {
  const career = useGame((s) => s.rewards.career)
  const now = useNow(60_000)
  const streak = streakNow(career, now)
  const tradedToday = !!career?.lastDay && career.lastDay === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  return (
    <div className="grid grid-cols-3 gap-2 rounded-md border border-line bg-panel p-3 text-center">
      <div><div className="text-[9px] uppercase tracking-wider text-dim">Streak</div><div className={clsx('num font-display text-[20px] font-bold', streak ? 'text-warn' : 'text-dim')}>🔥 {streak}</div><div className="text-[10px] text-dim">{streak ? (tradedToday ? 'safe for today' : 'trade today to keep it') : 'trade to start one'}</div></div>
      <div><div className="text-[9px] uppercase tracking-wider text-dim">Best streak</div><div className="num font-display text-[20px] font-bold text-ink">{career?.bestStreak ?? 0}</div><div className="text-[10px] text-dim">days in a row</div></div>
      <div><div className="text-[9px] uppercase tracking-wider text-dim">Badges</div><div className="num font-display text-[20px] font-bold text-accent">{badgeCount(career)}</div><div className="text-[10px] text-dim">of {CAREER.length * 5}</div></div>
    </div>
  )
}
