// Is this copy's market, tick for tick, the market another copy of the game runs? For work that ships behind a
// switch (the story market, say): with the switch off nothing may change for players, and this is the proof.
//   npx tsx scripts/same-market.ts <folder of the other copy> [ticks=3000]
// The other copy is usually what is live. To get it without touching this folder (bash):
//   mkdir ../live-copy && git archive origin/main src server | tar -x -C ../live-copy
// Both engines, two seeds each, the whole chain a game runs every tick (market, events, tracked wallets, posts,
// stories), compared by a fingerprint of everything every 250 ticks. Reads both copies, changes nothing.
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const other = process.argv[2]
if (!other) throw new Error('say which folder holds the other copy of the game')
const here = resolve(import.meta.dirname, '..')
const ticks = Number(process.argv[3] ?? 3000)

async function run(repo: string, engine: 'classic' | 'realistic', seed: number) {
  const load = (p: string) => import(pathToFileURL(join(repo, p)).href)
  const eng = (await load('src/game/marketEngine.ts')) as typeof import('../src/game/marketEngine')
  const { Rng } = (await load('src/utils/rng.ts')) as typeof import('../src/utils/rng')
  const { rollEvents } = (await load('src/game/eventEngine.ts')) as typeof import('../src/game/eventEngine')
  const { createWallets, tickWallets } = (await load('src/game/walletEngine.ts')) as typeof import('../src/game/walletEngine')
  const { tickSocial } = (await load('src/game/socialEngine.ts')) as typeof import('../src/game/socialEngine')
  const { tickStories } = (await load('src/game/storyEngine.ts')) as typeof import('../src/game/storyEngine')
  let m = eng.createMarket(seed, 1_760_000_000, engine)
  eng.setClock(engine === 'realistic' ? 1 : 6)
  const rng = new Rng(m.seed)
  let wallets = createWallets(new Rng((m.seed ^ 0xa11ce) >>> 0))
  const prints: string[] = []
  for (let i = 1; i <= ticks; i++) {
    const before = m
    const res = eng.tickMarket(m, rng, { rugMult: 1, protectedIds: new Set() })
    m = res.market
    const e2 = rollEvents(m, rng)
    const wr = tickWallets(wallets, m, rng)
    wallets = wr.wallets
    const posts = tickSocial(m, rng, wr.actions, [...res.events, ...e2])
    tickStories(m, { before, events: [...res.events, ...e2], actions: wr.actions, posts, wallets })
    if (i % 250 === 0) prints.push(createHash('sha1').update(JSON.stringify({ m, wallets, posts })).digest('hex').slice(0, 12))
  }
  return { prints, coins: m.tokens.length }
}

let differ = 0
for (const [engine, seed] of [['realistic', 4242], ['realistic', 99], ['classic', 4242], ['classic', 7]] as const) {
  const x = await run(other, engine, seed)
  const y = await run(here, engine, seed)
  const same = x.prints.join() === y.prints.join()
  if (!same) differ++
  const at = x.prints.findIndex((h, i) => h !== y.prints[i])
  console.log(`${same ? 'PASS' : 'FAIL'} ${engine} engine, seed ${seed}: ${ticks} ticks, ${x.coins} coins at the end, ${same ? 'the same market at every check' : `different from tick ${(at + 1) * 250}`}`)
}
console.log(differ ? `\n${differ} check(s) failed` : '\nall checks passed')
process.exit(0)
