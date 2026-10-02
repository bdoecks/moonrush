import clsx from 'clsx'
import { AlertTriangle, Lock, Share2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useSelectedToken } from '../../hooks/useDerived'
import { useGame } from '../../game/store'
import { expectedFrictions, previewBuy, previewSell, SWAP_FEE, tradeFee } from '../../game/tradingEngine'
import { slotSetting } from '../../game/store'
import { TradeSettingsChip, TradeSettingsModal } from './TradeSettings'
import { useActiveBalance, useActivePosition } from '../../hooks/useWallets'
import { WalletSelector } from '../wallets'
import { shareToken } from '../ShareCard'
import { CHAINS, fmtNative } from '../../data/chains'
import { ChainBadge } from '../chain'
import { fmtCompact, fmtNum, fmtPct, fmtPrice, fmtUsd, toneClass } from '../../utils/format'
import { FlashNum, Kbd, TokenIcon } from '../ui'

const PCTS = [0.25, 0.5, 0.75, 1]

export function TradePanel({ className }: { className?: string }) {
  const t = useSelectedToken()
  const side = useGame((s) => s.tradeSide)
  const setSide = useGame((s) => s.setTradeSide)
  const tradeFocus = useGame((s) => s.tradeFocus)
  const cash = useGame((s) => s.portfolio.cash)
  const chain = t?.chain ?? 'sol'
  const meta = CHAINS[chain]
  const px = useGame((s) => s.market.native?.[chain]?.price ?? CHAINS[chain].basePrice)
  const bal = useActiveBalance(chain)
  const nativeBal = bal.total
  const autoSwap = useGame((s) => s.settings.autoSwap)
  const setSwapOpen = useGame((s) => s.setSwapOpen)
  const pos = useActivePosition(t?.id) // what your selected wallets hold
  const runStatus = useGame((s) => s.runStatus)
  const buyNative = useGame((s) => s.buyNative)
  const sell = useGame((s) => s.sell)
  const setModal = useGame((s) => s.setModal)
  const setSheetOpen = useGame((s) => s.setSheetOpen)
  // The typed amount belongs to one token+side; switching either starts from an empty box.
  const scope = `${t?.id}:${side}`
  const [draft, setDraft] = useState({ scope, value: '' })
  const amount = draft.scope === scope ? draft.value : ''
  const setAmount = (value: string) => setDraft({ scope, value })
  const inputRef = useRef<HTMLInputElement>(null)
  // P1/P2/P3 preset slots are shared with the instant-trade panel (and editable there).
  const profileIdx = useGame((s) => s.settings.presetIdx)
  const buyPresets = useGame((s) => s.settings.buyPresets[chain] ?? CHAINS[chain].presets)
  const updateSettings = useGame((s) => s.updateSettings)
  const setProfileIdx = (i: number) => updateSettings({ presetIdx: i })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const setting = useGame((s) => slotSetting(s.settings, chain, side))
  useEffect(() => {
    if (tradeFocus && Date.now() - tradeFocus < 600) inputRef.current?.focus()
  }, [tradeFocus])

  // Buy amounts are in the token's chain coin (SOL / BNB / ETH); the engine prices everything in USD underneath.
  const value = parseFloat(amount) || 0
  const buyUsd = value * px
  const buyQ = useMemo(() => (t && side === 'buy' && value > 0 ? previewBuy(t, buyUsd) : null), [t, side, value, buyUsd])
  const sellQ = useMemo(() => (t && side === 'sell' && value > 0 && pos ? previewSell(t, Math.min(value, pos.qty), pos) : null), [t, side, value, pos])

  if (!t) {
    return <div className={clsx('p-4 text-center text-[12px] text-muted', className)}>Select a token to trade</div>
  }

  const dead = t.status === 'rugged' || t.status === 'dead'
  const locked = runStatus !== 'running'
  // With auto-swap on, USD cash can top up the chain coin (minus the swap fee).
  // …and the network fee (priority + tip) comes on top of the order, so MAX leaves room for it.
  // With several wallets selected the amount is split evenly between them, so MAX is the even split the poorest
  // wallet can still cover (each pays its own network fee).
  const maxBuy = Math.max(0, bal.count * (bal.min - (side === 'buy' ? setting.priority + setting.tip : 0)) + (autoSwap ? (cash * (1 - SWAP_FEE)) / px : 0))
  const overCash = side === 'buy' && value > maxBuy + 1e-9
  const swapNeeded = side === 'buy' && value > nativeBal + 1e-12 && !overCash ? (value - nativeBal) * px : 0
  const overQty = side === 'sell' && pos && value > pos.qty * (1 + 1e-9)
  const slip = buyQ?.slippage ?? sellQ?.slippage ?? 0
  const ex = expectedFrictions(t, slip, setting, px)
  const gasNative = setting.priority + setting.tip
  const likelyFail = value > 0 && slip + ex.lag > ex.tolerance
  const disabled = locked || !(value > 0) || (side === 'buy' && (dead || overCash)) || (side === 'sell' && (!pos || !!overQty))

  const setPct = (p: number) => {
    if (side === 'buy') setAmount(String(Math.floor(maxBuy * p * 10 ** meta.decimals) / 10 ** meta.decimals))
    else if (pos) setAmount(p === 1 ? String(pos.qty) : String(pos.qty * p))
  }

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault()
    if (disabled) return
    const ok = side === 'buy' ? buyNative(value, t.id) : sell(Math.min(value, pos!.qty), t.id)
    if (ok) {
      setAmount('')
      setSheetOpen(false)
    }
  }

  const posValue = pos ? pos.qty * t.price : 0
  const posPnl = pos ? posValue - pos.costBasis : 0

  return (
    <form onSubmit={submit} className={clsx('flex flex-col gap-2.5 p-3', className)}>
      <div className="flex items-center gap-1">
        {buyPresets.map((amounts, i) => (
          <button
            type="button"
            key={i}
            onClick={() => setProfileIdx(i)}
            title={`Preset P${i + 1}: ${amounts.map((a) => fmtNative(a, chain)).join(' / ')}`}
            className={clsx('rounded px-2 py-0.5 text-[11px] font-bold transition-colors', profileIdx === i ? 'bg-raise text-ink' : 'text-dim hover:text-muted')}
          >
            P{i + 1}
          </button>
        ))}
        <TradeSettingsChip chain={chain} side={side} onOpen={() => setSettingsOpen(true)} />
        <div className="ml-auto flex items-center gap-1.5 text-[10px] text-dim">
          <TokenIcon token={t} size={16} />
          <span className="font-semibold text-muted">{t.ticker}</span>
          <ChainBadge chain={chain} />
          <FlashNum value={t.price} format={fmtPrice} className="text-[10px] text-muted" />
        </div>
      </div>

      <div className="grid grid-cols-2 rounded-md bg-bg p-0.5">
        {(['buy', 'sell'] as const).map((sd) => (
          <button
            type="button"
            key={sd}
            onClick={() => setSide(sd)}
            className={clsx(
              'flex items-center justify-center gap-1.5 rounded py-1.5 text-[13px] font-bold transition-all',
              side === sd ? (sd === 'buy' ? 'bg-up/15 text-up' : 'bg-down/15 text-down') : 'text-muted hover:text-ink',
            )}
          >
            {sd === 'buy' ? 'Buy' : 'Sell'} <Kbd>{sd === 'buy' ? 'B' : 'S'}</Kbd>
          </button>
        ))}
      </div>

      <div>
        <div className="mb-1 flex items-center justify-end gap-1 text-[10px] text-dim">
          <WalletSelector chain={chain} compact className="mr-auto" align="left" />
          {side === 'buy' ? (
            <>
              <span className="num text-muted" style={{ color: meta.color }}>{fmtNative(nativeBal, chain)}</span>
              <span className="num text-dim">· {fmtUsd(cash, 0)} USD</span>
              <button type="button" onClick={() => setSwapOpen(true)} className="ml-1 rounded bg-raise px-1.5 py-px text-[10px] font-bold text-accent hover:brightness-125" title={`Swap USD into ${meta.native}`}>Swap</button>
            </>
          ) : (
            <span className="num text-muted">{pos ? `${fmtNum(pos.qty)} ${t.ticker}` : `0 ${t.ticker}`}</span>
          )}
        </div>
        <div className={clsx('overflow-hidden rounded-md border bg-bg transition-colors focus-within:border-accent/70', overCash || overQty ? 'border-down/60' : 'border-line2')}>
        <div className="flex items-center px-2">
          <span className="text-[11px] text-dim">Amount</span>
          <input
            ref={inputRef}
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault() // handle explicitly (and only once) instead of relying on implicit form submission
                submit()
              }
            }}
            placeholder="0"
            className="num h-10 w-full bg-transparent px-2 text-right text-[16px] font-semibold outline-none placeholder:text-dim"
            aria-label={side === 'buy' ? `Buy amount in ${meta.native}` : 'Sell amount in tokens'}
          />
          <span className="num shrink-0 text-[11px] font-semibold" style={side === 'buy' ? { color: meta.color } : undefined}>{side === 'buy' ? `${meta.glyph} ${meta.native}` : t.ticker}</span>
        </div>
        {side === 'buy' && (
          <div className="grid grid-cols-4 border-t border-line2">
            {(buyPresets[profileIdx] ?? buyPresets[0]).map((a) => (
              <button
                type="button"
                key={a}
                onClick={() => setAmount(String(a))}
                className={clsx('num border-r border-line2 py-1.5 text-[11px] font-semibold last:border-r-0 transition-colors hover:bg-raise hover:text-ink', value === a ? 'bg-raise text-ink' : 'text-muted')}
              >
                {fmtNative(a, chain, false)}
              </button>
            ))}
          </div>
        )}
        </div>
        <div className="mt-1.5 grid grid-cols-4 gap-1">
          {PCTS.map((p) => (
            <button
              type="button"
              key={p}
              onClick={() => setPct(p)}
              disabled={side === 'sell' && !pos}
              className="rounded border border-line2 bg-panel2 py-1 text-[11px] font-semibold text-muted transition-colors hover:border-accent/50 hover:text-accent disabled:opacity-30"
            >
              {p === 1 ? 'MAX' : `${p * 100}%`}
            </button>
          ))}
        </div>
        {side === 'buy' && value > 0 && <div className="mt-1 text-right num text-[10px] text-muted">≈ {fmtUsd(buyUsd)}{swapNeeded > 0 && <span className="text-info"> · auto-swaps {fmtUsd(swapNeeded / (1 - SWAP_FEE))} USD → {meta.native}</span>}</div>}
        {side === 'sell' && sellQ && <div className="mt-1 text-right num text-[10px] text-muted">≈ {fmtNative(sellQ.net / px, chain)} ({fmtUsd(sellQ.net)}) after fees</div>}
      </div>

      <dl className="space-y-1 rounded-md border border-line bg-bg/60 p-2 text-[11px]">
        <Line label="Entry price">{buyQ ? fmtPrice(buyQ.avgPrice) : sellQ ? fmtPrice(sellQ.avgPrice) : fmtPrice(t.price)}</Line>
        {side === 'buy' ? (
          <Line label="Est. tokens">{buyQ ? fmtNum(buyQ.qty) : '—'}</Line>
        ) : (
          <Line label="Est. receive">{sellQ ? fmtNative(sellQ.net / px, chain) : '—'}</Line>
        )}
        <Line label="Slippage / impact">
          <span className={clsx(slip > 0.15 ? 'text-down' : slip > 0.05 ? 'text-warn' : 'text-ink')}>{slip > 9.99 ? '>999%' : fmtPct(slip, 2, false)}</span>
        </Line>
        <Line label={`${t.tax ? 'Fee + tax' : 'Trading fee'} (${+(tradeFee(t, sellQ ? 'sell' : 'buy') * 100).toFixed(2)}%)`}>{buyQ ? fmtNative(buyQ.fee / px, chain) : sellQ ? fmtNative(sellQ.fee / px, chain) : '—'}</Line>
        <Line label={`Network fee (P${profileIdx + 1})`}>
          <button type="button" onClick={() => setSettingsOpen(true)} className="hover:text-accent" title="Priority fee + tip · click to edit">
            {fmtNative(gasNative, chain)} <span className="text-dim">≈{fmtUsd(ex.gasUsd)}</span>
          </button>
        </Line>
        <Line label="Max slippage · speed">
          <span className={likelyFail ? 'text-down' : undefined}>{setting.slippage === null ? `Auto (${(ex.tolerance * 100).toFixed(0)}%)` : `${setting.slippage}%`}</span>
          <span className="text-dim"> · {ex.speed}</span>
        </Line>
        {value > 0 && (
          <Line label="Sandwich risk">
            {setting.antiMev ? <span className="text-up">Anti-MEV on</span> : <span className={ex.sandwichChance > 0.1 ? 'text-warn' : 'text-muted'}>{ex.sandwichChance < 0.005 ? 'Low' : `${(ex.sandwichChance * 100).toFixed(0)}% chance`}</span>}
          </Line>
        )}
        {buyQ && bal.count > 1 && <Line label="Split">{bal.count} wallets × {fmtNative(value / bal.count, chain)}</Line>}
        <Line label="Total">{buyQ ? `${fmtNative(value + gasNative * bal.count, chain)} · ${fmtUsd(buyQ.total + ex.gasUsd * bal.count)}` : sellQ ? `${fmtNative(sellQ.gross / px, chain)} · ${fmtUsd(sellQ.gross)}` : '—'}</Line>
        <Line label={`${meta.native} price`}>{fmtUsd(px, 2)}</Line>
        {side === 'buy' ? (
          <Line label="P&L if +50%">
            {buyQ ? <span className="text-up">+{fmtUsd(buyQ.qty * t.price * 1.5 * (1 - tradeFee(t, 'sell')) - buyQ.total)}</span> : '—'}
          </Line>
        ) : (
          <Line label="Realized P&L">
            {sellQ ? <span className={toneClass(sellQ.pnl)}>{sellQ.pnl >= 0 ? '+' : ''}{fmtUsd(sellQ.pnl)} ({fmtPct(sellQ.pnlPct)})</span> : '—'}
          </Line>
        )}
      </dl>

      {likelyFail && (
        <div className="flex items-start gap-1.5 rounded-md border border-down/30 bg-down/5 p-2 text-[10px] text-down">
          <AlertTriangle size={12} className="mt-px shrink-0" />
          <span>
            Likely to fail: impact + expected price move ({((slip + ex.lag) * 100).toFixed(1)}%) is above your max slippage. A failed order still burns the {fmtNative(setting.priority, chain)} priority fee.{' '}
            <button type="button" onClick={() => setSettingsOpen(true)} className="font-bold underline">Raise slippage</button>
          </span>
        </div>
      )}
      {settingsOpen && <TradeSettingsModal chain={chain} side={side} slot={profileIdx} onClose={() => setSettingsOpen(false)} />}

      {slip > 0.1 && (
        <div className="flex items-start gap-1.5 rounded-md border border-warn/30 bg-warn/5 p-2 text-[10px] text-warn">
          <AlertTriangle size={12} className="mt-px shrink-0" />
          High price impact: liquidity is only {fmtCompact(t.liquidity)}. Size down or expect a worse fill.
        </div>
      )}

      {locked ? (
        <button type="button" onClick={() => setModal('mode')} className="flex h-11 items-center justify-center gap-2 rounded-md border border-accent/40 bg-accent/10 text-[13px] font-bold text-accent hover:bg-accent/20">
          <Lock size={14} /> {runStatus === 'finished' ? 'ROUND OVER — PLAY AGAIN' : 'START A ROUND TO TRADE'}
        </button>
      ) : (
        <button
          type="submit"
          disabled={disabled}
          className={clsx(
            'relative h-11 rounded-md text-[14px] font-extrabold tracking-wide transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40',
            side === 'buy' ? 'bg-up text-black hover:brightness-110 hover:shadow-[0_0_24px_-6px_#19d989]' : 'bg-down text-white hover:brightness-110 hover:shadow-[0_0_24px_-6px_#ff4d6a]',
          )}
        >
          {dead && side === 'buy' ? `$${t.ticker} IS ${t.status.toUpperCase()}` : overCash ? `NOT ENOUGH ${meta.native}` : side === 'sell' && !pos ? 'NO POSITION' : `${side.toUpperCase()} $${t.ticker}`}
          <span className="absolute right-2 top-1/2 -translate-y-1/2 hidden sm:inline opacity-60"><Kbd>↵</Kbd></span>
        </button>
      )}

      {pos && (
        <div className="rounded-md border border-line bg-panel2 p-2 text-[11px]">
          <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wider text-dim">
            <span className="flex items-center gap-1.5">Your position <button type="button" onClick={() => shareToken(t.id)} title="Share this as a picture" aria-label="Share your position" className="rounded text-dim hover:text-accent"><Share2 size={11} /></button></span>
            <span className={clsx('num font-bold normal-case', toneClass(posPnl))}>{fmtPct(posValue / pos.costBasis - 1)}</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div><div className="text-[9px] text-dim">Value</div><div className="num">{fmtUsd(posValue)}</div></div>
            <div><div className="text-[9px] text-dim">Avg entry</div><div className="num">{fmtPrice(pos.avgEntry)}</div></div>
            <div><div className="text-[9px] text-dim">uP&amp;L</div><div className={clsx('num', toneClass(posPnl))}>{posPnl >= 0 ? '+' : ''}{fmtUsd(posPnl)}</div></div>
          </div>
        </div>
      )}
    </form>
  )
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-dim">{label}</dt>
      <dd className="num text-ink">{children}</dd>
    </div>
  )
}
