// GMGN-style trade bubbles: a round B / S badge pinned to the candle at the price the trade filled.
// Lightweight-charts' own markers can't hold text inside a shape, so this draws them as a series primitive.
import type { IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesPrimitive, SeriesAttachedParameter, Time } from 'lightweight-charts'
import type { MarkerKind } from './markers'

export interface Bubble {
  time: number // bar time (already bucketed to the timeframe)
  price: number // in chart units (price or market cap)
  side: 'buy' | 'sell'
  kind: MarkerKind
  text: string // 'B', 'S', 'DB', or a tracked wallet's avatar
  n: number // trades merged into this bubble
  color: string // fill
  ink: string // text colour
  ring?: string // outline for tracked wallets (their side colour)
}

type Target = Parameters<IPrimitivePaneRenderer['draw']>[0]

const R = 9 // bubble radius in CSS pixels
const FONT = '700 10px "JetBrains Mono", monospace'

export class TradeBubbles implements ISeriesPrimitive<Time> {
  private bubbles: Bubble[] = []
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

  set(bubbles: Bubble[]) {
    this.bubbles = bubbles
    this.p?.requestUpdate()
  }

  private draw(target: Target) {
    const p = this.p
    if (!p || !this.bubbles.length) return
    const ts = p.chart.timeScale()
    target.useMediaCoordinateSpace(({ context: ctx }) => {
      ctx.font = FONT
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      // Bubbles on the same bar and side stack away from the candle (buys downward, sells upward) so none hide.
      const stack = new Map<string, number>()
      for (const b of this.bubbles) {
        const x = ts.timeToCoordinate(b.time as Time)
        const y0 = p.series.priceToCoordinate(b.price)
        if (x === null || y0 === null) continue
        const key = `${b.time}|${b.side}`
        const i = stack.get(key) ?? 0
        stack.set(key, i + 1)
        const y = y0 + (b.side === 'buy' ? 1 : -1) * i * (R * 2 + 2)
        const w = Math.max(R * 2, ctx.measureText(b.text).width + 8)

        // Bubble: a circle for one glyph, a pill for "DB" / "DS".
        ctx.beginPath()
        ctx.roundRect(x - w / 2, y - R, w, R * 2, R)
        ctx.fillStyle = b.color
        ctx.fill()
        ctx.lineWidth = b.ring ? 1.5 : 1
        ctx.strokeStyle = b.ring ?? 'rgba(7,8,10,0.85)'
        ctx.stroke()

        ctx.fillStyle = b.ink
        ctx.fillText(b.text, x, y + 0.5)

        // Merged trades: a small count badge on the top-right edge.
        if (b.n > 1) {
          const label = b.n > 9 ? '9+' : String(b.n)
          const bx = x + w / 2 - 1
          const by = y - R + 1
          ctx.beginPath()
          ctx.arc(bx, by, 5.5, 0, Math.PI * 2)
          ctx.fillStyle = '#0d1016'
          ctx.fill()
          ctx.lineWidth = 1
          ctx.strokeStyle = b.ring ?? b.color
          ctx.stroke()
          ctx.font = '700 7px "JetBrains Mono", monospace'
          ctx.fillStyle = '#e6e9ef'
          ctx.fillText(label, bx, by + 0.5)
          ctx.font = FONT
        }
      }
    })
  }
}
