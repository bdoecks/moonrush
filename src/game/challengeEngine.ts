import type { Challenge } from '../types'
import { fmtCompact } from '../utils/format'

export interface ChallengeContext {
  profitableSells: number
  uniqueTokens: number
  bestSellPct: number // fraction
  growth: number // fraction vs start balance
  maxDrawdown: number
  tradeCount: number
  earlyBuys: number
  gradsHeld: number
  greenPositions: number
  startBalance: number
  cooked: number
  cookedGrads: number
}

interface Def {
  id: string
  title: (c: ChallengeContext) => string
  desc: string
  xp: number
  target: number
  unit?: '%' | ''
  progress: (c: ChallengeContext) => number
  fails?: (c: ChallengeContext) => boolean
}

const DEFS: Def[] = [
  { id: 'profit3', title: () => 'Make 3 profitable trades', desc: 'Close any 3 sells in profit.', xp: 60, target: 3, progress: (c) => c.profitableSells },
  { id: 'growth10', title: () => 'Reach +10% portfolio growth', desc: 'Total equity 10% above your starting balance.', xp: 100, target: 10, unit: '%', progress: (c) => c.growth * 100 },
  { id: 'diverse5', title: () => 'Trade 5 different tokens', desc: 'Spread the risk. Or the degeneracy.', xp: 50, target: 5, progress: (c) => c.uniqueTokens },
  { id: 'catch20', title: () => 'Catch a 20% pump', desc: 'Close a single trade at +20% or better.', xp: 120, target: 20, unit: '%', progress: (c) => c.bestSellPct * 100 },
  { id: 'early', title: () => 'Ape a fresh launch', desc: 'Buy a token less than 5 minutes old.', xp: 40, target: 1, progress: (c) => c.earlyBuys },
  { id: 'grad', title: () => 'Ride a graduation', desc: 'Hold a bonding-curve token as it graduates.', xp: 80, target: 1, progress: (c) => c.gradsHeld },
  { id: 'cook', title: () => 'Cook your own token', desc: 'Launch a memecoin from the Cooking tab.', xp: 60, target: 1, progress: (c) => c.cooked },
  { id: 'cookgrad', title: () => 'Cook a token that graduates', desc: 'One of your launches completes its bonding curve and migrates.', xp: 200, target: 1, progress: (c) => c.cookedGrads },
  { id: 'green3', title: () => 'Hold 3 green positions at once', desc: 'Three open positions in profit simultaneously.', xp: 70, target: 3, progress: (c) => c.greenPositions },
  {
    id: 'disciplined', title: () => 'Make 10 trades, never down 5%', desc: 'Keep max drawdown under 5% while making 10 trades.', xp: 150, target: 10,
    progress: (c) => c.tradeCount, fails: (c) => c.maxDrawdown >= 0.05,
  },
  { id: 'x15', title: (c) => `Turn ${fmtCompact(c.startBalance)} into ${fmtCompact(c.startBalance * 1.5)}`, desc: 'Grow equity to 1.5× your starting balance.', xp: 250, target: 50, unit: '%', progress: (c) => c.growth * 100 },
]

export function createChallenges(ctx: ChallengeContext): Challenge[] {
  return DEFS.map((d) => ({ id: d.id, title: d.title(ctx), desc: d.desc, xp: d.xp, target: d.target, unit: d.unit ?? '', progress: 0, done: false }))
}

/** Update progress; returns the new list and any challenges completed this call. */
export function evaluateChallenges(list: Challenge[], ctx: ChallengeContext): { list: Challenge[]; completed: Challenge[] } {
  const completed: Challenge[] = []
  const next = list.map((c) => {
    if (c.done || c.failed) return c
    const d = DEFS.find((x) => x.id === c.id)
    if (!d) return c
    if (d.fails?.(ctx)) return { ...c, failed: true }
    const progress = Math.max(c.progress, d.progress(ctx))
    const done = progress >= c.target
    const upd = { ...c, progress, done }
    if (done) completed.push(upd)
    return progress === c.progress && !done ? c : upd
  })
  return { list: next, completed }
}
