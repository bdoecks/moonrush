import clsx from 'clsx'
import { ChevronDown, Search, X } from 'lucide-react'
import { QuickSlotPicker } from '../components/chain'
import { useEffect, useMemo, useRef, useState } from 'react'
import { applyFilter, FILTERS, sortValue, type ChangeTf, type FilterId, type SortKey } from '../components/discover/filters'
import { TokenTable } from '../components/discover/TokenTable'
import { Segmented } from '../components/ui'
import { useGame } from '../game/store'
import type { PadId } from '../types'
import { LAUNCHPADS, PAD_IDS } from '../data/launchpads'
import { PadBadge } from '../components/pad'
import { PadGrid, TrenchFilterButton } from '../components/discover/TrenchFilterPanel'
import { countActive, EMPTY_FILTER, matchesFilter, withDefaults, type TrenchFilter } from '../components/discover/trenchFilter'
import type { Chain } from '../types'
import { load, save } from '../utils/storage'


/** GMGN-style launchpad dropdown: selected pad badges on the button, a grid of pads inside. */
function PadDropdown({ pads, onChange, chain, counts }: { pads: PadId[]; onChange: (p: PadId[]) => void; chain: 'all' | Chain; counts: Partial<Record<PadId, number>> }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className={clsx('flex h-7 items-center gap-1.5 rounded-md border px-2 text-[11px] font-semibold', pads.length ? 'border-accent/50 bg-accent/10 text-accent' : 'border-line2 text-muted hover:text-ink')}
      >
        Launchpad
        {pads.length ? (
          <span className="flex items-center -space-x-1">{pads.slice(0, 4).map((p) => <PadBadge key={p} pad={p} size={14} className="ring-1 ring-panel" />)}</span>
        ) : (
          <span className="text-dim">All</span>
        )}
        <ChevronDown size={12} />
      </button>
      {open && (
        <div className="absolute left-0 top-8 z-30 w-[300px] max-w-[calc(100vw-24px)] rounded-lg border border-line2 bg-panel p-3 shadow-[0_18px_48px_-12px_rgba(0,0,0,0.8)]">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted">Launchpad</span>
            <button onClick={() => onChange([])} className="text-[10px] text-dim hover:text-ink">Clear</button>
          </div>
          <PadGrid selected={pads} onChange={onChange} chain={chain} counts={counts} />
          <p className="mt-2 text-[9px] text-dim">{pads.length ? `Showing ${pads.map((p) => LAUNCHPADS[p].name).join(', ')}` : 'None selected = every launchpad'}</p>
        </div>
      )}
    </div>
  )
}

export function DiscoverView() {
  const allTokens = useGame((s) => s.market.tokens)
  const chainFilter = useGame((s) => s.chainFilter)
  // The table's GMGN-style filter (launchpads + metrics + audit). Older saves only stored the launchpads.
  const [tableFilter, setTableFilterState] = useState<TrenchFilter>(() => withDefaults(load<TrenchFilter>('tableFilter') ?? { pads: load<PadId[]>('padFilter') ?? [] }))
  const setTableFilter = (f: TrenchFilter) => {
    setTableFilterState(f)
    save('tableFilter', f)
  }
  const visiblePads = PAD_IDS.filter((p) => chainFilter === 'all' || LAUNCHPADS[p].chain === chainFilter)
  const chainTokens = useMemo(() => (chainFilter === 'all' ? allTokens : allTokens.filter((t) => t.chain === chainFilter)), [allTokens, chainFilter])
  const padCounts = useMemo(() => {
    const c: Partial<Record<PadId, number>> = {}
    for (const t of chainTokens) c[t.pad] = (c[t.pad] ?? 0) + 1
    return c
  }, [chainTokens])
  const now = useGame((s) => s.market.time)
  const watchlist = useGame((s) => s.watchlist)
  const select = useGame((s) => s.select)
  const view = useGame((s) => s.view)

  const [filter, setFilter] = useState<FilterId>(() => load<FilterId>('filter') ?? 'trending')
  const [tf, setTf] = useState<ChangeTf>('5m')
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [cursor, setCursor] = useState(-1)
  const searchRef = useRef<HTMLInputElement>(null)
  // Applied table filter: launchpads outside the chain switcher are ignored, and the time tab sets the stats window.
  const activeFilter: TrenchFilter = { ...tableFilter, window: tf, pads: tableFilter.pads.filter((p) => visiblePads.includes(p)) }
  const filterOn = countActive(activeFilter) > 0
  const tokens = filterOn ? chainTokens.filter((t) => matchesFilter(t, activeFilter, now)) : chainTokens
  const hiddenByFilter = chainTokens.length - tokens.length

  useEffect(() => save('filter', filter), [filter])

  const q = query.trim().toLowerCase().replace(/^\$/, '')

  const rows = useMemo(() => {
    let list = applyFilter(tokens, filter, tf, now, watchlist)
    if (q) list = list.filter((t) => t.ticker.toLowerCase().includes(q) || t.name.toLowerCase().includes(q))
    if (sortKey) {
      const dir = sortDir === 'desc' ? -1 : 1
      list = [...list].sort((a, b) => {
        const va = sortValue(a, sortKey, tf, now)
        const vb = sortValue(b, sortKey, tf, now)
        return (typeof va === 'string' ? va.localeCompare(vb as string) : va - (vb as number)) * dir
      })
    }
    return list
  }, [tokens, filter, tf, now, watchlist, q, sortKey, sortDir])

  const counts = useMemo(() => {
    const c = {} as Record<FilterId, number>
    for (const f of FILTERS) c[f.id] = applyFilter(tokens, f.id, tf, now, watchlist).length
    return c
  }, [tokens, tf, now, watchlist])

  // Arrow keys move the row cursor, Enter opens it.
  const rowsRef = useRef(rows)
  const cursorRef = useRef(cursor)
  useEffect(() => {
    rowsRef.current = rows
    cursorRef.current = cursor
  }, [rows, cursor])
  useEffect(() => {
    if (view !== 'discover') return
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      const typing = el.tagName === 'INPUT' && el !== searchRef.current
      if (typing || useGame.getState().modal) return
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setCursor((c) => Math.max(0, Math.min(rowsRef.current.length - 1, c + (e.key === 'ArrowDown' ? 1 : -1))))
      } else if (e.key === 'Enter') {
        const t = rowsRef.current[cursorRef.current] ?? (el === searchRef.current ? rowsRef.current[0] : undefined)
        if (t) {
          select(t.id)
          searchRef.current?.blur()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [view, select])

  const onSort = (k: SortKey) => {
    if (sortKey === k) {
      if (sortDir === 'desc') setSortDir('asc')
      else setSortKey(null)
    } else {
      setSortKey(k)
      setSortDir(k === 'token' ? 'asc' : 'desc')
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-panel px-2 py-1.5">
        <div className="relative min-w-[160px] flex-1 max-w-[280px]">
          <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-dim" />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setCursor(0)
            }}
            placeholder="Filter this list"
            className="h-7 w-full rounded-md border border-line2 bg-bg pl-7 pr-12 text-[12px] outline-none placeholder:text-dim focus:border-accent/60"
            aria-label="Search tokens"
          />
          {query && (
            <button onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-dim hover:text-ink" aria-label="Clear search"><X size={12} /></button>
          )}
        </div>
        <PadDropdown pads={activeFilter.pads} onChange={(pads) => setTableFilter({ ...tableFilter, pads })} chain={chainFilter} counts={padCounts} />
        <div className="relative">
          <TrenchFilterButton
            title="Discover"
            value={{ ...tableFilter, window: tf }}
            onApply={(f) => setTableFilter(f)}
            chain={chainFilter}
            counts={padCounts}
            scope="table"
            lockedWindow={tf}
            big
            className="absolute left-0 top-9 w-[380px] max-w-[calc(100vw-24px)] max-h-[min(640px,75vh)]"
          />
        </div>
        {filterOn && hiddenByFilter > 0 && (
          <button onClick={() => setTableFilter(EMPTY_FILTER)} className="shrink-0 text-[10px] text-dim hover:text-ink" title="Clear table filters">
            {hiddenByFilter} hidden · <span className="underline">clear</span>
          </button>
        )}
        <Segmented value={tf} onChange={setTf} options={(['1m', '5m', '1h', '24h'] as ChangeTf[]).map((x) => ({ value: x, label: x }))} />
        <div className="ml-auto"><QuickSlotPicker /></div>
      </div>

      <div className="no-scrollbar flex gap-1 overflow-x-auto border-b border-line bg-panel px-2 py-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => {
                setFilter(f.id)
                setSortKey(null)
                setCursor(-1)
              }}
              className={clsx(
                'flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold transition-all',
                filter === f.id ? 'border-accent/50 bg-accent/10 text-accent' : 'border-line2 text-muted hover:border-line2 hover:bg-panel2 hover:text-ink',
              )}
            >
              <span className="text-[11px]">{f.icon}</span>
              {f.label}
              <span className={clsx('num rounded px-1 text-[9px]', filter === f.id ? 'bg-accent/15' : 'bg-raise text-dim')}>{counts[f.id]}</span>
            </button>
          ))}
      </div>

      <div className="min-h-0 flex-1">
        <TokenTable tokens={rows} tf={tf} sortKey={sortKey} sortDir={sortDir} onSort={onSort} cursor={cursor} />
      </div>
    </div>
  )
}
