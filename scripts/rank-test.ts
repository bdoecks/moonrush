// World ranks (src/game/worldRank.ts): the title a season profit earns, measured against a starting wallet.
//   npx tsx scripts/rank-test.ts
import { nextWorldRank, WORLD_RANKS, worldRank } from '../src/game/worldRank'

let failed = 0
const ok = (cond: boolean, what: string) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${what}`)
  if (!cond) failed++
}
const name = (profit: number, start: number) => worldRank(profit, start).name
ok(WORLD_RANKS.length === 7 && WORLD_RANKS.every((r, i) => i === 0 || r.from > WORLD_RANKS[i - 1].from) && new Set(WORLD_RANKS.map((r) => r.id)).size === 7, 'seven ranks, each starting higher than the one before')
ok(name(0, 1250) === 'Shrimp' && name(-0.17, 1250) === 'Shrimp' && name(-62, 1250) === 'Shrimp' && name(-63, 1250) === 'Plankton' && name(-99999, 1250) === 'Plankton', 'a new player is a Shrimp, and stays one while down only a few fees (5% of a starting wallet); below that is Plankton, however deep')
ok(name(124, 1250) === 'Shrimp' && name(125, 1250) === 'Crab' && name(625, 1250) === 'Fish' && name(1875, 1250) === 'Dolphin' && name(5000, 1250) === 'Shark' && name(12500, 1250) === 'Whale' && name(9e9, 1250) === 'Whale', 'on a $1,250 start: Crab from +$125, Fish +$625, Dolphin +$1,875, Shark +$5,000, Whale +$12,500')
ok(name(1000, 10_000) === 'Crab' && name(999, 10_000) === 'Shrimp' && name(100_000, 10_000) === 'Whale', 'the ladder scales with the starting balance: the same ranks on a $10,000 start cost eight times the profit')
const n = nextWorldRank(100, 1250)!
ok(n.rank.name === 'Crab' && Math.abs(n.need - 25) < 1e-9 && n.progress > 0.8 && n.progress < 0.9, 'it says what is left to the next rank: at +$100, $25 more to Crab, most of the way')
ok(nextWorldRank(-300, 1250)!.rank.name === 'Shrimp' && Math.abs(nextWorldRank(-300, 1250)!.need - 237.5) < 1e-9 && nextWorldRank(50_000, 1250) === null, 'from the red the next rank is Shrimp; at the top there is no next rank')
ok([-5000, -1, 0, 50, 700, 3000, 9000, 1e6].every((p) => { const x = nextWorldRank(p, 1250); return !x || (x.progress >= 0 && x.progress <= 1 && x.need >= 0) }) && Number.isFinite(worldRank(5, 0).from), 'progress is always between 0 and 1, and a zero starting balance breaks nothing')
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed')
process.exit(0)
