import { EVENT_TEMPLATES, type EventTemplate } from '../data/events'
import type { MarketEvent, MarketState, Token } from '../types'
import { clamp, type Rng } from '../utils/rng'
import { clockStep, joltByTrades, setRegime, SUPPLY } from './marketEngine'

const EVENT_CHANCE = 0.18
const lastMoveAlert = new Map<string, number>()

function pickTarget(tokens: Token[], tpl: EventTemplate, rng: Rng): Token | undefined {
  const live = tokens.filter((t) => t.status === 'bonding' || t.status === 'graduated')
  if (!live.length) return undefined
  const weight = (t: Token) => {
    switch (tpl.prefers) {
      case 'hot': return 1 + t.hype / 20 + Math.max(0, t.momentumScore - 50) / 10
      case 'risky': return 0.2 + (t.riskScore / 20) ** 2
      case 'cold': return 1 + Math.max(0, 60 - t.momentumScore) / 10
      default: return 1
    }
  }
  const total = live.reduce((a, t) => a + weight(t), 0)
  let r = rng.next() * total
  for (const t of live) if ((r -= weight(t)) <= 0) return t
  return live[live.length - 1]
}

/**
 * Possibly fire a news-style event and apply its effect to the (already cloned) tokens of this tick.
 * Also emits price-move alerts for sharp 1m moves.
 */
export function rollEvents(m: MarketState, rng: Rng): MarketEvent[] {
  const out: MarketEvent[] = []
  const emit = (e: Omit<MarketEvent, 'id' | 'tick' | 'time'>) => out.push({ ...e, id: m.tick * 100 + 50 + out.length, tick: m.tick, time: m.time })

  if (rng.chance(EVENT_CHANCE)) {
    const idx = rng.weighted<string>(Object.fromEntries(EVENT_TEMPLATES.map((e, i) => [String(i), e.weight])))
    const tpl: EventTemplate = EVENT_TEMPLATES[Number(idx)]
    const t = pickTarget(m.tokens, tpl, rng)
    if (t) {
      const s = t.sim
      if (tpl.jump) {
        // The jump is what it claims to be: a whale's buy, a dev's sell, a crowd following a call. Real trades through
        // the coin's curve / pool, sized to move the price that far, on the tape for everyone to see.
        const j = rng.range(tpl.jump[0], tpl.jump[1])
        const tokensBefore = t.liquidity / 2 / t.price
        const usd = joltByTrades(m, t, j, rng, tpl.kind === 'whale' ? 'whale' : tpl.kind === 'devsell' ? 'dev' : undefined, tpl.kind === 'kol' ? rng.int(2, 4) : 1)
        if (tpl.kind === 'devsell' && usd > 0) {
          // The dev's bag shrinks by the tokens that went into the pool.
          t.devPct = Math.max(0, t.devPct - (Math.max(0, t.liquidity / 2 / t.price - tokensBefore) / SUPPLY) * 100)
          t.devTrades = [{ time: m.time, side: 'sell' as const, usd }, ...(t.devTrades ?? [])].slice(0, 24)
        }
      }
      if (tpl.pressure) s.pressure += tpl.pressure
      if (tpl.hype) t.hype = clamp(t.hype + tpl.hype, 0, 100)
      if (tpl.volBoost) s.volBoost += tpl.volBoost
      if (tpl.regime) {
        const [lo, hi] = tpl.regimeTicks ?? [10, 20]
        setRegime(t, tpl.regime, rng, rng.int(lo, hi))
      }
      // Warning-type events on shady tokens sometimes precede a real rug: reading them matters.
      if ((tpl.kind === 'liquidity' || tpl.kind === 'devsell') && t.rugProb > 0.0002 && s.rugAt === null && rng.chance(0.35)) {
        s.rugAt = m.tick + Math.round(rng.int(15, 40) / clockStep())
      }
      emit({ kind: tpl.kind, tokenId: t.id, ticker: t.ticker, text: rng.pick(tpl.texts).replace('{T}', `$${t.ticker}`), icon: tpl.icon, tone: tpl.tone })
    }
  }

  // Sharp-move alerts, throttled per token.
  for (const t of m.tokens) {
    if (t.status === 'rugged' || t.status === 'dead') continue
    const ch = t.change['1m']
    if (Math.abs(ch) >= 0.12 && m.tick - (lastMoveAlert.get(t.id) ?? -999) > 40) {
      lastMoveAlert.set(t.id, m.tick)
      emit({ kind: ch > 0 ? 'momentum' : 'panic', tokenId: t.id, ticker: t.ticker, text: `$${t.ticker} ${ch > 0 ? '+' : ''}${(ch * 100).toFixed(1)}% in 1m`, icon: ch > 0 ? '📈' : '📉', tone: ch > 0 ? 'up' : 'down' })
    }
  }
  return out
}
