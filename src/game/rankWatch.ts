// Live round standings: who moved up or down over the last minute, and "you passed X" moments.
import type { Player } from '../types'

const WINDOW = 60 // ticks (~1 minute at 1×) that the ▲▼ movement looks back over
let history: Map<string, number>[] = [] // oldest first, one snapshot per tick
let lastTick = -1
let lastYouRank = 0
let lastPassTick = -Infinity

export const retOf = (p: Pick<Player, 'equity' | 'startEquity'>) => p.equity / p.startEquity - 1

/** Rank everyone (you = 'you') by % return, best first. */
export function rankMap(players: Player[], youRet: number) {
  const all = [{ id: 'you', ret: youRet }, ...players.map((p) => ({ id: p.id, ret: retOf(p) }))].sort((a, b) => b.ret - a.ret)
  return new Map(all.map((r, i) => [r.id, i + 1]))
}

/**
 * Record this tick's standings. Returns the rival you just overtook (if your rank improved this tick), so the caller
 * can celebrate it — at most one alert every few seconds.
 */
export function watchRanks(players: Player[], youRet: number, tick: number): Player | null {
  if (tick < lastTick) {
    history = []
    lastYouRank = 0
  }
  if (tick === lastTick) return null
  lastTick = tick
  const now = rankMap(players, youRet)
  history.push(now)
  if (history.length > WINDOW + 1) history.shift()
  const you = now.get('you')!
  const prev = lastYouRank
  lastYouRank = you
  if (!prev || you >= prev || tick - lastPassTick < 15) return null
  lastPassTick = tick
  // The rival now right behind you is the one you just passed.
  return players.find((p) => now.get(p.id) === you + 1) ?? null
}

/** Places gained (+) or lost (−) over the last minute. */
export function movement(id: string) {
  if (history.length < 2) return 0
  const then = history[0].get(id)
  const now = history[history.length - 1].get(id)
  return then && now ? then - now : 0
}
