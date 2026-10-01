// Trenches "Display" settings (like Axiom's Pulse Display): how the cards look, which parts of a row show, the
// order of the three columns, and what a quick buy does. Saved with your settings.
import clsx from 'clsx'
import { ArrowLeft, ArrowRight, SlidersHorizontal } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useGame } from '../../game/store'
import type { TrenchColumn, TrenchDisplay } from '../../types'
import { Modal } from '../ui'

export const DEFAULT_TRENCH_DISPLAY: TrenchDisplay = {
  metrics: 'small', spaced: false, search: true, image: 'square', progress: 'ring', volume: 'beneath', roundMc: false, curveTag: 'always',
  hide: [], order: ['new', 'stretch', 'grad'],
}

/** Your Trenches display settings (defaults filled in). */
export function useTrenchDisplay(): TrenchDisplay {
  const saved = useGame((s) => s.settings.trenchDisplay)
  const d = { ...DEFAULT_TRENCH_DISPLAY, ...(saved ?? {}) }
  // A saved order must still be exactly the three columns.
  const ok = d.order.length === 3 && DEFAULT_TRENCH_DISPLAY.order.every((c) => d.order.includes(c))
  return ok ? d : { ...d, order: DEFAULT_TRENCH_DISPLAY.order }
}

/** The parts of a card you can show or hide, grouped like Axiom's "Row Elements". */
export const ROW_ELEMENTS: { group: string; items: { id: string; label: string; sample: string }[] }[] = [
  { group: 'Token info', items: [
    { id: 'address', label: 'Address', sample: '0x1a…moon' },
    { id: 'chain', label: 'Chain', sample: '◎ SOL' },
    { id: 'pad', label: 'Launchpad', sample: '💊' },
    { id: 'socials', label: 'Socials', sample: '@ ✈ 🌐' },
    { id: 'risk', label: 'Risk', sample: 'MEDIUM' },
    { id: 'tags', label: 'Tags', sample: 'Tax · DEX · HELD' },
    { id: 'age', label: 'Age', sample: '46s' },
  ] },
  { group: 'Token metrics', items: [
    { id: 'volume', label: 'Volume', sample: 'V $12K' },
    { id: 'fees', label: 'Fees', sample: 'F $120' },
    { id: 'tx', label: 'TX', sample: 'TX 128' },
    { id: 'change', label: '5m change', sample: '+24.5%' },
  ] },
  { group: 'Trader', items: [
    { id: 'holders', label: 'Holders', sample: '👥 82' },
    { id: 'watchers', label: 'Watching', sample: '👁 9' },
  ] },
  { group: 'Audit', items: [
    { id: 'top10', label: 'Top 10 holders', sample: '9%' },
    { id: 'dev', label: 'Dev holding', sample: '4%' },
    { id: 'snipers', label: 'Snipers', sample: '3' },
    { id: 'insiders', label: 'Insiders', sample: '2%' },
    { id: 'bundlers', label: 'Bundlers', sample: '7%' },
  ] },
]

const COLUMN_NAMES: Record<TrenchColumn, string> = { new: 'New Pairs', stretch: 'Final Stretch', grad: 'Graduated' }

type Tab = 'layout' | 'rows' | 'order' | 'extras'

export function TrenchDisplayButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)} title="Display settings: card look, what each row shows, column order" className="flex h-6 items-center gap-1 rounded border border-line2 px-1.5 text-[10px] font-bold text-muted hover:text-ink">
        <SlidersHorizontal size={11} /> Display
      </button>
      {open && <TrenchDisplayModal onClose={() => setOpen(false)} />}
    </>
  )
}

function TrenchDisplayModal({ onClose }: { onClose: () => void }) {
  const d = useTrenchDisplay()
  const openAfter = useGame((s) => !!s.settings.quickBuyOpen)
  const updateSettings = useGame((s) => s.updateSettings)
  const [tab, setTab] = useState<Tab>('layout')
  // Always build on the latest saved settings, so quick clicks in a row never overwrite each other.
  const latest = (): TrenchDisplay => ({ ...d, ...(useGame.getState().settings.trenchDisplay ?? {}) })
  const set = (patch: Partial<TrenchDisplay>) => updateSettings({ trenchDisplay: { ...latest(), ...patch } })
  const toggle = (id: string) => {
    const hide = latest().hide
    set({ hide: hide.includes(id) ? hide.filter((x) => x !== id) : [...hide, id] })
  }
  const move = (i: number, by: number) => {
    const order = [...latest().order]
    const j = i + by
    if (j < 0 || j >= order.length) return
    ;[order[i], order[j]] = [order[j], order[i]]
    set({ order })
  }
  const tabs: { id: Tab; label: string }[] = [
    { id: 'layout', label: 'Layout' },
    { id: 'rows', label: 'Row elements' },
    { id: 'order', label: 'Table order' },
    { id: 'extras', label: 'Extras' },
  ]
  return (
    <Modal title="Trenches display" onClose={onClose}>
      <div className="p-3">
        <div className="mb-3 flex flex-wrap gap-1">
          {tabs.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} className={clsx('rounded-full px-3 py-1 text-[12px] font-semibold', tab === t.id ? 'bg-raise text-ink' : 'text-muted hover:text-ink')}>{t.label}</button>
          ))}
        </div>

        {tab === 'layout' && (
          <div className="divide-y divide-line rounded-lg border border-line bg-bg px-3">
            <Pick label="Metrics size" hint="How big market cap and volume are on each card" value={d.metrics} onChange={(v) => set({ metrics: v })} options={[{ v: 'small', label: 'Small', demo: <span className="num text-[11px]">MC 77K</span> }, { v: 'large', label: 'Large', demo: <span className="num text-[15px] font-bold">MC 77K</span> }]} />
            <Pick label="Spaced tables" hint="Columns joined together, or with a gap between them" value={d.spaced ? 'spaced' : 'merged'} onChange={(v) => set({ spaced: v === 'spaced' })} options={[{ v: 'merged', label: 'Merged', demo: <Boxes gap={0} /> }, { v: 'spaced', label: 'Spaced', demo: <Boxes gap={3} /> }]} />
            <Pick label="Show search bar" hint="The keyword box at the top of each column" value={d.search ? 'show' : 'hide'} onChange={(v) => set({ search: v === 'show' })} options={[{ v: 'hide', label: 'Hide', demo: <span className="block h-3 w-14 border-y border-line2" /> }, { v: 'show', label: 'Show', demo: <span className="rounded-full border border-line2 px-2 text-[9px] text-dim">Keyword</span> }]} />
            <Pick label="Image shape" value={d.image} onChange={(v) => set({ image: v })} options={[{ v: 'square', label: 'Square', demo: <span className="block size-5 rounded bg-raise ring-1 ring-line2" /> }, { v: 'circle', label: 'Circle', demo: <span className="block size-5 rounded-full bg-raise ring-1 ring-line2" /> }]} />
            <Pick label="Progress bar" hint="Bonding-curve progress: a coloured ring around the picture, or a bar under it" value={d.progress} onChange={(v) => set({ progress: v })} options={[{ v: 'ring', label: 'Ring', demo: <span className="block size-5 rounded bg-raise ring-2 ring-up" /> }, { v: 'bar', label: 'Bar', demo: <span className="block"><span className="block size-5 rounded bg-raise" /><span className="mt-0.5 block h-[3px] w-5 rounded-full bg-line2"><span className="block h-full w-3 rounded-full bg-up" /></span></span> }]} />
            <Pick label="Volume placement" hint="Beside market cap on one line, or on its own line beneath it" value={d.volume} onChange={(v) => set({ volume: v })} options={[{ v: 'beside', label: 'Beside', demo: <span className="num text-[9px]">V 12K · MC 77K</span> }, { v: 'beneath', label: 'Beneath', demo: <span className="num block text-right text-[9px] leading-tight">MC 77K<br />V 12K</span> }]} />
            <Pick label="Round market caps" value={d.roundMc ? 'rounded' : 'precise'} onChange={(v) => set({ roundMc: v === 'rounded' })} options={[{ v: 'precise', label: 'Precise', demo: <span className="num text-[10px]">MC $77.7K</span> }, { v: 'rounded', label: 'Rounded', demo: <span className="num text-[10px]">MC $77K</span> }]} />
            <Pick label="Curve % tag" hint="Show the bonding-curve % tag on every card, or only on the one you're hovering" value={d.curveTag} onChange={(v) => set({ curveTag: v })} options={[{ v: 'hover', label: 'On hover', demo: <span className="text-[9px] text-dim">hover</span> }, { v: 'always', label: 'Always', demo: <span className="rounded border border-warn/30 px-1 text-[9px] text-warn">Curve 68%</span> }]} />
          </div>
        )}

        {tab === 'rows' && (
          <div className="space-y-3">
            <p className="text-[11px] text-dim">Click to show or hide each part of a card. Dimmed = hidden.</p>
            {ROW_ELEMENTS.map((g) => (
              <div key={g.group}>
                <div className="mb-1.5 text-[11px] font-bold text-muted">{g.group}</div>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                  {g.items.map((it) => {
                    const on = !d.hide.includes(it.id)
                    return (
                      <button key={it.id} onClick={() => toggle(it.id)} aria-pressed={on} className={clsx('rounded-md border px-2 py-2 text-center transition-colors', on ? 'border-line2 bg-raise' : 'border-line bg-bg opacity-45 hover:opacity-80')}>
                        <span className="num block truncate text-[10px] text-muted">{it.sample}</span>
                        <span className="mt-1 block text-[11px] font-semibold">{it.label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
            <button onClick={() => set({ hide: [] })} className="text-[11px] text-accent underline">Show everything</button>
          </div>
        )}

        {tab === 'order' && (
          <div>
            <p className="mb-2 text-[11px] text-dim">Use the arrows to change the order of the three columns.</p>
            <div className="flex flex-wrap gap-2">
              {d.order.map((c, i) => (
                <div key={c} className="flex flex-1 items-center justify-between gap-1 rounded-md border border-line2 bg-raise px-2 py-3">
                  <button disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${COLUMN_NAMES[c]} left`} className="rounded p-1 text-muted hover:bg-panel hover:text-ink disabled:opacity-25"><ArrowLeft size={13} /></button>
                  <span className="text-[12px] font-bold">{COLUMN_NAMES[c]}</span>
                  <button disabled={i === d.order.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${COLUMN_NAMES[c]} right`} className="rounded p-1 text-muted hover:bg-panel hover:text-ink disabled:opacity-25"><ArrowRight size={13} /></button>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'extras' && (
          <div className="divide-y divide-line rounded-lg border border-line bg-bg px-3">
            <Pick label="Click quick buy" hint="What happens after a quick buy goes through" value={openAfter ? 'open' : 'stay'} onChange={(v) => updateSettings({ quickBuyOpen: v === 'open' })} options={[{ v: 'stay', label: 'Nothing', demo: <span className="block size-3 rounded-sm border border-muted" /> }, { v: 'open', label: 'Open page', demo: <ArrowRight size={14} /> }]} />
          </div>
        )}

        <div className="mt-3 flex justify-between">
          <button onClick={() => updateSettings({ trenchDisplay: undefined })} className="text-[11px] text-muted underline hover:text-ink">Reset to default</button>
          <button onClick={onClose} className="rounded-md bg-accent px-4 py-1.5 text-[12px] font-extrabold text-accent-ink hover:brightness-110">Done</button>
        </div>
      </div>
    </Modal>
  )
}

function Boxes({ gap }: { gap: number }) {
  return (
    <span className="flex" style={{ gap }}>
      {[0, 1, 2].map((i) => <span key={i} className="block h-5 w-4 border border-line2 bg-raise" />)}
    </span>
  )
}

/** One setting with two (or three) picture options, like Axiom's. */
function Pick<T extends string>({ label, hint, value, onChange, options }: { label: string; hint?: string; value: T; onChange: (v: T) => void; options: { v: T; label: string; demo: ReactNode }[] }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <div className="text-[12px] font-semibold">{label}</div>
        {hint && <div className="text-[10px] text-dim">{hint}</div>}
      </div>
      <div className="flex shrink-0 gap-1.5">
        {options.map((o) => (
          <button key={o.v} onClick={() => onChange(o.v)} aria-pressed={value === o.v} className="w-[76px] text-center">
            <span className={clsx('grid h-10 place-items-center rounded-md border', value === o.v ? 'border-accent bg-accent/5' : 'border-line2 bg-panel hover:border-muted')}>{o.demo}</span>
            <span className={clsx('mt-0.5 block text-[10px]', value === o.v ? 'font-bold text-ink' : 'text-dim')}>{o.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
