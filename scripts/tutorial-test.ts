// The tutorials (src/game/tutorials.ts): every step is readable and the steps that wait for the player move on for
// the right thing and nothing else. (That the card shows and points at the screen is the UI bots' "Tutorial" step.)
//   npx tsx scripts/tutorial-test.ts
import { baseOf, TUTORIALS, type TutorialView } from '../src/game/tutorials'
import { COOK_FEE, GRAD_BONUS } from '../src/game/marketEngine'

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
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed')
process.exit(0)
