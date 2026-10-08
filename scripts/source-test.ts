// The data-source plug (V2 stage 4): outside data comes in by one door, cleaned, dated and honest about its source.
//   npx tsx scripts/source-test.ts
// No request leaves this computer: the "provider" in this test is a file in a temp folder and a tiny web server the
// test starts itself on a spare local port.
import { mkdtempSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SAMPLE_TRENDS } from '../src/data/trends'
import { cleanFeed, describeSources, feedAgeDays, isStale, TREND_MAX_AGE_DAYS } from '../src/game/dataSources'
import { createMarket, setClock, tickMarket } from '../src/game/marketEngine'
import { tickStories } from '../src/game/storyEngine'
import type { MarketState, TrendFeed } from '../src/types'
import { Rng } from '../src/utils/rng'

let failed = 0
const ok = (cond: boolean, what: string) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${what}`); if (!cond) failed++ }
const day = (ago: number) => new Date(Date.now() - ago * 86_400_000).toISOString().slice(0, 10)

// ── Cleaning: what gets through the door ──
{
  const c = cleanFeed({ asOf: day(1), themes: [{ word: 'horse', weight: 0.4 }, { word: 'Cats', weight: 0.8 }, { word: 'zzbrandname', weight: 1 }, { word: 'not a word!', weight: 1 }, { word: 'horse', weight: 0.2 }, 'frog', 42, null] }, { source: 'provider', provider: 'Test Feed <script>' })
  const f = c.feed
  ok(!!f && f.themes.map((t) => t.word).join(',') === 'cat,frog,horse', `only approved theme words get in, one each, hottest first (${f?.themes.map((t) => t.word).join(', ')}); dropped: ${c.dropped.join(', ')}`)
  ok(!!f && f.themes[0].weight === 1 && f.themes.every((t) => t.weight >= 0 && t.weight <= 1), 'weights are scaled so the hottest is 1')
  ok(!!f && f.themes.find((t) => t.word === 'cat')?.narrative === 'cats', "a theme's kind is the game's own, not the sender's")
  ok(!!f && f.source === 'provider' && f.provider === 'Test Feed script', `it carries where it is from, as plain text ("${f?.provider}")`)
  ok(cleanFeed({ themes: [{ word: 'horse' }] }, { source: 'provider' }).feed === null, 'a feed that does not say when it is from is refused')
  ok(cleanFeed({ asOf: day(-5), themes: [{ word: 'horse' }] }, { source: 'provider' }).feed === null, 'a feed dated in the future is refused')
  ok(cleanFeed({ asOf: day(1), themes: [{ word: 'zzbrandname' }, { word: 'qqpolitics' }] }, { source: 'provider' }).feed === null, 'a feed with no approved theme at all is refused')
  ok(cleanFeed('<html>', { source: 'provider' }).feed === null && cleanFeed(null, { source: 'provider' }).feed === null && cleanFeed({ asOf: day(1), themes: 'x' }, { source: 'provider' }).feed === null, 'junk is refused, never thrown on')
  const big = cleanFeed({ asOf: day(1), themes: Array.from({ length: 5000 }, () => ({ word: 'dog', weight: 1 })) }, { source: 'provider' })
  ok(!!big.feed && big.feed.themes.length === 1, 'a huge answer cannot flood the game')
}

// ── Age: an old list says so, and stops counting as what is running ──
{
  const fresh: TrendFeed = { source: 'recorded', asOf: day(2), themes: SAMPLE_TRENDS.themes }
  const old: TrendFeed = { ...fresh, asOf: day(TREND_MAX_AGE_DAYS + 3) }
  ok(!isStale(fresh, Date.now()) && isStale(old, Date.now()) && isStale(null, Date.now()) && Math.round(feedAgeDays(fresh, Date.now())) === 2, `a list is out of date after ${TREND_MAX_AGE_DAYS} days`)
  const rows = describeSources(old, Date.now())
  ok(rows.length === 3 && rows[0].kind === 'simulated' && rows[1].kind === 'generated' && rows[2].kind === 'outside', 'the game names three kinds of content: simulated, generated, outside data')
  ok(rows[2].status === 'stale' && /no longer treated/.test(rows[2].note) && describeSources(fresh, Date.now())[2].status === 'ok' && describeSources(null, Date.now())[2].status === 'none', 'the outside-data row says when its list is out of date, and when nothing is connected')
  ok(!/live/i.test(describeSources(fresh, Date.now())[2].note.replace('Not a live feed', '')) && /Not a live feed/.test(describeSources(fresh, Date.now())[2].note), 'a recording is never called live')

  // The story engine: theme lines only from a list that is not out of date.
  const themeLines = (feed: TrendFeed) => {
    let m: MarketState = createMarket(4242, 1_760_000_000, 'realistic')
    setClock(1)
    m.trends = feed
    let n = 0
    for (let i = 0; i < 1500; i++) {
      const rng = new Rng(m.seed)
      const before = m
      const r = tickMarket(m, rng, { rugMult: 1, protectedIds: new Set() })
      m = r.market
      m.trends = feed
      tickStories(m, { before, events: r.events, actions: [], posts: [], wallets: [] })
      m.seed = rng.s
    }
    for (const t of m.tokens) n += (t.beats ?? []).filter((b) => b.src === 'trend').length
    return n
  }
  const all: TrendFeed = { source: 'recorded', asOf: day(1), themes: SAMPLE_TRENDS.themes }
  const a = themeLines(all)
  const b = themeLines({ ...all, asOf: day(TREND_MAX_AGE_DAYS + 5) })
  ok(a > 0 && b === 0, `stories lean on outside data only while it is in date: ${a} theme lines from a fresh list, ${b} from an old one`)
}

// ── The plug itself: a file, a web address, a provider that breaks ──
const dir = mkdtempSync(join(tmpdir(), 'moonrush-source-'))
const file = join(dir, 'feed.json')
writeFileSync(file, JSON.stringify({ asOf: day(0), themes: [{ word: 'penguin', weight: 1 }, { word: 'robot', weight: 0.5 }] }))
// (The server's own source reads its settings when it is first loaded: they are set before that.)
const worldFile = join(dir, 'world-feed.json')
writeFileSync(worldFile, '{}')
process.env.TREND_FEED_FILE = worldFile
process.env.TREND_FEED_NAME = 'Local Test File'
const { TrendSource } = await import('../server/trendSource')
{
  const none = new TrendSource({})
  await none.start()
  ok(!none.status().provider.configured && none.status().using !== 'provider', `with nothing configured no provider is asked, and the World reads ${none.status().using === 'recorded' ? "the owner's recording" : 'the sample list'}`)
  none.stop()

  const src = new TrendSource({ TREND_FEED_FILE: file, TREND_FEED_NAME: 'Local Test File' })
  await src.refresh()
  const f = src.current()
  ok(!!f && f.source === 'provider' && f.provider === 'Local Test File' && f.themes[0].word === 'penguin' && src.status().using === 'provider' && src.status().provider.ok === true, 'a provider given as a file is read, cleaned and named')
  writeFileSync(file, '{ this is not json')
  await src.refresh()
  ok(src.current()?.themes[0].word === 'penguin' && src.status().provider.ok === false && !!src.status().provider.error && src.status().using === 'provider', `when the provider breaks the last good list is kept, and the failure is reported ("${src.status().provider.error?.slice(0, 50)}")`)
  // …and that kept list goes out of date honestly: its own date decides, not when it was fetched.
  const later = Date.now() + (TREND_MAX_AGE_DAYS + 2) * 86_400_000
  ok(src.current(later)?.source !== 'provider' || src.status(later).feed?.stale === true, 'a provider that stays broken does not keep its old list alive: after its date runs out the World falls back')
}
{
  let hits = 0
  let body = JSON.stringify({ asOf: day(1), themes: [{ word: 'ramen', weight: 0.9 }, { word: 'zzbrandname', weight: 1 }] })
  let code = 200
  const srv = createServer((_, res) => { hits++; res.writeHead(code, { 'content-type': 'application/json' }); res.end(body) })
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()))
  const port = (srv.address() as { port: number }).port
  const src = new TrendSource({ TREND_FEED_URL: `http://127.0.0.1:${port}/trends`, TREND_FEED_NAME: 'Local Test Server' })
  await src.refresh()
  ok(hits === 1 && src.current()?.themes.map((t) => t.word).join() === 'ramen' && src.status().provider.dropped?.includes('zzbrandname') === true, 'a provider given as a web address is asked, and what it sends is cleaned (the word that was not let in is reported)')
  code = 500
  await src.refresh()
  ok(src.status().provider.ok === false && src.current()?.themes[0].word === 'ramen', 'a provider answering with an error changes nothing in the game')
  ok(!JSON.stringify(src.status()).includes(String(port)), "the status never shows the provider's address")
  srv.close()
}

// ── The World: a new list reaches its players, once ──
{
  writeFileSync(worldFile, JSON.stringify({ asOf: day(0), themes: [{ word: 'penguin', weight: 1 }] }))
  const { Room } = await import('../server/room')
  const { trendSource } = await import('../server/trendSource')
  const { WORLD_CODE } = await import('../src/net/protocol')
  const world = new Room(WORLD_CODE, true)
  const w = world as unknown as { tick(): void; market: MarketState; tickMarketDiff(): { trends?: TrendFeed } }
  // (Every tick builds what goes out to the players: this notes each one.)
  const sent: { trends?: TrendFeed }[] = []
  const build = w.tickMarketDiff.bind(w)
  w.tickMarketDiff = () => { const d = build(); sent.push(d); return d }
  w.tick()
  w.tick()
  const before = sent.length
  await trendSource.refresh()
  for (let i = 0; i < 5; i++) w.tick()
  ok(w.market.trends?.source === 'provider' && w.market.trends.themes[0].word === 'penguin', "the World's stories read the provider's list once it has answered")
  const withList = sent.slice(before).filter((d) => d.trends)
  ok(sent.length >= before + 5 && sent.slice(0, before).every((d) => !d.trends) && withList.length === 1 && withList[0].trends?.source === 'provider', `a new list is sent to the players once, not every tick (${withList.length} of ${sent.length - before} ticks after it changed)`)
  world.dispose()
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed')
process.exit(0)
