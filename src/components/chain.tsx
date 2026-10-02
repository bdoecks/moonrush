import clsx from 'clsx'
import { ArrowDownUp, ChevronDown, ExternalLink, Wallet, Zap } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { CHAIN_IDS, CHAINS, fmtNative } from '../data/chains'
import { useGame } from '../game/store'
import { nativePrice, SWAP_FEE, type Asset } from '../game/tradingEngine'
import type { Chain, Settings, Token, TrenchColumn } from '../types'
import { fmtUsd } from '../utils/format'
import { load, save } from '../utils/storage'
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

/** A Trenches column's quick buy for a chain: its own P slot and amount (Axiom Pulse), else the global ones. */
export function columnQuick(settings: Settings, col: TrenchColumn, chain: Chain) {
  const q = settings.trenchQuick?.[col]
  const slot = q?.slot ?? settings.quickSlot
  const custom = q?.amount?.[chain]
  return { slot, amount: custom && custom > 0 ? custom : CHAINS[chain].quick[slot] ?? CHAINS[chain].quick[1], custom: !!(custom && custom > 0) }
}

/** One-click buy of the P-slot amount in the token's chain coin (a Trenches column passes its own slot / amount). */
export function QuickBuyButton({ t, className, label, col }: { t?: Token; className?: string; label?: string; col?: TrenchColumn }) {
  const buyNative = useGame((s) => s.buyNative)
  const openAfter = useGame((s) => !!s.settings.quickBuyOpen)
  const select = useGame((s) => s.select)
  const dead = !t || t.status === 'rugged' || t.status === 'dead'
  const chain = t?.chain ?? 'sol'
  const slot = useGame((s) => (col ? columnQuick(s.settings, col, chain).slot : s.settings.quickSlot))
  const amt = useGame((s) => (col ? columnQuick(s.settings, col, chain).amount : CHAINS[chain].quick[s.settings.quickSlot] ?? CHAINS[chain].quick[1]))
  return (
    <button
      disabled={dead}
      onClick={(e) => {
        e.stopPropagation()
        // Optionally jump to the coin's page once the buy goes through (GMGN's "open after buy").
        if (t && buyNative(amt, t.id, slot) && openAfter) select(t.id)
      }}
      title={`Quick buy ${fmtNative(amt, chain)} (P${slot + 1} trade settings)${openAfter ? ', then open the coin' : ''}`}
      className={clsx('inline-flex items-center gap-0.5 whitespace-nowrap rounded-md border border-up/30 bg-up/10 px-2 py-1 text-[11px] font-bold text-up transition-all hover:bg-up hover:text-black disabled:pointer-events-none disabled:opacity-30', className)}
    >
      <Zap size={11} fill="currentColor" />
      {label}
      {fmtNative(amt, chain, false)}
      <span className="text-[9px] opacity-80">{CHAINS[chain].native}</span>
    </button>
  )
}

/**
 * A Trenches column's own quick buy (Axiom Pulse / GMGN): type the ⚡ amount, pick its P1/P2/P3 fee preset. Amounts are
 * per chain; with ALL chains showing, the chain chip picks which chain's amount you're editing.
 */
export function ColumnQuickPicker({ col, title }: { col: TrenchColumn; title: string }) {
  const filter = useGame((s) => s.chainFilter)
  const settings = useGame((s) => s.settings)
  const updateSettings = useGame((s) => s.updateSettings)
  const [editChain, setEditChain] = useState<Chain>('sol')
  const chain: Chain = filter === 'all' ? editChain : filter
  const { slot, amount, custom } = columnQuick(settings, col, chain)
  const [draft, setDraft] = useState<string | null>(null)
  const set = (patch: { slot?: number; amount?: number | null }) => {
    const cur = settings.trenchQuick?.[col] ?? { slot: settings.quickSlot }
    const amounts = { ...(cur.amount ?? {}) }
    if (patch.amount === null) delete amounts[chain]
    else if (patch.amount !== undefined) amounts[chain] = patch.amount
    updateSettings({ trenchQuick: { ...(settings.trenchQuick ?? {}), [col]: { slot: patch.slot ?? cur.slot, amount: amounts } } })
  }
  const commit = () => {
    if (draft === null) return
    const n = Number(draft)
    // Empty = back to the P slot's default amount; nonsense is ignored.
    if (draft.trim() === '') set({ amount: null })
    else if (n > 0 && Number.isFinite(n)) set({ amount: Math.min(n, 1e6) })
    setDraft(null)
  }
  return (
    <div className="flex shrink-0 items-center gap-1">
      <label className={clsx('flex h-6 items-center gap-0.5 rounded border bg-bg pl-1 pr-0.5', custom ? 'border-up/50' : 'border-line2')} title={`${title} quick buy amount in ${CHAINS[chain].native} (empty = the P${slot + 1} default)`}>
        <Zap size={10} className="shrink-0 text-up" fill="currentColor" />
        <input
          value={draft ?? String(amount)}
          onChange={(e) => setDraft(e.target.value.replace(/[^0-9.]/g, ''))}
          onFocus={(e) => e.target.select()}
          onBlur={commit}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            if (e.key === 'Escape') setDraft(null)
          }}
          inputMode="decimal"
          aria-label={`${title} quick buy amount`}
          className="num w-[42px] bg-transparent text-[11px] font-semibold text-ink outline-none"
        />
        {filter === 'all' ? (
          <button
            onClick={() => setEditChain(CHAIN_IDS[(CHAIN_IDS.indexOf(editChain) + 1) % CHAIN_IDS.length])}
            title={`Editing the ${CHAINS[chain].native} amount (click for another chain)`}
            className="rounded px-0.5 text-[9px] font-bold hover:bg-raise"
            style={{ color: CHAINS[chain].color }}
          >
            {CHAINS[chain].native}
          </button>
        ) : (
          <span className="px-0.5 text-[9px] font-bold" style={{ color: CHAINS[chain].color }}>{CHAINS[chain].native}</span>
        )}
      </label>
      <div className="flex rounded border border-line2 bg-bg p-px">
        {[0, 1, 2].map((i) => (
          <button
            key={i}
            onClick={() => set({ slot: i })}
            title={`${title}: quick buys use your P${i + 1} fees & slippage${custom ? '' : ` (default amount ${fmtNative(CHAINS[chain].quick[i], chain)})`}`}
            className={clsx('rounded-sm px-1 py-0.5 text-[10px] font-bold', slot === i ? 'bg-up/15 text-up' : 'text-dim hover:text-ink')}
          >
            P{i + 1}
          </button>
        ))}
      </div>
    </div>
  )
}

/** "Open / Stay" after a quick buy (GMGN): jump to the coin's page, or keep you on the list. */
export function OpenAfterToggle() {
  const openAfter = useGame((s) => !!s.settings.quickBuyOpen)
  const updateSettings = useGame((s) => s.updateSettings)
  return (
    <button
      onClick={() => updateSettings({ quickBuyOpen: !openAfter })}
      aria-pressed={openAfter}
      title={openAfter ? 'Quick buy opens the coin page (click to stay on the list instead)' : 'Quick buy keeps you on the list (click to open the coin page after buying)'}
      className={clsx('flex h-6 items-center gap-0.5 rounded border px-1.5 text-[10px] font-bold', openAfter ? 'border-up/50 bg-up/10 text-up' : 'border-line2 text-dim hover:text-ink')}
    >
      <ExternalLink size={10} /> <span className="hidden sm:inline">{openAfter ? 'Open' : 'Stay'}</span>
    </button>
  )
}

/** P1/P2/P3 quick-buy slot picker. Shows the amount for the filtered chain (or all three on hover). */
export function QuickSlotPicker() {
  const slot = useGame((s) => s.settings.quickSlot)
  const openAfter = useGame((s) => !!s.settings.quickBuyOpen)
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
      <button
        onClick={() => updateSettings({ quickBuyOpen: !openAfter })}
        aria-pressed={openAfter}
        title={openAfter ? 'Quick buy opens the coin page (click to stay on the list instead)' : 'Quick buy keeps you on the list (click to open the coin page after buying)'}
        className={clsx('flex h-6 items-center gap-0.5 rounded border px-1.5 text-[10px] font-bold', openAfter ? 'border-up/50 bg-up/10 text-up' : 'border-line2 text-dim hover:text-ink')}
      >
        <ExternalLink size={10} /> <span className="hidden sm:inline">{openAfter ? 'Open' : 'Stay'}</span>
      </button>
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

/**
 * Top-bar wallet balance: one chain coin at a time (starts on SOL). Click it for a dropdown with all three coins and
 * your USD; picking one makes it the one shown. Swap is in the dropdown too.
 */
export function WalletBalanceChip() {
  const cash = useGame((s) => s.portfolio.cash)
  const balances = useGame((s) => s.portfolio.balances)
  const native = useGame((s) => s.market.native)
  const setSwapOpen = useGame((s) => s.setSwapOpen)
  const [chain, setChain] = useState<Chain>(() => load<Chain>('walletChipChain') ?? 'sol')
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ left: 0, top: 0 })
  const btn = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false)
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
    if (r) setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - 228)), top: r.bottom + 6 })
    setOpen((o) => !o)
  }
  const usd = (c: Chain) => (balances?.[c] ?? 0) * (native?.[c]?.price ?? CHAINS[c].basePrice)
  return (
    <>
      <button ref={btn} onClick={toggle} aria-expanded={open} title="Wallet balance · click to switch coin or convert" className="flex items-center gap-1.5 rounded-md border border-line bg-panel2 px-2 py-1 text-[11px] hover:border-line2">
        <Wallet size={12} className="text-muted" />
        <span className="num flex items-center gap-1" style={{ color: CHAINS[chain].color }}>
          {CHAINS[chain].glyph}
          <span className="font-semibold text-ink">{fmtNative(balances?.[chain] ?? 0, chain, false)}</span>
          <span className="text-[9px] font-bold">{CHAINS[chain].native}</span>
        </span>
        <ChevronDown size={11} className={clsx('text-muted transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        // Fixed, so it isn't clipped by the top bar (which hides anything that overflows it).
        <div ref={menu} className="fixed z-50 w-[220px] rounded-md border border-line2 bg-panel p-1 shadow-2xl" style={{ left: pos.left, top: pos.top }}>
          {CHAIN_IDS.map((c) => (
            <button
              key={c}
              onClick={() => {
                setChain(c)
                save('walletChipChain', c)
                setOpen(false)
              }}
              className={clsx('flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] hover:bg-raise', c === chain && 'bg-raise')}
            >
              <span className="w-4 text-center" style={{ color: CHAINS[c].color }}>{CHAINS[c].glyph}</span>
              <span className="font-semibold">{CHAINS[c].native}</span>
              <span className="ml-auto text-right">
                <span className="num block font-semibold">{fmtNative(balances?.[c] ?? 0, c, false)}</span>
                <span className="num block text-[10px] text-dim">{fmtUsd(usd(c))}</span>
              </span>
            </button>
          ))}
          <div className="mx-1 my-1 border-t border-line" />
          <div className="flex items-center gap-2 px-2 py-1 text-[12px]">
            <span className="w-4 text-center text-muted">$</span>
            <span className="font-semibold">USD</span>
            <span className="num ml-auto font-semibold">{fmtUsd(cash)}</span>
          </div>
          <button
            onClick={() => {
              setOpen(false)
              setSwapOpen(true)
            }}
            className="mt-1 flex w-full items-center justify-center gap-1.5 rounded bg-accent/10 px-2 py-1.5 text-[12px] font-bold text-accent hover:bg-accent/20"
          >
            <ArrowDownUp size={12} /> Convert
          </button>
        </div>
      )}
    </>
  )
}

const ASSETS: Asset[] = ['usd', 'sol', 'bsc', 'hood']
const assetLabel = (a: Asset) => (a === 'usd' ? 'USD' : CHAINS[a].native)


/**
 * Convert (Axiom's Exchange → Convert): pick what you're converting and from which wallet, what you're getting and
 * into which wallet, see the rate, flip the two sides, confirm. USD is your shared bank, so it has no wallet.
 */
export function SwapModal() {
  const open = useGame((s) => s.swapOpen)
  const setOpen = useGame((s) => s.setSwapOpen)
  const market = useGame((s) => s.market)
  const cash = useGame((s) => s.portfolio.cash)
  const accounts = useGame((s) => s.portfolio.accounts ?? [])
  const active = useGame((s) => s.portfolio.active)
  const convert = useGame((s) => s.convertAssets)
  const swapAssets = useGame((s) => s.swapAssets)
  const autoSwap = useGame((s) => s.settings.autoSwap)
  const updateSettings = useGame((s) => s.updateSettings)
  const filter = useGame((s) => s.chainFilter)
  const main = active?.[0] ?? accounts[0]?.id ?? ''
  const [from, setFrom] = useState<Asset>('usd')
  const [to, setTo] = useState<Asset>(filter === 'all' ? 'sol' : filter)
  const [fromW, setFromW] = useState('')
  const [toW, setToW] = useState('')
  const [amount, setAmount] = useState('')
  if (!open) return null
  // A wallet that was deleted (or never picked) falls back to your main one.
  const walletOf = (id: string) => (accounts.some((a) => a.id === id) ? id : main)
  const fw = walletOf(fromW)
  const tw = walletOf(toW)
  const have = (a: Asset, w: string) => (a === 'usd' ? cash : accounts.find((x) => x.id === w)?.balances[a] ?? 0)
  const usdPer = (a: Asset) => (a === 'usd' ? 1 : nativePrice(market, a))
  const value = parseFloat(amount) || 0
  const sameCoin = from === to
  const blocked = sameCoin && (from === 'usd' || fw === tw)
  const out = value > 0 && !blocked ? (sameCoin ? value : (value * usdPer(from) * (1 - SWAP_FEE)) / usdPer(to)) : 0
  const fmt = (a: Asset, n: number) => (a === 'usd' ? fmtUsd(n) : fmtNative(n, a))
  const bal = have(from, fw)
  const flip = () => {
    setFrom(to)
    setTo(from)
    setFromW(tw)
    setToW(fw)
    setAmount(out > 0 ? String(+out.toPrecision(6)) : '')
  }
  const split = () => {
    // Quick split of half your USD: 50% SOL, 25% BNB, 25% ETH (into your main wallet).
    const pot = cash / 2
    if (pot < 1) return
    swapAssets('usd', 'sol', pot * 0.5)
    swapAssets('usd', 'bsc', pot * 0.25)
    swapAssets('usd', 'hood', pot * 0.25)
  }
  const sub =
    from === to
      ? from === 'usd' ? 'Pick two different assets' : `Move ${assetLabel(from)} between two of your wallets (no fee)`
      : `Swap ${assetLabel(from)}${from === 'usd' ? '' : ` on ${CHAINS[from].name}`} for ${assetLabel(to)}${to === 'usd' ? '' : ` on ${CHAINS[to].name}`}`

  return (
    <Modal title={<span className="flex items-center gap-2"><ArrowDownUp size={14} className="text-accent" /> Convert</span>} onClose={() => setOpen(false)}>
      <div className="space-y-2.5 text-[12px]">
        <p className="text-[11px] text-muted">{sub}</p>

        <ConvertSide
          label="Converting" asset={from} wallet={fw} accounts={accounts} balance={bal} fmt={fmt}
          onAsset={(a) => { setFrom(a); if (a === to && (a === 'usd' || fw === tw)) setTo(a === 'usd' ? 'sol' : 'usd') }}
          onWallet={setFromW}
          onMax={() => setAmount(String(Math.floor(bal * 1e6) / 1e6))}
        >
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="0.0" className="num h-9 w-full min-w-0 bg-transparent text-[18px] font-semibold outline-none placeholder:text-dim" aria-label="Amount to convert" autoFocus />
        </ConvertSide>

        <div className="-my-1 flex justify-center">
          <button onClick={flip} className="rounded-full border border-line2 bg-raise p-1.5 text-muted hover:text-ink" aria-label="Flip the two sides" title="Flip"><ArrowDownUp size={14} /></button>
        </div>

        <ConvertSide
          label="Gaining" asset={to} wallet={tw} accounts={accounts} balance={have(to, tw)} fmt={fmt}
          onAsset={(a) => { setTo(a); if (a === from && (a === 'usd' || fw === tw)) setFrom(a === 'usd' ? 'sol' : 'usd') }}
          onWallet={setToW}
        >
          <div className={clsx('num flex h-9 items-center text-[18px] font-semibold', out > 0 ? 'text-ink' : 'text-dim')}>{out > 0 ? +out.toPrecision(6) : '0.0'}</div>
        </ConvertSide>

        <div className="text-right text-[10px] text-dim">
          {sameCoin ? 'Same coin: a transfer between wallets, no fee' : <>1 {assetLabel(from)} ≈ {(usdPer(from) / usdPer(to)).toPrecision(5)} {assetLabel(to)} · fee {SWAP_FEE * 100}% · simulated prices</>}
        </div>

        <button
          disabled={!(value > 0) || blocked || value > bal + 1e-9}
          onClick={() => { if (convert(from, to, value, fw, tw)) setAmount('') }}
          className="flex h-10 w-full items-center justify-center gap-1.5 rounded-md bg-accent text-[13px] font-extrabold text-accent-ink hover:brightness-110 disabled:opacity-40"
        >
          {value > bal + 1e-9 ? `Not enough ${assetLabel(from)}` : <>Confirm{value > 0 && !blocked ? ` · ${fmt(from, value)} → ${fmt(to, out)}` : ''}</>}
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

/** One side of the Convert box: the amount on the left; wallet, balance and coin pickers on the right. */
function ConvertSide({ label, asset, wallet, accounts, balance, fmt, onAsset, onWallet, onMax, children }: {
  label: string; asset: Asset; wallet: string; accounts: { id: string; name: string; emoji: string }[]; balance: number; fmt: (a: Asset, n: number) => string
  onAsset: (a: Asset) => void; onWallet: (id: string) => void; onMax?: () => void; children: React.ReactNode
}) {
  const pick = 'rounded border border-line2 bg-panel px-1.5 py-0.5 text-[11px] font-semibold outline-none hover:border-muted'
  return (
    <div className="rounded-md border border-line2 bg-bg px-2.5 py-2 focus-within:border-accent/60">
      <div className="flex items-center gap-2 text-[10px] text-dim">
        <span>{label}</span>
        {asset === 'usd' ? (
          <span className="ml-auto" title="USD is one shared bank for all your wallets">USD bank</span>
        ) : (
          <select value={wallet} onChange={(e) => onWallet(e.target.value)} aria-label={`${label}: wallet`} className={clsx(pick, 'ml-auto max-w-[130px] text-ink')}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.emoji} {a.name}</option>)}
          </select>
        )}
        <button type="button" onClick={onMax} disabled={!onMax} title={onMax ? 'Use the whole balance' : undefined} className={clsx('num', onMax && 'text-accent hover:underline')}>Balance: {fmt(asset, balance)}</button>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <div className="min-w-0 flex-1">{children}</div>
        <select value={asset} onChange={(e) => onAsset(e.target.value as Asset)} aria-label={`${label}: coin`} className={clsx(pick, 'text-[13px] font-bold')} style={asset === 'usd' ? undefined : { color: CHAINS[asset].color }}>
          {ASSETS.map((a) => <option key={a} value={a} style={{ color: 'initial' }}>{a === 'usd' ? '$ USD' : `${CHAINS[a].glyph} ${CHAINS[a].native}`}</option>)}
        </select>
      </div>
    </div>
  )
}
