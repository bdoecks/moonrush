// Market Movement (like Axiom's uVolume): how much is trading on each chain, how busy it is against the daily
// average, and the activity behind it (trades, traders, launches, migrations, graduation rate). Opens from the
// bottom bar next to the Lighthouse; numbers come from the same exact market totals as the Lighthouse.
import clsx from 'clsx'
import { Activity, LineChart } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { CHAIN_IDS, CHAINS } from '../data/chains'
import { tradersOf, vsDailyAverage, windowStats } from '../game/lighthouse'
import { useGame } from '../game/store'
import type { Chain } from '../types'
import { fmtCompact, fmtNum } from '../utils/format'
import { load, save } from '../utils/storage'

type W = '5m' | '1h' | '6h' | '24h'
const SEC: Record<W, number> = { '5m': 300, '1h': 3600, '6h': 21600, '24h': 86400 }
const POINTS: { label: string; sec: number }[] = [{ label: '24H', sec: 86400 }, { label: '6H', sec: 21600 }, { label: '1H', sec: 3600 }, { label: '5M', sec: 300 }]

const change = (now: number, before: number | undefined | null) => (before === undefined || before === null ? null : before > 0 ? now / before - 1 : null)

function Change({ v }: { v: number | null }) {
  if (v === null) return <span className="num text-dim" title="Not enough history yet to compare">—</span>
  const p = v * 100
  return <span className={clsx('num', v > 0 ? 'text-up' : v < 0 ? 'text-down' : 'text-muted')}>{v > 0 ? '+' : ''}{p.toFixed(Math.abs(p) >= 100 ? 0 : 2)}%</span>
}

const mood = (r: number | null) =>
  r === null ? { label: 'Warming up', cls: 'text-dim' } : r >= 2 ? { label: 'Hot', cls: 'text-up' } : r >= 1.3 ? { label: 'Busy', cls: 'text-up' } : r <= 0.5 ? { label: 'Dead', cls: 'text-down' } : r <= 0.75 ? { label: 'Quiet', cls: 'text-warn' } : { label: 'Normal', cls: 'text-muted' }

export function MarketMovementButton() {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ left: 0, bottom: 0 })
  const btn = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  useGame((s) => Math.floor(s.market.tick / 5))
  const market = useGame.getState().market
  const r = vsDailyAverage(market, 300, CHAIN_IDS)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !panel.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', esc)
    }
  }, [open])
  const toggle = () => {
    const b = btn.current?.getBoundingClientRect()
    if (b) setPos({ left: Math.max(8, Math.min(b.left - 40, window.innerWidth - 348)), bottom: Math.max(8, Math.min(window.innerHeight - b.top + 6, window.innerHeight - 560)) })
    setOpen((o) => !o)
  }
  return (
    <>
      <button ref={btn} onClick={toggle} aria-expanded={open} title="Market Movement: volume by chain against the daily average" className={clsx('flex h-[22px] items-center gap-1 rounded-full border px-2 hover:border-line2', open ? 'border-accent/50 bg-accent/10' : 'border-line')}>
        <LineChart size={12} className="text-info" />
        <span className="text-[11px] font-semibold text-muted">Volume</span>
        {r !== null && <span className={clsx('num text-[10px] font-bold', mood(r).cls)}>{r.toFixed(1)}×</span>}
      </button>
      {open && (
        <div ref={panel} className="fixed z-50 max-h-[calc(100vh-16px)] w-[340px] overflow-auto rounded-lg border border-line2 bg-panel p-3 text-ink shadow-2xl" style={{ left: pos.left, bottom: pos.bottom }}>
          <Panel />
        </div>
      )}
    </>
  )
}

function Panel() {
  useGame((s) => s.market.tick) // live
  const market = useGame.getState().market
  const [win, setWin0] = useState<W>(() => load<W>('mmWin') ?? '24h')
  const [tab, setTab0] = useState<'volume' | 'activity'>(() => load<'volume' | 'activity'>('mmTab') ?? 'volume')
  const [chains, setChains0] = useState<Chain[]>(() => (load<Chain[]>('mmChains') ?? CHAIN_IDS).filter((c) => CHAIN_IDS.includes(c)))
  const setWin = (w: W) => (setWin0(w), save('mmWin', w))
  const setTab = (t: 'volume' | 'activity') => (setTab0(t), save('mmTab', t))
  const toggleChain = (c: Chain) => {
    const next = chains.includes(c) ? chains.filter((x) => x !== c) : [...chains, c]
    const keep = next.length ? CHAIN_IDS.filter((x) => next.includes(x)) : CHAIN_IDS // never none
    setChains0(keep)
    save('mmChains', keep)
  }
  const sec = SEC[win]
  const total = windowStats(market, sec, chains)
  const per = chains.map((c) => ({ c, s: windowStats(market, sec, [c]) }))
  const byVol = [...per].sort((a, b) => b.s.volume - a.s.volume)
  const maxVol = Math.max(1, ...per.map((p) => p.s.volume))
  const traders = (n: number) => tradersOf(n)
  const maxTr = Math.max(1, ...per.map((p) => traders(p.s.txns)))

  return (
    <div className="text-[12px]">
      <div className="mb-2 flex items-center gap-2">
        <span className="size-2 rounded-full bg-up pulse-dot" />
        <span className="text-[13px] font-bold">Market Movement</span>
        <div className="ml-auto flex gap-0.5">
          {(Object.keys(SEC) as W[]).map((w) => (
            <button key={w} onClick={() => setWin(w)} className={clsx('rounded px-1.5 py-0.5 text-[11px] font-semibold', w === win ? 'bg-raise text-ink' : 'text-dim hover:text-muted')}>{w}</button>
          ))}
        </div>
      </div>
      <div className="mb-3 inline-flex rounded-md border border-line2 bg-bg p-0.5">
        {(['volume', 'activity'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={clsx('rounded px-3 py-1 text-[11px] font-semibold capitalize', tab === t ? 'bg-raise text-ink' : 'text-dim hover:text-muted')}>{t}</button>
        ))}
      </div>

      {tab === 'volume' ? (
        <>
          <div className="flex items-baseline justify-between">
            <span className="text-[11px] font-semibold text-muted">{win} Total Vol</span>
            <span className="flex items-baseline gap-2"><span className="num text-[15px] font-bold">{fmtCompact(total.volume)}</span><Change v={change(total.volume, total.prev?.volume)} /></span>
          </div>
          <div className="mt-2 space-y-1.5">
            {byVol.map(({ c, s }) => (
              <div key={c} className="grid grid-cols-[18px_minmax(0,1fr)_64px_58px] items-center gap-2">
                <span className="text-center text-[12px] font-bold" style={{ color: CHAINS[c].color }} title={CHAINS[c].name}>{CHAINS[c].glyph}</span>
                <span className="h-1.5 overflow-hidden rounded-full bg-line"><span className="block h-full rounded-full" style={{ width: `${Math.max(2, (s.volume / maxVol) * 100)}%`, background: CHAINS[c].color }} /></span>
                <span className="num text-right">{fmtCompact(s.volume)}</span>
                <span className="text-right text-[11px]"><Change v={change(s.volume, s.prev?.volume)} /></span>
              </div>
            ))}
          </div>

          <div className="mt-4 mb-1 flex items-center gap-1.5 text-[12px] font-semibold"><Activity size={12} className="text-dim" /> Against the daily average</div>
          <DailyChart chains={chains} />
          <div className="mt-2 space-y-1">
            {chains.map((c) => {
              const r = vsDailyAverage(market, 3600, [c])
              const md = mood(r)
              return (
                <div key={c} className="flex items-center gap-2 text-[11px]">
                  <span className="w-4 text-center font-bold" style={{ color: CHAINS[c].color }}>{CHAINS[c].glyph}</span>
                  <span className="text-muted">{CHAINS[c].name}</span>
                  <span className="mx-1 flex-1 border-b border-dotted border-line2" />
                  <span className={clsx('font-semibold', md.cls)}>{md.label}</span>
                  <span className="num w-10 text-right text-ink">{r === null ? '—' : `${r.toFixed(1)}×`}</span>
                </div>
              )
            })}
          </div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Tile label="Total trades" value={fmtCompact(total.txns, '')} ch={change(total.txns, total.prev?.txns)} />
            <Tile label="Traders" value={fmtCompact(traders(total.txns), '')} ch={change(traders(total.txns), total.prev ? traders(total.prev.txns) : null)} />
          </div>
          <div className="mt-3 mb-1.5 text-[12px] font-semibold">Traders by chain</div>
          <div className="space-y-1.5">
            {[...per].sort((a, b) => b.s.txns - a.s.txns).map(({ c, s }) => (
              <div key={c} className="grid grid-cols-[18px_minmax(0,1fr)_56px_58px] items-center gap-2">
                <span className="text-center text-[12px] font-bold" style={{ color: CHAINS[c].color }}>{CHAINS[c].glyph}</span>
                <span className="h-1.5 overflow-hidden rounded-full bg-line"><span className="block h-full rounded-full" style={{ width: `${Math.max(2, (traders(s.txns) / maxTr) * 100)}%`, background: CHAINS[c].color }} /></span>
                <span className="num text-right">{fmtNum(traders(s.txns))}</span>
                <span className="text-right text-[11px]"><Change v={change(traders(s.txns), s.prev ? traders(s.prev.txns) : null)} /></span>
              </div>
            ))}
          </div>
          <div className="mt-3 mb-1.5 text-[12px] font-semibold">Token stats</div>
          <div className="grid grid-cols-2 gap-2">
            <Tile label="Created" value={fmtNum(total.created)} ch={change(total.created, total.prev?.created)} />
            <Tile label="Migrations" value={fmtNum(total.migrated)} ch={change(total.migrated, total.prev?.migrated)} />
          </div>
          <div className="mt-3 mb-1.5 text-[12px] font-semibold">Graduation funnel</div>
          <div className="grid grid-cols-3 gap-1.5">
            {per.map(({ c, s }) => {
              const rate = s.created > 0 ? s.migrated / s.created : 0
              return (
                <div key={c} className="rounded-md border border-line bg-bg px-2 py-1.5" title={`${CHAINS[c].name}: ${s.migrated} of ${s.created} new coins migrated`}>
                  <div className="flex items-center justify-between"><span className="font-bold" style={{ color: CHAINS[c].color }}>{CHAINS[c].glyph}</span><span className="num text-[11px] font-bold">{(rate * 100).toFixed(1)}%</span></div>
                  <div className="num mt-0.5 text-[10px] text-dim">{s.migrated} / {s.created}</div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-line"><div className="h-full rounded-full" style={{ width: `${Math.min(100, rate * 100 * 5)}%`, background: CHAINS[c].color }} /></div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {!total.exact && <p className="mt-2 text-[10px] text-dim">Still building history for this window: numbers are estimates and changes show “—” until the game has watched a full {win}.</p>}

      <div className="mt-3 flex items-center gap-2 border-t border-line pt-2">
        <span className="text-[11px] text-dim">Chains</span>
        <div className="ml-auto flex gap-1">
          {CHAIN_IDS.map((c) => (
            <button key={c} onClick={() => toggleChain(c)} aria-pressed={chains.includes(c)} title={CHAINS[c].name}
              className={clsx('grid size-6 place-items-center rounded-full border text-[12px] font-bold transition-opacity', chains.includes(c) ? 'border-line2 bg-raise' : 'border-line opacity-35')} style={{ color: CHAINS[c].color }}>
              {CHAINS[c].glyph}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function Tile({ label, value, ch }: { label: string; value: string; ch: number | null }) {
  return (
    <div className="rounded-md border border-line bg-bg px-2.5 py-1.5">
      <div className="text-[10px] text-dim">{label}</div>
      <div className="flex items-baseline gap-1.5"><span className="num text-[14px] font-bold">{value}</span><span className="text-[10px]"><Change v={ch} /></span></div>
    </div>
  )
}

/** Each chain's busyness at 24h / 6h / 1h / 5m against its daily average (1× line), log scale. */
function DailyChart({ chains }: { chains: Chain[] }) {
  const market = useGame.getState().market
  const W = 316
  const H = 96
  const padL = 26
  const lo = Math.log(0.25)
  const hi = Math.log(4)
  const y = (r: number) => 6 + (1 - (Math.log(Math.min(4, Math.max(0.25, r))) - lo) / (hi - lo)) * (H - 22)
  const x = (i: number) => padL + (i / (POINTS.length - 1)) * (W - padL - 8)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      {[4, 2, 1, 0.5].map((r) => (
        <g key={r}>
          <line x1={padL} x2={W - 8} y1={y(r)} y2={y(r)} stroke={r === 1 ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.06)'} strokeDasharray={r === 1 ? '3 3' : undefined} />
          <text x={2} y={y(r) + 3} fontSize="8" fill="#5b6370">{r}×</text>
        </g>
      ))}
      <text x={padL + 3} y={y(1) - 3} fontSize="8" fill="#8b93a1">daily average</text>
      {chains.map((c) => {
        const pts = POINTS.map((p, i) => [x(i), y(i === 0 ? 1 : vsDailyAverage(market, p.sec, [c]) ?? 1)] as const)
        return (
          <g key={c}>
            <polyline points={pts.map(([a, b]) => `${a},${b}`).join(' ')} fill="none" stroke={CHAINS[c].color} strokeWidth="1.6" strokeLinejoin="round" opacity="0.9" />
            {pts.map(([a, b], i) => <circle key={i} cx={a} cy={b} r="2.2" fill="#0c0e11" stroke={CHAINS[c].color} strokeWidth="1.2" />)}
          </g>
        )
      })}
      {POINTS.map((p, i) => <text key={p.label} x={x(i)} y={H - 3} fontSize="8.5" fill="#8b93a1" textAnchor={i === 0 ? 'start' : i === POINTS.length - 1 ? 'end' : 'middle'}>{p.label}</text>)}
    </svg>
  )
}
