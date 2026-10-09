// World ranks: a title every player wears on the season board, from how far their season profit has taken them
// compared with what a World wallet starts with (so the ladder keeps its meaning when the owner changes the starting
// balance). Pure. A rank is a label for a number that is already public (season profit): it pays nothing.

export interface WorldRank {
  id: string
  name: string
  icon: string
  from: number // season profit, as a multiple of the starting balance, at which this rank begins
  cls: string // text / border colour
}

/** Lowest first. `from` is profit ÷ starting balance: 0.1 = up 10% of a starting wallet this season. */
export const WORLD_RANKS: WorldRank[] = [
  { id: 'plankton', name: 'Plankton', icon: '🦠', from: -Infinity, cls: 'text-dim border-line2' },
  { id: 'shrimp', name: 'Shrimp', icon: '🦐', from: -0.05, cls: 'text-muted border-line2' }, // (a few fees paid is not "in the red")
  { id: 'crab', name: 'Crab', icon: '🦀', from: 0.1, cls: 'text-info border-info/40' },
  { id: 'fish', name: 'Fish', icon: '🐟', from: 0.5, cls: 'text-up border-up/40' },
  { id: 'dolphin', name: 'Dolphin', icon: '🐬', from: 1.5, cls: 'text-accent border-accent/50' },
  { id: 'shark', name: 'Shark', icon: '🦈', from: 4, cls: 'text-warn border-warn/50' },
  { id: 'whale', name: 'Whale', icon: '🐋', from: 10, cls: 'text-warn border-warn' },
]

/** The rank a season profit earns. (Somebody who has not traded yet, or is down a few fees, is a Shrimp: nobody starts below it.) */
export function worldRank(seasonProfit: number, startBalance: number): WorldRank {
  const x = seasonProfit / Math.max(1, startBalance)
  let rank = WORLD_RANKS[0]
  for (const r of WORLD_RANKS) if (x >= r.from) rank = r
  return rank
}

/** What is left to the next rank: its name and the profit still to make. Null at the top. */
export function nextWorldRank(seasonProfit: number, startBalance: number): { rank: WorldRank; need: number; progress: number } | null {
  const cur = worldRank(seasonProfit, startBalance)
  const next = WORLD_RANKS[WORLD_RANKS.indexOf(cur) + 1]
  if (!next) return null
  const start = Math.max(1, startBalance)
  const lo = Number.isFinite(cur.from) ? cur.from * start : Math.min(seasonProfit, -start)
  const hi = next.from * start
  return { rank: next, need: Math.max(0, hi - seasonProfit), progress: Math.min(1, Math.max(0, (seasonProfit - lo) / Math.max(1, hi - lo))) }
}
