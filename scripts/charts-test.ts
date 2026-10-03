// Charts across a restart: run the World, save it (as the server does before an update), bring it back, and check the
// short charts (1s / 5s / 30s) still follow the real price path instead of a made-up curve.
import { Room } from '../server/room'
import { candleStore } from '../src/game/marketEngine'
import { WORLD_CODE } from '../src/net/protocol'
import type { Candle, Timeframe } from '../src/types'

const ok = (cond: boolean, what: string) => console.log(`${cond ? 'PASS' : 'FAIL'} ${what}`)
const world = new Room(WORLD_CODE, true)
const w = world as unknown as { tick(): void; market: { time: number; tokens: { id: string; ticker: string; price: number; status: string; ath: number }[] } }
const minutes = Number(process.argv[2] ?? 30)
// Coins' history from before the World started is made up separately for each timeframe, so only compare what really traded.
const started = w.market.time + 60
for (let i = 0; i < minutes * 60; i++) w.tick()

// The coin that moved most over the last 40 minutes: the kind of chart that looked broken after an update.
const live = w.market.tokens.filter((t) => t.status === 'bonding' || t.status === 'graduated')
const range = (id: string) => {
  const c = candleStore.get(id)?.['5s'] ?? []
  const lows = c.map((k) => k.low)
  const highs = c.map((k) => k.high)
  return c.length ? Math.max(...highs) / Math.min(...lows) : 1
}
const coin = [...live].sort((a, b) => range(b.id) - range(a.id))[0]
const copy = (tf: Timeframe): Candle[] => (candleStore.get(coin.id)?.[tf] ?? []).map((k) => ({ ...k }))
const before = { s5: copy('5s'), s1: copy('1s'), s30: copy('30s'), price: coin.price }
console.log(`coin $${coin.ticker}: 5s chart spans ×${range(coin.id).toFixed(1)}, ${before.s5.length} candles`)

const snap = JSON.parse(JSON.stringify(world.snapshot()))
const charts = JSON.parse(JSON.stringify(world.chartSnapshot()))
world.dispose()
const back = Room.restore(snap, charts) as unknown as { dispose(): void }
const after = (tf: Timeframe) => candleStore.get(coin.id)?.[tf] ?? []

for (const [tf, old] of [['1s', before.s1], ['5s', before.s5], ['30s', before.s30]] as [Timeframe, Candle[]][]) {
  const now = after(tf)
  const bad = now.filter((k) => !(k.low > 0 && k.high >= k.low && k.open > 0 && k.close > 0)).length
  // Compare each restored candle's close with the real one at the same time (within the 1m candle it came from).
  const real = new Map(old.map((k) => [k.time, k]))
  let n = 0
  let inside = 0
  for (const k of now) {
    const r = real.get(k.time)
    if (!r || k.time < started) continue
    n++
    const m1Lo = Math.min(...old.filter((o) => Math.floor(o.time / 60) === Math.floor(k.time / 60)).map((o) => o.low))
    const m1Hi = Math.max(...old.filter((o) => Math.floor(o.time / 60) === Math.floor(k.time / 60)).map((o) => o.high))
    if (k.close >= m1Lo * 0.97 && k.close <= m1Hi * 1.03) inside++
  }
  ok(now.length > 0 && bad === 0, `${tf}: ${now.length} candles after the restart, none broken (${bad} bad)`)
  ok(n > 0 && inside / n > 0.97, `${tf}: ${n ? Math.round((inside / n) * 100) : 0}% of candles sit inside the real price range of their minute`)
}
const last = after('5s').at(-1)
ok(!!last && Math.abs(last.close / before.price - 1) < 0.05, `5s chart ends at the coin's price (${last?.close.toPrecision(4)} vs ${before.price.toPrecision(4)})`)
back.dispose()
process.exit(0)
