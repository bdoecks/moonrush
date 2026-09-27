import clsx from 'clsx'
import { fakeAddress } from '../../utils/address'
import { CHAINS } from '../../data/chains'
import { ChainBadge, QuickBuyButton, QuickSlotPicker } from '../chain'
import { PadBadge } from '../pad'
import { LAUNCHPADS } from '../../data/launchpads'
import { AtSign, Boxes, ChefHat, Crosshair, Eye, Ghost, Globe, GraduationCap, Search, Send, Star, UserRound, Users } from 'lucide-react'
import { memo, useMemo, useState, type ReactNode } from 'react'
import { useFlash } from '../../hooks/useFlash'
import { useGame } from '../../game/store'
import { publicBundlePct } from '../../game/devTools'
import { devPctOf, top10Of } from '../../game/ledger'
import type { PadId, Token } from '../../types'
import { load, save } from '../../utils/storage'
import { countActive, EMPTY_FILTER, matchesFilter, presetFor, withDefaults, type TrenchFilter } from './trenchFilter'
import { useFilterPresets } from '../../hooks/useFilterPresets'
import { TrenchFilterButton } from './TrenchFilterPanel'
import { fmtAge, fmtCompact, fmtNum } from '../../utils/format'
import { EmptyState, Pct, Segmented, TokenIcon } from '../ui'

type Col = 'new' | 'stretch' | 'grad'
const COLS: { id: Col; title: string }[] = [
  { id: 'new', title: 'New Pairs' },
  { id: 'stretch', title: 'Final Stretch' },
  { id: 'grad', title: 'Graduated' },
]

function bucket(tokens: Token[], col: Col, now: number): Token[] {
  if (col === 'new') return tokens.filter((t) => (t.status === 'bonding' && t.bondingProgress < 40) || (t.status !== 'graduated' && t.status !== 'bonding' && now - t.createdAt < 3600)).sort((a, b) => b.createdAt - a.createdAt)
  if (col === 'stretch') return tokens.filter((t) => t.status === 'bonding' && t.bondingProgress >= 40).sort((a, b) => b.bondingProgress - a.bondingProgress)
  return tokens.filter((t) => t.status === 'graduated').sort((a, b) => (b.graduatedAt ?? b.createdAt) - (a.graduatedAt ?? a.createdAt)).slice(0, 30)
}

export function Trenches({ tokens }: { tokens: Token[] }) {
  const now = useGame((s) => s.market.time)
  const [mobileCol, setMobileCol] = useState<Col>('new')
  return (
    <div className="flex h-full flex-col">
      <div className="md:hidden border-b border-line p-2">
        <Segmented value={mobileCol} onChange={setMobileCol} options={COLS.map((c) => ({ value: c.id, label: c.title }))} className="w-full [&>button]:flex-1" />
      </div>
      <div className="grid min-h-0 flex-1 md:grid-cols-3">
        {COLS.map((c) => (
          <Column key={c.id} col={c} list={bucket(tokens, c.id, now)} now={now} visible={mobileCol === c.id} />
        ))}
      </div>
    </div>
  )
}

function Column({ col, list, now, visible }: { col: (typeof COLS)[number]; list: Token[]; now: number; visible: boolean }) {
  const [q, setQ] = useState('')
  const chain = useGame((s) => s.chainFilter)
  // Each chain view (ALL, SOL, BNB, ETH) keeps its own filters per column.
  const key = `trenchFilter2:${chain}:${col.id}`
  const [saved, setSaved] = useState<Record<string, TrenchFilter>>({})
  const filter = saved[key] ?? withDefaults(load<TrenchFilter>(key))
  const setFilter = (f: TrenchFilter) => {
    setSaved((s) => ({ ...s, [key]: f }))
    save(key, f)
  }
  // Pads from other chains stay saved but don't apply while the chain switcher hides them.
  const f = chain === 'all' ? filter : { ...filter, pads: filter.pads.filter((p) => LAUNCHPADS[p].chain === chain) }
  const counts = useMemo(() => {
    const c: Partial<Record<PadId, number>> = {}
    for (const t of list) c[t.pad] = (c[t.pad] ?? 0) + 1
    return c
  }, [list])
  const needle = q.trim().toLowerCase().replace(/^\$/, '')
  const filtered = countActive(f) ? list.filter((t) => matchesFilter(t, f, now)) : list
  const shown = needle ? filtered.filter((t) => t.ticker.toLowerCase().includes(needle) || t.name.toLowerCase().includes(needle)) : filtered
  const hidden = list.length - filtered.length
  const presets = useFilterPresets(chain)
  const activePreset = presetFor(filter, presets)
  return (
    <section className={clsx('relative min-h-0 flex-col border-line md:flex md:border-r last:border-r-0', visible ? 'flex' : 'hidden')}>
      <header className="flex items-center gap-2 border-b border-line bg-panel px-2 py-1.5">
        <span className="hidden md:inline font-display text-[13px] font-bold">{col.title}</span>
        <span className="hidden md:inline num rounded bg-raise px-1.5 text-[10px] text-muted" title={hidden ? `${hidden} hidden by filters` : undefined}>{countActive(f) ? `${filtered.length}/${list.length}` : list.length}</span>
        {activePreset ? (
          <span className="min-w-0 max-w-[110px] shrink truncate rounded border border-accent/40 bg-accent/10 px-1.5 text-[10px] font-semibold text-accent" title={`Preset: ${activePreset.name}`}>
            {activePreset.icon} {activePreset.name}
          </span>
        ) : f.pads.length > 0 && (
          <span className="flex shrink-0 items-center -space-x-1" title={f.pads.map((p) => LAUNCHPADS[p].name).join(', ')}>
            {f.pads.slice(0, 4).map((p) => <PadBadge key={p} pad={p} size={15} className="ring-1 ring-panel" />)}
            {f.pads.length > 4 && <span className="num pl-1.5 text-[9px] text-dim">+{f.pads.length - 4}</span>}
          </span>
        )}
        <div className="relative min-w-0 flex-1">
          <Search size={11} className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-dim" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Keyword"
            aria-label={`Filter ${col.title}`}
            className="h-6 w-full rounded border border-line2 bg-bg pl-5 pr-1 text-[11px] outline-none placeholder:text-dim focus:border-accent/60"
          />
        </div>
        <TrenchFilterButton title={col.title} value={filter} onApply={setFilter} chain={chain} counts={counts} scope={col.id} />
        <QuickSlotPicker />
      </header>
      <div className="min-h-0 flex-1 overflow-auto">
        {shown.length ? (
          shown.map((t) => <Card key={t.id} t={t} now={now} />)
        ) : (
          <EmptyState
            icon="🕳️"
            title={needle || hidden ? 'No matches' : 'Nothing here yet'}
            hint={hidden ? <button className="text-accent underline" onClick={() => setFilter(EMPTY_FILTER)}>Reset filters ({hidden} hidden)</button> : needle ? undefined : 'New launches appear every ~30s'}
          />
        )}
      </div>
    </section>
  )
}


// Ring colour tracks bonding progress (red → amber → green), graduated tokens get the accent.
function ringClass(t: Token) {
  if (t.status === 'rugged' || t.status === 'dead') return 'ring-line2'
  if (t.status === 'graduated') return 'ring-accent/80'
  return t.bondingProgress >= 70 ? 'ring-up' : t.bondingProgress >= 30 ? 'ring-warn' : 'ring-down/80'
}

// MC colour steps up with size so big caps pop out of the feed.
const mcClass = (mc: number) => (mc >= 1e6 ? 'text-warn' : mc >= 1e5 ? 'text-info' : mc >= 3e4 ? 'text-up' : 'text-ink')

export const Card = memo(function Card({ t, now, preview }: { t: Token; now: number; preview?: boolean }) {
  const select = useGame((s) => s.select)
  const toggleWatch = useGame((s) => s.toggleWatch)
  const watched = useGame((s) => s.watchlist.includes(t.id))
  const held = useGame((s) => !!s.portfolio.positions[t.id])
  const [dir, key] = useFlash(t.mcap)
  const dead = t.status === 'rugged' || t.status === 'dead'
  const age = now - t.createdAt
  const tx = t.buys + t.sells
  const buyShare = tx > 0 ? t.buys / tx : 0.5
  const watchers = useMemo(() => Math.round(t.hype * 0.6 + Math.sqrt(t.holders) * 2), [t.hype, t.holders])
  const bundler = publicBundlePct(t)

  return (
    <div
      onClick={preview ? undefined : () => select(t.id)}
      className={clsx('group relative border-b border-line/70 px-2.5 py-2 transition-colors', !preview && 'cursor-pointer hover:bg-panel2 slide-in', dead && 'opacity-50')}
    >
      <div className="flex gap-2.5">
        {/* Avatar + address */}
        <div className="flex w-[56px] shrink-0 flex-col items-center gap-1">
          <div className={clsx('relative rounded-md ring-2 ring-offset-2 ring-offset-bg', ringClass(t))}>
            <TokenIcon token={{ ...t, status: 'graduated' }} size={52} className="rounded-md border-0" />
            <span className="absolute -bottom-1 -right-1 rounded-[5px] ring-2 ring-bg" title={`${LAUNCHPADS[t.pad]?.name} → ${LAUNCHPADS[t.pad]?.dex}`}>
              <PadBadge pad={t.pad} size={17} />
            </span>
          </div>
          <span className="num max-w-full truncate text-[9px] text-dim">{fakeAddress(t.id, t.chain)}</span>
        </div>

        {/* Identity + social */}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1">
            <span className="shrink-0 text-[13px] font-bold text-ink">{t.ticker}</span>
            <span className="min-w-0 truncate text-[11px] text-dim">{t.name}</span>
            <button
              onClick={(e) => {
                e.stopPropagation()
                toggleWatch(t.id)
              }}
              className={clsx('shrink-0', watched ? 'text-warn' : 'text-dim opacity-0 group-hover:opacity-100 hover:text-warn')}
              aria-label={watched ? 'Remove from watchlist' : 'Add to watchlist'}
            >
              <Star size={11} fill={watched ? 'currentColor' : 'none'} />
            </button>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1">
            <ChainBadge chain={t.chain} />
            {t.status === 'bonding' && <Tag className="border-warn/30 text-warn">Curve {t.bondingProgress.toFixed(0)}%</Tag>}
            {t.status === 'graduated' && <Tag className="border-accent/30 text-accent"><GraduationCap size={10} className="mr-0.5 inline" />{LAUNCHPADS[t.pad]?.dex ?? CHAINS[t.chain].dex}</Tag>}
            {t.tax && <Tag className="border-warn/30 text-warn">Tax {Math.round(t.tax.buy * 100)}/{Math.round(t.tax.sell * 100)}</Tag>}
            {t.status === 'rugged' && <Tag className="border-down/40 text-down">RUGGED</Tag>}
            {t.status === 'dead' && <Tag className="border-line2 text-muted">DEAD</Tag>}
            <Tag className={t.riskLevel === 'LOW' ? 'border-up/25 text-up' : t.riskLevel === 'MEDIUM' ? 'border-info/25 text-info' : t.riskLevel === 'HIGH' ? 'border-warn/30 text-warn' : 'border-down/30 text-down'}>
              {t.riskLevel === 'EXTREME' ? '☠ ' : ''}{t.riskLevel}
            </Tag>
            {t.creator === 'you' && <Tag className="border-warn/40 bg-warn/10 text-warn">🍳 YOURS</Tag>}
            {t.vampOf && <Tag className="border-accent/40 bg-accent/10 text-accent">🧛 VAMP</Tag>}
            {t.creator !== 'you' && t.creatorName && <Tag className="border-info/40 bg-info/10 text-info">🍳 {t.creatorName.toUpperCase()}</Tag>}
            {t.bundleFlagged && <Tag className="border-down/40 bg-down/10 text-down">📦 BUNDLED</Tag>}
            {t.washFlagged && <Tag className="border-down/40 bg-down/10 text-down">🤖 WASH</Tag>}
            {held && <Tag className="border-accent/40 bg-accent/10 text-accent">HELD</Tag>}
          </div>
          <div className="mt-1 flex items-center gap-2.5 text-[11px]">
            <span className={clsx('num font-semibold', age < 300 ? 'text-up' : 'text-muted')}>{fmtAge(age)}</span>
            <span className="flex items-center gap-0.5 text-muted" title="Holders"><Users size={11} /><span className="num">{fmtNum(t.holders)}</span></span>
            <span className="flex items-center gap-0.5 text-muted" title="Watching (simulated)"><Eye size={11} /><span className="num">{watchers}</span></span>
            {t.socials && (t.socials.x || t.socials.tg || t.socials.web) && (
              <span className="flex items-center gap-1 text-dim" title="Socials (fictional)">
                {t.socials.x && <AtSign size={10} />}
                {t.socials.tg && <Send size={10} />}
                {t.socials.web && <Globe size={10} />}
              </span>
            )}
            {t.hype > 75 && <span title="Social activity is spiking">🔥</span>}
          </div>
        </div>

        {/* Market stats */}
        <div className="shrink-0 text-right leading-[1.35]">
          <div className="text-[11px] text-dim">
            MC <span key={key} className={clsx('num rounded-sm px-0.5 text-[14px] font-bold', mcClass(t.mcap), dir && `tflash-${dir}`)}>{fmtCompact(t.mcap)}</span>
          </div>
          <div className="text-[11px] text-dim">V <span className="num text-[12px] font-semibold text-ink">{fmtCompact(t.volume)}</span></div>
          <div className="text-[10px] text-dim" title="Fees paid to the pool (1h)">F <span className="num text-muted">{fmtCompact(t.volume * 0.01)}</span></div>
          <div className="flex items-center justify-end gap-1 text-[10px] text-dim">
            TX <span className="num text-muted">{fmtNum(tx)}</span>
            <span className="flex h-[3px] w-8 overflow-hidden rounded-full bg-down" title={`${Math.round(buyShare * 100)}% buys`}>
              <span className="bg-up" style={{ width: `${buyShare * 100}%` }} />
            </span>
          </div>
        </div>
      </div>

      {/* Holder / risk pills */}
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        <Metric icon={<UserRound size={10} />} label="Top 10 holders" value={`${top10Of(t).toFixed(0)}%`} bad={top10Of(t) > 40} />
        <Metric icon={<ChefHat size={10} />} label="Dev holdings" value={`${devPctOf(t).toFixed(1)}%`} bad={devPctOf(t) > 8} />
        <Metric icon={<Crosshair size={10} />} label="Snipers" value={String(t.snipers)} bad={t.snipers > 10} />
        <Metric icon={<Ghost size={10} />} label="Insiders" value={`${t.insidersPct.toFixed(0)}%`} bad={t.insidersPct > 15} />
        <Metric icon={<Boxes size={10} />} label="Bundlers" value={`${bundler.toFixed(0)}%`} bad={bundler > 12} />
        <span className="ml-auto"><Pct v={t.change['5m']} className="text-[10px]" /></span>
      </div>

      {/* Hover quick-buy */}
      {!preview && <QuickBuyButton t={t} className="absolute right-2 bottom-2 border-0 bg-up px-2.5 text-black shadow-[0_0_16px_-4px_#19d989] hover:brightness-110 md:opacity-0 md:group-hover:opacity-100" />}
    </div>
  )
})

function Tag({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={clsx('rounded border px-1 text-[9px] font-semibold leading-[14px]', className)}>{children}</span>
}

function Metric({ icon, label, value, bad }: { icon: ReactNode; label: string; value: string; bad: boolean }) {
  return (
    <span title={label} className={clsx('num inline-flex items-center gap-0.5 rounded border px-1 py-px text-[10px]', bad ? 'border-down/30 bg-down/5 text-down' : 'border-up/20 bg-up/5 text-up')}>
      {icon}
      {value}
    </span>
  )
}
