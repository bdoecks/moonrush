import { useCooking } from '../hooks/useLabs'
import clsx from 'clsx'
import { Check } from 'lucide-react'
import { useEffect, useState } from 'react'
import { DAILY_SWEEP_XP, dailyChallenges, dailyFor, msToNextDaily, type DailyDef, type DailyState } from '../game/dailyChallenges'
import { useGame } from '../game/store'
import { fmtCompact } from '../utils/format'

const TIER_CLASS = { easy: 'text-up', medium: 'text-warn', hard: 'text-down' }

const fmtLeft = (ms: number) => {
  const min = Math.max(1, Math.ceil(ms / 60_000))
  return min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min}m`
}

function amount(d: DailyDef, n: number) {
  if (d.unit === '$') return fmtCompact(n)
  if (d.unit === '%') return `${n.toFixed(n >= 10 || n === 0 ? 0 : 1)}%`
  return String(Math.floor(n))
}

/** Today's three daily challenges with progress bars (Missions page and Rewards → Daily). */
export function DailyChallenges() {
  const saved = useGame((s) => s.rewards.dailies)
  // Re-read the clock every 30s so the countdown moves and the list rolls over at midnight.
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(id)
  }, [])
  const state: DailyState = dailyFor(saved, now)
  const cooking = useCooking()
  const defs = dailyChallenges(state.date, !cooking)
  const done = defs.filter((d) => state.done.includes(d.id)).length

  return (
    <div className="rounded-md border border-line bg-panel">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-3 py-2">
        <div className="text-[12px] font-bold">Daily challenges</div>
        <div className="num text-[11px] text-muted">{done}/{defs.length} done</div>
        <div className="ml-auto num text-[11px] text-dim">New in {fmtLeft(msToNextDaily(now))}</div>
      </div>
      <ul className="divide-y divide-line/60">
        {defs.map((d) => {
          const isDone = state.done.includes(d.id)
          const value = isDone ? d.target : Math.max(0, Math.min(d.target, d.progress(state)))
          const pct = value / d.target
          return (
            <li key={d.id} className={clsx('flex items-center gap-3 px-3 py-2.5', isDone && 'bg-up/5')}>
              <div className={clsx('grid size-7 shrink-0 place-items-center rounded-md border text-[14px]', isDone ? 'border-up bg-up text-black' : 'border-line2')}>
                {isDone ? <Check size={14} /> : d.icon}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-[12px] font-semibold">
                  {d.title}
                  <span className={clsx('text-[9px] font-bold uppercase tracking-wider', TIER_CLASS[d.tier])}>{d.tier}</span>
                </div>
                <div className="text-[10px] text-dim">{d.desc}</div>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-line2">
                  <div className={clsx('h-full transition-all duration-500', isDone ? 'bg-up' : 'bg-accent')} style={{ width: `${pct * 100}%` }} />
                </div>
              </div>
              <div className="text-right">
                <div className="num text-[11px] text-muted">{amount(d, value)} / {amount(d, d.target)}</div>
                <div className="num text-[10px] font-bold text-accent">+{d.xp} XP</div>
              </div>
            </li>
          )
        })}
      </ul>
      <div className={clsx('flex items-center justify-between border-t border-line px-3 py-2 text-[11px]', state.swept ? 'text-up' : 'text-muted')}>
        <span>{state.swept ? '🧹 Daily sweep — all three done' : 'Finish all three for a bonus'}</span>
        <span className="num font-bold">+{DAILY_SWEEP_XP} XP</span>
      </div>
      <p className="border-t border-line/60 px-3 py-2 text-[10px] text-dim">Trades in any mode count: solo rounds, rooms and the World. Three new challenges every day at midnight on your device.</p>
    </div>
  )
}
