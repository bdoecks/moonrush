// Instant Trade settings (the gear on the panel), modelled on Axiom's: General, Wallet Group and Hotkeys.
import clsx from 'clsx'
import { useEffect, useState, type ReactNode } from 'react'
import { useGame } from '../../game/store'
import type { InstantHotkeys, InstantPrefs } from '../../types'
import { Pick } from '../discover/trenchDisplay'
import { Modal, Toggle } from '../ui'

export const DEFAULT_HOTKEYS: InstantHotkeys = { on: false, buy: ['q', 'w', 'e', 'r'], sell: ['a', 's', 'd', 'f'], initials: 'g', bubbles: 'h' }

/** Instant Trade settings with their defaults filled in. */
export function instantOpts(ip: InstantPrefs) {
  return {
    pnlRow: ip.pnlRow ?? true,
    resetPnl: ip.resetPnl ?? false,
    dragAnywhere: ip.dragAnywhere ?? false,
    unitSwitch: ip.unitSwitch ?? true,
    tokenAmounts: ip.tokenAmounts ?? true,
    shape: ip.shape ?? 'square',
    buyRows: ip.buyRows ?? 1,
    sellRows: ip.sellRows ?? 1,
    sellMode: ip.sellMode ?? 'follow',
    groupChips: ip.groupChips ?? false,
    rotateGroups: ip.rotateGroups ?? false,
    hotkeys: { ...DEFAULT_HOTKEYS, ...(ip.hotkeys ?? {}) },
  }
}

const keyLabel = (k: string) => (k === ' ' ? 'Space' : k.length === 1 ? k.toUpperCase() : k)

type Tab = 'general' | 'groups' | 'hotkeys'

export function InstantSettingsModal({ onClose }: { onClose: () => void }) {
  const ip = useGame((s) => s.settings.instant)
  const updateSettings = useGame((s) => s.updateSettings)
  const o = instantOpts(ip)
  const [tab, setTab] = useState<Tab>('general')
  const [sub, setSub] = useState<'display' | 'amounts' | 'sell'>('display')
  // Always build on the latest saved settings, so quick clicks in a row never overwrite each other.
  const set = (patch: Partial<InstantPrefs>) => updateSettings({ instant: { ...useGame.getState().settings.instant, ...patch } })
  const setKeys = (patch: Partial<InstantHotkeys>) => set({ hotkeys: { ...instantOpts(useGame.getState().settings.instant).hotkeys, ...patch } })
  const tabs: { id: Tab; label: string }[] = [{ id: 'general', label: 'General' }, { id: 'groups', label: 'Wallet group' }, { id: 'hotkeys', label: 'Hotkeys' }]
  const hk = o.hotkeys
  // One key can only do one thing: taking a key that's in use swaps the two.
  const assign = (slot: { list: 'buy' | 'sell'; i: number } | { one: 'initials' | 'bubbles' }, key: string) => {
    const next: InstantHotkeys = { ...hk, buy: [...hk.buy], sell: [...hk.sell] }
    const read = () => ('one' in slot ? next[slot.one] : next[slot.list][slot.i])
    const old = read()
    for (const l of ['buy', 'sell'] as const) next[l] = next[l].map((k) => (k === key ? old : k))
    if (next.initials === key) next.initials = old
    if (next.bubbles === key) next.bubbles = old
    if ('one' in slot) next[slot.one] = key
    else next[slot.list][slot.i] = key
    setKeys(next)
  }

  return (
    <Modal title="Instant Trade" onClose={onClose}>
      <div className="p-3">
        <div className="mb-3 flex flex-wrap gap-1">
          {tabs.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} className={clsx('rounded-full px-3 py-1 text-[12px] font-semibold', tab === t.id ? 'bg-raise text-ink' : 'text-muted hover:text-ink')}>{t.label}</button>
          ))}
        </div>

        {tab === 'general' && (
          <>
            <div className="divide-y divide-line rounded-lg border border-line bg-bg px-3">
              <Row label="PNL row" hint="The Bal / Bought / Sold / PnL row at the bottom of the panel"><Toggle label="PNL row" on={o.pnlRow} onChange={(v) => set({ pnlRow: v })} /></Row>
              <Row label="Reset PNL" hint="Adds a button on that row to start its numbers again from zero for the coin you're on"><Toggle label="Reset PNL" on={o.resetPnl} onChange={(v) => set({ resetPnl: v })} /></Row>
              <Row label="Drag panel from anywhere" hint="Off: only the top bar moves it"><Toggle label="Drag panel from anywhere" on={o.dragAnywhere} onChange={(v) => set({ dragAnywhere: v })} /></Row>
            </div>
            <div className="mb-2 mt-3 flex gap-1">
              {([['display', 'Display'], ['amounts', 'Amount rows'], ['sell', 'Sell rows']] as const).map(([id, label]) => (
                <button key={id} onClick={() => setSub(id)} className={clsx('rounded-full px-3 py-1 text-[12px] font-semibold', sub === id ? 'bg-raise text-ink' : 'text-muted hover:text-ink')}>{label}</button>
              ))}
            </div>
            <div className="divide-y divide-line rounded-lg border border-line bg-bg px-3">
              {sub === 'display' && (
                <>
                  <Pick label="Currency switcher" hint="The SOL / USD and % / SOL / USD switches beside Buy and Sell" value={o.unitSwitch ? 'show' : 'hide'} onChange={(v) => set({ unitSwitch: v === 'show' })} options={[{ v: 'hide', label: 'Hide', demo: <span className="text-[10px] font-bold text-up">Buy</span> }, { v: 'show', label: 'Show', demo: <span className="text-[10px] font-bold text-up">Buy <span className="rounded border border-line2 px-1 text-[8px] text-ink">SOL</span></span> }]} />
                  <Pick label="Token amounts" hint="The wallet balance and your bag, under the buttons" value={o.tokenAmounts ? 'show' : 'hide'} onChange={(v) => set({ tokenAmounts: v === 'show' })} options={[{ v: 'hide', label: 'Hide', demo: <span className="num text-[9px] text-dim">—</span> }, { v: 'show', label: 'Show', demo: <span className="num text-[9px] text-muted">680K TICKER</span> }]} />
                  <Pick label="Button shape" value={o.shape} onChange={(v) => set({ shape: v })} options={[{ v: 'rounded', label: 'Rounded', demo: <span className="num rounded-full border border-up/60 px-2.5 py-0.5 text-[10px] font-bold text-up">0.5</span> }, { v: 'square', label: 'Square', demo: <span className="num rounded-md border border-up/60 px-2.5 py-0.5 text-[10px] font-bold text-up">0.5</span> }]} />
                </>
              )}
              {sub === 'amounts' && (
                <>
                  <Row label="Buy rows" hint="Row 1 is the preset you're on (P1 / P2 / P3). Rows 2 and 3 add your other presets' amounts."><Count value={o.buyRows} onChange={(n) => set({ buyRows: n })} /></Row>
                  <Row label="Sell rows"><Count value={o.sellRows} onChange={(n) => set({ sellRows: n })} /></Row>
                </>
              )}
              {sub === 'sell' && (
                <Pick
                  label="Sell rows show" hint="Follow the % / coin / USD switch, show amounts and percentages together, or always percentages"
                  value={o.sellMode} onChange={(v) => set({ sellMode: v })}
                  options={[
                    { v: 'follow', label: 'Follow switch', demo: <span className="num text-[9px] text-down">25% 50%</span> },
                    { v: 'both', label: 'Amounts + %', demo: <span className="num block text-[9px] leading-tight text-down">0.1 0.5<br />25% 100%</span> },
                    { v: 'pct', label: 'Percentages', demo: <span className="num text-[9px] text-down">10% 100%</span> },
                  ]}
                />
              )}
            </div>
          </>
        )}

        {tab === 'groups' && (
          <div className="divide-y divide-line rounded-lg border border-line bg-bg px-3">
            <Row label="Wallet groups in the panel" hint="Shows your wallet groups along the top; click one to trade from that group's wallets"><Toggle label="Wallet groups in the panel" on={o.groupChips} onChange={(v) => set({ groupChips: v })} /></Row>
            <Row label="Rotate groups" hint="Each buy from the panel steps to the next wallet group, so your buys spread across groups"><Toggle label="Rotate groups" on={o.rotateGroups} onChange={(v) => set({ rotateGroups: v })} /></Row>
            <p className="py-2.5 text-[11px] text-dim">Make and edit wallet groups in Portfolio → Wallet groups.</p>
          </div>
        )}

        {tab === 'hotkeys' && (
          <>
            <div className="divide-y divide-line rounded-lg border border-line bg-bg px-3">
              <Row label="Use hotkeys" hint="Work while the Instant Trade panel is open and you're not typing. They take priority over the game's other shortcuts on those keys."><Toggle label="Use hotkeys" on={hk.on} onChange={(v) => setKeys({ on: v })} /></Row>
              <Row label="Toggle chart markers" dim={!hk.on}><KeyBox value={hk.bubbles} disabled={!hk.on} onPick={(k) => assign({ one: 'bubbles' }, k)} /></Row>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="divide-y divide-line rounded-lg border border-line bg-bg px-3">
                {hk.buy.map((k, i) => <Row key={i} label={`Buy ${i + 1}`} dim={!hk.on}><KeyBox value={k} disabled={!hk.on} onPick={(key) => assign({ list: 'buy', i }, key)} /></Row>)}
              </div>
              <div className="divide-y divide-line rounded-lg border border-line bg-bg px-3">
                {hk.sell.map((k, i) => <Row key={i} label={`Sell ${i + 1}`} dim={!hk.on}><KeyBox value={k} disabled={!hk.on} onPick={(key) => assign({ list: 'sell', i }, key)} /></Row>)}
                <Row label="Sell initials" hint="Sells enough to get back what you put in" dim={!hk.on}><KeyBox value={hk.initials} disabled={!hk.on} onPick={(key) => assign({ one: 'initials' }, key)} /></Row>
              </div>
            </div>
            <p className="mt-2 text-[10px] text-dim">Buy 1–4 and Sell 1–4 are the first row of buttons, left to right. Click a key box, then press the key you want.</p>
          </>
        )}

        <div className="mt-3 flex justify-end">
          <button onClick={onClose} className="rounded-md bg-accent px-4 py-1.5 text-[12px] font-extrabold text-accent-ink hover:brightness-110">Done</button>
        </div>
      </div>
    </Modal>
  )
}

function Row({ label, hint, dim, children }: { label: string; hint?: string; dim?: boolean; children: ReactNode }) {
  return (
    <div className={clsx('flex items-center justify-between gap-3 py-2.5', dim && 'opacity-50')}>
      <div className="min-w-0">
        <div className="text-[12px] font-semibold">{label}</div>
        {hint && <div className="text-[10px] text-dim">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function Count({ value, onChange }: { value: number; onChange: (n: 1 | 2 | 3) => void }) {
  return (
    <div className="flex rounded-md border border-line2 bg-panel p-0.5">
      {([1, 2, 3] as const).map((n) => (
        <button key={n} onClick={() => onChange(n)} aria-pressed={value === n} className={clsx('num size-6 rounded text-[12px] font-bold', value === n ? 'bg-raise text-ink' : 'text-dim hover:text-ink')}>{n}</button>
      ))}
    </div>
  )
}

/** Click, then press a key to record it. */
function KeyBox({ value, onPick, disabled }: { value: string; onPick: (key: string) => void; disabled?: boolean }) {
  const [rec, setRec] = useState(false)
  useEffect(() => {
    if (!rec) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopImmediatePropagation()
      if (e.key !== 'Escape' && (e.key.length === 1 || /^F\d+$/.test(e.key))) onPick(e.key.toLowerCase())
      setRec(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [rec, onPick])
  return (
    <button disabled={disabled} onClick={() => setRec(true)} title={rec ? 'Press a key (Esc to cancel)' : 'Record key'} className={clsx('num h-7 w-14 rounded-md border text-[12px] font-bold', rec ? 'border-accent bg-accent/10 text-accent' : 'border-line2 bg-panel text-ink hover:border-muted')}>
      {rec ? '…' : keyLabel(value)}
    </button>
  )
}
