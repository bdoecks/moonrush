import clsx from 'clsx'
import { Check, GripHorizontal, Pencil, RotateCcw, Settings2, Wallet, X, Zap } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { useSelectedToken, useTokenMap } from '../../hooks/useDerived'
import { slotSetting, useGame } from '../../game/store'
import { previewBuy, previewSell, qtyForProceeds, SWAP_FEE, tradeFee } from '../../game/tradingEngine'
import { SUPPLY } from '../../game/marketEngine'
import type { InstantPrefs, Token } from '../../types'
import { CHAINS, fmtNative } from '../../data/chains'
import { ChainBadge } from '../chain'
import { fmtCompact, fmtNum, fmtPct, fmtUsd, toneClass } from '../../utils/format'
import { load, save } from '../../utils/storage'
import { Kbd, TokenIcon } from '../ui'
import { TradeSettingsChip, TradeSettingsModal } from './TradeSettings'
import { useActiveBalance, useActivePosition, useWallets } from '../../hooks/useWallets'
import { WalletSelector } from '../wallets'
import { liveIds, useWalletGroups } from '../../game/walletGroups'
import { InstantSettingsModal, instantOpts } from './InstantSettings'

const W = 300
const SIDE_W = 280 // the wallet holdings panel that opens beside it
const clampPos = (p: { x: number; y: number }) => ({
  x: Math.min(Math.max(8, p.x), Math.max(8, window.innerWidth - W - 8)),
  y: Math.min(Math.max(56, p.y), Math.max(56, window.innerHeight - 240)),
})

/** Floating one-click trade panel (GMGN / Axiom style): preset buys in the chain coin or USD, sells by %, coin or USD. */
export function InstantTrade() {
  const open = useGame((s) => s.instantOpen)
  const hasCoin = useGame((s) => !!s.selectedId)
  // Closed (the default) or no coin picked: nothing is mounted, so nothing is worked out each tick.
  return open && hasCoin ? <InstantTradePanel /> : null
}

function InstantTradePanel() {
  const open = useGame((s) => s.instantOpen)
  const toggle = useGame((s) => s.toggleInstant)
  const t = useSelectedToken()
  const settings = useGame((s) => s.settings)
  const updateSettings = useGame((s) => s.updateSettings)
  const cash = useGame((s) => s.portfolio.cash)
  const chain = t?.chain ?? 'sol'
  const meta = CHAINS[chain]
  const px = useGame((s) => s.market.native?.[chain]?.price ?? CHAINS[chain].basePrice)
  const bal = useActiveBalance(chain)
  const nativeBal = bal.total
  const { all: allWallets, activeIds, primary } = useWallets()
  const setActiveWallets = useGame((s) => s.setActiveWallets)
  const groups = useWalletGroups((s) => s.groups)
  const trades = useGame((s) => s.portfolio.trades)
  const pos = useActivePosition(t?.id) // what your selected wallets hold
  const running = useGame((s) => s.runStatus === 'running')
  const buyNative = useGame((s) => s.buyNative)
  const buy = useGame((s) => s.buy)
  const sell = useGame((s) => s.sell)
  const [pos2d, setPos] = useState(() => clampPos(load<{ x: number; y: number }>('instantPos') ?? { x: 96, y: 150 }))
  const [editing, setEditing] = useState(false)
  const [gear, setGear] = useState(false)
  const [settingsSide, setSettingsSide] = useState<'buy' | 'sell' | null>(null)
  const drag = useRef<{ dx: number; dy: number } | null>(null)
  const [tab, setTab] = useState<'trade' | 'holding'>(() => load<'trade' | 'holding'>('instantTab') ?? 'trade')
  // "Reset PNL": per coin, the tick the Bal / Bought / Sold / PnL row starts counting from.
  const [resets, setResets] = useState<Record<string, number>>(() => load<Record<string, number>>('instantPnlReset') ?? {})
  const pickTab = (k: 'trade' | 'holding') => {
    setTab(k)
    save('instantTab', k)
  }
  const holdCount = useHoldings().length
  const o = instantOpts(settings.instant)
  // What the hotkeys do right now (set further down, once the buttons' amounts are known).
  const keys = useRef<{ buy: (i: number) => void; sell: (i: number) => void; initials: () => void } | null>(null)

  useEffect(() => {
    const onResize = () => setPos((p) => clampPos(p))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Hotkeys: only while the panel is open on its Trade tab and you're not typing. They run before the game's own
  // shortcuts (which use some of the same keys) and stop those from also firing.
  const hk = o.hotkeys
  const hkOn = open && hk.on && tab === 'trade'
  const hkSig = `${hk.buy.join()}|${hk.sell.join()}|${hk.initials}|${hk.bubbles}`
  useEffect(() => {
    if (!hkOn) return
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || useGame.getState().modal) return
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return
      const k = e.key.toLowerCase()
      const b = hk.buy.indexOf(k)
      const s = hk.sell.indexOf(k)
      if (b >= 0) keys.current?.buy(b)
      else if (s >= 0) keys.current?.sell(s)
      else if (k === hk.initials) keys.current?.initials()
      else if (k === hk.bubbles) window.dispatchEvent(new Event('moonrush:toggleMarkers'))
      else return
      e.preventDefault()
      e.stopImmediatePropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hkOn, hkSig])

  const scope = settings.instant.pnlScope ?? 'total'
  const resetTick = t ? resets[t.id] ?? -1 : -1
  const stats = useMemo(() => {
    if (!t) return null
    let bought = 0
    let sold = 0
    let boughtN = 0
    let soldN = 0
    let realized = 0
    // Only the selected wallets' fills (trades from before multi-wallet belong to the first wallet), oldest first.
    let fills = trades.filter((tr) => tr.tokenId === t.id && tr.tick >= resetTick && activeIds.includes(tr.walletId ?? primary?.id ?? '')).reverse()
    if (scope === 'position') {
      // The current (or most recent) position starts at the first buy after your holdings were last at zero.
      let held = 0
      let start = 0
      fills.forEach((tr, i) => {
        if (tr.side === 'buy' && held < 1) start = i
        held = Math.max(0, held + (tr.side === 'buy' ? tr.qty : -tr.qty))
      })
      fills = fills.slice(start)
    }
    for (const tr of fills) {
      if (tr.side === 'buy') {
        bought += tr.value
        boughtN += tr.native ?? tr.value / px
      } else {
        sold += tr.value - tr.fee
        soldN += tr.native ?? (tr.value - tr.fee) / px
        realized += tr.pnl ?? 0
      }
    }
    const value = pos ? pos.qty * t.price : 0
    const unrealized = pos ? value - pos.costBasis : 0
    const pnl = realized + unrealized
    return { bought, sold, boughtN, soldN, value, pnl, pnlPct: bought > 0 ? pnl / bought : 0 }
  }, [t, trades, pos, px, activeIds, primary, scope, resetTick])

  if (!open || !t || !stats) return null

  const idx = settings.presetIdx
  const ip = settings.instant
  const setIp = (patch: Partial<InstantPrefs>) => updateSettings({ instant: { ...ip, ...patch } })
  // Rows: the first is the preset you're on; extra rows show your other presets' amounts.
  const slotRows = (n: number) => [idx, (idx + 1) % 3, (idx + 2) % 3].slice(0, n)
  const buyRow = (r: number) => (ip.buyUnit === 'usd' ? ip.buyUsd[r] : (settings.buyPresets[chain] ?? meta.presets)[r] ?? meta.presets[r])
  type SellUnit = 'pct' | 'native' | 'usd'
  const sellRow = (unit: SellUnit, r: number) => (unit === 'pct' ? settings.sellPresets[r] : unit === 'usd' ? ip.sellUsd[r] : (ip.sellNative[chain] ?? meta.presets)[r])
  // Sell rows: follow the switch, always %, or one row of amounts and the rest %.
  const sellRows: { unit: SellUnit; r: number }[] =
    o.sellMode === 'pct' ? slotRows(o.sellRows).map((r) => ({ unit: 'pct', r }))
      : o.sellMode === 'both' ? [{ unit: ip.sellUnit === 'pct' ? 'native' : ip.sellUnit, r: idx }, ...slotRows(Math.max(1, o.sellRows - 1)).map((r) => ({ unit: 'pct' as const, r }))]
        : slotRows(o.sellRows).map((r) => ({ unit: ip.sellUnit, r }))
  const buys = buyRow(idx)
  const toUsd = (a: number) => (ip.buyUnit === 'usd' ? a : a * px)
  // The amount is split evenly across the selected wallets, so a button is live if every wallet can cover its share.
  const spendableUsd = bal.count * bal.min * px + (settings.autoSwap ? cash * (1 - SWAP_FEE) : 0)
  const dead = t.status === 'rugged' || t.status === 'dead'
  const firstSlip = previewBuy(t, toUsd(buys[0])).slippage
  const posNet = pos ? previewSell(t, pos.qty).net : 0 // what the whole bag would fetch right now
  const round = o.shape === 'rounded' ? 'rounded-full' : 'rounded-md'

  const setPreset = (side: 'buy' | 'sell', r: number, i: number, v: number, unit?: SellUnit) => {
    if (!(v > 0)) return
    const edit = (rows: number[][]) => rows.map((row, k) => (k === r ? row.map((x, c) => (c === i ? v : x)) : row))
    if (side === 'buy') {
      if (ip.buyUnit === 'usd') setIp({ buyUsd: edit(ip.buyUsd) })
      else updateSettings({ buyPresets: { ...settings.buyPresets, [chain]: edit(settings.buyPresets[chain] ?? meta.presets) } })
    } else if (unit === 'pct') updateSettings({ sellPresets: settings.sellPresets.map((row, k) => (k === r ? row.map((x, c) => (c === i ? Math.min(100, v) : x)) : row)) })
    else if (unit === 'usd') setIp({ sellUsd: edit(ip.sellUsd) })
    else setIp({ sellNative: { ...ip.sellNative, [chain]: edit(ip.sellNative[chain] ?? meta.presets) } })
  }
  // Wallet groups that still have wallets, in order; "rotate" steps to the next one after a buy.
  const allIds = allWallets.map((a) => a.id)
  const liveGroups = groups.map((g) => ({ g, ids: liveIds(g, allIds) })).filter((x) => x.ids.length > 0)
  const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x))
  const groupIdx = liveGroups.findIndex((x) => sameSet(x.ids, activeIds))
  const doBuy = (a: number) => {
    const done = ip.buyUnit === 'usd' ? buy(a, t.id) : buyNative(a, t.id)
    if (done && o.rotateGroups && liveGroups.length > 1) setActiveWallets(liveGroups[(groupIdx + 1 + liveGroups.length) % liveGroups.length].ids)
    return done
  }
  const doSell = (a: number, unit: SellUnit) => {
    if (!pos) return
    if (unit === 'pct') return sell(a >= 100 ? pos.qty : (pos.qty * a) / 100, t.id)
    // Aim for the amount you actually receive: add this slot's network fee (paid out of the proceeds).
    const s = slotSetting(settings, chain, 'sell')
    const usd = (unit === 'usd' ? a : a * px) + (s.priority + s.tip) * px
    return sell(qtyForProceeds(t, pos.qty, usd), t.id)
  }
  keys.current = {
    buy: (i) => {
      const a = buys[i]
      if (a !== undefined && running && !dead && toUsd(a) <= spendableUsd + 1e-9) doBuy(a)
    },
    sell: (i) => {
      const a = sellRow(sellRows[0].unit, sellRows[0].r)[i]
      if (a !== undefined && running && pos) doSell(a, sellRows[0].unit)
    },
    // "Initials": sell just enough to take back what this bag cost you (the rest rides for free).
    initials: () => {
      if (running && pos && posNet > 0) sell(posNet <= pos.costBasis ? pos.qty : qtyForProceeds(t, pos.qty, pos.costBasis), t.id)
    },
  }
  const buyLabel = (a: number) => (ip.buyUnit === 'usd' ? `$${fmtNum(a)}` : fmtNative(a, chain, false))
  const sellLabel = (a: number, unit: SellUnit) => (unit === 'pct' ? `${a}%` : unit === 'usd' ? `$${fmtNum(a)}` : fmtNative(a, chain, false))
  // Stats row: USD or chain coin; PnL as value or %.
  const inNative = ip.statsUnit === 'native'
  const money = (usd: number, nat: number) => (inNative ? fmtNative(nat, chain, false) : fmtCompact(usd))
  const hint = (list: string[], i: number) => (hk.on && list[i] ? ` · key ${list[i].toUpperCase()}` : '')

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // Not from a control, and not from a window opened by the panel (those sit outside it on the page).
    if ((e.target as HTMLElement).closest('button, input, select, a, label') || !e.currentTarget.contains(e.target as Node)) return
    drag.current = { dx: e.clientX - pos2d.x, dy: e.clientY - pos2d.y }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current) setPos(clampPos({ x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy }))
  }
  const onUp = () => {
    if (drag.current) save('instantPos', pos2d)
    drag.current = null
  }
  const dragProps = { onPointerDown: onDown, onPointerMove: onMove, onPointerUp: onUp }
  // Where the wallet holdings go: to the right of the panel, to the left when the right is off screen, and underneath
  // (inside the panel) only when neither side has room, as on a phone.
  const vw = typeof window === 'undefined' ? 1280 : window.innerWidth
  const holdingsSide: 'right' | 'left' | 'below' = pos2d.x + W + SIDE_W + 12 <= vw ? 'right' : pos2d.x - SIDE_W - 12 >= 0 ? 'left' : 'below'
  const sideOpen = o.pnlRow && tab === 'trade' && !!ip.showHoldings && holdingsSide !== 'below'
  const resetPnl = () => {
    const next = { ...resets, [t.id]: useGame.getState().market.tick + 1 }
    setResets(next)
    save('instantPnlReset', next)
  }

  return (
    <div
      role="dialog"
      aria-label="Instant trade"
      className={clsx('pop-in fixed z-40 rounded-lg border border-line2 bg-panel/95 shadow-2xl shadow-black/60 backdrop-blur', o.dragAnywhere && 'touch-none', sideOpen && (holdingsSide === 'right' ? 'rounded-r-none' : 'rounded-l-none'))}
      style={{ left: pos2d.x, top: pos2d.y, width: W }}
      {...(o.dragAnywhere ? dragProps : {})}
    >
      {/* Wallet groups: click one to trade from its wallets */}
      {o.groupChips && (
        <div className="no-scrollbar flex items-center gap-1 overflow-x-auto border-b border-line px-2 py-1">
          {liveGroups.length === 0 ? (
            <span className="text-[10px] text-dim">No wallet groups yet · make one in Portfolio → Wallet groups</span>
          ) : liveGroups.map((x, i) => (
            <button key={x.g.id} onClick={() => setActiveWallets(x.ids)} aria-pressed={i === groupIdx} title={`Trade from ${x.g.name} (${x.ids.length} wallet${x.ids.length > 1 ? 's' : ''})`} className={clsx('flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold', i === groupIdx ? 'border-warn/60 bg-warn/10 text-warn' : 'border-line2 text-muted hover:text-ink')}>
              <span>{x.g.emoji}</span>{x.g.name}
            </button>
          ))}
        </div>
      )}
      {/* Drag handle */}
      <div
        {...(o.dragAnywhere ? {} : dragProps)}
        className="flex cursor-grab touch-none items-center gap-2 border-b border-line px-2.5 py-1.5 active:cursor-grabbing"
      >
        <GripHorizontal size={14} className="text-dim" />
        <Zap size={12} className="text-up" fill="currentColor" />
        <span className="text-[12px] font-bold">Instant Trade</span>
        <span className="truncate text-[11px] text-muted">{t.ticker}</span>
        <ChainBadge chain={chain} />
        <WalletSelector chain={chain} compact align="left" />
        <button onClick={() => setEditing((v) => !v)} className={clsx('ml-auto rounded p-1', editing ? 'bg-accent/15 text-accent' : 'text-dim hover:text-ink')} title={editing ? 'Done editing' : 'Edit preset amounts'} aria-label="Edit presets">
          {editing ? <Check size={13} /> : <Pencil size={13} />}
        </button>
        <button onClick={() => setGear(true)} className="rounded p-1 text-dim hover:text-ink" title="Instant Trade settings" aria-label="Instant Trade settings">
          <Settings2 size={13} />
        </button>
        <button onClick={() => toggle(false)} className="rounded p-1 text-dim hover:text-ink" title="Close (I)" aria-label="Close instant trade">
          <X size={14} />
        </button>
      </div>
      {/* In a portal: the panel's blur would otherwise trap the window inside it. */}
      {gear && createPortal(<InstantSettingsModal onClose={() => setGear(false)} />, document.body)}

      {/* Trade / Holding tabs */}
      <div role="tablist" aria-label="Instant trade view" className="flex gap-3 border-b border-line px-2.5">
        {(['trade', 'holding'] as const).map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => pickTab(k)}
            className={clsx('-mb-px border-b-2 py-1 text-[11px] font-bold', tab === k ? 'border-accent text-ink' : 'border-transparent text-dim hover:text-muted')}
          >
            {k === 'trade' ? 'Trade' : 'Holding'}
            {k === 'holding' && holdCount > 0 && <span className="num ml-1 rounded bg-raise px-1 text-[9px] text-muted">{holdCount}</span>}
          </button>
        ))}
      </div>

      {tab === 'holding' ? (
        <HoldingList current={t.id} onPick={() => pickTab('trade')} />
      ) : (
      <>
      <div className="space-y-2.5 p-2.5">
        {/* Buy */}
        <div>
          <div className="mb-1.5 flex items-center gap-1">
            <span className="mr-1 text-[12px] font-bold text-up">Buy</span>
            <Slots idx={idx} onPick={(i) => updateSettings({ presetIdx: i })} />
            {o.unitSwitch && (
              <UnitSwitch
                value={ip.buyUnit}
                onChange={(v) => setIp({ buyUnit: v })}
                options={[{ value: 'native', label: meta.native }, { value: 'usd', label: 'USD' }]}
                label="Buy amounts in"
                className="ml-auto"
              />
            )}
          </div>
          <div className="space-y-1.5">
            {slotRows(o.buyRows).map((r, ri) => (
              <div key={r} className="grid grid-cols-4 gap-1.5">
                {buyRow(r).map((a, i) =>
                  editing ? (
                    <PresetInput key={`${ip.buyUnit}-${r}-${i}`} value={a} onCommit={(v) => setPreset('buy', r, i, v)} tone="up" prefix={ip.buyUnit === 'usd' ? '$' : undefined} />
                  ) : (
                    <button
                      key={i}
                      disabled={!running || dead || toUsd(a) > spendableUsd + 1e-9}
                      onClick={() => doBuy(a)}
                      title={(ip.buyUnit === 'usd' ? `Buy $${fmtNum(a)} (≈${fmtNative(a / px, chain)}) of ${t.ticker} instantly` : `Buy ${fmtNative(a, chain)} (≈${fmtUsd(a * px)}) of ${t.ticker} instantly`) + (ri === 0 ? hint(hk.buy, i) : '')}
                      className={clsx('num border border-up/50 py-1.5 text-[12px] font-bold text-up transition-all hover:bg-up hover:text-black active:scale-95 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-up', round)}
                    >
                      {buyLabel(a)}
                    </button>
                  ),
                )}
              </div>
            ))}
          </div>
          {o.tokenAmounts && (
            <div className="mt-1 flex items-center justify-end gap-1 num text-[10px]" style={{ color: meta.color }}>
              <Wallet size={10} />{fmtNative(nativeBal, chain)}<span className="text-dim">· {fmtUsd(nativeBal * px + cash, 0)} total</span>
            </div>
          )}
          <div className="mt-1 flex items-center gap-1.5 text-[10px] text-dim">
            <TradeSettingsChip chain={chain} side="buy" onOpen={() => setSettingsSide('buy')} className="-ml-1" />
            <span className="ml-auto" title="Trading fee (incl. tax)">Fee {+(tradeFee(t, 'buy') * 100).toFixed(2)}%</span>
            <span className={firstSlip > 0.05 ? 'text-warn' : ''}>· Impact {fmtPct(firstSlip, 1, false)}</span>
          </div>
        </div>

        {/* Sell */}
        <div className="border-t border-line pt-2">
          <div className="mb-1.5 flex items-center gap-1">
            <span className="mr-1 text-[12px] font-bold text-down">Sell</span>
            <Slots idx={idx} onPick={(i) => updateSettings({ presetIdx: i })} />
            {o.unitSwitch && o.sellMode !== 'pct' && (
              <UnitSwitch
                value={ip.sellUnit}
                onChange={(v) => setIp({ sellUnit: v })}
                options={o.sellMode === 'both' ? [{ value: 'native', label: meta.native }, { value: 'usd', label: 'USD' }] : [{ value: 'pct', label: '%' }, { value: 'native', label: meta.native }, { value: 'usd', label: 'USD' }]}
                label={o.sellMode === 'both' ? 'Amount row in' : 'Sell by'}
                className="ml-auto"
              />
            )}
          </div>
          <div className="space-y-1.5">
            {sellRows.map(({ unit, r }, ri) => (
              <div key={`${unit}-${r}-${ri}`} className="grid grid-cols-4 gap-1.5">
                {sellRow(unit, r).map((p, i) => {
                  const valueMode = unit !== 'pct'
                  const wantUsd = unit === 'usd' ? p : p * px
                  const all = valueMode && wantUsd >= posNet // more than the bag is worth → sells everything
                  return editing ? (
                    <PresetInput key={`${unit}-${r}-${i}`} value={p} onCommit={(v) => setPreset('sell', r, i, v, unit)} tone="down" suffix={unit === 'pct' ? '%' : undefined} prefix={unit === 'usd' ? '$' : undefined} />
                  ) : (
                    <button
                      key={i}
                      disabled={!running || !pos}
                      onClick={() => doSell(p, unit)}
                      title={
                        (unit === 'pct'
                          ? `Sell ${p}% of your ${t.ticker} instantly`
                          : `Sell about ${unit === 'usd' ? `$${fmtNum(p)}` : fmtNative(p, chain)} worth of ${t.ticker} (after fees)${all ? ' — more than your bag, so it sells all' : ''}`) + (ri === 0 ? hint(hk.sell, i) : '')
                      }
                      className={clsx(
                        'num relative border border-down/50 py-1.5 text-[12px] font-bold text-down transition-all hover:bg-down hover:text-white active:scale-95 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-down',
                        round, all && pos && 'border-down/80',
                      )}
                    >
                      {sellLabel(p, unit)}
                      {all && pos && <span className="absolute -right-1 -top-1.5 rounded bg-down px-0.5 text-[7px] leading-[10px] text-white">ALL</span>}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
          {o.tokenAmounts && (
            <div className="mt-1 flex items-center justify-end gap-1 num text-[10px] text-muted">
              {pos ? (
                <>
                  {fmtNum(pos.qty)} {t.ticker}
                  <span className="text-dim">· ≈{ip.sellUnit === 'native' ? fmtNative(posNet / px, chain) : fmtUsd(posNet)}</span>
                </>
              ) : (
                `0 ${t.ticker}`
              )}
            </div>
          )}
          <div className="mt-1 flex items-center gap-1.5 text-[10px] text-dim">
            <TradeSettingsChip chain={chain} side="sell" onOpen={() => setSettingsSide('sell')} className="-ml-1" />
            <span className="ml-auto">Fee {+(tradeFee(t, 'sell') * 100).toFixed(2)}% · No confirm</span>
          </div>
        </div>
        {settingsSide && createPortal(<TradeSettingsModal chain={chain} side={settingsSide} slot={idx} onClose={() => setSettingsSide(null)} />, document.body)}

        {!running &&<div className="rounded border border-warn/30 bg-warn/5 px-2 py-1 text-center text-[10px] text-warn">Start a round to trade</div>}
      </div>

      {/* Position summary */}
      {o.pnlRow && (
      <div className="border-t border-line px-2.5 pb-2 pt-1.5 text-[10px]">
        <div className="mb-1 flex items-center justify-end gap-1">
          <span className="mr-auto" title="Total: every trade on this coin this round. Position: only the position you hold now (since your holdings were last at zero).">
            <UnitSwitch value={ip.pnlScope ?? 'total'} onChange={(v) => setIp({ pnlScope: v })} options={[{ value: 'total', label: 'Total' }, { value: 'position', label: 'Position' }]} label="PnL covers" />
          </span>
          {o.resetPnl && (
            <button type="button" onClick={resetPnl} title={`Start this row again from zero for ${t.ticker} (your trades and bag aren't touched)`} aria-label="Reset PNL" className="rounded border border-line2 p-0.5 text-dim hover:text-ink">
              <RotateCcw size={11} />
            </button>
          )}
          <UnitSwitch value={ip.statsUnit} onChange={(v) => setIp({ statsUnit: v })} options={[{ value: 'usd', label: 'USD' }, { value: 'native', label: meta.native }]} label="Show amounts in" />
          <UnitSwitch value={ip.pnlUnit} onChange={(v) => setIp({ pnlUnit: v })} options={[{ value: 'value', label: 'PnL $' }, { value: 'pct', label: 'PnL %' }]} label="Show PnL as" />
        </div>
        <button type="button" onClick={() => setIp({ showHoldings: !ip.showHoldings })} aria-pressed={!!ip.showHoldings} className={clsx('mb-1 flex w-full items-center gap-1 rounded px-1 py-0.5 text-[10px] font-semibold', ip.showHoldings ? 'text-accent' : 'text-dim hover:text-muted')} title="Show every wallet's bag of this coin">
          <span className={clsx('grid size-3 place-items-center rounded-sm border', ip.showHoldings ? 'border-accent bg-accent text-black' : 'border-line2')}>{ip.showHoldings && <Check size={9} strokeWidth={3} />}</span>
          Show wallet holdings
        </button>
        {ip.showHoldings && holdingsSide === 'below' && <WalletHoldings t={t} inNative={inNative} px={px} />}
        <div className="grid grid-cols-4 gap-1">
          <div><div className="text-dim">Bal</div><div className="num text-ink">{stats.value ? money(stats.value, stats.value / px) : '--'}</div></div>
          <div><div className="text-dim">Bought</div><div className="num text-up">{stats.bought ? money(stats.bought, stats.boughtN) : '--'}</div></div>
          <div><div className="text-dim">Sold</div><div className="num text-down">{stats.sold ? money(stats.sold, stats.soldN) : '--'}</div></div>
          <button type="button" onClick={() => setIp({ pnlUnit: ip.pnlUnit === 'pct' ? 'value' : 'pct' })} className="text-right" title="Click to switch between value and %">
            <div className="text-dim">PnL</div>
            <div className={clsx('num', toneClass(stats.pnl))}>
              {!stats.bought ? '--' : ip.pnlUnit === 'pct' ? fmtPct(stats.pnlPct) : `${stats.pnl >= 0 ? '+' : '-'}${inNative ? fmtNative(Math.abs(stats.pnl) / px, chain, false) : fmtCompact(Math.abs(stats.pnl))}`}
            </div>
          </button>
        </div>
      </div>
      )}
      </>
      )}
      {/* Wallet holdings open beside the panel (right if there is room, else left), joined to it as one piece: same
          height, one shared line between them, square corners where they meet */}
      {sideOpen && (
        <div className={clsx('absolute -bottom-px -top-px border border-line2 bg-panel', holdingsSide === 'right' ? 'left-full rounded-r-lg' : 'right-full rounded-l-lg')} style={{ width: SIDE_W }}>
          <WalletHoldings t={t} inNative={inNative} px={px} tall />
        </div>
      )}
      <div className="flex items-center justify-between border-t border-line px-2.5 py-1 text-[9px] text-dim">
        <span>{o.dragAnywhere ? 'Drag anywhere to move' : 'Drag the top bar to move'}{hk.on ? ' · hotkeys on' : ''}</span>
        <span><Kbd>I</Kbd> toggle</span>
      </div>
    </div>
  )
}

/**
 * GMGN-style "show holdings": every wallet you own with how much of this coin it holds, its value and PnL, and its
 * chain coin. Tick a wallet to trade from it; the red button sells that one wallet's bag.
 */
function WalletHoldings({ t, inNative, px, tall }: { t: Token; inNative: boolean; px: number; tall?: boolean }) {
  const { all, activeIds } = useWallets()
  const setActive = useGame((s) => s.setActiveWallets)
  const sell = useGame((s) => s.sell)
  const running = useGame((s) => s.runStatus === 'running')
  const rows = all.map((a) => {
    const p = a.positions[t.id]
    const qty = p?.qty ?? 0
    const value = qty * t.price
    return { a, qty, value, pnl: p ? value - p.costBasis : 0, cost: p?.costBasis ?? 0, pct: p ? (qty / SUPPLY) * 100 : 0 }
  })
  const holding = rows.filter((r) => r.qty > 0).length
  const totalQty = rows.reduce((s, r) => s + r.qty, 0)
  const toggle = (id: string) => {
    const on = activeIds.includes(id)
    if (on && activeIds.length === 1) return
    setActive(on ? activeIds.filter((x) => x !== id) : [...activeIds, id])
  }
  return (
    <div className={tall ? 'flex h-full flex-col' : 'mb-1.5 rounded border border-line bg-bg/60'}>
      <div className={clsx('flex items-center justify-between border-b px-1.5 text-[9px] text-dim', tall ? 'border-line px-2.5 py-2' : 'border-line/60 py-0.5')}>
        <span>{holding}/{all.length} wallets hold {t.ticker}</span>
        <span className="num">{fmtNum(totalQty)} · {((totalQty / SUPPLY) * 100).toFixed(2)}% supply</span>
      </div>
      <ul className={clsx('overflow-y-auto', tall ? 'min-h-0 flex-1' : 'max-h-[180px]')}>
        {rows.map((r) => {
          const on = activeIds.includes(r.a.id)
          return (
            <li key={r.a.id} className={clsx('flex items-center gap-1 border-b border-line/30 px-1.5 py-1 last:border-0', r.qty <= 0 && 'opacity-60')}>
              <button type="button" onClick={() => toggle(r.a.id)} aria-pressed={on} title={on ? 'Trading from this wallet' : 'Trade from this wallet too'} className={clsx('grid size-3.5 shrink-0 place-items-center rounded-sm border', on ? 'border-accent bg-accent text-black' : 'border-line2')}>
                {on && <Check size={9} strokeWidth={3} />}
              </button>
              <span className="text-[12px]">{r.a.emoji}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[10px] font-semibold text-ink">{r.a.name}</span>
                <span className="num block text-[9px] text-dim">{fmtNative(r.a.balances[t.chain], t.chain)}</span>
              </span>
              <span className="text-right">
                <span className="num block text-[10px] text-ink">{r.qty > 0 ? fmtNum(r.qty) : '0'}</span>
                <span className="num block text-[9px] text-dim">{r.qty > 0 ? (inNative ? fmtNative(r.value / px, t.chain, false) : fmtUsd(r.value, r.value < 10 ? 2 : 0)) : '—'}</span>
              </span>
              <span className={clsx('num w-11 text-right text-[9px]', r.qty > 0 ? toneClass(r.pnl) : 'text-dim')}>{r.qty > 0 && r.cost > 0 ? fmtPct(r.pnl / r.cost) : '—'}</span>
              <button
                type="button"
                disabled={!running || r.qty <= 0}
                onClick={() => sell(r.qty, t.id, undefined, r.a.id)}
                title={`Sell all of ${r.a.name}'s ${t.ticker}`}
                className="rounded border border-down/50 px-1 text-[9px] font-bold leading-[16px] text-down hover:bg-down hover:text-white disabled:opacity-25 disabled:hover:bg-transparent disabled:hover:text-down"
              >
                Sell
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** Every token the selected wallets hold, combined per token, biggest bag first. */
function useHoldings() {
  const { selected } = useWallets()
  const map = useTokenMap()
  return useMemo(() => {
    const byId = new Map<string, { qty: number; cost: number }>()
    for (const a of selected)
      for (const [id, p] of Object.entries(a.positions)) {
        if (!(p.qty > 0)) continue
        const cur = byId.get(id) ?? { qty: 0, cost: 0 }
        byId.set(id, { qty: cur.qty + p.qty, cost: cur.cost + p.costBasis })
      }
    const rows: { t: Token; qty: number; cost: number; value: number; pnl: number }[] = []
    byId.forEach((h, id) => {
      const t = map.get(id)
      if (!t) return
      const value = h.qty * t.price
      rows.push({ t, ...h, value, pnl: value - h.cost })
    })
    return rows.sort((a, b) => b.value - a.value)
  }, [selected, map])
}

/** GMGN-style Holding tab: your open bags, one-click % sells, click a coin to trade it. */
function HoldingList({ current, onPick }: { current: string; onPick: () => void }) {
  const rows = useHoldings()
  const select = useGame((s) => s.select)
  const sell = useGame((s) => s.sell)
  const running = useGame((s) => s.runStatus === 'running')
  const pcts = useGame((s) => s.settings.sellPresets[s.settings.presetIdx])
  const [hideSmall, setHideSmall] = useState(() => load<boolean>('instantHideSmall') ?? false)
  const list = hideSmall ? rows.filter((r) => r.value >= 1) : rows
  const total = list.reduce((a, r) => a + r.value, 0)
  const totalPnl = list.reduce((a, r) => a + r.pnl, 0)
  const totalCost = list.reduce((a, r) => a + r.cost, 0)

  return (
    <div>
      <div className="flex items-center gap-2 px-2.5 py-1.5 text-[10px]">
        <span className="text-dim">Value</span>
        <span className="num font-bold text-ink">{fmtUsd(total, 0)}</span>
        <span className={clsx('num', toneClass(totalPnl))}>{totalCost > 0 ? fmtPct(totalPnl / totalCost) : ''}</span>
        <label className="ml-auto flex cursor-pointer items-center gap-1 text-dim">
          <input type="checkbox" checked={hideSmall} onChange={(e) => { setHideSmall(e.target.checked); save('instantHideSmall', e.target.checked) }} className="accent-[var(--accent)]" />
          Hide &lt;$1
        </label>
      </div>
      {list.length === 0 ? (
        <div className="px-2.5 pb-4 pt-2 text-center text-[11px] text-dim">No holdings yet — buy something on the Trade tab</div>
      ) : (
        <ul className="max-h-[320px] overflow-y-auto border-t border-line">
          {list.map((r) => {
            const dead = r.t.status === 'rugged' || r.t.status === 'dead'
            return (
              <li key={r.t.id} className={clsx('border-b border-line/50 px-2.5 py-1.5', r.t.id === current && 'bg-raise/40')}>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { select(r.t.id); onPick() }}
                    className="flex min-w-0 flex-1 items-center gap-1.5 text-left hover:text-accent"
                    title={`Trade ${r.t.ticker}`}
                  >
                    <TokenIcon token={r.t} size={20} />
                    <span className="truncate text-[12px] font-bold">{r.t.ticker}</span>
                    <ChainBadge chain={r.t.chain} />
                    {dead && <span className="text-[9px] font-bold text-down">{r.t.status === 'rugged' ? 'RUGGED' : 'DEAD'}</span>}
                  </button>
                  <div className="text-right">
                    <div className="num text-[11px] font-semibold">{fmtUsd(r.value, r.value < 10 ? 2 : 0)}</div>
                    <div className={clsx('num text-[10px]', toneClass(r.pnl))}>
                      {r.pnl >= 0 ? '+' : '-'}{fmtCompact(Math.abs(r.pnl))} ({r.cost > 0 ? fmtPct(r.pnl / r.cost) : '--'})
                    </div>
                  </div>
                </div>
                <div className="mt-1 flex items-center gap-1">
                  <span className="num mr-auto truncate text-[10px] text-dim">{fmtNum(r.qty)} · {fmtCompact(r.t.mcap)} MC</span>
                  {pcts.map((p) => (
                    <button
                      key={p}
                      disabled={!running}
                      onClick={() => sell(p >= 100 ? r.qty : (r.qty * p) / 100, r.t.id)}
                      title={`Sell ${p}% of your ${r.t.ticker} instantly`}
                      className="num rounded border border-down/50 px-1.5 py-0.5 text-[10px] font-bold text-down transition-all hover:bg-down hover:text-white active:scale-95 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-down"
                    >
                      {p}%
                    </button>
                  ))}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {!running && <div className="m-2.5 rounded border border-warn/30 bg-warn/5 px-2 py-1 text-center text-[10px] text-warn">Start a round to trade</div>}
    </div>
  )
}

function Slots({ idx, onPick }: { idx: number; onPick: (i: number) => void }) {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <button key={i} onClick={() => onPick(i)} className={clsx('rounded px-1.5 text-[11px] font-bold', idx === i ? 'bg-raise text-ink' : 'text-dim hover:text-muted')}>
          P{i + 1}
        </button>
      ))}
    </>
  )
}

/** Tiny segmented switch, GMGN-style (e.g. % / SOL / USD). */
function UnitSwitch<T extends string>({ value, onChange, options, label, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string; className?: string }) {
  return (
    <div role="group" aria-label={label} title={label} className={clsx('inline-flex rounded border border-line2 bg-bg p-px', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={clsx('rounded-sm px-1.5 text-[10px] font-bold leading-[16px] transition-colors', value === o.value ? 'bg-raise text-ink' : 'text-dim hover:text-muted')}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function PresetInput({ value, onCommit, tone, suffix, prefix }: { value: number; onCommit: (v: number) => void; tone: 'up' | 'down'; suffix?: string; prefix?: string }) {
  const [v, setV] = useState(String(value))
  return (
    <label className={clsx('flex items-center rounded-md border bg-bg px-1', tone === 'up' ? 'border-up/50' : 'border-down/50')}>
      {prefix && <span className="text-[10px] text-dim">{prefix}</span>}
      <input
        value={v}
        inputMode="decimal"
        onChange={(e) => setV(e.target.value.replace(/[^0-9.]/g, ''))}
        onBlur={() => onCommit(parseFloat(v))}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        className="num h-[30px] w-full min-w-0 bg-transparent text-center text-[12px] font-bold outline-none"
        aria-label="Preset amount"
      />
      {suffix && <span className="text-[10px] text-dim">{suffix}</span>}
    </label>
  )
}
