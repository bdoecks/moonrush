import { CHAIN_IDS, CHAINS } from '../data/chains'
import { EVENT_TEMPLATES } from '../data/events'
import { NARRATIVES } from '../data/narratives'
import { generatedLaunch, INITIAL_TOKENS, LAUNCH_POOL, WALLET_PREFIXES, WALLET_SUFFIXES } from '../data/tokens'
import type { Archetype, Candle, Chain, CookSpec, DevTrade, NativeQuote, MarketEngine, MarketEvent, MarketState, PadId, Regime, RiskLevel, TapeTrade, Timeframe, Token, TokenSim, Spark, SparkSim } from '../types'
import { TF_SECONDS, TIMEFRAMES } from '../types'
import { clamp, Rng } from '../utils/rng'
import { LAUNCHPADS, padFromId, padsFor } from '../data/launchpads'
import { addWin, getWin, setWinClock, stepWin } from './windows'
import { creatorRate, tradeFee } from './tradingEngine'
import { auditOf, blockUsd, coinFor, devFor, fitOf, keptSparks, makeSpark, pickCoin, SPARK, sparkRate, stakeOf, watchOf, type SparkDev } from './sparks'
import { curveAt, curveK, curveLiquidityUsd, gradMcapUsd, gradPriceNative, launchMcapUsd, migratedLiquidityUsd, migrationPriceNative, startPriceNative } from './curve'

// ─── Clock ───────────────────────────────────────────────────────────────────
// One tick happens every real second. Classic markets fast-forward (1 tick = 6 simulated seconds, so a 1m candle
// closes every 10 ticks); Realistic markets run in real time (1 tick = 1 second). The clock belongs to the market:
// call setClock whenever the active market changes (the store does; the server does per room).
export const CLASSIC_SEC_PER_TICK = 6
export let SIM_SEC_PER_TICK = CLASSIC_SEC_PER_TICK
export let HOUR_TICKS = 3600 / SIM_SEC_PER_TICK
let DECAY_1H = 1 - 1 / HOUR_TICKS
export const secPerTickOf = (m: Pick<MarketState, 'engine'> | undefined) => (m?.engine === 'realistic' ? 1 : CLASSIC_SEC_PER_TICK)
export function setClock(secPerTick: number) {
  SIM_SEC_PER_TICK = secPerTick
  HOUR_TICKS = 3600 / secPerTick
  DECAY_1H = 1 - 1 / HOUR_TICKS
  DT = secPerTick / CLASSIC_SEC_PER_TICK
  setWinClock(secPerTick)
}
// The market's own model (regimes, drift, volatility, hazards) is written "per classic tick" of 6 simulated seconds.
// DT is how much of such a step one tick is: 1 on a classic market, 1/6 on a real-time one. Without it a real-time
// coin did in one real second what the model means for six: a migrated coin moved 10% in a typical minute.
let DT = 1
/** How much of a classic 6-second step one tick is on the current clock (1, or 1/6 in real time). */
export const clockStep = () => DT
/** A per-classic-tick multiplier (0.88 a tick…) as it applies to one tick on the current clock. */
const per = (rate: number) => (DT === 1 ? rate : Math.pow(rate, DT))
export const SUPPLY = 1_000_000_000
const MAX_CANDLES = 200
// Second-level charts fill ~6 candles per real second, so they keep a deeper buffer.
const maxCandles = (tf: Timeframe) => (tf === '1s' ? 720 : tf === '5s' ? 480 : tf === '30s' ? 300 : MAX_CANDLES)
const MAX_TOKENS = 90 // live (bonding + graduated) coins before new launches pause
const LAUNCH_CHANCE = 0.07 // per tick: a new coin about every 14 real seconds at 1× (~4 a minute)
const TAPE_LEN = 40

// ─── Candle store ────────────────────────────────────────────────────────────
// Candles live outside React state: they are large, mutated in place each tick, and regenerated on load.
export const candleStore = new Map<string, Record<Timeframe, Candle[]>>()

// ─── Archetype profiles ──────────────────────────────────────────────────────
interface Profile {
  mcap: [number, number]
  vol: number
  liq: [number, number]
  rug: number
  top10: [number, number]
  dev: [number, number]
  age: [number, number] // sim seconds
  meanRev: number
  beta: number
  turnover: [number, number]
  hype: [number, number]
  historyDrift: number // per-candle log drift used when backfilling history
  regimes: Partial<Record<Regime, number>>
}

const H = 3600
const D = 86400
const PROFILES: Record<Archetype, Profile> = {
  bluechip: { mcap: [4e6, 4e7], vol: 0.005, liq: [0.1, 0.16], rug: 0, top10: [10, 22], dev: [0, 2], age: [3 * D, 25 * D], meanRev: 0.01, beta: 1, turnover: [0.05, 0.15], hype: [30, 70], historyDrift: 0.002, regimes: { sideways: 5, accumulation: 3, pump: 1, distribution: 3, dump: 1, recovery: 1 } },
  runner: { mcap: [1.5e5, 3e6], vol: 0.011, liq: [0.08, 0.14], rug: 0.00004, top10: [18, 35], dev: [1, 5], age: [2 * H, 4 * D], meanRev: 0.004, beta: 1.3, turnover: [0.2, 0.6], hype: [40, 90], historyDrift: 0.01, regimes: { sideways: 3, accumulation: 3, pump: 3, distribution: 2, dump: 2, recovery: 1 } },
  grinder: { mcap: [3e5, 6e6], vol: 0.006, liq: [0.1, 0.15], rug: 0.00001, top10: [15, 28], dev: [0, 4], age: [1 * D, 15 * D], meanRev: 0.006, beta: 0.8, turnover: [0.08, 0.2], hype: [20, 50], historyDrift: 0.006, regimes: { sideways: 3, accumulation: 6, pump: 1, distribution: 1, dump: 0.5, recovery: 1 } },
  bleeder: { mcap: [2e5, 4e6], vol: 0.007, liq: [0.08, 0.13], rug: 0.00008, top10: [20, 40], dev: [2, 8], age: [1 * D, 20 * D], meanRev: 0.006, beta: 1, turnover: [0.05, 0.15], hype: [5, 30], historyDrift: -0.008, regimes: { sideways: 3, accumulation: 1, pump: 0.5, distribution: 6, dump: 1.5, recovery: 0.7 } },
  chaotic: { mcap: [2.5e4, 9e5], vol: 0.02, liq: [0.06, 0.12], rug: 0.0001, top10: [25, 45], dev: [2, 9], age: [10 * 60, 2 * D], meanRev: 0.003, beta: 1.5, turnover: [0.4, 1.2], hype: [30, 80], historyDrift: 0.012, regimes: { sideways: 2, accumulation: 2, pump: 3, distribution: 2, dump: 3, recovery: 2 } },
  rugger: { mcap: [1.2e4, 5e5], vol: 0.016, liq: [0.04, 0.09], rug: 0.00035, top10: [40, 75], dev: [6, 20], age: [5 * 60, 1 * D], meanRev: 0.003, beta: 1.2, turnover: [0.3, 1], hype: [40, 95], historyDrift: 0.015, regimes: { sideways: 2, accumulation: 3, pump: 3, distribution: 2, dump: 2, recovery: 1 } },
  sleeper: { mcap: [8e4, 2e6], vol: 0.004, liq: [0.1, 0.16], rug: 0.00003, top10: [15, 30], dev: [1, 5], age: [2 * D, 15 * D], meanRev: 0.012, beta: 0.6, turnover: [0.03, 0.1], hype: [5, 25], historyDrift: 0, regimes: { sideways: 8, accumulation: 2, pump: 0.8, distribution: 1, dump: 0.4, recovery: 0.6 } },
}

// `moon` is the rare sustained, parabolic run (minutes, not seconds) that real trenches coins do: 5x–100x+.
const REGIME_TICKS: Record<Regime, [number, number]> = {
  sideways: [20, 60], accumulation: [25, 70], pump: [5, 16], moon: [20, 60], distribution: [20, 60], dump: [5, 14], recovery: [10, 28], rug: [3, 3],
}
// Drift in units of the token's own per-tick sigma, and a volatility multiplier.
const REGIME_DRIFT: Record<Regime, [number, number]> = {
  sideways: [-0.06, 0.04], accumulation: [0.08, 0.22], pump: [0.8, 1.6], moon: [1.6, 3.0], distribution: [-0.3, -0.1], dump: [-2.0, -1.0], recovery: [0.25, 0.55], rug: [0, 0],
}
// How likely each kind of coin is to go parabolic (relative weight next to its other regimes).
const MOON_WEIGHT: Record<Archetype, number> = { bluechip: 0, runner: 0.08, grinder: 0.006, bleeder: 0.002, chaotic: 0.05, rugger: 0.045, sleeper: 0.01 }
// Memecoins bleed by default: a small negative drift (in sigma units) on top of every regime.
/** A coin feels gravity above this many times its archetype's usual top market cap; 40x further is a hard ceiling. */
const SIZE_CAP_MULT = 10
/** A migrated coin's pool is never thinner than this share of its market cap (see tickMarket). */
const POOL_FLOOR = 0.02
const BLEED: Record<Archetype, number> = { bluechip: -0.01, runner: -0.05, grinder: 0.01, bleeder: -0.08, chaotic: -0.06, rugger: -0.07, sleeper: -0.02 }
const REGIME_VOL: Record<Regime, number> = { sideways: 0.7, accumulation: 0.9, pump: 1.7, moon: 2.1, distribution: 1, dump: 1.9, recovery: 1.2, rug: 1 }
const REGIME_ACTIVITY: Record<Regime, number> = { sideways: 0.7, accumulation: 1, pump: 2.6, moon: 4, distribution: 1.1, dump: 2.2, recovery: 1.4, rug: 3 }


const logUniform = (rng: Rng, lo: number, hi: number) => Math.exp(rng.range(Math.log(lo), Math.log(hi)))
const hueOf = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7)

export function walletName(rng: Rng) {
  return `${rng.pick(WALLET_PREFIXES)}…${rng.pick(WALLET_SUFFIXES)}`
}

export function setRegime(t: Token, regime: Regime, rng: Rng, ticks?: number) {
  const [lo, hi] = REGIME_DRIFT[regime]
  t.sim.regime = regime
  t.sim.regimeTicks = ticks ?? rng.int(...REGIME_TICKS[regime])
  t.sim.drift = rng.range(lo, hi) * t.volatility
  t.sim.volMult = REGIME_VOL[regime]
}

function nextRegime(t: Token, rng: Rng) {
  const w: Partial<Record<Regime, number>> = { ...PROFILES[t.sim.archetype].regimes }
  const prev = t.sim.regime
  const mul = (r: Regime, m: number) => (w[r] = (w[r] ?? 0) * m)
  // Parabolic runs come out of accumulation or a pump, favour hyped small caps, and almost never repeat back to back.
  w.moon = MOON_WEIGHT[t.sim.archetype] * (t.mcap < 2e6 ? 1.6 : t.mcap < 2e7 ? 0.7 : 0.15) * (0.4 + t.hype / 80)
  if (prev === 'pump') { mul('dump', 3); mul('distribution', 2.5); mul('pump', 0.5); mul('moon', 1.8) }
  if (prev === 'moon') { mul('dump', 4); mul('distribution', 3); mul('moon', 0.1); mul('pump', 0.6) } // what goes up…
  if (prev === 'dump') { mul('recovery', 2.5); mul('dump', 0.5); mul('sideways', 1.5); mul('moon', 0.2) }
  if (prev === 'accumulation') { mul('pump', 1.6); mul('moon', 1.5) }
  if (prev === 'sideways' || prev === 'distribution') mul('moon', 0.4)
  mul('pump', 1 + t.hype / 250)
  if (t.hype < 20) mul('distribution', 1.5)
  setRegime(t, rng.weighted(w), rng)
}

// ─── Risk & scores ───────────────────────────────────────────────────────────
export function computeRisk(t: Token, now: number): { score: number; level: RiskLevel } {
  if (t.status === 'rugged' || t.status === 'dead') return { score: 100, level: 'EXTREME' }
  const liqRatio = t.liquidity / Math.max(1, t.mcap)
  const age = now - t.createdAt
  const score = clamp(
    (1 - Math.min(1, liqRatio / 0.15)) * 22 +
      (t.top10Pct / 80) * 20 +
      (t.devPct / 20) * 14 +
      Math.min(1, t.volatility / 0.022) * 14 +
      Math.min(1, t.rugProb / 0.0006) * 20 +
      (t.status === 'bonding' ? 6 : 0) +
      (age < H ? 4 : 0),
    0,
    100,
  )
  const level: RiskLevel = score < 30 ? 'LOW' : score < 52 ? 'MEDIUM' : score < 72 ? 'HIGH' : 'EXTREME'
  return { score: Math.round(score), level }
}

// ─── History backfill ────────────────────────────────────────────────────────
function buildHistory(t: Token, now: number, rng: Rng) {
  const age = Math.max(SIM_SEC_PER_TICK, now - t.createdAt)
  const prof = PROFILES[t.sim.archetype]
  const out = {} as Record<Timeframe, Candle[]>
  const launchPrice = startPriceNative(t.pad) * CHAINS[t.chain].basePrice * 1.0005
  for (const tf of TIMEFRAMES) {
    const tfs = TF_SECONDS[tf]
    const end = Math.floor(now / tfs) * tfs
    const n = Math.max(1, Math.min(maxCandles(tf) - 20, Math.ceil(age / tfs)))
    const coversLaunch = n * tfs >= age
    const scale = Math.sqrt(tfs / SIM_SEC_PER_TICK)
    const sigma = t.volatility * scale * 0.55
    // Build close prices backwards from the current price.
    const closes = new Array<number>(n)
    closes[n - 1] = t.price
    if (coversLaunch && n > 2) {
      // Brownian bridge from launch price to current price.
      const a = Math.log(launchPrice)
      const b = Math.log(t.price)
      let w = 0
      const noise: number[] = [0]
      for (let i = 1; i < n; i++) noise.push((w += rng.gauss() * sigma))
      for (let i = 0; i < n; i++) {
        const f = i / (n - 1)
        closes[i] = Math.exp(a + (b - a) * f + noise[i] - noise[n - 1] * f)
      }
    } else {
      const drift = prof.historyDrift * scale * 0.2
      for (let i = n - 2; i >= 0; i--) {
        const r = drift + sigma * rng.gauss() + (rng.chance(0.03) ? sigma * 3 * rng.gauss() : 0)
        closes[i] = closes[i + 1] * Math.exp(-r)
      }
    }
    const candles: Candle[] = []
    const baseVol = (t.volume * tfs) / 3600
    for (let i = 0; i < n; i++) {
      const close = closes[i]
      const open = i === 0 ? (coversLaunch ? launchPrice : close * Math.exp(sigma * rng.gauss())) : closes[i - 1]
      const wick = sigma * 0.6
      const high = Math.max(open, close) * Math.exp(Math.abs(rng.gauss()) * wick)
      const low = Math.min(open, close) * Math.exp(-Math.abs(rng.gauss()) * wick)
      const move = Math.abs(Math.log(close / open)) / Math.max(1e-9, sigma)
      candles.push({ time: end - (n - 1 - i) * tfs, open, high, low, close, volume: baseVol * (0.4 + 0.5 * move) * Math.exp(0.4 * rng.gauss()) })
    }
    out[tf] = candles
  }
  candleStore.set(t.id, out)
  let ath = t.mcap
  for (const tf of TIMEFRAMES) for (const c of out[tf]) ath = Math.max(ath, c.high * SUPPLY)
  t.ath = ath
}

// ─── Token factory ───────────────────────────────────────────────────────────
const pickChain = (rng: Rng): Chain => rng.weighted<Chain>({ sol: CHAINS.sol.weight, bsc: CHAINS.bsc.weight, hood: CHAINS.hood.weight })

/** Stable chain for tokens from saves made before chains existed. */
export const chainFromId = (id: string): Chain => {
  const h = [...id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % 10
  return h < 5 ? 'sol' : h < 8 ? 'bsc' : 'hood'
}

const initNative = (): Record<Chain, NativeQuote> => ({
  sol: { price: CHAINS.sol.basePrice, open: CHAINS.sol.basePrice },
  bsc: { price: CHAINS.bsc.basePrice, open: CHAINS.bsc.basePrice },
  hood: { price: CHAINS.hood.basePrice, open: CHAINS.hood.basePrice },
})

/** Bring markets saved before chains existed up to date. */
export function migrateMarket(m: MarketState): MarketState {
  if (!m.native) m.native = initNative()
  for (const t of m.tokens) {
    if (!t.chain) t.chain = chainFromId(t.id)
    if (!t.pad || !LAUNCHPADS[t.pad] || LAUNCHPADS[t.pad].chain !== t.chain) {
      t.pad = padFromId(t.id, t.chain)
      if (LAUNCHPADS[t.pad].tax && !t.tax) t.tax = { buy: 0.03, sell: 0.03 }
    }
    if (t.status === 'bonding') syncCurve(t, nativeUsdOf(m.native, t.chain))
    if (!t.socials) {
      const h = [...t.id].reduce((a, c) => (a * 37 + c.charCodeAt(0)) >>> 0, 5)
      t.socials = { x: h % 100 < 82, tg: (h >> 7) % 100 < 48, web: (h >> 14) % 100 < 33 }
    }
  }
  return m
}

const nativeUsdOf = (native: Partial<Record<Chain, NativeQuote>> | undefined, c: Chain) => native?.[c]?.price ?? CHAINS[c].basePrice

function pickPad(rng: Rng, chain: Chain): PadId {
  return rng.weighted<PadId>(Object.fromEntries(padsFor(chain).map((p) => [p.id, p.weight])) as Record<PadId, number>)
}

const TAXES = [0.01, 0.02, 0.03, 0.05, 0.08]

/**
 * Keep a bonding token on its launchpad curve: prices can't go below the curve's start (there's nothing to sell into),
 * and liquidity and progress come straight from the curve. Returns true once the curve is complete.
 */
export function syncCurve(t: Token, nativeUsd: number): boolean {
  const floor = startPriceNative(t.pad) * 1.0005 * nativeUsd
  if (t.price < floor) {
    t.price = floor
    t.mcap = floor * SUPPLY
  }
  const st = curveAt(t.pad, t.price / nativeUsd)
  t.liquidity = 2 * st.x * nativeUsd
  t.bondingProgress = st.progress
  return t.price / nativeUsd >= gradPriceNative(t.pad)
}

function logDev(t: Token, trade: DevTrade) {
  t.devTrades = [trade, ...(t.devTrades ?? [])].slice(0, 24)
}

function makeToken(rng: Rng, seed: { ticker: string; name: string; emoji: string; archetype: Archetype; chain?: Chain; pad?: PadId }, now: number, launch: boolean, native?: Partial<Record<Chain, NativeQuote>>): Token {
  const p = PROFILES[seed.archetype]
  const chain = seed.chain ?? pickChain(rng)
  const pad = seed.pad ?? pickPad(rng, chain)
  const nu = nativeUsdOf(native, chain)
  const launchMc = launchMcapUsd(pad, nu)
  const gradMc = gradMcapUsd(pad, nu)
  const vol = p.vol * rng.range(0.8, 1.25) * (LAUNCHPADS[pad].mayhem ? 1.4 : 1)
  const age = launch ? 0 : logUniform(rng, p.age[0], p.age[1])
  let mcap = launch ? launchMc * rng.range(1.02, 1.35) : logUniform(rng, p.mcap[0], p.mcap[1])
  const young = age < D && (seed.archetype === 'chaotic' || seed.archetype === 'rugger' || seed.archetype === 'runner')
  const bonding = launch || (young && mcap < gradMc)
  if (!launch && !bonding && mcap < gradMc) mcap = gradMc * rng.range(1.1, 2)
  if (bonding) mcap = clamp(mcap, launchMc * 1.001, gradMc * 0.97)
  const price = mcap / SUPPLY
  const liquidity = bonding ? curveLiquidityUsd(pad, price / nu, nu) : mcap * rng.range(p.liq[0], p.liq[1])
  const turnover = rng.range(p.turnover[0], p.turnover[1])
  const volume = launch ? 800 : mcap * turnover
  const avgSize = clamp(mcap * 0.0004, 25, 2500)
  const tradesPerHour = volume / avgSize
  const buyShare = rng.range(0.45, 0.6)
  const sim: TokenSim = {
    archetype: seed.archetype,
    regime: 'sideways',
    regimeTicks: 0,
    drift: 0,
    volMult: 1,
    anchor: Math.log(price),
    meanRev: p.meanRev,
    beta: p.beta * rng.range(0.7, 1.3),
    pressure: 0,
    volBoost: 0,
    rugAt: null,
    baseTurnover: turnover,
  }
  const t: Token = {
    id: `${seed.ticker}-${Math.floor(rng.next() * 1e6).toString(36)}`,
    chain,
    pad,
    ...(LAUNCHPADS[pad].tax ? { tax: { buy: rng.pick(TAXES), sell: rng.pick(TAXES) } } : {}),
    // Most coins launch with an X account; fewer bother with a TG or website (ruggers least of all).
    socials: seed.archetype === 'rugger' ? { x: rng.chance(0.55), tg: rng.chance(0.25), web: rng.chance(0.1) } : { x: rng.chance(0.85), tg: rng.chance(0.5), web: rng.chance(0.35) },
    name: seed.name,
    ticker: seed.ticker,
    emoji: seed.emoji,
    hue: hueOf(seed.ticker),
    createdAt: now - age,
    price,
    supply: SUPPLY,
    mcap,
    ath: mcap,
    liquidity,
    volume,
    buys: tradesPerHour * buyShare,
    sells: tradesPerHour * (1 - buyShare),
    holders: launch ? rng.int(3, 12) : Math.max(8, Math.round(0.7 * Math.pow(mcap, 0.58) * rng.range(0.7, 1.3))),
    momentum: 0,
    momentumScore: 50,
    hype: rng.range(p.hype[0], p.hype[1]),
    volatility: vol,
    top10Pct: rng.range(p.top10[0], p.top10[1]),
    devPct: rng.range(p.dev[0], p.dev[1]),
    snipers: bonding ? rng.int(2, 18) : rng.int(0, 6),
    insidersPct: rng.range(0, seed.archetype === 'rugger' ? 30 : 10),
    rugProb: p.rug * rng.range(0.6, 1.5),
    riskScore: 0,
    riskLevel: 'LOW',
    status: bonding ? 'bonding' : 'graduated',
    bondingProgress: bonding ? curveAt(pad, price / nu).progress : 100,
    change: { '1m': 0, '5m': 0, '1h': 0, '24h': 0 },
    tape: [],
    sim,
    volMark: volume, // creator fees count trades from here on (the made-up opening volume doesn't earn anything)
  }
  // Coins that were already trading before you saw them have paid fees on their earlier volume too.
  t.feesPaid = t.volume * tradeFee(t, 'buy')
  // Most devs buy in the launch block; that's the first DEV marker on the chart.
  if (bonding && t.devPct > 0.3) logDev(t, { time: t.createdAt, side: 'buy', usd: (t.devPct / 100) * launchMc * 1.15 })
  setRegime(t, launch ? rng.weighted<Regime>({ pump: 3, accumulation: 3, sideways: 2, distribution: 2 }) : rng.weighted(p.regimes), rng)
  const r = computeRisk(t, now)
  t.riskScore = r.score
  t.riskLevel = r.level
  return t
}

// ─── Market lifecycle ────────────────────────────────────────────────────────
/** `keepCandles`: the server hosts several rooms, so it must not wipe the other rooms' charts. */
export function createMarket(seed: number, startTime = Math.floor(Date.now() / 1000), engine: MarketEngine = 'classic', opts: { keepCandles?: boolean } = {}): MarketState {
  const rng = new Rng(seed)
  setClock(engine === 'realistic' ? 1 : CLASSIC_SEC_PER_TICK)
  if (!opts.keepCandles) candleStore.clear()
  const tokens = INITIAL_TOKENS.map((s) => makeToken(rng, s, startTime, false))
  // A handful of fresh launches so the "New" and trenches columns are populated immediately.
  for (let i = 0; i < 6; i++) {
    const t = makeToken(rng, { ...LAUNCH_POOL[i], archetype: rng.weighted<Archetype>({ rugger: 3, chaotic: 3, runner: 2, bleeder: 2 }) }, startTime, true)
    t.createdAt = startTime - rng.int(20, 1500)
    const nu = CHAINS[t.chain].basePrice
    t.mcap = Math.min(launchMcapUsd(t.pad, nu) * rng.range(1.05, 9), gradMcapUsd(t.pad, nu) * 0.95)
    t.price = t.mcap / SUPPLY
    syncCurve(t, nu)
    t.volume = t.mcap * 0.8
    tokens.push(t)
  }
  for (const t of tokens) {
    buildHistory(t, startTime, rng)
    refreshChanges(t, startTime)
  }
  return { tick: 0, time: startTime, sentiment: 0.1, sentimentTrend: 0, tokens, seed: rng.s, nextTradeId: 1, launched: 6, native: initNative(), engine }
}

/** Server: rebuild the charts of one room's coins without touching other rooms' (the candle store is shared). */
export function rebuildCandlesFor(m: MarketState) {
  const rng = new Rng(m.seed ^ 0x9e3779b9)
  for (const t of m.tokens) {
    candleStore.delete(t.id)
    const ath = t.ath
    buildHistory(t, m.time, rng)
    t.ath = Math.max(ath, t.ath)
  }
}

/**
 * Short-timeframe candles (1s / 5s / 30s) rebuilt from real longer ones, e.g. after a server restart where only 1m and
 * up were saved. Each long candle is split into its short ones along a path that starts at its open, touches its high
 * and its low, and ends at its close, so the short chart follows what really traded (and the trade markers on it line
 * up) instead of a made-up curve. Volume is shared out across the pieces.
 */
export function splitCandles(src: Candle[], srcSec: number, dstSec: number, max: number, rng: Rng): Candle[] {
  const k = Math.max(1, Math.round(srcSec / dstSec))
  const out: Candle[] = []
  for (const c of src.slice(-Math.ceil(max / k) - 1)) {
    if (!(c.open > 0 && c.close > 0 && c.high > 0 && c.low > 0)) continue
    const hi = Math.max(c.high, c.open, c.close)
    const lo = Math.min(c.low, c.open, c.close)
    // Where the path touches the high and the low (a green candle usually dips first, a red one pops first).
    const a = 1 + Math.floor(rng.next() * Math.max(1, k - 1))
    let b = 1 + Math.floor(rng.next() * Math.max(1, k - 1))
    if (k > 2 && b === a) b = a === 1 ? 2 : a - 1
    const [first, second] = a <= b ? [a, b] : [b, a]
    const lowFirst = c.close >= c.open ? rng.chance(0.7) : rng.chance(0.3)
    const anchors: [number, number][] = [[0, c.open], [first, lowFirst ? lo : hi], [second, lowFirst ? hi : lo], [k, c.close]]
    const path = new Array<number>(k + 1)
    for (let s = 0; s < anchors.length - 1; s++) {
      const [i0, p0] = anchors[s]
      const [i1, p1] = anchors[s + 1]
      for (let i = i0; i <= i1; i++) {
        const f = i1 === i0 ? 1 : (i - i0) / (i1 - i0)
        const noise = i === i0 || i === i1 ? 0 : rng.gauss() * 0.15 * Math.log(hi / lo || 1)
        path[i] = Math.min(hi, Math.max(lo, Math.exp(Math.log(p0) + (Math.log(p1) - Math.log(p0)) * f + noise)))
      }
    }
    const weights = Array.from({ length: k }, () => 0.2 + rng.next())
    const wsum = weights.reduce((x, y) => x + y, 0)
    for (let j = 0; j < k; j++) {
      const open = path[j]
      const close = path[j + 1]
      out.push({ time: c.time + j * dstSec, open, close, high: Math.max(open, close), low: Math.min(open, close), volume: (c.volume * weights[j]) / wsum })
    }
  }
  return out.slice(-max)
}

/** Rebuild a coin's 1s / 5s / 30s charts from its real 1m candles (see `splitCandles`). */
export function shortTfsFrom1m(c: Record<Timeframe, Candle[]>, rng: Rng) {
  const m1 = c['1m']
  if (!m1?.length) return
  c['30s'] = splitCandles(m1, 60, 30, maxCandles('30s'), rng)
  c['5s'] = splitCandles(m1, 60, 5, maxCandles('5s'), rng)
  c['1s'] = splitCandles(m1, 60, 1, maxCandles('1s'), rng)
}

/** After loading a saved market, candles are regenerated to end at each token's current price. */
export function rebuildCandles(m: MarketState) {
  const rng = new Rng(m.seed ^ 0x9e3779b9)
  candleStore.clear()
  for (const t of m.tokens) {
    const ath = t.ath
    buildHistory(t, m.time, rng)
    t.ath = Math.max(ath, t.ath)
  }
}

function changeOver(arr: Candle[], now: number, windowSec: number, price: number) {
  if (!arr.length) return 0
  const target = now - windowSec
  let ref = arr[0].open
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i].time <= target) {
      ref = arr[i].close
      break
    }
  }
  return ref > 0 ? price / ref - 1 : 0
}

function refreshChanges(t: Token, now: number) {
  const c = candleStore.get(t.id)
  if (!c) return
  t.change = {
    '1m': changeOver(c['1m'], now, 60, t.price),
    '5m': changeOver(c['1m'], now, 300, t.price),
    '1h': changeOver(c['5m'], now, 3600, t.price),
    '24h': changeOver(c['1h'], now, 86400, t.price),
  }
}

// ─── Multiplayer: the server records every chart point so clients can replay them exactly ───
/** [time, price, prevPrice, volume] */
export type CandlePoint = [number, number, number, number]
let pointLog: Map<string, CandlePoint[]> | null = null
/** Server: record chart points into this log (one per room; set it before touching that room's market). */
export function setCandleLog(log: Map<string, CandlePoint[]> | null) {
  pointLog = log
}
/** Replay chart points recorded on the server into this browser's candles. */
export function applyCandlePoints(tokenId: string, pts: CandlePoint[]) {
  let c = candleStore.get(tokenId)
  if (!c) {
    c = {} as Record<Timeframe, Candle[]>
    for (const tf of TIMEFRAMES) c[tf] = []
    candleStore.set(tokenId, c)
  }
  for (const [time, price, prev, vol] of pts) applyPointRaw(c, time, price, prev, vol)
}

function applyPoint(c: Record<Timeframe, Candle[]>, time: number, price: number, prevPrice: number, vol: number, tokenId?: string) {
  if (pointLog && tokenId) {
    const log = pointLog.get(tokenId)
    const p: CandlePoint = [time, price, prevPrice, vol]
    if (log) log.push(p)
    else pointLog.set(tokenId, [p])
  }
  applyPointRaw(c, time, price, prevPrice, vol)
}

function applyPointRaw(c: Record<Timeframe, Candle[]>, time: number, price: number, prevPrice: number, vol: number) {
  for (const tf of TIMEFRAMES) {
    const tfs = TF_SECONDS[tf]
    const bucket = Math.floor(time / tfs) * tfs
    const arr = c[tf]
    const last = arr[arr.length - 1]
    if (last && last.time === bucket) {
      last.high = Math.max(last.high, price)
      last.low = Math.min(last.low, price)
      last.close = price
      last.volume += vol
    } else if (!last || bucket > last.time) {
      const open = last ? last.close : prevPrice
      arr.push({ time: bucket, open, high: Math.max(open, price), low: Math.min(open, price), close: price, volume: vol })
      if (arr.length > maxCandles(tf)) arr.shift()
    }
  }
}

/**
 * Record an off-tick price change (e.g. a trader wallet's fill) on the candles. Pass `native` when the price moved so a
 * bonding coin's liquidity follows its curve right away — otherwise the next trade in the same tick is quoted off stale
 * reserves.
 */
export function touchCandles(t: Token, time: number, prevPrice: number, usd: number, native?: MarketState['native']) {
  if (native && t.status === 'bonding') syncCurve(t, nativeUsdOf(native, t.chain))
  else poolFollows(t, prevPrice)
  pushCandles(t, time, prevPrice, usd)
}

/**
 * A migrated coin's DEX pool after a trade moved its price: in a constant-product pool the quote side grows with the
 * square root of the price (buyers' money goes in, sellers' comes out), so liquidity rises as a coin pumps and shrinks
 * as it dumps. Without this, trades moved the price but not the pool: a coin pumped to $200K kept the ~$15K pool it
 * opened with, and every sell then hit far too hard. (The market's own per-tick move already does the same.)
 */
export function poolFollows(t: Token, prevPrice: number) {
  if (t.status !== 'graduated' || !(prevPrice > 0) || !(t.price > 0)) return
  t.liquidity = Math.max(2, t.liquidity * Math.sqrt(t.price / prevPrice))
}

/**
 * Record a tick's move. With an rng, the 6 simulated seconds inside the tick get their own prices via a
 * Brownian bridge that ends exactly at the tick's price — that's what feeds the 1s/5s/30s candles.
 */
function pushCandles(t: Token, now: number, prevPrice: number, vol: number, rng?: Rng) {
  let c = candleStore.get(t.id)
  if (!c) {
    c = {} as Record<Timeframe, Candle[]>
    for (const tf of TIMEFRAMES) c[tf] = []
    candleStore.set(t.id, c)
  }
  if (!rng || prevPrice <= 0) return applyPoint(c, now, t.price, prevPrice, vol, t.id)
  const steps = SIM_SEC_PER_TICK
  const a = Math.log(prevPrice)
  const b = Math.log(t.price)
  const sigma = t.volatility * Math.sqrt(1 / steps) * 0.9
  const noise = [0]
  for (let i = 1; i <= steps; i++) noise.push(noise[i - 1] + rng.gauss() * sigma)
  let prev = prevPrice
  for (let k = 1; k <= steps; k++) {
    const f = k / steps
    const price = k === steps ? t.price : Math.exp(a + (b - a) * f + noise[k] - noise[steps] * f)
    applyPoint(c, now - steps + k, price, prev, (vol / steps) * (0.5 + rng.next()), t.id)
    prev = price
  }
}

function addTape(m: MarketState, t: Token, trade: Omit<TapeTrade, 'id'>) {
  t.tape = [{ ...trade, id: m.nextTradeId++ }, ...t.tape].slice(0, TAPE_LEN)
}

// ─── Realistic engine: launchpad order flow ──────────────────────────────────
// Calibrated to pump.fun (2026): ~30–50k launches a day, median fill ~$10, average ~$40. About 1% of launches bond
// (real: 0.2–2.7%; before V2 it was "juiced" to ~3%, and the juice was free money for whoever bought what was
// running: see TOPS). On the curve, price is nothing but the sum of buys and sells: every simulated trade goes
// through the curve math, exactly like a player's. Every launchpad trades this way, each on its own curve (its own
// virtual reserves, raise and end): the crowd is the same crowd.
export const FLOW = {
  launchPerSec: 0.6, // launches per real second over all launchpads (~36 a minute; pump.fun alone does ~21–36)
  maxLive: 110, // coins alive on their curves at once (all launchpads)
  buyMedian: 12,
  buySigma: 1.6, // lognormal: median $12, mean ≈ $43
  sellMedian: 10,
  sellSigma: 1.5,
  maxTrade: 6000,
  decay: 0.955, // attention half-life ~15s without buyers…
  decayGood: 0.995, // …up to ~2 min for the coins that catch on
  feedback: 0.00012, // attention gained per $ of net buying, scaled by quality
  deadAfter: 25, // seconds with no trades (and no attention) before a coin is dead
  devNews: 40, // a dev selling their whole bag is news once the coin is this far up its curve (%)
  devQuiet: 180, // …and for a coin somebody cooked: its dev gets a few minutes to work it before it's written off
  pressureAtt: 5, // attention gained (lost) per second for each unit of `pressure`: a dev tool working, a scandal
  delistAfter: 60, // seconds a dead coin lingers before it leaves the lists (unless you hold/watch it)
  kothProgress: 50, // "king of the hill": the attention bump pump.fun gives coins about halfway up the curve
  churn: 3, // traders per unit of attention (buys and sells both, so it adds activity without adding direction)
  heatSize: 0.8, // hot coins draw real degens (0.1–2 SOL), not just $10 dust: size scales up with attention
  hotPace: 0.6, // attention × trade size above which a coin's clock starts to slow (see `pace` in stepFlow)…
  hotCurve: 0.8, // …and how hard: 1 would hold every hot coin to the same dollars a second, 0 is no slowing
  ownPace: 1.2, // `hotPace` for a player's own launch, which keeps the clock every coin had before V2
  stretchPace: 0.4, // from 60% up its curve a coin of the simulated market runs at this much of its speed (slowing from 30% on)
  botPairs: 0.3, // fresh coins: volume-bot / MEV buy+sell pairs per second for their first 3 minutes
  minTrade: 1,
  devDump: 0.004, // a crowd launch's dev, once the coin is up 60%: the chance each second that they sell into it
  // The simulated market only (see TOPS):
  crowdHold: 0.4, // a coin with this much attention keeps its crowd like the best of them: it ends when holders cash out, not by fading…
  left: 0.15, // …and a coin its crowd has sold out of loses this much more of its attention a second: nobody is in it
  quiet: 0.05, // a dial that is OFF: under this much attention a coin's holders would leave with what they bought…
  exit: 0, // …this share of their coins a second, and the last of them when it dies. At 0 a coin that goes quiet keeps its
  // price, as in the live game. (On, it was a loss nobody was paid for: every buy low on a curve lost a fifth on average.)
}

/**
 * The fair market (V2): what keeps the simulated market from paying whoever buys what is running.
 * Before it, a coin with attention had a crowd that bought more than it sold, every second, until the attention was
 * gone: $100 on any coin crossing 40% of its curve made +20% in half a minute, and a coin that had just bonded, a KOL
 * call or a "trending" event paid as well. These are the rules that close it, all in `stepFlow` unless said:
 *  - Tops. Every second the crowd buys more than it sells carries a chance that holders who are up sell into it,
 *    in one burst. The chance is the climb that second's trading is worth on average (known exactly: it is the
 *    model's own average, `climbOf`) divided by what a top takes on average (`topTakes`), times `k`. So what a climb
 *    pays is what the tops take back, whatever set the crowd going (momentum, a caller, a story, king of the hill).
 *    With k = 1 buying what is running pays nothing before fees; 0 switches all of these rules off. The chance
 *    follows the crowd's buying, not the price's new highs (a thin curve makes new highs from noise alone). The dump
 *    is real: coins the crowd bought come back to the curve as sells on the tape, never coins in real wallets.
 *  - The crowd buys, net, no more than a top could take back, and nothing at all in a coin nobody holds. A coin's
 *    first holders come in one go, before anybody can be ahead of them: snipers in its launch block (`snipe`,
 *    `launchBlock`), the first buyers of a viral moment. A coin its crowd has sold out of loses its attention fast.
 *  - What wallets from outside the crowd do (tracked wallets, bots) and what an event's jump puts in, the crowd
 *    trades against (`outsideNet`, `flow.jolt`): on average such an order does not move the price for good.
 *  - Every coin the regime model moves (all migrated coins, and a classic round's curve coins: steps 4a and 4b of
 *    tickMarket) has the same in that model's terms. Its pull on a coin lasts for minutes (a pump keeps pumping), so
 *    each tick the pull carries a matching chance of a jump the other way: up, that holders dump into it; down, that
 *    buyers take the dip. An event's jump, and in a pool a KOL's followers, are answered by the crowd; so is the rush
 *    of outside wallets into a pool's first minutes (`GRAD_SUPPLY`) and onto a classic curve. A pool opens with no
 *    pull either way (`migrate`). On a classic curve the pull works on the part of the price above the coin's floor.
 *  - Good news is said when the push it is about has mostly played out (`lateEvents` in eventEngine, a parabolic
 *    run in tickMarket): said at once it was a tip. Warnings are said at once.
 * They are for the simulated market: the crowd's own launches, the bot chefs' and, in the World, a real player's
 * (all carry `flow.botDev`: left out, a well-made player launch bonded half the time and paid its dev hundreds of
 * dollars a launch; scripts/cook-report.ts measures it). Only a player's launch in solo play or a friends room
 * still goes up its curve as its launch alone decides.
 * What is left against a buyer is what a buyer can read and avoid: a dev who still holds a bag, a coin that looks
 * like a rug, a post everybody has already acted on. `scripts/fair-test.ts` measures all of it, in a World with its
 * bots and on the classic engine: read it before and after touching any of this.
 */
export const TOPS = {
  k: 1, // how fair (see above)
  drop: { median: 0.35, sigma: 0.5, min: 0.12, max: 0.88 }, // the share of the price a top takes: mostly about a third, now and then nearly all
  scare: 0.25, // …and of the crowd's attention with it: this × the drop
  keep: 0.15, // the share of the crowd's coins that is never dumped (holders who do not sell)
  taking: 0, // how much of the steady profit-taking on a run is left where tops apply (a top is that same selling, in one go)
}
/**
 * What a top takes on average when it cannot take more than `room` (the crowd selling all it holds): the drop above,
 * cut at `room`, as a share of the price. Worked out once, in steps of half a per cent.
 */
const TOP_TAKES = Array.from({ length: 201 }, (_, i) => {
  const room = i * 0.005
  let sum = 0
  let w = 0
  for (let z = -4; z <= 4; z += 0.02) {
    const p = Math.exp(-0.5 * z * z)
    sum += p * Math.min(room, clamp(TOPS.drop.median * Math.exp(TOPS.drop.sigma * z), TOPS.drop.min, TOPS.drop.max))
    w += p
  }
  return sum / w
})
const topTakes = (room: number) => TOP_TAKES[clamp(Math.round(room / 0.005), 0, TOP_TAKES.length - 1)]

/** The standard normal's cumulative distribution (Abramowitz and Stegun 26.2.17, good to 1e-7). */
function normCdf(x: number) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x))
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2)
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))))
  return x >= 0 ? 1 - p : p
}
/** The average of a lognormal trade size (median, sigma) times `scale`, when no trade can be bigger than `cap`. */
function cappedMean(median: number, sigma: number, scale: number, cap: number) {
  const m = median * scale
  if (!(m > 0) || !(cap > 0)) return 0
  const z = Math.log(cap / m) / sigma
  return m * Math.exp((sigma * sigma) / 2) * normCdf(z - sigma) + cap * (1 - normCdf(z))
}
/** The same for the size squared (how much the money traded in a second can differ from its average). */
function cappedSquare(median: number, sigma: number, scale: number, cap: number) {
  const m = median * scale
  if (!(m > 0) || !(cap > 0)) return 0
  const z = Math.log(cap / m) / sigma
  return m * m * Math.exp(2 * sigma * sigma) * normCdf(z - 2 * sigma) + cap * cap * (1 - normCdf(z))
}
const flowSquare = (median: number, sigma: number, scale: number, cap: number, p: number) =>
  (1 - p) * cappedSquare(median, sigma, scale, cap) + (p / 5) * [8, 16, 24, 32, 40].reduce((a, w) => a + cappedSquare(median, sigma, scale * w, cap), 0)
/** …and with the odd trade 8 to 40 times the size (chance `p`). */
const flowMean = (median: number, sigma: number, scale: number, cap: number, p: number) =>
  (1 - p) * cappedMean(median, sigma, scale, cap) + (p / 5) * [8, 16, 24, 32, 40].reduce((a, w) => a + cappedMean(median, sigma, scale * w, cap), 0)

// How a launch's score (0..1, see cookQuality) becomes the pull it has on the crowd in the real-time engine: the same
// `q` every launch there has (median ≈ 0.07 for the crowd's own launches; above ≈ 1.4 a coin feeds on its own buying).
const COOK_FLOW = { base: -3.0, perScore: 3.0, luck: 0.5 }

const DEV_ICON = EVENT_TEMPLATES.find((e) => e.kind === 'devsell')?.icon ?? '📉'

const lognormal = (rng: Rng, median: number, sigma: number) => median * Math.exp(sigma * rng.gauss())

/** A realistic launch on any launchpad: starts at the bottom of its curve, plus whatever the dev bought in the launch block. */
function launchFlowToken(rng: Rng, m: MarketState, base: { ticker: string; name: string; emoji: string }, as?: { q: number; archetype: Archetype; devPct: number; top10Pct: number; insidersPct: number }): Token {
  const chain = pickChain(rng)
  const pad = pickPad(rng, chain)
  // (`as`: a coin launched on a post gets its pull, its kind of dev and that dev's bag from the story market, see sparks.ts.)
  const q = as?.q ?? Math.exp(rng.gauss() * 1.25 - 2.6) // median ≈ 0.07; top 1% ≈ 1.4
  const archetype: Archetype = as?.archetype ?? (q > 1.2 ? rng.weighted<Archetype>({ runner: 5, chaotic: 3, grinder: 1 }) : rng.weighted<Archetype>({ chaotic: 3, rugger: 3, bleeder: 3, runner: 1 }))
  const t = makeToken(rng, { ...base, archetype, chain, pad }, m.time, true, m.native)
  const nu = nativeUsdOf(m.native, chain)
  const p = LAUNCHPADS[pad]
  if (as) {
    t.devPct = as.devPct
    t.top10Pct = as.top10Pct
    t.insidersPct = as.insidersPct
    t.devTrades = undefined
    if (t.devPct > 0.3) logDev(t, { time: t.createdAt, side: 'buy', usd: (t.devPct / 100) * launchMcapUsd(pad, nu) * 1.15 })
  }
  // Dev buy on the curve: price after `sold` tokens leave it is k / (vTokens − sold)².
  const sold = Math.min(p.curveTokens * 0.3, (t.devPct / 100) * SUPPLY)
  const y = p.vTokens - sold
  t.price = (curveK(pad) / y / y) * nu * 1.0005
  t.mcap = t.ath = t.price * SUPPLY
  syncCurve(t, nu)
  t.volume = (t.devPct / 100) * t.mcap
  t.volMark = 0 // the dev's launch-block buy paid the curve fee, so it counts toward creator fees
  t.buys = t.devPct > 0.3 ? 1 : 0 // a brand-new coin has only its dev buy (classic launches start with made-up counts)
  t.sells = 0
  t.win = undefined
  t.rugProb = 0 // on this engine the dev "rugs" by dumping their bag into the curve (see stepFlow)
  if (!(t.devPct > 0.3)) t.devTrades = undefined // (makeToken logged a launch-block dev buy only when there was one)
  t.volatility = 0.02
  t.holders = 1
  t.snipers = 0
  t.sim.flow = { q, att: q * rng.range(0.8, 1.6), ema: t.price, lastTrade: m.time }
  return t
}

/** What wallets from outside the crowd (tracked wallets, bots) bought less what they sold on a coin, in dollars, since trade `from`. */
function outsideNet(t: Token, from: number) {
  let net = 0
  for (const e of t.tape) {
    if (e.id <= from) break
    if (e.walletId) net += e.side === 'buy' ? e.usd : -e.usd
  }
  return net
}

const SNIPE_MEAN = 55 * Math.exp((0.9 * 0.9) / 2) // what one sniper puts in on average (the lognormal below)
/** A launch's snipers in the simulated market: they buy in the launch block, before the coin has been shown to anybody. */
function snipe(m: MarketState, t: Token, rng: Rng, share = 1, usd?: number) {
  const f = t.sim.flow
  if (!f) return
  f.sniped = true
  // (`usd`: about that much money in all, for a coin launched on a post: its snipers go by the post, not by the coin.)
  const n = rng.poisson(usd !== undefined ? usd / SNIPE_MEAN : (2.4 + 9 * f.q) * share)
  t.snipers += n
  for (let k = 0; k < n && t.status === 'bonding'; k++) {
    const usd = fillSim(m, t, 'buy', Math.min(FLOW.maxTrade, lognormal(rng, 55, 0.9)), m.time, walletName(rng), 'sniper')
    if (!(usd >= 1)) continue
    t.volume += usd
    t.buys += 1
    t.win = addWin(getWin(t, m.time), usd, 1, 0)
    t.holders += 1
    f.lastTrade = m.time
  }
}

/**
 * The launch block of a coin a bot chef cooked (a coin of the simulated market: see TOPS): its snipers, and the
 * readers its dev's launch post brings (their orders are waiting in `shillQueue`), all buy before the coin has been
 * shown to anybody, as a crowd launch's snipers do. Every such launch has this pop, so nobody may be in ahead of it.
 * Call it right after the dev's own buy and post. Returns the market with that coin as a fresh copy.
 * `aheadPct`: the share of the supply a REAL player bought in the launch itself (dev buy and bundle). That player is
 * in ahead of the block, and every dollar the snipers bring is theirs to dump on, so snipers pass on a coin whose
 * dev took a big bag (as real ones do): `SNIPE_AHEAD` is sized so the best bag to dump makes less than a launch costs
 * (scripts/cook-report.ts). A bot chef's coin passes nothing: it is the simulated market's own.
 */
export const SNIPE_AHEAD = 4 // % of supply held ahead of the block at which the snipers are down to about a third
export function launchBlock(prev: MarketState, tokenId: string, rng: Rng, aheadPct = 0): MarketState {
  const old = prev.tokens.find((t) => t.id === tokenId)
  if (!old?.sim.flow || old.status !== 'bonding' || old.sim.flow.sniped) return prev
  const t: Token = { ...old, sim: { ...old.sim, flow: { ...old.sim.flow } }, change: { ...old.change } }
  const mine = (prev.shillQueue ?? []).filter((q) => q.tokenId === tokenId && q.side !== 'sell')
  const m: MarketState = { ...prev, tokens: prev.tokens.map((x) => (x === old ? t : x)), shillQueue: (prev.shillQueue ?? []).filter((q) => !mine.includes(q)) }
  snipe(m, t, rng, Math.exp(-Math.max(0, aheadPct) / SNIPE_AHEAD))
  for (const q of mine) {
    const usd = t.status === 'bonding' ? fillSim(m, t, 'buy', q.usd, m.time, q.wallet) : 0
    if (!(usd > 0)) continue
    t.volume += usd
    t.buys += 1
    t.win = addWin(getWin(t, m.time), usd, 1, 0)
    t.holders += 1
  }
  refreshChanges(t, m.time)
  return m
}

const GRAD_SUPPLY = 900 // seconds after bonding that the crowd trades against wallets from outside it
// The fair pull on a coin the regime model moves (see step 4a in tickMarket): what a dump into strength takes off
// the price, and, turned round, what dip buyers add to it (a 20% drop mirrors a 25% bounce).
const POOL_DROP = { median: 0.2, sigma: 0.5, min: 0.08, max: 0.6 }
const [POOL_TAKES, POOL_GIVES] = (() => {
  let takes = 0
  let gives = 0
  let w = 0
  for (let z = -4; z <= 4; z += 0.02) {
    const p = Math.exp(-0.5 * z * z)
    const d = clamp(POOL_DROP.median * Math.exp(POOL_DROP.sigma * z), POOL_DROP.min, POOL_DROP.max)
    takes += p * d
    gives += p * (d / (1 - d))
    w += p
  }
  return [takes / w, gives / w]
})()
/** Curve complete: the raise and leftover tokens seed the DEX pool. */
function migrate(t: Token, m: MarketState, nu: number, emit: (e: Omit<MarketEvent, 'id' | 'tick' | 'time'>) => void) {
  t.status = 'graduated'
  t.graduatedAt = m.time
  t.bondingProgress = 100
  // The pool opens at raise ÷ LP tokens, which can differ from where the curve ended (Flap: ~+11%).
  t.price = migrationPriceNative(t.pad) * nu
  t.mcap = t.price * SUPPLY
  t.ath = Math.max(t.ath, t.mcap)
  t.sim.anchor = Math.log(t.price)
  t.sim.pend = 0
  t.liquidity = migratedLiquidityUsd(t.pad, nu)
  // The crowd's own launches can't rug on the curve (their dev just dumps, see stepFlow), but once there is a pool
  // the insiders who rode the curve up can dump into it, as on any coin of its kind. (Not a cooked coin: its only
  // insider is its dev.)
  if (t.sim.flow && t.creator !== 'you' && !(t.rugProb > 0)) t.rugProb = PROFILES[t.sim.archetype].rug * 2.5
  // A pool starts with no pull either way (it used to open into a pump: buying whatever had just bonded paid, nine
  // times in ten), and for its first minutes the crowd trades against the wallets that rush in (GRAD_SUPPLY, step 4b
  // in tickMarket). From then on it is a pool like any other (step 4a).
  t.sim.regime = 'sideways'
  t.sim.regimeTicks = 30
  t.sim.drift = 0
  t.sim.volMult = REGIME_VOL.sideways
  t.sim.gradSeen = m.nextTradeId - 1
  t.hype = Math.min(t.hype, 45) // (the hype was the curve run: that story is told)
  emit({ kind: 'graduation', tokenId: t.id, ticker: t.ticker, text: `$${t.ticker} completed its ${LAUNCHPADS[t.pad].name} curve and migrated to ${LAUNCHPADS[t.pad].dex}`, icon: '🎓', tone: 'up' })
}

/** One real second of trading on a coin that is still on its curve. */
function stepFlow(t: Token, m: MarketState, rng: Rng, native: MarketState['native'], emit: (e: Omit<MarketEvent, 'id' | 'tick' | 'time'>) => void) {
  const f = t.sim.flow!
  // A coin on a post the timeline has not settled yet is being watched: it keeps that much attention, and it is not
  // written off, until the story is settled one way or the other (see sparks.ts).
  if (t.sim.watch) {
    f.att = Math.max(f.att, t.sim.watch)
    f.lastTrade = m.time
  }
  const nu = nativeUsdOf(native, t.chain)
  const age = m.time - t.createdAt
  const p0 = t.price
  const launchPx = startPriceNative(t.pad) * nu
  const run = t.price / f.ema // >1 while it's pumping: holders start taking profit

  // The fair-market rules below (see TOPS) are for the simulated market: the crowd's own launches and the bot chefs'.
  // A real player's own launch goes as its launch decides, the way every launch did before V2.
  const cooked = t.creator === 'you'
  const rules = TOPS.k > 0 && !(cooked && !f.botDev)

  // Who shows up this second.
  const heat = 1 + FLOW.heatSize * Math.min(6, f.att)
  // A coin that catches on doesn't trade a hundred times a second: the hotter it runs, the slower its clock next to
  // a quiet coin's (the same buyers and sellers, spread over minutes). Without this a winner was through its whole
  // curve in half a minute: nobody could trade it, and the final stretch was a list of coins flashing past.
  // (In the simulated market a coin high on its curve is slower again: the same trades over more seconds, so no
  // odds change, and the final stretch is somewhere a coin can be traded rather than a place it flashes through.)
  const pace = Math.min(1, ((rules ? FLOW.hotPace : FLOW.ownPace) / Math.max(1e-9, f.att * heat)) ** FLOW.hotCurve) * (rules ? 1 - (1 - FLOW.stretchPace) * clamp((t.bondingProgress - 30) / 30, 0, 1) : 1)
  // A cooked coin whose dev (and bundle) sit on a big share of the supply puts the crowd off, as the launch screen
  // says it will: fewer people show up at all.
  const crowd = FLOW.churn * f.att * (cooked ? Math.exp((-COOK_FLOW.perScore * Math.max(0, t.devPct + (t.bundlePct ?? 0) - 3)) / 50) : 1)
  // The crowd's own coins: never the ones in real wallets (players', bots', tracked wallets'), nor its dev's bag
  // (only the dev sells that). And the most a top could take right now: the price with those sold back, bar the
  // share whose holders never sell.
  const bag = () => Math.max(0, LAUNCHPADS[t.pad].vTokens - t.liquidity / 2 / t.price - (t.sim.held ?? 0) - (cooked ? 0 : (t.devPct / 100) * SUPPLY))
  const room = () => {
    const T = t.liquidity / 2 / t.price
    return 1 - (T / (T + bag() * (1 - TOPS.keep))) ** 2
  }
  const bagUsd = Math.min(sellRoom(t), quoteSell(t, bag()).usdOut) // what the crowd could get for all of it, before this second's trades
  // The crowd this second, in two parts kept apart so the sums are exact. In and out: people trading the coin, as much
  // bought as sold on average (activity, no direction). And the drive: what the crowd buys beyond that while the coin
  // has its attention, more when it is moving. (Per trader 0.62 buys and 0.55 sells, the buys bigger: the market as
  // it was. A few trades of either kind are 8 to 40 times the usual size; none is bigger than the cap.)
  const fair = rules && (!!f.sniped || age > 1) // (from its first second: its launch block is behind it, see below)
  const big = 0.003 + 0.004 * Math.min(f.q, 3)
  const sellCap = fair ? Math.min(FLOW.maxTrade, 0.5 * bagUsd) : FLOW.maxTrade // (no one holder sells more than half of what the crowd holds)
  const buyUsd = flowMean(FLOW.buyMedian, FLOW.buySigma, heat, FLOW.maxTrade, big) // the average buy…
  const sellUsd = flowMean(FLOW.sellMedian, FLOW.sellSigma, heat, sellCap, big) // …and the average sell
  let churn = crowd * pace * 0.55 * flowMean(FLOW.sellMedian, FLOW.sellSigma, heat, FLOW.maxTrade, big) // dollars a second, each way
  let drive = crowd * pace * (0.62 + 0.35 * clamp((t.momentum / pace) * 25, -0.4, 0.6)) * buyUsd - churn // dollars a second, net
  if (fair) {
    // Holders can only turn over what they hold (a quarter of it a second, at the most)…
    churn = Math.min(churn, 0.25 * bagUsd)
  }
  // Holders taking profit on a run: sells on top of that, more of them the further the price is over its recent average.
  const taking = Math.sqrt(Math.max(0, t.holders - 1)) * 0.02 * Math.max(0, run - 0.9) * 4 * pace * (fair ? TOPS.taking : 1)
  const takeUsd = flowMean(FLOW.sellMedian, FLOW.sellSigma, heat * Math.sqrt(Math.max(1, run)), sellCap, big)
  // What this second's trading does to the price, on average. A curve's price goes with the square of the money in
  // it, so it is twice the net money over the reserve PLUS the spread of that money squared: trading that is
  // balanced in dollars still lifts the price (a big buy lifts it by more than a big sell drops it).
  const Q0 = Math.max(1, t.liquidity / 2)
  const buySq = flowSquare(FLOW.buyMedian, FLOW.buySigma, heat, FLOW.maxTrade, big) / Math.max(1e-9, buyUsd)
  const restSq = (churn / Math.max(1e-9, sellUsd)) * flowSquare(FLOW.sellMedian, FLOW.sellSigma, heat, sellCap, big) + (taking > 0 ? taking * flowSquare(FLOW.sellMedian, FLOW.sellSigma, heat * Math.sqrt(Math.max(1, run)), sellCap, big) : 0)
  const spread = (d: number) => (churn + Math.max(0, d)) * buySq + restSq
  const climbOf = (d: number) => {
    const net = Math.max(0, d) - taking * takeUsd
    return (2 * net) / Q0 + (net * net + spread(d)) / (Q0 * Q0)
  }
  if (fair) {
    // …and the crowd cannot buy, net, more than a top could take back (see TOPS): a climb nobody could be made to
    // pay for is free money for whoever is in first. Low on a curve, where the crowd holds little, this keeps a
    // coin near its floor until its holders have built up; higher up it never binds. A coin nobody holds gets no
    // net buying at all from the crowd (even a trickle was a free seat at the bottom for whoever waited there):
    // its first holders come in one go, before anybody could be ahead of them (snipers at a launch, the first
    // buyers of a viral moment, a call's or a story's followers), or from outside the crowd.
    const most = topTakes(room()) / TOPS.k
    if (climbOf(drive) > most) {
      let lo = 0
      let hi = drive
      for (let i = 0; i < 12 && climbOf(lo) < most; i++) {
        const mid = (lo + hi) / 2
        if (climbOf(mid) > most) hi = mid
        else lo = mid
      }
      drive = lo
    }
  }
  const nBuy = Math.min(40, rng.poisson((churn + Math.max(0, drive)) / Math.max(1e-9, buyUsd)))
  const nOut = rng.poisson(churn / Math.max(1e-9, sellUsd))
  const nTake = rng.poisson(taking)
  const nSell = Math.min(40, nOut + nTake)

  let vol = 0
  let nb = 0
  let ns = 0
  let netUsd = 0
  const trade = (side: 'buy' | 'sell', usd: number, tag?: TapeTrade['tag'], bot = false, wallet?: string) => {
    // A seller can't get more out than the curve actually holds (the SOL raised so far); fillSim sees to that, and
    // to a buy at the very end of the curve.
    usd = fillSim(m, t, side, Math.max(FLOW.minTrade, side === 'sell' ? Math.min(usd, curveAt(t.pad, t.price / nu).raised * nu * 0.95) : usd), m.time, wallet ?? walletName(rng), tag)
    if (!(usd >= 1)) return
    vol += usd
    if (side === 'buy') nb++
    else ns++
    if (bot) return // bot churn: activity on the tape, but it isn't real interest
    netUsd += side === 'buy' ? usd / heat : -usd / heat // attention follows how many people buy, not how big
    if (side === 'buy') f.lastTrade = m.time // a coin is alive while somebody still buys it (holders trickling out isn't life)
  }
  // Wallets from outside the crowd (tracked wallets, bots): what they bought or sold since the last second, the
  // crowd trades against, about as much. An outsider's order is not news: it is on the tape like anybody's, and on
  // average it does not move the price for good. (Without this the pile-in on whatever is running was a pump
  // anybody could buy ahead of. A player's own order is left alone.)
  if (!rules) f.jolt = undefined
  else {
    const net = outsideNet(t, f.seen ?? m.nextTradeId) + (f.jolt ?? 0) // (and what an event's jump did: a whale, a shill)
    f.seen = m.nextTradeId - 1
    f.jolt = undefined
    if (net > 1) trade('sell', Math.min(net * rng.range(0.5, 1.5), 0.6 * bagUsd), undefined, true)
    else if (net < -1) trade('buy', -net * rng.range(0.5, 1.5), undefined, true)
  }
  // Snipers land with real size (0.3–2 SOL); on hyped launches there are a lot of them. In the simulated market they
  // are in a coin's launch block, before it has been shown to anybody (`snipe` for the crowd's launches, `launchBlock`
  // for a bot chef's): nobody gets in ahead of a pop every launch has. A player's own launch gets them over its
  // first three seconds, as every coin did before V2.
  if (rules ? !f.sniped && age <= 1 : age <= 3) {
    f.sniped = true
    const n = rng.poisson(rules ? 2.4 + 9 * f.q : 0.8 + 3 * f.q)
    t.snipers += n
    for (let k = 0; k < n && t.status === 'bonding'; k++) trade('buy', Math.min(FLOW.maxTrade, lognormal(rng, 55, 0.9)), 'sniper')
  }
  // Volume bots and MEV churn every fresh coin a little, so even quiet ones never look frozen.
  if (age < 180) {
    for (let k = rng.poisson(FLOW.botPairs); k > 0 && t.status === 'bonding'; k--) {
      const usd = lognormal(rng, 6, 0.7)
      trade('buy', usd, undefined, true)
      trade('sell', usd * rng.range(0.9, 1.05), undefined, true)
    }
  }
  // Mayhem coins: an AI agent trades them for their first day, in both directions, with real size.
  if (LAUNCHPADS[t.pad].mayhem && age < D && t.status === 'bonding' && rng.chance(0.12)) {
    trade(rng.chance(0.5 + clamp(t.momentum * 10, -0.2, 0.2)) ? 'buy' : 'sell', lognormal(rng, 40, 0.8), 'agent', true, 'MayhemAI')
  }
  const whale = () => (rng.chance(0.003 + 0.004 * Math.min(f.q, 3)) ? rng.range(8, 40) : 1)
  for (let i = 0, j = 0; i < nBuy || j < nSell; ) {
    // Interleave buys and sells in random order through the second.
    if (j >= nSell || (i < nBuy && rng.chance(nBuy / (nBuy + nSell)))) {
      trade('buy', Math.min(FLOW.maxTrade, lognormal(rng, FLOW.buyMedian, FLOW.buySigma) * heat * whale()))
      i++
    } else {
      // (a holder taking profit on a run sells bigger)
      trade('sell', Math.min(sellCap, lognormal(rng, FLOW.sellMedian, FLOW.sellSigma) * heat * (!fair || rng.chance(nTake / Math.max(1, nOut + nTake)) ? Math.sqrt(Math.max(1, run)) : 1) * whale()))
      j++
    }
    if (t.status !== 'bonding') break
  }

  // Devs love to dump into a pump. (A cooked coin's dev is a player or a bot with a real bag: that one is theirs to sell.)
  if (!cooked && t.devPct > 0.2 && t.price > launchPx * 1.6 && rng.chance(FLOW.devDump * pace)) {
    const frac = rng.chance(0.5) ? 1 : rng.range(0.3, 0.7)
    const usd = quoteSell(t, (t.devPct / 100) * frac * SUPPLY).usdOut // what that many coins fetch from the curve
    const before = t.bondingProgress
    t.devPct *= 1 - frac
    logDev(t, { time: m.time, side: 'sell', usd })
    trade('sell', usd, 'dev')
    f.att *= 0.7
    if (frac === 1 && before >= FLOW.devNews) emit({ kind: 'devsell', tokenId: t.id, ticker: t.ticker, text: `$${t.ticker} dev dumped their whole bag`, icon: DEV_ICON, tone: 'down' })
    t.hype = Math.max(0, t.hype - 10 * frac)
  }

  /** The crowd sells `qty` of its coins in a burst of `n` trades (the first is the big one). */
  const unload = (qty: number, n: number, tag?: TapeTrade['tag']) => {
    for (let k = n; k > 0 && qty > 0 && t.status === 'bonding'; k--) {
      const part = k === 1 ? qty : qty * rng.range(0.3, 0.7)
      qty -= part
      const usd = quoteSell(t, part).usdOut
      if (usd >= FLOW.minTrade) trade('sell', usd, k === n ? tag : undefined)
    }
  }
  // A coin hardly anyone is looking at: its holders leave with what they bought.
  if (fair && FLOW.exit > 0 && t.status === 'bonding' && f.att < FLOW.quiet) unload(bag() * FLOW.exit * (1 - f.att / FLOW.quiet) * rng.range(0.5, 1.5), 1)
  // A top (see TOPS): the crowd is buying more than it sells, and holders who are up cash out into it.
  let topped = 0 // what a top took this second (log)
  if (fair && t.status === 'bonding') {
    // The climb the crowd's trading is worth this second, and what a top can take now. (Low on a curve that is
    // little, so the chance is high and the dump small: flippers. Higher up it is the occasional real dump.)
    // (Holders taking profit on a run pay part of the climb back already: a top is for the rest.)
    const climb = climbOf(drive)
    const most = room()
    const takes = topTakes(most)
    const chance = climb > 0 && takes > 0 ? Math.min(1, (TOPS.k * climb) / takes) : 0
    if (chance > 0 && rng.chance(chance)) {
      const drop = Math.min(most, clamp(lognormal(rng, TOPS.drop.median, TOPS.drop.sigma), TOPS.drop.min, TOPS.drop.max))
      const real = drop >= 0.08 // (a dump worth the name: the small ones are flippers)
      const before = t.price
      // For the price to fall by `drop`, the curve's own coins must grow by 1/√(1 − drop): that many come back.
      unload((t.liquidity / 2 / t.price) * (1 / Math.sqrt(1 - drop) - 1), real ? rng.int(3, 7) : 1, real ? 'whale' : undefined)
      const fell = 1 - t.price / before
      topped = Math.log(before / t.price)
      f.att *= Math.max(0.05, 1 - Math.min(1, fell * TOPS.scare * rng.range(0.8, 1.3)))
      if (real) {
        f.tops = (f.tops ?? 0) + 1
        t.hype = Math.max(0, t.hype - 30 * fell)
      }
    }
  }

  // Attention: fades on its own, grows with net buying (more for coins that have "it"), plus rare viral moments.
  // (Under the fair rules a coin with a crowd keeps it like the best of them, as long as that crowd holds something.
  // A coin everybody has sold is yesterday's: its attention goes fast, and on the ordinary clock, not a hot coin's
  // slow one. Without that a coin that had been hot idled at the bottom of its curve for an hour.)
  const held = fair ? Math.min(1, room() / 0.05) : 1
  const keeps = Math.min(1, Math.max(f.q / 2, fair ? f.att / FLOW.crowdHold : 0)) * held
  f.att = f.att * (FLOW.decay - FLOW.left * (1 - held) + (FLOW.decayGood - FLOW.decay) * keeps) ** (pace + (1 - pace) * (1 - held)) + Math.max(0, netUsd) * FLOW.feedback * Math.min(f.q, 4)
  // What pushes a coin from outside (a dev's volume bot or marketing, a KOL's call, a flagged bundle, a dev sell) is
  // `pressure`: on a curve it doesn't move the price, it brings buyers or drives them off.
  if (t.sim.pressure) {
    f.att = Math.max(0, f.att + t.sim.pressure * FLOW.pressureAtt)
    t.sim.pressure = Math.abs(t.sim.pressure) < 1e-6 ? 0 : t.sim.pressure * 0.88
  }
  if (!f.koth && t.bondingProgress >= FLOW.kothProgress) {
    f.koth = true
    f.att += 1.5 + f.q
    emit({ kind: 'trending', tokenId: t.id, ticker: t.ticker, text: `$${t.ticker} is king of the hill on ${LAUNCHPADS[t.pad].name}`, icon: '👑', tone: 'up' })
  }
  if (rng.chance(0.0008 * Math.min(f.q, 3) * pace)) {
    f.att = f.att * 3 + 2
    // (Its first buyers are in before it is news, like snipers at a launch: what they hold is what a top can take back.)
    if (fair) for (let k = rng.int(2, 5); k > 0 && t.status === 'bonding'; k--) trade('buy', Math.min(FLOW.maxTrade, lognormal(rng, 55, 0.9)))
    emit({ kind: 'viral', tokenId: t.id, ticker: t.ticker, text: `$${t.ticker} is going parabolic`, icon: '🚀', tone: 'up' })
  }
  f.ema = t.price + (f.ema - t.price) * 0.97 ** pace

  // Bookkeeping, same shape as the classic engine.
  const r = Math.log(t.price / p0)
  t.momentum = t.momentum * 0.75 + (r + topped) * 0.25 // (a top is holders cashing out, not buyers staying away)
  t.momentumScore = Math.round(clamp(50 + 50 * Math.tanh(t.momentum / pace / (t.volatility * 1.1)), 0, 100))
  t.volume = t.volume * DECAY_1H + vol
  t.buys = t.buys * DECAY_1H + nb
  t.sells = t.sells * DECAY_1H + ns
  t.win = stepWin(getWin(t, m.time), vol, nb, ns)
  t.holders = Math.max(1, Math.round(t.holders + nb * rng.range(0.5, 0.9) - ns * rng.range(0.3, 0.6)))
  const hypeTarget = clamp(15 + t.momentumScore * 0.4 + Math.min(40, f.att * 8), 0, 100)
  t.hype = clamp(t.hype + (hypeTarget - t.hype) * 0.05, 0, 100)

  if (t.status === 'bonding' && syncCurve(t, nu)) migrate(t, m, nu, emit)
  else if (m.time - f.lastTrade > (t.creator === 'you' ? FLOW.devQuiet : FLOW.deadAfter) && f.att < 0.05 && t.status === 'bonding') {
    // Nobody left: the last holders give up (a few never sell), and the coin sits on its curve forever. (On pump.fun
    // that's ~97%+ of launches.)
    if (rules && FLOW.exit > 0) unload(bag() * rng.range(0.8, 0.97), rng.int(2, 4))
    t.status = 'dead'
    t.diedAt = m.time
  }
  refreshChanges(t, m.time)
  const risk = computeRisk(t, m.time)
  t.riskScore = risk.score
  t.riskLevel = risk.level
}

export interface TickOptions {
  rugMult: number
  protectedIds: Set<string> // held or watched tokens are never delisted
  held?: Map<string, number> // coins in real wallets (players, bots), by coin id: the simulated crowd can't sell those
  tech?: boolean // …and some posts announce a tool, whose coins have a site with a demo (stage 3)
  larps?: boolean // …and some posts are not what they look like (stage 2: real or larp)
  sparks?: boolean // the story market is on: most launches come from posts on the timeline (real-time engine only, see sparks.ts)
}

/** Advance the market one tick. Returns a new MarketState (tokens are fresh copies) and emitted events. */
export function tickMarket(prev: MarketState, rng: Rng, opts: TickOptions): { market: MarketState; events: MarketEvent[] } {
  const m: MarketState = { ...prev, tick: prev.tick + 1, time: prev.time + SIM_SEC_PER_TICK }
  const events: MarketEvent[] = []
  const emit = (e: Omit<MarketEvent, 'id' | 'tick' | 'time'>) => events.push({ ...e, id: m.tick * 100 + events.length, tick: m.tick, time: m.time })

  // 1. Market-wide sentiment: a slow mean-reverting process all tokens load on (creates correlation).
  const sdt = Math.sqrt(DT)
  if (rng.chance(0.004 * DT)) {
    const up = rng.chance(0.5 - prev.sentiment * 0.3)
    m.sentimentTrend = up ? rng.range(0.4, 1) : -rng.range(0.4, 1)
    emit({ kind: up ? 'marketup' : 'marketdown', text: up ? 'Degen season: risk-on across the trenches' : 'Risk-off: the whole market is bleeding', icon: up ? '🌙' : '🥶', tone: up ? 'up' : 'down' })
  }
  m.sentimentTrend *= per(0.985)
  m.sentiment = clamp(prev.sentiment * per(0.992) + m.sentimentTrend * 0.012 * DT + rng.gauss() * 0.02 * sdt, -1, 1)
  const marketShock = rng.gauss() * 0.0025 * sdt

  // Chain coins (SOL / BNB / ETH) drift slowly, lean on market mood, and revert to their anchors.
  const native = { ...(prev.native ?? initNative()) }
  for (const c of CHAIN_IDS) {
    const q = native[c]
    const lp = Math.log(q.price)
    const next = lp + rng.gauss() * 0.0012 * sdt + (m.sentiment * 0.0002 + (Math.log(CHAINS[c].basePrice) - lp) * 0.002) * DT
    native[c] = { ...q, price: Math.exp(next) }
  }
  m.native = native

  // The hot narrative ("meta") rotates every 5–10 real minutes; cooking into it earns extra hype.
  if (!m.meta || m.tick >= (m.metaUntil ?? 0)) {
    const choices = NARRATIVES.filter((n) => n.id !== m.meta)
    const next = rng.pick(choices)
    m.meta = next.id
    m.metaUntil = m.tick + rng.int(300, 600)
    if (prev.meta) emit({ kind: 'meta', text: `New meta: ${next.label} ${next.icon} coins are what everyone wants`, icon: '🔥', tone: 'info' })
  }

  const tokens: Token[] = []
  const realistic = prev.engine === 'realistic'
  for (const old of prev.tokens) {
    const t: Token = { ...old, sim: { ...old.sim, ...(old.sim.flow ? { flow: { ...old.sim.flow } } : {}) }, change: { ...old.change } }
    const s = t.sim
    const age = m.time - t.createdAt
    if (opts.held) s.held = opts.held.get(t.id) ?? 0
    // A curve or pool holds the chain's coin, not dollars: when SOL (BNB, ETH) moves, a coin's dollar price and its
    // pool's dollar size move with it, with no trade. (Its price in SOL is what only trades can change.)
    const fx = nativeUsdOf(native, t.chain) / nativeUsdOf(prev.native, t.chain)
    if (fx !== 1 && fx > 0) {
      t.price *= fx
      t.liquidity *= fx
      t.mcap = t.price * SUPPLY
    }
    // A curve that sold out since the last tick (a player's or a bot's buy took the last tokens) migrates first: a
    // completed curve is closed, nobody can sell back into it.
    if (curveDone(t) && s.rugAt === null) {
      migrate(t, m, nativeUsdOf(native, t.chain), emit)
      pushCandles(t, m.time, t.price, 0)
    }

    // Creator fees: this tick's volume plus anything traded since the last tick (bot wallets, players, follower buys),
    // at the coin's current creator rate (pump.fun: 0.30% on the curve, PumpSwap's tiered 0.95%→0.05% after).
    const volBetween = Math.max(0, old.volume - (old.volMark ?? old.volume))
    const accrue = () => {
      const tickVol = Math.max(0, t.volume - old.volume * DECAY_1H) + volBetween
      if (tickVol > 0) {
        t.creatorFees = (t.creatorFees ?? 0) + tickVol * creatorRate(t)
        t.feesPaid = (t.feesPaid ?? 0) + tickVol * tradeFee(t, 'buy')
      }
      t.volMark = t.volume
    }

    // Realistic engine: a coin on its curve trades by order flow, whoever launched it; dead ones leave the lists within
    // a minute. (A curve coin with no flow yet was launched before that was true of every launch, or by an admin. It
    // joins in as a middling coin: a World saved before the change has dozens of these, and they must not all take
    // off the moment it comes back.)
    if (realistic && !s.flow && t.status === 'bonding') s.flow = { q: clamp(0.1 + t.hype / 250, 0.1, 0.5), att: 0.2, ema: t.price, lastTrade: m.time }
    if (realistic && s.flow) {
      if ((t.status === 'dead' || t.status === 'rugged') && t.diedAt && m.time - t.diedAt > FLOW.delistAfter && !opts.protectedIds.has(t.id) && t.creator !== 'you') {
        candleStore.delete(t.id)
        continue
      }
      if (t.status === 'bonding') {
        stepFlow(t, m, rng, native, emit)
        accrue()
        tokens.push(t)
        continue
      }
    }

    // Delist long-dead tokens nobody holds or watches.
    if ((t.status === 'rugged' || t.status === 'dead') && t.diedAt && m.time - t.diedAt > 900 && !opts.protectedIds.has(t.id) && t.creator !== 'you') {
      candleStore.delete(t.id)
      continue
    }

    // A coin's price is its curve's / pool's reserves, so it only moves when somebody trades. The market's pull on the
    // coin (its regime, the mood, news, momentum) is worked out every tick as before, but it adds up in `pend` and
    // reaches the price when trades come in, as exactly the buying or selling it takes to move the reserves that far.
    const nu = nativeUsdOf(native, t.chain)
    // The fair pull (step 4a, and see TOPS) is for every coin this model moves but a player's own launch still on its curve.
    const fairPull = () => TOPS.k > 0 && (t.status === 'graduated' || (t.status === 'bonding' && t.creator !== 'you'))
    // On a curve, the share of the price that is above the floor it has with all of the crowd's coins sold back.
    const premium = () => (t.status === 'bonding' ? 1 - (1 - Math.min(0.999, sellRoom(t) / Math.max(1, t.liquidity / 2))) ** 2 : 1)
    let r = 0
    let activity = 0
    let vol = 0
    let nb = 0
    let ns = 0
    const add = (side: 'buy' | 'sell', usd: number) => {
      if (!(usd > 0)) return
      vol += usd
      if (side === 'buy') nb++
      else ns++
    }
    if (t.status === 'rugged' || t.status === 'dead') {
      // Nobody trades a dead coin, so its price stays where the last trade left it. (Holders can still sell into
      // whatever is left in the curve / pool.)
      t.hype = Math.max(0, t.hype - 1)
      s.pend = 0
    } else {
      // 2. Rug scheduling: hazard depends on base probability, hype and mode. Warnings usually precede it.
      if (s.rugAt === null && t.rugProb > 0) {
        const hazard = t.rugProb * opts.rugMult * (1 + t.hype / 100) * (t.status === 'bonding' ? 1.4 : 1)
        if (rng.chance(hazard * DT)) {
          s.rugAt = m.tick + Math.round(rng.int(18, 45) / DT)
          if (rng.chance(0.75)) emit({ kind: 'liquidity', tokenId: t.id, ticker: t.ticker, text: `Insider wallets are starting to sell $${t.ticker}`, icon: '⚠️', tone: 'warn' })
        }
      }
      if (s.rugAt !== null && m.tick < s.rugAt) {
        // Before the dump the insiders start unloading: small dev sells, real ones, that you can see on the tape.
        if (t.devPct > 0.05 && rng.chance(0.5 * DT)) {
          const qty = (t.devPct / 100) * SUPPLY * 0.06
          add('sell', fillSim(m, t, 'sell', quoteSell(t, qty).usdOut, m.time, walletName(rng), 'dev'))
          t.devPct *= 0.94
        }
        s.pressure -= 0.0008 * DT
      }
      if (s.rugAt !== null && m.tick >= s.rugAt) {
        // 3. The rug. Liquidity on these launchpads is burned or locked, so nobody can pull the pool: a rug is the
        // insiders dumping their bags, on the curve or into the pool, and the price falls by exactly what that much
        // selling does to the reserves.
        const onCurve = t.status === 'bonding'
        const T = Math.max(1, t.liquidity / 2) / t.price
        const qty = onCurve
          ? Math.max(0, LAUNCHPADS[t.pad].vTokens - T - (s.held ?? 0)) * rng.range(0.6, 0.9) // most of what the crowd ever bought
          : Math.max(((t.devPct + t.insidersPct) / 100) * SUPPLY, T * rng.range(0.7, 1.6))
        const parts = rng.int(2, 4)
        let got = 0
        for (let k = 0; k < parts; k++) {
          const usd = fillSim(m, t, 'sell', quoteSell(t, qty / parts).usdOut, m.time, walletName(rng), 'dev')
          got += usd
          add('sell', usd)
        }
        logDev(t, { time: m.time, side: 'sell', usd: Math.max(1, got) })
        t.devPct = 0
        t.insidersPct = 0
        t.status = 'rugged'
        t.diedAt = m.time
        setRegime(t, 'rug', rng)
        s.pend = 0
        emit({ kind: 'rug', tokenId: t.id, ticker: t.ticker, text: onCurve ? `$${t.ticker} rugged — dev dumped the whole bag into the curve` : `$${t.ticker} rugged — insiders dumped their bags into the pool`, icon: '💀', tone: 'down' })
      } else {
        // 4. Regime-driven return with momentum, mean reversion, market beta and fat tails.
        if ((s.regimeTicks -= DT) <= 0) {
          // (A parabolic run is news when it is over, not when it starts: said at the start it was a tip.)
          if (s.regime === 'moon' && s.moonTell) emit({ kind: 'viral', tokenId: t.id, ticker: t.ticker, text: rng.pick([`$${t.ticker} went parabolic`, `$${t.ticker} sent it — buyers piled in`, `$${t.ticker} just went vertical`]), icon: '🚀', tone: 'up' })
          nextRegime(t, rng)
          if (s.regime === 'moon') {
            // Parabolic runs draw a crowd; most get noticed (the quiet ones reward whoever was watching the chart).
            t.hype = Math.min(100, t.hype + 12)
            s.moonTell = rng.chance(0.7) ? 1 : undefined
          } else s.moonTell = undefined
        }
        const sigma = t.volatility * s.volMult * (1 + s.volBoost)
        const logP = Math.log(t.price) + (s.pend ?? 0) // where the market is pulling the coin to
        r =
          (s.drift + BLEED[s.archetype] * t.volatility + 0.12 * t.momentum + s.meanRev * (s.anchor - logP) + s.beta * m.sentiment * 0.0012 + s.pressure) * DT +
          s.beta * marketShock +
          sigma * sdt * rng.gauss() +
          (rng.chance(0.012 * DT) ? sigma * 4 * rng.gauss() : 0)
        // Gravity: far above its weight class a coin gets heavy (the pull grows the further it goes), and a steady
        // climber eventually tops out and starts to bleed. Rounds rarely get here; a market that never stops would
        // otherwise compound its climbers into the trillions.
        const sizeCap = PROFILES[s.archetype].mcap[1] * SIZE_CAP_MULT
        if (t.mcap > sizeCap) {
          r -= 0.002 * Math.log(t.mcap / sizeCap) * DT
          if (s.archetype === 'grinder' && rng.chance(0.0004 * DT)) s.archetype = 'bleeder'
        }
        r = clamp(r, -0.4, 0.5)
        // On a curve what moves is the money the crowd has in the coin: under the fair rules the pull works on the
        // part of the price above its floor. Close to the floor a coin hardly moves, and it cannot bounce off it.
        // (Worked on the whole price, every fall the floor cut short was a gift to whoever held: coins low on a
        // curve drifted up.)
        if (t.status === 'bonding' && fairPull()) {
          const prem = premium()
          r = Math.log(1 - prem + prem * Math.exp(r))
        }
        s.anchor = s.anchor * per(0.996) + logP * (1 - per(0.996))
        activity = REGIME_ACTIVITY[s.regime]
        s.pend = (s.pend ?? 0) + r
        // A curve has two ends: nothing to sell into below its start, nothing left to buy above its end. A pool has a
        // floor too: the price with every coin that exists sold into it.
        const T = Math.max(1, t.liquidity / 2) / t.price
        if (t.status === 'bonding') {
          const pad = LAUNCHPADS[t.pad]
          s.pend = clamp(s.pend, 2 * Math.log(Math.min(1, T / Math.max(1, pad.vTokens - (s.held ?? 0)))), 2 * Math.log(Math.max(1, T / (pad.vTokens - pad.curveTokens))))
        } else s.pend = Math.max(s.pend, 2 * Math.log(Math.min(1, T / Math.max(1, SUPPLY - (s.held ?? 0)))))
      }
      s.pressure *= per(0.88)
      s.volBoost *= per(0.93)
    }

    // 4a. The fair pull (see TOPS: the same idea as a top on a curve). The pull the market has on a coin lasts for
    // minutes (its regime, its momentum, the mood, news; and plain volatility lifts a price a little by itself), so
    // left alone a pump keeps pumping and buying one pays. Each tick the pull is worth something on average, and it
    // carries a matching chance of a jump the other way: up, that holders sell into the strength in one go; down,
    // that buyers take the dip. A coin still pumps and bleeds, and what its chart has been doing says nothing about
    // what it does next. Every coin this model moves has it (all migrated coins, a classic round's curve coins), bar
    // one whose insiders have begun to leave (the warning is out) and a player's own launch still on its curve.
    if (fairPull() && s.rugAt === null) {
      const sig = t.volatility * s.volMult * (1 + s.volBoost)
      const pull = (s.drift + BLEED[s.archetype] * t.volatility + 0.12 * t.momentum + s.meanRev * (s.anchor - Math.log(t.price) - (s.pend ?? 0)) + s.beta * m.sentiment * 0.0012 + s.pressure + 0.6 * sig * sig) * DT
      if (pull !== 0 && rng.chance(Math.min(1, (TOPS.k * Math.abs(pull)) / (pull > 0 ? POOL_TAKES : POOL_GIVES)))) {
        const drop = clamp(lognormal(rng, POOL_DROP.median, POOL_DROP.sigma), POOL_DROP.min, POOL_DROP.max)
        const side = pull > 0 ? 'sell' : 'buy'
        // Where the price goes: down by `drop`, or up by its mirror (on a curve: that much of the part above the
        // floor). For that, so many coins must come back to the curve / pool, or so much money come in.
        const prem = premium()
        const to = side === 'sell' ? 1 - prem * drop : 1 - prem + prem / (1 - drop)
        let left = side === 'sell' ? (Math.max(1, t.liquidity / 2) / t.price) * (1 / Math.sqrt(to) - 1) : Math.max(1, t.liquidity / 2) * (Math.sqrt(to) - 1)
        for (let k = rng.int(2, 5); k > 0 && left > 0 && (t.status === 'graduated' || t.status === 'bonding'); k--) {
          const part = k === 1 ? left : left * rng.range(0.3, 0.7)
          left -= part
          add(side, fillSim(m, t, side, side === 'sell' ? quoteSell(t, part).usdOut : part, m.time, walletName(rng), left > 0 ? undefined : 'whale'))
        }
        // (What the market is still pulling for stays owed, in `pend`: wiping it here let a quiet coin that was
        // bleeding skip the fall it had not traded yet every time dip buyers showed up.)
      }
    }

    // 4b. An outsider's order is not news: the crowd trades against it, about as much, as it does on a real-time
    // curve (see stepFlow), so on average it does not move the price for good. That is:
    //  - what an event's jump put in or took out since the last tick (a whale's buy, a call's followers), on every
    //    coin: such jumps are far more often up than down, and the hyped coins get most of them;
    //  - what the wallets from outside the crowd did (tracked wallets, bots): on a classic round's curve coins always
    //    (those wallets pile into young coins and leave again, a pump anybody could ride), in a pool for its first
    //    minutes (the holders who rode the curve get out into the rush for the fresh pool, others buy what the
    //    first sellers drop).
    // (A player's own order is left alone: it moves the price exactly as the reserves say.)
    if (!fairPull()) s.jolt = undefined
    else {
      let net = s.jolt ?? 0
      s.jolt = undefined
      if (t.status === 'graduated' && s.gradSeen !== undefined && m.time - (t.graduatedAt ?? 0) > GRAD_SUPPLY) s.gradSeen = undefined
      if (t.status === 'bonding' || s.gradSeen !== undefined) {
        if (s.gradSeen !== undefined) net += outsideNet(t, s.gradSeen)
        s.gradSeen = m.nextTradeId - 1
      }
      if (Math.abs(net) > 1) add(net > 0 ? 'sell' : 'buy', fillSim(m, t, net > 0 ? 'sell' : 'buy', Math.abs(net) * rng.range(0.5, 1.5), m.time, walletName(rng)))
    }

    // 5. This tick's trades. How many show up follows the coin's turnover and how lively its regime is; together they
    // carry the price to where the market was pulling it.
    let live = t.status === 'bonding' || t.status === 'graduated'
    const z = Math.abs(r) / Math.max(1e-6, t.volatility * sdt)
    const baseTickVol = (t.mcap * s.baseTurnover) / HOUR_TICKS
    const wantVol = live ? baseTickVol * (0.45 + 0.35 * z) * (0.5 + t.hype / 100) * activity * Math.exp(0.3 * rng.gauss()) : 0
    const avgSize = clamp(t.mcap * 0.0004, 25, 2500)
    const n = live ? Math.min(14, rng.poisson(wantVol / avgSize)) : 0
    let traded = false
    if (live && n > 0) {
      const p0 = t.price
      const res = tradeTo(m, t, t.price * Math.exp(s.pend ?? 0), rng, {
        wantVol, n, avgSize, seconds: SIM_SEC_PER_TICK,
        tag: (side, usd) => (usd > avgSize * 6 ? 'whale' : rng.chance(0.04) ? 'smart' : age < 300 && side === 'buy' && rng.chance(0.3) ? 'sniper' : undefined),
      })
      traded = res.traded
      vol += res.vol
      nb += res.nb
      ns += res.ns
      s.pend = (s.pend ?? 0) - Math.log(t.price / p0) // what the trades didn't carry stays pending
      if (Math.abs(s.pend) < 1e-9) s.pend = 0
    }
    if (!traded) for (let x = 1; x <= SIM_SEC_PER_TICK; x++) pushCandles(t, m.time - SIM_SEC_PER_TICK + x, t.price, 0) // a quiet tick: flat

    // NPC devs: most sell into early pumps, a few top up. Real trades, in pieces a pool can take: a dev who holds a
    // few percent of the supply can't leave in one go without wrecking the price they're selling at.
    if (live && t.creator !== 'you' && t.devPct > 0.2 && s.rugAt === null) {
      const T = Math.max(1, t.liquidity / 2) / t.price
      if (r > 0 && rng.chance((t.status === 'bonding' ? 0.006 : 0.0015) * DT)) {
        const frac = rng.chance(0.4) ? 1 : rng.range(0.25, 0.7)
        const qty = Math.min((t.devPct / 100) * frac * SUPPLY, T * rng.range(0.04, 0.1))
        const usd = fillSim(m, t, 'sell', quoteSell(t, qty).usdOut, m.time, walletName(rng), 'dev')
        if (usd > 0) {
          add('sell', usd)
          t.devPct = Math.max(0, t.devPct - (qty / SUPPLY) * 100)
          t.hype = Math.max(0, t.hype - 8 * frac)
          logDev(t, { time: m.time, side: 'sell', usd })
        }
      } else if (t.status === 'bonding' && rng.chance(0.0008 * DT)) {
        const before = t.liquidity / 2 / t.price
        const usd = fillSim(m, t, 'buy', (t.liquidity / 2) * rng.range(0.01, 0.04), m.time, walletName(rng), 'dev')
        if (usd > 0) {
          add('buy', usd)
          t.devPct += (Math.max(0, before - t.liquidity / 2 / t.price) / SUPPLY) * 100
          logDev(t, { time: m.time, side: 'buy', usd })
        }
      }
    }
    // Mayhem coins: an AI agent trades them for their first day. Its trades are real too, which is where the wilder
    // candles come from.
    if (live && LAUNCHPADS[t.pad].mayhem && age < D && rng.chance(0.45 * DT)) {
      const side = rng.chance(0.5 + clamp(s.pressure * 40, -0.2, 0.2)) ? 'buy' : 'sell'
      add(side, fillSim(m, t, side, avgSize * rng.range(0.5, 3), m.time, 'MayhemAI', 'agent'))
    }

    // A coin that has outgrown the pool it migrated with draws other liquidity providers (a deposit adds to both sides
    // of a pool, so it moves no price): big real coins hold a few percent of their market cap in their pools, not the
    // fraction of a percent the launch pool alone would have thinned out to.
    if (t.status === 'graduated' && t.liquidity < t.price * SUPPLY * POOL_FLOOR) t.liquidity = t.price * SUPPLY * POOL_FLOOR

    // 6. Volume, buys / sells and holders: counted from the trades that happened.
    t.mcap = t.price * SUPPLY
    t.ath = Math.max(t.ath, t.mcap)
    t.momentum = t.momentum * per(0.75) + (r / DT) * (1 - per(0.75))
    t.momentumScore = Math.round(clamp(50 + 50 * Math.tanh(t.momentum / ((t.volatility / sdt) * 1.1)), 0, 100))
    t.volume = t.volume * DECAY_1H + vol
    if (t.washVol) t.washVol = t.washVol < 1 ? 0 : t.washVol * DECAY_1H
    t.buys = t.buys * DECAY_1H + nb
    t.sells = t.sells * DECAY_1H + ns
    t.win = stepWin(getWin(old, m.time), vol, nb, ns)
    t.holders = Math.max(1, Math.round(t.holders + nb * rng.range(0.2, 0.5) - ns * rng.range(0.15, 0.4) + (live && rng.chance((t.hype / 400) * DT) ? 1 : 0)))

    // Hard ceiling (only ever hit by a market saved before gravity existed): back to a sane price, history and all.
    const ceiling = PROFILES[s.archetype].mcap[1] * SIZE_CAP_MULT * 40
    if (!(t.price * SUPPLY <= ceiling)) {
      t.price = (PROFILES[s.archetype].mcap[1] * SIZE_CAP_MULT) / SUPPLY
      t.mcap = t.price * SUPPLY
      s.anchor = Math.log(t.price)
      s.pend = 0
      t.ath = t.mcap
      t.volume = Math.min(t.volume, t.mcap)
      t.volMark = t.volume
      t.momentum = 0
      if (t.status === 'graduated') t.liquidity = t.mcap * 0.1
    }

    // 7. The curve: complete (the raise and the leftover tokens seed a DEX pool), or abandoned.
    live = t.status === 'bonding' || t.status === 'graduated'
    if (t.status === 'bonding') {
      const complete = syncCurve(t, nu)
      if (complete && s.rugAt === null) {
        migrate(t, m, nu, emit)
        s.pend = 0
      } else if (age > 1200 && t.bondingProgress < 1.5) {
        // Nobody left buying: the coin sits at the bottom of its curve.
        t.status = 'dead'
        t.diedAt = m.time
      }
    }

    // 8. Social hype drifts toward activity level.
    const hypeTarget = live ? clamp(20 + t.momentumScore * 0.5 + Math.min(30, (t.volume / Math.max(1, t.mcap)) * 20), 0, 100) : 0
    t.hype = clamp(t.hype + (hypeTarget - t.hype) * 0.015 * DT + rng.gauss() * 0.6 * sdt, 0, 100)

    refreshChanges(t, m.time)
    const risk = computeRisk(t, m.time)
    t.riskScore = risk.score
    t.riskLevel = risk.level
    accrue()
    tokens.push(t)
  }

  // 8b. Readers of a call or a story who decided to ape: their buys land now, on the same curve / pool as everyone's.
  if (m.shillQueue?.length) {
    const due = m.shillQueue.filter((q) => q.atTick <= m.tick)
    m.shillQueue = m.shillQueue.filter((q) => q.atTick > m.tick)
    for (const q of due) {
      const t = tokens.find((x) => x.id === q.tokenId)
      if (!t || (t.status !== 'bonding' && t.status !== 'graduated')) continue
      if (q.side === 'sell') {
        // An airdrop recipient cashing out what the dev gave them.
        const qty = Math.max(0, q.qty ?? 0)
        if (!(qty > 0)) continue
        const usd = fillSim(m, t, 'sell', quoteSell(t, qty).usdOut, m.time, q.wallet)
        if (!(usd > 0)) continue
        t.volume += usd
        t.sells += 1
        t.win = addWin(getWin(t, m.time), usd, 0, 1)
        t.holders = Math.max(1, t.holders - 1)
        continue
      }
      const got = q.sellAfter ? quoteBuy(t, q.usd).qty : 0
      const usd = fillSim(m, t, 'buy', q.usd, m.time, q.wallet)
      if (!(usd > 0)) continue
      // A follower in it for the flip: exactly the coins this buy got go back to the market later, from the same wallet.
      if (q.sellAfter && got > 0) m.shillQueue.push({ tokenId: t.id, atTick: m.tick + Math.max(1, Math.round(q.sellAfter)), usd: 0, wallet: q.wallet, side: 'sell', qty: got })
      t.volume += usd
      t.buys += 1
      t.win = addWin(getWin(t, m.time), usd, 1, 0)
      t.holders += 1
      if (t.sim.flow) t.sim.flow.lastTrade = m.time
      if (t.status === 'bonding' && syncCurve(t, nativeUsdOf(native, t.chain))) migrate(t, m, nativeUsdOf(native, t.chain), emit)
    }
  }

  // 8c. The story market: posts appear, devs launch coins on them, and the timeline settles on one coin or moves on.
  // (Switched off with stories still open: they are dropped, and their coins fade like any coin.)
  const storyMarket = realistic && !!opts.sparks
  if (storyMarket) stepSparks(m, tokens, native, emit, !!opts.larps, !!opts.tech)
  else if (m.sparks?.length || (m.sparkSim && Object.keys(m.sparkSim).length)) dropSparks(m, tokens)

  // 9. New launches keep the trenches fresh.
  // Hand-written names first, then generated memecoin names; a clash with a live ticker gets a "2"/"3"… suffix.
  const nextName = () => {
    const base = m.launched < LAUNCH_POOL.length ? LAUNCH_POOL[m.launched] : generatedLaunch(m.launched)
    m.launched++
    let ticker = base.ticker
    for (let k = 2; k < 9 && tokens.some((t) => t.ticker === ticker); k++) ticker = `${base.ticker}${k}`
    return tokens.some((t) => t.ticker === ticker) ? null : { ...base, ticker }
  }
  const liveFlow = realistic ? tokens.filter((t) => t.sim.flow && t.status === 'bonding').length : 0
  // (With the story market on, most launches come from posts: what is left here is the noise every market has.)
  if (realistic && liveFlow < FLOW.maxLive && rng.chance(FLOW.launchPerSec * (storyMarket ? 1 - SPARK.share : 1))) {
    // Realistic: launches arrive at the real pace, on every launchpad; most will be dead within a minute.
    const base = nextName()
    if (base) {
      const t = launchFlowToken(rng, m, base)
      pushCandles(t, m.time, t.price, 0)
      snipe(m, t, rng)
      tokens.unshift(t)
      emit({ kind: 'launch', tokenId: t.id, ticker: t.ticker, text: `$${t.ticker} just launched on ${LAUNCHPADS[t.pad].name}`, icon: '🆕', tone: 'info' })
    }
  }
  const liveClassic = tokens.filter((t) => !t.sim.flow && (t.status === 'bonding' || t.status === 'graduated')).length
  if (!realistic && liveClassic < MAX_TOKENS && rng.chance(LAUNCH_CHANCE)) {
    const base = nextName()
    if (base) {
      const chain = pickChain(rng)
      const t = makeToken(rng, { ...base, chain, archetype: rng.weighted<Archetype>({ rugger: 3, chaotic: 3, runner: 2, sleeper: 1, bleeder: 2 }) }, m.time, true, m.native)
      pushCandles(t, m.time, t.price, 0)
      tokens.unshift(t)
      emit({ kind: 'launch', tokenId: t.id, ticker: t.ticker, text: `$${t.ticker} just launched on the curve`, icon: '🆕', tone: 'info' })
    }
  }

  m.tokens = tokens
  m.seed = rng.s
  return { market: m, events }
}

// ─── The story market (see sparks.ts for what it is and why it is fair) ───────
// The kind of coin each kind of dev makes (what it does once it has a pool: a greedy dev's insiders dump into it).
const SPARK_KINDS: Record<SparkDev, Archetype> = { clean: 'runner', plain: 'chaotic', greedy: 'rugger' }
const SPARK_LAUNCHES_A_TICK = 4

/** One second of the story market: settle the stories that are due, launch the coins that are due, maybe a new post. */
function stepSparks(m: MarketState, tokens: Token[], native: MarketState['native'], emit: (e: Omit<MarketEvent, 'id' | 'tick' | 'time'>) => void, larps = false, tech = false) {
  // Its own dice (the market's seed and the tick), so the rest of the market draws the same numbers with it on or off.
  const rng = new Rng(((m.seed ^ 0x51ed270b) + Math.imul(m.tick, 0x9e3779b1)) >>> 0)
  const sims: Record<string, SparkSim> = { ...(m.sparkSim ?? {}) }
  let sparks = m.sparks ?? []
  const change = (id: string, patch: Partial<Spark>) => {
    m.sparkSeq = (m.sparkSeq ?? 0) + 1
    sparks = sparks.map((x) => (x.id === id ? { ...x, ...patch, seq: m.sparkSeq! } : x))
  }

  // (A coin is watched only while its story is open. One whose story is gone, from a save put together some other
  // way, would never be written off.)
  for (const t of tokens) if (t.sim.watch !== undefined && !(t.spark && sims[t.spark.id])) t.sim.watch = undefined

  // 1. The timeline settles on a coin, or moves on.
  for (const [id, sim] of Object.entries(sims)) {
    if (m.time < sim.decideAt) continue
    delete sims[id]
    const spark = sparks.find((x) => x.id === id)
    // A larp comes out: the crowd leaves every coin on it.
    if (sim.larp) {
      exposeSpark(m, tokens, id, rng)
      if (!spark) continue
      change(id, { over: m.time, fake: { kind: sim.larp, time: m.time, ...(sim.real ? { real: sim.real } : {}) } })
      const who = sim.real ? `@${sim.real.handle}` : 'the account'
      emit({ kind: 'sparkfake', sparkId: id, text: sim.larp === 'fake' ? `@${spark.by.handle} is not ${who}: the post was an impersonator's` : sim.larp === 'shot' ? `${who} never posted that: the screenshot was made up` : `${who} was hacked: the post was not theirs`, icon: '🎭', tone: 'down' })
      continue
    }
    const picked = settleSpark(m, tokens, id, sim, rng, native, emit)
    if (!spark) continue
    if (picked) {
      change(id, { picked })
      emit({ kind: 'sparkpick', tokenId: picked.tokenId, ticker: picked.ticker, sparkId: id, text: `The timeline has settled on $${picked.ticker} for @${spark.by.handle}'s post`, icon: '🎯', tone: 'up' })
    } else {
      change(id, { over: m.time })
      if (sim.n > 0) emit({ kind: 'sparkpick', sparkId: id, text: `The timeline moved on from @${spark.by.handle}'s post: no coin was picked`, icon: '💤', tone: 'info' })
    }
  }

  // 2. Devs launch the coins that are due (never past what the market holds at once: those wait a second).
  let live = tokens.filter((t) => t.sim.flow && t.status === 'bonding').length
  for (const [id, old] of Object.entries(sims)) {
    if (!old.due.length || old.due[0] > m.time) continue
    const sim = (sims[id] = { ...old, due: [...old.due] })
    const spark = sparks.find((x) => x.id === id)
    for (let k = 0; sim.due.length && sim.due[0] <= m.time; k++) {
      if (live >= FLOW.maxLive || k >= SPARK_LAUNCHES_A_TICK) {
        sim.due = sim.due.map((at) => Math.max(at, m.time + 1))
        break
      }
      sim.due.shift()
      sim.n++
      // (Every coin on a tech post carries the product's name: only the demo on its site tells them apart.)
      const base = sim.tool ? { name: sim.name, ticker: sim.ticker, emoji: sim.emoji } : coinFor(sim, rng)
      const dev = devFor(rng)
      const t = launchFlowToken(rng, m, base, { q: SPARK.preQ, archetype: SPARK_KINDS[dev.kind], devPct: dev.devPct, top10Pct: dev.top10Pct, insidersPct: dev.insidersPct })
      if (tokens.some((x) => x.id === t.id)) t.id = `${t.ticker}-${Math.floor(rng.next() * 1e9).toString(36)}` // (several coins on a post share a ticker: never an id)
      t.spark = { id, n: sim.n }
      if (sim.tool) {
        t.site = { tool: sim.tool }
        t.sim.demo = rng.weighted(SPARK.demos)
      }
      if (spark?.theme) t.narrative = spark.theme
      t.sim.watch = watchOf(sim.tier, sim.n)
      // (Its risk tag as it will read from now on: the timeline goes by it, and so does anybody reading the card.)
      const risk = computeRisk(t, m.time)
      t.riskScore = risk.score
      t.riskLevel = risk.level
      t.sim.flow!.att = Math.max(t.sim.flow!.att, t.sim.watch)
      pushCandles(t, m.time, t.price, 0)
      // Its snipers go by the post and by how early the coin is, not by what it is called.
      snipe(m, t, rng, 1, blockUsd(sim.tier, sim.n, rng, sim.larp))
      t.sim.flow!.ema = t.price // (they are in for the story: nobody takes profit on the launch block itself)
      tokens.unshift(t)
      live++
      emit({ kind: 'launch', tokenId: t.id, ticker: t.ticker, sparkId: id, text: `$${t.ticker} just launched on ${LAUNCHPADS[t.pad].name}`, icon: '🆕', tone: 'info' })
    }
  }

  // 3. Somebody posts.
  if (rng.chance(sparkRate(FLOW.launchPerSec))) {
    const n = (m.nextSparkId = (m.nextSparkId ?? 0) + 1)
    m.sparkSeq = (m.sparkSeq ?? 0) + 1
    const { spark, sim } = makeSpark(m, rng, `s${n}`, m.sparkSeq, new Set(Object.values(sims).map((x) => x.ticker)), undefined, larps, tech)
    sparks = [spark, ...sparks]
    sims[spark.id] = sim
    emit({ kind: 'spark', sparkId: spark.id, text: `@${spark.by.handle}: ${spark.text}`, icon: spark.kind === 'news' ? '📰' : '📣', tone: 'info' })
  }

  // 4. Old posts leave the list (never one that is still open, or has a coin alive).
  const alive = new Set<string>()
  for (const t of tokens) if (t.spark && (t.status === 'bonding' || t.status === 'graduated')) alive.add(t.spark.id)
  m.sparks = keptSparks(sparks, new Set(Object.keys(sims)), alive, m.time)
  m.sparkSim = sims
}

/** A post turns out to be a larp: its coins stop being watched and the crowd sells what it holds of every one of them. */
function exposeSpark(m: MarketState, tokens: Token[], id: string, rng: Rng) {
  for (const t of tokens) {
    if (t.spark?.id !== id) continue
    t.sim.watch = undefined
    if (t.status !== 'bonding' || !t.sim.flow || curveDone(t)) continue
    let qty = Math.max(0, LAUNCHPADS[t.pad].vTokens - t.liquidity / 2 / t.price - (t.sim.held ?? 0) - (t.creator === 'you' ? 0 : (t.devPct / 100) * SUPPLY)) * SPARK.dump
    for (let k = rng.int(2, 4); k > 0 && qty > 0; k--) {
      const part = k === 1 ? qty : qty * rng.range(0.35, 0.65)
      qty -= part
      const want = quoteSell(t, part).usdOut
      if (want < FLOW.minTrade) continue
      const usd = fillSim(m, t, 'sell', want, m.time, walletName(rng))
      if (!(usd > 0)) continue
      t.volume += usd
      t.sells += 1
      t.win = addWin(getWin(t, m.time), usd, 0, 1)
      t.holders = Math.max(1, t.holders - 1)
    }
    t.sim.flow.att *= 0.05
    t.hype = Math.max(0, t.hype - 30)
    refreshChanges(t, m.time)
  }
}

/** The story market is off: stories still open are closed with no coin picked, and old posts leave the list as they would. */
function dropSparks(m: MarketState, tokens: Token[]) {
  for (const t of tokens) if (t.sim.watch) t.sim.watch = undefined
  const sparks = (m.sparks ?? []).map((s) => (s.picked || s.over !== undefined ? s : { ...s, over: m.time, seq: (m.sparkSeq = (m.sparkSeq ?? 0) + 1) }))
  const alive = new Set<string>()
  for (const t of tokens) if (t.spark && (t.status === 'bonding' || t.status === 'graduated')) alive.add(t.spark.id)
  m.sparks = keptSparks(sparks, new Set(), alive, m.time)
  m.sparkSim = {}
}

/**
 * The timeline settles a story. Its coins stop being watched as a group. If the story went nowhere that is all (they
 * fade like any coin). If it ran, the timeline picks ONE coin, the crowd sells what it holds of the others, and what
 * the picked coin gains is what those lost. All of it is trades, in this one second: by the time anybody reads that
 * a coin was picked, the move is done. Returns the picked coin, or null.
 */
function settleSpark(m: MarketState, tokens: Token[], id: string, sim: SparkSim, rng: Rng, native: MarketState['native'], emit: (e: Omit<MarketEvent, 'id' | 'tick' | 'time'>) => void): Spark['picked'] | null {
  const coins = tokens.filter((t) => t.spark?.id === id && t.status === 'bonding' && !!t.sim.flow && !curveDone(t)).sort((a, b) => a.spark!.n - b.spark!.n)
  for (const t of tokens) if (t.spark?.id === id && t.sim.watch) t.sim.watch = undefined
  if (!sim.runs || !coins.length) return null
  // The crowd's own coins in each (never the ones in real wallets, nor a crowd dev's bag): see `bag` in stepFlow.
  const bagOf = (t: Token) => Math.max(0, LAUNCHPADS[t.pad].vTokens - t.liquidity / 2 / t.price - (t.sim.held ?? 0) - (t.creator === 'you' ? 0 : (t.devPct / 100) * SUPPLY))
  // A coin's stake: the share of its price it loses if the crowd sells what it would (see `SPARK.dump` below).
  const win = coins[pickCoin(coins.map((t) => ({ fit: sim.tool ? SPARK.demoFit[t.sim.demo ?? 'dead'] : fitOf(t, sim), audit: auditOf(t), stake: stakeOf(t.liquidity / 2 / t.price, bagOf(t) * SPARK.dump) })), rng)]
  const count = (t: Token, usd: number, side: 'buy' | 'sell') => {
    t.volume += usd
    if (side === 'buy') t.buys += 1
    else t.sells += 1
    t.win = addWin(getWin(t, m.time), usd, side === 'buy' ? 1 : 0, side === 'sell' ? 1 : 0)
    t.holders = Math.max(1, t.holders + (side === 'buy' ? 1 : -1))
  }
  // The crowd leaves the others…
  let lost = 0 // the shares of their prices the others lost, added up
  let out = 0 // …and the money that came out of them
  for (const t of coins) {
    if (t === win) continue
    const before = t.price
    let qty = bagOf(t) * SPARK.dump
    for (let k = rng.int(2, 4); k > 0 && qty > 0; k--) {
      const part = k === 1 ? qty : qty * rng.range(0.35, 0.65)
      qty -= part
      const want = quoteSell(t, part).usdOut
      if (want < FLOW.minTrade) continue
      const usd = fillSim(m, t, 'sell', want, m.time, walletName(rng))
      if (!(usd > 0)) continue
      out += usd
      count(t, usd, 'sell')
    }
    lost += Math.max(0, 1 - t.price / before)
    t.sim.flow!.att *= 0.05
    t.hype = Math.max(0, t.hype - 25)
    refreshChanges(t, m.time)
  }
  // …for the one it picked: enough buying to lift it by what they fell, and never more money than came out of them.
  const nu = nativeUsdOf(native, win.chain)
  let inflow = Math.min(Math.max(1, win.liquidity / 2) * (Math.sqrt(1 + SPARK.gain * lost) - 1), SPARK.keep * out)
  for (let k = clamp(Math.round(3 + inflow / 250), 3, 16); k > 0 && inflow >= FLOW.minTrade; k--) {
    const part = k === 1 ? inflow : Math.min(inflow, (inflow / k) * rng.range(0.6, 1.4))
    inflow -= part
    // (A coin that sells out its curve on the way migrates, and the rest of the buying lands in its pool.)
    if (win.status === 'bonding' && curveDone(win)) migrate(win, m, nu, emit)
    const usd = fillSim(m, win, 'buy', part, m.time, walletName(rng))
    if (!(usd > 0)) continue
    count(win, usd, 'buy')
    if (win.status === 'bonding' && syncCurve(win, nu)) migrate(win, m, nu, emit)
  }
  const f = win.sim.flow!
  f.q = SPARK.tiers[sim.tier].q * sim.power // it is the coin now: the crowd it has from here is the story's
  f.att += 2 + f.q
  f.lastTrade = m.time
  f.ema = win.price // (the crowd that came for it has only just bought: the run it may take profit on starts here)
  win.hype = clamp(win.hype + 30, 0, 100)
  refreshChanges(win, m.time)
  return { tokenId: win.id, ticker: win.ticker, time: m.time }
}

// ─── Constant-product pool math (used by the trading engine) ─────────────────
// One formula for every coin, the one the real launchpads and DEX pools use: reserves x · y = k. Q is the money side
// of the pool in USD (half the liquidity; on a bonding curve the VIRTUAL reserve) and T = Q / price the token side.
// A price is nothing but those two numbers, so the only thing that can move it is a trade.

/**
 * Fill info for a buy of `usdIn` (after fee). On a bonding curve a buy can't take more tokens than the curve has
 * left: `used` is the part of `usdIn` that was spent (the launchpad doesn't charge the rest), and the coin then sits
 * exactly at the end of its curve, ready to migrate.
 */
export function quoteBuy(t: Token, usdIn: number) {
  const Q = Math.max(1, t.liquidity / 2)
  const T = Q / t.price
  let used = Math.max(0, usdIn)
  let qty = (T * used) / (Q + used)
  if (t.status === 'bonding') {
    const pad = LAUNCHPADS[t.pad]
    const left = Math.max(0, T - (pad.vTokens - pad.curveTokens)) // tokens still for sale on the curve
    if (qty > left) {
      qty = left
      used = (Q * left) / Math.max(1e-9, T - left)
    }
  }
  const avgPrice = used / Math.max(1e-18, qty)
  const newPrice = t.price * ((Q + used) / Q) ** 2
  return { qty, avgPrice, newPrice, slippage: qty > 0 ? avgPrice / t.price - 1 : 0, used }
}

/** Fill info for a sell of `qty` tokens. On a curve no more can come back than the curve ever sold. */
export function quoteSell(t: Token, qty: number) {
  const Q = Math.max(1, t.liquidity / 2)
  const T = Q / t.price
  const sold = t.status === 'graduated' || t.bondingProgress >= 100 ? Infinity : Math.max(0, LAUNCHPADS[t.pad].vTokens - T)
  const q = Math.min(Math.max(0, qty), sold)
  const usdOut = (Q * q) / (T + q)
  const avgPrice = usdOut / Math.max(1e-18, qty)
  const newPrice = t.price * (T / (T + q)) ** 2
  return { usdOut, avgPrice, newPrice, slippage: 1 - avgPrice / t.price }
}

/** True once a curve has sold everything it had. From then on it is closed: it only migrates. */
export const curveDone = (t: Token) => t.status === 'bonding' && t.liquidity / 2 / t.price <= (LAUNCHPADS[t.pad].vTokens - LAUNCHPADS[t.pad].curveTokens) * (1 + 1e-7)

/**
 * The most money a simulated sell can take out right now. From a curve: only what buyers put in. From a pool: only
 * what selling every coin that exists outside it would fetch (which is why a dead migrated coin still shows a few
 * thousand dollars of market cap: a pool can't be sold down to nothing). And never the coins in a real wallet: the
 * crowd can sell what the crowd bought, so the money behind a player's own bag stays in the curve / pool until that
 * player sells. (Without this a made-up whale could sell more than had ever been bought by anyone but the dev, and a
 * dev who was first in found their coins worth less than the curve's own starting price.)
 */
function sellRoom(t: Token) {
  const Q = Math.max(1, t.liquidity / 2)
  const mine = t.sim.held ?? 0 // coins in real wallets are not the crowd's to sell
  if (t.status !== 'bonding') return Math.max(0, Q * Math.min(0.9, 1 - Q / t.price / Math.max(1, SUPPLY - mine)))
  // Q − Q at the curve's floor (syncCurve holds a coin a hair above its start price: 1.0005 ×, so √ of that in Q).
  return Math.max(0, Q * (1 - (Q / t.price / Math.max(1, LAUNCHPADS[t.pad].vTokens - mine)) * Math.sqrt(1.0005)))
}

export const walletNameFrom = (rand: () => number) => `${WALLET_PREFIXES[Math.floor(rand() * WALLET_PREFIXES.length) % WALLET_PREFIXES.length]}…${WALLET_SUFFIXES[Math.floor(rand() * WALLET_SUFFIXES.length) % WALLET_SUFFIXES.length]}`

/**
 * One simulated wallet's trade. `usd` is the money that goes into the curve / pool (a buy) or comes out of it (a sell);
 * the price moves by exactly what that does to the reserves, the trade goes on the tape and the chart gets the print.
 * Returns the money that really traded (a buy is cut at the end of a curve, a sell at what the curve / pool holds).
 */
export function fillSim(m: MarketState, t: Token, side: 'buy' | 'sell', usd: number, time: number, wallet: string, tag?: TapeTrade['tag'], more?: Partial<TapeTrade>): number {
  if (curveDone(t)) return 0 // sold out: nothing trades on it until it has migrated
  const Q = Math.max(1, t.liquidity / 2)
  const prev = t.price
  if (side === 'buy') {
    const q = quoteBuy(t, usd)
    usd = q.used
    if (!(usd > 0)) return 0
    t.price = q.newPrice
  } else {
    usd = Math.min(usd, sellRoom(t))
    if (!(usd > 0)) return 0
    t.price = prev * ((Q - usd) / Q) ** 2
  }
  t.mcap = t.price * SUPPLY
  if (t.mcap > t.ath) t.ath = t.mcap
  if (t.status === 'bonding') syncCurve(t, nativeUsdOf(m.native, t.chain))
  else t.liquidity = 2 * (side === 'buy' ? Q + usd : Q - usd)
  pushCandles(t, time, prev, usd)
  addTape(m, t, { time, side, usd, price: t.price, wallet, tag, ...more })
  return usd
}

/**
 * Take a coin to `target` price the only way a price can move: with trades. The trades are sized so that buys minus
 * sells is exactly the money the curve / pool needs to get there, and at least `wantVol` changes hands (a move needs
 * at least its own money; quiet coins trade little more than that, busy ones a lot more, in both directions).
 * `seconds` spreads them over the tick. Returns what traded.
 */
function tradeTo(m: MarketState, t: Token, target: number, rng: Rng, o: { wantVol: number; n: number; avgSize: number; seconds: number; tag?: (side: 'buy' | 'sell', usd: number) => TapeTrade['tag'] }) {
  const out = { vol: 0, nb: 0, ns: 0, traded: false }
  const Q = Math.max(1, t.liquidity / 2)
  const delta = Q * (Math.sqrt(Math.max(1e-12, target / t.price)) - 1) // + money in, − money out
  const need = Math.abs(delta)
  const V = Math.max(o.wantVol, need * (1 + (o.n > 1 ? rng.range(0.05, 0.6) : 0)))
  const count = Math.max(1, Math.min(14, Math.max(o.n, Math.round(V / (o.avgSize * 1.8)))))
  let buyUsd = (V + delta) / 2
  let sellUsd = (V - delta) / 2
  // A lone trade, or one side too small to be a trade: everything goes the way the price is going.
  if (count === 1 || Math.min(buyUsd, sellUsd) < 1) {
    buyUsd = delta > 0 ? need : 0
    sellUsd = delta > 0 ? 0 : need
  }
  if (buyUsd + sellUsd < 1) return out // nothing worth a trade: what was pending waits for the next one
  const nBuys = buyUsd <= 0 ? 0 : sellUsd <= 0 ? count : Math.max(1, Math.min(count - 1, Math.round((count * buyUsd) / (buyUsd + sellUsd))))
  const weights = Array.from({ length: count }, () => Math.exp(0.9 * rng.gauss()))
  const wBuy = weights.slice(0, nBuys).reduce((a, w) => a + w, 0)
  const wSell = weights.slice(nBuys).reduce((a, w) => a + w, 0)
  const legs = weights.map((w, i) => (i < nBuys ? { side: 'buy' as const, usd: (buyUsd * w) / wBuy } : { side: 'sell' as const, usd: (sellUsd * w) / wSell }))
  // Random order, but never an order the reserves can't do (on a curve, a sell before the buys that pay for it).
  const start = m.time - o.seconds
  let sec = 0
  for (let k = 1; legs.length; k++) {
    let i = rng.int(0, legs.length - 1)
    if (legs[i].side === 'sell' && legs[i].usd > sellRoom(t) + 1e-9) {
      const j = legs.findIndex((l) => l.side === 'buy')
      if (j >= 0) i = j
    }
    const leg = legs.splice(i, 1)[0]
    const at = Math.max(sec, Math.max(1, Math.ceil((k / count) * o.seconds)))
    for (let x = sec + 1; x < at; x++) pushCandles(t, start + x, t.price, 0) // the seconds nobody traded in are flat
    sec = at
    const usd = fillSim(m, t, leg.side, leg.usd, start + at, walletName(rng), o.tag?.(leg.side, leg.usd))
    if (!(usd > 0)) continue
    out.traded = true
    out.vol += usd
    if (leg.side === 'buy') out.nb++
    else out.ns++
  }
  for (let x = sec + 1; x <= o.seconds; x++) pushCandles(t, start + x, t.price, 0)
  return out
}

/**
 * An outside push on a coin's price (news, a whale, a dev taking profits) as what it really is: trades. Moves the
 * price by `pct` (a fraction, + or −) through the curve / pool and returns the money that traded.
 */
export function joltByTrades(m: MarketState, t: Token, pct: number, rng: Rng, tag?: TapeTrade['tag'], parts = 1) {
  if (t.status !== 'bonding' && t.status !== 'graduated') return 0
  const Q = Math.max(1, t.liquidity / 2)
  const total = Math.abs(Q * (Math.sqrt(Math.max(1e-12, 1 + pct)) - 1))
  const side = pct >= 0 ? 'buy' : 'sell'
  let done = 0
  for (let i = 0; i < parts; i++) done += fillSim(m, t, side, total / parts, m.time, walletName(rng), tag)
  if (done > 0) {
    t.volume += done
    if (side === 'buy') t.buys += parts
    else t.sells += parts
    t.win = addWin(getWin(t, m.time), done, side === 'buy' ? parts : 0, side === 'sell' ? parts : 0)
  }
  return done
}

/**
 * Somebody else's trade landing between two of a player's steps (the buyers who got in first while an order was on its
 * way, a sandwich bot's two legs). Give the money into the curve / pool for a buy, or out of it for a sell (`usd`),
 * or a number of tokens to sell (`qty`). Returns the new market and what changed hands.
 */
export function applySimTrade(m: MarketState, tokenId: string, side: 'buy' | 'sell', amount: { usd: number } | { qty: number }, wallet: string, tag?: TapeTrade['tag']): { market: MarketState; usd: number; qty: number } {
  const old = m.tokens.find((x) => x.id === tokenId)
  if (!old || (old.status !== 'bonding' && old.status !== 'graduated')) return { market: m, usd: 0, qty: 0 }
  const t: Token = { ...old, sim: { ...old.sim }, change: { ...old.change } }
  const next: MarketState = { ...m }
  const tokensBefore = t.liquidity / 2 / t.price
  const want = 'usd' in amount ? amount.usd : quoteSell(t, amount.qty).usdOut
  const usd = fillSim(next, t, side, want, m.time, wallet, tag)
  if (!(usd > 0)) return { market: m, usd: 0, qty: 0 }
  t.volume += usd
  if (side === 'buy') t.buys += 1
  else t.sells += 1
  t.win = addWin(getWin(old, m.time), usd, side === 'buy' ? 1 : 0, side === 'sell' ? 1 : 0)
  refreshChanges(t, m.time)
  return { market: { ...next, tokens: m.tokens.map((x) => (x.id === tokenId ? t : x)) }, usd, qty: Math.abs(tokensBefore - t.liquidity / 2 / t.price) }
}

/** Apply a player trade's price impact to the token and add it to the tape. */
export function applyPlayerTrade(m: MarketState, tokenId: string, side: 'buy' | 'sell', usd: number, newPrice: number, who?: { name: string; pid?: string; addr?: string; walletId?: string }): MarketState {
  const tokens = m.tokens.map((old) => {
    if (old.id !== tokenId) return old
    const t: Token = { ...old, sim: { ...old.sim }, change: { ...old.change } }
    const prevPrice = t.price
    t.price = newPrice
    t.mcap = newPrice * SUPPLY
    t.ath = Math.max(t.ath, t.mcap)
    t.volume += usd
    t.win = addWin(getWin(old, m.time), usd, side === 'buy' ? 1 : 0, side === 'sell' ? 1 : 0)
    if (side === 'buy') {
      t.buys += 1
      t.holders += old.holders > 0 ? 1 : 0
    } else t.sells += 1
    // Sells move the curve too: without this, the next wallet selling in the same tick is paid off the pre-sell reserves.
    if (t.status === 'bonding') syncCurve(t, nativeUsdOf(m.native, t.chain))
    else poolFollows(t, prevPrice)
    if (t.sim.flow && side === 'buy') t.sim.flow = { ...t.sim.flow, lastTrade: m.time } // somebody is still buying it: not a dead coin
    // These coins are in a real wallet now (or have left one): see sellRoom. The next tick counts the wallets again.
    if (t.sim.held !== undefined) t.sim.held = Math.max(0, t.sim.held + old.liquidity / 2 / prevPrice - t.liquidity / 2 / t.price)
    // Multiplayer: the server tags another player's trade with their name and id (each browser shows its own as YOU).
    const entry: TapeTrade = who ? { id: m.nextTradeId, time: m.time, side, usd, price: newPrice, wallet: who.name, ...(who.pid ? { pid: who.pid } : {}), ...(who.addr ? { addr: who.addr } : {}), ...(who.walletId ? { walletId: who.walletId } : {}) } : { id: m.nextTradeId, time: m.time, side, usd, price: newPrice, wallet: 'YOU', tag: 'you' }
    t.tape = [entry, ...t.tape].slice(0, TAPE_LEN)
    pushCandles(t, m.time, prevPrice, usd)
    refreshChanges(t, m.time)
    return t
  })
  return { ...m, tokens, nextTradeId: m.nextTradeId + 1 }
}

// ─── Cooking: player-launched tokens ─────────────────────────────────────────
export const COOK_FEE = 50 // was 25 until 2026-10-08: with it the best free launch in the World still made about +$32 (scripts/cook-report.ts)
export const GRAD_BONUS = 250 // USD paid to a coin's creator when it graduates
export const COOK_COOLDOWN_TICKS = 30
export const MAX_COOKS_PER_ROUND = 8
// The World never ends a round, so a per-round cap would be a cap for life. There it's launches per hour instead.
export const WORLD_COOKS_PER_HOUR = 10

/** How many launches you have left: per round, or in the World per rolling hour of game time. */
export function cookAllowance(world: boolean, launchTicks: number[], tick: number, secPerTick: number) {
  if (!world) {
    const used = launchTicks.length
    return { used, max: MAX_COOKS_PER_ROUND, per: 'round', blocked: used >= MAX_COOKS_PER_ROUND ? `Max ${MAX_COOKS_PER_ROUND} launches per round` : null }
  }
  const hour = 3600 / secPerTick
  const recent = launchTicks.filter((t) => tick - t < hour).sort((a, b) => a - b)
  const used = recent.length
  const waitMin = used >= WORLD_COOKS_PER_HOUR ? Math.max(1, Math.ceil(((recent[0] + hour - tick) * secPerTick) / 60)) : 0
  return { used, max: WORLD_COOKS_PER_HOUR, per: 'hour', blocked: waitMin ? `${WORLD_COOKS_PER_HOUR} launches an hour: next one in ${waitMin} min` : null }
}

/**
 * How appealing a launch looks to the (simulated) market, 0..1. Deterministic; the actual launch adds luck.
 * Meta match, socials, marketing and a clean holder spread help; a heavy dev bag hurts.
 */
/**
 * What vamping a coin does to your launch: copying a coin that's running rides its hype; copying a dead or rugged
 * one just looks like a leftover. 0 when it isn't a vamp.
 */
export function vampBoost(orig: Token | undefined) {
  if (!orig) return 0
  if (orig.status === 'dead' || orig.status === 'rugged') return -0.1
  const hot = orig.hype / 100 * 0.12 + clamp(orig.change['1h'] ?? 0, -0.5, 2) * 0.06 + (orig.momentumScore > 60 ? 0.04 : 0)
  return clamp(hot, -0.05, 0.25)
}

export function cookQuality(spec: CookSpec, meta: MarketState['meta'], devPct: number, orig?: Token) {
  const socials = Number(spec.socials.x) + Number(spec.socials.tg) + Number(spec.socials.web)
  return clamp(
    0.22 +
      vampBoost(orig) +
      (spec.narrative === meta ? 0.28 : 0) +
      socials * 0.06 +
      0.1 * Math.log10(1 + spec.marketing / 100) +
      (spec.style === 'hyped' ? 0.1 : spec.style === 'stealth' ? -0.06 : 0) +
      (spec.description.trim().length >= 20 ? 0.03 : 0) -
      Math.max(0, devPct - 3) / 50,
    0,
    1,
  )
}

/** Put a player-designed token on the MoonPad curve. The dev buy is executed separately by the trading engine. */
export function cookToken(prev: MarketState, rng: Rng, spec: CookSpec): { market: MarketState; token: Token; event: MarketEvent } {
  const orig = spec.vampOf ? prev.tokens.find((x) => x.id === spec.vampOf) : undefined
  const score = clamp(cookQuality(spec, prev.meta, 0, orig) + rng.gauss() * 0.15, 0, 1)
  const archetype = rng.weighted<Archetype>({ runner: 0.5 + 4 * score, chaotic: 1.5, bleeder: 2.2 - 2 * score, sleeper: 0.8 })
  const t = makeToken(rng, { ticker: spec.ticker, name: spec.name, emoji: spec.emoji, archetype, chain: spec.chain, pad: spec.pad }, prev.time, true, prev.native)
  // Your coin starts exactly at the bottom of the curve; the dev buy and bundle happen after.
  const nu = nativeUsdOf(prev.native, t.chain)
  t.price = startPriceNative(t.pad) * nu * 1.0005
  t.mcap = t.ath = t.price * SUPPLY
  syncCurve(t, nu)
  t.tax = LAUNCHPADS[t.pad].tax ? { ...spec.tax } : undefined
  t.devTrades = []
  t.volMark = t.volume // your dev buy and first trades (before the coin's first tick) earn creator fees too
  t.hue = spec.hue
  t.creator = 'you'
  if (spec.image) t.image = spec.image
  t.narrative = spec.narrative
  t.description = spec.description.trim() || undefined
  t.socials = { ...spec.socials }
  t.hype = clamp(20 + score * 70 + rng.range(-5, 5), 5, 100)
  if (orig) {
    // A vamp: the crowd chasing the original spills over for a while (and it's labelled a copycat everywhere).
    t.vampOf = { id: orig.id, ticker: orig.ticker }
    if (orig.status === 'bonding' || orig.status === 'graduated') {
      t.hype = clamp(t.hype + orig.hype * 0.2, 5, 100)
      if (orig.momentumScore > 55) t.sim.pressure += 0.002
    }
  }
  t.rugProb = 0 // you're the dev — the only rug risk is you
  t.devPct = 0
  t.snipers = spec.style === 'hyped' ? rng.int(8, 20) : spec.style === 'stealth' ? rng.int(0, 3) : rng.int(2, 9)
  t.top10Pct = spec.style === 'stealth' ? rng.range(10, 20) : spec.style === 'hyped' ? rng.range(25, 45) : rng.range(15, 30)
  t.insidersPct = spec.style === 'hyped' ? rng.range(5, 15) : rng.range(0, 5)
  t.sim.pressure += 0.002 * Math.log10(1 + spec.marketing / 50) + (spec.style === 'hyped' ? 0.004 : 0)
  if (spec.style === 'hyped') t.sim.volBoost += 0.8
  if (rng.chance(score)) setRegime(t, 'pump', rng)
  else setRegime(t, rng.chance(0.5) ? 'accumulation' : 'sideways', rng)
  if (prev.engine === 'realistic') {
    // On the real-time engine a launch lives the way launches do: by who shows up to trade it (see stepFlow). How
    // much of the crowd that is follows how good the launch looks, with a lot of luck on top: a lazy launch is dead
    // in a minute like most real ones, a strong one in the hot meta bonds more often than not.
    const q = Math.exp(COOK_FLOW.base + COOK_FLOW.perScore * score + COOK_FLOW.luck * rng.gauss())
    t.sim.flow = { q, att: q * rng.range(0.8, 1.6), ema: t.price, lastTrade: prev.time }
    // It starts with nothing but its dev: no made-up holders, trades or snipers (the real ones arrive in stepFlow, and
    // holders who never bought would be selling the dev's own money back out of the curve).
    t.holders = 0
    t.snipers = 0
    t.volume = t.volMark = t.buys = t.sells = t.feesPaid = 0
    t.win = undefined
  }
  const risk = computeRisk(t, prev.time)
  t.riskScore = risk.score
  t.riskLevel = risk.level
  pushCandles(t, prev.time, t.price, 0)
  const event: MarketEvent = {
    id: prev.tick * 100 + 99, tick: prev.tick, time: prev.time, kind: 'cook', tokenId: t.id, ticker: t.ticker,
    text: `$${t.ticker} was just cooked on ${LAUNCHPADS[t.pad].name} (by you)`, icon: '🍳', tone: 'info',
  }
  return { market: { ...prev, tokens: [t, ...prev.tokens] }, token: t, event }
}

// ─── Admin tools (god mode) ──────────────────────────────────────────────────
// Hidden on purpose: pumps and dumps are split across made-up wallets, a rug plays out like any other rug, and a
// spawned coin launches like any other. Used by the room server and, in solo, by the admin's own browser.
export type AdminMarketAction =
  | { kind: 'pump' | 'dump'; tokenId: string; usd: number }
  | { kind: 'rug'; tokenId: string }
  | { kind: 'spawn'; chain: Chain; archetype: Archetype }
  | { kind: 'mood'; sentiment: number }

export function adminMarket(prev: MarketState, a: AdminMarketAction, rng: Rng): { market: MarketState; error?: string; tokenId?: string } {
  let m = prev
  if (a.kind === 'mood') {
    const s = Math.max(-1, Math.min(1, a.sentiment))
    return { market: { ...m, sentiment: s, sentimentTrend: s >= m.sentiment ? 1 : -1 } }
  }
  if (a.kind === 'spawn') {
    const base = generatedLaunch(m.launched)
    let ticker = base.ticker
    for (let k = 2; k < 9 && m.tokens.some((t) => t.ticker === ticker); k++) ticker = `${base.ticker}${k}`
    const t = makeToken(rng, { ...base, ticker, chain: a.chain, archetype: a.archetype }, m.time, true, m.native)
    pushCandles(t, m.time, t.price, 0)
    return { market: { ...m, launched: m.launched + 1, tokens: [t, ...m.tokens] }, tokenId: t.id }
  }
  const t = m.tokens.find((x) => x.id === a.tokenId)
  if (!t || (t.status !== 'bonding' && t.status !== 'graduated')) return { market: m, error: 'That coin is not trading' }
  if (a.kind === 'rug') {
    // The dev pulls on the next tick, exactly like a natural rug (same event, same chart).
    return { market: { ...m, tokens: m.tokens.map((x) => (x.id === t.id ? { ...x, sim: { ...x.sim, rugAt: m.tick } } : x)) } }
  }
  const usd = Math.max(1, Math.min(5_000_000, a.usd))
  // Split into a few trades from different wallets so it reads like a crowd, not one whale.
  const parts = Math.max(1, Math.min(8, Math.round(Math.log10(usd))))
  for (let i = 0; i < parts; i++) {
    const cur = m.tokens.find((x) => x.id === t.id)!
    if (cur.status !== 'bonding' && cur.status !== 'graduated') break
    const slice = (usd / parts) * (0.6 + rng.next() * 0.8)
    if (a.kind === 'pump') {
      m = applyPlayerTrade(m, cur.id, 'buy', slice, quoteBuy(cur, slice).newPrice, { name: walletName(rng) })
    } else {
      const qty = Math.min(slice / cur.price, SUPPLY * 0.2)
      const q = quoteSell(cur, qty)
      m = applyPlayerTrade(m, cur.id, 'sell', qty * cur.price, Math.max(1e-13, q.newPrice), { name: walletName(rng) })
    }
  }
  return { market: m }
}
