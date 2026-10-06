// Curve test: every price in the game comes from trades, through the maths the real launchpads and DEX pools use.
//   npx tsx scripts/curve-test.ts
// 1. Each launchpad's curve in numbers (start, raise, graduation, the pool it opens), pump.fun checked against its
//    published values.
// 2. The trades on the tape add up to the price moves: for every coin, every tick, the money that must have gone in
//    or out of the curve / pool to move the price that far is the money the tape shows.
// 3. A player's own buy and sell: they get exactly what the curve gives, the curve holds exactly what was paid in
//    (also when other people's trades land first), and a buy at the end of a curve is cut to what is left.
// 4. A coin somebody launches lives like every launch on the real-time engine: by who shows up to trade it.
import { LAUNCHPADS, PAD_IDS } from '../src/data/launchpads'
import { applyPlayerTrade, cookToken, createMarket, FLOW, quoteBuy, quoteSell, tickMarket, SUPPLY, setClock, secPerTickOf } from '../src/game/marketEngine'
import { NARRATIVES } from '../src/data/narratives'
import { curveAt, gradRaise, lpTokens, migrationPriceNative, gradPriceNative } from '../src/game/curve'
import { executeBuy, executeSell, nativePrice, tradeFee } from '../src/game/tradingEngine'
import { DEFAULT_TRADE_SETTINGS } from '../src/data/tradeSettings'
import { Rng } from '../src/utils/rng'
import type { CookSpec, MarketEngine, MarketState, Portfolio, Token } from '../src/types'

const ok = (cond: boolean, what: string) => console.log(`${cond ? 'PASS' : 'FAIL'} ${what}`)
const f = (n: number, d = 2) => n.toLocaleString('en-US', { maximumFractionDigits: d })
const near = (a: number, b: number, tol = 1e-6) => Math.abs(a / b - 1) < tol

// ─── 1. The curves ───────────────────────────────────────────────────────────
console.log('pad        chain  start MC   raise    MC at end  pool opens at        pool: coin + tokens   curve fee  dex fee')
for (const id of PAD_IDS) {
  const p = LAUNCHPADS[id]
  const startMc = (p.vNative / p.vTokens) * SUPPLY
  const endMc = gradPriceNative(id) * SUPPLY
  const openMc = migrationPriceNative(id) * SUPPLY
  console.log(`${id.padEnd(10)} ${p.chain.padEnd(5)}  ${f(startMc).padStart(8)}  ${f(gradRaise(id)).padStart(6)}  ${f(endMc).padStart(9)}  ${f(openMc).padStart(9)} (${((openMc / endMc - 1) * 100).toFixed(1).padStart(5)}%)  ${f(gradRaise(id)).padStart(6)} + ${f(lpTokens(id) / 1e6, 1).padStart(6)}M  ${(p.fee * 100).toFixed(2).padStart(6)}%  ${(p.dexFee * 100).toFixed(2).padStart(6)}%`)
}
{
  const p = LAUNCHPADS.pump
  ok(p.vNative === 30 && p.vTokens === 1_073_000_000 && p.curveTokens === 793_100_000, 'pump.fun: 30 SOL and 1,073,000,000 tokens of virtual reserves, 793,100,000 tokens sold on the curve (its published numbers)')
  ok(near((p.vNative / p.vTokens) * SUPPLY, 27.96, 1e-3) && near(gradRaise('pump'), 85, 1e-3) && near(gradPriceNative('pump') * SUPPLY, 410.9, 1e-3), `pump.fun: starts at ${f((p.vNative / p.vTokens) * SUPPLY)} SOL market cap, raises ${f(gradRaise('pump'))} SOL, ends at ${f(gradPriceNative('pump') * SUPPLY, 1)} SOL`)
  ok(near(migrationPriceNative('pump'), gradPriceNative('pump'), 1e-3) && lpTokens('pump') === 206_900_000, 'pump.fun: the pool opens with the raise and 206,900,000 tokens, at the price the curve ended on')
}

/** A launch: a lazy one (one social, nothing else) or a strong one (the hot meta, every social, marketing, hyped). */
function launchSpec(ticker: string, kind: 'lazy' | 'strong', m: MarketState): CookSpec {
  const strong = kind === 'strong'
  return {
    chain: 'sol', pad: 'pump', tax: { buy: 0, sell: 0 }, name: `Test ${ticker}`, ticker, emoji: '🧪', hue: 10, devBuy: 1, bundle: { wallets: 0, perWallet: 0, stagger: false },
    narrative: (strong ? m.meta : NARRATIVES.find((n) => n.id !== m.meta)!.id) as CookSpec['narrative'], socials: { x: true, tg: strong, web: strong }, style: strong ? 'hyped' : 'fair', marketing: strong ? 1000 : 0,
    description: strong ? 'a coin with a real description on it' : '',
  }
}

// ─── 2. Do the trades add up to the price? ───────────────────────────────────
interface Tally { moved: number; movedNoTrade: number; wrongWay: number; needed: number; shown: number; sizes: number[] }
function tapeCheck(engine: MarketEngine, ticks: number) {
  let m: MarketState = createMarket(12345, 1_760_000_000, engine)
  setClock(secPerTickOf(m))
  const rng = new Rng(999)
  const groups: Record<string, Tally> = {}
  let rugs = 0, grads = 0, bad = 0, pools = 0
  for (let i = 0; i < ticks; i++) {
    // Coins somebody launched are in the count too (half of them lazy launches, half strong ones in the hot meta).
    if (i === 40) for (let k = 0; k < 8; k++) m = cookToken(m, rng, launchSpec(`C${k}`, k % 2 ? 'strong' : 'lazy', m)).market
    const before = new Map(m.tokens.map((t) => [t.id, t]))
    const nativeBefore = m.native
    const lastId = m.nextTradeId
    const res = tickMarket(m, rng, { rugMult: 1, protectedIds: new Set() })
    m = res.market
    rugs += res.events.filter((e) => e.kind === 'rug').length
    grads += res.events.filter((e) => e.kind === 'graduation').length
    for (const t of m.tokens) {
      if (!Number.isFinite(t.price) || !Number.isFinite(t.liquidity) || !(t.price > 0) || !(t.liquidity >= 0)) bad++
      const o = before.get(t.id)
      if (!o || (o.status !== 'bonding' && o.status !== 'graduated') || o.status !== t.status) continue
      // A pool is never thinner than 2% of its coin's market cap, and never holds more coins than exist.
      if (t.status === 'graduated' && (t.liquidity < t.mcap * 0.02 * (1 - 1e-9) || t.liquidity / 2 / t.price > SUPPLY * (1 + 1e-6))) pools++
      const key = o.status !== 'bonding' ? 'migrated coins (DEX pool)' : t.sim.flow ? 'order-flow coins on the curve' : 'other coins on a curve'
      const g = (groups[key] ??= { moved: 0, movedNoTrade: 0, wrongWay: 0, needed: 0, shown: 0, sizes: [] })
      // A curve holds the chain's coin: its dollar price follows SOL with no trade. That part is not a price move.
      const fx = nativePrice(m, t.chain) / (nativeBefore?.[t.chain]?.price ?? nativePrice(m, t.chain))
      // Money that must have gone into (+) or out of (−) the pool to move the price this far: Q·(√(P1/P0) − 1).
      const needed = ((o.liquidity * fx) / 2) * (Math.sqrt(t.price / fx / o.price) - 1) // (the pool, too, is worth fx times more dollars)
      const fresh = t.tape.filter((e) => e.id >= lastId)
      const net = fresh.reduce((a, e) => a + (e.side === 'buy' ? e.usd : -e.usd), 0)
      for (const e of fresh) g.sizes.push(e.usd)
      if (fresh.length >= 40) continue // a tape keeps 40 trades: on a second with more, some are no longer on it
      if (Math.abs(t.price / fx / o.price - 1) > 1e-7) {
        g.moved++
        if (!fresh.length) g.movedNoTrade++
        else if (Math.sign(net) !== Math.sign(needed) && Math.abs(needed) > 1) g.wrongWay++
      }
      g.needed += Math.abs(needed)
      g.shown += Math.max(0, Math.min(Math.abs(needed), Math.sign(net) === Math.sign(needed) ? Math.abs(net) : 0))
    }
  }
  const name = engine === 'realistic' ? 'the World (real-time engine)' : 'solo and friends rooms (classic engine)'
  for (const [k, g] of Object.entries(groups)) {
    const pct = (g.shown / Math.max(1, g.needed)) * 100
    const med = [...g.sizes].sort((a, b) => a - b)[Math.floor(g.sizes.length / 2)] ?? 0
    ok(pct > 99.5 && g.movedNoTrade === 0 && g.wrongWay === 0, `${name}, ${k}: ${f(g.moved, 0)} price moves, ${g.movedNoTrade} without a trade behind them, ${g.wrongWay} against the trades; the tape shows ${pct.toFixed(1)}% of the $${f(g.needed, 0)} it took to make them (${f(g.sizes.length, 0)} trades, median $${f(med, 0)})`)
  }
  ok(bad === 0, `${name}: no broken prices or pools in ${ticks} ticks (${rugs} rugs, ${grads} graduations)`)
  ok(pools === 0, `${name}: every pool holds at least 2% of its coin's market cap, and never more coins than exist`)
}
tapeCheck('classic', 600)
tapeCheck('realistic', 600)

// ─── 3. A player's own trades ────────────────────────────────────────────────
{
  let m: MarketState = createMarket(777, 1_760_000_000, 'realistic')
  setClock(1)
  const rng = new Rng(5)
  let t0: Token | undefined
  for (let i = 0; i < 900 && !t0; i++) {
    m = tickMarket(m, rng, { rugMult: 1, protectedIds: new Set() }).market
    if (i > 150) t0 = m.tokens.find((t) => t.status === 'bonding' && t.pad === 'pump' && t.bondingProgress > 8 && t.bondingProgress < 70)
  }
  if (!t0) ok(false, 'found a pump.fun coin in the middle of its curve to trade')
  else {
    const nu = nativePrice(m, 'sol')
    const fee = tradeFee(t0, 'buy')
    const wallet = (): Portfolio => ({ cash: 0, startBalance: 0, balances: { sol: 100, bsc: 0, hood: 0 }, positions: {}, trades: [], realized: 0, feesPaid: 0, tradedTokens: [] } as unknown as Portfolio)
    const state = (t: Token) => curveAt(t.pad, t.price / nu)
    const tok = (mk: MarketState) => mk.tokens.find((x) => x.id === t0!.id)!
    // Everything new on the tape, as money into (+) or out of (−) the curve. The player's own buy counts after its fee.
    const tapeMoney = (mk: MarketState, since: number) => tok(mk).tape.filter((e) => e.id >= since).reduce((a, e) => a + (e.side === 'buy' ? 1 : -1) * e.usd * (e.wallet === 'YOU' && e.side === 'buy' ? 1 - fee : 1), 0)

    const b = executeBuy(wallet(), m, t0.id, 100, 1)
    if (!b.ok) ok(false, `a plain $100 buy went through: ${b.error}`)
    else {
      const paidIn = (100 * (1 - fee)) / nu
      ok(near(state(tok(b.market)).raised - state(t0).raised, paidIn) && near(b.trade.qty, state(t0).y - state(tok(b.market)).y), `a $100 buy: ${f(paidIn, 5)} SOL went in after the ${(fee * 100).toFixed(2)}% fee, the curve holds exactly that much more, and the ${f(b.trade.qty, 0)} tokens received are exactly what left the curve`)
      const s = executeSell(b.portfolio, b.market, t0.id, b.trade.qty, 2)
      const back = s.ok ? s.trade.value - s.trade.fee : 0
      ok(s.ok && near(back, 100 * (1 - fee) ** 2, 1e-6) && near(tok(s.ok ? s.market : m).price, t0.price, 1e-9), `selling it straight back returns $${f(back)}: the two fees and nothing else, and the price is back where it started`)
    }

    // With execution settings other people's trades land first. They are real trades: nothing is made up or lost.
    for (const side of ['buy', 'sell'] as const) {
      const setting = DEFAULT_TRADE_SETTINGS.sol[side][0]
      const r2 = new Rng(42)
      let n = 0, worst = 0, sand = 0, failed = 0, others = 0, better = 0
      const holder = side === 'sell' ? executeBuy(wallet(), m, t0.id, 100, 1) : null
      const start = holder?.ok ? holder.market : m
      const plain = side === 'buy' ? (b.ok ? b.trade.qty : 0) : 0
      for (let i = 0; i < 300; i++) {
        const since = start.nextTradeId
        const res = side === 'buy' ? executeBuy(wallet(), start, t0.id, 100, 1, { setting, rand: () => r2.next() }) : holder?.ok ? executeSell(holder.portfolio, start, t0.id, holder.trade.qty, 2, { setting, rand: () => r2.next() }) : null
        if (!res || !res.ok) { failed++; continue }
        n++
        const grew = (state(tok(res.market)).raised - state(tok(start)).raised) * nu
        const shown = tapeMoney(res.market, since)
        worst = Math.max(worst, Math.abs(grew - shown))
        others += tok(res.market).tape.filter((e) => e.id >= since && e.wallet !== 'YOU').length
        if ((res.trade.mev ?? 0) > 0) sand++
        if (side === 'buy' && res.trade.qty > plain * (1 + 1e-9)) better++
      }
      ok(n > 250 && worst < 0.01 && better === 0, `${side === 'buy' ? 'buying' : 'selling'} $100 with the default setting, ${n} tries (${failed} failed on slippage): the curve's money always equals what the tape shows going in and out (worst gap $${worst.toFixed(4)}); ${others} trades by others landed first, ${sand} sandwiches`)
    }

    // The end of a curve: only what is left can be bought, and only that is charged.
    const nearEnd = { ...t0, price: gradPriceNative('pump') * nu * 0.98, mcap: gradPriceNative('pump') * nu * 0.98 * SUPPLY }
    const st = curveAt('pump', nearEnd.price / nu)
    nearEnd.liquidity = 2 * st.x * nu
    let mEnd: MarketState = { ...m, tokens: m.tokens.map((x) => (x.id === t0!.id ? nearEnd : x)) }
    const left = LAUNCHPADS.pump.curveTokens - st.sold
    const costUsd = ((gradRaise('pump') - st.raised) * nu) / (1 - fee)
    const big = executeBuy(wallet(), mEnd, t0.id, 3000, 1)
    ok(big.ok && near(big.trade.qty, left, 1e-6) && near(big.trade.value, costUsd, 1e-6) && near(tok(big.market).price, gradPriceNative('pump') * nu, 1e-6),
      `a $3,000 buy with ${f(left / 1e6, 1)}M tokens left on the curve: got exactly those, paid $${big.ok ? f(big.trade.value) : '?'} (not $3,000), and the coin sits exactly on the curve's end price`)
    if (big.ok) {
      const again = executeBuy(wallet(), big.market, t0.id, 50, 2)
      ok(!again.ok, 'a second buy before it migrates is refused (the curve has nothing left to sell)')
      mEnd = tickMarket(big.market, new Rng(3), { rugMult: 1, protectedIds: new Set([t0.id]) }).market
      const g = tok(mEnd)
      const nu2 = nativePrice(mEnd, 'sol')
      // (People trade on the new pool in that same second, so it has moved along its own curve: coin × tokens is what stays.)
      const k = (g.liquidity / 2 / nu2) * (g.liquidity / 2 / g.price)
      ok(g.status === 'graduated' && near(k, gradRaise('pump') * lpTokens('pump'), 1e-3), `on the next tick it migrates to a pool seeded with the ${f(gradRaise('pump'), 0)} SOL raised and ${f(lpTokens('pump') / 1e6, 1)}M tokens (now ${f(g.liquidity / 2 / nu2, 1)} SOL and ${f(g.liquidity / 2 / g.price / 1e6, 1)}M after that second's trades: same product)`)
    }
    // Selling more than the curve ever sold can't take out more than buyers put in.
    const dump = executeSell({ ...wallet(), positions: { [t0.id]: { tokenId: t0.id, qty: SUPPLY, costBasis: 1, avgEntry: 1e-9, openedAt: 0, realized: 0 } } } as unknown as Portfolio, m, t0.id, SUPPLY, 1)
    ok(dump.ok && dump.trade.value <= state(t0).raised * nu * (1 + 1e-6) && tok(dump.market).price >= (LAUNCHPADS.pump.vNative / LAUNCHPADS.pump.vTokens) * nu, `a sell of the whole supply takes out no more than the ${f(state(t0).raised, 2)} SOL buyers put in, and the price stops at the curve's start`)
  }
}
// ─── 4. A launched coin ──────────────────────────────────────────────────────
{
  const classic = cookToken(createMarket(31, 1_760_000_000, 'classic'), new Rng(1), launchSpec('CLS', 'strong', createMarket(31, 1_760_000_000, 'classic'))).token
  let m: MarketState = createMarket(4242, 1_760_000_000, 'realistic')
  setClock(1)
  const rng = new Rng(8)
  for (let i = 0; i < 60; i++) m = tickMarket(m, rng, { rugMult: 1, protectedIds: new Set() }).market
  const kinds = new Map<string, 'lazy' | 'strong'>()
  const bag = new Map<string, number>() // each dev's coins: bought first, for 1 SOL, and never sold
  const first = cookToken(m, rng, launchSpec('L0', 'lazy', m))
  ok(!classic.sim.flow && !!first.token.sim.flow && first.token.holders === 0 && first.token.volume === 0,
    'a coin launched on the real-time engine trades by order flow from its first second, with no made-up holders or volume (in a classic round it follows the classic market)')
  const perKind = 45
  for (let k = 0; k < perKind * 2; k++) {
    const kind = k % 2 ? 'strong' : 'lazy'
    const c = cookToken(m, rng, launchSpec(`${kind === 'strong' ? 'S' : 'L'}${k}`, kind, m))
    m = c.market
    // The dev buys 1 SOL in the launch block; the second strong launch in three keeps a bag the engine is told about.
    const usd = nativePrice(m, 'sol')
    bag.set(c.token.id, quoteBuy(c.token, usd).qty)
    m = applyPlayerTrade(m, c.token.id, 'buy', usd, quoteBuy(c.token, usd).newPrice)
    if (k % 6 === 1) m = { ...m, tokens: m.tokens.map((t) => (t.id === c.token.id ? { ...t, devPct: 9 } : t)) }
    kinds.set(c.token.id, kind)
  }
  const ids = new Set(kinds.keys())
  const diedAt = new Map<string, number>()
  let simDevSells = 0, earlyDeaths = 0, soldUnder = 0
  for (let i = 0; i < 25 * 60; i++) {
    const lastId = m.nextTradeId
    m = tickMarket(m, rng, { rugMult: 1, protectedIds: ids, held: bag }).market
    for (const t of m.tokens) {
      if (!ids.has(t.id)) continue
      // The coins still out of the curve (or outside the pool) are never fewer than the ones in the dev's wallet.
      const out = t.status === 'graduated' ? SUPPLY - t.liquidity / 2 / t.price : LAUNCHPADS[t.pad].vTokens - t.liquidity / 2 / t.price
      if (out < bag.get(t.id)! * (1 - 1e-6)) soldUnder++
      if (t.tape.some((e) => e.id >= lastId && e.tag === 'dev')) simDevSells++
      if (t.status === 'dead' && !diedAt.has(t.id)) {
        diedAt.set(t.id, m.time)
        if (m.time - t.createdAt < FLOW.devQuiet || m.time - (t.sim.flow?.lastTrade ?? m.time) < FLOW.devQuiet) earlyDeaths++
      }
    }
  }
  const of = (kind: 'lazy' | 'strong') => m.tokens.filter((t) => kinds.get(t.id) === kind)
  const bonded = (kind: 'lazy' | 'strong') => of(kind).filter((t) => t.status === 'graduated').length
  const open = m.tokens.filter((t) => ids.has(t.id) && t.status === 'bonding').length
  ok(bonded('strong') >= perKind * 0.2 && bonded('lazy') <= perKind * 0.12 && bonded('strong') > bonded('lazy') * 2,
    `how a launch is made decides how it goes: ${bonded('strong')} of ${perKind} strong launches bonded within 25 minutes, ${bonded('lazy')} of ${perKind} lazy ones`)
  ok(open <= perKind * 0.2, `a launch is settled in minutes, not hours: after 25 minutes ${diedAt.size} of the ${perKind * 2} are dead, ${bonded('lazy') + bonded('strong')} bonded, ${open} still trading on their curve`)
  ok(earlyDeaths === 0, `a launched coin is only written off after ${FLOW.devQuiet / 60} minutes without a single buyer (its dev gets time to work it)`)
  const sol = nativePrice(m, 'sol')
  const worst = Math.min(...m.tokens.filter((t) => ids.has(t.id) && t.status === 'dead').map((t) => quoteSell(t, bag.get(t.id)!).usdOut / sol))
  ok(soldUnder === 0 && worst > 0.999, `the crowd can only sell what the crowd bought: no curve or pool ever went below the coins in the dev's own wallet, and on every dead coin the dev's bag (bought first, for 1 SOL) still sells for at least ${f(worst, 4)} SOL`)
  ok(simDevSells === 0 && m.tokens.filter((t) => ids.has(t.id)).every((t) => t.devPct === 0 || t.devPct === 9), "nobody but its dev sells a launched coin's dev bag (the made-up devs of the crowd's own launches dump theirs)")
}
process.exit(0)
