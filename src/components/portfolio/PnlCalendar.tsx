import clsx from 'clsx'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { dayKey, sumDays, type Daily } from '../../game/daily'
import { useGame } from '../../game/store'
import { fmtCompact, fmtUsd, toneClass } from '../../utils/format'
import { Segmented } from '../ui'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '-' : ''}${fmtCompact(Math.abs(v))}`

/** GMGN-style monthly PnL calendar: one cell per real day, shaded by realized PnL. Lifetime, across every round. */
export function PnlCalendar({ className }: { className?: string }) {
  const daily = useGame((s) => s.profile.daily)
  const today = new Date()
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1))
  const year = month.getFullYear()
  const m = month.getMonth()
  const days = new Date(year, m + 1, 0).getDate()
  const lead = new Date(year, m, 1).getDay()
  const keys = Array.from({ length: days }, (_, i) => dayKey(new Date(year, m, i + 1)))
  const sum = sumDays(daily, keys)
  const scale = Math.max(1, ...keys.map((k) => Math.abs(daily?.[k]?.pnl ?? 0)))
  const isThisMonth = year === today.getFullYear() && m === today.getMonth()
  const shift = (n: number) => setMonth(new Date(year, m + n, 1))
  const winRate = sum.sells ? sum.wins / sum.sells : 0

  return (
    <div className={clsx('rounded-md border border-line bg-panel p-3', className)}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-[12px] font-bold">PnL Calendar</span>
        <div className="flex items-center gap-1">
          <button onClick={() => shift(-1)} className="rounded p-0.5 text-dim hover:bg-panel2 hover:text-ink" aria-label="Previous month"><ChevronLeft size={14} /></button>
          <span className="num w-28 text-center text-[12px] font-semibold">{month.toLocaleString('en-US', { month: 'long', year: 'numeric' })}</span>
          <button onClick={() => shift(1)} disabled={isThisMonth} className="rounded p-0.5 text-dim hover:bg-panel2 hover:text-ink disabled:opacity-30" aria-label="Next month"><ChevronRight size={14} /></button>
          {!isThisMonth && <button onClick={() => setMonth(new Date(today.getFullYear(), today.getMonth(), 1))} className="ml-1 text-[10px] text-accent hover:underline">Today</button>}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-dim">
          <span>Month <span className={clsx('num font-semibold', toneClass(sum.pnl))}>{sum.pnl ? signed(sum.pnl) : '$0'}</span></span>
          <span>Days <span className="num text-up">{sum.upDays}</span>/<span className="num text-down">{sum.downDays}</span></span>
          <span>Win rate <span className="num text-ink">{sum.sells ? `${(winRate * 100).toFixed(0)}%` : '--'}</span></span>
          <span>TXs <span className="num text-up">{sum.buys}</span>/<span className="num text-down">{sum.sells}</span></span>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {WEEKDAYS.map((d) => <div key={d} className="pb-0.5 text-center text-[10px] font-medium text-dim">{d}</div>)}
        {Array.from({ length: lead }, (_, i) => <div key={`pad-${i}`} />)}
        {keys.map((k, i) => {
          const d = daily?.[k]
          const date = new Date(year, m, i + 1)
          const future = date > today
          const isToday = k === dayKey(today)
          const pnl = d?.pnl ?? 0
          // Shade by size relative to the month's biggest day (at least a light tint when there's any PnL).
          const a = d?.sells ? 0.12 + 0.55 * Math.min(1, Math.abs(pnl) / scale) : 0
          const bg = pnl > 0 ? `rgba(25,217,137,${a})` : pnl < 0 ? `rgba(255,77,106,${a})` : undefined
          return (
            <div
              key={k}
              title={d ? `${date.toDateString()}\nRealized ${pnl >= 0 ? '+' : '-'}${fmtUsd(Math.abs(pnl))}\n${d.buys} buys · ${d.sells} sells · ${d.wins} wins\nVolume ${fmtUsd(d.volume)}${d.best && d.best.pnl > 0 ? `\nBest $${d.best.ticker} +${fmtUsd(d.best.pnl)}` : ''}${d.worst && d.worst.pnl < 0 ? `\nWorst $${d.worst.ticker} -${fmtUsd(Math.abs(d.worst.pnl))}` : ''}` : date.toDateString()}
              className={clsx(
                'flex h-14 flex-col rounded-md border px-1.5 py-1 transition-colors',
                isToday ? 'border-accent/70' : 'border-line/60',
                future ? 'opacity-30' : !d && 'bg-panel2/40',
              )}
              style={bg ? { background: bg } : undefined}
            >
              <span className={clsx('num text-[10px]', isToday ? 'font-bold text-accent' : 'text-dim')}>{i + 1}</span>
              {d && (d.sells > 0 || d.buys > 0) && (
                <>
                  <span className={clsx('num mt-auto truncate text-[12px] font-semibold', d.sells ? toneClass(pnl) : 'text-muted')}>{d.sells ? signed(pnl) : '—'}</span>
                  <span className="num truncate text-[9px] text-dim">{d.buys + d.sells} TX</span>
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

type Range = '7D' | '30D' | 'ALL'

/** Lifetime stats from the calendar history (across rounds). */
export function LifetimeStats({ className }: { className?: string }) {
  const daily = useGame((s) => s.profile.daily)
  const runs = useGame((s) => s.profile.runsPlayed)
  const [range, setRange] = useState<Range>('7D')
  const keys = range === 'ALL' ? Object.keys(daily ?? {}) : recentKeys(range === '7D' ? 7 : 30)
  const s = sumDays(daily as Daily | undefined, keys)
  const rows: [string, React.ReactNode][] = [
    ['Realized PnL', <span className={toneClass(s.pnl)}>{s.pnl ? `${s.pnl > 0 ? '+' : '-'}${fmtUsd(Math.abs(s.pnl))}` : '$0.00'}</span>],
    ['Win rate', s.sells ? <span className={s.wins / s.sells >= 0.5 ? 'text-up' : 'text-ink'}>{((s.wins / s.sells) * 100).toFixed(1)}%</span> : '--'],
    ['TXs', <><span className="text-up">{s.buys}</span>/<span className="text-down">{s.sells}</span></>],
    ['Volume', fmtUsd(s.volume)],
    ['Active days', `${s.days}`],
    ['Green / red days', <><span className="text-up">{s.upDays}</span> / <span className="text-down">{s.downDays}</span></>],
    ['Best day', s.best ? <span className={toneClass(s.best.pnl)}>{s.best.key.slice(5)} · {s.best.pnl >= 0 ? '+' : '-'}{fmtUsd(Math.abs(s.best.pnl))}</span> : '--'],
    ['Rounds played', `${runs}`],
  ]
  return (
    <div className={clsx('rounded-md border border-line bg-panel p-3', className)}>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[12px] font-bold">Lifetime</span>
        <Segmented value={range} onChange={setRange} options={[{ value: '7D', label: '7D' }, { value: '30D', label: '30D' }, { value: 'ALL', label: 'All' }]} />
      </div>
      <div className="space-y-2 text-[12px]">
        {rows.map(([label, v]) => (
          <div key={label} className="flex items-center justify-between gap-2">
            <span className="text-dim">{label}</span>
            <span className="num">{v}</span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[10px] leading-snug text-dim">Across every round, by real calendar day. Realized PnL only (sells).</p>
    </div>
  )
}

function recentKeys(n: number) {
  const out: string[] = []
  const d = new Date()
  for (let i = 0; i < n; i++) {
    out.push(dayKey(d))
    d.setDate(d.getDate() - 1)
  }
  return out
}
