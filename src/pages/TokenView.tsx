import { LG, MD, useMediaQuery, useOnceTrue } from '../hooks/useMediaQuery'
import clsx from 'clsx'
import { fakeAddress } from '../utils/address'
import { CHAINS, fmtNative } from '../data/chains'
import { creatorRate, nativePrice, tradeFee } from '../game/tradingEngine'
import { ChainBadge } from '../components/chain'
import { PadBadge, PadTag } from '../components/pad'
import { LAUNCHPADS } from '../data/launchpads'
import { MARKER_KINDS, withMarkerDefaults, type MarkerKinds } from '../components/token/markers'
import { ArrowLeft, BarChart3, CandlestickChart, Copy, Eye, Globe, LineChart, Magnet, Maximize2, Send, Share2, Star, Tags, AtSign, Users } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode, useMemo } from 'react'
import { FlowStats } from '../components/token/FlowStats'
import { InstantTrade } from '../components/token/InstantTrade'
import { PriceChart, type ScaleMode } from '../components/token/PriceChart'
import { RiskPanel } from '../components/token/RiskPanel'
import { TradePanel } from '../components/token/TradePanel'
import { TradesTape } from '../components/token/TradesTape'
import { TradesSide } from '../components/token/TradesSide'
import { useTradePick } from '../components/token/tradePick'
import { EmptyState, FlashNum, RiskBadge, TokenIcon } from '../components/ui'
import { useSelectedToken } from '../hooks/useDerived'
import { SUPPLY } from '../game/marketEngine'
import { useGame } from '../game/store'
import { TIMEFRAMES, type Timeframe, type Token } from '../types'
import { fmtAge, fmtCompact, fmtNum, fmtPrice, fmtTime } from '../utils/format'
import { load, save } from '../utils/storage'


function usePersisted<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => load<T>(key) ?? initial)
  return [v, (next: T) => { setV(next); save(key, next) }]
}

const MIN_PANEL = 140 // px
const MIN_CHART = 160 // px the chart keeps when the panel is dragged all the way up

/** The Trades / Holders panel under the chart, resizable from its top edge on desktop. */
function ActivityPanel({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number | null>(() => load<number>('activityHeight'))
  const [dragging, setDragging] = useState(false)

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = ref.current
    const page = el?.parentElement
    if (!el || !page) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const startY = e.clientY
    const startH = el.getBoundingClientRect().height
    // Everything above the chart (header, toolbars) stays; the panel can take the rest down to MIN_CHART of chart.
    const chart = el.previousElementSibling as HTMLElement | null
    const max = startH + (chart ? chart.getBoundingClientRect().height - MIN_CHART : 0)
    let last = startH
    setDragging(true)
    const move = (ev: PointerEvent) => {
      last = Math.round(Math.min(Math.max(MIN_PANEL, max), Math.max(MIN_PANEL, startH + (startY - ev.clientY))))
      setHeight(last)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setDragging(false)
      save('activityHeight', last)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const reset = () => {
    setHeight(null)
    save('activityHeight', null)
  }

  return (
    <div
      ref={ref}
      className={clsx('relative h-[300px] shrink-0', height === null ? 'lg:h-[clamp(170px,32%,300px)]' : 'lg:h-[var(--panel-h)]', dragging && 'select-none')}
      style={height !== null ? ({ '--panel-h': `${height}px` } as React.CSSProperties) : undefined}
    >
      <div
        onPointerDown={onPointerDown}
        onDoubleClick={reset}
        title="Drag to resize · double-click to reset"
        className="group absolute inset-x-0 -top-1.5 z-10 hidden h-3 cursor-row-resize items-center justify-center lg:flex"
      >
        <span className={clsx('h-1 w-12 rounded-full transition-colors', dragging ? 'bg-accent' : 'bg-line2 group-hover:bg-muted')} />
      </div>
      {children}
    </div>
  )
}

export function TokenView() {
  const t = useSelectedToken()
  const setView = useGame((s) => s.setView)
  const requestTrade = useGame((s) => s.requestTrade)
  const chartStyle = useGame((s) => s.settings.chartStyle)
  const updateSettings = useGame((s) => s.updateSettings)
  const simTime = useGame((s) => s.market.time)
  // Realistic (real-time) markets default to 1s charts like pump.fun / GMGN; each engine remembers its own choice.
  const realistic = useGame((s) => s.market.engine === 'realistic')
  const [tf, setTf] = usePersisted<Timeframe>(realistic ? 'tfRealistic' : 'tf', realistic ? '1s' : '1m')
  const [unit, setUnit] = usePersisted<'mcap' | 'price'>('chartUnit', 'mcap')
  const [scale, setScale] = usePersisted<ScaleMode>('chartScale', 'auto')
  const [showVolume, setShowVolume] = usePersisted('chartVol', true)
  const [showMarkers, setShowMarkers] = usePersisted('chartMarkers', true)
  // The Instant Trade hotkey for chart markers asks for a toggle with this event.
  useEffect(() => {
    const flip = () => setShowMarkers(!showMarkers)
    window.addEventListener('moonrush:toggleMarkers', flip)
    return () => window.removeEventListener('moonrush:toggleMarkers', flip)
  }, [showMarkers, setShowMarkers])
  const [magnet, setMagnet] = usePersisted('chartMagnet', false)
  const [kindsRaw, setKinds] = usePersisted<MarkerKinds>('chartMarkerKinds', withMarkerDefaults({}))
  const kinds = useMemo(() => withMarkerDefaults(kindsRaw), [kindsRaw])
  // Panels for one screen size are mounted when that size is first reached, then kept (see useOnceTrue).
  const md = useMediaQuery(MD)
  const lg = useMediaQuery(LG)
  const showSide = useOnceTrue(md)
  const showTablet = useOnceTrue(md && !lg)
  const showPhone = useOnceTrue(!md)
  const tradesOpen = useTradePick((s) => s.open)
  const [fitSignal, setFitSignal] = useState(0)
  const [autoSignal, setAutoSignal] = useState(0)

  if (!t) {
    return <EmptyState icon="🪦" title="This token was delisted" hint={<button className="text-accent underline" onClick={() => setView('discover')}>Back to discovery</button>} />
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto lg:overflow-hidden">
      <Header t={t} />
      <InstantTrade />

      {/* Chart */}
      <div className="flex h-[380px] shrink-0 flex-col border-b border-line lg:h-auto lg:min-h-0 lg:flex-1 lg:shrink">
        <div className="flex h-8 shrink-0 items-center gap-1 overflow-x-auto border-b border-line px-2 text-[12px] no-scrollbar">
          {TIMEFRAMES.map((x) => (
            <button key={x} onClick={() => setTf(x)} className={clsx('rounded px-1.5 py-0.5 font-semibold transition-colors', tf === x ? 'text-accent' : 'text-muted hover:text-ink')}>
              {x.replace('h', 'H')}
            </button>
          ))}
          <span className="mx-1.5 h-4 w-px bg-line2" />
          <ToolbarIcon active={chartStyle === 'candles'} onClick={() => updateSettings({ chartStyle: 'candles' })} title="Candles"><CandlestickChart size={14} /></ToolbarIcon>
          <ToolbarIcon active={chartStyle === 'line'} onClick={() => updateSettings({ chartStyle: 'line' })} title="Line"><LineChart size={14} /></ToolbarIcon>
          <span className="mx-1.5 h-4 w-px bg-line2" />
          <button onClick={() => setUnit(unit === 'mcap' ? 'price' : 'mcap')} className="shrink-0 font-semibold text-muted hover:text-ink" title="Toggle price / market cap">
            <span className={unit === 'price' ? 'text-ink' : 'text-dim'}>Price</span>
            <span className="text-dim"> / </span>
            <span className={unit === 'mcap' ? 'text-ink' : 'text-dim'}>MC</span>
          </button>
          <span className="ml-3 shrink-0 font-semibold text-ink">USD</span>
          <span className="ml-auto hidden shrink-0 items-center gap-2 text-[11px] text-dim sm:flex">
            1h <span className="num text-up">{fmtNum(t.buys)}</span>/<span className="num text-down">{fmtNum(t.sells)}</span> txns
          </span>
        </div>

        <div className="flex min-h-0 flex-1">
          <div className="hidden w-9 shrink-0 flex-col items-center gap-1 border-r border-line py-2 sm:flex">
            <RailIcon active={magnet} onClick={() => setMagnet(!magnet)} title="Magnet crosshair (snap to candles)"><Magnet size={15} /></RailIcon>
            <RailIcon active={showVolume} onClick={() => setShowVolume(!showVolume)} title="Show volume"><BarChart3 size={15} /></RailIcon>
            <RailIcon active={showMarkers} onClick={() => setShowMarkers(!showMarkers)} title="Show trade markers (me, dev, tracked wallets)"><Tags size={15} /></RailIcon>
            <RailIcon onClick={() => setFitSignal((n) => n + 1)} title="Fit all candles"><Maximize2 size={15} /></RailIcon>
          </div>
          <div className="min-w-0 flex-1 bg-grid">
            <PriceChart tokenId={t.id} ticker={t.ticker} tf={tf} style={chartStyle} unit={unit} scale={scale} showVolume={showVolume} showMarkers={showMarkers} markerKinds={kinds} magnet={magnet} fitSignal={fitSignal} autoSignal={autoSignal} />
          </div>
          {tradesOpen && showSide && <TradesSide token={t} className="hidden w-[300px] shrink-0 md:flex" />}
        </div>

        <div className="flex h-7 shrink-0 items-center gap-3 border-t border-line px-3 text-[11px]">
          <button onClick={() => setFitSignal((n) => n + 1)} className="text-muted hover:text-ink">Fit</button>
          <span className="h-3 w-px bg-line2" />
          <div className="flex min-w-0 items-center gap-1 overflow-x-auto no-scrollbar" role="group" aria-label="Chart markers">
            {MARKER_KINDS.map((k) => {
              const on = showMarkers && kinds[k.id]
              return (
                <button
                  key={k.id}
                  onClick={() => {
                    if (!showMarkers) setShowMarkers(true)
                    setKinds({ ...kinds, [k.id]: showMarkers ? !kinds[k.id] : true })
                  }}
                  className={clsx('flex shrink-0 items-center gap-1 rounded px-1.5 py-px text-[10px] font-semibold transition-opacity', on ? 'bg-raise text-ink' : 'text-dim opacity-60 hover:opacity-100')}
                  aria-pressed={on}
                  title={k.hint}
                >
                  <span className="grid size-3 place-items-center rounded-sm text-[7px] font-extrabold text-black" style={{ background: k.color }}>{k.glyph}</span>
                  {k.label}
                </button>
              )
            })}
          </div>
          <span className="ml-auto num text-muted">{fmtTime(simTime)} SIM</span>
          <span className="h-3 w-px bg-line2" />
          {(['pct', 'log', 'auto'] as ScaleMode[]).map((m) => (
            <button
              key={m}
              onClick={() => {
                setScale(m)
                setAutoSignal((n) => n + 1) // re-clicking also snaps the price axis back to auto-fit after a manual zoom
              }}
              title={m === 'pct' ? 'Percentage scale' : m === 'log' ? 'Log scale' : 'Auto-fit price axis (scroll on the axis to zoom it)'}
              className={clsx('font-semibold', scale === m ? 'text-accent' : 'text-muted hover:text-ink')}
            >
              {m === 'pct' ? '%' : m}
            </button>
          ))}
        </div>
      </div>

      {/* Activity — drag the handle on top to grow it over the chart (GMGN-style); double-click to reset. */}
      <ActivityPanel>
        <TradesTape token={t} />
      </ActivityPanel>

      {/* Tablet: inline flow + trade + audit (desktop uses the sidebar, mobile the bottom sheet) */}
      {showTablet && (
        <div className="hidden shrink-0 border-t border-line md:grid md:grid-cols-2 lg:hidden">
          <div className="border-r border-line">
            <FlowStats />
            <TradePanel className="border-t border-line" />
          </div>
          <RiskPanel />
        </div>
      )}
      {showPhone && (
        <div className="shrink-0 border-t border-line md:hidden">
          <FlowStats />
          <RiskPanel className="border-t border-line" />
        </div>
      )}

      {/* Mobile sticky actions */}
      <div className="sticky bottom-0 z-10 mt-auto grid grid-cols-2 gap-2 border-t border-line bg-panel/95 p-2 backdrop-blur md:hidden">
        <button onClick={() => requestTrade('buy')} className="h-11 rounded-md bg-up text-[14px] font-extrabold text-black">BUY ${t.ticker}</button>
        <button onClick={() => requestTrade('sell')} className="h-11 rounded-md bg-down text-[14px] font-extrabold text-white">SELL</button>
      </div>
    </div>
  )
}

function Header({ t }: { t: Token }) {
  const now = useGame((s) => s.market.time)
  const setView = useGame((s) => s.setView)
  const select = useGame((s) => s.select)
  const rec = useGame((s) => (t.creator === 'you' ? s.launches.find((r) => r.tokenId === t.id) : undefined))
  const nativeUsd = useGame((s) => nativePrice(s.market, t.chain))
  const claim = useGame((s) => s.claimCreatorFees)
  const toggleWatch = useGame((s) => s.toggleWatch)
  const notify = useGame((s) => s.notify)
  const watched = useGame((s) => s.watchlist.includes(t.id))
  const age = now - t.createdAt
  const backView = useGame((s) => s.backView)
  const addr = fakeAddress(t.id, t.chain)
  const watchers = Math.round(t.hype * 0.6 + Math.sqrt(t.holders) * 2)
  const copy = (text: string, what: string) => {
    navigator.clipboard?.writeText(text).catch(() => {})
    notify({ title: 'COPIED', body: `${what}: ${text}`, tone: 'info', icon: '📋' })
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-2 border-b border-line bg-panel px-3 py-2">
      <div className="flex min-w-0 items-center gap-2.5">
        <button onClick={() => setView(backView === 'token' ? 'discover' : backView)} className="rounded p-1 text-muted hover:bg-raise hover:text-ink" aria-label="Back" title="Back (Esc)">
          <ArrowLeft size={16} />
        </button>
        <button onClick={() => toggleWatch(t.id)} className={clsx(watched ? 'text-warn' : 'text-dim hover:text-warn')} title="Watchlist (F)" aria-label="Toggle watchlist">
          <Star size={15} fill={watched ? 'currentColor' : 'none'} />
        </button>
        <div className="relative">
          <TokenIcon token={{ ...t, status: t.status === 'bonding' ? 'graduated' : t.status }} size={40} />
          <span className="absolute -bottom-1 -right-1 rounded-[5px] ring-2 ring-panel">
            <PadBadge pad={t.pad} size={16} />
          </span>
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-display text-[17px] font-bold leading-none">{t.ticker}</span>
            <ChainBadge chain={t.chain} withName />
            <PadTag pad={t.pad} />
            {t.status === 'graduated' && <span className="rounded bg-accent/10 px-1 text-[9px] font-bold text-accent">🎓 {LAUNCHPADS[t.pad]?.dex ?? CHAINS[t.chain].dex}</span>}
            <span className="truncate text-[12px] text-dim">{t.name}</span>
            <button onClick={() => copy(addr, 'Address')} className="text-dim hover:text-ink" title="Copy (fictional) address"><Copy size={12} /></button>
            <button onClick={() => copy(`$${t.ticker} on MOONRUSH — ${fmtCompact(t.mcap)} MC`, 'Shared')} className="text-dim hover:text-ink" title="Copy share text"><Share2 size={12} /></button>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
            <span className={clsx('num font-semibold', age < 3600 ? 'text-up' : 'text-muted')}>{fmtAge(age)}</span>
            <span className="num text-dim">{addr}</span>
            <span className="flex items-center gap-0.5 text-muted" title="Holders"><Users size={11} /><span className="num">{fmtNum(t.holders)}</span></span>
            <span className="flex items-center gap-0.5 text-muted" title="Watching (simulated)"><Eye size={11} /><span className="num">{watchers}</span></span>
            <RiskBadge level={t.riskLevel} score={t.riskScore} />
            {t.creator === 'you' && <span className="rounded bg-warn/15 px-1 text-[9px] font-bold text-warn" title={t.description}>🍳 COOKED BY YOU</span>}
            {t.vampOf && <button onClick={() => select(t.vampOf!.id)} className="rounded bg-accent/15 px-1 text-[9px] font-bold uppercase text-accent hover:bg-accent/25" title="A copycat launch: open the original">🧛 Vamp of ${t.vampOf.ticker}</button>}
            {t.creator !== 'you' && t.creatorName && <span className="rounded bg-info/15 px-1 text-[9px] font-bold uppercase text-info" title={`A player in your room cooked this. ${t.description ?? ''}`}>🍳 Cooked by {t.creatorName}</span>}
            {t.socials && (
              <span className="flex items-center gap-1 text-dim" title="Socials (fictional)">
                {t.socials.x && <AtSign size={11} />}
                {t.socials.tg && <Send size={11} />}
                {t.socials.web && <Globe size={11} />}
              </span>
            )}
            {t.status === 'bonding' && <span className="rounded border border-warn/30 px-1 text-[9px] font-semibold text-warn">CURVE {t.bondingProgress.toFixed(0)}%</span>}
            {t.status === 'rugged' && <span className="rounded bg-down/15 px-1 text-[9px] font-bold text-down">RUGGED</span>}
            {t.status === 'dead' && <span className="rounded bg-line2 px-1 text-[9px] font-bold text-muted">DEAD</span>}
          </div>
        </div>
      </div>

      <FlashNum value={t.mcap} format={fmtCompact} className="text-[24px] font-bold leading-none" />

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
        <HeaderStat label="Price"><FlashNum value={t.price} format={fmtPrice} /></HeaderStat>
        <HeaderStat label="Liq">{fmtCompact(t.liquidity)}</HeaderStat>
        <HeaderStat label="1h Vol">{fmtCompact(t.volume)}</HeaderStat>
        <HeaderStat label="Global fees paid">
          <span title={`All trading fees paid on this coin so far (protocol, creator and LP): ${fmtCompact(t.feesPaid ?? 0)} · last hour ${fmtCompact(t.volume * tradeFee(t, 'buy'))}`}>{fmtNative((t.feesPaid ?? 0) / nativeUsd, t.chain)}</span>
        </HeaderStat>
        <HeaderStat label={`Creator rewards · ${(creatorRate(t) * 100).toFixed(2).replace(/\.?0+$/, '')}%`}>
          <span className="text-up" title="Creator fees this coin has paid its creator so far (the creator's cut of every trade, like pump.fun's creator rewards)">{fmtCompact(t.creatorFees ?? 0)}</span>
          {rec && (
            <span className="ml-1.5 inline-flex items-center gap-1 align-middle">
              <span className="text-[10px] font-normal text-dim">{fmtNative(rec.unclaimed ?? 0, t.chain)} unclaimed</span>
              <button disabled={!((rec.unclaimed ?? 0) > 1e-9)} onClick={() => claim(t.id)} className="rounded bg-up/15 px-1.5 text-[10px] font-bold text-up hover:bg-up/25 disabled:opacity-40">Claim</button>
            </span>
          )}
        </HeaderStat>
        <HeaderStat label="Supply">{fmtNum(SUPPLY)}</HeaderStat>
        <HeaderStat label="ATH MC"><span className="text-warn">{fmtCompact(t.ath)}</span></HeaderStat>
        <HeaderStat label="From ATH"><span className="text-down">{(((t.mcap / t.ath) - 1) * 100).toFixed(1)}%</span></HeaderStat>
      </div>
    </div>
  )
}

function HeaderStat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-[10px] text-dim">{label}</div>
      <div className="num text-[12px] font-semibold text-ink">{children}</div>
    </div>
  )
}

function ToolbarIcon({ active, onClick, title, children }: { active: boolean; onClick: () => void; title: string; children: ReactNode }) {
  return (
    <button onClick={onClick} title={title} aria-label={title} className={clsx('rounded p-1 transition-colors', active ? 'bg-raise text-ink' : 'text-dim hover:text-ink')}>
      {children}
    </button>
  )
}

function RailIcon({ active, onClick, title, children }: { active?: boolean; onClick: () => void; title: string; children: ReactNode }) {
  return (
    <button onClick={onClick} title={title} aria-label={title} aria-pressed={active} className={clsx('grid size-7 place-items-center rounded transition-colors', active ? 'bg-accent/10 text-accent' : 'text-dim hover:bg-raise hover:text-ink')}>
      {children}
    </button>
  )
}
