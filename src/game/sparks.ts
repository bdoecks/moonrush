// The story market: posts that coins get launched on.
//
// A "spark" is a post or a news item on the timeline (invented accounts, invented stories: see data/sparkPosts.ts).
// Within seconds devs launch coins on it: some with the post's exact name and ticker, some misspelled, some "their
// own version", some that only borrow the subject. A little later the timeline either settles on ONE of those coins
// or drops the story. That is the game: read the post, find the real coin, be in before the timeline settles.
//
// What is fair about it (the same promise the rest of the simulated market makes, see TOPS in marketEngine.ts):
//  - When the timeline settles, the crowd leaves the other coins for the one it picked. A coin that is not picked
//    loses the share of its price that was the crowd's money (its `stake`); the picked one gains, as a share of its
//    price, `gain` times what all the others lost together, and never more money than came out of them.
//  - A coin's chance of being picked is its stake, as a share of all the stakes on the post. With `gain` at 1 that
//    makes every coin a fair bet on its own: chance × gain = (1 − chance) × loss, whatever its size and however
//    many coins there are. With `gain` under 1 (as shipped) every such bet loses a little: some of the crowd just
//    leaves. The snipers in a coin's launch block load the EARLY coins on a post, whatever they are called, so the
//    first coin is the likeliest and has the most to lose. Buying the first coin, the biggest, any, or all of them
//    is a losing rule.
//  - What is NOT in the price is what takes reading: is the name spelled as in the post, does the coin's risk tag
//    read clean. `care` is how far the timeline's choice leans on that, beyond the money: at 0 reading earns
//    nothing, and every point above it is paid by whoever bought the misspelled coin or the greedy dev's.
//  - What devs call their coins, and what kind of dev they are, does not depend on their place in the rush. If the
//    first coin were the likeliest to be spelled right, "buy the first coin" would be reading without having read.
//  - Most posts go nowhere (the bigger the account, the fewer), and nothing a browser is sent says which will run or
//    which coin will win: that is `SparkSim`, which stays on the server (scripts/spark-test.ts, scale-test).
// `scripts/spark-test.ts` works the sums out; `scripts/post-test.ts` is what the rules earn in the World with real
// orders. Read both before and after touching a dial.
//
// Pure, and a leaf: the market engine imports this file, so nothing here may import the market engine.
import { anonAccount, NEVER_SPELL, SPARK_ACCOUNTS, SPARK_NAMES, SPARK_TEXT, SPARK_TITLES, SUBJECTS, TYPE_THEME, VARIANT_POST, VARIANT_PRE, type SparkAccount } from '../data/sparkPosts'
import { SAFE_THEMES } from '../data/themeWords'
import type { MarketState, RiskLevel, Spark, SparkBy, SparkLarp, SparkSim, SparkTier, Token } from '../types'
import { clamp, type Rng } from '../utils/rng'
import { isStale } from './dataSources'

/** The kind of dev behind a coin launched on a post. */
export type SparkDev = 'clean' | 'plain' | 'greedy'

/** Everything about the story market that is a matter of tuning. */
export const SPARK = {
  share: 0.8, // of all launches: the ones that come from a post (the rest are the noise every market has)
  // Per account size: how often it is the one posting (`w`), how many coins devs launch on its post, the chance the
  // timeline picks the story up, the snipers' money on the FIRST coin ($), the pull the picked coin has on the crowd
  // afterwards, the attention a coin on the post has while the story is open, and the seconds between launches.
  tiers: {
    anon: { w: 0.5, coins: [1, 3], runs: 0.05, block: 180, q: 0.5, watch: 0.1, gap: 7 },
    small: { w: 0.3, coins: [2, 6], runs: 0.1, block: 350, q: 0.8, watch: 0.18, gap: 5 },
    mid: { w: 0.14, coins: [5, 12], runs: 0.2, block: 800, q: 1.1, watch: 0.3, gap: 3.5 },
    big: { w: 0.05, coins: [10, 24], runs: 0.35, block: 1800, q: 1.6, watch: 0.5, gap: 2.2 },
    mega: { w: 0.006, coins: [22, 45], runs: 0.45, block: 3000, q: 2.4, watch: 0.8, gap: 1.3 },
  } as Record<SparkTier, { w: number; coins: [number, number]; runs: number; block: number; q: number; watch: number; gap: number }>,
  titled: 0.22, // the share of meme posts whose right name is a title and the subject ("Mayor Otter", #MayorOtter)
  trend: 0.5, // the share of posts about a theme that is hot outside the game (while that list is fresh)
  meta: 3, // subjects of the game's own hot narrative are this many times likelier
  first: [1, 4] as [number, number], // seconds from the post to the first coin on it
  decide: { median: 45, sigma: 0.45, min: 18, max: 150 }, // seconds from the post until the timeline settles (or moves on): time to read it
  blockDecay: 0.7, // the snipers' money on each later coin of a post, as a share of the one before
  blockSigma: 0.4,
  watchDecay: 0.8, // the same for the attention a later coin gets while the story is open…
  watchMin: 0.35, // …down to this share of the first coin's
  preQ: 0.25, // a coin's pull on the crowd while its story is open (it is watched, not believed in yet)
  // Who launches on a post: three kinds of dev, how many of each, and what their coin's audit shows (the dev's own
  // bag, the top ten holders, insiders: % of the supply). The ranges are set so the risk tag every card carries
  // (computeRisk in marketEngine.ts) reads LOW for the first kind, MEDIUM for the second, HIGH for the third while
  // that dev still holds the bag; scripts/spark-test.ts checks it. A greedy dev's bag is real: it gets dumped.
  devs: {
    clean: { w: 0.3, dev: [0, 2.5], top10: [12, 22], insiders: [0, 5] },
    plain: { w: 0.45, dev: [3, 8], top10: [25, 45], insiders: [0, 10] },
    greedy: { w: 0.25, dev: [17, 22], top10: [70, 80], insiders: [15, 30] },
  } as Record<SparkDev, { w: number; dev: [number, number]; top10: [number, number]; insiders: [number, number] }>,
  // What devs call their coins: the name as the post has it, a slip of the keyboard, "their own" version, or only
  // the subject. The same odds for every coin on a post, the first as the last (see the note at the top).
  names: { exact: 0.3, near: 0.2, variant: 0.35, other: 0.15 },
  // The timeline's choice. A coin's weight is its stake (the share of its price that is the crowd's money) times
  // what the coin IS, to the power `care`: its name against the post's, and how clean its audit reads.
  fit: { exact: 1, near: 0.22, variant: 0.12, other: 0.04 },
  audit: { LOW: 1, MEDIUM: 0.5, HIGH: 0.2, EXTREME: 0.1 } as Record<RiskLevel, number>,
  care: 2, // 0 = the money alone decides (reading earns nothing); 2 = a clean coin with the right name beats the rest three times in four
  floor: 0.0001, // a coin the crowd holds nothing of still has this much say (so a post nobody sniped still settles)
  // The move itself. The crowd sells `dump` of what it holds in every other coin. The picked coin gains, as a share of
  // its price, `gain` times the sum of the shares the others lost (1 = every coin was a fair bet, see the top), and
  // never more money goes in than `keep` times what came out of the others.
  dump: 0.9,
  gain: 0.7,
  keep: 1,
  // Real or larp (stage 2, its own switch). Of the posts that look like a known account's: the share that come from an
  // impersonator (the handle one slip off, no check mark, fewer followers), that are a nobody's "screenshot" of a
  // post the account never made, and that are a hacked account's (nothing to see until it comes out). `mid`: the
  // same for mid-size accounts, as a share of that. A larp never runs: when it comes out the crowd leaves every
  // coin on it. `fakeBlock` / `shotBlock`: the snipers' money on them, next to the real thing (bots get fooled too).
  larp: { fake: 0.14, shot: 0.1, hack: 0.04, mid: 0.5, fakeBlock: 0.6, shotBlock: 0.45, followers: [0.03, 0.25] as [number, number] },
  kept: 600, // seconds a post stays on the list after its last coin has gone
  max: 90, // posts kept at the most (the ones with a live coin are never dropped)
}

const TIERS = Object.keys(SPARK.tiers) as SparkTier[]
const SMALL_OUTLETS = 0.25 // the share of small accounts' posts that come from a local paper (news)
/** The average number of coins launched on a post. */
export const meanCoins = () => TIERS.reduce((a, k) => a + SPARK.tiers[k].w * ((SPARK.tiers[k].coins[0] + SPARK.tiers[k].coins[1]) / 2), 0) / TIERS.reduce((a, k) => a + SPARK.tiers[k].w, 0)
/** Posts a second, so that `SPARK.share` of the market's launches (`launchPerSec`) come from a post. */
export const sparkRate = (launchPerSec: number) => (launchPerSec * SPARK.share) / meanCoins()

const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1)
/** A name as a ticker: its letters and digits, upper case, ten at the most (what the launchpads allow). */
export const tickerOf = (name: string) => name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10)
const lognormal = (rng: Rng, median: number, sigma: number) => median * Math.exp(sigma * rng.gauss())
const byOf = (a: SparkAccount): SparkBy => ({ id: a.id, name: a.name, handle: a.handle, avatar: a.avatar, followers: a.followers, verified: a.verified })

/**
 * A new post. `taken` = the right names of the stories still open (two posts about a Waffles at once would be two
 * right coins with one name). Returns the public spark and its hidden side.
 */
export function makeSpark(m: Pick<MarketState, 'tick' | 'time' | 'meta' | 'trends'>, rng: Rng, id: string, seq: number, taken: Set<string> = new Set(), nowMs = Date.now(), larps = false): { spark: Spark; sim: SparkSim } {
  const tier = rng.weighted<SparkTier>(Object.fromEntries(TIERS.map((k) => [k, SPARK.tiers[k].w])) as Record<SparkTier, number>)
  const named = SPARK_ACCOUNTS.filter((a) => a.tier === tier)
  // (A small account is a nobody, or now and then a local paper; the smallest are always nobodies.)
  const account = named.length && (tier !== 'small' || rng.chance(SMALL_OUTLETS)) ? rng.pick(named) : anonAccount(() => rng.next(), tier === 'small' ? 'small' : 'anon')
  const kind: Spark['kind'] = account.news ? 'news' : 'meme'

  // What it is about: a theme that is hot outside the game (while that list is fresh), the game's own meta, or anything.
  const fresh = m.trends && !isStale(m.trends, nowMs) ? m.trends : undefined
  const hot = new Map((fresh?.themes ?? []).map((x) => [x.word, x.weight]))
  const onTrend = hot.size > 0 && rng.chance(SPARK.trend)
  const pool = onTrend ? SUBJECTS.filter((s) => hot.has(s.word)) : SUBJECTS
  const subjects = pool.length ? pool : SUBJECTS
  let roll = rng.next() * subjects.reduce((a, s) => a + weightOf(s.word, hot, m.meta, onTrend), 0)
  const subject = subjects.find((s) => (roll -= weightOf(s.word, hot, m.meta, onTrend)) <= 0) ?? subjects[0]

  // Its name: a plain one ("Waffles"), or for some memes a title and the subject ("Mayor Otter").
  let name = ''
  let titled = false
  for (let k = 0; k < 12 && (!name || taken.has(tickerOf(name))); k++) {
    titled = kind === 'meme' && rng.chance(SPARK.titled)
    name = titled ? `${rng.pick(SPARK_TITLES)} ${cap(subject.word)}` : rng.pick(SPARK_NAMES)
    if (titled && name.replace(/[^A-Za-z]/g, '').length > 10) name = '' // (its ticker has to fit)
  }
  if (!name) {
    name = rng.pick(SPARK_NAMES)
    titled = false
  }
  const ticker = tickerOf(name)

  const T = SPARK_TEXT
  const line = titled ? rng.pick(T.MEME_TITLED) : rng.pick((kind === 'news' ? T.NEWS : T.MEME)[subject.type])
  const text = line.replaceAll('{N}', name).replaceAll('{A}', subject.word).replaceAll('{V}', rng.pick(T.DID[subject.type])).replaceAll('{D}', String(rng.int(2, 40)))
    .replaceAll('{H}', name.replace(/[^A-Za-z0-9]/g, '')).replaceAll('{P}', rng.pick(T.PLACES)).replaceAll('{J}', rng.pick(T.JOBS))
    .replace(/\b([aA]) (?=[aeioAEIO])/g, '$1n ') // "a owl" → "an owl" (not before a u: a ufo, a unicorn)

  // Real or larp? (Only asked with that switch on, so the dice roll as before without it.)
  let larp: SparkLarp | undefined
  let by = byOf(account)
  let said = text
  let quote: Spark['quote']
  if (larps && named.includes(account) && (tier === 'mid' || tier === 'big' || tier === 'mega')) {
    const L = SPARK.larp
    const k = tier === 'mid' ? L.mid : 1
    const r = rng.next()
    larp = r < L.fake * k ? 'fake' : r < (L.fake + L.shot) * k ? 'shot' : r < (L.fake + L.shot + L.hack) * k ? 'hack' : undefined
    if (larp === 'fake') {
      let handle = account.handle
      // (Never a slip that doubles a letter: next to the letters already there that can spell a slur, "midnigght".)
      const doubled = (h: string) => [...h].some((c, i) => i > 0 && c === h[i - 1] && !account.handle.includes(c + c))
      for (let i = 0; i < 12 && (handle === account.handle || doubled(handle) || SPARK_ACCOUNTS.some((a) => a.handle === handle)); i++) handle = typo(account.handle, rng).toLowerCase().replace(/[^a-z0-9_]/g, '')
      if (doubled(handle)) handle = account.handle
      if (handle === account.handle) handle = `${account.handle}_`
      by = { ...by, id: `sx-${handle}`, handle, verified: false, followers: Math.round(account.followers * rng.range(...L.followers)) }
    } else if (larp === 'shot') {
      by = byOf(anonAccount(() => rng.next(), 'small'))
      quote = { name: account.name, handle: account.handle, verified: account.verified }
      said = `${rng.pick(SHOT_LEAD).replace('{W}', account.name)} "${text}"`
    }
  }
  const t = SPARK.tiers[tier]
  const d = SPARK.decide
  const decideAt = m.time + Math.round(clamp(lognormal(rng, d.median, d.sigma), d.min, d.max))
  // When the coins come: the first within seconds, the rest in a rush that thins out, none after the timeline has settled.
  const due: number[] = []
  let at = m.time + rng.int(...SPARK.first)
  for (let k = rng.int(...t.coins); k > 0 && at < decideAt - 2; k--) {
    due.push(at)
    at += Math.max(1, Math.round(-Math.log(1 - rng.next()) * t.gap))
  }
  const spark: Spark = { id, seq, tick: m.tick, time: m.time, kind, by, text: said, theme: SAFE_THEMES.get(subject.word) ?? TYPE_THEME[subject.type], ...(quote ? { quote } : {}) }
  const runs = rng.chance(t.runs)
  const sim: SparkSim = { tier, name, ticker, word: subject.word, emoji: subject.emoji, runs: runs && !larp, power: Math.exp(0.4 * rng.gauss()), decideAt, due, n: 0, ...(larp ? { larp, real: byOf(account) } : {}) }
  return { spark, sim }
}
/** How a nobody presents a "screenshot" of a known account's post. */
const SHOT_LEAD = ['screenshot before it gets deleted. {W} just posted:', 'did {W} really just post this??', 'no way {W} posted this:', '{W} posted and deleted this in ten seconds:']
const weightOf = (word: string, hot: Map<string, number>, meta: MarketState['meta'], onTrend: boolean) => (onTrend ? 0.2 + (hot.get(word) ?? 0) : 1) * (meta && SAFE_THEMES.get(word) === meta ? SPARK.meta : 1)

// ─── What devs call their coins ──────────────────────────────────────────────
/** How a coin's name stands to the post's: the right one, a near miss, somebody's own version of it, or neither. */
export type CoinFit = 'exact' | 'near' | 'variant' | 'other'

/** Does `out` spell something it must not, that the word it came from does not? (See NEVER_SPELL.) */
const spellsBad = (out: string, from: string) => {
  const o = out.toLowerCase(), f = from.toLowerCase()
  return NEVER_SPELL.some((x) => o.includes(x) && !f.includes(x))
}
/**
 * One slip of the keyboard: a letter dropped, doubled, swapped with its neighbour, or a wrong vowel. Never the word
 * itself, and never a slip that spells something crude (those are thrown away and another is tried).
 */
export function typo(word: string, rng: Rng): string {
  const w = word
  const last = w[w.length - 1] ?? 'x'
  if (w.length >= 3) {
    for (let k = 0; k < 12; k++) {
      const i = rng.int(1, w.length - 1) // (the first letter is the one people get right)
      const kind = rng.int(0, 3)
      const out =
        kind === 0 ? w.slice(0, i) + w.slice(i + 1)
        : kind === 1 ? w.slice(0, i) + w[i] + w.slice(i)
        : kind === 2 && i < w.length - 1 ? w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2)
        : w.slice(0, i) + swapVowel(w[i], rng) + w.slice(i + 1)
      if (out !== w && out.length >= 2 && !spellsBad(out, w)) return out
    }
  }
  // (Nothing clean came up, or the word is too short to slip in: its last letter twice, or an x on the end.)
  return spellsBad(w + last, w) ? w + 'x' : w + last
}
const VOWELS = 'aeiou'
function swapVowel(ch: string, rng: Rng) {
  const lower = ch.toLowerCase()
  if (!VOWELS.includes(lower)) return ch + ch // (not a vowel: double it instead)
  const other = rng.pick([...VOWELS].filter((v) => v !== lower))
  return ch === lower ? other : other.toUpperCase()
}

/** What a dev who launches on a post calls their coin. Never a name that spells something it must not (see NEVER_SPELL). */
export function coinFor(sim: Pick<SparkSim, 'name' | 'ticker' | 'word' | 'emoji'>, rng: Rng): { name: string; ticker: string; emoji: string } {
  const c = nameFor(sim, rng)
  // (A word put before or after a name can spell something across the join, in the ticker above all: "MINI" + "GUMBO".
  // Such a coin is called after the subject instead, and every subject is an approved word.)
  const from = `${sim.name} ${sim.word}`
  return spellsBad(c.name, from) || spellsBad(c.ticker, from) ? { name: `The ${cap(sim.word)}`, ticker: tickerOf(sim.word), emoji: sim.emoji } : c
}
function nameFor(sim: Pick<SparkSim, 'name' | 'ticker' | 'word' | 'emoji'>, rng: Rng): { name: string; ticker: string; emoji: string } {
  const fit = rng.weighted<CoinFit>(SPARK.names)
  const emoji = sim.emoji
  if (fit === 'exact') return { name: sim.name, ticker: sim.ticker, emoji }
  if (fit === 'near') {
    // One slip of the keyboard: in the name and so in its ticker, or in the ticker alone (the name copied right).
    const words = sim.name.split(' ')
    const slipped = [...words.slice(0, -1), cap(typo(words[words.length - 1].toLowerCase(), rng))].join(' ')
    const both = rng.chance(0.5)
    const ticker = tickerOf(both ? slipped : typo(sim.ticker, rng))
    // (A slip lost to the ten-letter limit: a letter dropped instead.)
    return { name: both ? slipped : sim.name, ticker: ticker === sim.ticker ? sim.ticker.slice(0, -2) + sim.ticker.slice(-1) : ticker, emoji }
  }
  if (fit === 'variant') {
    // "Their own" version: a word before or after. (Only ones whose ticker still fits in ten letters.)
    const pre = VARIANT_PRE.filter((p) => p.length + sim.ticker.length <= 10)
    const post = VARIANT_POST.filter((p) => p.length + sim.ticker.length <= 10)
    if (pre.length && (rng.chance(0.5) || !post.length)) {
      const p = rng.pick(pre)
      return { name: `${p === 'OG' ? 'OG' : cap(p.toLowerCase())} ${sim.name}`, ticker: p + sim.ticker, emoji }
    }
    if (post.length) {
      const p = rng.pick(post)
      const tail = p.length > 3 || p === 'INU' || p === 'FAN' ? cap(p.toLowerCase()) : p // ("Coin", "Inu", "Club"; "AI", "CTO", "DAO" as they are)
      return { name: `${sim.name} ${tail}`, ticker: sim.ticker + p, emoji }
    }
  }
  // Named after what the post is about, not after who: "The Hippo".
  const w = cap(sim.word)
  if (rng.chance(0.5)) return { name: `The ${w}`, ticker: tickerOf(w), emoji }
  const pre = rng.pick(['Baby', 'Based', 'Mega', 'Smol'])
  return { name: `${pre} ${w}`, ticker: tickerOf(pre[0] + w), emoji }
}

/** The dev behind the next coin on a post: what kind, and what their coin's audit will show. */
export function devFor(rng: Rng): { kind: SparkDev; devPct: number; top10Pct: number; insidersPct: number } {
  const kind = rng.weighted<SparkDev>({ clean: SPARK.devs.clean.w, plain: SPARK.devs.plain.w, greedy: SPARK.devs.greedy.w })
  const d = SPARK.devs[kind]
  return { kind, devPct: rng.range(...d.dev), top10Pct: rng.range(...d.top10), insidersPct: rng.range(...d.insiders) }
}

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')
/** How many slips of the keyboard lie between two short words: a letter added, dropped or changed, or two neighbours swapped. */
function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 3) return 4
  const rows: number[][] = [Array.from({ length: b.length + 1 }, (_, j) => j)]
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(rows[i - 1][j] + 1, cur[j - 1] + 1, rows[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) cur[j] = Math.min(cur[j], rows[i - 2][j - 2] + 1)
    }
    rows.push(cur)
  }
  return rows[a.length][b.length]
}

/** How a coin's name and ticker stand to the post's. Worked out from the strings alone, so a player's own launch is read the same way. */
export function fitOf(coin: Pick<Token, 'name' | 'ticker'>, sim: Pick<SparkSim, 'name' | 'ticker'>): CoinFit {
  const T = norm(coin.ticker), N = norm(coin.name), RT = norm(sim.ticker), RN = norm(sim.name)
  if (T === RT && N === RN) return 'exact'
  if (T === RT || N === RN) return 'near' // one of the two is right
  if (T.includes(RT) || N.includes(RN)) return 'variant' // the right name with something added
  const slips = Math.min(editDistance(T, RT), editDistance(N, RN))
  return slips <= (RT.length >= 7 ? 2 : 1) ? 'near' : 'other'
}

/**
 * How clean a coin's audit reads: its risk tag, the one on every card and coin page (LOW is clean). It is what the
 * game shows, as the game shows it, so what a player reads is exactly what counts here.
 */
export const auditOf = (t: Pick<Token, 'riskLevel'>) => SPARK.audit[t.riskLevel]

export interface Candidate {
  fit: CoinFit
  audit: number // see auditOf: 1 = clean
  stake: number // the share of its price the coin loses if the crowd leaves it, 0..1 (see stakeOf)
}
/**
 * The share of its price a coin loses when `sold` more of its coins come back to its curve, which holds `inCurve`
 * of them now (a curve's price goes with one over the square of the coins in it).
 */
export const stakeOf = (inCurve: number, sold: number) => (inCurve > 0 && sold > 0 ? 1 - (inCurve / (inCurve + sold)) ** 2 : 0)
/** Each coin's weight in the timeline's choice: its stake, times what it is to the power `care`. */
export const pickWeights = (cands: Candidate[]): number[] => cands.map((c) => (clamp(c.stake, 0, 1) + SPARK.floor) * (SPARK.fit[c.fit] * clamp(c.audit, 0.05, 1)) ** SPARK.care)
/** The coin the timeline settles on (its place in `cands`), or -1 when there is none. */
export function pickCoin(cands: Candidate[], rng: Rng): number {
  if (!cands.length) return -1
  const w = pickWeights(cands)
  let roll = rng.next() * w.reduce((a, x) => a + x, 0)
  const i = w.findIndex((x) => (roll -= x) <= 0)
  return i < 0 ? w.length - 1 : i
}

/** The snipers' money ($) on the `n`-th coin of a post: they load the early ones, whatever those are called. */
export const blockUsd = (tier: SparkTier, n: number, rng: Rng, larp?: SparkLarp) => (larp === 'fake' ? SPARK.larp.fakeBlock : larp === 'shot' ? SPARK.larp.shotBlock : 1) * SPARK.tiers[tier].block * SPARK.blockDecay ** (n - 1) * Math.exp(SPARK.blockSigma * rng.gauss() - (SPARK.blockSigma * SPARK.blockSigma) / 2)
/** The attention the `n`-th coin of a post has for as long as the story is open. */
export const watchOf = (tier: SparkTier, n: number) => SPARK.tiers[tier].watch * Math.max(SPARK.watchMin, SPARK.watchDecay ** (n - 1))

/** The post as it stands on the timeline, for the tracker (a `SocialPost` without the bookkeeping). */
export const sparkLine = (s: Spark) => ({ accountId: s.by.id, by: s.by, sparkId: s.id, text: s.text, isCall: false })

/**
 * Which posts are worth keeping: the recent ones, the ones still open, and any with a coin that is still alive.
 * Returns the list to keep (newest first), no longer than `SPARK.max` unless live coins need more.
 */
export function keptSparks(sparks: Spark[], open: Set<string>, liveCoinOf: Set<string>, now: number): Spark[] {
  const must = (s: Spark) => open.has(s.id) || liveCoinOf.has(s.id)
  const out = sparks.filter((s) => must(s) || now - s.time < SPARK.kept)
  if (out.length <= SPARK.max) return out
  let extra = out.length - SPARK.max
  // (Too many: the oldest that nothing holds on to go first.)
  return [...out].reverse().filter((s) => must(s) || extra-- <= 0).reverse()
}

/**
 * A browser's list of posts with what a tick brought (new posts, and ones that changed: a coin was picked, the
 * timeline moved on), newest first, and thinned the way the server thins its own.
 */
export function mergeSparks(have: Spark[] | undefined, got: Spark[] | undefined, tokens: Pick<Token, 'spark' | 'status'>[], now: number): Spark[] | undefined {
  if (!got?.length && !have?.length) return have
  const byId = new Map((have ?? []).map((x) => [x.id, x]))
  for (const x of got ?? []) byId.set(x.id, x)
  const all = [...byId.values()].sort((a, b) => b.time - a.time || Number(b.id.slice(1)) - Number(a.id.slice(1)))
  const alive = new Set<string>()
  for (const t of tokens) if (t.spark && (t.status === 'bonding' || t.status === 'graduated')) alive.add(t.spark.id)
  const out = keptSparks(all, new Set(all.filter((x) => !x.picked && x.over === undefined).map((x) => x.id)), alive, now)
  // (Nothing new and nothing dropped: the list it had, so nothing that shows it is drawn again.)
  return !got?.length && have && out.length === have.length ? have : out
}
