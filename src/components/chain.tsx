import clsx from 'clsx'
import { ArrowDownUp, Wallet, Zap } from 'lucide-react'
import { useState } from 'react'
import { CHAIN_IDS, CHAINS, fmtNative } from '../data/chains'
import { useGame } from '../game/store'
import { nativePrice, SWAP_FEE, type Asset } from '../game/tradingEngine'
import type { Chain, Token } from '../types'
import { fmtUsd } from '../utils/format'
import { Modal } from './ui'

export function ChainBadge({ chain, className, withName }: { chain: Chain; className?: string; withName?: boolean }) {
  const c = CHAINS[chain]
  return (
    <span
      title={`${c.name} · paid in ${c.native}`}
      className={clsx('inline-flex shrink-0 items-center gap-0.5 rounded border px-1 text-[9px] font-bold leading-[14px]', className)}
      style={{ color: c.color, borderColor: `${c.color}55`, background: `${c.color}14` }}
    >
      <span>{c.glyph}</span>
      {withName ? c.name : c.short}
    </span>
  )
}

/** One-click buy of the P-slot amount in the token's chain coin. */
export function QuickBuyButton({ t, className, label }: { t?: Token; className?: string; label?: string }) {
  const slot = useGame((s) => s.settings.quickSlot)
  const buyNative = useGame((s) => s.buyNative)
  const dead = !t || t.status === 'rugged' || t.status === 'dead'
  const chain = t?.chain ?? 'sol'
  const amt = CHAINS[chain].quick[slot] ?? CHAINS[chain].quick[1]
  return (
    <button
      disabled={dead}
      onClick={(e) => {
        e.stopPropagation()
        if (t) buyNative(amt, t.id, slot)
      }}
      title={`Quick buy ${fmtNative(amt, chain)} (P${slot + 1} trade settings)`}
      className={clsx('inline-flex items-center gap-0.5 whitespace-nowrap rounded-md border border-up/30 bg-up/10 px-2 py-1 text-[11px] font-bold text-up transition-all hover:bg-up hover:text-black disabled:pointer-events-none disabled:opacity-30', className)}
    >
      <Zap size={11} fill="currentColor" />
      {label}
      {fmtNative(amt, chain, false)}
      <span className="text-[9px] opacity-80">{CHAINS[chain].native}</span>
    </button>
  )
}

/** P1/P2/P3 quick-buy slot picker. Shows the amount for the filtered chain (or all three on hover). */
export function QuickSlotPicker() {
  const slot = useGame((s) => s.settings.quickSlot)
  const filter = useGame((s) => s.chainFilter)
  const updateSettings = useGame((s) => s.updateSettings)
  const show: Chain = filter === 'all' ? 'sol' : filter
  return (
    <div className="flex items-center gap-1">
      <span className="flex h-6 items-center gap-0.5 rounded border border-line2 bg-bg px-1.5 num text-[11px]" title={CHAIN_IDS.map((c) => fmtNative(CHAINS[c].quick[slot], c)).join(' · ')}>
        <Zap size={10} className="text-up" fill="currentColor" />
        {filter === 'all' ? `P${slot + 1}` : fmtNative(CHAINS[show].quick[slot], show)}
      </span>
      <div className="flex rounded border border-line2 bg-bg p-px">
        {[0, 1, 2].map((i) => (
          <button
            key={i}
            onClick={() => updateSettings({ quickSlot: i })}
            title={`Quick buy: ${CHAIN_IDS.map((c) => fmtNative(CHAINS[c].quick[i], c)).join(' · ')}`}
            className={clsx('rounded-sm px-1.5 py-0.5 text-[10px] font-bold', slot === i ? 'bg-up/15 text-up' : 'text-dim hover:text-ink')}
          >
            P{i + 1}
          </button>
        ))}
      </div>
    </div>
  )
}

export function ChainSwitcher() {
  const filter = useGame((s) => s.chainFilter)
  const setFilter = useGame((s) => s.setChainFilter)
  return (
    <div className="flex items-center rounded-md border border-line bg-panel2 p-0.5">
      {(['all', ...CHAIN_IDS] as const).map((c) => {
        const active = filter === c
        const meta = c === 'all' ? null : CHAINS[c]
        return (
          <button
            key={c}
            onClick={() => setFilter(c)}
            title={meta ? `${meta.name} · pay with ${meta.native}` : 'All chains'}
            className={clsx('flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold transition-colors', active ? 'bg-raise' : 'text-dim hover:text-ink')}
            style={active && meta ? { color: meta.color } : undefined}
          >
            {meta && <span>{meta.glyph}</span>}
            {meta ? meta.short : 'ALL'}
          </button>
        )
      })}
    </div>
  )
}

/** Compact balances; opens the swap modal. */
export function WalletChip({ compact }: { compact?: boolean }) {
  const cash = useGame((s) => s.portfolio.cash)
  const balances = useGame((s) => s.portfolio.balances)
  const setSwapOpen = useGame((s) => s.setSwapOpen)
  return (
    <button onClick={() => setSwapOpen(true)} title="Wallet balances · click to swap" className="flex items-center gap-2 rounded-md border border-line bg-panel2 px-2 py-1 text-[10px] hover:border-line2">
      <Wallet size={12} className="text-muted" />
      {CHAIN_IDS.map((c) => (
        <span key={c} className="num flex items-center gap-0.5" style={{ color: CHAINS[c].color }}>
          {CHAINS[c].glyph}
          <span className="text-ink">{fmtNative(balances?.[c] ?? 0, c, false)}</span>
        </span>
      ))}
      {!compact && <span className="num text-muted">$ <span className="text-ink">{Math.round(cash).toLocaleString('en-US')}</span></span>}
      <ArrowDownUp size={11} className="text-accent" />
    </button>
  )
}

const ASSETS: Asset[] = ['usd', 'sol', 'bsc', 'hood']
const assetLabel = (a: Asset) => (a === 'usd' ? 'USD' : CHAINS[a].native)

function Picker({ value: v, onChange }: { value: Asset; onChange: (a: Asset) => void }) {
  return (
    <div className="flex gap-1">
      {ASSETS.map((a) => (
        <button
          key={a}
          onClick={() => onChange(a)}
          className={clsx('rounded-md border px-2 py-1 text-[11px] font-bold', v === a ? 'border-accent/60 bg-accent/10 text-ink' : 'border-line2 text-muted hover:text-ink')}
          style={v === a && a !== 'usd' ? { color: CHAINS[a].color } : undefined}
        >
          {a !== 'usd' && CHAINS[a].glyph} {assetLabel(a)}
        </button>
      ))}
    </div>
  )
}

export function SwapModal() {
  const open = useGame((s) => s.swapOpen)
  const setOpen = useGame((s) => s.setSwapOpen)
  const market = useGame((s) => s.market)
  const cash = useGame((s) => s.portfolio.cash)
  const balances = useGame((s) => s.portfolio.balances)
  const swapAssets = useGame((s) => s.swapAssets)
  const autoSwap = useGame((s) => s.settings.autoSwap)
  const updateSettings = useGame((s) => s.updateSettings)
  const filter = useGame((s) => s.chainFilter)
  const [from, setFrom] = useState<Asset>('usd')
  const [to, setTo] = useState<Asset>(filter === 'all' ? 'sol' : filter)
  const [amount, setAmount] = useState('')
  if (!open) return null
  const have = (a: Asset) => (a === 'usd' ? cash : balances?.[a] ?? 0)
  const usdPer = (a: Asset) => (a === 'usd' ? 1 : nativePrice(market, a))
  const value = parseFloat(amount) || 0
  const out = value > 0 && from !== to ? (value * usdPer(from) * (1 - SWAP_FEE)) / usdPer(to) : 0
  const fmt = (a: Asset, n: number) => (a === 'usd' ? fmtUsd(n) : fmtNative(n, a))
  const split = () => {
    // Quick split of half your USD: 50% SOL, 25% BNB, 25% ETH.
    const pot = cash / 2
    if (pot < 1) return
    swapAssets('usd', 'sol', pot * 0.5)
    swapAssets('usd', 'bsc', pot * 0.25)
    swapAssets('usd', 'hood', pot * 0.25)
  }

  return (
    <Modal title={<span className="flex items-center gap-2"><ArrowDownUp size={14} className="text-accent" /> Swap</span>} onClose={() => setOpen(false)}>
      <div className="space-y-3 text-[12px]">
        <div className="grid grid-cols-2 gap-2">
          {ASSETS.map((a) => (
            <div key={a} className="rounded-md border border-line bg-bg px-2.5 py-1.5">
              <div className="flex items-center justify-between text-[10px] text-dim">
                <span>{a === 'usd' ? 'USD cash' : `${CHAINS[a].native} · ${CHAINS[a].name}`}</span>
                {a !== 'usd' && <span className="num">{fmtUsd(usdPer(a), 2)}</span>}
              </div>
              <div className="num font-bold">{fmt(a, have(a))}</div>
              {a !== 'usd' && <div className="num text-[10px] text-muted">≈ {fmtUsd(have(a) * usdPer(a))}</div>}
            </div>
          ))}
        </div>
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wider text-dim">From</div>
          <Picker value={from} onChange={(a) => { setFrom(a); if (a === to) setTo(a === 'usd' ? 'sol' : 'usd') }} />
          <div className="mt-1.5 flex items-center rounded-md border border-line2 bg-bg px-2 focus-within:border-accent/60">
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="0" className="num h-9 w-full bg-transparent text-[15px] font-semibold outline-none" aria-label="Swap amount" />
            <span className="text-muted">{assetLabel(from)}</span>
            <button onClick={() => setAmount(String(Math.floor(have(from) * 1e6) / 1e6))} className="ml-2 rounded bg-raise px-1.5 py-0.5 text-[10px] font-bold text-accent">MAX</button>
          </div>
        </div>
        <div className="flex justify-center">
          <button onClick={() => { setFrom(to); setTo(from) }} className="rounded-full border border-line2 bg-raise p-1.5 text-muted hover:text-ink" aria-label="Flip"><ArrowDownUp size={14} /></button>
        </div>
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wider text-dim">To</div>
          <Picker value={to} onChange={(a) => { setTo(a); if (a === from) setFrom(a === 'usd' ? 'sol' : 'usd') }} />
          <div className="mt-1.5 rounded-md border border-line bg-bg px-2 py-2 num text-[15px] font-semibold text-muted">≈ {fmt(to, out)}</div>
          <div className="mt-1 text-[10px] text-dim">Rate 1 {assetLabel(from)} = {(usdPer(from) / usdPer(to)).toPrecision(5)} {assetLabel(to)} · fee {SWAP_FEE * 100}% · simulated prices</div>
        </div>
        <button
          disabled={!(value > 0) || from === to}
          onClick={() => { if (swapAssets(from, to, value)) setAmount('') }}
          className="flex h-10 w-full items-center justify-center gap-1.5 rounded-md bg-accent text-[13px] font-extrabold text-accent-ink hover:brightness-110 disabled:opacity-40"
        >
          <ArrowDownUp size={14} /> Swap {value > 0 ? `${fmt(from, value)} → ${fmt(to, out)}` : ''}
        </button>
        <button onClick={split} className="h-9 w-full rounded-md border border-line2 text-[12px] font-semibold text-muted hover:text-ink">
          Quick split half my USD · 50% SOL / 25% BNB / 25% ETH
        </button>
        <label className="flex cursor-pointer items-center justify-between gap-3 rounded-md border border-line bg-bg px-3 py-2">
          <span>
            <span className="block font-semibold">Auto-swap when short</span>
            <span className="block text-[10px] text-dim">If a buy needs more SOL / BNB / ETH than you hold, swap the gap from USD automatically</span>
          </span>
          <input type="checkbox" checked={autoSwap} onChange={(e) => updateSettings({ autoSwap: e.target.checked })} className="size-4 accent-[var(--accent)]" />
        </label>
      </div>
    </Modal>
  )
}
