// Are the rolling "5m / 1h" numbers right? Run a market, add up what REALLY traded each tick, and compare the exact
// last-5-minutes / last-hour totals with what the game reports. Both clocks (Classic 6s per tick, Realistic 1s).
import { createMarket, secPerTickOf, setClock, tickMarket } from '../src/game/marketEngine'
import { lighthouse, sampleLighthouse } from '../src/game/lighthouse'
import { winTxns, winVolume } from '../src/game/windows'
import { Rng } from '../src/utils/rng'
import type { MarketEngine, MarketState, Token } from '../src/types'

const live = (t: Token) => t.status === 'bonding' || t.status === 'graduated'
const ok = (cond: boolean, what: string) => console.log(`${cond ? 'PASS' : 'FAIL'} ${what}`)

function run(engine: MarketEngine, simSeconds: number) {
  let m: MarketState = createMarket(12345, 1_700_000_000, engine)
  const sec = secPerTickOf(m)
  setClock(sec)
  const perTick: { time: number; vol: number; tx: number }[] = []
  const ticks = Math.round(simSeconds / sec)
  const hourTicks = 3600 / sec
  let launchedSeen = new Set(m.tokens.map((t) => t.id))
  const launches: number[] = []
  for (let i = 0; i < ticks; i++) {
    const before = new Map(m.tokens.map((t) => [t.id, t]))
    const rng = new Rng(m.seed)
    const next = tickMarket(m, rng, { rugMult: 1, protectedIds: new Set() }).market
    next.seed = rng.s
    // What really traded this tick: the 1h sums grow by exactly the tick's activity after their decay.
    let vol = 0
    let tx = 0
    const k = 1 - 1 / hourTicks
    for (const t of next.tokens) {
      const o = before.get(t.id)
      vol += Math.max(0, t.volume - (o ? o.volume * k : 0))
      tx += Math.max(0, t.buys + t.sells - (o ? (o.buys + o.sells) * k : 0))
      if (!launchedSeen.has(t.id)) {
        launchedSeen.add(t.id)
        launches.push(next.time)
      }
    }
    perTick.push({ time: next.time, vol, tx })
    m = next
    sampleLighthouse(m)
  }
  const since = (s: number) => perTick.filter((p) => p.time > m.time - s)
  const real5 = since(300).reduce((a, p) => a + p.vol, 0)
  const realTx5 = since(300).reduce((a, p) => a + p.tx, 0)
  const real1h = since(3600).reduce((a, p) => a + p.vol, 0)
  const liveTokens = m.tokens.filter(live)
  const rep5 = liveTokens.reduce((a, t) => a + winVolume(t, '5m', m.time), 0)
  const repTx5 = liveTokens.reduce((a, t) => a + winTxns(t, '5m', m.time), 0)
  const rep1h = liveTokens.reduce((a, t) => a + winVolume(t, '1h', m.time), 0)
  const lh = lighthouse(m, '5m', 'all')
  const realCreated5 = launches.filter((t) => t > m.time - 300).length
  const pc = (a: number, b: number) => `${((a / b) * 100).toFixed(0)}%`
  console.log(`\n${engine} (${sec}s per tick), ${simSeconds / 60} minutes simulated`)
  console.log(`  5m volume: reported $${Math.round(rep5)} vs really traded $${Math.round(real5)} = ${pc(rep5, real5)}`)
  console.log(`  5m txns:   reported ${Math.round(repTx5)} vs real ${Math.round(realTx5)} = ${pc(repTx5, realTx5)}`)
  console.log(`  1h volume: reported $${Math.round(rep1h)} vs really traded $${Math.round(real1h)} = ${pc(rep1h, real1h)}`)
  const lh1 = lighthouse(m, '1h', 'all')
  console.log(`  5m created: Lighthouse ${lh.created.value} vs real ${realCreated5}`)
  console.log(`  Lighthouse 5m: volume ${Math.round(lh.volume.value)} (${pc(lh.volume.value, real5)} of real), txns ${Math.round(lh.txns.value)} (${pc(lh.txns.value, realTx5)}), change ${lh.volume.change === null ? 'n/a' : (lh.volume.change * 100).toFixed(1) + '%'}`)
  console.log(`  Lighthouse 1h: volume ${Math.round(lh1.volume.value)} (${pc(lh1.volume.value, real1h)} of real)`)
  const near = (a: number, b: number, tol: number) => Math.abs(a / b - 1) <= tol
  ok(near(rep5, real5, 0.35), `${engine}: 5m volume within 35% of what really traded`)
  ok(near(repTx5, realTx5, 0.35), `${engine}: 5m txns within 35% of the real count`)
  ok(near(rep1h, real1h, 0.35), `${engine}: 1h volume within 35% of what really traded`)
  ok(near(lh.volume.value, real5, 0.05) && near(lh.txns.value, realTx5, 0.05), `${engine}: Lighthouse 5m volume and txns within 5% of what really traded`)
  ok(near(lh1.volume.value, real1h, 0.05), `${engine}: Lighthouse 1h volume within 5% of what really traded`)
  const real5prev = perTick.filter((p) => p.time > m.time - 600 && p.time <= m.time - 300).reduce((a, p) => a + p.vol, 0)
  ok(lh.volume.change !== null && Math.abs(lh.volume.change - (real5 / real5prev - 1)) < 0.08, `${engine}: Lighthouse 5m change ${((lh.volume.change ?? 0) * 100).toFixed(1)}% vs real ${((real5 / real5prev - 1) * 100).toFixed(1)}%`)
  ok(Math.abs(lh.created.value - realCreated5) <= Math.max(2, realCreated5 * 0.1), `${engine}: 5m created matches the real count`)
}

run('classic', 2 * 3600)
run('realistic', 2 * 3600)
process.exit(0)
