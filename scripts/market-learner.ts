// Market learner: studies what the market recorder saved (real pump.fun trades) and writes a "brain" the game's bots
// can play from. It learns how real people trade, never who they are: the brain holds only odds and ranges per style
// and skill level, no wallet ids.
//
//   npx tsx scripts/market-learner.ts          # learn from every session in bot-data/sessions
//
// Writes bot-data/brain.json (for the bots) and bot-data/brain-summary.md (for people).
//
// How it learns:
//   1. Replays each coin's trades in order, so every trade knows its situation: the coin's age, market cap, how fast
//      it was moving in the last minute, how busy it was, and whether its dev had already sold.
//   2. Follows every wallet's bags coin by coin: what it paid, what it got back, how long it held, how it exited.
//   3. Ranks wallets with enough activity by return into five skill levels, and sorts them into styles by habit.
//   4. For each style and level, counts in which situations they bought (compared with how common each situation
//      is), how much, and how they sold. Separately it measures dumps: dev sells, big sells that crash a coin, and
//      sells piling onto the same coin at once.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { SAFE_THEMES, themeOf } from '../server/trendThemes'
import { nameBlocked } from '../server/moderation'

const ROOT = resolve(import.meta.dirname, '..')
const DATA = join(ROOT, 'bot-data')
const SESSIONS = join(DATA, 'sessions')

interface Trade { k: 'trade'; t: number; slot: number; mint: string; buy: boolean; sol: number; tok: number; mcapSol: number; w: string; dev: boolean; creator: string; watched?: string }
interface Create { k: 'create'; t: number; mint: string; creator: string; name?: string; symbol?: string }
interface Complete { k: 'complete'; t: number; mint: string }
type Row = Trade | Create | Complete

// ---------- situations ----------
// Buckets are coarse on purpose: the game's market is not the real one, so bots match "kind of moment", not numbers.

export const AGE = [30, 120, 600, 1800, Infinity] as const // seconds since launch
export const MCAP = [35, 60, 120, 300, Infinity] as const // market cap in SOL (pump.fun starts near 28)
export const MOVE = [-0.25, -0.05, 0.05, 0.25, Infinity] as const // market-cap change over the last minute
export const AGE_LABEL = ['under 30s', '30s-2m', '2-10m', '10-30m', 'over 30m']
export const MCAP_LABEL = ['under 35 SOL', '35-60', '60-120', '120-300', 'over 300 SOL']
export const MOVE_LABEL = ['dumping hard', 'dipping', 'flat', 'pumping', 'pumping hard']
const bucket = (v: number, edges: readonly number[]) => edges.findIndex((e) => v < e)
const sitKey = (age: number, mcap: number, move: number) => `${bucket(age, AGE)}${bucket(mcap, MCAP)}${bucket(move, MOVE)}`

const quant = (xs: number[], ps = [0.1, 0.25, 0.5, 0.75, 0.9]) => {
  if (!xs.length) return ps.map(() => 0)
  const s = [...xs].sort((a, b) => a - b)
  return ps.map((p) => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))])
}
const r3 = (x: number) => Math.round(x * 1000) / 1000

// ---------- load ----------

function load(): Row[] {
  if (!existsSync(SESSIONS)) return []
  const rows: Row[] = []
  for (const f of readdirSync(SESSIONS).filter((n) => n.endsWith('.jsonl')).sort()) {
    for (const line of readFileSync(join(SESSIONS, f), 'utf8').split('\n')) {
      if (!line) continue
      try { rows.push(JSON.parse(line)) } catch { /* a line cut off when a session stopped */ }
    }
  }
  return rows
}

// ---------- replay ----------

interface Moment { t: number; age: number; mcap: number; move: number; busy: number; devSold: boolean; ageKnown: boolean }
interface Bag { first: number; firstAge: number; spent: number; got: number; bought: number; sold: number; lastT: number; sells: { t: number; frac: number; x: number }[]; entryKeys: string[]; sizes: number[] }
interface WalletStats { bags: Map<string, Bag>; trades: number; devSells: number; bigSells: number }

function learn(rows: Row[]) {
  const launched = new Map<string, number>()
  const graduated = new Set<string>()
  for (const r of rows) {
    if (r.k === 'create') launched.set(r.mint, r.t)
    if (r.k === 'complete') graduated.add(r.mint)
  }
  const trades = (rows.filter((r) => r.k === 'trade') as Trade[]).sort((a, b) => a.slot - b.slot || a.t - b.t)
  const byCoin = new Map<string, Trade[]>()
  for (const t of trades) { if (!byCoin.has(t.mint)) byCoin.set(t.mint, []); byCoin.get(t.mint)!.push(t) }

  const wallets = new Map<string, WalletStats>()
  const exposure = new Map<string, number>() // how often each situation came up (every trade is a moment someone could have bought)
  const lastPrice = new Map<string, number>() // SOL per token, for valuing bags still held at the end
  const dumps = { devSells: 0, devSellSol: [] as number[], devSellAfter: [] as number[], devSellImpact: [] as number[], bigSells: 0, bigSellImpact: [] as number[], cascades: 0, rugs: 0, coinsWithDevSell: new Set<string>() }
  let coinsSeen = 0

  for (const [mint, list] of byCoin) {
    coinsSeen++
    const born = launched.get(mint)
    const recent: Trade[] = []
    let devSold = false
    let peak = 0
    let rugged = false
    const sellTimes: number[] = []
    for (let i = 0; i < list.length; i++) {
      const tr = list[i]
      while (recent.length && tr.t - recent[0].t > 60) recent.shift()
      const prevMcap = i ? list[i - 1].mcapSol : tr.mcapSol
      const minuteAgo = recent.length ? recent[0].mcapSol : prevMcap
      const m: Moment = { t: tr.t, age: born !== undefined ? tr.t - born : tr.t - list[0].t, mcap: prevMcap, move: minuteAgo > 0 ? prevMcap / minuteAgo - 1 : 0, busy: recent.length, devSold, ageKnown: born !== undefined }
      // A coin that launched before recording started has an unknown age, so its moments can't teach when people buy.
      const key = m.ageKnown ? sitKey(m.age, m.mcap, m.move) : ''
      if (key) exposure.set(key, (exposure.get(key) ?? 0) + 1)
      const impact = prevMcap > 0 ? tr.mcapSol / prevMcap - 1 : 0

      // Dumps: the dev selling, or one sell knocking 15%+ off the market cap; several within 10s is a cascade.
      if (!tr.buy) {
        if (tr.dev) {
          dumps.devSells++
          dumps.devSellSol.push(tr.sol)
          dumps.devSellImpact.push(impact)
          if (m.ageKnown) dumps.devSellAfter.push(m.age)
          dumps.coinsWithDevSell.add(mint)
        }
        if (impact <= -0.15) {
          dumps.bigSells++
          dumps.bigSellImpact.push(impact)
          sellTimes.push(tr.t)
          while (sellTimes.length && tr.t - sellTimes[0] > 10) sellTimes.shift()
          if (sellTimes.length === 3) dumps.cascades++
        }
      }
      peak = Math.max(peak, tr.mcapSol)
      if (!rugged && peak > 60 && tr.mcapSol < peak * 0.3) { rugged = true; dumps.rugs++ }

      // The wallet's bag in this coin.
      const w = wallets.get(tr.w) ?? { bags: new Map(), trades: 0, devSells: 0, bigSells: 0 }
      wallets.set(tr.w, w)
      w.trades++
      if (!tr.buy && tr.dev) w.devSells++
      if (!tr.buy && impact <= -0.15) w.bigSells++
      const price = tr.tok > 0 ? tr.sol / tr.tok : 0
      let bag = w.bags.get(mint)
      if (tr.buy) {
        if (!bag) { bag = { first: tr.t, firstAge: m.ageKnown ? m.age : NaN, spent: 0, got: 0, bought: 0, sold: 0, lastT: tr.t, sells: [], entryKeys: [], sizes: [] }; w.bags.set(mint, bag) }
        bag.spent += tr.sol
        bag.bought += tr.tok
        if (key) bag.entryKeys.push(key)
        bag.sizes.push(tr.sol)
      } else if (bag && bag.bought > bag.sold) {
        const avgEntry = bag.spent / Math.max(1e-9, bag.bought)
        const frac = Math.min(1, tr.tok / Math.max(1e-9, bag.bought - bag.sold))
        bag.sells.push({ t: tr.t - bag.first, frac, x: avgEntry > 0 ? price / avgEntry : 1 })
        bag.got += tr.sol
        bag.sold += tr.tok
      }
      if (bag) bag.lastT = tr.t
      if (price > 0) lastPrice.set(mint, price)
      recent.push(tr)
    }
  }

  // ---------- profile every wallet ----------

  interface Profile { w: string; ret: number; spent: number; coins: number; entryAge: number; hold: number; size: number; heldToEnd: number; lossCut: number; dumper: boolean; bags: Bag[] }
  const profiles: Profile[] = []
  for (const [w, s] of wallets) {
    const bags = [...s.bags.entries()].map(([mint, b]) => ({ mint, b }))
    if (bags.length < 2 || s.trades < 4) continue // too little to judge
    let spent = 0, value = 0
    const holds: number[] = [], ages: number[] = [], sizes: number[] = []
    let ended = 0, cut = 0, losers = 0
    for (const { mint, b } of bags) {
      spent += b.spent
      value += b.got + Math.max(0, b.bought - b.sold) * (lastPrice.get(mint) ?? 0)
      if (Number.isFinite(b.firstAge)) ages.push(b.firstAge)
      sizes.push(...b.sizes)
      if (b.sells.length) holds.push(b.sells[b.sells.length - 1].t)
      if (b.sold < b.bought * 0.95) ended++
      const lastX = b.sells.length ? b.sells[b.sells.length - 1].x : 1
      if (lastX < 1) { losers++; if (b.sold >= b.bought * 0.95) cut++ }
    }
    if (spent < 0.05) continue
    profiles.push({
      w, ret: value / spent - 1, spent, coins: bags.length, entryAge: ages.length ? quant(ages, [0.5])[0] : Infinity, hold: holds.length ? quant(holds, [0.5])[0] : Infinity,
      size: quant(sizes, [0.5])[0], heldToEnd: ended / bags.length, lossCut: losers ? cut / losers : 0, dumper: s.devSells > 0 || s.bigSells >= 2, bags: bags.map((x) => x.b),
    })
  }

  // Skill levels by return: the top 10% are pros, the bottom 10% degens.
  const byRet = [...profiles].sort((a, b) => b.ret - a.ret)
  const TIERS = [['pro', 0.1], ['good', 0.3], ['average', 0.7], ['bad', 0.9], ['degen', 1]] as const
  const tierOf = new Map<string, string>()
  byRet.forEach((p, i) => tierOf.set(p.w, TIERS.find(([, cut]) => i < byRet.length * cut)![0]))

  // Styles by habit, checked in this order.
  const styleOf = (p: Profile) =>
    p.dumper ? 'dumper' : p.size >= 3 ? 'whale' : p.entryAge < 30 ? 'sniper' : p.hold < 120 ? 'scalper' : p.heldToEnd > 0.6 || p.hold > 1800 ? 'diamond' : 'degen'

  // ---------- the brain ----------

  const totalExposure = [...exposure.values()].reduce((a, b) => a + b, 0)
  const groups = new Map<string, Profile[]>()
  for (const p of profiles) {
    const g = `${styleOf(p)}/${tierOf.get(p.w)}`
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g)!.push(p)
  }
  const brainGroups: Record<string, unknown> = {}
  for (const [g, ps] of groups) {
    if (ps.length < 3) continue
    const entries = new Map<string, number>()
    let nEntries = 0
    const sizes: number[] = [], exitX: number[] = [], exitT: number[] = [], partial: number[] = [], firstAge: number[] = []
    let lossBags = 0, cutBags = 0, heldBags = 0, bagsN = 0
    for (const p of ps) for (const b of p.bags) {
      bagsN++
      for (const k of b.entryKeys) { entries.set(k, (entries.get(k) ?? 0) + 1); nEntries++ }
      sizes.push(...b.sizes)
      if (Number.isFinite(b.firstAge)) firstAge.push(b.firstAge)
      for (const s of b.sells) { exitX.push(s.x); exitT.push(s.t); partial.push(s.frac) }
      if (b.sold < b.bought * 0.95) heldBags++
      const lastX = b.sells.length ? b.sells[b.sells.length - 1].x : 1
      if (lastX < 1) { lossBags++; if (b.sold >= b.bought * 0.95) cutBags++ }
    }
    // Lift: how much more (or less) often this group bought in a situation than the situation came up at all.
    const lift: Record<string, number> = {}
    for (const [k, n] of entries) {
      const ex = (exposure.get(k) ?? 0) / totalExposure
      if (ex > 0 && n >= 3) lift[k] = r3(n / nEntries / ex)
    }
    brainGroups[g] = {
      wallets: ps.length, bags: bagsN, medianReturn: r3(quant(ps.map((p) => p.ret), [0.5])[0]),
      buyLift: lift,
      buySizeSol: quant(sizes).map(r3), entryAgeSec: quant(firstAge).map(Math.round),
      exitMultiple: quant(exitX).map(r3), exitAfterSec: quant(exitT).map(Math.round), sellFraction: quant(partial).map(r3),
      holdsToEnd: r3(heldBags / Math.max(1, bagsN)), cutsLosers: r3(cutBags / Math.max(1, lossBags)),
    }
  }

  const span = trades.length ? trades[trades.length - 1].t - trades[0].t : 0
  const brain = {
    v: 1, learnedAt: new Date().toISOString(), trades: trades.length, coins: coinsSeen, wallets: wallets.size, profiled: profiles.length, minutes: Math.round(span / 60),
    buckets: { age: AGE.map(String), mcap: MCAP.map(String), move: MOVE.map(String) },
    market: {
      buyShare: r3(trades.filter((t) => t.buy).length / Math.max(1, trades.length)), tradeSizeSol: quant(trades.map((t) => t.sol)).map(r3),
      launchesPerMin: r3(launched.size / Math.max(1, span / 60)), graduatedShare: r3(graduated.size / Math.max(1, launched.size)),
      tiers: Object.fromEntries(TIERS.map(([t]) => [t, r3(quant(byRet.filter((p) => tierOf.get(p.w) === t).map((p) => p.ret), [0.5])[0])])),
      styles: Object.fromEntries(['sniper', 'scalper', 'whale', 'diamond', 'degen', 'dumper'].map((s) => [s, profiles.filter((p) => styleOf(p) === s).length])),
    },
    dumps: {
      coinsWithDevSellShare: r3(dumps.coinsWithDevSell.size / Math.max(1, coinsSeen)), devSellSol: quant(dumps.devSellSol).map(r3), devSellAfterSec: quant(dumps.devSellAfter).map(Math.round),
      devSellImpact: quant(dumps.devSellImpact).map(r3), bigSellsPerCoin: r3(dumps.bigSells / Math.max(1, coinsSeen)), bigSellImpact: quant(dumps.bigSellImpact).map(r3),
      cascadesPerCoin: r3(dumps.cascades / Math.max(1, coinsSeen)), rugShare: r3(dumps.rugs / Math.max(1, coinsSeen)),
    },
    groups: brainGroups,
    trends: trendsFrom(rows),
  }
  return brain
}

/**
 * What real launches are about right now: approved theme words (server/trendThemes.ts) found in launch names, ranked
 * by how much SOL traded on those coins. Anything not on the approved list (people, brands, politics, crude words)
 * never gets in, and the game's name filter checks again.
 */
function trendsFrom(rows: Row[]) {
  const volume = new Map<string, number>()
  for (const r of rows) if (r.k === 'trade') volume.set(r.mint, (volume.get(r.mint) ?? 0) + r.sol)
  const seen = new Map<string, { launches: number; volumeSol: number }>()
  for (const r of rows) {
    if (r.k !== 'create') continue
    const words = new Set(`${r.name ?? ''} ${r.symbol ?? ''}`.split(/[^A-Za-z]+/).map(themeOf).filter((w): w is string => !!w && !nameBlocked(w)))
    for (const w of words) {
      const x = seen.get(w) ?? { launches: 0, volumeSol: 0 }
      x.launches++
      x.volumeSol += volume.get(r.mint) ?? 0
      seen.set(w, x)
    }
  }
  return [...seen.entries()]
    .filter(([, x]) => x.launches >= 2)
    .sort((a, b) => b[1].volumeSol - a[1].volumeSol)
    .slice(0, 30)
    .map(([word, x]) => ({ word, narrative: SAFE_THEMES.get(word)!, launches: x.launches, volumeSol: r3(x.volumeSol) }))
}

// ---------- summary for people ----------

function summary(b: ReturnType<typeof learn>) {
  const pct = (x: number) => `${(x * 100).toFixed(0)}%`
  const sitText = (k: string) => `${AGE_LABEL[+k[0]]} old, ${MCAP_LABEL[+k[1]]}, ${MOVE_LABEL[+k[2]]}`
  const lines = [
    `# What the bots learned`,
    ``,
    `From **${b.trades.toLocaleString()} real pump.fun trades** over about ${b.minutes} minutes: ${b.coins.toLocaleString()} coins, ${b.wallets.toLocaleString()} wallets (${b.profiled.toLocaleString()} active enough to profile). Learned ${b.learnedAt.slice(0, 10)}.`,
    ``,
    `## The market`,
    `- ${pct(b.market.buyShare)} of trades are buys. A typical trade is ${b.market.tradeSizeSol[2]} SOL (most between ${b.market.tradeSizeSol[0]} and ${b.market.tradeSizeSol[4]}).`,
    `- About ${b.market.launchesPerMin} new coins launch per minute; ${pct(b.market.graduatedShare)} of the launches seen graduated.`,
    `- Styles found: ${Object.entries(b.market.styles).map(([s, n]) => `${s} ${n}`).join(', ')}.`,
    `- Typical return by skill level: ${Object.entries(b.market.tiers).map(([t, r]) => `${t} ${pct(r as number)}`).join(', ')}.`,
    ``,
    `## Dumps`,
    `- ${pct(b.dumps.coinsWithDevSellShare)} of coins had their dev sell while recording. Dev sells usually come ${b.dumps.devSellAfterSec[2]}s after launch and knock ${pct(-b.dumps.devSellImpact[2])} off the price (worst 10%: ${pct(-b.dumps.devSellImpact[0])}).`,
    `- Big sells (one sell dropping the price 15%+): ${b.dumps.bigSellsPerCoin} per coin, typically ${pct(-b.dumps.bigSellImpact[2])}. Pile-ons (3 big sells within 10s): ${b.dumps.cascadesPerCoin} per coin.`,
    `- ${pct(b.dumps.rugShare)} of coins that got past 60 SOL then lost 70% from their peak.`,
    ``,
    `## Trending themes (from real launch names, approved words only)`,
    b.trends.length ? b.trends.slice(0, 15).map((t) => `${t.word} (${t.launches} launches, ${Math.round(t.volumeSol)} SOL traded)`).join(', ') : 'none yet',
    ``,
    `## Each style and skill level`,
  ]
  for (const [g, x] of Object.entries(b.groups) as [string, any][]) {
    const fav = Object.entries(x.buyLift as Record<string, number>).sort((a, c) => c[1] - a[1]).slice(0, 2).map(([k, l]) => `${sitText(k)} (${l.toFixed(1)}× as often as normal)`)
    lines.push(`- **${g}** (${x.wallets} wallets, median return ${pct(x.medianReturn)}): buys ${x.buySizeSol[2]} SOL, usually ${x.entryAgeSec[2]}s after launch; sells at ${x.exitMultiple[2]}× after ${x.exitAfterSec[2]}s; holds ${pct(x.holdsToEnd)} of bags to the end, cuts ${pct(x.cutsLosers)} of losers. Favourite moments: ${fav.join('; ') || 'not enough data'}.`)
  }
  return lines.join('\n') + '\n'
}

const rows = load()
if (!rows.length) {
  console.error('No recordings yet. Run the recorder first: npx tsx scripts/market-recorder.ts')
  process.exit(1)
}
const brain = learn(rows)
writeFileSync(join(DATA, 'brain.json'), JSON.stringify(brain, null, 1))
writeFileSync(join(DATA, 'brain-summary.md'), summary(brain))
console.log(summary(brain))
console.log(`Brain saved to bot-data/brain.json (${Object.keys(brain.groups).length} style/level groups).`)
