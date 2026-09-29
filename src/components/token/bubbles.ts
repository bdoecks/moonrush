// Trade markers on the chart, drawn as a series primitive (lightweight-charts' own markers can't hold text or
// pictures inside a shape). Two looks:
//  - 'tags' (GMGN / Axiom): a small labelled tag under the candle for a buy (pointer up) and over it for a sell
//    (pointer down), so the candles stay visible. Dev = amber DB/DS; tracked wallets and friends = their avatar.
//  - 'bubbles': a round badge sitting on the candle at the exact fill price.
import type { IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesPrimitive, SeriesAttachedParameter, Time } from 'lightweight-charts'
import type { MarkerKind } from './markers'

export type MarkerStyle = 'tags' | 'bubbles'

export interface Bubble {
  time: number // bar time (already bucketed to the timeframe)
  price: number // fill price, in chart units (price or market cap)
  low: number // the candle's low / high, in chart units (tags sit just outside the candle)
  high: number
  side: 'buy' | 'sell'
  kind: MarkerKind
  text: string // 'B', 'S', 'DB', 'DS', or a wallet's avatar
  n: number // trades merged into this marker
  color: string // fill
  ink: string // text colour
  ring?: string // outline for avatar markers (their side colour)
}

type Target = Parameters<IPrimitivePaneRenderer['draw']>[0]
type Ctx = CanvasRenderingContext2D

const R = 9 // bubble radius in CSS pixels
const FONT = '700 10px "JetBrains Mono", monospace'
const TAG_H = 16
const GAP = 5 // space between the candle and its tag
const UP = '#19d989'
const DOWN = '#ff4d6a'

export class TradeBubbles implements ISeriesPrimitive<Time> {
  private bubbles: Bubble[] = []
  private style: MarkerStyle = 'tags'
  private p: SeriesAttachedParameter<Time> | null = null
  private readonly view: IPrimitivePaneView
  private readonly views: readonly IPrimitivePaneView[]

  constructor() {
    const renderer: IPrimitivePaneRenderer = { draw: (t) => this.draw(t) }
    this.view = { zOrder: () => 'top', renderer: () => renderer }
    this.views = [this.view]
  }

  attached(p: SeriesAttachedParameter<Time>) {
    this.p = p
  }
  detached() {
    this.p = null
  }
  paneViews() {
    return this.views
  }

  set(bubbles: Bubble[], style: MarkerStyle = this.style) {
    this.bubbles = bubbles
    this.style = style
    this.p?.requestUpdate()
  }

  private draw(target: Target) {
    const p = this.p
    if (!p || !this.bubbles.length) return
    const ts = p.chart.timeScale()
    target.useMediaCoordinateSpace(({ context: ctx }) => {
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      // Several markers on one bar and side stack away from the candle so none hide another.
      const stack = new Map<string, number>()
      for (const b of this.bubbles) {
        const x = ts.timeToCoordinate(b.time as Time)
        if (x === null) continue
        const key = `${b.time}|${b.side}`
        const i = stack.get(key) ?? 0
        stack.set(key, i + 1)
        if (this.style === 'bubbles') {
          const y0 = p.series.priceToCoordinate(b.price)
          if (y0 !== null) drawBubble(ctx, b, x, y0 + (b.side === 'buy' ? 1 : -1) * i * (R * 2 + 2))
        } else {
          const edge = p.series.priceToCoordinate(b.side === 'buy' ? b.low : b.high)
          if (edge !== null) drawTag(ctx, b, x, edge, i)
        }
      }
    })
  }
}

/** GMGN / Axiom tag: under the candle for buys, over it for sells, with a small pointer at the candle. */
function drawTag(ctx: Ctx, b: Bubble, x: number, edge: number, i: number) {
  const buy = b.side === 'buy'
  const dir = buy ? 1 : -1 // buys go down (below the low), sells up (above the high)
  const avatar = b.kind === 'tracked' || b.kind === 'friends'
  ctx.font = avatar ? '12px system-ui, sans-serif' : FONT
  const w = avatar ? TAG_H + 2 : Math.max(TAG_H, ctx.measureText(b.text).width + 8)
  const top = buy ? edge + GAP + 4 + i * (TAG_H + 3) : edge - GAP - 4 - TAG_H - i * (TAG_H + 3)
  const side = buy ? UP : DOWN
  const fill = avatar ? '#141820' : b.color

  // Pointer toward the candle (only on the first tag of the stack).
  if (i === 0) {
    const tip = edge + dir * GAP
    const base = buy ? top : top + TAG_H
    ctx.beginPath()
    ctx.moveTo(x, tip)
    ctx.lineTo(x - 4, base)
    ctx.lineTo(x + 4, base)
    ctx.closePath()
    ctx.fillStyle = avatar ? side : b.color
    ctx.fill()
  }

  // The tag.
  ctx.beginPath()
  ctx.roundRect(x - w / 2, top, w, TAG_H, avatar ? TAG_H / 2 : 4)
  ctx.fillStyle = fill
  ctx.fill()
  ctx.lineWidth = avatar ? 1.5 : 1
  ctx.strokeStyle = avatar ? side : 'rgba(7,8,10,0.7)'
  ctx.stroke()
  ctx.fillStyle = avatar ? '#fff' : b.ink
  ctx.fillText(b.text, x, top + TAG_H / 2 + 0.5)

  // Avatars get a tiny B / S so you can tell a buy from a sell at a glance.
  if (avatar) {
    const bx = x + w / 2 - 1
    const by = top + (buy ? 1 : TAG_H - 1)
    ctx.beginPath()
    ctx.arc(bx, by, 4.5, 0, Math.PI * 2)
    ctx.fillStyle = side
    ctx.fill()
    ctx.font = '800 6px "JetBrains Mono", monospace'
    ctx.fillStyle = buy ? '#06140d' : '#fff'
    ctx.fillText(buy ? 'B' : 'S', bx, by + 0.5)
  }

  if (b.n > 1) countBadge(ctx, b.n, x - w / 2 + 1, top + (buy ? TAG_H - 1 : 1), avatar ? side : b.color)
  ctx.font = FONT
}

/** Classic: a round badge on the candle at the fill price. */
function drawBubble(ctx: Ctx, b: Bubble, x: number, y: number) {
  ctx.font = FONT
  const w = Math.max(R * 2, ctx.measureText(b.text).width + 8)
  ctx.beginPath()
  ctx.roundRect(x - w / 2, y - R, w, R * 2, R)
  ctx.fillStyle = b.color
  ctx.fill()
  ctx.lineWidth = b.ring ? 1.5 : 1
  ctx.strokeStyle = b.ring ?? 'rgba(7,8,10,0.85)'
  ctx.stroke()
  ctx.fillStyle = b.ink
  ctx.fillText(b.text, x, y + 0.5)
  if (b.n > 1) countBadge(ctx, b.n, x + w / 2 - 1, y - R + 1, b.ring ?? b.color)
}

/** Merged trades: a small count on the marker's corner. */
function countBadge(ctx: Ctx, n: number, bx: number, by: number, ring: string) {
  const label = n > 9 ? '9+' : String(n)
  ctx.beginPath()
  ctx.arc(bx, by, 5.5, 0, Math.PI * 2)
  ctx.fillStyle = '#0d1016'
  ctx.fill()
  ctx.lineWidth = 1
  ctx.strokeStyle = ring
  ctx.stroke()
  ctx.font = '700 7px "JetBrains Mono", monospace'
  ctx.fillStyle = '#e6e9ef'
  ctx.fillText(label, bx, by + 0.5)
  ctx.font = FONT
}
