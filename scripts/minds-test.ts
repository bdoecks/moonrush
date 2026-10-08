// Trader types (V2 stage 3): does each mind do what it says, and only on what a player could have read?
//   npx tsx scripts/minds-test.ts [World hours=1.5] [warm-up hours=0.25]
// Runs a World with its bots and watches every trade a tracked wallet's mind makes (they carry a reason, `why`):
// what the coin's feed and price said at that moment. Prints PASS / FAIL per check, and how often each mind acted.
import { Room } from '../server/room'
import { MIND, MIND_META, mindOf, type TraderMind } from '../src/game/traderMinds'
import { createWallets } from '../src/game/walletEngine'
import { WORLD_CODE } from '../src/net/protocol'
import type { Beat, MarketState, SimWallet, Token } from '../src/types'
import { Rng } from '../src/utils/rng'

const hours = Number(process.argv[2] ?? 1.5)
const warm = Number(process.argv[3] ?? 0.25)
let failed = 0
const ok = (cond: boolean, what: string) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${what}`); if (!cond) failed++ }

// Who has which mind.
{
  const a = createWallets(new Rng(1))
  const b = createWallets(new Rng(999))
  ok(a.every((w, i) => mindOf(w) === mindOf(b[i])), 'a wallet has the same mind in every market (it comes from who the wallet is, nothing is saved)')
  ok(a.filter((w) => w.style === 'sniper').every((w) => mindOf(w) === null) && mindOf({ id: 'bot-1', style: 'degen', bot: true }) === null, 'snipers and the World bots have no mind (a sniper is out before a coin has a story; bots trade from the market brain)')
  const have = new Set(a.map((w) => mindOf(w)).filter(Boolean))
  ok((Object.keys(MIND_META) as TraderMind[]).every((k) => have.has(k)), `every mind is somebody's: ${(Object.keys(MIND_META) as TraderMind[]).map((k) => `${MIND_META[k].label} ${a.filter((w) => mindOf(w) === k).length}`).join(', ')}`)
}

const world = new Room(WORLD_CODE, true)
const w = world as unknown as { tick(): void; market: MarketState; wallets: SimWallet[] }
for (let i = 0; i < warm * 3600; i++) w.tick()

interface Seen { mind: TraderMind; side: 'buy' | 'sell'; why: string; t: Token | undefined; time: number; pnlPct?: number }
const seen: Seen[] = []
const lastId = new Map<string, number>()
for (const x of w.wallets) lastId.set(x.id, x.trades[0]?.id ?? 0)
// The feed as it stood when the trade was made: the wallet acts inside the tick, on the lines of the tick before.
let feeds = new Map<string, Beat[]>()
let coins = new Map<string, Token>()
let plain = 0
const n = Math.round(hours * 3600)
const bad: string[] = []
for (let i = 0; i < n; i++) {
  feeds = new Map(w.market.tokens.map((t) => [t.id, t.beats ?? []]))
  coins = new Map(w.market.tokens.map((t) => [t.id, t]))
  w.tick()
  const now = w.market.time
  for (const x of w.wallets) {
    const mind = mindOf(x)
    const from = lastId.get(x.id) ?? 0
    for (const tr of x.trades) {
      if (tr.id <= from) break
      if (!tr.why) { if (mind) plain++; continue }
      if (!mind) { bad.push(`${x.name} has no mind but gave a reason`); continue }
      // (The coin as it stood before the tick, or after it: the wallet acted in between.)
      const after = w.market.tokens.find((c) => c.id === tr.tokenId)
      const t = [coins.get(tr.tokenId), after].find((c) => c && (mind !== 'contrarian' || c.change['5m'] <= MIND.fearDrop + 0.02)) ?? coins.get(tr.tokenId)
      seen.push({ mind, side: tr.side, why: tr.why, t, time: now, pnlPct: tr.pnlPct })
      const feed = feeds.get(tr.tokenId) ?? []
      const age = (ok: (b: Beat) => boolean) => { const b = feed.find(ok); return b ? now - b.time : Infinity }
      // What each mind must have had in front of it.
      if (tr.side === 'buy') {
        if (mind === 'narrative' && !(age((b) => b.src !== 'market' && b.tone === 'up') <= MIND.fresh.narrative + 2)) bad.push(`narrative bought ${tr.ticker} with no fresh story line`)
        if (mind === 'contrarian' && !(t && t.change['5m'] <= MIND.fearDrop + 0.02 && age((b) => b.tone === 'down') <= MIND.fresh.contrarian + 2)) bad.push(`contrarian bought ${tr.ticker} without fear on the feed`)
        if (mind === 'swing' && !(t && t.status === 'graduated' && t.liquidity >= MIND.swingPool * 0.9)) bad.push(`swing bought ${tr.ticker}, not a deep migrated pool`)
        if (mind === 'fomo' && !(t && ([t, after].some((c) => c && c.change['5m'] >= MIND.fomoRun - 0.02) || age((b) => b.tone !== 'down') <= MIND.fresh.fomo + 2))) bad.push(`fomo bought ${tr.ticker} with nothing running`)
        if (mind === 'panic') bad.push('a panic seller bought for a reason (it has none to buy on)')
      } else {
        if (mind === 'panic' && !(age((b) => b.tone !== 'up') <= MIND.fresh.panic + 2)) bad.push(`panic sold ${tr.ticker} with no bad line`)
        if (mind === 'narrative' && !(age((b) => b.kind === 'drama' || b.kind === 'fade') <= MIND.fresh.narrative + 2)) bad.push(`narrative left ${tr.ticker} though its story had not turned`)
      }
      // Nobody acts on a line younger than a reader could have seen. (The reason quotes the line it acted on.)
      // (The same words can be on a feed twice: it is too new only if every line it could mean is.)
      const quoted = feed.filter((b) => tr.why!.includes(b.text.slice(0, 30)))
      if (quoted.length && quoted.every((b) => now - b.time < MIND.seen - 1e-9)) bad.push(`${mind} acted on a line ${(now - quoted[0].time).toFixed(1)} s old`)
    }
    lastId.set(x.id, x.trades[0]?.id ?? from)
  }
}
world.dispose()

const by = (m: TraderMind, side: 'buy' | 'sell') => seen.filter((s) => s.mind === m && s.side === side)
console.log(`\n${hours} h of the World: trades made by a mind (the rest of these wallets' trades, ${plain}, were their style's own)`)
for (const k of Object.keys(MIND_META) as TraderMind[]) {
  const b = by(k, 'buy'), s = by(k, 'sell')
  console.log(`  ${MIND_META[k].icon} ${MIND_META[k].label.padEnd(17)} buys ${String(b.length).padStart(4)}   sells ${String(s.length).padStart(4)}   e.g. ${(b[0] ?? s[0])?.why.slice(0, 90) ?? '-'}`)
}
console.log('')
ok(bad.length === 0, bad.length ? `every mind acted on what it says it acts on: ${bad.length} did not, e.g. ${[...new Set(bad)].slice(0, 4).join('; ')}` : 'every mind acted only on what it says it acts on, and never on a line too new to have been read')
ok(by('narrative', 'buy').length > 0 && by('fomo', 'buy').length > 0 && by('swing', 'buy').length > 0 && by('contrarian', 'buy').length > 0, 'narrative traders, FOMO buyers, contrarians and swing traders all found something to buy')
ok(by('panic', 'sell').length > 0, `panic sellers dumped on bad news (${by('panic', 'sell').length} times)`)
// (Judged on what the wallet saw when it decided, the figure in its reason: what a sale realizes can differ, since
// selling moves the price and others trade in the same second.)
const said = (why: string) => Number(why.match(/([-+]?[0-9]+)%/)?.[1] ?? NaN) / 100
ok(by('fomo', 'sell').every((s) => said(s.why) <= MIND.fomoCut + 0.005), 'a FOMO buyer that gives up does so at a loss')
ok(by('swing', 'sell').every((s) => said(s.why) >= MIND.swingOut[0] - 0.005 || said(s.why) <= MIND.swingOut[1] + 0.005), 'a swing trader leaves at its target or its stop')
const mindShare = seen.length / Math.max(1, seen.length + plain)
ok(mindShare > 0.1 && mindShare < 0.9, `minds make a real share of these wallets' trades, not all of them: ${(100 * mindShare).toFixed(0)}%`)
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed')
process.exit(0)
