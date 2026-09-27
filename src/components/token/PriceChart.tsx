import clsx from 'clsx'
import {
  AreaSeries,
  type AutoscaleInfo,
  CandlestickSeries,
  ColorType,
  createChart,
  createTextWatermark,
  CrosshairMode,
  HistogramSeries,
  LineStyle,
  PriceScaleMode,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts'
import { useEffect, useRef, useState } from 'react'
import { gradMcapUsd } from '../../game/curve'
import { candleStore, SUPPLY } from '../../game/marketEngine'
import { LAUNCHPADS } from '../../data/launchpads'
import { useGame } from '../../game/store'
import type { Candle, ChartStyle, Timeframe } from '../../types'
import { TF_SECONDS } from '../../types'
import { TradeBubbles, type Bubble } from './bubbles'
import { pickFor, useTradePick } from './tradePick'
import { MARKER_KINDS, type MarkerKind, type MarkerKinds } from './markers'
import { fmtCompact, fmtPrice } from '../../utils/format'

const UP = '#19d989'
const DOWN = '#ff4d6a'

export type ScaleMode = 'auto' | 'log' | 'pct'

export interface ChartOptions {
  tokenId: string
  ticker: string
  tf: Timeframe
  style: ChartStyle
  unit: 'mcap' | 'price'
  scale: ScaleMode
  showVolume: boolean
  showMarkers: boolean
  markerKinds: MarkerKinds
  magnet: boolean
  fitSignal: number
  autoSignal?: number // bumped to turn price auto-scale back on after a manual axis zoom
}

interface Legend {
  o: number
  h: number
  l: number
  c: number
  v: number
}

export function PriceChart(o: ChartOptions) {
  const { tokenId, ticker, tf, style, unit, scale, showVolume, showMarkers, markerKinds, magnet, fitSignal, autoSignal } = o
  const el = useRef<HTMLDivElement>(null)
  const chart = useRef<IChartApi | null>(null)
  const main = useRef<ISeriesApi<'Candlestick'> | ISeriesApi<'Area'> | null>(null)
  const vol = useRef<ISeriesApi<'Histogram'> | null>(null)
  const markers = useRef<TradeBubbles | null>(null)
  const pickSeries = useRef<ISeriesApi<'Histogram'> | null>(null)
  const pick = useTradePick((s) => pickFor(s.pick, tokenId))
  const athLine = useRef<IPriceLine | null>(null)
  const entryLine = useRef<IPriceLine | null>(null)
  const migLine = useRef<IPriceLine | null>(null)
  const migLevel = useRef(0) // chart units; kept in the autoscale range so the target is always on screen
  const avgEntry = useGame((s) => s.portfolio.positions[tokenId]?.avgEntry)
  const hovering = useRef(false)
  const lastTime = useRef(0)
  const [legend, setLegend] = useState<Legend | null>(null)
  const tick = useGame((s) => s.market.tick)
  const trades = useGame((s) => s.portfolio.trades)
  const accent = useGame((s) => s.settings.accent)
  const ath = useGame((s) => s.market.tokens.find((t) => t.id === tokenId)?.ath ?? 0)
  const devTrades = useGame((s) => s.market.tokens.find((t) => t.id === tokenId)?.devTrades)
  const creatorIsYou = useGame((s) => s.market.tokens.find((t) => t.id === tokenId)?.creator === 'you')
  const wallets = useGame((s) => s.wallets)
  const tracked = useGame((s) => s.trackedWallets)
  const launch = useGame((s) => s.launches.find((r) => r.tokenId === tokenId))
  const firstWallet = useGame((s) => s.portfolio.accounts?.[0]?.id)

  const k = unit === 'mcap' ? SUPPLY : 1
  const fmt = (v: number) => (unit === 'mcap' ? fmtCompact(v) : fmtPrice(v))
  const toBar = (c: Candle) => ({ time: c.time as UTCTimestamp, open: c.open * k, high: c.high * k, low: c.low * k, close: c.close * k })
  const toVol = (c: Candle) => ({ time: c.time as UTCTimestamp, value: c.volume, color: c.close >= c.open ? 'rgba(25,217,137,0.35)' : 'rgba(255,77,106,0.35)' })
  const lastLegend = (): Legend | null => {
    const d = candleStore.get(tokenId)?.[tf]
    const c = d?.[d.length - 1]
    return c ? { o: c.open * k, h: c.high * k, l: c.low * k, c: c.close * k, v: c.volume } : null
  }

  // (Re)build when token, timeframe, style, unit or theme changes.
  useEffect(() => {
    if (!el.current) return
    const accentColor = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#c6ff3d'
    const c = createChart(el.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#8b93a1', fontFamily: 'JetBrains Mono, monospace', fontSize: 10, attributionLogo: false },
      grid: { vertLines: { color: 'rgba(255,255,255,0.03)' }, horzLines: { color: 'rgba(255,255,255,0.03)' } },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: '#4a5260', labelBackgroundColor: '#262c36' }, horzLine: { color: '#4a5260', labelBackgroundColor: '#262c36' } },
      rightPriceScale: { borderColor: '#1b1f27', scaleMargins: { top: 0.12, bottom: 0.2 } },
      timeScale: { borderColor: '#1b1f27', timeVisible: true, secondsVisible: TF_SECONDS[tf] < 60, rightOffset: 6, barSpacing: TF_SECONDS[tf] < 60 ? 6 : 8 },
      localization: { priceFormatter: (v: number) => (unit === 'mcap' ? fmtCompact(v) : fmtPrice(v).replace('$', '')) },
    })
    const priceFormat = { type: 'custom' as const, formatter: (v: number) => fmt(v), minMove: unit === 'mcap' ? 0.01 : 1e-13 }
    const autoscaleInfoProvider = (original: () => AutoscaleInfo | null): AutoscaleInfo | null => {
      const r = original()
      if (!r?.priceRange || !migLevel.current) return r
      return { ...r, priceRange: { minValue: r.priceRange.minValue, maxValue: Math.max(r.priceRange.maxValue, migLevel.current) } }
    }
    const s =
      style === 'candles'
        ? c.addSeries(CandlestickSeries, { upColor: UP, downColor: DOWN, borderUpColor: UP, borderDownColor: DOWN, wickUpColor: UP, wickDownColor: DOWN, priceFormat, autoscaleInfoProvider })
        : c.addSeries(AreaSeries, { lineColor: accentColor, lineWidth: 2, topColor: `${accentColor}40`, bottomColor: `${accentColor}00`, priceFormat, autoscaleInfoProvider })
    const v = c.addSeries(HistogramSeries, { priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false })
    c.priceScale('vol').applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } })
    createTextWatermark(c.panes()[0], {
      horzAlign: 'center',
      vertAlign: 'center',
      lines: [{ text: 'MOONRUSH', color: 'rgba(255,255,255,0.035)', fontSize: 72, fontStyle: 'bold' }],
    })
    chart.current = c
    main.current = s
    vol.current = v
    const bubbles = new TradeBubbles()
    s.attachPrimitive(bubbles)
    markers.current = bubbles
    athLine.current = null
    entryLine.current = null
    migLine.current = null

    const data = candleStore.get(tokenId)?.[tf] ?? []
    if (style === 'candles') (s as ISeriesApi<'Candlestick'>).setData(data.map(toBar))
    else (s as ISeriesApi<'Area'>).setData(data.map((d) => ({ time: d.time as UTCTimestamp, value: d.close * k })))
    v.setData(data.map(toVol))
    lastTime.current = data[data.length - 1]?.time ?? 0
    c.timeScale().scrollToRealTime()
    setLegend(lastLegend())

    const onMove = (p: MouseEventParams<Time>) => {
      const bar = p.seriesData.get(s) as { open?: number; high?: number; low?: number; close?: number; value?: number } | undefined
      const vb = p.seriesData.get(v) as { value?: number } | undefined
      if (!p.time || !bar) {
        hovering.current = false
        setLegend(lastLegend())
        return
      }
      hovering.current = true
      const close = bar.close ?? bar.value ?? 0
      setLegend({ o: bar.open ?? close, h: bar.high ?? close, l: bar.low ?? close, c: close, v: vb?.value ?? 0 })
    }
    c.subscribeCrosshairMove(onMove)

    // Click a candle (Axiom-style): the Trades panels narrow to that candle's trades. Click it again to clear.
    const hl = c.addSeries(HistogramSeries, { priceScaleId: 'pick', lastValueVisible: false, priceLineVisible: false, color: 'rgba(198,255,61,0.10)' })
    c.priceScale('pick').applyOptions({ scaleMargins: { top: 0, bottom: 0 }, visible: false })
    pickSeries.current = hl
    const onClick = (p: MouseEventParams<Time>) => {
      const { pick, setPick, toggle, open } = useTradePick.getState()
      if (!p.time) return
      const from = Number(p.time)
      if (pick && pick.tokenId === tokenId && pick.from === from) return setPick(null)
      setPick({ tokenId, from, to: from + TF_SECONDS[tf], tf })
      if (!open && window.innerWidth >= 768) toggle(true)
    }
    c.subscribeClick(onClick)

    // Scroll over the right price axis zooms the price scale (like TradingView / GMGN), anchored at the cursor.
    // Captured before the chart sees it, so it doesn't also zoom time. Double-click the axis or Reset to go back to auto.
    const host = el.current
    const onWheel = (e: WheelEvent) => {
      const rect = host.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      const axisW = c.priceScale('right').width()
      const paneH = rect.height - c.timeScale().height()
      if (x < rect.width - axisW || y > paneH || !e.deltaY) return
      e.preventDefault()
      e.stopPropagation()
      const ps = s.priceScale()
      const r = ps.getVisibleRange()
      if (!r || !(r.to > r.from)) return
      const factor = Math.min(1.5, Math.max(0.67, Math.exp(e.deltaY * 0.0015))) // scroll down = zoom out
      const f = Math.min(1, Math.max(0, y / paneH)) // 0 = top of the pane (range max)
      const logMode = c.priceScale('right').options().mode === PriceScaleMode.Logarithmic && r.from > 0
      const fwd = logMode ? Math.log : (n: number) => n
      const back = logMode ? Math.exp : (n: number) => n
      const lo = fwd(r.from)
      const hi = fwd(r.to)
      const anchor = hi - f * (hi - lo)
      ps.setAutoScale(false)
      ps.setVisibleRange({ from: back(anchor - (anchor - lo) * factor), to: back(anchor + (hi - anchor) * factor) })
    }
    host.addEventListener('wheel', onWheel, { capture: true, passive: false })
    return () => {
      host.removeEventListener('wheel', onWheel, { capture: true })
      c.unsubscribeCrosshairMove(onMove)
      c.unsubscribeClick(onClick)
      pickSeries.current = null
      c.remove()
      chart.current = null
      main.current = null
      vol.current = null
      markers.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenId, tf, style, unit, accent])

  // Highlight the picked candle (only if it's on this timeframe's grid).
  useEffect(() => {
    const hl = pickSeries.current
    if (!hl) return
    hl.setData(pick && pick.tf === tf ? [{ time: pick.from as UTCTimestamp, value: 1 }] : [])
  }, [pick, tf, tokenId, style, unit, accent])

  // Scale mode, volume visibility, crosshair magnet.
  useEffect(() => {
    const c = chart.current
    if (!c) return
    c.priceScale('right').applyOptions({ mode: scale === 'log' ? PriceScaleMode.Logarithmic : scale === 'pct' ? PriceScaleMode.Percentage : PriceScaleMode.Normal, autoScale: true })
    vol.current?.applyOptions({ visible: showVolume })
    c.applyOptions({ crosshair: { mode: magnet ? CrosshairMode.Magnet : CrosshairMode.Normal } })
  }, [scale, autoSignal, showVolume, magnet, tokenId, tf, style, unit, accent])

  // Reset zoom on request.
  useEffect(() => {
    if (!fitSignal) return
    chart.current?.timeScale().fitContent()
    main.current?.priceScale().setAutoScale(true)
  }, [fitSignal])

  // All-time-high line.
  useEffect(() => {
    const s = main.current
    if (!s || !ath) return
    const price = unit === 'mcap' ? ath : ath / SUPPLY
    if (athLine.current) athLine.current.applyOptions({ price })
    else athLine.current = s.createPriceLine({ price, color: 'rgba(255,77,106,0.55)', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: 'All Time High' })
  }, [ath, unit, tokenId, tf, style, accent])

  // Migration target: the market cap where the bonding curve completes and the coin moves to its DEX. Shown while
  // the coin is still bonding; it follows the chain coin's price, since the curve is priced in SOL / BNB / ETH.
  const migMcap = useGame((s) => {
    const t = s.market.tokens.find((x) => x.id === tokenId)
    const nu = t ? s.market.native?.[t.chain]?.price ?? 0 : 0
    return t && t.status === 'bonding' && nu ? Math.round(gradMcapUsd(t.pad, nu)) : 0
  })
  const migDex = useGame((s) => {
    const pad = s.market.tokens.find((x) => x.id === tokenId)?.pad
    return (pad && LAUNCHPADS[pad]?.dex) || 'DEX'
  })
  useEffect(() => {
    const s = main.current
    if (!s) return
    if (!migMcap) {
      if (migLine.current) s.removePriceLine(migLine.current)
      migLine.current = null
      migLevel.current = 0
      return
    }
    const price = unit === 'mcap' ? migMcap : migMcap / SUPPLY
    migLevel.current = price
    const opts = {
      price,
      color: '#f5c542',
      lineWidth: 1 as const,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: `Migration ${fmtCompact(migMcap)} → ${migDex}`,
    }
    if (migLine.current) migLine.current.applyOptions(opts)
    else migLine.current = s.createPriceLine(opts)
  }, [migMcap, migDex, unit, tokenId, tf, style, accent])

  // Your average entry (cost basis per token, fees included) while you hold a position. Green while you're above
  // it, red while you're under. Shown with the "My trades" markers.
  const showEntry = showMarkers && markerKinds.me && !!avgEntry
  const inProfit = useGame((s) => {
    const t = s.market.tokens.find((x) => x.id === tokenId)
    return !!t && !!avgEntry && t.price >= avgEntry
  })
  useEffect(() => {
    const s = main.current
    if (!s) return
    if (!showEntry) {
      if (entryLine.current) s.removePriceLine(entryLine.current)
      entryLine.current = null
      return
    }
    const price = unit === 'mcap' ? avgEntry! * SUPPLY : avgEntry!
    const opts = {
      price,
      color: inProfit ? UP : DOWN,
      lineWidth: 1 as const,
      lineStyle: LineStyle.LargeDashed,
      axisLabelVisible: true,
      title: `My avg ${unit === 'mcap' ? fmtCompact(price) : fmtPrice(price)}`,
    }
    if (entryLine.current) entryLine.current.applyOptions(opts)
    else entryLine.current = s.createPriceLine(opts)
  }, [showEntry, avgEntry, inProfit, unit, tokenId, tf, style, accent])

  // Stream every candle touched since the last update (a tick can open several 1s candles).
  useEffect(() => {
    const data = candleStore.get(tokenId)?.[tf]
    if (!data?.length || !main.current || !vol.current) return
    let i = data.length - 1
    while (i > 0 && data[i - 1].time >= lastTime.current) i--
    try {
      for (; i < data.length; i++) {
        const c = data[i]
        if (style === 'candles') (main.current as ISeriesApi<'Candlestick'>).update(toBar(c))
        else (main.current as ISeriesApi<'Area'>).update({ time: c.time as UTCTimestamp, value: c.close * k })
        vol.current.update(toVol(c))
      }
    } catch {
      /* out-of-order update after a reload — the next rebuild fixes it */
    }
    lastTime.current = data[data.length - 1].time
    if (!hovering.current) setLegend(lastLegend())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, trades.length])

  // Trade bubbles: yours (B/S), the dev's (DB/DS) and tracked wallets' (their avatar, ringed green/red). Each sits on
  // its candle at the fill price; several trades of the same kind in one candle merge into one bubble with a count.
  useEffect(() => {
    if (!markers.current) return
    if (!showMarkers) return markers.current.set([])
    const data = candleStore.get(tokenId)?.[tf]
    const first = data?.[0]?.time ?? 0
    const tfs = TF_SECONDS[tf]
    const bucket = (time: number) => Math.floor(time / tfs) * tfs
    const closeAt = new Map((data ?? []).map((c) => [c.time, c.close]))
    const groups = new Map<string, { time: number; side: 'buy' | 'sell'; kind: MarkerKind; label: string; n: number; px: number }>()
    // price: the fill price per token, or undefined to pin the bubble at the candle's close (dev trades carry no price).
    const add = (time: number, side: 'buy' | 'sell', kind: MarkerKind, label: string, price?: number) => {
      if (time < first) return
      const t = bucket(time)
      const px = price ?? closeAt.get(t)
      if (!px) return
      const key = `${t}|${kind}|${label}|${side}`
      const g = groups.get(key)
      if (g) {
        g.px = (g.px * g.n + px) / (g.n + 1)
        g.n++
      } else groups.set(key, { time: t, side, kind, label, n: 1, px })
    }
    const mine = creatorIsYou
    // On a coin you cooked, only the deployer wallet trades as the dev.
    const devIds = mine ? [launch?.devWallet ?? firstWallet] : []
    for (const t of trades) {
      if (t.tokenId !== tokenId) continue
      const isDev = mine && devIds.includes(t.walletId ?? firstWallet ?? '')
      if (isDev ? markerKinds.dev || markerKinds.me : markerKinds.me) add(t.time, t.side, isDev ? 'dev' : 'me', isDev ? 'D' : '', t.price)
    }
    if (markerKinds.dev && !mine) for (const d of devTrades ?? []) add(d.time, d.side, 'dev', 'D')
    if (markerKinds.tracked) {
      for (const w of wallets) {
        if (!tracked.includes(w.id)) continue
        for (const tr of w.trades) if (tr.tokenId === tokenId) add(tr.time, tr.side, 'tracked', w.avatar, tr.price)
      }
    }
    const b: Bubble[] = [...groups.values()]
      .map((g): Bubble => {
        const buy = g.side === 'buy'
        const sideColor = buy ? UP : DOWN
        const base = { time: g.time, price: g.px * k, side: g.side, kind: g.kind, n: g.n }
        if (g.kind === 'tracked') return { ...base, text: g.label, color: '#161a22', ink: '#fff', ring: sideColor }
        if (g.kind === 'dev') return { ...base, text: `D${buy ? 'B' : 'S'}`, color: MARKER_KINDS.find((m) => m.id === 'dev')!.color, ink: '#1a1204', ring: sideColor }
        return { ...base, text: buy ? 'B' : 'S', color: sideColor, ink: buy ? '#06140d' : '#fff' }
      })
      .sort((a, b) => a.time - b.time)
    markers.current.set(b)
  }, [trades, devTrades, wallets, tracked, creatorIsYou, launch, firstWallet, markerKinds, tokenId, tf, style, unit, k, accent, showMarkers])

  const chg = legend && legend.o ? legend.c / legend.o - 1 : 0
  const tone = chg >= 0 ? 'text-up' : 'text-down'
  return (
    <div className="relative h-full w-full">
      <div ref={el} className="absolute inset-0" />
      {legend && (
        <div className="pointer-events-none absolute left-2 top-1.5 z-10 space-y-0.5 text-[11px]">
          <div className="flex flex-wrap items-center gap-x-2 num">
            <span className="rounded bg-raise/80 px-1.5 py-px font-sans font-semibold text-ink">{ticker} · {tf} · MOONRUSH</span>
            <span className="text-dim">O<span className={tone}>{fmt(legend.o)}</span></span>
            <span className="text-dim">H<span className={tone}>{fmt(legend.h)}</span></span>
            <span className="text-dim">L<span className={tone}>{fmt(legend.l)}</span></span>
            <span className="text-dim">C<span className={tone}>{fmt(legend.c)}</span></span>
            <span className={clsx(tone)}>{chg >= 0 ? '+' : ''}{(chg * 100).toFixed(2)}%</span>
          </div>
          {showVolume && (
            <div className="num text-dim">Volume <span className={tone}>{fmtCompact(legend.v, '')}</span></div>
          )}
        </div>
      )}
    </div>
  )
}
