// Daily challenges: three a day (easy / medium / hard), no goal two days running, fills add up, each pays once,
// the all-three bonus pays once, and a new day starts clean.
import { dailyChallenges, dailyFor, foldDailies, msToNextDaily, type DailyState } from '../src/game/dailyChallenges'
import { dayKey } from '../src/game/daily'
import type { Trade } from '../src/types'

const ok = (cond: boolean, what: string) => console.log(`${cond ? 'PASS' : 'FAIL'} ${what}`)

let id = 0
const fill = (side: 'buy' | 'sell', tokenId: string, value: number, pnl?: number, pnlPct?: number): Trade => ({
  id: ++id, tick: id, time: id, tokenId, ticker: tokenId.toUpperCase(), emoji: '🐸', hue: 0, side, price: 1, qty: value, value, fee: value * 0.01, slippage: 0, pnl, pnlPct, status: 'FILLED',
})

// The picks.
const days = Array.from({ length: 140 }, (_, i) => dayKey(new Date(2026, 9, 3 + i)))
const picks = days.map((day) => dailyChallenges(day))
ok(picks.every((p) => p.length === 3 && p[0].tier === 'easy' && p[1].tier === 'medium' && p[2].tier === 'hard'), 'every day has one easy, one medium and one hard challenge')
ok(picks.every((p, i) => i === 0 || p.every((d, k) => d.id !== picks[i - 1][k].id)), 'no challenge repeats two days running')
ok(new Set(picks.map((p) => p.map((d) => d.id).join())).size === 140, 'the same trio does not come back within 140 days')
ok(dailyChallenges('2026-10-03').map((d) => d.id).join() === dailyChallenges('2026-10-03').map((d) => d.id).join(), 'a day always gives the same three')

// Progress and pay-outs on a fixed day.
const noon = new Date(2026, 9, 3, 12)
// While the Cooking page is closed, no day asks for a launch.
const year = Array.from({ length: 365 }, (_, i) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10))
ok(year.some((day) => dailyChallenges(day).some((x) => x.id === 'cook1')) && !year.some((day) => dailyChallenges(day, true).some((x) => x.id === 'cook1')), 'with cooking closed, "Cook a coin" is never one of the three (its days get the next goal)')
ok(year.every((day) => new Set(dailyChallenges(day, true).map((x) => x.id)).size === 3 && dailyChallenges(day, true).filter((x, i) => x.id !== dailyChallenges(day)[i].id).length <= 1), '…and nothing else about a day changes')
const [easy, medium, hard] = dailyChallenges(dayKey(noon))
console.log(`     2026-10-03: ${easy.title} · ${medium.title} · ${hard.title}`)
let st: DailyState | undefined
const paid: string[] = []
let sweeps = 0
const play = (fills: Trade[], cooked = 0, now = noon) => {
  const r = foldDailies(st, fills, cooked, now)
  st = r.state
  paid.push(...r.completed.map((c) => c.id))
  if (r.swept) sweeps++
  return r
}

play([fill('buy', 'a', 500)])
ok(st!.trades === 1 && st!.volume === 500 && st!.coins.length === 1 && paid.length === 0, 'one small buy counts and finishes nothing')
play([fill('sell', 'a', 400, -100, -0.2)])
ok(st!.pnl === -100 && st!.peakPnl === 0 && st!.wins === 0, 'a losing sell lowers the day\'s PnL and is not a win')

// Enough of everything to finish every challenge in the pool.
const big: Trade[] = []
for (let i = 0; i < 12; i++) big.push(fill('buy', `c${i}`, 3_000), fill('sell', `c${i}`, 6_000, 3_000, 1))
const r = play(big, 1)
ok(r.completed.length === 3 && r.swept, 'a big day finishes all three and the sweep bonus')
ok([easy, medium, hard].every((d) => d.progress(st!) >= d.target), 'each challenge\'s progress reached its target')
const again = play([fill('buy', 'z', 10_000), fill('sell', 'z', 20_000, 10_000, 1)], 1)
ok(again.completed.length === 0 && !again.swept && paid.length === 3 && sweeps === 1, 'finished challenges and the bonus pay only once')
play([fill('sell', 'z', 100, -50_000, -0.9)])
ok(st!.peakPnl > 1_000 && st!.pnl < 0, 'a later loss does not undo the day\'s best profit')

// Empty calls change nothing that matters.
const before = JSON.stringify(st)
play([])
ok(JSON.stringify(st) === before, 'no fills, no change')

// Midnight.
const tomorrow = new Date(2026, 9, 4, 0, 1)
ok(dailyFor(st, tomorrow).trades === 0 && dailyFor(st, tomorrow).done.length === 0, 'the next day starts from zero')
const next = foldDailies(st, [fill('buy', 'a', 100)], 0, tomorrow)
ok(next.state.date === '2026-10-04' && next.state.trades === 1 && !next.state.swept, 'the first fill after midnight goes on the new day')
ok(msToNextDaily(new Date(2026, 9, 3, 23, 0)) === 3_600_000, 'at 11pm the next set is an hour away')
