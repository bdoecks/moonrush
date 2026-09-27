import clsx from 'clsx'
import { BookmarkPlus, Check, RotateCcw, SlidersHorizontal, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { CHAIN_IDS, CHAINS } from '../../data/chains'
import { padsFor } from '../../data/launchpads'
import type { Chain, PadId, Win } from '../../types'
import { PadBadge } from '../pad'
import { CHECKS, countActive, EMPTY_FILTER, RANGES, rangeLabel, sameFilter, WINDOWS, type Range, type RangeKey, type Scope, type TrenchFilter } from './trenchFilter'
import { addPreset, removePreset, useFilterPresets } from '../../hooks/useFilterPresets'

const PRESET_ICONS = ['⭐', '🔥', '💎', '🎯', '🚀', '🐸', '🧪', '🛡️']

// ─── Launchpad grid (shared by the Trenches panel and the table's dropdown) ──
export function PadGrid({ selected, onChange, chain, counts }: { selected: PadId[]; onChange: (p: PadId[]) => void; chain: 'all' | Chain; counts?: Partial<Record<PadId, number>> }) {
  const chains = chain === 'all' ? CHAIN_IDS : [chain]
  const toggle = (id: PadId) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id])
  return (
    <div className="space-y-2">
      {chains.map((c) => (
        <div key={c}>
          {chains.length > 1 && <div className="mb-1 text-[9px] font-bold uppercase tracking-wider" style={{ color: CHAINS[c].color }}>{CHAINS[c].glyph} {CHAINS[c].name}</div>}
          <div className="grid grid-cols-3 gap-1">
            {padsFor(c).map((p) => {
              const on = selected.includes(p.id)
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => toggle(p.id)}
                  aria-pressed={on}
                  title={p.blurb}
                  className={clsx('relative flex flex-col items-center gap-1 rounded-md border px-1 py-1.5 text-[10px] font-semibold transition-colors', on ? 'bg-raise text-ink' : 'border-line2 text-muted hover:bg-panel2 hover:text-ink')}
                  style={on ? { borderColor: p.color } : undefined}
                >
                  <PadBadge pad={p.id} size={22} />
                  <span className="max-w-full truncate">{p.name}</span>
                  {counts && <span className="num text-[9px] text-dim">{counts[p.id] ?? 0}</span>}
                  {on && <Check size={10} className="absolute right-1 top-1" style={{ color: p.color }} />}
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Trenches column filter ──────────────────────────────────────────────────
interface PanelProps {
  title: string
  value: TrenchFilter
  onApply: (f: TrenchFilter) => void
  chain: 'all' | Chain
  counts: Partial<Record<PadId, number>>
  scope: Scope // which column (or the table) — decides which metrics are offered
  lockedWindow?: Win // the table's time tab drives the stats window
  className?: string // panel position
  big?: boolean // toolbar-sized button with its label always shown
}

/** Filter button + dropdown panel for one Trenches column. Edits a draft; Apply commits it. */
export function TrenchFilterButton(props: PanelProps) {
  const [open, setOpen] = useState(false)
  const active = countActive(props.value)
  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`${props.title} filters`}
        className={clsx('flex shrink-0 items-center gap-1 rounded border px-1.5 text-[11px] font-semibold transition-colors', props.big ? 'h-7 rounded-md px-2' : 'h-6', active ? 'border-accent/50 bg-accent/10 text-accent' : 'border-line2 text-muted hover:text-ink', open && 'bg-raise')}
      >
        <SlidersHorizontal size={12} />
        <span className={props.big ? undefined : 'hidden lg:inline'}>Filter</span>
        {active > 0 && <span className="num rounded bg-accent px-1 text-[9px] leading-[14px] text-black">{active}</span>}
      </button>
      {open && <Panel {...props} onClose={() => setOpen(false)} />}
    </>
  )
}

const TABS = [
  { id: 'basic' as const, label: 'Basic' },
  { id: 'metrics' as const, label: 'Metrics' },
  { id: 'audit' as const, label: 'Audit & socials' },
]

function Panel({ title, value, onApply, chain, counts, scope, lockedWindow, className, onClose }: PanelProps & { onClose: () => void }) {
  const [d, setD] = useState<TrenchFilter>(value)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    const onDown = (e: MouseEvent) => {
      const el = e.target as Node
      if (ref.current && !ref.current.contains(el) && !(el as HTMLElement).closest?.('[aria-expanded]')) onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown)
    }
  }, [onClose])

  // Range inputs stay as text while typing (so "0." survives) and are parsed on Apply.
  const toText = (ranges: TrenchFilter['ranges']) => Object.fromEntries(Object.entries(ranges).map(([k, r]) => [k, [r?.[0] ?? '', r?.[1] ?? ''].map(String)])) as Partial<Record<RangeKey, [string, string]>>
  const [rs, setRs] = useState<Partial<Record<RangeKey, [string, string]>>>(() => toText(value.ranges))
  const presets = useFilterPresets(chain)
  const [naming, setNaming] = useState<string | null>(null)
  const [icon, setIcon] = useState(PRESET_ICONS[0])
  const loadPreset = (f: TrenchFilter) => {
    setD({ ...f, ranges: {} })
    setRs(toText(f.ranges))
  }
  const setRange = (key: RangeKey, i: 0 | 1, raw: string) => {
    const cur = rs[key] ?? ['', '']
    setRs({ ...rs, [key]: i === 0 ? [raw, cur[1]] : [cur[0], raw] })
  }
  const num = (s: string) => (s.trim() === '' || !Number.isFinite(Number(s)) ? null : Number(s))
  const built = (): TrenchFilter => {
    const ranges: TrenchFilter['ranges'] = {}
    for (const [k, [lo, hi]] of Object.entries(rs) as [RangeKey, [string, string]][]) {
      const r: Range = [num(lo), num(hi)]
      if (r[0] !== null || r[1] !== null) ranges[k] = r
    }
    return { ...d, window: lockedWindow ?? d.window, ranges }
  }
  const win = lockedWindow ?? d.window
  const [tab, setTab] = useState<'basic' | 'metrics' | 'audit'>('basic')
  const tabCount = (id: 'basic' | 'metrics' | 'audit') => {
    const b = built()
    if (id === 'basic') return (b.pads.length ? 1 : 0) + (b.include.trim() ? 1 : 0) + (b.exclude.trim() ? 1 : 0)
    if (id === 'metrics') return Object.keys(b.ranges).length
    return Object.values(b.checks).filter(Boolean).length
  }
  const inputCls = 'num h-7 w-full min-w-0 rounded border border-line2 bg-bg px-1.5 text-[11px] outline-none placeholder:text-dim focus:border-accent/60'

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={`${title} filters`}
      className={clsx('z-30 flex flex-col overflow-hidden rounded-lg border border-line2 bg-panel shadow-[0_18px_48px_-12px_rgba(0,0,0,0.8)]', className ?? 'absolute inset-x-1 top-[38px] max-h-[min(640px,calc(100%-44px))]')}
    >
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <span className="text-[12px] font-bold">{title} · Filters</span>
        <button onClick={onClose} className="text-dim hover:text-ink" aria-label="Close filters"><X size={14} /></button>
      </div>
      <div className="grid grid-cols-3 border-b border-line text-[11px] font-semibold" role="tablist">
        {TABS.map((tb) => {
          const n = tabCount(tb.id)
          return (
            <button key={tb.id} role="tab" aria-selected={tab === tb.id} onClick={() => setTab(tb.id)} className={clsx('flex items-center justify-center gap-1 border-b-2 py-2 transition-colors', tab === tb.id ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink')}>
              {tb.label}
              {n > 0 && <span className="num rounded bg-accent/20 px-1 text-[9px] text-accent">{n}</span>}
            </button>
          )
        })}
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {tab === 'basic' && <>
        <section>
          <div className="mb-1.5 flex items-center justify-between">
            <h3 className="text-[10px] font-bold uppercase tracking-wider text-muted">Presets</h3>
            {naming === null && (
              <button onClick={() => setNaming('')} disabled={!countActive(built())} className="flex items-center gap-1 text-[10px] font-semibold text-accent hover:underline disabled:text-dim disabled:no-underline" title={countActive(built()) ? 'Save these filters as a preset' : 'Set some filters first'}>
                <BookmarkPlus size={11} /> Save as preset
              </button>
            )}
          </div>
          {naming !== null && (
            <form
              className="mb-2 space-y-1.5 rounded-md border border-accent/40 bg-accent/5 p-2"
              onSubmit={(e) => {
                e.preventDefault()
                addPreset(naming, icon, built(), chain)
                setNaming(null)
              }}
            >
              <div className="flex gap-1">
                {PRESET_ICONS.map((ic) => (
                  <button key={ic} type="button" onClick={() => setIcon(ic)} aria-pressed={icon === ic} className={clsx('grid size-6 place-items-center rounded text-[13px]', icon === ic ? 'bg-accent/20 ring-1 ring-accent' : 'hover:bg-raise')}>{ic}</button>
                ))}
              </div>
              <div className="flex gap-1">
                <input autoFocus value={naming} maxLength={24} onChange={(e) => setNaming(e.target.value)} placeholder="Preset name" aria-label="Preset name" className={inputCls} />
                <button type="submit" disabled={!naming.trim()} className="shrink-0 rounded bg-accent px-2 text-[11px] font-bold text-black disabled:opacity-40">Save</button>
                <button type="button" onClick={() => setNaming(null)} className="shrink-0 px-1 text-[11px] text-dim hover:text-ink">Cancel</button>
              </div>
            </form>
          )}
          <div className="flex flex-wrap gap-1">
            {presets.map((p) => {
              const on = sameFilter(built(), p.filter)
              return (
                <span key={p.id} className={clsx('group inline-flex items-center rounded-md border text-[11px] font-semibold transition-colors', on ? 'border-accent/60 bg-accent/10 text-accent' : 'border-line2 text-muted hover:text-ink')}>
                  <button type="button" onClick={() => loadPreset(p.filter)} className="flex items-center gap-1 py-0.5 pl-1.5 pr-1.5" title={p.builtin ? 'Built-in preset' : 'Your preset'}>
                    <span>{p.icon}</span>
                    {p.name}
                  </button>
                  {!p.builtin && (
                    <button type="button" onClick={() => removePreset(p.id)} className="pr-1 text-dim hover:text-down" aria-label={`Delete preset ${p.name}`}>
                      <X size={10} />
                    </button>
                  )}
                </span>
              )
            })}
          </div>
          <p className="mt-1 text-[9px] text-dim">Click a preset to load it, then Apply. Your presets work in every column.</p>
        </section>

        <section>
          <div className="mb-1.5 flex items-center justify-between">
            <h3 className="text-[10px] font-bold uppercase tracking-wider text-muted">Launchpad</h3>
            <div className="flex gap-2 text-[10px]">
              <button onClick={() => setD({ ...d, pads: (chain === 'all' ? CHAIN_IDS : [chain]).flatMap((c) => padsFor(c).map((p) => p.id)) })} className="text-accent hover:underline">All</button>
              <button onClick={() => setD({ ...d, pads: [] })} className="text-dim hover:text-ink">Clear</button>
            </div>
          </div>
          <PadGrid selected={d.pads} onChange={(pads) => setD({ ...d, pads })} chain={chain} counts={counts} />
          <p className="mt-1 text-[9px] text-dim">{d.pads.length ? `${d.pads.length} selected` : 'None selected = every launchpad'}</p>
        </section>

        <section className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="mb-0.5 block text-[10px] text-dim">Search keywords</span>
            <input value={d.include} onChange={(e) => setD({ ...d, include: e.target.value })} placeholder="dog, cat" className={inputCls} />
          </label>
          <label className="block">
            <span className="mb-0.5 block text-[10px] text-dim">Exclude keywords</span>
            <input value={d.exclude} onChange={(e) => setD({ ...d, exclude: e.target.value })} placeholder="scam, rug" className={inputCls} />
          </label>
        </section>

        </>}

        {tab === 'metrics' && (
          <>
            <section>
              <div className="mb-1 flex items-center justify-between">
                <h3 className="text-[10px] font-bold uppercase tracking-wider text-muted">Stats window</h3>
                {lockedWindow && <span className="text-[9px] text-dim">follows the table's time tab</span>}
              </div>
              <div className="grid grid-cols-4 gap-1">
                {WINDOWS.map((w) => (
                  <button
                    key={w}
                    type="button"
                    disabled={!!lockedWindow}
                    onClick={() => setD({ ...d, window: w })}
                    aria-pressed={win === w}
                    className={clsx('num rounded border py-1 text-[11px] font-semibold', win === w ? 'border-accent/60 bg-accent/10 text-accent' : 'border-line2 text-muted hover:text-ink', lockedWindow && win !== w && 'opacity-40')}
                  >
                    {w}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[9px] text-dim">Volume, txns, buys, sells and change use this window.</p>
            </section>
            {(['Market', 'Activity', 'Holders'] as const).map((g) => (
              <section key={g}>
                <h3 className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted">{g}</h3>
                <div className="space-y-1.5">
                  {RANGES.filter((m) => m.group === g && (!m.scopes || m.scopes.includes(scope))).map((m) => {
                    const r = rs[m.key]
                    const label = rangeLabel(m, win)
                    return (
                      <div key={m.key} className="grid grid-cols-[1fr_72px_72px] items-center gap-1.5">
                        <span className={clsx('truncate text-[11px]', r && (r[0] || r[1]) ? 'text-accent' : 'text-muted')}>{label}{m.unit && <span className="text-dim"> ({m.unit})</span>}</span>
                        <input inputMode="decimal" value={r?.[0] ?? ''} onChange={(e) => setRange(m.key, 0, e.target.value)} placeholder="Min" aria-label={`${label} min`} className={inputCls} />
                        <input inputMode="decimal" value={r?.[1] ?? ''} onChange={(e) => setRange(m.key, 1, e.target.value)} placeholder="Max" aria-label={`${label} max`} className={inputCls} />
                      </div>
                    )
                  })}
                </div>
              </section>
            ))}
          </>
        )}

        {tab === 'audit' &&
          (['Socials', 'Audit'] as const).map((g) => (
            <section key={g}>
              <h3 className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted">{g}</h3>
              <div className="grid grid-cols-2 gap-1">
                {CHECKS.filter((c) => c.group === g).map((c) => {
                  const on = !!d.checks[c.key]
                  return (
                    <label key={c.key} className={clsx('flex cursor-pointer items-center gap-2 rounded border px-2 py-1.5 text-[11px] transition-colors', on ? 'border-accent/50 bg-accent/10 text-ink' : 'border-line2 text-muted hover:text-ink')}>
                      <input type="checkbox" checked={on} onChange={(e) => setD({ ...d, checks: { ...d.checks, [c.key]: e.target.checked } })} className="accent-[var(--accent)]" />
                      {c.label}
                    </label>
                  )
                })}
              </div>
            </section>
          ))}
      </div>
      <div className="flex gap-2 border-t border-line p-2">
        <button
          onClick={() => {
            setD(EMPTY_FILTER)
            setRs({})
          }} className="flex h-8 flex-1 items-center justify-center gap-1 rounded-md border border-line2 text-[12px] font-semibold text-muted hover:text-ink">
          <RotateCcw size={12} /> Reset
        </button>
        <button
          onClick={() => {
            onApply(built())
            onClose()
          }}
          className="h-8 flex-[2] rounded-md bg-accent text-[12px] font-extrabold text-black hover:brightness-110"
        >
          Apply{countActive(built()) ? ` (${countActive(built())})` : ''}
        </button>
      </div>
    </div>
  )
}
