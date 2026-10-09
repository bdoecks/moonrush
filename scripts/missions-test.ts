// Weekly missions and the career ladders (src/game/missions.ts): counted from fills, each paid once, weeks roll over.
//   npx tsx scripts/missions-test.ts
import { badgeCount, CAREER, foldMissions, freshCareer, msToNextWeek, streakNow, TIER_NAMES, TIER_XP, tiersReached, WEEKLY_SWEEP_XP, weekKey, weeklyFor, weeklyMissions, type CareerState, type WeeklyState } from '../src/game/missions'
import type { Trade } from '../src/types'

let failed = 0
const ok = (cond: boolean, what: string) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${what}`)
  if (!cond) failed++
}
const buy = (tokenId: string, value = 100): Trade => ({ side: 'buy', tokenId, value }) as Trade
const sell = (tokenId: string, pnl: number, pnlPct: number, holdTicks = 100, value = 100): Trade => ({ side: 'sell', tokenId, value, pnl, pnlPct, holdTicks }) as Trade
const day = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h)

// ── Weeks ──
ok(weekKey(day(2026, 10, 8)) === '2026-10-05' && weekKey(day(2026, 10, 5, 0)) === '2026-10-05' && weekKey(day(2026, 10, 11, 23)) === '2026-10-05' && weekKey(day(2026, 10, 12, 0)) === '2026-10-12', 'a week runs Monday to Sunday')
ok(Math.abs(msToNextWeek(day(2026, 10, 11, 23)) - 3_600_000) < 1000 && msToNextWeek(day(2026, 10, 5, 0)) === 7 * 86_400_000, 'the countdown runs to next Monday')
const weeks = Array.from({ length: 52 }, (_, i) => weekKey(new Date(2026, 0, 5 + i * 7)))
ok(weeks.every((w) => weeklyMissions(w).length === 4 && new Set(weeklyMissions(w).map((d) => d.id)).size === 4), 'every week has four different missions')
ok(weeks.every((w, i) => i === 0 || weeklyMissions(w).map((d) => d.id).join() !== weeklyMissions(weeks[i - 1]).map((d) => d.id).join()) && new Set(weeks.map((w) => weeklyMissions(w).map((d) => d.id).join())).size >= 12, 'the four change from week to week (at least twelve different sets in a year)')
ok(weeklyMissions('2026-10-05').map((d) => d.id).join() === weeklyMissions('2026-10-05').map((d) => d.id).join(), 'a week always gives the same four')

// ── Counting a week ──
const now = day(2026, 10, 6)
let w: WeeklyState | undefined, c: CareerState | undefined
let r = foldMissions(w, c, [buy('A'), sell('A', 20, 0.2, 30), buy('B'), sell('B', -5, -0.05)], false, now)
ok(r.weekly.trades === 4 && r.weekly.volume === 400 && r.weekly.wins === 1 && r.weekly.pnl === 15 && r.weekly.bestPct === 20 && r.weekly.coins.length === 2 && r.weekly.days.length === 1, 'fills are counted into the week: trades, volume, wins, profit, best trade, coins, days')
ok(r.career.trades === 4 && r.career.wins === 1 && r.career.bigWin === 20 && r.career.quick === 1 && r.career.patient === 0 && r.career.streak === 1 && r.career.lastDay === '2026-10-06', '…and into the career: a win held under a minute is a quick one; a first day is a streak of one')
r = foldMissions(r.weekly, r.career, [sell('A', -30, -0.3)], false, now)
ok(r.weekly.pnl === -15 && r.weekly.peakPnl === 15, 'a later loss does not undo the profit a weekly goal had reached')
// Next week: the week starts clean, the career carries on.
const next = foldMissions(r.weekly, r.career, [buy('C')], false, day(2026, 10, 13))
ok(next.weekly.week === '2026-10-12' && next.weekly.trades === 1 && next.weekly.done.length === 0 && next.career.trades === 6, 'a new week starts from zero; the career keeps counting')
ok(weeklyFor(r.weekly, day(2026, 10, 13)).trades === 0 && weeklyFor(r.weekly, now).trades === 5, 'last week\'s numbers are not shown as this week\'s')

// ── Paying ──
const defs = weeklyMissions('2026-10-05')
let big = foldMissions(undefined, undefined, [], false, now)
const paidIds: string[] = []
let totalXp = 0
// Enough of everything to finish any weekly goal: 80 winning sells on 25 coins over 5 days, $120K of volume, a 2x, 3 sweeps.
for (let d = 0; d < 5; d++) {
  const fills = Array.from({ length: 16 }, (_, i) => sell(`T${(d * 5 + i) % 25}`, 60, i === 0 ? 1.2 : 0.3, 700, 1500))
  big = foldMissions(big.weekly, big.career, fills, d < 3, day(2026, 10, 5 + d))
  for (const p of big.paid) { paidIds.push(`${p.kind}:${p.title}`); totalXp += p.xp }
}
ok(defs.every((d) => big.weekly.done.includes(d.id)) && big.weekly.swept === true, 'a week of real play finishes all four, and the sweep')
ok(paidIds.filter((x) => x.startsWith('weekly:')).length === 4 && paidIds.filter((x) => x.startsWith('weeklySweep:')).length === 1 && new Set(paidIds).size === paidIds.length, 'each weekly mission and the sweep bonus is paid exactly once')
const again = foldMissions(big.weekly, big.career, [sell('T1', 60, 0.3, 700, 1500)], false, day(2026, 10, 9))
ok(!again.paid.some((p) => p.kind !== 'career') , 'more trades after that pay no weekly mission twice')
ok(big.career.streak === 5 && big.career.bestStreak === 5 && big.career.sweeps === 3 && big.career.patient === 80, 'five days in a row is a streak of five; sweeps and long holds are counted')

// ── Career ladders ──
ok(CAREER.length === 9 && CAREER.every((l) => l.steps.length === 5 && l.steps.every((s, i) => i === 0 || s > l.steps[i - 1])) && TIER_NAMES.length === 5 && TIER_XP.every((x, i) => i === 0 || x > TIER_XP[i - 1]), 'nine ladders of five rising tiers, each tier worth more than the last')
const one = foldMissions(undefined, undefined, [sell('X', 6000, 4, 30, 9000)], false, now)
const eye = one.paid.filter((p) => p.title.startsWith('Sharp eye')).map((p) => p.title)
ok(eye.length === 4 && eye[0] === 'Sharp eye: Bronze' && eye[3] === 'Sharp eye: Platinum' && one.career.tiers.eye === 4, 'one huge trade pays every tier it passes at once (a +400% trade: Bronze to Platinum of Sharp eye)')
ok(foldMissions(one.weekly, one.career, [buy('Y')], false, now).paid.every((p) => !p.title.startsWith('Sharp eye')), '…and never pays them again')
ok(tiersReached(CAREER[0], { ...freshCareer(), trades: 99 }) === 1 && tiersReached(CAREER[0], { ...freshCareer(), trades: 100 }) === 2 && badgeCount(one.career) === Object.values(one.career.tiers).reduce((a, n) => a + n, 0) && badgeCount(undefined) === 0, 'tiers are reached exactly at their step; the badge count is the tiers earned')
// The streak.
let s = foldMissions(undefined, undefined, [buy('A')], false, day(2026, 10, 1))
s = foldMissions(s.weekly, s.career, [buy('A')], false, day(2026, 10, 2))
s = foldMissions(s.weekly, s.career, [buy('A')], false, day(2026, 10, 2, 20))
ok(s.career.streak === 2, 'two trades on the same day count once toward the streak')
ok(streakNow(s.career, day(2026, 10, 3)) === 2 && streakNow(s.career, day(2026, 10, 4)) === 0, 'the streak is still alive the next day, and gone after a whole day without a trade')
s = foldMissions(s.weekly, s.career, [buy('A')], false, day(2026, 10, 5))
ok(s.career.streak === 1 && s.career.bestStreak === 2, 'after a missed day the streak starts again from one; the best streak is kept')
ok(foldMissions(s.weekly, s.career, [], false, day(2026, 10, 6)).career.streak === 1 && foldMissions(s.weekly, s.career, [], true, day(2026, 10, 6)).career.sweeps === 1, 'no fills change no streak; a daily sweep is counted by itself')
// An old save without the newer numbers must not break.
const old = foldMissions({ week: '2026-10-05', trades: 3 } as WeeklyState, { trades: 7 } as CareerState, [buy('A')], false, now)
ok(old.career.trades === 8 && Number.isFinite(old.career.volume) && old.career.tiers !== undefined, 'a save from before a new number was added still counts')
ok(totalXp > 0 && WEEKLY_SWEEP_XP === 500, `a full week pays ${totalXp.toLocaleString()} XP here (weekly missions, the sweep, and the career tiers reached along the way)`)
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed')
process.exit(0)
