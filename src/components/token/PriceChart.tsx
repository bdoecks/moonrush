import { tokenMapOf } from '../../hooks/useDerived'
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
import { useAccount } from '../../net/account'
import { bookOf } from '../../game/ledger'
import { load } from '../../utils/storage'
import { useFriends } from '../../net/friends'
import { MARKER_KINDS, type MarkerKind, type MarkerKinds } from './markers'
import { BEAT_ICON, beatTitle, beatWeight, movePct, SRC_META, TONE_COLOR } from './beatMeta'
import { fmtCompact, fmtPrice } from '../../utils/format'
import { traderColor, tradersOn } from '../../game/traderView'
import { focusFor, useTraderFocus } from './traderFocus'

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
  const glide = useRef<{ raf: number; shown: Candle | null }>({ raf: 0, shown: null })
  const animations = useGame((s) => s.settings.animations)
  const pick = useTradePick((s) => pickFor(s.pick, tokenId))
  const athLine = useRef<IPriceLine | null>(null)
  const entryLine = useRef<IPriceLine | null>(null)
  const migLine = useRef<IPriceLine | null>(null)
  const migLevel = useRef(0) // chart units; kept in the autoscale range so the target is always on screen
  const avgEntry = useGame((s) => s.portfolio.positions[tokenId]?.avgEntry)
  const hovering = useRef(false)
  const lastTime = useRef(0)
  const [legend, setLegend] = useState<Legend | null>(null)
  const [tip, setTip] = useState<{ b: Bubble; x: number; y: number } | null>(null) // the marker under the mouse
  const tick = useGame((s) => s.market.tick)
  const trades = useGame((s) => s.portfolio.trades)
  const accent = useGame((s) => s.settings.accent)
  const ath = useGame((s) => tokenMapOf(s.market.tokens).get(tokenId)?.ath ?? 0)
  const devTrades = useGame((s) => tokenMapOf(s.market.tokens).get(tokenId)?.devTrades)
  const beats = useGame((s) => tokenMapOf(s.market.tokens).get(tokenId)?.beats)
  const creatorIsYou = useGame((s) => tokenMapOf(s.market.tokens).get(tokenId)?.creator === 'you')
  const wallets = useGame((s) => s.wallets)
  const tracked = useGame((s) => s.trackedWallets)
  const markerStyle = useGame((s) => s.settings.markerStyle ?? 'avatars')
  const focus = useTraderFocus((s) => focusFor(s.focus, tokenId)) // one trader picked out on the Tracked tab
  // Your face on the chart: your account avatar, else your room avatar.
  const accountFace = useAccount((s) => s.profile?.avatar)
  const myFace = accountFace ?? load<string>('mpAvatar') ?? '🫵'
  const online = useGame((s) => s.online)
  const friendTrades = useFriends((s) => s.trades)
  const friendWatch = useFriends((s) => s.watch)
  const launch = useGame((s) => s.launches.find((r) => r.tokenId === tokenId))
  const firstWallet = useGame((s) => s.portfolio.accounts?.[0]?.id)

  const k = unit === 'mcap' ? SUPPLY : 1
  const fmt = (v: number) => (v < 0 ? '' : unit === 'mcap' ? fmtCompact(v) : fmtPrice(v)) // the axis margin can dip under zero: no labels there
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
      timeScale: { borderColor: '#1b1f27', timeVisible: true, secondsVisible: TF_SECONDS[tf] < 60, rightOffset: 4, barSpacing: 10, minBarSpacing: 2 },
      localization: { priceFormatter: (v: number) => (unit === 'mcap' ? fmtCompact(v) : fmtPrice(v).replace('$', '')) },
    })
    const priceFormat = { type: 'custom' as const, formatter: (v: number) => fmt(v), minMove: unit === 'mcap' ? 0.01 : 1e-13 }
    const autoscaleInfoProvider = (original: () => AutoscaleInfo | null): AutoscaleInfo | null => {
      // Fit the candles (GMGN / Axiom): the Migration line only joins the view once price is over halfway there,
      // so a brand-new coin's candles aren't squashed flat under a line far above them.
      const r = original()
      if (!r?.priceRange || !migLevel.current || r.priceRange.maxValue < migLevel.current * 0.55) return r
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
    glide.current.shown = data.length ? { ...data[data.length - 1] } : null
    // Open zoomed in like GMGN / Axiom: the last ~60-90 candles fill the chart (big, readable candles), newest
    // near the right edge. Brand-new coins with only a few candles don't get stretched into giant bars.
    const width = el.current.clientWidth || 600
    const slots = Math.max(45, Math.min(data.length + 4, 80))
    c.timeScale().applyOptions({ barSpacing: Math.max(6, Math.min(16, (width - 70) / slots)) })
    c.timeScale().scrollToRealTime()
    setLegend(lastLegend())

    const onMove = (p: MouseEventParams<Time>) => {
      // Over a trade marker: show who traded, how much and at what market cap (like Axiom / GMGN).
      const hitB = p.point ? bubbles.hit(p.point.x, p.point.y) : null
      setTip((cur) => (hitB ? { b: hitB, x: p.point!.x, y: p.point!.y } : cur ? null : cur))
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
      ps.setVisibleRange({ from: Math.max(logMode ? 1e-18 : 0, back(anchor - (anchor - lo) * factor)), to: back(anchor + (hi - anchor) * factor) })
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
    const t = tokenMapOf(s.market.tokens).get(tokenId)
    const nu = t ? s.market.native?.[t.chain]?.price ?? 0 : 0
    return t && t.status === 'bonding' && nu ? Math.round(gradMcapUsd(t.pad, nu)) : 0
  })
  const migDex = useGame((s) => {
    const pad = tokenMapOf(s.market.tokens).get(tokenId)?.pad
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

  // Top 10 holders' average buy and sell (Axiom's dotted lines), refreshed every ~10 ticks.
  const top10On = showMarkers && markerKinds.top10 !== false
  const top10Tick = useGame((s) => Math.floor(s.market.tick / 10))
  const top10Lines = useRef<IPriceLine[]>([])
  useEffect(() => {
    const s = main.current
    for (const l of top10Lines.current) s?.removePriceLine(l)
    top10Lines.current = []
    const st = useGame.getState()
    const t = st.market.tokens.find((x) => x.id === tokenId)
    if (!s || !top10On || !t) return
    const book = bookOf(t, st.market.time)
    const top = [...book.holders.values()].filter((h) => h.wallet !== 'YOU').sort((a, b) => b.boughtQty - b.soldQty - (a.boughtQty - a.soldQty)).slice(0, 10)
    const bq = top.reduce((a, h) => a + h.boughtQty, 0)
    const sq = top.reduce((a, h) => a + h.soldQty, 0)
    const avgBuy = bq > 0 ? top.reduce((a, h) => a + h.boughtUsd, 0) / bq : 0
    const avgSell = sq > 0 ? top.reduce((a, h) => a + h.soldUsd, 0) / sq : 0
    const line = (px: number, color: string, title: string) => s.createPriceLine({ price: px * k, color, lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title })
    if (avgBuy > 0) top10Lines.current.push(line(avgBuy, 'rgba(25,217,137,0.8)', 'Top 10 Holders Avg Buy'))
    if (avgSell > 0) top10Lines.current.push(line(avgSell, 'rgba(255,77,106,0.8)', 'Top 10 Holders Avg Sell'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [top10On, top10Tick, tokenId, tf, style, unit, accent])

  // Tracked traders' average entries: a line each, in the trader's own colour, while that wallet still holds the
  // coin (the biggest six; with one trader picked out on the Tracked tab, that one alone, tracked or not).
  const entriesOn = showMarkers && markerKinds.entries !== false
  const entryTick = useGame((s) => Math.floor(s.market.tick / 3))
  const traderLines = useRef<IPriceLine[]>([])
  useEffect(() => {
    const s = main.current
    for (const l of traderLines.current) s?.removePriceLine(l)
    traderLines.current = []
    const st = useGame.getState()
    const t = st.market.tokens.find((x) => x.id === tokenId)
    if (!s || !t || (!entriesOn && !focus)) return
    const rows = tradersOn(t, st.wallets, st.trackedWallets).filter((r) => r.qty > 0 && (focus ? r.id === focus : r.tracked)).slice(0, 6)
    for (const r of rows) traderLines.current.push(s.createPriceLine({ price: r.avgEntry * k, color: r.color, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: `${r.avatar} ${r.name} avg` }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entriesOn, entryTick, focus, tracked, tokenId, tf, style, unit, accent])

  // Your average entry (cost basis per token, fees included) while you hold a position. Green while you're above
  // it, red while you're under. Shown with the "My trades" markers.
  const showEntry = showMarkers && markerKinds.me && !!avgEntry
  const inProfit = useGame((s) => {
    const t = tokenMapOf(s.market.tokens).get(tokenId)
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
    const put = (c: Candle) => {
      if (style === 'candles') (main.current as ISeriesApi<'Candlestick'>).update(toBar(c))
      else (main.current as ISeriesApi<'Area'>).update({ time: c.time as UTCTimestamp, value: c.close * k })
    }
    cancelAnimationFrame(glide.current.raf)
    try {
      // Finished candles land as they are; the newest one glides there (below).
      for (; i < data.length - 1; i++) {
        put(data[i])
        vol.current.update(toVol(data[i]))
      }
      const last = data[data.length - 1]
      vol.current.update(toVol(last))
      const prev = glide.current.shown
      // Axiom / GMGN feel: the live candle moves smoothly to its new price over most of the second instead of
      // jumping once a tick. Its wick stretches as the price travels.
      if (animations && prev && prev.time === last.time && prev.close !== last.close) {
        const from = prev.close
        const start = performance.now()
        const ms = 800
        let drawnY: number | null = null // where on the screen the candle's close was last drawn
        const step = (now: number) => {
          const e = 1 - Math.pow(1 - Math.min(1, (now - start) / ms), 3)
          const close = from + (last.close - from) * e
          // Every update repaints the whole chart, and the glide slows to moves far too small to see: it is only
          // redrawn when the candle would land on a different pixel (the last step always lands on the real price).
          const y = e < 1 ? main.current?.priceToCoordinate(close * k) ?? null : null
          if (e < 1 && y !== null && drawnY !== null && Math.abs(y - drawnY) < 0.5) {
            glide.current.raf = requestAnimationFrame(step)
            return
          }
          const bar = { ...last, close, high: Math.max(prev.high, close, last.open), low: Math.min(prev.low, close, last.open) }
          try {
            put(e >= 1 ? last : bar)
          } catch {
            return
          }
          // Read back after the update: a candle setting a new visible high or low moves the price scale, and the
          // next frame has to be compared in that new scale (or the chart would sit still while it should move).
          drawnY = e < 1 ? main.current?.priceToCoordinate(close * k) ?? null : null
          glide.current.shown = e >= 1 ? { ...last } : bar
          if (e < 1) glide.current.raf = requestAnimationFrame(step)
        }
        glide.current.raf = requestAnimationFrame(step)
      } else {
        put(last)
        glide.current.shown = { ...last }
      }
    } catch {
      /* out-of-order update after a reload — the next rebuild fixes it */
    }
    lastTime.current = data[data.length - 1].time
    if (!hovering.current) {
      const next = lastLegend()
      // Same numbers as before: keep the old object, so a tick with no new candle data doesn't redraw the chart frame.
      setLegend((cur) => (cur && next && cur.o === next.o && cur.h === next.h && cur.l === next.l && cur.c === next.c && cur.v === next.v ? cur : next))
    }
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
    const barAt = new Map((data ?? []).map((c) => [c.time, c]))
    const groups = new Map<string, { time: number; side: 'buy' | 'sell'; kind: MarkerKind; label: string; n: number; px: number; who: string; usd: number; tint?: string }>()
    // price: the fill price per token, or undefined to pin the bubble at the candle's close (dev trades carry no price).
    const add = (time: number, side: 'buy' | 'sell', kind: MarkerKind, label: string, price: number | undefined, who: string, usd: number, tint?: string) => {
      if (time < first) return
      const t = bucket(time)
      const px = price ?? closeAt.get(t)
      if (!px) return
      const key = `${t}|${kind}|${label}|${who}|${side}`
      const g = groups.get(key)
      if (g) {
        g.px = (g.px * g.n + px) / (g.n + 1)
        g.n++
        g.usd += usd
      } else groups.set(key, { time: t, side, kind, label, n: 1, px, who, usd, tint })
    }
    const mine = creatorIsYou
    // On a coin you cooked, only the deployer wallet trades as the dev.
    const devIds = mine ? [launch?.devWallet ?? firstWallet] : []
    for (const t of trades) {
      if (t.tokenId !== tokenId) continue
      const isDev = mine && devIds.includes(t.walletId ?? firstWallet ?? '')
      if (isDev ? markerKinds.dev || markerKinds.me : markerKinds.me) add(t.time, t.side, isDev ? 'dev' : 'me', isDev ? 'D' : '', t.price, isDev ? 'You (dev)' : 'You', t.value)
    }
    if (markerKinds.dev && !mine) for (const d of devTrades ?? []) add(d.time, d.side, 'dev', 'D', undefined, 'Dev', d.usd)
    // (With one trader picked out on the Tracked tab, only that wallet's trades are drawn, tracked or not.)
    if (markerKinds.tracked || focus) {
      for (const w of wallets) {
        if (focus ? w.id !== focus : !tracked.includes(w.id)) continue
        for (const tr of w.trades) if (tr.tokenId === tokenId) add(tr.time, tr.side, 'tracked', w.avatar, tr.price, w.name, tr.usd, traderColor(tracked, w.id))
      }
    }
    // KOLs and smart money trading this coin (Axiom shows them with their avatars).
    if (markerKinds.kol !== false && !focus) {
      for (const w of wallets) {
        if (tracked.includes(w.id) || (w.style !== 'kol' && w.style !== 'smart')) continue
        for (const tr of w.trades) if (tr.tokenId === tokenId) add(tr.time, tr.side, 'kol', w.avatar, tr.price, w.name, tr.usd)
      }
    }
    // Friends in your room: every main-wallet trade is public (their avatar); side wallets only if you track the address.
    if (markerKinds.friends !== false && online) {
      const avatar = new Map(online.players.map((p) => [p.id, p.avatar]))
      for (const tr of friendTrades) {
        if (tr.tokenId !== tokenId) continue
        if (tr.pid) add(tr.time, tr.side, 'friends', avatar.get(tr.pid) ?? '🧑', tr.price, tr.name, tr.usd)
        else if (tr.addr && friendWatch.some((w) => w.key === `a:${tr.addr}`)) add(tr.time, tr.side, 'friends', '🕶', tr.price, tr.name, tr.usd)
      }
    }
    const b: Bubble[] = [...groups.values()]
      .map((g): Bubble => {
        const buy = g.side === 'buy'
        const sideColor = buy ? UP : DOWN
        const bar = barAt.get(g.time)
        const base = { who: g.who, usd: g.usd, mc: g.px * SUPPLY, time: g.time, price: g.px * k, low: (bar ? Math.min(bar.low, g.px) : g.px) * k, high: (bar ? Math.max(bar.high, g.px) : g.px) * k, side: g.side, kind: g.kind, n: g.n }
        if (g.kind === 'kol') return { ...base, text: g.label, color: '#2a1f08', ink: '#fff', ring: sideColor, face: g.label, bg: '#3a2a0c' }
        if (g.kind === 'tracked') return { ...base, text: g.label, color: '#161a22', ink: '#fff', ring: sideColor, face: g.label, bg: '#10263a', tint: g.tint }
        if (g.kind === 'friends') return { ...base, text: g.label, color: '#2a1840', ink: '#fff', ring: sideColor, face: g.label, bg: '#2a1840' }
        if (g.kind === 'dev') return { ...base, text: `D${buy ? 'B' : 'S'}`, color: MARKER_KINDS.find((m) => m.id === 'dev')!.color, ink: '#1a1204', ring: sideColor, face: '🧑‍💻', bg: '#3a2a08' }
        return { ...base, text: buy ? 'B' : 'S', color: sideColor, ink: buy ? '#06140d' : '#fff', face: myFace, bg: '#16301f' }
      })
      .sort((a, b) => a.time - b.time)
    // Story and market beats: a pin over the candle each happened in (hover: what happened, and what the price did
    // next). Trades the chart already marks (a tracked wallet's, the dev's) stay with their own markers.
    const barOn = (time: number) => {
      // (The last candle at or before the moment: a second nobody traded in has no candle of its own.)
      if (!data?.length || data[0].time > time) return undefined
      let lo = 0
      let hi = data.length - 1
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1
        if (data[mid].time <= time) lo = mid
        else hi = mid - 1
      }
      return data[lo]
    }
    const pins = new Map<string, { bar: Candle; kind: MarkerKind; beats: NonNullable<typeof beats> }>()
    for (const n of beats ?? []) {
      const kind: MarkerKind = n.src === 'market' ? 'event' : 'story'
      if (markerKinds[kind] === false || n.kind === 'enter' || n.kind === 'exit' || n.kind === 'dev') continue
      const bar = barOn(bucket(n.time))
      if (!bar) continue
      const g = pins.get(`${bar.time}|${kind}`)
      if (g) g.beats.push(n)
      else pins.set(`${bar.time}|${kind}`, { bar, kind, beats: [n] })
    }
    for (const g of pins.values()) {
      const notes = [...g.beats].sort((x, y) => beatWeight(y) - beatWeight(x))
      const top = notes[0]
      b.push({ time: g.bar.time, price: g.bar.close * k, low: g.bar.low * k, high: g.bar.high * k, side: 'sell', kind: g.kind, text: top.src !== 'market' && top.by && top.kind !== 'drama' ? top.by.avatar : BEAT_ICON[top.kind], n: notes.length, color: '#10141b', ink: '#fff', ring: TONE_COLOR[top.tone], notes })
    }
    b.sort((x, y) => x.time - y.time)
    markers.current.set(b, markerStyle)
  }, [beats, trades, devTrades, wallets, tracked, focus, friendTrades, friendWatch, online, creatorIsYou, launch, firstWallet, markerKinds, tokenId, tf, style, unit, k, accent, showMarkers, markerStyle, myFace])

  const chg = legend && legend.o ? legend.c / legend.o - 1 : 0
  const tone = chg >= 0 ? 'text-up' : 'text-down'
  return (
    <div className="relative h-full w-full">
      <div ref={el} className="absolute inset-0" />
      {tip && <MarkerTip {...tip} width={el.current?.clientWidth ?? 0} />}
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

/** Hover card for a trade marker: who, bought / sold how much, at what market cap (Axiom / GMGN style). */
function MarkerTip({ b, x, y, width }: { b: Bubble; x: number; y: number; width: number }) {
  if (b.notes) return <NoteTip b={b} x={x} y={y} width={width} />
  const flip = width > 380 && x > width - 190 // near the right edge (the newest candles): open to the left
  const buy = b.side === 'buy'
  const face = b.face ?? (b.kind === 'dev' ? '🧑‍💻' : b.text)
  return (
    <div className="pointer-events-none absolute z-20 min-w-[150px] rounded-md border border-line2 bg-panel/95 px-2.5 py-1.5 text-[11px] shadow-xl shadow-black/50 backdrop-blur" style={{ ...(flip ? { right: width - x + 14 } : { left: x + 14 }), top: Math.max(4, y - 30) }}>
      <div className="flex items-center gap-1.5 font-semibold text-ink"><span className="text-[13px] leading-none">{face}</span>{b.who ?? (buy ? 'Buy' : 'Sell')}</div>
      <div className="num mt-0.5">
        <span className={buy ? 'text-up' : 'text-down'}>{buy ? 'Bought' : 'Sold'} {fmtCompact(b.usd ?? 0)}</span>
        {b.n > 1 && <span className="text-dim"> · {b.n} trades</span>}
      </div>
      {b.mc ? <div className="num text-dim">at {fmtCompact(b.mc)} MC{b.n > 1 ? ' (avg)' : ''}</div> : null}
    </div>
  )
}

/**
 * Hover card for a story / event pin: what happened here, where that comes from (a market fact, generated story,
 * outside data), and what the price did in the minute after it.
 */
function NoteTip({ b, x, y, width }: { b: Bubble; x: number; y: number; width: number }) {
  const flip = width > 420 && x > width - 300 // near the right edge (the newest candles): open to the left
  const notes = b.notes ?? []
  return (
    <div className="pointer-events-none absolute z-20 w-[272px] rounded-md border border-line2 bg-panel/95 px-2.5 py-2 text-[11px] shadow-xl shadow-black/50 backdrop-blur" style={{ ...(flip ? { right: width - x + 14 } : { left: Math.min(x + 14, Math.max(4, width - 276)) }), top: Math.max(4, y - 16) }}>
      {notes.slice(0, 3).map((n, i) => (
        <div key={n.id} className={clsx(i > 0 && 'mt-2 border-t border-line/50 pt-2')}>
          <div className="flex items-center gap-1.5">
            <span className="text-[13px] leading-none">{n.src !== 'market' && n.by ? n.by.avatar : BEAT_ICON[n.kind]}</span>
            <span className="truncate font-semibold text-ink">{beatTitle(n)}</span>
            <span className={clsx('ml-auto shrink-0 rounded px-1 text-[9px] font-bold tracking-wide', SRC_META[n.src].cls)}>{SRC_META[n.src].label}</span>
          </div>
          <div className={clsx('mt-1 leading-snug', n.tone === 'down' ? 'text-down' : 'text-muted')}>{n.text}</div>
          <div className="num mt-1 text-dim">at {fmtCompact(n.mcap)} MC{n.why ? ` · ${n.why}` : ''}</div>
          <div className="num mt-0.5">
            <span className="text-dim">Then: </span>
            {n.move === undefined ? <span className="text-dim">the minute after it is still running</span> : <span className={n.move >= 0 ? 'text-up' : 'text-down'}>{movePct(n.move)} in the next minute</span>}
          </div>
        </div>
      ))}
      {notes.length > 3 && <div className="mt-1.5 text-dim">+{notes.length - 3} more in this candle (all of them are on the Story tab)</div>}
    </div>
  )
}
