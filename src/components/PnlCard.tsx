import clsx from 'clsx'
import { GripHorizontal, Palette, RotateCcw, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { CHAINS } from '../data/chains'
import { useValuation } from '../hooks/useDerived'
import { useGame } from '../game/store'
import { fmtPct, fmtUsd, toneClass } from '../utils/format'
import { load, save } from '../utils/storage'

const W = 260
const clampPos = (p: { x: number; y: number }) => ({
  x: Math.min(Math.max(8, p.x), Math.max(8, window.innerWidth - W - 8)),
  y: Math.min(Math.max(56, p.y), Math.max(56, window.innerHeight - 200)),
})

interface Prefs {
  unit: 'usd' | 'sol'
  period: 'session' | 'round'
  theme: number
}
interface Baseline {
  equity: number
  realized: number
  tick: number
  trades: number
}

const THEMES = [
  'bg-panel/95',
  'bg-[radial-gradient(circle_at_15%_0%,rgba(155,107,255,0.35),transparent_65%),#0e0c16]',
  'bg-[radial-gradient(circle_at_85%_0%,rgba(25,217,137,0.28),transparent_65%),#0a120e]',
]

/** GMGN-style floating PnL card: session or round PnL in USD or SOL, draggable, with a mini balance chart. */
export function PnlCard() {
  const open = useGame((s) => s.pnlOpen)
  const setOpen = useGame((s) => s.setPnlOpen)
  if (!open) return null
  return <Card onClose={() => setOpen(false)} />
}

function Card({ onClose }: { onClose: () => void }) {
  const v = useValuation()
  const p = v.portfolio
  const tick = useGame((s) => s.market.tick)
  const sol = useGame((s) => s.market.native?.sol?.price ?? CHAINS.sol.basePrice)
  const [pos, setPos] = useState(() => clampPos(load<{ x: number; y: number }>('pnlPos') ?? { x: window.innerWidth - W - 24, y: 120 }))
  const [prefs, setPrefsState] = useState<Prefs>(() => ({ unit: 'usd', period: 'session', theme: 0, ...(load<Prefs>('pnlPrefs') ?? {}) }))
  const setPrefs = (patch: Partial<Prefs>) => {
    const next = { ...prefs, ...patch }
    setPrefsState(next)
    save('pnlPrefs', next)
  }
  // Session baseline: where "now" started. Reset any time (like GMGN's refresh).
  const [stored, setBase] = useState<Baseline>(() => {
    const saved = load<Baseline>('pnlSession')
    if (saved) return saved
    const b = { equity: v.equity, realized: p.realized, tick, trades: p.trades.length }
    save('pnlSession', b)
    return b
  })
  // A new round since the session started (ticks or trades went backwards): the session is the whole round.
  const base: Baseline = stored.tick > tick || stored.trades > p.trades.length ? { equity: p.startBalance, realized: 0, tick: 0, trades: 0 } : stored
  const reset = () => {
    const b = { equity: v.equity, realized: p.realized, tick, trades: p.trades.length }
    setBase(b)
    save('pnlSession', b)
  }
  const drag = useRef<{ dx: number; dy: number } | null>(null)
  useEffect(() => {
    const onResize = () => setPos((q) => clampPos(q))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const session = prefs.period === 'session'
  const pnl = session ? v.equity - base.equity : v.stats.totalPnl
  const pct = session ? (base.equity > 0 ? pnl / base.equity : 0) : v.stats.totalPnlPct
  const realized = session ? p.realized - base.realized : p.realized
  const sinceTick = session ? base.tick : -Infinity
  const trades = session ? p.trades.slice(0, Math.max(0, p.trades.length - base.trades)) : p.trades
  const sells = trades.filter((t) => t.side === 'sell')
  const wins = sells.filter((t) => (t.pnl ?? 0) > 0).length
  const money = (usd: number, signed = false) => {
    const sign = signed ? (usd >= 0 ? '+' : '-') : ''
    return prefs.unit === 'usd' ? `${sign}${fmtUsd(Math.abs(usd))}` : `${sign}${(Math.abs(usd) / sol).toFixed(Math.abs(usd) / sol >= 100 ? 1 : 3)} SOL`
  }
  const points = useMemo(() => {
    const h = p.equityHistory.filter((e) => e.tick >= sinceTick)
    if (h.length < 2) return ''
    const xs = h.map((_, i) => (i / (h.length - 1)) * 100)
    const lo = Math.min(...h.map((e) => e.equity))
    const hi = Math.max(...h.map((e) => e.equity))
    return h.map((e, i) => `${xs[i].toFixed(1)},${(28 - ((e.equity - lo) / Math.max(1e-9, hi - lo)) * 26).toFixed(1)}`).join(' ')
  }, [p.equityHistory, sinceTick])

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return
    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current) setPos(clampPos({ x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy }))
  }
  const onUp = () => {
    if (drag.current) save('pnlPos', pos)
    drag.current = null
  }
  const up = pnl >= 0

  return (
    <div role="dialog" aria-label="PnL card" className={clsx('pop-in fixed z-40 overflow-hidden rounded-xl border shadow-2xl shadow-black/60 backdrop-blur', up ? 'border-up/30' : 'border-down/30', THEMES[prefs.theme % THEMES.length])} style={{ left: pos.x, top: pos.y, width: W }}>
      <div onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} className="flex cursor-grab touch-none items-center gap-1.5 px-2.5 pt-2 active:cursor-grabbing">
        <GripHorizontal size={13} className="text-dim" />
        <span className="font-display text-[11px] font-bold tracking-[0.18em]">PNL</span>
        <div className="ml-auto flex items-center gap-0.5">
          <Seg value={prefs.period} onChange={(period) => setPrefs({ period })} options={[['session', 'Session'], ['round', 'Round']]} />
          <Seg value={prefs.unit} onChange={(unit) => setPrefs({ unit })} options={[['usd', 'USD'], ['sol', 'SOL']]} />
          <button onClick={() => setPrefs({ theme: prefs.theme + 1 })} className="rounded p-1 text-dim hover:text-ink" title="Card style" aria-label="Change card style"><Palette size={12} /></button>
          <button onClick={onClose} className="rounded p-1 text-dim hover:text-ink" aria-label="Close PnL card"><X size={13} /></button>
        </div>
      </div>
      <div className="px-3 pb-2.5 pt-1.5">
        <div className="flex items-end justify-between gap-2">
          <div>
            <div className={clsx('num text-[24px] font-bold leading-none', toneClass(pnl))}>{money(pnl, true)}</div>
            <div className={clsx('num mt-0.5 text-[12px] font-semibold', toneClass(pnl))}>{fmtPct(pct, 2)}</div>
          </div>
          <div className="text-[28px] leading-none">{up ? '🚀' : '🩸'}</div>
        </div>
        {points && (
          <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="mt-2 h-8 w-full">
            <polyline points={points} fill="none" stroke={up ? '#19d989' : '#ff4d6a'} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
          </svg>
        )}
        <div className="mt-2 grid grid-cols-3 gap-1 text-[10px]">
          <div><div className="text-dim">Balance</div><div className="num text-ink">{money(v.equity)}</div></div>
          <div><div className="text-dim">Realized</div><div className={clsx('num', toneClass(realized))}>{money(realized, true)}</div></div>
          <div className="text-right"><div className="text-dim">Unrealized</div><div className={clsx('num', toneClass(v.unrealized))}>{money(v.unrealized, true)}</div></div>
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[10px] text-dim">
          <span className="num">{trades.length} txs · {sells.length ? `${Math.round((wins / sells.length) * 100)}% win` : 'no sells'}</span>
          {prefs.period === 'session' ? (
            <button onClick={reset} className="flex items-center gap-1 hover:text-ink" title="Start a new session from now"><RotateCcw size={10} /> reset</button>
          ) : (
            <span>since round start</span>
          )}
        </div>
      </div>
    </div>
  )
}

function Seg<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="inline-flex rounded border border-line2 bg-bg/70 p-px">
      {options.map(([v, label]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)} className={clsx('rounded-sm px-1 text-[9px] font-bold leading-[15px]', value === v ? 'bg-raise text-ink' : 'text-dim hover:text-muted')}>
          {label}
        </button>
      ))}
    </div>
  )
}
