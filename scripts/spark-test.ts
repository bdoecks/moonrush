// The story market: posts that coins get launched on (src/game/sparks.ts, src/data/sparkPosts.ts).
//   npx tsx scripts/spark-test.ts [engine hours=2]
// 1. The content: accounts, subjects and names are invented, approved and clean; a misspelling never spells anything crude.
// 2. What devs call their coins, and how a coin's name is read against the post's.
// 3. The timeline's choice: the sums that make every coin a fair bet, and what reading the post adds to them.
// 4. The engine: posts, launches, the settle, the hidden side, a list that stays a steady size, switching it off.
// 5. The wire: what a World player is sent, and never the hidden side.
// What a rule earns in the World with its bots, fees paid, is scripts/fair-test.ts (the rules named "post").
import { Room } from '../server/room'
import { moderate, nameBlocked } from '../server/moderation'
import { anonAccount, NEVER_SPELL, SPARK_ACCOUNTS, SPARK_NAMES, SPARK_TITLES, SUBJECTS, VARIANT_POST, VARIANT_PRE } from '../src/data/sparkPosts'
import { SAFE_THEMES } from '../src/data/themeWords'
import { computeRisk, createMarket, FLOW, setClock, tickMarket } from '../src/game/marketEngine'
import { demoAnswer, toolAnswer } from '../src/game/sparks'
import { SPARK_TECH, TECH_NAMES, TECH_TOOLS } from '../src/data/sparkPosts'
import { auditOf, coinFor, devFor, fitOf, keptSparks, makeSpark, mergeSparks, pickWeights, SPARK, sparkLine, sparkRate, stakeOf, tickerOf, typo, type Candidate, type CoinFit } from '../src/game/sparks'
import { tickSocial } from '../src/game/socialEngine'
import { tickStories } from '../src/game/storyEngine'
import { WORLD_CODE, type ServerMsg } from '../src/net/protocol'
import { Rng } from '../src/utils/rng'
import type { MarketState, Spark, SparkSim, Token } from '../src/types'

const hours = Number(process.argv[2] ?? 2)
let failed = 0
const ok = (cond: boolean, what: string) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${what}`)
  if (!cond) failed++
}
const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length)
const pct = (x: number, d = 1) => `${(100 * x).toFixed(d)}%`

// ─── 1. The content ──────────────────────────────────────────────────────────
// Names a famous real animal, a known character, a real coin or a public figure carries. None may be a pet's name
// here, and no account may be called after one. (Add to it whenever one comes to mind: the list only ever grows.)
const FAMOUS = [
  'doug', 'hank', 'noodle', 'walter', 'juniper', 'moose', 'bruno', 'phil', 'peanut', 'pnut', 'pesto', 'mittens', 'grumpy', 'boo', 'harambe', 'cecil', 'fiona', 'hachiko',
  'laika', 'dolly', 'koko', 'knut', 'flaco', 'freya', 'gus', 'stubbs', 'larry', 'maru', 'nala', 'tuna', 'marnie', 'manny', 'crusoe', 'loki', 'kabosu', 'cheems', 'neiro',
  'keiko', 'shamu', 'balto', 'togo', 'lassie', 'beethoven', 'garfield', 'snoopy', 'scooby', 'pluto', 'goofy', 'mickey', 'minnie', 'donald', 'daffy', 'bugs', 'tweety',
  'tom', 'jerry', 'simba', 'nemo', 'dory', 'bambi', 'dumbo', 'yoshi', 'sonic', 'pikachu', 'kirby', 'mario', 'luigi', 'zelda', 'shrek', 'kermit', 'elmo', 'barney',
  'clifford', 'paddington', 'pooh', 'tigger', 'eeyore', 'baloo', 'felix', 'sylvester', 'bender', 'gizmo', 'gary', 'patrick', 'sandy', 'pepe', 'doge', 'wojak', 'bonk',
  'shiba', 'floki', 'elon', 'trump', 'biden', 'kanye', 'taylor', 'pickles', 'bubbles', 'otis', 'boots', 'socks', 'sprocket', 'duchess', 'kevin', 'frank', 'pebble',
  'bean', 'pepper', 'ziggy', 'rufus', 'basil', 'tank', 'gladys', 'meatball', 'bongo', 'barnaby', 'zorp', 'hazel', 'chuck', 'kazoo', 'banjo', 'pogo', 'womble',
]
// A title and a subject that together are somebody's name.
const KNOWN_PAIRS = ['captain planet', 'captain toad', 'captain comet', 'tiny tiger', 'turbo snail', 'dizzy egg', 'fancy bear', 'cozy bear', 'agent fox', 'grumpy cat', 'mister robot', 'doctor octopus', 'sleepy bear hollow']
{
  const ids = SPARK_ACCOUNTS.map((a) => a.id)
  const handles = SPARK_ACCOUNTS.map((a) => a.handle)
  ok(new Set(ids).size === ids.length && new Set(handles).size === handles.length && SPARK_ACCOUNTS.every((a) => a.id === `sx-${a.handle}` && /^[a-z0-9_]{3,20}$/.test(a.handle) && a.name.trim().length >= 3 && a.followers > 0),
    `${SPARK_ACCOUNTS.length} named accounts: each its own id and handle, a handle a timeline could carry`)
  const tiers = ['mid', 'big', 'mega'] as const
  ok(tiers.every((t) => SPARK_ACCOUNTS.some((a) => a.tier === t && !a.news) && SPARK_ACCOUNTS.some((a) => a.tier === t && a.news)) && SPARK_ACCOUNTS.some((a) => a.tier === 'small' && a.news), 'every size of named account has people and outlets, and there are small local papers')
  const size = (t: string) => SPARK_ACCOUNTS.filter((a) => a.tier === t).map((a) => a.followers)
  ok(Math.max(...size('small')) < Math.min(...size('mid')) && Math.max(...size('mid')) < Math.min(...size('big')) && Math.max(...size('big')) < Math.min(...size('mega')), 'a bigger kind of account always has more followers than a smaller kind (the size a player reads is the size that counts)')
  const rng = new Rng(7)
  const anon = Array.from({ length: 4000 }, (_, i) => anonAccount(() => rng.next(), i % 2 ? 'small' : 'anon'))
  ok(anon.every((a) => /^[a-z0-9_]{5,24}$/.test(a.handle) && !handles.includes(a.handle) && a.followers < Math.min(...size('mid')) && !nameBlocked(a.handle)), 'the nobodies: clean handles, none a named account, all smaller than any named one')
  ok(SUBJECTS.every((s) => SAFE_THEMES.has(s.word)) && new Set(SUBJECTS.map((s) => s.word)).size === SUBJECTS.length, `every one of the ${SUBJECTS.length} things a post can be about is an approved theme word`)
  const lower = SPARK_NAMES.map((n) => n.toLowerCase())
  ok(new Set(lower).size === lower.length && SPARK_NAMES.every((n) => /^[A-Z][a-z]{1,9}$/.test(n)) && !lower.some((n) => FAMOUS.includes(n)), `${SPARK_NAMES.length} names: plain, short enough for a ticker, and none a famous animal's, character's, coin's or person's`)
  const pairs = SPARK_TITLES.flatMap((t) => SUBJECTS.map((s) => `${t} ${s.word}`.toLowerCase()))
  ok(!pairs.some((p) => KNOWN_PAIRS.includes(p)) && !SPARK_TITLES.some((t) => FAMOUS.includes(t.toLowerCase())), `no title and subject together make a known character's name (${pairs.length} pairs)`)
  const words = (s: string) => s.toLowerCase().split(/[^a-z]+/).filter(Boolean)
  ok(SPARK_ACCOUNTS.every((a) => !words(a.name).some((w) => FAMOUS.includes(w)) && !nameBlocked(a.name) && !nameBlocked(a.handle)), 'no account is named after one either')
  ok([...SPARK_NAMES, ...SPARK_TITLES, ...VARIANT_PRE, ...VARIANT_POST, ...SUBJECTS.map((s) => s.word)].every((w) => !nameBlocked(w) && !NEVER_SPELL.includes(w.toLowerCase())), 'nothing on the lists is itself a blocked or crude word')
}
// A few thousand posts, as the game makes them.
const fakeMarket = { tick: 1, time: 1_760_000_000, meta: 'animal', trends: undefined } as unknown as MarketState
const made: { spark: Spark; sim: SparkSim }[] = []
{
  const rng = new Rng(11)
  for (let i = 0; i < 6000; i++) made.push(makeSpark(fakeMarket, rng, `s${i}`, i))
  const texts = made.map((x) => x.spark.text)
  ok(texts.every((t) => !/[{}]/.test(t) && t.length >= 20 && t.length <= 200), 'every post is filled in whole and fits a timeline')
  const an = texts.filter((t) => / an? (owl|otter|egg|android|alien|arcade)/i.test(t))
  ok(an.length > 50 && an.every((t) => !/(^| )a (owl|otter|egg|android|alien|arcade)/i.test(t)) && texts.some((t) => / a (ufo|unicorn)/.test(t)), `and reads right: an owl, an android, a ufo (${an.length} such posts)`)
  ok(made.every((x) => x.spark.text.includes(x.sim.name) || x.spark.text.includes(`#${x.sim.name.replace(/[^A-Za-z0-9]/g, '')}`)), 'every post names what it is about: the right name is in it, to be read')
  ok(made.every((x) => !/\$[A-Z]/.test(x.spark.text)), 'no post names a ticker: the coins come after the post, not with it')
  ok(made.every((x) => x.sim.ticker === tickerOf(x.sim.name) && /^[A-Z0-9]{2,10}$/.test(x.sim.ticker)), "the right ticker is the name's letters, ten at the most")
  const bad = texts.filter((t) => { const m = moderate(t, { noLinks: true }); return !m.ok || m.strike })
  ok(bad.length === 0 && made.every((x) => !nameBlocked(x.sim.name)), `the game's own chat filter passes every post and every right name${bad.length ? ` (refused: "${bad[0]}")` : ''}`)
  ok(new Set(texts).size > texts.length * 0.9, `posts rarely repeat (${new Set(texts).size} different ones in ${texts.length})`)
  const kinds = made.filter((x) => x.spark.kind === 'news').length / made.length
  ok(kinds > 0.05 && kinds < 0.3 && made.every((x) => (x.spark.kind === 'news') === !!SPARK_ACCOUNTS.find((a) => a.id === x.spark.by.id)?.news), `news comes from outlets and only from outlets (${pct(kinds)} of posts)`)
  ok(made.every((x) => !Object.keys(x.spark).some((k) => ['tier', 'name', 'ticker', 'word', 'runs', 'power', 'decideAt', 'due'].includes(k))), 'a post as a browser gets it carries nothing of its hidden side: not the right name, not whether it runs, not when it settles')
  const share = (t: string) => made.filter((x) => x.sim.tier === t).length / made.length
  ok(share('anon') > share('small') && share('small') > share('mid') && share('mid') > share('big') && share('big') > share('mega') && share('mega') > 0, `small accounts post all day, huge ones rarely (${['anon', 'small', 'mid', 'big', 'mega'].map((t) => `${t} ${pct(share(t))}`).join(', ')})`)
  const runs = (t: string) => avg(made.filter((x) => x.sim.tier === t).map((x) => (x.sim.runs ? 1 : 0)))
  ok(runs('anon') < 0.1 && runs('big') > runs('mid') && runs('mid') > runs('small') && runs('mega') < 0.75, `most posts go nowhere, and a bigger account's are picked up more often (${['anon', 'small', 'mid', 'big', 'mega'].map((t) => `${t} ${pct(runs(t), 0)}`).join(', ')})`)
}

// Real or larp (stage 2): off, no post is a fake; on, some known-looking posts are, and nothing public gives a hacked one away.
{
  ok(made.every((x) => !x.sim.larp && !x.spark.quote && !x.spark.fake), 'without the larp switch no post is a fake')
  const rng = new Rng(13)
  const on: { spark: Spark; sim: SparkSim }[] = []
  for (let i = 0; i < 20000; i++) on.push(makeSpark(fakeMarket, rng, `s${i}`, i, new Set(), undefined, true))
  const known = on.filter((x) => ['big', 'mega'].includes(x.sim.tier))
  const share = (k: string) => known.filter((x) => x.sim.larp === k).length / known.length
  ok(Math.abs(share('fake') - SPARK.larp.fake) < 0.03 && Math.abs(share('shot') - SPARK.larp.shot) < 0.03 && Math.abs(share('hack') - SPARK.larp.hack) < 0.02 && on.every((x) => !x.sim.larp || !['anon', 'small'].includes(x.sim.tier)), `with it on, of the posts that look like a big account's: impersonators ${pct(share('fake'), 0)}, made-up screenshots ${pct(share('shot'), 0)}, hacked ${pct(share('hack'), 0)}; a nobody's post is never one`)
  const fakes = on.filter((x) => x.sim.larp === 'fake')
  ok(fakes.every((x) => !x.spark.by.verified && x.spark.by.handle !== x.sim.real!.handle && x.spark.by.name === x.sim.real!.name && x.spark.by.followers < x.sim.real!.followers && !SPARK_ACCOUNTS.some((a) => a.handle === x.spark.by.handle) && /^[a-z0-9_]{3,24}$/.test(x.spark.by.handle) && !nameBlocked(x.spark.by.handle)), 'an impersonator has the name and the picture, but a handle that is one slip off, no check mark and fewer followers')
  const shots = on.filter((x) => x.sim.larp === 'shot')
  ok(shots.every((x) => !!x.spark.quote && x.spark.quote.handle === x.sim.real!.handle && x.spark.by.followers < 25_000 && x.spark.text.includes(x.sim.real!.name) && (x.spark.text.includes(x.sim.name) || x.spark.text.includes(`#${x.sim.name.replace(/ /g, '')}`))), 'a made-up screenshot comes from a nobody and says which account it claims posted it')
  const hacks = on.filter((x) => x.sim.larp === 'hack')
  ok(hacks.length > 20 && hacks.every((x) => x.spark.by.verified === x.sim.real!.verified && x.spark.by.handle === x.sim.real!.handle && !x.spark.quote), 'a hacked account looks exactly like itself: nothing to read until it comes out')
  ok(on.every((x) => !x.sim.larp || !x.sim.runs) && on.every((x) => !('larp' in x.spark) && !('real' in x.spark) && !x.spark.fake), 'a larp never runs, and the post a browser gets does not say it is one')
}

// Tech coins (stage 3): a tool, a site, a demo that works or does not.
{
  ok(made.every((x) => x.spark.kind !== 'tech' && !x.sim.tool), 'without the tech switch no post announces a tool')
  const rng = new Rng(17)
  const on: { spark: Spark; sim: SparkSim }[] = []
  for (let i = 0; i < 20000; i++) on.push(makeSpark(fakeMarket, rng, `s${i}`, i, new Set(), undefined, false, true))
  const tech = on.filter((x) => x.spark.kind === 'tech')
  const big = on.filter((x) => ['mid', 'big'].includes(x.sim.tier))
  ok(Math.abs(tech.length / big.length - SPARK.tech) < 0.03 && tech.every((x) => !!x.sim.tool && ['mid', 'big'].includes(x.sim.tier) && SPARK_TECH.some((a) => a.id === x.spark.by.id) && x.spark.text.includes(x.sim.name) && TECH_NAMES.includes(x.sim.name) && !/[{}]/.test(x.spark.text)), `with it on, about ${pct(SPARK.tech, 0)} of mid-size and big accounts' posts announce a tool (${pct(tech.length / big.length)}), from a builder, by name`)
  ok([...SPARK_TECH.map((a) => a.handle), ...TECH_NAMES].every((w) => !nameBlocked(w)) && new Set(SPARK_TECH.map((a) => a.handle)).size === SPARK_TECH.length && !SPARK_TECH.some((a) => SPARK_ACCOUNTS.some((b) => b.handle === a.handle)) && TECH_NAMES.every((n) => /^[A-Z][a-z]{3,9}$/.test(n) && !FAMOUS.includes(n.toLowerCase())), 'builders and product names: invented, clean, their own')
  ok(toolAnswer('ticker', 'Mayor Otter') === '$MAYOROTTER' && toolAnswer('convert', '2') !== toolAnswer('convert', '3') && /^10 letters, 3 vowels$/.test(toolAnswer('count', 'hello world!')) && toolAnswer('convert', 'abc') === 'That is not an amount', 'the three tools do what their posts say')
  const tools = Object.keys(TECH_TOOLS) as (keyof typeof TECH_TOOLS)[]
  ok(tools.every((k) => demoAnswer(k, 'works', '3').out !== demoAnswer(k, 'works', 'hello 44').out && demoAnswer(k, 'canned', '3').out === demoAnswer(k, 'canned', 'hello 44').out && demoAnswer(k, 'canned', 'x').status === 'ok' && demoAnswer(k, 'soon', 'x').status === 'soon' && demoAnswer(k, 'dead', 'x').status === 'dead' && demoAnswer(k, undefined, 'x').out === undefined), 'a demo that works answers what was typed; a canned one answers the same whatever is typed; the others answer nothing: two tries tell them apart')
}

// ─── 2. What devs call their coins ───────────────────────────────────────────
{
  const rng = new Rng(21)
  const count: Record<CoinFit, number> = { exact: 0, near: 0, variant: 0, other: 0 }
  let wrongExact = 0, badTicker = 0, crude = 0, blocked = 0, n = 0
  const crudeSeen: string[] = []
  for (const { sim } of made) {
    for (let k = 0; k < 8; k++) {
      const c = coinFor(sim, rng)
      const fit = fitOf(c, sim)
      count[fit]++
      n++
      if ((c.name === sim.name && c.ticker === sim.ticker) !== (fit === 'exact')) wrongExact++
      if (!/^[A-Z0-9]{2,10}$/.test(c.ticker) || !c.name.trim()) badTicker++
      const hit = NEVER_SPELL.find((x) => (c.name.toLowerCase().includes(x) || c.ticker.toLowerCase().includes(x)) && !sim.name.toLowerCase().includes(x) && !sim.word.includes(x))
      if (hit) { crude++; if (crudeSeen.length < 3) crudeSeen.push(`${c.name}/$${c.ticker} (${hit})`) }
      if (nameBlocked(c.name) || nameBlocked(c.ticker)) blocked++
    }
  }
  ok(wrongExact === 0, 'a coin reads as the right one exactly when its name AND its ticker are the post\'s')
  ok(badTicker === 0, `every one of ${n} coins has a name and a ticker a launchpad would take`)
  ok(crude === 0 && blocked === 0, `no name a dev came up with spells anything crude or blocked${crudeSeen.length ? `: ${crudeSeen.join(', ')}` : ''}`)
  ok(Math.abs(count.exact / n - SPARK.names.exact) < 0.02, `about ${pct(SPARK.names.exact, 0)} of devs get the name right (${pct(count.exact / n)}), whatever their place in the rush`)
  ok(count.near / n > 0.1 && count.variant / n > 0.2 && count.other / n > 0.08, `the rest: a slip of the keyboard ${pct(count.near / n, 0)}, their own version ${pct(count.variant / n, 0)}, only the subject ${pct(count.other / n, 0)}`)
  // A slip is never the word, and never crude: every name and subject, many slips each.
  let same = 0, bad = 0
  const badSeen: string[] = []
  for (const w of [...SPARK_NAMES, ...SUBJECTS.map((s) => s.word), ...SPARK_NAMES.map((x) => x.toUpperCase()), ...SUBJECTS.map((s) => s.word.toUpperCase())]) {
    for (let k = 0; k < 300; k++) {
      const t = typo(w, rng)
      if (t === w) same++
      const hit = NEVER_SPELL.find((x) => t.toLowerCase().includes(x) && !w.toLowerCase().includes(x))
      if (hit || nameBlocked(t)) { bad++; if (badSeen.length < 3) badSeen.push(`${w} -> ${t}`) }
    }
  }
  ok(same === 0 && bad === 0, `a slip of the keyboard is never the word itself and never spells something crude (duck, crumpet and nugget are one letter away)${badSeen.length ? `: ${badSeen.join(', ')}` : ''}`)
  const right = { name: 'Waffles', ticker: 'WAFFLES' }
  const read = (name: string, ticker: string) => fitOf({ name, ticker }, right)
  ok(read('Waffles', 'WAFFLES') === 'exact' && read('waffles', 'waffles') === 'exact', 'reading a name: the same letters are the same name (capitals do not matter)')
  ok(read('Waffles', 'WAFLES') === 'near' && read('Wafles', 'WAFLES') === 'near' && read('Wafflse', 'WAFFLES') === 'near', 'a slip in the ticker, or in both, is a near miss, never the right one')
  ok(read('Baby Waffles', 'BABYWAFFLE') === 'variant' && read('Waffles Coin', 'WAFFLESCOI') === 'variant' && read('OG Waffles', 'OGWAFFLES') === 'variant', 'the right name with a word added is somebody\'s own version')
  ok(read('The Hippo', 'HIPPO') === 'other' && read('Pancakes', 'PANCAKES') === 'other', 'a coin that only borrows the subject is neither')
}

// ─── 3. The timeline's choice ────────────────────────────────────────────────
{
  ok(Math.abs(stakeOf(1000, 100) - (1 - (1000 / 1100) ** 2)) < 1e-12 && stakeOf(1000, 0) === 0 && stakeOf(0, 5) === 0 && stakeOf(1000, 1e12) <= 1 && stakeOf(1000, 500) > stakeOf(1000, 100), 'a stake is the share of its price a coin loses when the crowd sells what it holds')
  const c = (stake: number, fit: CoinFit = 'exact', audit = 1): Candidate => ({ stake, fit, audit })
  const w = pickWeights([c(0.1), c(0.2), c(0.4)])
  ok(w[0] < w[1] && w[1] < w[2], 'more of the crowd\'s money in a coin, more chance it is the one')
  const byName = pickWeights([c(0.2, 'exact'), c(0.2, 'near'), c(0.2, 'variant'), c(0.2, 'other')])
  ok(byName[0] > byName[1] && byName[1] > byName[2] && byName[2] > byName[3], 'at equal money the right name beats a near miss, which beats a variant, which beats a coin that only borrows the subject')
  const lvl = (level: Token['riskLevel']) => auditOf({ riskLevel: level })
  const byAudit = pickWeights([c(0.2, 'exact', lvl('LOW')), c(0.2, 'exact', lvl('MEDIUM')), c(0.2, 'exact', lvl('HIGH'))])
  ok(byAudit[0] > byAudit[1] && byAudit[1] > byAudit[2], 'and a clean risk tag beats a middling one, which beats a bad one')
  ok(pickWeights([c(0)])[0] > 0, 'a coin the crowd holds nothing of can still be picked (a post nobody sniped still settles)')

  // The sums, worked out exactly over many made-up posts: what a rule earns when a story runs, as a share of the
  // stake, with no fees. `chance` of each coin is its weight over all the weights; the picked coin gains `gain` times
  // what the others lose, the others lose their stake.
  const rng = new Rng(31)
  type Post = { cands: Candidate[]; low: boolean[] }
  const posts: Post[] = []
  for (let i = 0; i < 20000; i++) {
    const n = rng.int(2, 24)
    const first = rng.range(0.1, 0.7)
    const cands: Candidate[] = []
    const low: boolean[] = []
    for (let k = 0; k < n; k++) {
      const d = devFor(rng)
      const level = computeRisk({ status: 'bonding', liquidity: 10000, mcap: 5000, createdAt: 0, top10Pct: d.top10Pct, devPct: d.devPct, volatility: 0.02, rugProb: 0 } as Token, 1).level
      cands.push({ stake: first * SPARK.blockDecay ** k * rng.range(0.5, 1.5), fit: rng.weighted<CoinFit>(SPARK.names), audit: auditOf({ riskLevel: level }) })
      low.push(level === 'LOW')
    }
    posts.push({ cands, low })
  }
  const earn = (pick: (p: Post) => number, gain: number) => {
    const all: number[] = []
    for (const p of posts) {
      const i = pick(p)
      if (i < 0) continue
      const wts = pickWeights(p.cands)
      const sum = wts.reduce((a, x) => a + x, 0)
      const chance = wts[i] / sum
      const others = p.cands.reduce((a, x, k) => a + (k === i ? 0 : x.stake), 0)
      all.push(chance * gain * others - (1 - chance) * p.cands[i].stake)
    }
    return avg(all)
  }
  const RULES: Record<string, (p: Post) => number> = {
    'the first coin': () => 0,
    'the last coin': (p) => p.cands.length - 1,
    'the coin with the most money in it': (p) => p.cands.reduce((b, x, k) => (x.stake > p.cands[b].stake ? k : b), 0),
    'any coin': (p) => Math.floor(p.cands.length / 2),
  }
  const careful = (p: Post) => p.cands.findIndex((x, k) => x.fit === 'exact' && p.low[k])
  const rightName = (p: Post) => p.cands.findIndex((x) => x.fit === 'exact')
  const wrongName = (p: Post) => p.cands.findIndex((x) => x.fit !== 'exact')
  const keep = { care: SPARK.care, gain: SPARK.gain }
  SPARK.care = 0
  const fair = Object.entries(RULES).map(([k, f]) => [k, earn(f, 1)] as const)
  const fairCareful = earn(careful, 1)
  SPARK.care = keep.care
  ok(fair.every(([, v]) => Math.abs(v) < 0.002) && Math.abs(fairCareful) < 0.002, `with the money alone deciding and nothing held back, every coin is a fair bet: ${fair.map(([k, v]) => `${k} ${pct(v, 2)}`).join(', ')}, the careful pick ${pct(fairCareful, 2)}`)
  const lazy = Object.entries(RULES).map(([k, f]) => [k, earn(f, SPARK.gain)] as const)
  // (The fee on a buy and a sell is 2% at the least. The first coin and the biggest are where the money is: those
  // lose outright. A coin with next to no money in it has next to nothing to lose or win.)
  ok(lazy.every(([, v]) => v < 0.02) && lazy[0][1] < -0.05 && lazy[2][1] < -0.05, `as the game is set, no rule that does not read the post beats the fees when a story runs, and the two with real money in them lose outright: ${lazy.map(([k, v]) => `${k} ${pct(v)}`).join(', ')}`)
  const eCareful = earn(careful, SPARK.gain), eRight = earn(rightName, SPARK.gain), eWrong = earn(wrongName, SPARK.gain)
  ok(eCareful > eRight && eRight > 0 && eWrong < lazy[0][1] + 0.05 && eWrong < 0, `reading pays: the right name with a clean tag ${pct(eCareful)}, the right name ${pct(eRight)}, a wrong name ${pct(eWrong)} (when a story runs, before fees; most posts go nowhere)`)
  ok(eCareful < 0.6, `and not without limit: the careful pick stays under +60% a running story (${pct(eCareful)}); what it makes in the World, fees paid and duds counted, is fair-test's to say`)
  const exactWins = avg(posts.filter((p) => p.cands.some((x) => x.fit === 'exact')).map((p) => { const wts = pickWeights(p.cands); const sum = wts.reduce((a, x) => a + x, 0); return p.cands.reduce((a, x, k) => a + (x.fit === 'exact' ? wts[k] / sum : 0), 0) }))
  ok(exactWins > 0.6 && exactWins < 0.95, `when a right-named coin is among them, the timeline settles on one about ${pct(exactWins, 0)} of the time: usually, never surely`)
  // The risk tag is what the card shows: the three kinds of dev read LOW, MEDIUM, HIGH.
  const tagOf = (kind: 'clean' | 'plain' | 'greedy') => {
    const d = SPARK.devs[kind]
    const tags = new Set<string>()
    for (const dev of d.dev) for (const top of d.top10) tags.add(computeRisk({ status: 'bonding', liquidity: 10000, mcap: 5000, createdAt: 0, top10Pct: top, devPct: dev, volatility: 0.02, rugProb: 0 } as Token, 1).level)
    return [...tags].join('/')
  }
  ok(tagOf('clean') === 'LOW' && tagOf('plain') === 'MEDIUM' && tagOf('greedy') === 'HIGH', `the three kinds of dev read LOW, MEDIUM and HIGH on the risk tag every card shows (${tagOf('clean')}, ${tagOf('plain')}, ${tagOf('greedy')})`)
}

// ─── 4. The engine ───────────────────────────────────────────────────────────
type Run = { m: MarketState; posts: number; storyCoins: number; launches: number; liveMax: number; totalMax: number; keptMax: number; openMax: number; basket: number[]; settle: number[]; winUp: number; winN: number; loseUp: number; loseN: number; overGain: number; hiddenLeak: number; watchedDead: number; orderBad: number; themeMissing: number; watchAfter: number; simMismatch: number; pickedGone: number; beats: number; postsOnFeed: number }
function run(seed: number, ticks: number, dials: Partial<typeof SPARK> = {}): Run {
  const keep = { ...SPARK }
  Object.assign(SPARK, dials)
  let m = createMarket(seed, 1_760_000_000, 'realistic')
  setClock(1)
  const rng = new Rng(m.seed)
  const r: Run = { m, posts: 0, storyCoins: 0, launches: 0, liveMax: 0, totalMax: 0, keptMax: 0, openMax: 0, basket: [], settle: [], winUp: 0, winN: 0, loseUp: 0, loseN: 0, overGain: 0, hiddenLeak: 0, watchedDead: 0, orderBad: 0, themeMissing: 0, watchAfter: 0, simMismatch: 0, pickedGone: 0, beats: 0, postsOnFeed: 0 }
  const seen = new Set(m.tokens.map((t) => t.id))
  const first = new Map<string, number>() // a story coin's price when it was first seen
  let prev = new Map<string, number>()
  const born = new Map<string, number>()
  for (let i = 0; i < ticks; i++) {
    const before = m
    const res = tickMarket(m, rng, { rugMult: 1, protectedIds: new Set(), sparks: true })
    m = res.market
    const posts = tickSocial(m, rng, [], res.events)
    r.postsOnFeed += posts.filter((p) => p.sparkId && p.by && m.sparks?.some((s) => s.id === p.sparkId && s.text === p.text)).length
    const beats = tickStories(m, { before, events: res.events, actions: [], posts, wallets: [] })
    r.beats += beats.filter((b) => /timeline/.test(b.beat.text)).length
    const now = new Map(m.tokens.map((t) => [t.id, t.price]))
    // (Newest first in the market's list: two coins of one post launched in the same second are read in their order.)
    const fresh = m.tokens.filter((t) => !seen.has(t.id)).sort((a, b) => (a.spark?.n ?? 0) - (b.spark?.n ?? 0))
    for (const t of [...fresh, ...m.tokens.filter((t) => seen.has(t.id))]) {
      if (!seen.has(t.id)) {
        seen.add(t.id)
        r.launches++
        if (t.spark) {
          r.storyCoins++
          first.set(t.id, t.price)
          const s = m.sparks?.find((x) => x.id === t.spark!.id)
          if (!s || t.createdAt < s.time) r.orderBad++
          const last = born.get(t.spark.id) ?? 0
          if (t.spark.n !== last + 1) r.orderBad++
          born.set(t.spark.id, t.spark.n)
          if (!t.narrative) r.themeMissing++
        }
      }
      if (t.sim.watch !== undefined) {
        if (t.status !== 'bonding' && t.status !== 'graduated') r.watchedDead++ // (a watched coin is alive: on its curve, or migrated before its story settled)
        if (!t.spark || !m.sparkSim?.[t.spark.id]) r.watchAfter++
      }
    }
    for (const s of m.sparks ?? []) {
      if (Object.keys(s).some((k) => !['id', 'seq', 'tick', 'time', 'kind', 'by', 'text', 'theme', 'picked', 'over'].includes(k))) r.hiddenLeak++
      const open = !s.picked && s.over === undefined
      if (open !== !!m.sparkSim?.[s.id]) r.simMismatch++
      const old = before.sparks?.find((x) => x.id === s.id)
      if (!old) { r.posts++; continue }
      if ((old.picked ?? old.over) !== undefined || (s.picked ?? s.over) === undefined) continue
      // Settled this tick.
      const coins = m.tokens.filter((t) => t.spark?.id === s.id && prev.has(t.id))
      if (s.picked && !m.tokens.some((t) => t.id === s.picked!.tokenId)) r.pickedGone++
      if (coins.length < 2 || !s.picked) continue
      let lost = 0
      let gained = 0
      const moves: number[] = []
      const inSecond: number[] = []
      for (const t of coins) {
        const mv = t.price / prev.get(t.id)! - 1
        inSecond.push(mv)
        moves.push(now.get(t.id)! / (first.get(t.id) ?? prev.get(t.id)!) - 1)
        if (t.id === s.picked.tokenId) { r.winN++; gained = mv; if (mv > -0.02) r.winUp++ } else { r.loseN++; lost += Math.max(0, -mv); if (mv < 0.05) r.loseUp++ }
      }
      // (This second's ordinary trading is in these moves too: a few points either way.)
      if (gained > SPARK.gain * lost * 1.25 + 0.3) r.overGain++
      r.basket.push(avg(moves))
      r.settle.push(avg(inSecond))
    }
    prev = now
    if (i % 5 === 0) {
      r.liveMax = Math.max(r.liveMax, m.tokens.filter((t) => t.sim.flow && t.status === 'bonding').length)
      r.totalMax = Math.max(r.totalMax, m.tokens.length)
      r.keptMax = Math.max(r.keptMax, m.sparks?.length ?? 0)
      r.openMax = Math.max(r.openMax, Object.keys(m.sparkSim ?? {}).length)
    }
  }
  Object.assign(SPARK, keep)
  r.m = m
  return r
}
{
  const ticks = Math.round(hours * 3600)
  const r = run(4242, ticks)
  const rate = sparkRate(FLOW.launchPerSec) * ticks
  // (Posts come by chance: a short run may be off by three times the square root of what is expected.)
  ok(Math.abs(r.posts / rate - 1) < Math.max(0.15, 3.5 / Math.sqrt(rate)), `posts come at the pace the game is set to: ${r.posts} in ${hours} h (${Math.round(rate)} expected)`)
  ok(Math.abs(r.storyCoins / r.launches - SPARK.share) < 0.08, `about ${pct(SPARK.share, 0)} of launches are on a post (${pct(r.storyCoins / r.launches, 0)} of ${r.launches}); the rest is the noise every market has`)
  ok(r.orderBad === 0 && r.themeMissing === 0, `every story coin comes after its post, numbered in the order of launch, with the post's theme${r.orderBad || r.themeMissing ? ` (${r.orderBad} out of order, ${r.themeMissing} with no theme)` : ''}`)
  ok(r.watchedDead === 0 && r.watchAfter === 0, `a coin is watched while its story is open (never written off), and not a second longer${r.watchedDead || r.watchAfter ? ` (${r.watchedDead} written off while watched, ${r.watchAfter} watched with no open story)` : ''}`)
  ok(r.hiddenLeak === 0 && r.simMismatch === 0, 'a post keeps its hidden side while it is open and loses it when it settles; the public post never carries any of it')
  // (The second a story settles has its ordinary trading too: a dev can dump in it. So nearly all, not all.)
  ok(r.winN >= 5 && r.winUp / r.winN > 0.85 && r.loseUp / Math.max(1, r.loseN) > 0.95, `when the timeline settles on a coin among several, that coin does not fall and the others do not jump (${r.winUp} of ${r.winN} picked coins, ${r.loseUp} of ${r.loseN} left behind)`)
  ok(r.overGain === 0 && r.pickedGone === 0, 'the picked coin gains no more than what the others lost allows, and it is a coin that is on the market')
  // (An average over a few dozen posts: chance alone moves it by a point or two, more on a short run.)
  const slack = 1 / Math.sqrt(Math.max(1, r.basket.length))
  ok(avg(r.basket) < 0.01 + 0.15 * slack && avg(r.settle) < 0.005 + 0.04 * slack, `one of each coin on a post: ${pct(avg(r.settle))} in the second it settles, ${pct(avg(r.basket))} from first sight to then, on average over ${r.basket.length} posts (never a gain)`)
  ok(r.beats > 0 && r.postsOnFeed >= r.posts * 0.98, `every post is on the timeline as itself (${r.postsOnFeed} of ${r.posts}), and what the timeline did is on its coins' feeds (${r.beats} lines)`)
  ok(r.liveMax <= FLOW.maxLive + 4 && r.totalMax < 320, `the market stays a steady size: at most ${r.liveMax} coins on a curve, ${r.totalMax} in all`)
  const live = new Set(r.m.tokens.filter((t) => t.spark && (t.status === 'bonding' || t.status === 'graduated')).map((t) => t.spark!.id))
  ok(r.keptMax <= SPARK.max + live.size + 30 && r.openMax < 40, `so does the list of posts: at most ${r.keptMax} kept, ${r.openMax} open at once`)
  ok((r.m.sparks ?? []).every((s) => live.has(s.id) || !!r.m.sparkSim?.[s.id] || r.m.time - s.time < SPARK.kept), 'a post leaves the list once it is old, settled and none of its coins is alive')

  // With nothing held back (the money alone decides, the whole rotation arrives) a basket neither gains nor loses.
  const f = run(99, Math.min(ticks, 5400), { care: 0, gain: 1 })
  ok(Math.abs(avg(f.settle)) < 0.012, `with the money alone deciding and the whole rotation arriving, one of each coin is where it was after the settle: ${pct(avg(f.settle), 2)} over ${f.settle.length} posts`)

  // Switched off: open stories close, their coins fade like any coin, and launches go on.
  let m = r.m
  const rng = new Rng(m.seed)
  const openBefore = Object.keys(m.sparkSim ?? {}).length
  m = tickMarket(m, rng, { rugMult: 1, protectedIds: new Set(), sparks: false }).market
  ok(openBefore > 0 && Object.keys(m.sparkSim ?? {}).length === 0 && m.tokens.every((t) => t.sim.watch === undefined) && (m.sparks ?? []).every((s) => s.picked || s.over !== undefined), `switched off, the ${openBefore} open stories close at once with no coin picked`)
  const n0 = m.tokens.length
  let launched = 0
  const had = new Set(m.tokens.map((t) => t.id))
  for (let i = 0; i < 900; i++) {
    m = tickMarket(m, rng, { rugMult: 1, protectedIds: new Set(), sparks: false }).market
    for (const t of m.tokens) if (!had.has(t.id)) { had.add(t.id); launched++; if (t.spark) launched = -1e9 }
  }
  ok(launched > 300 && n0 > 0, `and the market goes on as it was before the story market: ${launched} launches in the next 15 minutes, none on a post`)
  ok((m.sparks ?? []).length < (r.m.sparks ?? []).length, `the old posts leave the list as their coins die (${(r.m.sparks ?? []).length} then, ${(m.sparks ?? []).length} a quarter of an hour later)`)
}
// A browser's list of posts.
{
  const s = (id: number, time: number, extra: Partial<Spark> = {}): Spark => ({ id: `s${id}`, seq: id, tick: time, time, kind: 'meme', by: { id: 'sx-a', name: 'a', handle: 'a', avatar: 'x', followers: 1, verified: false }, text: 't', ...extra })
  const none: Pick<Token, 'spark' | 'status'>[] = []
  const a = mergeSparks(undefined, [s(1, 100), s(2, 110, { over: 115 })], none, 120)!
  ok(a.map((x) => x.id).join() === 's2,s1', 'a browser keeps the posts it is sent, newest first')
  const b = mergeSparks(a, [s(1, 100, { seq: 9, picked: { tokenId: 'X-1', ticker: 'X', time: 130 } })], none, 131)!
  ok(b.length === 2 && b.find((x) => x.id === 's1')?.picked?.ticker === 'X', 'a post that changed replaces the one it had')
  ok(mergeSparks(b, undefined, none, 133) === b, 'a tick with no news about posts changes nothing')
  const old = mergeSparks(b, [s(3, 5000)], [{ spark: { id: 's1', n: 1 }, status: 'graduated' }], 5000)!
  ok(old.map((x) => x.id).join() === 's3,s1', 'old posts are dropped as the server drops them: settled ones go, one with a coin still alive stays')
  ok(keptSparks([s(2, 110), s(1, 100)], new Set(['s1']), new Set(), 9999).map((x) => x.id).join() === 's1' && mergeSparks([s(7, 100)], undefined, none, 99999)?.length === 1 && sparkLine(s(4, 1)).sparkId === 's4', 'an open post is never dropped, however old')
}

// ─── 5. The wire ─────────────────────────────────────────────────────────────
{
  Room.storyMarket = true
  const world = new Room(WORLD_CODE, true)
  const w = world as unknown as { tick(): void; market: MarketState }
  for (let i = 0; i < 600; i++) w.tick()
  const box: { msgs: ServerMsg[]; raw: string[] } = { msgs: [], raw: [] }
  const ws = { readyState: 1, close() {}, send: (d: string | Buffer) => { box.raw.push(String(d)); box.msgs.push(JSON.parse(String(d))) } }
  world.join(ws as never, { t: 'hello', name: 'Reader', avatar: '👀', level: 1, playerId: 'u-reader', verified: true })
  const welcome = box.msgs.find((x) => x.t === 'welcome') as Extract<ServerMsg, { t: 'welcome' }>
  const HIDDEN = /"sparkSim"|"decideAt"|"runs":|"power":|"due":|"larp":|"demo":"/
  ok(!!welcome && (welcome.market.sparks?.length ?? 0) > 0 && !HIDDEN.test(box.raw.join('')), `joining brings the posts on the timeline (${welcome?.market.sparks?.length}) and nothing of their hidden side`)
  ok(Object.keys(w.market.sparkSim ?? {}).length > 0, '(the server itself has stories open at that moment, so there was something to hide)')
  let mine: Spark[] | undefined = welcome.market.sparks
  let bytes = 0, sparkBytes = 0, sent = 0, twice = 0, leak = 0, feed = 0, differs = 0
  const got = new Set<string>()
  for (let i = 0; i < 600; i++) {
    box.msgs.length = 0
    box.raw.length = 0
    w.tick()
    for (const raw of box.raw) { bytes += raw.length; if (HIDDEN.test(raw)) leak++ }
    for (const msg of box.msgs) {
      if (msg.t !== 'tick') continue
      const list = msg.market.sparks
      feed += msg.posts.filter((p) => p.sparkId && p.by).length
      if (list) {
        sparkBytes += JSON.stringify(list).length
        for (const s of list) { sent++; const key = `${s.id}:${s.seq}`; if (got.has(key)) twice++; got.add(key) }
      }
      mine = mergeSparks(mine, list, w.market.tokens, w.market.time)
    }
    if (i % 20 === 19 && JSON.stringify((mine ?? []).map((s) => [s.id, s.seq])) !== JSON.stringify((w.market.sparks ?? []).map((s) => [s.id, s.seq]))) differs++
  }
  ok(leak === 0, 'ten minutes of ticks: not one message carries a post\'s hidden side')
  ok(sent > 20 && twice === 0, `a post goes out when it is new and when it changes, never again (${sent} sent)`)
  ok(differs === 0, 'the list a browser builds from them is the server\'s own list, post for post')
  ok(feed > 10, `the posts reach the trackers with who made them (${feed} in ten minutes)`)
  ok(sparkBytes / bytes < 0.03, `the story market is ${pct(sparkBytes / bytes, 2)} of what a player is sent`)
  Room.storyMarket = false
  for (let i = 0; i < 3; i++) w.tick()
  ok(Object.keys(w.market.sparkSim ?? {}).length === 0, 'the owner\'s switch turned off reaches the World on its next tick')
  world.dispose()
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed')
process.exit(0)
