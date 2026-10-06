// Market report: the World in numbers, to read before and after tuning the market (nothing here passes or fails).
//   npx tsx scripts/market-report.ts [hours=2] [warm-up hours=1]
// 1. The World with its bots: what the three Trenches columns hold, how many launches bond and how fast, what
//    happens per hour (rugs, dev dumps, graduations), how varied the bots' chat is, how busy the tape is.
// 2. Launches by how they are made (no bots around): how many bond, how long the rest live.
import { Room } from '../server/room'
import { applyPlayerTrade, cookToken, createMarket, quoteBuy, tickMarket } from '../src/game/marketEngine'
import { nativePrice } from '../src/game/tradingEngine'
import { NARRATIVES } from '../src/data/narratives'
import { WORLD_CODE } from '../src/net/protocol'
import { Rng } from '../src/utils/rng'
import type { CookSpec, MarketState, Token } from '../src/types'

const hours = Number(process.argv[2] ?? 2)
const warm = Number(process.argv[3] ?? 1)
const q = (a: number[], p: number) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : NaN)
const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length)

// ─── 1. The World ────────────────────────────────────────────────────────────
{
  const world = new Room(WORLD_CODE, true)
  const w = world as unknown as { tick(): void; market: MarketState; events: { id: number; kind: string }[] }
  for (let i = 0; i < warm * 3600; i++) w.tick()
  // Somebody watching, to hear the chat.
  let chat = 0
  const lines = new Map<string, number>()
  const ws = {
    readyState: 1, close() {},
    send: (d: string | Buffer) => {
      if ((typeof d === 'string' ? d.slice(0, 12) : d.toString('utf8', 0, 12)) !== '{"t":"chat",') return
      chat++
      const text = (JSON.parse(String(d)) as { text: string }).text
      lines.set(text, (lines.get(text) ?? 0) + 1)
    },
  }
  world.join(ws as never, { t: 'hello', name: 'Watcher', avatar: '👀', level: 1, playerId: 'g-report', verified: false })

  const nNew: number[] = [], nStretch: number[] = [], nMig: number[] = [], nBig: number[] = [], trades: number[] = [], bondAge: number[] = []
  const kinds: Record<string, number> = {}
  const seenEvents = new Set<number>()
  const seen = new Set(w.market.tokens.map((t) => t.id))
  const onCurve = new Set<string>()
  let launches = 0, cooks = 0, bonded = 0, cooksBonded = 0
  let lastTrade = w.market.nextTradeId
  for (let i = 0; i < hours * 3600; i++) {
    w.tick()
    const m = w.market
    for (const t of m.tokens as (Token & { creatorId?: string })[]) {
      if (!seen.has(t.id)) { seen.add(t.id); launches++; if (t.creatorId) cooks++ }
      if (t.status === 'graduated' && onCurve.has(t.id)) { bonded++; bondAge.push((m.time - t.createdAt) / 60); if (t.creatorId) cooksBonded++ }
      if (t.status === 'bonding') onCurve.add(t.id)
      else onCurve.delete(t.id)
    }
    for (const e of w.events) if (!seenEvents.has(e.id)) { seenEvents.add(e.id); kinds[e.kind] = (kinds[e.kind] ?? 0) + 1 }
    if (i % 20 === 0) {
      nNew.push(m.tokens.filter((t) => t.status === 'bonding' && t.bondingProgress < 40).length)
      nStretch.push(m.tokens.filter((t) => t.status === 'bonding' && t.bondingProgress >= 40).length)
      nMig.push(m.tokens.filter((t) => t.status === 'graduated').length)
      nBig.push(m.tokens.filter((t) => t.mcap > 1e8).length)
    }
    trades.push(m.nextTradeId - lastTrade)
    lastTrade = m.nextTradeId
  }
  console.log(`THE WORLD, ${hours} h after ${warm} h of warm-up`)
  console.log(`  New column (curve under 40%): ${avg(nNew).toFixed(0)} coins on average (${q(nNew, 0.05)} to ${q(nNew, 0.95)})`)
  console.log(`  Final Stretch (40% and up):   ${avg(nStretch).toFixed(1)} coins on average (${q(nStretch, 0.05)} to ${q(nStretch, 0.95)}), empty ${((100 * nStretch.filter((x) => x === 0).length) / nStretch.length).toFixed(0)}% of the time`)
  console.log(`  Migrated: ${avg(nMig).toFixed(0)} coins on average; coins over $100M: ${avg(nBig).toFixed(1)} on average, at most ${q(nBig, 1)}`)
  console.log(`  launches ${(launches / hours).toFixed(0)} an hour (${(cooks / hours).toFixed(0)} cooked by bots); bonded ${(bonded / hours).toFixed(0)} an hour (${(cooksBonded / hours).toFixed(1)} cooked by bots) = ${((100 * bonded) / Math.max(1, launches)).toFixed(1)}% of launches`)
  console.log(`  minutes from launch to bonding: 10% within ${q(bondAge, 0.1).toFixed(1)}, a quarter within ${q(bondAge, 0.25).toFixed(1)}, half within ${q(bondAge, 0.5).toFixed(1)}, three quarters within ${q(bondAge, 0.75).toFixed(1)}, 90% within ${q(bondAge, 0.9).toFixed(1)}`)
  console.log('  events an hour: ' + Object.entries(kinds).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${(n / hours).toFixed(0)}`).join(', '))
  console.log(`  bot chat: ${(chat / hours).toFixed(0)} lines an hour, ${lines.size} different ones; most repeated: ${[...lines.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t, n]) => `"${t}" ×${n}`).join(', ')}`)
  console.log(`  tape: ${avg(trades).toFixed(0)} trades a second on average, ${q(trades, 1)} in the busiest second`)
  world.dispose()
}

// ─── 2. Launches by how they are made ────────────────────────────────────────
{
  const LEVELS: Record<string, (meta: string) => Partial<CookSpec>> = {
    'lazy (one social, nothing else)': () => ({ socials: { x: true, tg: false, web: false }, style: 'fair', marketing: 0, description: '' }),
    'decent (hot meta, two socials, $200 marketing)': (meta) => ({ narrative: meta as CookSpec['narrative'], socials: { x: true, tg: true, web: false }, style: 'fair', marketing: 200, description: 'a coin with a real description on it' }),
    'strong (hot meta, every social, $1,000, hyped)': (meta) => ({ narrative: meta as CookSpec['narrative'], socials: { x: true, tg: true, web: true }, style: 'hyped', marketing: 1000, description: 'a coin with a real description on it' }),
  }
  const perLevel = 120, batch = 30, minutes = 30
  console.log(`\nLAUNCHES ON THE REAL-TIME ENGINE (${perLevel} each, a 1 SOL dev buy that is never sold, no bots or players around), after ${minutes} minutes`)
  for (const [name, make] of Object.entries(LEVELS)) {
    const tBond: number[] = [], tDie: number[] = []
    let n = 0, open = 0
    for (let b = 0; n < perLevel; b++) {
      const rng = new Rng(1000 + b * 77 + name.length)
      let m: MarketState = createMarket(4242 + b, 1_760_000_000, 'realistic')
      for (let i = 0; i < 90; i++) m = tickMarket(m, rng, { rugMult: 1, protectedIds: new Set() }).market
      const born = new Map<string, number>()
      for (let k = 0; k < batch && n < perLevel; k++, n++) {
        const off = NARRATIVES.find((x) => x.id !== m.meta)!.id
        const spec = { chain: 'sol', pad: 'pump', tax: { buy: 0, sell: 0 }, name: `Report ${b} ${k}`, ticker: `R${b}X${k}`, emoji: '🧪', hue: 10, devBuy: 1, bundle: { wallets: 0, perWallet: 0, stagger: false }, narrative: off, ...make(m.meta ?? off) } as CookSpec
        const c = cookToken(m, rng, spec)
        const usd = nativePrice(c.market, 'sol')
        m = applyPlayerTrade(c.market, c.token.id, 'buy', usd, quoteBuy(c.token, usd).newPrice)
        born.set(c.token.id, m.time)
      }
      const ended = new Set<string>()
      for (let i = 0; i < minutes * 60; i++) {
        m = tickMarket(m, rng, { rugMult: 1, protectedIds: new Set(born.keys()) }).market
        for (const t of m.tokens) {
          if (!born.has(t.id) || ended.has(t.id)) continue
          if (t.status === 'graduated') { ended.add(t.id); tBond.push((m.time - born.get(t.id)!) / 60) }
          else if (t.status !== 'bonding') { ended.add(t.id); tDie.push((m.time - born.get(t.id)!) / 60) }
        }
      }
      open += born.size - [...born.keys()].filter((id) => ended.has(id)).length
    }
    console.log(`  ${name}: bonded ${((100 * tBond.length) / n).toFixed(0)}% (half of them within ${q(tBond, 0.5).toFixed(1)} min), dead ${((100 * tDie.length) / n).toFixed(0)}% (half within ${q(tDie, 0.5).toFixed(1)} min), still trading ${((100 * open) / n).toFixed(0)}%`)
  }
}
process.exit(0)
