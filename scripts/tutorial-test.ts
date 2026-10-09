// The tutorials (src/game/tutorials.ts): every step is readable and the steps that wait for the player move on for
// the right thing and nothing else. (That the card shows and points at the screen is the UI bots' "Tutorial" step.)
//   npx tsx scripts/tutorial-test.ts
import { baseOf, TUTORIALS, type TutorialView } from '../src/game/tutorials'
import { COOK_FEE, GRAD_BONUS } from '../src/game/marketEngine'
import { CLOSED, shownUpdates, shownWork, UPDATES, WORKING_ON } from '../src/data/changelog'

let failed = 0
const ok = (cond: boolean, what: string) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${what}`)
  if (!cond) failed++
}
const view = (o: Partial<TutorialView> = {}): TutorialView => ({ view: 'discover', selectedId: null, selectedIsMine: false, trades: [], launches: [], ...o })
const all = Object.values(TUTORIALS)

ok(all.map((t) => t.id).join() === 'trading,deving', 'two tutorials: trading and deving')
ok(all.every((t) => t.steps.length >= 6 && t.steps.length <= 12 && t.minutes <= 5), 'each is 6 to 12 steps and says it takes five minutes or less')
ok(all.every((t) => t.steps.every((s) => s.title.length <= 30 && s.body.length >= 1 && s.body.length <= 2 && s.body.every((p) => p.length >= 30 && p.length <= 330))), 'every step has a short title and one or two short paragraphs')
ok(all.every((t) => t.steps.every((s) => !!s.done === !!s.todo)), 'a step that waits for the player always says what to do, and only such a step does')
ok(all.every((t) => !t.steps[0].done && !t.steps[t.steps.length - 1].done), 'the first and last step never wait: they explain and wrap up')
const text = all.flatMap((t) => t.steps.flatMap((s) => [s.title, s.todo ?? '', ...s.body])).join(' ')
ok(!/\b(guarantee|risk-free|easy money|free money|get rich)\b/i.test(text) && /play money/i.test(text) && /made up/i.test(text), 'nothing promises money, and it says plainly that the coins and the money are not real')
ok(!/\$25\b/.test(text) && !new RegExp(`\\$${COOK_FEE}\\b|\\$${GRAD_BONUS}\\b`).test(text), 'no dollar figure that a tuning change would make wrong (fees and bonuses are named, not priced)')

// The trading tutorial's three waits.
const tr = TUTORIALS.trading.steps
const pick = tr.find((s) => /Pick a coin/.test(s.title))!, buy = tr.find((s) => /Buy/.test(s.title))!, sell = tr.find((s) => /Sell/.test(s.title))!
ok(!pick.done!(view(), baseOf(view())) && !pick.done!(view({ view: 'trenches', selectedId: 'A' }), baseOf(view())) && pick.done!(view({ view: 'token', selectedId: 'A' }), baseOf(view())), '"Pick a coin" is done when a coin\'s page is open, not by looking at a list')
const one = view({ trades: [{ side: 'buy' }] })
ok(!buy.done!(one, baseOf(one)), '"Buy" does not count a buy made before the step began')
ok(buy.done!(view({ trades: [{ side: 'buy' }, { side: 'buy' }] }), baseOf(one)) && !buy.done!(view({ trades: [{ side: 'sell' }, { side: 'buy' }] }), baseOf(one)), '…only a new buy (a new sell does not do it)')
ok(sell.done!(view({ trades: [{ side: 'sell' }, { side: 'buy' }] }), baseOf(one)) && !sell.done!(view({ trades: [{ side: 'buy' }, { side: 'buy' }] }), baseOf(one)), '"Sell" is done by a new sell, and only by that')

// The deving tutorial's three waits.
const dv = TUTORIALS.deving.steps
const open = dv.find((s) => /kitchen/.test(s.title))!, cook = dv.find((s) => /Cook it/.test(s.title))!, goto = dv.find((s) => /Go to your coin/.test(s.title))!
ok(!open.done!(view(), baseOf(view())) && open.done!(view({ view: 'cooking' }), baseOf(view())), '"Open the kitchen" is done on the Cooking page')
const had = view({ launches: [{ tokenId: 'OLD' }] })
ok(!cook.done!(had, baseOf(had)) && cook.done!(view({ launches: [{ tokenId: 'NEW' }, { tokenId: 'OLD' }] }), baseOf(had)), '"Cook it" is done by a new launch, not by one from before')
ok(!goto.done!(view({ view: 'token', selectedId: 'X', selectedIsMine: false }), baseOf(view())) && goto.done!(view({ view: 'token', selectedId: 'X', selectedIsMine: true }), baseOf(view())), '"Go to your coin" is done on a coin you launched, not on anybody else\'s')
// The Updates list (src/data/changelog.ts) players read.
const lines = UPDATES.flatMap((x) => [...(x.fixed ?? []), ...(x.added ?? []), ...(x.changed ?? [])])
ok(UPDATES.length >= 1 && new Set(UPDATES.map((x) => x.id)).size === UPDATES.length && UPDATES.every((x) => x.title.length > 3 && /\d{4}/.test(x.date) && (x.fixed ?? x.added ?? x.changed ?? []).length > 0), 'every update has its own id, a date, a title and something in it')
ok(lines.every((l) => l.length >= 15 && l.length <= 260) && [...WORKING_ON.map((w) => w.what), ...CLOSED.map((c) => c.why)].every((l) => l.length >= 8), 'every line is a sentence a player can read, not a note to ourselves')
ok(!/\b(botDev|stepFlow|flow\.|CREATOR_CUT|COOK_FEE|launchBlock|applySimTrade|PR|commit|branch)\b/.test([...lines, ...WORKING_ON.map((w) => w.what + (w.why ?? '')), ...CLOSED.map((c) => c.what + c.why)].join(' ')), 'no code names in it')
ok(CLOSED.every((c) => c.why.length > 30 && ['cooking', 'labs'].includes(c.flag)) && new Set(CLOSED.map((c) => c.flag)).size === CLOSED.length, 'everything closed says why, and is tied to the switch that brings it back')
ok(shownUpdates({}).every((u) => !u.flag) && shownUpdates({ sparks: true, larps: true }).length === UPDATES.length && shownWork({ sparks: true }).length < shownWork({}).length && shownWork({}).length === WORKING_ON.length, 'an update about something behind a switch is told only once that switch is on, and it then leaves the "working on" list')
console.log(failed ?`\n${failed} check(s) failed` : '\nall checks passed')
process.exit(0)
