import clsx from 'clsx'
import { Plus, RotateCcw, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { CHAIN_IDS, CHAINS } from '../../data/chains'
import { useGame } from '../../game/store'
import { DEFAULT_TRACKER } from '../../game/tracker'
import type { TrackerSettings } from '../../types'
import { Modal, Segmented, Toggle } from '../ui'

type Tab = 'alerts' | 'filters' | 'groups'

/** GMGN-style wallet tracker settings: alert rules, feed filters and wallet groups. */
export function TrackerSettingsModal({ onClose, initialTab = 'alerts' }: { onClose: () => void; initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab)
  return (
    <Modal title="Wallet tracker settings" onClose={onClose}>
      <Segmented
        value={tab}
        onChange={setTab}
        className="mb-3 w-full [&>button]:flex-1"
        options={[{ value: 'alerts', label: 'Alerts' }, { value: 'filters', label: 'Feed filters' }, { value: 'groups', label: 'Groups' }]}
      />
      {tab === 'alerts' && <AlertSettings />}
      {tab === 'filters' && <FilterSettings />}
      {tab === 'groups' && <GroupSettings />}
    </Modal>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line/50 py-2 last:border-0">
      <div className="min-w-0">
        <div className="text-[12px] font-semibold">{label}</div>
        {hint && <div className="text-[10px] leading-snug text-dim">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

/** Number box where empty means "no limit". */
function NumBox({ value, onChange, prefix, suffix, placeholder = 'Any', id, label }: { value: number | null; onChange: (v: number | null) => void; prefix?: string; suffix?: string; placeholder?: string; id: string; label: string }) {
  return (
    <label htmlFor={id} className="flex h-7 w-28 items-center rounded-md border border-line2 bg-bg px-2 focus-within:border-accent/60">
      {prefix && <span className="text-[11px] text-dim">{prefix}</span>}
      <input
        id={id}
        aria-label={label}
        inputMode="decimal"
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(e) => {
          const raw = e.target.value.replace(/[^0-9.]/g, '')
          onChange(raw === '' ? null : Number(raw))
        }}
        className="num w-full min-w-0 bg-transparent px-1 text-right text-[12px] outline-none placeholder:text-dim"
      />
      {suffix && <span className="text-[11px] text-dim">{suffix}</span>}
    </label>
  )
}

function useTracker() {
  const t = useGame((s) => s.tracker)
  const update = useGame((s) => s.updateTracker)
  return [t, update] as const
}

function AlertSettings() {
  const [t, set] = useTracker()
  const off = !t.alerts
  return (
    <div>
      <Row label="Trade alerts" hint="Pop-ups when a tracked wallet trades. Mute single wallets on the Wallet tab.">
        <Toggle on={t.alerts} onChange={(v) => set({ alerts: v })} label="Trade alerts" />
      </Row>
      <div className={clsx(off && 'pointer-events-none opacity-40')}>
        <Row label="Buys"><Toggle on={t.alertBuys} onChange={(v) => set({ alertBuys: v })} label="Alert on buys" /></Row>
        <Row label="Sells"><Toggle on={t.alertSells} onChange={(v) => set({ alertSells: v })} label="Alert on sells" /></Row>
        <Row label="First buys only" hint="Skip 'buy more' adds; only a wallet's first buy of a coin.">
          <Toggle on={t.alertFirstBuyOnly} onChange={(v) => set({ alertFirstBuyOnly: v })} label="Alert on first buys only" />
        </Row>
        <Row label="Minimum trade size" hint="Ignore trades smaller than this.">
          <NumBox id="trk-alert-min" label="Minimum alert trade size" value={t.alertMinUsd || null} onChange={(v) => set({ alertMinUsd: v ?? 0 })} prefix="$" />
        </Row>
        <Row label="Use feed filters" hint="Only alert on trades that also pass your feed filters (chain, MC, age, group).">
          <Toggle on={t.alertUseFilters} onChange={(v) => set({ alertUseFilters: v })} label="Alerts use feed filters" />
        </Row>
        <Row label="Pop-up"><Toggle on={t.alertPopup} onChange={(v) => set({ alertPopup: v })} label="Show pop-ups" /></Row>
        <Row label="Pop-up position" hint="Tracker alerts and market events share this corner. Bottom right keeps them clear of page controls.">
          <Segmented value={t.alertPosition} onChange={(v) => set({ alertPosition: v })} options={[{ value: 'bottom-right', label: 'Bottom right' }, { value: 'top-right', label: 'Top right' }]} />
        </Row>
        <Row label="Sound" hint="Needs game sound on (speaker icon).">
          <Toggle on={t.alertSound} onChange={(v) => set({ alertSound: v })} label="Alert sound" />
        </Row>
      </div>
      <Row label="Cluster alert" hint="Highlight a buy once this many tracked wallets hold the coin.">
        <Segmented value={t.clusterMin} onChange={(v) => set({ clusterMin: v })} options={[{ value: 0, label: 'Off' }, { value: 2, label: '2' }, { value: 3, label: '3' }, { value: 5, label: '5' }]} />
      </Row>
    </div>
  )
}

function FilterSettings() {
  const [t, set] = useTracker()
  const toggleChain = (c: (typeof CHAIN_IDS)[number]) => set({ chains: t.chains.includes(c) ? t.chains.filter((x) => x !== c) : [...t.chains, c] })
  const reset: Partial<TrackerSettings> = {
    chains: DEFAULT_TRACKER.chains, side: 'all', minUsd: 0, minMcap: null, maxMcap: null, maxAgeMin: null, firstBuyOnly: false, group: 'all',
  }
  return (
    <div>
      <Row label="Chains" hint="None selected = every chain.">
        <div className="flex gap-1">
          {CHAIN_IDS.map((c) => (
            <button key={c} onClick={() => toggleChain(c)} aria-pressed={t.chains.includes(c)} className={clsx('rounded-md border px-2 py-0.5 text-[11px] font-bold', t.chains.includes(c) ? 'border-accent/60 bg-accent/10 text-accent' : 'border-line2 text-muted hover:text-ink')}>
              {CHAINS[c].short}
            </button>
          ))}
        </div>
      </Row>
      <Row label="Trades">
        <Segmented value={t.side} onChange={(v) => set({ side: v })} options={[{ value: 'all', label: 'All' }, { value: 'buy', label: 'Buys' }, { value: 'sell', label: 'Sells' }]} />
      </Row>
      <Row label="First buys only" hint="Hide 'buy more' adds.">
        <Toggle on={t.firstBuyOnly} onChange={(v) => set({ firstBuyOnly: v })} label="Feed: first buys only" />
      </Row>
      <Row label="Min trade size"><NumBox id="trk-min-usd" label="Minimum trade size" value={t.minUsd || null} onChange={(v) => set({ minUsd: v ?? 0 })} prefix="$" /></Row>
      <Row label="Min MC" hint="Market cap at the time of the trade."><NumBox id="trk-min-mc" label="Minimum market cap" value={t.minMcap} onChange={(v) => set({ minMcap: v })} prefix="$" /></Row>
      <Row label="Max MC"><NumBox id="trk-max-mc" label="Maximum market cap" value={t.maxMcap} onChange={(v) => set({ maxMcap: v })} prefix="$" /></Row>
      <Row label="Max coin age" hint="Only coins launched within this long."><NumBox id="trk-max-age" label="Maximum coin age in minutes" value={t.maxAgeMin} onChange={(v) => set({ maxAgeMin: v })} suffix="min" /></Row>
      <button onClick={() => set(reset)} className="mt-3 flex items-center gap-1.5 text-[11px] font-semibold text-muted hover:text-ink"><RotateCcw size={12} /> Reset filters</button>
    </div>
  )
}

function GroupSettings() {
  const [t, set] = useTracker()
  const labels = useGame((s) => s.walletLabels)
  const tracked = useGame((s) => s.trackedWallets)
  const setLabel = useGame((s) => s.setWalletLabel)
  const [name, setName] = useState('')
  const clean = name.trim().slice(0, 18)
  const canAdd = !!clean && !t.groups.some((g) => g.toLowerCase() === clean.toLowerCase())
  const add = () => {
    if (!canAdd) return
    set({ groups: [...t.groups, clean] })
    setName('')
  }
  const removeGroup = (g: string) => {
    for (const id of Object.keys(labels)) if (labels[id]?.group === g) setLabel(id, { group: undefined })
    set({ groups: t.groups.filter((x) => x !== g), group: t.group === g ? 'all' : t.group })
  }
  return (
    <div className="space-y-3">
      <p className="text-[11px] text-dim">Sort tracked wallets into groups, then filter the feed by group. Assign a wallet's group on the Wallet tab.</p>
      <div className="rounded-md border border-line">
        {t.groups.length === 0 && <div className="px-3 py-3 text-center text-[11px] text-dim">No groups yet</div>}
        {t.groups.map((g) => {
          const n = tracked.filter((id) => labels[id]?.group === g).length
          return (
            <div key={g} className="flex items-center gap-2 border-b border-line/50 px-3 py-2 text-[12px] last:border-0">
              <span className="font-semibold">{g}</span>
              <span className="num text-[10px] text-dim">{n} wallet{n === 1 ? '' : 's'}</span>
              <button onClick={() => removeGroup(g)} className="ml-auto rounded p-1 text-dim hover:text-down" aria-label={`Delete group ${g}`}><X size={13} /></button>
            </div>
          )
        })}
      </div>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); add() }}>
        <input id="trk-new-group" value={name} onChange={(e) => setName(e.target.value)} maxLength={18} placeholder="New group name" className="h-8 min-w-0 flex-1 rounded-md border border-line2 bg-bg px-2 text-[12px] outline-none placeholder:text-dim focus:border-accent/60" aria-label="New group name" />
        <button type="submit" disabled={!canAdd} className="flex items-center gap-1 rounded-md bg-accent px-3 text-[12px] font-bold text-accent-ink disabled:opacity-40"><Plus size={13} /> Add</button>
      </form>
    </div>
  )
}
