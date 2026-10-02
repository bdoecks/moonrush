// Market Lighthouse: the button in the bottom bar (the three busiest launchpads) and the panel it opens.
import clsx from 'clsx'
import { BarChart3, ChevronDown, Coins, Link2, Rocket, Users } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { CHAINS } from '../data/chains'
import { LAUNCHPADS } from '../data/launchpads'
import { lighthouse, LIGHTHOUSE_CHAINS, sampleLighthouse, type Stat } from '../game/lighthouse'
import { useGame } from '../game/store'
import type { Chain, PadId, Win } from '../types'
import { fmtCompact, fmtNum } from '../utils/format'
import { load, save } from '../utils/storage'
import { PadBadge } from './pad'

// Keep the market's history while the game runs (the panel needs it for "vs the window before").
useGame.subscribe((s, prev) => {
  if (s.market.tick !== prev.market.tick) sampleLighthouse(s.market)
})

const WINS: Win[] = ['5m', '1h', '24h']

function Change({ v, className }: { v: number | null; className?: string }) {
  if (v === null) return <span className={clsx('num text-dim', className)} title="Not enough history yet to compare">—</span>
  const p = v * 100
  const big = Math.abs(p) >= 1000
  return <span className={clsx('num', v > 0 ? 'text-up' : v < 0 ? 'text-down' : 'text-muted', className)}>{v > 0 ? '+' : ''}{p.toFixed(big ? 0 : Math.abs(p) >= 100 ? 1 : 2)}%</span>
}

export function LighthouseButton() {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ left: 0, bottom: 0 })
  const btn = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  useGame((s) => Math.floor(s.market.tick / 5)) // refresh the three icons now and then
  const market = useGame.getState().market
  const filter = useGame((s) => s.chainFilter)
  const top = lighthouse(market, '5m', filter).pads.slice(0, 3)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!panel.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', esc)
    }
  }, [open])
  const toggle = () => {
    const r = btn.current?.getBoundingClientRect()
    // Opens upward from the button; on a short screen it's kept fully on screen (it may then cover the button).
    if (r) setPos({ left: Math.max(8, Math.min(r.left - 40, window.innerWidth - 328)), bottom: Math.max(8, Math.min(window.innerHeight - r.top + 6, window.innerHeight - 500)) })
    setOpen((o) => !o)
  }
  return (
    <>
      <button ref={btn} onClick={toggle} aria-expanded={open} title="Market Lighthouse: the whole market at a glance" className={clsx('flex h-[22px] items-center gap-1 rounded-full border px-2 hover:border-line2', open ? 'border-accent/50 bg-accent/10' : 'border-line')}>
        {top.map((r) => <PadBadge key={r.pad} pad={r.pad} size={12} />)}
        <span className="text-[11px] font-semibold text-muted">Lighthouse</span>
      </button>
      {open && (
        <div ref={panel} className="fixed z-50 max-h-[calc(100vh-16px)] w-[320px] overflow-auto rounded-lg border border-line2 bg-panel p-3 text-ink shadow-2xl" style={{ left: pos.left, bottom: pos.bottom }}>
          <Panel />
        </div>
      )}
    </>
  )
}

function Panel() {
  useGame((s) => s.market.tick) // live
  const market = useGame.getState().market
  const [win, setWin0] = useState<Win>(() => load<Win>('lighthouseWin') ?? '5m')
  const [chain, setChain0] = useState<'all' | Chain>(() => load<'all' | Chain>('lighthouseChain') ?? 'all')
  const [hover, setHover] = useState<PadId | null>(null)
  const [chainOpen, setChainOpen] = useState(false)
  const setWin = (w: Win) => {
    setWin0(w)
    save('lighthouseWin', w)
  }
  const setChain = (c: 'all' | Chain) => {
    setChain0(c)
    save('lighthouseChain', c)
    setChainOpen(false)
    setHover(null)
  }
  // The launchpad you're pointing at takes over the numbers; the lists stay the chain's.
  const all = lighthouse(market, win, chain)
  const d = hover ? lighthouse(market, win, chain, hover) : all
  const share = d.buys + d.sells > 0 ? d.buys / (d.buys + d.sells) : 0.5
  const title = hover ? `${LAUNCHPADS[hover].name} Lighthouse` : chain === 'all' ? 'Market Lighthouse' : `${CHAINS[chain].name} Lighthouse`

  return (
    <div className="text-[12px]">
      <div className="mb-2.5 flex items-center gap-2">
        <div className="relative">
          <button onClick={() => setChainOpen((o) => !o)} className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-raise" title="Chain">
            <span className="text-[13px] font-bold" style={chain === 'all' ? undefined : { color: CHAINS[chain].color }}>{chain === 'all' ? '◈' : CHAINS[chain].glyph}</span>
            <ChevronDown size={11} className="text-muted" />
          </button>
          {chainOpen && (
            <div className="absolute left-0 top-full z-10 mt-1 w-36 rounded-md border border-line2 bg-panel p-1 shadow-xl">
              {LIGHTHOUSE_CHAINS.map((c) => (
                <button key={c} onClick={() => setChain(c)} className={clsx('flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[12px] hover:bg-raise', c === chain && 'bg-raise')}>
                  <span className="w-4 text-center" style={c === 'all' ? undefined : { color: CHAINS[c].color }}>{c === 'all' ? '◈' : CHAINS[c].glyph}</span>
                  {c === 'all' ? 'All chains' : CHAINS[c].name}
                </button>
              ))}
            </div>
          )}
        </div>
        <span className="flex min-w-0 items-center gap-1.5 font-semibold"><span className="size-1.5 shrink-0 rounded-full bg-up pulse-dot" /><span className="truncate">{title}</span></span>
        <div className="ml-auto flex shrink-0 gap-0.5">
          {WINS.map((w) => (
            <button key={w} onClick={() => setWin(w)} aria-pressed={win === w} className={clsx('rounded px-1.5 py-0.5 text-[11px] font-semibold', win === w ? 'bg-raise text-ink' : 'text-dim hover:text-ink')}>{w}</button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Box label="Total TXs" icon={<BarChart3 size={13} />} stat={d.txns} fmt={fmtNum} />
        <Box label="Traders" icon={<Users size={13} />} stat={d.traders} fmt={fmtNum} tip="Estimated from the number of trades" />
      </div>

      <div className="mt-3 flex items-baseline justify-between">
        <span className="text-[11px] text-muted">{win} Vol</span>
        <span className="num text-[14px] font-bold">{fmtCompact(d.volume.value)} <Change v={d.volume.change} className="text-[12px] font-semibold" /></span>
      </div>
      <div className="mt-1.5 flex h-[4px] gap-0.5 overflow-hidden rounded-full">
        <span className="bg-up transition-all duration-500" style={{ width: `${share * 100}%` }} />
        <span className="flex-1 bg-down" />
      </div>
      <div className="mt-1 flex justify-between text-[11px]">
        <span className="num text-up" title="Buys: how many / how much">{fmtNum(d.buys)} / {fmtCompact(d.buyVolume)}</span>
        <span className="num text-down" title="Sells: how many / how much">{fmtNum(d.sells)} / {fmtCompact(d.sellVolume)}</span>
      </div>

      <div className="mb-1.5 mt-3 flex items-center gap-1.5 text-[11px] font-semibold text-muted"><Coins size={12} /> Token Stats</div>
      <div className="grid grid-cols-2 gap-2">
        <Box label="Created" icon={<Rocket size={13} />} stat={d.created} fmt={fmtNum} />
        <Box label="Migrations" icon={<Link2 size={13} className="text-warn" />} stat={d.migrated} fmt={fmtNum} warn />
      </div>

      <div className="mb-1.5 mt-3 text-[11px] font-semibold text-muted">Top Launchpads <span className="font-normal text-dim">· point at one for its numbers</span></div>
      <div className="grid grid-cols-3 gap-1.5" onMouseLeave={() => setHover(null)}>
        {all.pads.slice(0, 3).map((r) => (
          <button key={r.pad} onMouseEnter={() => setHover(r.pad)} onFocus={() => setHover(r.pad)} title={`${LAUNCHPADS[r.pad].name} volume`} className={clsx('flex items-center gap-1.5 rounded-full border px-1.5 py-1 text-left transition-colors', hover === r.pad ? 'bg-raise' : 'border-line2')} style={hover === r.pad ? { borderColor: LAUNCHPADS[r.pad].color } : undefined}>
            <PadBadge pad={r.pad} size={22} className="!rounded-full" />
            <span className="min-w-0 leading-tight">
              <span className="num block truncate text-[11px] font-bold" style={{ color: LAUNCHPADS[r.pad].color }}>{fmtCompact(r.volume.value)}</span>
              <Change v={r.volume.change} className="block text-[10px]" />
            </span>
          </button>
        ))}
      </div>

      <div className="mb-1.5 mt-3 text-[11px] font-semibold text-muted">Top Protocols</div>
      <div className="grid grid-cols-3 gap-1.5">
        {all.dexes.slice(0, 3).map((r) => (
          <div key={r.dex} title={`${r.dex}: volume of coins that migrated there`} className="flex items-center gap-1.5 rounded-full border border-line2 px-1.5 py-1">
            <span className="grid size-[22px] shrink-0 place-items-center rounded-full text-[9px] font-extrabold" style={{ background: LAUNCHPADS[r.pad].bg, color: LAUNCHPADS[r.pad].color, boxShadow: `inset 0 0 0 1px ${LAUNCHPADS[r.pad].color}66` }}>{r.dex.slice(0, 2).toUpperCase()}</span>
            <span className="min-w-0 leading-tight">
              <span className="num block truncate text-[11px] font-bold">{fmtCompact(r.volume.value)}</span>
              <Change v={r.volume.change} className="block text-[10px]" />
            </span>
          </div>
        ))}
      </div>
      <div className="mt-2 truncate text-[10px] text-dim">{all.dexes.slice(0, 3).map((r) => r.dex).join(' · ')}</div>
      {!d.exact && <div className="mt-2 rounded border border-line px-2 py-1 text-[10px] text-dim">Still counting: these become exact (with % changes) once you've been in this market for {win === '5m' ? '5 minutes' : win === '1h' ? 'an hour' : '24 hours'}. Until then they're a low estimate.</div>}
    </div>
  )
}

function Box({ label, icon, stat, fmt, tip, warn }: { label: string; icon: React.ReactNode; stat: Stat; fmt: (n: number) => string; tip?: string; warn?: boolean }) {
  return (
    <div className="rounded-md border border-line px-2.5 py-2" title={tip}>
      <div className="text-[10px] text-dim">{label}</div>
      <div className="mt-0.5 flex items-center justify-between gap-1">
        <span className={clsx('num flex items-center gap-1 text-[14px] font-bold', warn && 'text-warn')}>{icon}{fmt(Math.round(stat.value))}</span>
        <Change v={stat.change} className="text-[12px] font-semibold" />
      </div>
    </div>
  )
}
