import clsx from 'clsx'
import { fakeAddress } from '../../utils/address'
import { CHAINS } from '../../data/chains'
import { ChainBadge, ColumnQuickPicker, QuickBuyButton } from '../chain'
import { HideButton } from '../HideButton'
import { useHidden, useVisible } from '../../game/hidden'
import { PadBadge } from '../pad'
import { LAUNCHPADS } from '../../data/launchpads'
import { AtSign, Boxes, Brain, ChefHat, Crosshair, Crown, Eye, Ghost, Globe, GraduationCap, Megaphone, Search, Send, Star, UserRound, Users } from 'lucide-react'
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { OnScreen } from '../OnScreen'
import { useTokenMap } from '../../hooks/useDerived'
import { useGame } from '../../game/store'
import { publicBundlePct } from '../../game/devTools'
import { devPctOf, top10Of } from '../../game/ledger'
import { crowdCode, crowdFromCode, devRecord, devRecordBad, devRecordGood } from '../../game/coinCrowd'
import type { PadId, Token, TrenchColumn } from '../../types'
import { load, save } from '../../utils/storage'
import { countActive, EMPTY_FILTER, matchesFilter, presetFor, withDefaults, type TrenchFilter } from './trenchFilter'
import { useFilterPresets } from '../../hooks/useFilterPresets'
import { TrenchFilterButton } from './TrenchFilterPanel'
import { useTrenchDisplay } from './trenchDisplay'
import { StoryLeaf } from './StoryLeaf'
import { fmtAge, fmtCompact, fmtNum } from '../../utils/format'
import { EmptyState, FlashNum, Pct, Segmented, TokenIcon } from '../ui'

type Col = TrenchColumn
const CARD_HEIGHT = 120 // roughly: the room a card is given before it has ever been drawn (real ones run about 110-155px)
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
  const display = useTrenchDisplay()
  const cols = display.order.map((id) => COLS.find((c) => c.id === id)!)
  return (
    <div className="flex h-full flex-col">
      <div className="md:hidden border-b border-line p-2">
        <Segmented value={mobileCol} onChange={setMobileCol} options={cols.map((c) => ({ value: c.id, label: c.title }))} className="w-full [&>button]:flex-1" />
      </div>
      <div className={clsx('grid min-h-0 flex-1 md:grid-cols-3', display.spaced && 'md:gap-2 md:p-2')}>
        {cols.map((c) => (
          <Column key={c.id} col={c} list={bucket(tokens, c.id, now)} now={now} visible={mobileCol === c.id} />
        ))}
      </div>
    </div>
  )
}

function Column({ col, list: all, now, visible }: { col: (typeof COLS)[number]; list: Token[]; now: number; visible: boolean }) {
  const list = useVisible(all) // coins you hid drop out (unless "Hidden" is on)
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
  // Pause on hover (GMGN / Axiom): while your mouse is over the list, its order freezes so coins don't jump away
  // from under your cursor. Numbers keep updating; new coins wait until you move off.
  const [paused, setPaused] = useState(false)
  const frozen = useRef<string[] | null>(null)
  const tokenMap = useTokenMap()
  const hiddenIds = useHidden((s) => s.ids)
  const showHidden = useHidden((s) => s.show)
  if (paused && !frozen.current) frozen.current = shown.map((t) => t.id)
  if (!paused) frozen.current = null
  const display = frozen.current
    ? frozen.current.map((id) => tokenMap.get(id)).filter((t): t is Token => !!t && (showHidden || !hiddenIds.includes(t.id)))
    : shown
  const waiting = frozen.current ? shown.filter((t) => !frozen.current!.includes(t.id)).length : 0
  const presets = useFilterPresets(chain)
  const activePreset = presetFor(filter, presets)
  const look = useTrenchDisplay()
  // Only the cards on (or near) the screen are drawn: each sits in an OnScreen box that keeps its own height, because
  // cards differ in height. A card slides in when it joins the list, not when it is merely scrolled back into view:
  // `known` is the list as last drawn.
  const known = useRef<Set<string> | null>(null)
  const wasKnown = known.current
  useEffect(() => {
    known.current = new Set(display.map((t) => t.id))
  })
  return (
    <section className={clsx('relative min-h-0 flex-col border-line md:flex', look.spaced ? 'md:overflow-hidden md:rounded-lg md:border' : 'md:border-r last:border-r-0', visible ? 'flex' : 'hidden')}>
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
        <div className={clsx('relative min-w-0 flex-1', !look.search && 'invisible')}>
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
        <ColumnQuickPicker col={col.id} title={col.title} />
      </header>
      {paused && (
        <div className="pointer-events-none absolute left-1/2 top-[42px] z-10 -translate-x-1/2 rounded-full border border-warn/50 bg-panel/95 px-2 py-0.5 text-[10px] font-bold text-warn shadow-lg">
          ⏸ Paused{waiting > 0 ? ` · ${waiting} new` : ''}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
        {display.length ? (
          display.map((t, i) => (
            <OnScreen key={t.id} estimate={CARD_HEIGHT} drawn={i < 12} className={!wasKnown || !wasKnown.has(t.id) ? 'slide-in' : undefined}>
              <Card t={t} now={now} col={col.id} fresh={false} />
            </OnScreen>
          ))
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

export const Card = memo(function Card({ t, now, preview, col, fresh = true }: { t: Token; now: number; preview?: boolean; col?: Col; fresh?: boolean }) {
  const [slide] = useState(fresh) // decided once, when the card is first drawn
  const select = useGame((s) => s.select)
  const toggleWatch = useGame((s) => s.toggleWatch)
  const watched = useGame((s) => s.watchlist.includes(t.id))
  const held = useGame((s) => !!s.portfolio.positions[t.id])
  const hidden = useHidden((s) => s.ids.includes(t.id))
  const d = useTrenchDisplay()
  const show = (id: string) => !d.hide.includes(id)
  const dead = t.status === 'rugged' || t.status === 'dead'
  const age = now - t.createdAt
  const tx = t.buys + t.sells
  const buyShare = tx > 0 ? t.buys / tx : 0.5
  const watchers = useMemo(() => Math.round(t.hype * 0.6 + Math.sqrt(t.holders) * 2), [t.hype, t.holders])
  const bundler = publicBundlePct(t)
  // Tracked KOLs and smart-money wallets holding it now (one number, so the card only redraws when a count changes).
  const crowd = crowdFromCode(useGame((s) => crowdCode(s.wallets, t.id)))
  // The dev's record: coins migrated out of coins launched. Your own coin reads your own launches (as text, for the same reason).
  const mine = useGame((s) => (t.creator === 'you' ? s.launches.map((l) => `${l.tokenId}:${s.market.tokens.find((x) => x.id === l.tokenId)?.status ?? l.status}`).join('|') : ''))
  const dev = useMemo(() => devRecord(t, t.creator === 'you' ? mine.split('|').filter(Boolean).map((x) => ({ tokenId: x.slice(0, x.lastIndexOf(':')), status: x.slice(x.lastIndexOf(':') + 1) })) : undefined), [t.id, t.status, t.creator, mine])
  const round = d.image === 'circle' ? 'rounded-full' : 'rounded-md'
  const big = d.metrics === 'large'
  const mc = d.roundMc ? fmtRounded : fmtCompact
  const audit = [show('top10'), show('dev'), show('devRecord'), show('snipers'), show('insiders'), show('bundlers')].some(Boolean) || show('change')

  return (
    <div
      onClick={preview ? undefined : () => select(t.id)}
      className={clsx('group relative border-b border-line/70 px-2.5 py-2 transition-colors', !preview && 'cursor-pointer hover:bg-panel2', !preview && slide && 'slide-in', (dead || hidden) && 'opacity-50')}
    >
      <div className="flex gap-2.5">
        {/* Avatar + address */}
        <div className="flex w-[56px] shrink-0 flex-col items-center gap-1">
          <div className={clsx('relative', round, d.progress === 'ring' ? clsx('ring-2 ring-offset-2 ring-offset-bg', ringClass(t)) : 'ring-1 ring-line2')}>
            <span className={clsx('block overflow-hidden', round)}><TokenIcon token={{ ...t, status: 'graduated' }} size={52} className="border-0" /></span>
            {show('pad') && (
              <span className="absolute -bottom-1 -right-1 rounded-[5px] ring-2 ring-bg" title={`${LAUNCHPADS[t.pad]?.name} → ${LAUNCHPADS[t.pad]?.dex}`}>
                <PadBadge pad={t.pad} size={17} />
              </span>
            )}
            {!preview && <HideButton id={t.id} ticker={t.ticker} className={clsx('absolute -left-2 -top-2 bg-panel p-0.5 ring-1 ring-line2', !hidden && 'md:opacity-0 md:group-hover:opacity-100')} />}
          </div>
          {d.progress === 'bar' && t.status === 'bonding' && (
            <span className="block h-[3px] w-[52px] overflow-hidden rounded-full bg-line2" title={`Curve ${t.bondingProgress.toFixed(0)}%`}>
              <span className={clsx('block h-full', t.bondingProgress >= 70 ? 'bg-up' : t.bondingProgress >= 30 ? 'bg-warn' : 'bg-down')} style={{ width: `${Math.min(100, t.bondingProgress)}%` }} />
            </span>
          )}
          {show('address') && <span className="num max-w-full truncate text-[9px] text-dim">{fakeAddress(t.id, t.chain)}</span>}
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
            {show('chain') && <ChainBadge chain={t.chain} />}
            {t.status === 'bonding' && <Tag className={clsx('border-warn/30 text-warn', d.curveTag === 'hover' && 'md:hidden md:group-hover:inline')}>Curve {t.bondingProgress.toFixed(0)}%</Tag>}
            {show('tags') && t.status === 'graduated' && <Tag className="border-accent/30 text-accent"><GraduationCap size={10} className="mr-0.5 inline" />{LAUNCHPADS[t.pad]?.dex ?? CHAINS[t.chain].dex}</Tag>}
            {show('tags') && t.tax && <Tag className="border-warn/30 text-warn">Tax {Math.round(t.tax.buy * 100)}/{Math.round(t.tax.sell * 100)}</Tag>}
            {t.status === 'rugged' && <Tag className="border-down/40 text-down">RUGGED</Tag>}
            {t.status === 'dead' && <Tag className="border-line2 text-muted">DEAD</Tag>}
            {show('risk') && (
              <Tag className={t.riskLevel === 'LOW' ? 'border-up/25 text-up' : t.riskLevel === 'MEDIUM' ? 'border-info/25 text-info' : t.riskLevel === 'HIGH' ? 'border-warn/30 text-warn' : 'border-down/30 text-down'}>
                {t.riskLevel === 'EXTREME' ? '☠ ' : ''}{t.riskLevel}
              </Tag>
            )}
            {t.creator === 'you' && <Tag className="border-warn/40 bg-warn/10 text-warn">🍳 YOURS</Tag>}
            {show('tags') && t.vampOf && <Tag className="border-accent/40 bg-accent/10 text-accent">🧛 VAMP</Tag>}
            {t.creator !== 'you' && t.creatorName && <Tag className="border-info/40 bg-info/10 text-info">🍳 {t.creatorName.toUpperCase()}</Tag>}
            {t.bundleFlagged && <Tag className="border-down/40 bg-down/10 text-down">📦 BUNDLED</Tag>}
            {t.washFlagged && <Tag className="border-down/40 bg-down/10 text-down">🤖 WASH</Tag>}
            {held && <Tag className="border-accent/40 bg-accent/10 text-accent">HELD</Tag>}
          </div>
          <div className="mt-1 flex items-center gap-2.5 text-[11px]">
            {show('age') && <span className={clsx('num font-semibold', age < 300 ? 'text-up' : 'text-muted')}>{fmtAge(age)}</span>}
            {show('story') && <StoryLeaf t={t} now={now} />}
            {show('holders') && <span className="flex items-center gap-0.5 text-muted" title="Holders"><Users size={11} /><span className="num">{fmtNum(t.holders)}</span></span>}
            {show('watchers') && <span className="flex items-center gap-0.5 text-muted" title="Watching (simulated)"><Eye size={11} /><span className="num">{watchers}</span></span>}
            {show('kols') && <span className={clsx('flex items-center gap-0.5', crowd.kols ? 'text-warn' : 'text-dim')} title={`KOLs holding this coin: ${crowd.kols}`}><Megaphone size={11} /><span className="num">{crowd.kols}</span></span>}
            {show('smart') && <span className={clsx('flex items-center gap-0.5', crowd.smart ? 'text-info' : 'text-dim')} title={`Smart-money wallets holding this coin: ${crowd.smart}`}><Brain size={11} /><span className="num">{crowd.smart}</span></span>}
            {show('socials') && t.socials && (t.socials.x || t.socials.tg || t.socials.web) && (
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
          <div className={clsx('text-dim', big ? 'text-[12px]' : 'text-[11px]')}>
            {d.volume === 'beside' && show('volume') && <span className="mr-2">V <span className={clsx('num font-semibold text-ink', big ? 'text-[15px]' : 'text-[12px]')}>{mc(t.volume)}</span></span>}
            MC <FlashNum value={t.mcap} format={mc} className={clsx('rounded-sm px-0.5 font-bold', big ? 'text-[17px]' : 'text-[14px]', mcClass(t.mcap))} />
          </div>
          {d.volume === 'beneath' && show('volume') && <div className={clsx('text-dim', big ? 'text-[12px]' : 'text-[11px]')}>V <span className={clsx('num font-semibold text-ink', big ? 'text-[14px]' : 'text-[12px]')}>{mc(t.volume)}</span></div>}
          {show('fees') && <div className="text-[10px] text-dim" title="Fees paid to the pool (1h)">F <span className="num text-muted">{fmtCompact(t.volume * 0.01)}</span></div>}
          {show('tx') && (
            <div className="flex items-center justify-end gap-1 text-[10px] text-dim">
              TX <span className="num text-muted">{fmtNum(tx)}</span>
              <span className="flex h-[3px] w-8 overflow-hidden rounded-full bg-down" title={`${Math.round(buyShare * 100)}% buys`}>
                <span className="bg-up" style={{ width: `${buyShare * 100}%` }} />
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Holder / risk pills */}
      {audit && (
        <div className={clsx('mt-1.5 flex min-h-[18px] flex-wrap items-center gap-1', !preview && 'pr-[84px] md:pr-0')}>
          {show('top10') && <Metric icon={<UserRound size={10} />} label="Top 10 holders" value={`${top10Of(t).toFixed(0)}%`} bad={top10Of(t) > 40} />}
          {show('dev') && <Metric icon={<ChefHat size={10} />} label="Dev holdings" value={`${devPctOf(t).toFixed(1)}%`} bad={devPctOf(t) > 8} />}
          {show('devRecord') && (
            <span title={`Dev's coins: ${dev.migrated} migrated out of ${dev.total} launched${dev.total === 1 ? ' (this is their first)' : ''}`} className={clsx('num inline-flex items-center gap-0.5 rounded border px-1 py-px text-[10px]', devRecordBad(dev) ? 'border-down/30 bg-down/5 text-down' : devRecordGood(dev) ? 'border-warn/40 bg-warn/10 text-warn' : 'border-line2 text-muted')}>
              <Crown size={10} />
              {dev.migrated}/{dev.total}
            </span>
          )}
          {show('snipers') && <Metric icon={<Crosshair size={10} />} label="Snipers" value={String(t.snipers)} bad={t.snipers > 10} />}
          {show('insiders') && <Metric icon={<Ghost size={10} />} label="Insiders" value={`${t.insidersPct.toFixed(0)}%`} bad={t.insidersPct > 15} />}
          {show('bundlers') && <Metric icon={<Boxes size={10} />} label="Bundlers" value={`${bundler.toFixed(0)}%`} bad={bundler > 12} />}
          {show('change') && <span className="ml-auto"><Pct v={t.change['5m']} className="text-[10px]" /></span>}
        </div>
      )}

      {/* Hover quick-buy */}
      {!preview && <QuickBuyButton t={t} col={col} className="absolute right-2 bottom-2 border-0 bg-up px-2.5 text-black shadow-[0_0_16px_-4px_#19d989] hover:brightness-110 md:opacity-0 md:group-hover:opacity-100" />}
    </div>
  )
})

/** Market cap without the decimals ("$77K" instead of "$77.7K"). */
const fmtRounded = (v: number) => fmtCompact(v).replace(/\.\d+(?=[KMBT])/, '')

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
