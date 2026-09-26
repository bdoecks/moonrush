import clsx from 'clsx'
import { Gauge, Settings2, ShieldCheck, ShieldOff } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { CHAINS, fmtNative } from '../../data/chains'
import { DEFAULT_TRADE_SETTINGS, FEE_UI, SLIPPAGE_CHIPS, speedOf } from '../../data/tradeSettings'
import { slotSetting, useGame } from '../../game/store'
import type { Chain, TradeSetting, TradeSettings } from '../../types'
import { fmtUsd } from '../../utils/format'
import { Modal, Segmented, Toggle } from '../ui'


/** Compact summary of a slot's settings, like GMGN's line under the preset tabs. Click opens the editor. */
export function TradeSettingsChip({ chain, side, slot, onOpen, className }: { chain: Chain; side: 'buy' | 'sell'; slot?: number; onOpen: () => void; className?: string }) {
  const s = useGame((st) => slotSetting(st.settings, chain, side, slot))
  const px = useGame((st) => st.market.native?.[chain]?.price ?? CHAINS[chain].basePrice)
  const sp = speedOf(s, chain, px)
  return (
    <button
      type="button"
      onClick={onOpen}
      title={`${side === 'buy' ? 'Buy' : 'Sell'} settings: max slippage, ${FEE_UI[chain].priorityLabel.toLowerCase()}, tip and anti-MEV`}
      className={clsx('num flex min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-[10px] text-dim transition-colors hover:bg-raise hover:text-ink', className)}
    >
      <Settings2 size={11} className="shrink-0" />
      <span>{s.slippage === null ? 'Auto' : `${s.slippage}%`}</span>
      <span className="flex items-center gap-0.5"><Gauge size={10} className={sp.cls} />{fmtNative(s.priority + s.tip, chain, false)}</span>
      {s.antiMev ? <ShieldCheck size={11} className="text-up" /> : <ShieldOff size={11} className="text-dim" />}
    </button>
  )
}

/** Editor for all P1/P2/P3 buy and sell settings on one chain. Changes save on "Save". */
export function TradeSettingsModal({ chain, side: initialSide, slot: initialSlot, onClose }: { chain: Chain; side: 'buy' | 'sell'; slot: number; onClose: () => void }) {
  const saved = useGame((s) => s.settings.tradeSettings)
  const updateSettings = useGame((s) => s.updateSettings)
  const px = useGame((s) => s.market.native?.[chain]?.price ?? CHAINS[chain].basePrice)
  const [draft, setDraft] = useState<TradeSettings[Chain]>(() => structuredClone(saved[chain]))
  const [side, setSide] = useState(initialSide)
  const [slot, setSlot] = useState(initialSlot)
  const ui = FEE_UI[chain]
  const meta = CHAINS[chain]
  const cur = draft[side][slot]
  const up = (patch: Partial<TradeSetting>) => setDraft((d) => ({ ...d, [side]: d[side].map((x, i) => (i === slot ? { ...x, ...patch } : x)) }))
  const sp = speedOf(cur, chain, px)
  const save = () => {
    updateSettings({ tradeSettings: { ...saved, [chain]: draft } })
    onClose()
  }

  return (
    <Modal title={<span className="flex items-center gap-2"><Settings2 size={15} /> Trade settings · <span style={{ color: meta.color }}>{meta.glyph} {meta.name}</span></span>} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Segmented value={side} onChange={setSide} options={[{ value: 'buy', label: <span className="text-up">Buy</span> }, { value: 'sell', label: <span className="text-down">Sell</span> }]} />
          <Segmented value={slot} onChange={setSlot} options={[0, 1, 2].map((i) => ({ value: i, label: `P${i + 1}` }))} className="ml-auto" />
        </div>

        <Field label="Max slippage" hint="Orders that would fill worse than this fail (and still burn the priority fee). Auto adapts to the pool.">
          <div className="flex flex-wrap gap-1">
            <Chip on={cur.slippage === null} onClick={() => up({ slippage: null })}>Auto</Chip>
            {SLIPPAGE_CHIPS.map((v) => <Chip key={v} on={cur.slippage === v} onClick={() => up({ slippage: v })}>{v}%</Chip>)}
            <NumInput value={cur.slippage ?? ''} onChange={(v) => up({ slippage: v === null ? null : Math.min(100, Math.max(0.1, v)) })} suffix="%" placeholder="Custom" />
          </div>
        </Field>

        <Field label={`${ui.priorityLabel} (${meta.native})`} hint={`Pays for faster inclusion: less time for the price to run against you. ≈ ${fmtUsd(cur.priority * px)} per trade.`}>
          <div className="flex flex-wrap gap-1">
            {ui.priorityChips.map((v, i) => <Chip key={v} on={cur.priority === v} onClick={() => up({ priority: v })}>{['Fast', 'Turbo', 'Ultra'][i]} {fmtNative(v, chain, false)}</Chip>)}
            <NumInput value={cur.priority} onChange={(v) => up({ priority: Math.max(0, v ?? 0) })} step={ui.step} />
          </div>
        </Field>

        <Field label={`${ui.tipLabel} (${meta.native})`} hint={`Extra tip to the ${chain === 'sol' ? 'block engine' : 'block builder'}. Counts toward speed like the priority fee. ≈ ${fmtUsd(cur.tip * px)}.`}>
          <div className="flex flex-wrap gap-1">
            {ui.tipChips.map((v) => <Chip key={v} on={cur.tip === v} onClick={() => up({ tip: v })}>{v === 0 ? 'Off' : fmtNative(v, chain, false)}</Chip>)}
            <NumInput value={cur.tip} onChange={(v) => up({ tip: Math.max(0, v ?? 0) })} step={ui.step} />
          </div>
        </Field>

        <div className="flex items-start justify-between gap-3 rounded-md border border-line2 p-2.5">
          <div>
            <div className="flex items-center gap-1.5 text-[12px] font-semibold">{cur.antiMev ? <ShieldCheck size={13} className="text-up" /> : <ShieldOff size={13} className="text-dim" />} Anti-MEV</div>
            <p className="mt-0.5 text-[10px] leading-snug text-dim">Sends the order privately so sandwich bots can't see it. Protects bigger orders on thin pools, but lands a little slower.</p>
          </div>
          <span className="shrink-0">
            <Toggle label="Anti-MEV" on={cur.antiMev} onChange={(v) => up({ antiMev: v })} />
          </span>
        </div>

        <div className="grid grid-cols-3 gap-2 rounded-md bg-bg/60 p-2 text-center">
          <div>
            <div className="text-[9px] uppercase tracking-wider text-dim">Speed</div>
            <div className={clsx('text-[13px] font-bold', sp.cls)}>{sp.label}</div>
            <div className="mx-auto mt-1 h-1 w-16 overflow-hidden rounded-full bg-line2"><div className="h-full bg-current" style={{ width: `${sp.pct}%` }} /></div>
          </div>
          <div>
            <div className="text-[9px] uppercase tracking-wider text-dim">Fee per trade</div>
            <div className="num text-[13px] font-bold">{fmtUsd((cur.priority + cur.tip) * px)}</div>
            <div className="num text-[9px] text-dim">{fmtNative(cur.priority + cur.tip, chain)}</div>
          </div>
          <div>
            <div className="text-[9px] uppercase tracking-wider text-dim">Sandwich risk</div>
            <div className={clsx('text-[13px] font-bold', cur.antiMev ? 'text-up' : 'text-warn')}>{cur.antiMev ? 'Protected' : 'Exposed'}</div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 text-[11px]">
          <button onClick={() => setDraft((d) => ({ ...d, [side]: d[side].map(() => ({ ...cur })) }))} className="rounded border border-line2 px-2 py-1 text-muted hover:text-ink">Copy P{slot + 1} to all {side} slots</button>
          <button onClick={() => setDraft((d) => ({ ...d, [side === 'buy' ? 'sell' : 'buy']: d[side].map((x) => ({ ...x })) }))} className="rounded border border-line2 px-2 py-1 text-muted hover:text-ink">Copy {side} → {side === 'buy' ? 'sell' : 'buy'}</button>
          <button onClick={() => setDraft(structuredClone(DEFAULT_TRADE_SETTINGS[chain]))} className="ml-auto rounded px-2 py-1 text-dim hover:text-ink">Reset defaults</button>
        </div>

        <div className="flex gap-2">
          <button onClick={onClose} className="h-9 flex-1 rounded-md border border-line2 text-[12px] font-semibold text-muted hover:text-ink">Cancel</button>
          <button onClick={save} className="h-9 flex-[2] rounded-md bg-accent text-[13px] font-extrabold text-black hover:brightness-110">Save</button>
        </div>
        <p className="text-[9px] leading-snug text-dim">Fees and MEV here are simulated game mechanics, paid in the chain coin you hold in MOONRUSH. P1 is cheap, P2 protected and P3 turbo by default.</p>
      </div>
    </Modal>
  )
}

function Field({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold text-muted">{label}</div>
      {children}
      <p className="mt-1 text-[10px] leading-snug text-dim">{hint}</p>
    </div>
  )
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} className={clsx('num rounded border px-2 py-1 text-[11px] font-semibold transition-colors', on ? 'border-accent/60 bg-accent/10 text-accent' : 'border-line2 text-muted hover:text-ink')}>
      {children}
    </button>
  )
}

/** Free-typed number (keeps "0." while typing); commits a number or null on change. */
function NumInput({ value, onChange, suffix, placeholder, step }: { value: number | ''; onChange: (v: number | null) => void; suffix?: string; placeholder?: string; step?: number }) {
  const [text, setText] = useState(value === '' ? '' : String(value))
  const [last, setLast] = useState(value)
  if (value !== last) {
    // Picked a chip: show it in the box too.
    setLast(value)
    setText(value === '' ? '' : String(value))
  }
  return (
    <label className="flex h-[26px] w-[92px] items-center rounded border border-line2 bg-bg px-1.5 focus-within:border-accent/60">
      <input
        inputMode="decimal"
        value={text}
        placeholder={placeholder ?? (step ? String(step) : '')}
        onChange={(e) => {
          const t = e.target.value.replace(/[^0-9.]/g, '')
          setText(t)
          const n = t === '' ? null : Number(t)
          if (n === null || Number.isFinite(n)) {
            setLast(n ?? '')
            onChange(n)
          }
        }}
        className="num w-full min-w-0 bg-transparent text-[11px] outline-none placeholder:text-dim"
      />
      {suffix && <span className="text-[10px] text-dim">{suffix}</span>}
    </label>
  )
}
