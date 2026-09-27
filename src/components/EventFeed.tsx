import clsx from 'clsx'
import { Pause, Play, Search, Settings2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { create } from 'zustand'
import { CHAIN_IDS, CHAINS } from '../data/chains'
import { useTokenMap } from '../hooks/useDerived'
import { useGame } from '../game/store'
import { EVENTS_DISABLED } from '../game/flags'
import type { Chain, EventKind, MarketEvent } from '../types'
import { fmtAge, fmtCompact } from '../utils/format'
import { load, save } from '../utils/storage'
import { QuickBuyButton } from './chain'
import { EmptyState, Modal, Pct, TokenIcon, Toggle } from './ui'

// ─── What each event is ──────────────────────────────────────────────────────
type Category = 'pump' | 'danger' | 'launch' | 'social'
const KIND: Record<EventKind, { label: string; cat: Category; color: string }> = {
  trending: { label: 'Trending', cat: 'pump', color: '#19d989' },
  momentum: { label: 'Momentum', cat: 'pump', color: '#19d989' },
  viral: { label: 'Viral', cat: 'pump', color: '#c6ff3d' },
  smartmoney: { label: 'Smart money', cat: 'pump', color: '#4da3ff' },
  whale: { label: 'Whale', cat: 'pump', color: '#4da3ff' },
  marketup: { label: 'Market up', cat: 'pump', color: '#19d989' },
  rug: { label: 'Rug', cat: 'danger', color: '#ff4d6a' },
  devsell: { label: 'Dev sell', cat: 'danger', color: '#ff4d6a' },
  bundle: { label: 'Bundle', cat: 'danger', color: '#ffb020' },
  panic: { label: 'Panic', cat: 'danger', color: '#ff4d6a' },
  liquidity: { label: 'Liquidity', cat: 'danger', color: '#ffb020' },
  wash: { label: 'Wash trading', cat: 'danger', color: '#ffb020' },
  volatility: { label: 'Volatility', cat: 'danger', color: '#ffb020' },
  marketdown: { label: 'Market down', cat: 'danger', color: '#ff4d6a' },
  launch: { label: 'Launch', cat: 'launch', color: '#b36bff' },
  cook: { label: 'Player launch', cat: 'launch', color: '#b36bff' },
  graduation: { label: 'Graduated', cat: 'launch', color: '#c6ff3d' },
  airdrop: { label: 'Airdrop', cat: 'launch', color: '#b36bff' },
  kol: { label: 'KOL', cat: 'social', color: '#4da3ff' },
  meta: { label: 'Meta', cat: 'social', color: '#8b93a1' },
}
const CATS: { id: 'all' | 'mine' | Category; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'mine', label: '⭐ My coins' },
  { id: 'pump', label: '🚀 Pumps' },
  { id: 'danger', label: '⚠️ Danger' },
  { id: 'launch', label: '🌱 Launches' },
  { id: 'social', label: '📣 KOL & meta' },
]
const MIN_MCS = [0, 10_000, 50_000, 250_000, 1_000_000]

// ─── Settings (shared by the dock tab and the sidebar feed, saved per browser) ─
interface EventPrefs {
  cat: 'all' | 'mine' | Category
  chains: Chain[] // empty = every chain
  hidden: EventKind[]
  minMcap: number
  hideDead: boolean
  comfy: boolean // bigger rows with token info
}
const DEFAULTS: EventPrefs = { cat: 'all', chains: [], hidden: [], minMcap: 0, hideDead: true, comfy: true }
const useEventPrefs = create<{ p: EventPrefs; set: (patch: Partial<EventPrefs>) => void }>((set, get) => ({
  p: { ...DEFAULTS, ...(load<Partial<EventPrefs>>('eventPrefs') ?? {}) },
  set: (patch) => {
    const p = { ...get().p, ...patch }
    set({ p })
    save('eventPrefs', p)
  },
}))

/** The market events feed: filter by type, chain and coin; tap one to open the coin. */
export function EventFeed(props: { limit?: number; compact?: boolean; toolbar?: boolean }) {
  if (EVENTS_DISABLED) return <EmptyState icon="🚧" title="Events are turned off for now" hint="The market events feed is being reworked. Rug warnings for coins you hold still pop up." />
  return <EventFeedLive {...props} />
}

function EventFeedLive({ limit = 80, compact, toolbar = true }: { limit?: number; compact?: boolean; toolbar?: boolean }) {
  const events = useGame((s) => s.events)
  const now = useGame((s) => s.market.time)
  const held = useGame((s) => s.portfolio.positions)
  const watch = useGame((s) => s.watchlist)
  const { p, set } = useEventPrefs()
  const map = useTokenMap()
  const [q, setQ] = useState('')
  const [frozen, setFrozen] = useState<MarketEvent[] | null>(null)
  const [settings, setSettings] = useState(false)
  const list = frozen ?? events
  const needle = q.trim().toLowerCase().replace(/^\$/, '')

  const rows = useMemo(() => {
    const mine = (e: MarketEvent) => !!e.tokenId && (!!held[e.tokenId] || watch.includes(e.tokenId) || map.get(e.tokenId)?.creator === 'you')
    return list.filter((e) => {
      const k = KIND[e.kind]
      const t = e.tokenId ? map.get(e.tokenId) : undefined
      if (p.hidden.includes(e.kind)) return false
      if (p.cat === 'mine' ? !mine(e) : p.cat !== 'all' && k?.cat !== p.cat) return false
      if (p.chains.length && t && !p.chains.includes(t.chain)) return false
      if (p.hideDead && e.tokenId && (!t || t.status === 'dead')) return false
      if (p.minMcap && t && t.mcap < p.minMcap) return false
      if (needle && !(e.ticker ?? '').toLowerCase().includes(needle) && !e.text.toLowerCase().includes(needle)) return false
      return true
    })
  }, [list, p, map, held, watch, needle])
  const comfy = p.comfy && !compact

  return (
    <div className="flex h-full min-h-0 flex-col">
      {toolbar && (
        <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-line/60 px-2 py-1">
          {CATS.map((c) => (
            <button key={c.id} onClick={() => set({ cat: c.id })} className={clsx('rounded px-1.5 py-0.5 text-[10px] font-semibold', p.cat === c.id ? 'bg-raise text-ink' : 'text-dim hover:text-muted')}>{c.label}</button>
          ))}
          <span className="mx-0.5 h-3 w-px bg-line2" />
          {CHAIN_IDS.map((c) => {
            const on = p.chains.includes(c)
            return (
              <button key={c} onClick={() => set({ chains: on ? p.chains.filter((x) => x !== c) : [...p.chains, c] })} className={clsx('rounded px-1.5 py-0.5 text-[10px] font-bold', on ? 'bg-raise' : 'text-dim hover:text-muted')} style={on ? { color: CHAINS[c].color } : undefined}>
                {CHAINS[c].short}
              </button>
            )
          })}
          <label className="relative ml-1">
            <Search size={10} className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-dim" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="$TICKER" className="h-5 w-24 rounded border border-line2 bg-bg pl-5 pr-1 text-[10px] outline-none focus:border-accent/60" aria-label="Search events" />
          </label>
          <span className="ml-auto flex items-center gap-1">
            <span className="num text-[9px] text-dim">{rows.length}</span>
            <button onClick={() => setFrozen(frozen ? null : events)} title={frozen ? 'Resume' : 'Pause the feed'} className={clsx('rounded p-0.5', frozen ? 'text-warn' : 'text-muted hover:text-ink')}>{frozen ? <Play size={12} /> : <Pause size={12} />}</button>
            <button onClick={() => setSettings((v) => !v)} aria-expanded={settings} title="Event settings" className={clsx('rounded p-0.5', settings ? 'text-accent' : 'text-muted hover:text-ink')}><Settings2 size={12} /></button>
          </span>
        </div>
      )}
      {toolbar && settings && <EventSettings onClose={() => setSettings(false)} />}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!events.length ? (
          <EmptyState icon="📡" title="Listening for market events…" />
        ) : !rows.length ? (
          <EmptyState icon="🔍" title="No events match your filters" hint={<button onClick={() => { set({ cat: 'all', chains: [], hidden: [], minMcap: 0 }); setQ('') }} className="text-accent underline">Reset filters</button>} />
        ) : (
          <ul>
            {rows.slice(0, limit).map((e) => <EventRow key={e.id} e={e} now={now} comfy={comfy} mine={!!e.tokenId && (!!held[e.tokenId] || watch.includes(e.tokenId))} />)}
          </ul>
        )}
      </div>
    </div>
  )
}

function EventRow({ e, now, comfy, mine }: { e: MarketEvent; now: number; comfy: boolean; mine: boolean }) {
  const select = useGame((s) => s.select)
  const t = useTokenMap().get(e.tokenId ?? '')
  const k = KIND[e.kind] ?? { label: e.kind, color: '#8b93a1' }
  const toneCls = e.tone === 'up' ? 'text-ink' : e.tone === 'down' ? 'text-down' : e.tone === 'warn' ? 'text-warn' : 'text-muted'
  const since = t && e.mcap ? t.mcap / e.mcap - 1 : null
  return (
    <li
      onClick={() => t && select(t.id)}
      className={clsx('slide-in group flex items-start gap-2 border-b border-line/40 border-l-2 px-2', comfy ? 'py-1.5' : 'py-1', t && 'cursor-pointer hover:bg-panel2', mine && 'bg-accent/[0.05]')}
      style={{ borderLeftColor: k.color }}
    >
      {comfy && t ? <TokenIcon token={t} size={26} /> : <span className="mt-px text-[13px] leading-none">{e.icon}</span>}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="rounded px-1 text-[9px] font-bold uppercase tracking-wide" style={{ color: k.color, background: `${k.color}1f` }}>{comfy && t ? `${e.icon} ` : ''}{k.label}</span>
          {e.ticker && <span className="text-[11px] font-bold text-ink">${e.ticker}</span>}
          {t && <span className="text-[9px] font-bold" style={{ color: CHAINS[t.chain].color }}>{CHAINS[t.chain].short}</span>}
          {mine && <span className="text-[9px] text-accent" title="You hold or watch this coin">⭐</span>}
          {comfy && t && (
            <span className="num hidden text-[10px] text-dim sm:inline" title="Market cap when it happened → now">
              {e.mcap ? `${fmtCompact(e.mcap)} → ` : 'MC '}<span className="text-ink">{fmtCompact(t.mcap)}</span>
            </span>
          )}
          {comfy && since !== null && Math.abs(since) > 0.0005 && <Pct v={since} className="text-[10px]" />}
          {t?.status === 'rugged' && <span className="text-[9px] font-bold text-down">RUGGED</span>}
          <span className="num ml-auto shrink-0 text-[9px] text-dim">{fmtAge(Math.max(0, now - e.time))}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className={clsx('min-w-0 flex-1 leading-snug', comfy ? 'text-[12px]' : 'text-[11px]', toneCls)}>{e.text}</div>
          {comfy && t && (
            <span className="shrink-0 opacity-80 group-hover:opacity-100" onClick={(ev) => ev.stopPropagation()}>
              <QuickBuyButton t={t} className="h-5 px-1.5 text-[10px]" />
            </span>
          )}
        </div>
      </div>
    </li>
  )
}

function EventSettings({ onClose }: { onClose: () => void }) {
  const { p, set } = useEventPrefs()
  const popups = useGame((s) => s.settings.eventToasts !== false)
  const updateSettings = useGame((s) => s.updateSettings)
  const kinds = Object.keys(KIND) as EventKind[]
  const toggleKind = (k: EventKind) => set({ hidden: p.hidden.includes(k) ? p.hidden.filter((x) => x !== k) : [...p.hidden, k] })
  return (
    <Modal title="Event settings" onClose={onClose}>
    <div className="space-y-3 text-[12px]">
      <div className="flex items-center">
        <span className="text-[11px] text-dim">Filters and look of the Events feed (saved on this device).</span>
        <button onClick={() => set({ ...DEFAULTS, cat: p.cat })} className="ml-auto text-[11px] text-accent hover:underline">Reset all</button>
      </div>
      <div>
        <div className="mb-1 text-[10px] uppercase tracking-wider text-dim">Show these events</div>
        {(['pump', 'danger', 'launch', 'social'] as Category[]).map((cat) => (
          <div key={cat} className="mb-1 flex flex-wrap items-center gap-1">
            <span className="w-20 text-[11px] text-dim">{CATS.find((c) => c.id === cat)!.label}</span>
            {kinds.filter((k) => KIND[k].cat === cat).map((k) => {
              const on = !p.hidden.includes(k)
              return (
                <button key={k} onClick={() => toggleKind(k)} aria-pressed={on} className={clsx('rounded border px-2 py-0.5 text-[11px] font-semibold', on ? '' : 'border-line2 text-dim line-through opacity-60')} style={on ? { color: KIND[k].color, borderColor: `${KIND[k].color}66`, background: `${KIND[k].color}14` } : undefined}>
                  {KIND[k].label}
                </button>
              )
            })}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <span className="w-20 text-[11px] text-dim">Min MC</span>
        {MIN_MCS.map((v) => (
          <button key={v} onClick={() => set({ minMcap: v })} className={clsx('num rounded px-1.5 py-px text-[10px] font-semibold', p.minMcap === v ? 'bg-raise text-ink' : 'text-dim hover:text-muted')}>{v ? fmtCompact(v) : 'Any'}</button>
        ))}
      </div>
      <div className="grid gap-1 sm:grid-cols-3">
        <label className="flex items-center justify-between gap-2 rounded bg-bg px-2 py-1.5">Hide dead coins <Toggle label="Hide dead coins" on={p.hideDead} onChange={(v) => set({ hideDead: v })} /></label>
        <label className="flex items-center justify-between gap-2 rounded bg-bg px-2 py-1.5">Big rows (coin info) <Toggle label="Big rows" on={p.comfy} onChange={(v) => set({ comfy: v })} /></label>
        <label className="flex items-center justify-between gap-2 rounded bg-bg px-2 py-1.5">Pop-ups <Toggle label="Market event pop-ups" on={popups} onChange={(v) => updateSettings({ eventToasts: v })} /></label>
      </div>
    </div>
    </Modal>
  )
}
