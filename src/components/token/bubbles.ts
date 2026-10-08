// Trade markers on the chart, drawn as a series primitive (lightweight-charts' own markers can't hold text or
// pictures inside a shape). Two looks:
//  - 'tags' (GMGN / Axiom): a small labelled tag under the candle for a buy (pointer up) and over it for a sell
//    (pointer down), so the candles stay visible. Dev = amber DB/DS; tracked wallets and friends = their avatar.
//  - 'avatars' (Axiom): each trade is the trader's round avatar on the price, ringed green (buy) or red (sell).
//  - 'bubbles': a round badge sitting on the candle at the exact fill price.
// Story and market beats are not trades: in every look they are small pins over the candle they happened in.
import type { IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesPrimitive, SeriesAttachedParameter, Time } from 'lightweight-charts'
import type { Beat } from '../../types'
import type { MarkerKind } from './markers'

export type MarkerStyle = 'avatars' | 'tags' | 'bubbles'

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
  tint?: string // a tracked trader's own colour: a second, outer ring, the same on every coin
  face?: string // avatar style: the trader's avatar (emoji) or initials
  bg?: string // avatar style: circle colour behind the face
  // For the hover card (Axiom / GMGN show who traded, how much, and at what market cap).
  who?: string
  usd?: number // total of the merged trades
  mc?: number // average market cap at the fills (USD)
  notes?: Beat[] // a story / event pin: the beats in this candle, the one it shows first
}

type Box = { x: number; y: number; w: number; h: number }

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
  private hits: (Box & { b: Bubble })[] = [] // where each marker was last drawn, for hovering
  private style: MarkerStyle = 'avatars'
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

  /** The marker under a point on the chart (CSS pixels), topmost first, or null. */
  hit(x: number, y: number): Bubble | null {
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i]
      if (x >= h.x - 2 && x <= h.x + h.w + 2 && y >= h.y - 2 && y <= h.y + h.h + 2) return h.b
    }
    return null
  }

  private draw(target: Target) {
    const p = this.p
    this.hits = []
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
        if (b.notes) {
          // A pin sits over the candle (over any sell tags there), one lane per pin.
          const top = p.series.priceToCoordinate(b.high)
          const lane = stack.get(`${b.time}|pin`) ?? 0
          stack.set(`${b.time}|pin`, lane + 1)
          if (top !== null) this.hits.push({ ...drawPin(ctx, b, x, top - (this.style === 'tags' ? (stack.get(`${b.time}|sell`) ?? 0) * (TAG_H + 3) : 0), lane), b })
          continue
        }
        const key = `${b.time}|${b.side}`
        const i = stack.get(key) ?? 0
        stack.set(key, i + 1)
        if (this.style === 'avatars') {
          const y0 = p.series.priceToCoordinate(b.price)
          // Clusters on one bar fan out a little, like Axiom's piles of avatars.
          if (y0 !== null) this.hits.push({ ...drawAvatar(ctx, b, x + (i % 2 ? 7 : 0) * (i ? 1 : 0), y0 + (b.side === 'buy' ? 1 : -1) * i * 9), b })
        } else if (this.style === 'bubbles') {
          const y0 = p.series.priceToCoordinate(b.price)
          if (y0 !== null) this.hits.push({ ...drawBubble(ctx, b, x, y0 + (b.side === 'buy' ? 1 : -1) * i * (R * 2 + 2)), b })
        } else {
          const edge = p.series.priceToCoordinate(b.side === 'buy' ? b.low : b.high)
          if (edge !== null) this.hits.push({ ...drawTag(ctx, b, x, edge, i), b })
        }
      }
    })
  }
}

/** GMGN / Axiom tag: under the candle for buys, over it for sells, with a small pointer at the candle. */
function drawTag(ctx: Ctx, b: Bubble, x: number, edge: number, i: number): Box {
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
  if (b.tint) {
    ctx.beginPath()
    ctx.roundRect(x - w / 2 - 2.5, top - 2.5, w + 5, TAG_H + 5, TAG_H / 2 + 2.5)
    ctx.lineWidth = 1.5
    ctx.strokeStyle = b.tint
    ctx.stroke()
  }
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
  return { x: x - w / 2, y: top, w, h: TAG_H }
}

/** Axiom: the trader's avatar in a circle on the fill price, ringed green (buy) or red (sell), with a side dot. */
function drawAvatar(ctx: Ctx, b: Bubble, x: number, y: number): Box {
  const buy = b.side === 'buy'
  const side = buy ? UP : DOWN
  const r = 10
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.55)'
  ctx.shadowBlur = 4
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fillStyle = b.bg ?? '#1a1f29'
  ctx.fill()
  ctx.restore()
  ctx.lineWidth = 2
  ctx.strokeStyle = side
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.stroke()
  if (b.tint) {
    // Whose trade it is: the trader's own colour around the buy / sell ring.
    ctx.lineWidth = 2
    ctx.strokeStyle = b.tint
    ctx.beginPath()
    ctx.arc(x, y, r + 2.5, 0, Math.PI * 2)
    ctx.stroke()
  }
  const face = b.face ?? b.text
  const emoji = /\p{Extended_Pictographic}/u.test(face)
  ctx.font = emoji ? '12px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif' : '800 8px "JetBrains Mono", monospace'
  ctx.fillStyle = '#fff'
  ctx.fillText(face, x, y + (emoji ? 1 : 0.5))
  // Side dot (bottom-right), like Axiom's small badge.
  const bx = x + r * 0.72
  const by = y + r * 0.72
  ctx.beginPath()
  ctx.arc(bx, by, 4.5, 0, Math.PI * 2)
  ctx.fillStyle = side
  ctx.fill()
  ctx.lineWidth = 1.2
  ctx.strokeStyle = '#0b0d12'
  ctx.stroke()
  ctx.font = '800 6px "JetBrains Mono", monospace'
  ctx.fillStyle = buy ? '#06140d' : '#fff'
  ctx.fillText(buy ? 'B' : 'S', bx, by + 0.5)
  if (b.n > 1) countBadge(ctx, b.n, x - r * 0.75, y - r * 0.75, side)
  ctx.font = FONT
  return { x: x - r, y: y - r, w: r * 2, h: r * 2 }
}

/** Classic: a round badge on the candle at the fill price. */
function drawBubble(ctx: Ctx, b: Bubble, x: number, y: number): Box {
  ctx.font = FONT
  const w = Math.max(R * 2, ctx.measureText(b.text).width + 8)
  ctx.beginPath()
  ctx.roundRect(x - w / 2, y - R, w, R * 2, R)
  ctx.fillStyle = b.color
  ctx.fill()
  ctx.lineWidth = b.ring ? 1.5 : 1
  ctx.strokeStyle = b.ring ?? 'rgba(7,8,10,0.85)'
  ctx.stroke()
  if (b.tint) {
    ctx.beginPath()
    ctx.roundRect(x - w / 2 - 2.5, y - R - 2.5, w + 5, R * 2 + 5, R + 2.5)
    ctx.lineWidth = 1.5
    ctx.strokeStyle = b.tint
    ctx.stroke()
  }
  ctx.fillStyle = b.ink
  ctx.fillText(b.text, x, y + 0.5)
  if (b.n > 1) countBadge(ctx, b.n, x + w / 2 - 1, y - R + 1, b.ring ?? b.color)
  return { x: x - w / 2, y: y - R, w, h: R * 2 }
}

/** A story / event pin: a small badge over the candle on a thin stem, ringed with its tone. */
function drawPin(ctx: Ctx, b: Bubble, x: number, top: number, lane: number): Box {
  const S = 16
  const y = Math.max(2, top - 9 - S - lane * (S + 3))
  const ring = b.ring ?? '#8b93a1'
  if (lane === 0 && top - 2 > y + S) {
    ctx.save()
    ctx.globalAlpha = 0.55
    ctx.beginPath()
    ctx.moveTo(x, top - 2)
    ctx.lineTo(x, y + S)
    ctx.lineWidth = 1
    ctx.strokeStyle = ring
    ctx.stroke()
    ctx.restore()
  }
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.55)'
  ctx.shadowBlur = 4
  ctx.beginPath()
  ctx.roundRect(x - S / 2, y, S, S, 5)
  ctx.fillStyle = b.color
  ctx.fill()
  ctx.restore()
  ctx.beginPath()
  ctx.roundRect(x - S / 2, y, S, S, 5)
  ctx.lineWidth = 1.5
  ctx.strokeStyle = ring
  ctx.stroke()
  ctx.font = '10px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif'
  ctx.fillStyle = '#fff'
  ctx.fillText(b.text, x, y + S / 2 + 1)
  if (b.n > 1) countBadge(ctx, b.n, x + S / 2 - 1, y + 1, ring)
  ctx.font = FONT
  return { x: x - S / 2, y, w: S, h: S }
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
