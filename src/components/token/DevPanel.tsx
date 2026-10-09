// The dev panel: on a coin you launched, one-click buys and sells from that coin's DEV wallet (the wallet that
// deployed it), whatever wallets you have selected for normal trading. Looks and drags like Instant Trade.
// Only the dev wallet's trades are the dev's: they show as dev buys and sells to everyone, move the coin's dev share,
// and a dev sell costs the coin some of its crowd. Your other wallets trade as anybody else.
import clsx from 'clsx'
import { GripHorizontal, X } from 'lucide-react'
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { CHAINS, fmtNative } from '../../data/chains'
import { DEV_EMOJI } from '../../game/accounts'
import { SUPPLY } from '../../game/marketEngine'
import { useGame } from '../../game/store'
import type { Token } from '../../types'
import { fmtCompact } from '../../utils/format'
import { load, save } from '../../utils/storage'

const W = 280
const SELL_PCTS = [10, 25, 50, 100]
const clampPos = (p: { x: number; y: number }) => ({
  x: Math.min(Math.max(8, p.x), Math.max(8, window.innerWidth - W - 8)),
  y: Math.min(Math.max(56, p.y), Math.max(56, window.innerHeight - 220)),
})

/** Mounted on the coin page: shows only on a coin you launched yourself. */
export function DevPanel({ t }: { t: Token }) {
  const mine = t.creator === 'you'
  const live = t.status === 'bonding' || t.status === 'graduated'
  return mine && live ? <Panel t={t} /> : null
}

function Panel({ t }: { t: Token }) {
  const chain = t.chain
  const c = CHAINS[chain]
  // The wallet that deployed this coin (your first wallet on launches from before dev wallets).
  const devId = useGame((s) => s.launches.find((l) => l.tokenId === t.id)?.devWallet ?? s.portfolio.accounts?.[0]?.id ?? 'w-main')
  const dev = useGame((s) => s.portfolio.accounts?.find((a) => a.id === devId))
  const px = useGame((s) => s.market.native?.[chain]?.price ?? c.basePrice)
  const cash = useGame((s) => s.portfolio.cash)
  const autoSwap = useGame((s) => s.settings.autoSwap)
  const running = useGame((s) => s.runStatus === 'running')
  const buyFromWallet = useGame((s) => s.buyFromWallet)
  const sell = useGame((s) => s.sell)
  const [open, setOpen] = useState(() => load<boolean>('devPanelOpen') ?? window.innerWidth >= 768) // (a phone starts with it closed: it would cover the chart)
  const [pos2d, setPos] = useState(() => clampPos(load<{ x: number; y: number }>('devPanelPos') ?? { x: window.innerWidth - W - 24, y: 150 }))
  const [customBuy, setCustomBuy] = useState('')
  const [customSell, setCustomSell] = useState('')
  const drag = useRef<{ dx: number; dy: number } | null>(null)
  // Kept on screen whatever the window has become since it was placed (a narrower window, a turned phone).
  const [, redraw] = useState(0)
  useEffect(() => {
    const on = () => redraw((n) => n + 1)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])

  const show = (v: boolean) => {
    setOpen(v)
    save('devPanelOpen', v)
  }
  if (!open) {
    return (
      <button data-tut="dev-panel-open" onClick={() => show(true)} title="Open the dev panel: buy and sell from this coin's dev wallet" className="fixed bottom-24 right-3 z-30 flex items-center gap-1 rounded-full border border-warn/50 bg-panel px-2.5 py-1 text-[11px] font-bold text-warn shadow-lg md:bottom-16">
        {DEV_EMOJI} Dev panel
      </button>
    )
  }

  const qty = dev?.positions[t.id]?.qty ?? 0
  const bal = dev?.balances[chain] ?? 0
  const pct = (qty / SUPPLY) * 100
  // What the dev wallet can spend: its own coin, plus the USD bank when auto-swap is on.
  const spendable = bal + (autoSwap ? cash / px : 0)
  const buy = (amount: number) => {
    if (running && amount > 0) buyFromWallet(devId, amount * px, t.id)
  }
  const sellPct = (p: number) => {
    if (running && qty > 0 && p > 0) sell(p >= 100 ? qty : (qty * p) / 100, t.id, undefined, devId)
  }
  const num = (s: string) => Number(s.replace(',', '.'))
  const cb = num(customBuy)
  const cs = num(customSell)

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button, input')) return
    drag.current = { dx: e.clientX - pos2d.x, dy: e.clientY - pos2d.y }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current) setPos(clampPos({ x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy }))
  }
  const onUp = () => {
    if (drag.current) save('devPanelPos', pos2d)
    drag.current = null
  }
  const at = clampPos(pos2d)
  const btn = 'num h-8 rounded-md border text-[12px] font-bold disabled:opacity-40'
  const field = 'num h-8 min-w-0 flex-1 rounded-md border border-line2 bg-bg px-2 text-[12px] outline-none'

  return (
    <div role="region" aria-label="Dev panel" className="fixed z-30 rounded-lg border border-warn/40 bg-panel/95 shadow-2xl backdrop-blur" style={{ left: at.x, top: at.y, width: W }}>
      <div onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} className="flex cursor-grab touch-none items-center gap-2 border-b border-line px-2.5 py-1.5 active:cursor-grabbing">
        <GripHorizontal size={14} className="text-dim" />
        <span className="text-[13px]">{DEV_EMOJI}</span>
        <span className="text-[12px] font-bold text-warn">Dev</span>
        <span className="truncate text-[11px] text-muted">{t.ticker}</span>
        <span className="ml-auto truncate text-[10px] text-dim" title="This coin's dev wallet: the one that deployed it">{dev ? `${dev.emoji} ${dev.name}` : 'Dev wallet'}</span>
        <button onClick={() => show(false)} className="rounded p-1 text-dim hover:text-ink" title="Close" aria-label="Close dev panel"><X size={14} /></button>
      </div>

      <div className="grid grid-cols-3 gap-1 border-b border-line px-2.5 py-1.5 text-center">
        <div><div className="text-[9px] uppercase tracking-wider text-dim">Dev bag</div><div className={clsx('num text-[12px] font-bold', pct > 8 ? 'text-down' : 'text-ink')}>{pct.toFixed(2)}%</div></div>
        <div><div className="text-[9px] uppercase tracking-wider text-dim">Worth</div><div className="num text-[12px] font-bold">{fmtCompact(qty * t.price)}</div></div>
        <div><div className="text-[9px] uppercase tracking-wider text-dim">Wallet</div><div className="num text-[12px] font-bold">{fmtNative(bal, chain, false)}</div></div>
      </div>

      <div className="space-y-2 p-2.5">
        <div>
          <div className="mb-1 flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-up">Dev buy <span className="font-normal normal-case tracking-normal text-dim">in {c.native}</span></div>
          <div className="grid grid-cols-4 gap-1">
            {(c.presets[0] ?? c.quick).slice(0, 4).map((a) => (
              <button key={a} disabled={!running || a > spendable + 1e-9} onClick={() => buy(a)} aria-label={`Dev buy ${a} ${c.native}`} className={clsx(btn, 'border-up/40 bg-up/10 text-up hover:bg-up/20')}>{a}</button>
            ))}
          </div>
          <div className="mt-1 flex gap-1">
            <input value={customBuy} onChange={(e) => setCustomBuy(e.target.value)} inputMode="decimal" placeholder={`Other amount (${c.native})`} aria-label="Dev buy amount" className={clsx(field, 'focus:border-up/60')} />
            <button disabled={!running || !(cb > 0) || cb > spendable + 1e-9} onClick={() => { buy(cb); setCustomBuy('') }} className={clsx(btn, 'border-up/40 px-3 text-up hover:bg-up/10')}>Buy</button>
          </div>
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-down">Dev sell <span className="font-normal normal-case tracking-normal text-dim">% of the dev bag</span></div>
          <div className="grid grid-cols-4 gap-1">
            {SELL_PCTS.map((p) => (
              <button key={p} disabled={!running || !(qty > 0)} onClick={() => sellPct(p)} aria-label={`Dev sell ${p}%`} className={clsx(btn, 'border-down/40 bg-down/10 text-down hover:bg-down/20')}>{p}%</button>
            ))}
          </div>
          <div className="mt-1 flex gap-1">
            <input value={customSell} onChange={(e) => setCustomSell(e.target.value)} inputMode="decimal" placeholder="Other %" aria-label="Dev sell percent" className={clsx(field, 'focus:border-down/60')} />
            <button disabled={!running || !(qty > 0) || !(cs > 0) || cs > 100} onClick={() => { sellPct(cs); setCustomSell('') }} className={clsx(btn, 'border-down/40 px-3 text-down hover:bg-down/10')}>Sell</button>
          </div>
        </div>
        <p className="text-[10px] leading-snug text-dim">Trades here come from the dev wallet, so everyone sees them as the dev. A dev sell costs the coin some of its crowd. Your other wallets trade as anybody else.</p>
      </div>
    </div>
  )
}
