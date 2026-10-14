// Rapid deploy: the three coin ideas made from a post (read off its words, never its hidden side) and the auto-sell
// rules a launch can carry.   npx tsx scripts/rapid-test.ts
import { RAPID_DEFAULT, rapidIdeas, rapidOf, sellsDue, tickerFor } from '../src/game/rapid'
import { makeSpark } from '../src/game/sparks'
import { createMarket } from '../src/game/marketEngine'
import { Rng } from '../src/utils/rng'

let bad = 0
const ok = (cond: boolean, what: string) => {
  if (!cond) bad++
  console.log(`${cond ? 'PASS' : 'FAIL'} ${what}`)
}

// ─── Ideas ───────────────────────────────────────────────────────────────────
const m = createMarket(11, 1_700_000_000, 'realtime')
const rng = new Rng(5)
let right = 0
let total = 0
let clean = true
let threeEach = true
for (let i = 0; i < 600; i++) {
  const { spark, sim } = makeSpark(m, rng, `S${i}`, i)
  if (spark.kind === 'tech') continue
  total++
  const ideas = rapidIdeas(spark, 'full')
  if (ideas.length !== 3 || ideas.some((x) => !x.name || !/^[A-Z0-9]{1,10}$/.test(x.ticker) || x.name.length > 24)) {
    threeEach = false
    if (clean) console.log('   bad ideas for:', spark.text, JSON.stringify(ideas))
    clean = false
  }
  if (ideas[0].name.toLowerCase() === sim.name.toLowerCase()) right++
}
ok(threeEach, `every post gives three ideas, each a name of at most 24 letters and a ticker of at most 10 (${total} posts)`)
ok(right / total > 0.9, `the first idea is the name the post gives, as a careful reader finds it (${right} of ${total})`)
const pupil = rapidIdeas({ text: 'Mayor Otter just won the town election. Nobody else ran.' }, 'full')
ok(pupil[0].name === 'Mayor Otter' && pupil[0].ticker === 'MAYOROTTER' && pupil[1].ticker !== pupil[0].ticker, `a titled name is read whole ("${pupil[0].name}", $${pupil[0].ticker}, then $${pupil[1].ticker})`)
ok(tickerFor('Mayor Otter', 'short') === 'OTTER' && tickerFor('Mayor Otter', 'letters') === 'MO' && tickerFor('Waffles', 'letters') === 'WAFF', 'the three ticker styles: whole name, last word, first letters')
ok(rapidIdeas({ text: 'no name in here at all' }, 'full').length === 3, 'a post with no name still gives three ideas')
ok(rapidOf(undefined).dev.on === false && rapidOf({ devBuy: 2 }).bundle.wallets === RAPID_DEFAULT.bundle.wallets && rapidOf({ devBuy: 2 }).devBuy === 2, 'settings from an older save are filled in')

// ─── Auto-sell ───────────────────────────────────────────────────────────────
const rules = { on: true, after: 60, at: [{ x: 2, pct: 0.5 }, { x: 5, pct: 1 }], mcap: 100_000, stop: 0.4 }
ok(sellsDue({ ...rules, on: false }, 'dev', 999, 1e9, 5000, []).length === 0, 'rules switched off sell nothing')
ok(sellsDue(rules, 'dev', 10, 5000, 5000, []).length === 0, 'nothing is due at launch')
ok(sellsDue(rules, 'dev', 61, 5000, 5000, []).map((d) => d.id).join() === 'dev:after', 'after its time: sell all')
const two = sellsDue(rules, 'dev', 10, 10_000, 5000, [])
ok(two.length === 1 && two[0].id === 'dev:x0' && two[0].pct === 0.5, 'at 2x: the first step sells half')
ok(sellsDue(rules, 'dev', 10, 10_000, 5000, ['dev:x0']).length === 0, 'and only once')
ok(sellsDue(rules, 'bundle', 10, 2900, 5000, []).map((d) => d.id).join() === 'bundle:stop', 'below the stop loss: sell all (each part counts its own rules)')
ok(sellsDue(rules, 'dev', 10, 120_000, 5000, ['dev:x0', 'dev:x1']).map((d) => d.id).join() === 'dev:mcap', 'at the market cap: sell all')

console.log(bad ? `${bad} check(s) failed` : 'all checks passed')
process.exit(bad ? 1 : 0)
