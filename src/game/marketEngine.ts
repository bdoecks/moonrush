import { CHAIN_IDS, CHAINS } from '../data/chains'
import { NARRATIVES } from '../data/narratives'
import { generatedLaunch, INITIAL_TOKENS, LAUNCH_POOL, WALLET_PREFIXES, WALLET_SUFFIXES } from '../data/tokens'
import type { Archetype, Candle, Chain, CookSpec, DevTrade, NativeQuote, MarketEngine, MarketEvent, MarketState, PadId, Regime, RiskLevel, TapeTrade, Timeframe, Token, TokenSim } from '../types'
import { TF_SECONDS, TIMEFRAMES } from '../types'
import { clamp, Rng } from '../utils/rng'
import { LAUNCHPADS, padFromId, padsFor } from '../data/launchpads'
import { addWin, getWin, stepWin } from './windows'
import { creatorRate } from './tradingEngine'
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
}
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
  pushCandles(t, time, prevPrice, usd)
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

// ─── Realistic engine: pump.fun order flow ───────────────────────────────────
// Calibrated to pump.fun (2026): ~30–50k launches a day, median fill ~$10, average ~$40, and a graduation rate
// "juiced" to ~3% (real: 0.2–2.7%) so a 20-minute round reliably has winners. On the curve, price is nothing but the
// sum of buys and sells: every simulated trade goes through the curve math, exactly like a player's.
export const FLOW = {
  launchPerSec: 0.4, // pump.fun launches per real second (~24 a minute; real: ~21–36)
  maxLive: 70, // pump.fun coins alive on their curves at once
  buyMedian: 12,
  buySigma: 1.6, // lognormal: median $12, mean ≈ $43
  sellMedian: 10,
  sellSigma: 1.5,
  maxTrade: 6000,
  decay: 0.955, // attention half-life ~15s without buyers…
  decayGood: 0.995, // …up to ~2 min for the coins that catch on
  feedback: 0.00012, // attention gained per $ of net buying, scaled by quality
  deadAfter: 25, // seconds with no trades (and no attention) before a coin is dead
  delistAfter: 60, // seconds a dead coin lingers before it leaves the lists (unless you hold/watch it)
  kothProgress: 50, // "king of the hill": the attention bump pump.fun gives coins about halfway up the curve
  churn: 3, // traders per unit of attention (buys and sells both, so it adds activity without adding direction)
  heatSize: 0.8, // hot coins draw real degens (0.1–2 SOL), not just $10 dust: size scales up with attention
  botPairs: 0.3, // fresh coins: volume-bot / MEV buy+sell pairs per second for their first 3 minutes
  minTrade: 1,
}

const lognormal = (rng: Rng, median: number, sigma: number) => median * Math.exp(sigma * rng.gauss())

/** A realistic pump.fun launch: starts at the bottom of its curve, plus whatever the dev bought in the launch block. */
function launchFlowToken(rng: Rng, m: MarketState, base: { ticker: string; name: string; emoji: string }): Token {
  const q = Math.exp(rng.gauss() * 1.25 - 2.6) // median ≈ 0.07; top 1% ≈ 1.4
  const archetype: Archetype = q > 1.2 ? rng.weighted<Archetype>({ runner: 5, chaotic: 3, grinder: 1 }) : rng.weighted<Archetype>({ chaotic: 3, rugger: 3, bleeder: 3, runner: 1 })
  const t = makeToken(rng, { ...base, archetype, chain: 'sol', pad: 'pump' }, m.time, true, m.native)
  const nu = nativeUsdOf(m.native, 'sol')
  const p = LAUNCHPADS.pump
  // Dev buy on the curve: price after `sold` tokens leave it is k / (vTokens − sold)².
  const sold = Math.min(p.curveTokens * 0.3, (t.devPct / 100) * SUPPLY)
  const y = p.vTokens - sold
  t.price = (curveK('pump') / y / y) * nu * 1.0005
  t.mcap = t.ath = t.price * SUPPLY
  syncCurve(t, nu)
  t.volume = (t.devPct / 100) * t.mcap
  t.volMark = 0 // the dev's launch-block buy paid the curve fee, so it counts toward creator fees
  t.buys = t.devPct > 0.3 ? 1 : 0 // a brand-new coin has only its dev buy (classic launches start with made-up counts)
  t.sells = 0
  t.win = undefined
  t.rugProb = 0 // on this engine the dev "rugs" by dumping their bag into the curve (see stepFlow)
  t.volatility = 0.02
  t.holders = 1
  t.snipers = 0
  t.sim.flow = { q, att: q * rng.range(0.8, 1.6), ema: t.price, lastTrade: m.time }
  return t
}

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
  t.liquidity = migratedLiquidityUsd(t.pad, nu)
  t.sim.pressure += 0.006
  t.hype = Math.min(100, t.hype + 15)
  emit({ kind: 'graduation', tokenId: t.id, ticker: t.ticker, text: `$${t.ticker} completed its ${LAUNCHPADS[t.pad].name} curve and migrated to ${LAUNCHPADS[t.pad].dex}`, icon: '🎓', tone: 'up' })
}

/** One real second of trading on a realistic pump.fun coin. Returns false once it's dead (and should be delisted). */
function stepFlow(t: Token, m: MarketState, rng: Rng, native: MarketState['native'], emit: (e: Omit<MarketEvent, 'id' | 'tick' | 'time'>) => void) {
  const f = t.sim.flow!
  const nu = nativeUsdOf(native, t.chain)
  const age = m.time - t.createdAt
  const p0 = t.price
  const launchPx = startPriceNative(t.pad) * nu
  const run = t.price / f.ema // >1 while it's pumping: holders start taking profit

  // Who shows up this second.
  const heat = 1 + FLOW.heatSize * Math.min(6, f.att)
  let nBuy = rng.poisson(FLOW.churn * f.att * (0.62 + 0.35 * clamp(t.momentum * 25, -0.4, 0.6)))
  let nSell = rng.poisson(FLOW.churn * f.att * 0.55 + Math.sqrt(Math.max(0, t.holders - 1)) * 0.02 * Math.max(0, run - 0.9) * 4)
  nBuy = Math.min(nBuy, 40)
  nSell = Math.min(nSell, 40)

  let vol = 0
  let nb = 0
  let ns = 0
  let netUsd = 0
  const trade = (side: 'buy' | 'sell', usd: number, tag?: TapeTrade['tag'], bot = false) => {
    usd = Math.max(FLOW.minTrade, usd)
    const prev = t.price
    if (side === 'buy') t.price = quoteBuy(t, usd).newPrice
    else {
      // A seller can't get more out than the curve actually holds (the SOL raised so far).
      usd = Math.min(usd, curveAt(t.pad, t.price / nu).raised * nu * 0.95)
      if (usd < 1) return
      t.price = Math.max(launchPx * 1.0005, quoteSell(t, usd / t.price).newPrice)
    }
    t.mcap = t.price * SUPPLY
    t.ath = Math.max(t.ath, t.mcap)
    touchCandles(t, m.time, prev, usd, native) // also keeps the curve (liquidity, progress) in sync
    addTape(m, t, { time: m.time, side, usd, price: t.price, wallet: walletName(rng), tag })
    vol += usd
    if (side === 'buy') nb++
    else ns++
    if (bot) return // bot churn: activity on the tape, but it isn't real interest
    netUsd += side === 'buy' ? usd / heat : -usd / heat // attention follows how many people buy, not how big
    f.lastTrade = m.time
  }
  // Snipers land in the first seconds with real size (0.3–2 SOL); on hyped launches there are a lot of them.
  if (age <= 3) {
    const n = rng.poisson(0.8 + 3 * f.q)
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
  const whale = () => (rng.chance(0.003 + 0.004 * Math.min(f.q, 3)) ? rng.range(8, 40) : 1)
  for (let i = 0, j = 0; i < nBuy || j < nSell; ) {
    // Interleave buys and sells in random order through the second.
    if (j >= nSell || (i < nBuy && rng.chance(nBuy / (nBuy + nSell)))) {
      trade('buy', Math.min(FLOW.maxTrade, lognormal(rng, FLOW.buyMedian, FLOW.buySigma) * heat * whale()))
      i++
    } else {
      trade('sell', Math.min(FLOW.maxTrade, lognormal(rng, FLOW.sellMedian, FLOW.sellSigma) * heat * Math.sqrt(Math.max(1, run)) * whale()))
      j++
    }
    if (t.status !== 'bonding') break
  }

  // Devs love to dump into a pump.
  if (t.devPct > 0.2 && t.price > launchPx * 1.6 && rng.chance(0.012)) {
    const frac = rng.chance(0.5) ? 1 : rng.range(0.3, 0.7)
    const usd = (t.devPct / 100) * frac * t.mcap * 0.9
    t.devPct *= 1 - frac
    logDev(t, { time: m.time, side: 'sell', usd })
    trade('sell', usd, 'dev')
    f.att *= 0.7
    t.hype = Math.max(0, t.hype - 10 * frac)
  }

  // Attention: fades on its own, grows with net buying (more for coins that have "it"), plus rare viral moments.
  f.att = f.att * (FLOW.decay + (FLOW.decayGood - FLOW.decay) * Math.min(1, f.q / 2)) + Math.max(0, netUsd) * FLOW.feedback * Math.min(f.q, 4)
  if (!f.koth && t.bondingProgress >= FLOW.kothProgress) {
    f.koth = true
    f.att += 1.5 + f.q
    emit({ kind: 'trending', tokenId: t.id, ticker: t.ticker, text: `$${t.ticker} is king of the hill on pump.fun`, icon: '👑', tone: 'up' })
  }
  if (rng.chance(0.0008 * Math.min(f.q, 3))) {
    f.att = f.att * 3 + 2
    emit({ kind: 'viral', tokenId: t.id, ticker: t.ticker, text: `$${t.ticker} is going parabolic`, icon: '🚀', tone: 'up' })
  }
  f.ema = f.ema * 0.97 + t.price * 0.03

  // Bookkeeping, same shape as the classic engine.
  const r = Math.log(t.price / p0)
  t.momentum = t.momentum * 0.75 + r * 0.25
  t.momentumScore = Math.round(clamp(50 + 50 * Math.tanh(t.momentum / (t.volatility * 1.1)), 0, 100))
  t.volume = t.volume * DECAY_1H + vol
  t.buys = t.buys * DECAY_1H + nb
  t.sells = t.sells * DECAY_1H + ns
  t.win = stepWin(getWin(t, m.time), vol, nb, ns)
  t.holders = Math.max(1, Math.round(t.holders + nb * rng.range(0.5, 0.9) - ns * rng.range(0.3, 0.6)))
  const hypeTarget = clamp(15 + t.momentumScore * 0.4 + Math.min(40, f.att * 8), 0, 100)
  t.hype = clamp(t.hype + (hypeTarget - t.hype) * 0.05, 0, 100)

  if (t.status === 'bonding' && syncCurve(t, nu)) migrate(t, m, nu, emit)
  else if (m.time - f.lastTrade > FLOW.deadAfter && f.att < 0.05 && t.status === 'bonding') {
    // Nobody left: the coin sits on its curve forever. (On pump.fun that's ~97%+ of launches.)
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
}

/** Advance the market one tick. Returns a new MarketState (tokens are fresh copies) and emitted events. */
export function tickMarket(prev: MarketState, rng: Rng, opts: TickOptions): { market: MarketState; events: MarketEvent[] } {
  const m: MarketState = { ...prev, tick: prev.tick + 1, time: prev.time + SIM_SEC_PER_TICK }
  const events: MarketEvent[] = []
  const emit = (e: Omit<MarketEvent, 'id' | 'tick' | 'time'>) => events.push({ ...e, id: m.tick * 100 + events.length, tick: m.tick, time: m.time })

  // 1. Market-wide sentiment: a slow mean-reverting process all tokens load on (creates correlation).
  if (rng.chance(0.004)) {
    const up = rng.chance(0.5 - prev.sentiment * 0.3)
    m.sentimentTrend = up ? rng.range(0.4, 1) : -rng.range(0.4, 1)
    emit({ kind: up ? 'marketup' : 'marketdown', text: up ? 'Degen season: risk-on across the trenches' : 'Risk-off: the whole market is bleeding', icon: up ? '🌙' : '🥶', tone: up ? 'up' : 'down' })
  }
  m.sentimentTrend *= 0.985
  m.sentiment = clamp(prev.sentiment * 0.992 + m.sentimentTrend * 0.012 + rng.gauss() * 0.02, -1, 1)
  const marketShock = rng.gauss() * 0.0025

  // Chain coins (SOL / BNB / ETH) drift slowly, lean on market mood, and revert to their anchors.
  const native = { ...(prev.native ?? initNative()) }
  for (const c of CHAIN_IDS) {
    const q = native[c]
    const lp = Math.log(q.price)
    const next = lp + rng.gauss() * 0.0012 + m.sentiment * 0.0002 + (Math.log(CHAINS[c].basePrice) - lp) * 0.002
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
    const prevPrice = t.price
    const age = m.time - t.createdAt

    // Creator fees: this tick's volume plus anything traded since the last tick (bot wallets, players, follower buys),
    // at the coin's current creator rate (pump.fun: 0.30% on the curve, PumpSwap's tiered 0.95%→0.05% after).
    const volBetween = Math.max(0, old.volume - (old.volMark ?? old.volume))
    const accrue = () => {
      const tickVol = Math.max(0, t.volume - old.volume * DECAY_1H) + volBetween
      if (tickVol > 0) t.creatorFees = (t.creatorFees ?? 0) + tickVol * creatorRate(t)
      t.volMark = t.volume
    }

    // Realistic engine: pump.fun coins on their curve trade by order flow; dead ones leave the lists within a minute.
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

    let r: number
    let activity: number
    if (t.status === 'rugged' || t.status === 'dead') {
      r = rng.gauss() * 0.01 - 0.002
      activity = 0.05
      t.hype = Math.max(0, t.hype - 1)
    } else {
      // 2. Rug scheduling: hazard depends on base probability, hype and mode. Warnings usually precede it.
      if (s.rugAt === null && t.rugProb > 0) {
        const hazard = t.rugProb * opts.rugMult * (1 + t.hype / 100) * (t.status === 'bonding' ? 1.4 : 1)
        if (rng.chance(hazard)) {
          s.rugAt = m.tick + rng.int(18, 45)
          if (rng.chance(0.75)) emit({ kind: 'liquidity', tokenId: t.id, ticker: t.ticker, text: `Liquidity dropping on $${t.ticker}`, icon: '⚠️', tone: 'warn' })
        }
      }
      if (s.rugAt !== null && m.tick < s.rugAt) {
        if (t.status !== 'bonding') t.liquidity *= 0.985 // curve liquidity can't be pulled, only a DEX pool's
        t.devPct = Math.max(0, t.devPct * 0.97)
        s.pressure -= 0.0008
      }
      if (s.rugAt !== null && m.tick >= s.rugAt) {
        // 3. Execute the rug. On a curve the dev can only dump their bag into it (price falls toward the curve's
        // start); after migration they can pull the pool.
        const onCurve = t.status === 'bonding'
        const floor = startPriceNative(t.pad) * nativeUsdOf(native, t.chain) * 1.02
        r = onCurve ? Math.log(Math.max(floor, t.price * Math.exp(-rng.range(0.7, 0.92))) / t.price) : -rng.range(0.85, 0.97)
        logDev(t, { time: m.time, side: 'sell', usd: Math.max(50, (t.devPct / 100) * t.mcap + t.liquidity * 0.3) })
        t.devPct = 0
        t.status = 'rugged'
        t.diedAt = m.time
        t.liquidity *= onCurve ? 0.2 : 0.04
        setRegime(t, 'rug', rng)
        activity = 3
        emit({ kind: 'rug', tokenId: t.id, ticker: t.ticker, text: onCurve ? `$${t.ticker} rugged — dev dumped the whole bag into the curve` : `$${t.ticker} rugged — liquidity pulled`, icon: '💀', tone: 'down' })
      } else {
        // 4. Regime-driven return with momentum, mean reversion, market beta and fat tails.
        if (--s.regimeTicks <= 0) {
          nextRegime(t, rng)
          if (s.regime === 'moon') {
            // Parabolic runs draw a crowd; most get noticed (the quiet ones reward whoever was watching the chart).
            t.hype = Math.min(100, t.hype + 12)
            if (rng.chance(0.7)) emit({ kind: 'viral', tokenId: t.id, ticker: t.ticker, text: rng.pick([`$${t.ticker} is going parabolic`, `$${t.ticker} is sending — buyers piling in`, `$${t.ticker} just went vertical`]), icon: '🚀', tone: 'up' })
          }
        }
        const sigma = t.volatility * s.volMult * (1 + s.volBoost)
        const logP = Math.log(t.price)
        r =
          s.drift +
          BLEED[s.archetype] * t.volatility +
          0.12 * t.momentum +
          s.meanRev * (s.anchor - logP) +
          s.beta * (m.sentiment * 0.0012 + marketShock) +
          s.pressure +
          sigma * rng.gauss() +
          (rng.chance(0.012) ? sigma * 4 * rng.gauss() : 0)
        r = clamp(r, -0.4, 0.5)
        s.anchor = s.anchor * 0.996 + logP * 0.004
        activity = REGIME_ACTIVITY[s.regime]
      }
      s.pressure *= 0.88
      s.volBoost *= 0.93
    }

    // 5. Price, market cap, ATH. A coin that died or rugged on its curve can't trade below the curve's start price.
    t.price = Math.max(1e-13, t.price * Math.exp(r))
    if ((t.status === 'rugged' || t.status === 'dead') && t.bondingProgress < 100) {
      t.price = Math.max(t.price, startPriceNative(t.pad) * nativeUsdOf(native, t.chain) * 1.0005)
    }
    t.mcap = t.price * SUPPLY
    t.ath = Math.max(t.ath, t.mcap)
    t.momentum = t.momentum * 0.75 + r * 0.25
    t.momentumScore = Math.round(clamp(50 + 50 * Math.tanh(t.momentum / (t.volatility * 1.1)), 0, 100))

    // 6. Volume, buys/sells, holders.
    const live = t.status === 'bonding' || t.status === 'graduated'
    const z = Math.abs(r) / Math.max(1e-6, t.volatility)
    const baseTickVol = (t.mcap * s.baseTurnover) / HOUR_TICKS
    const tickVol = live ? baseTickVol * (0.45 + 0.35 * z) * (0.5 + t.hype / 100) * activity * Math.exp(0.3 * rng.gauss()) : 0
    t.volume = t.volume * DECAY_1H + tickVol
    if (t.washVol) t.washVol = t.washVol < 1 ? 0 : t.washVol * DECAY_1H
    const avgSize = clamp(t.mcap * 0.0004, 25, 2500)
    const n = live ? Math.min(14, rng.poisson(tickVol / avgSize)) : 0
    const buyShare = 1 / (1 + Math.exp(-(1.4 * Math.sign(r) * Math.min(z, 3) + s.pressure * 150)))
    let nb = 0
    for (let i = 0; i < n; i++) {
      const side = rng.chance(buyShare) ? 'buy' : 'sell'
      if (side === 'buy') nb++
      if (i < 3) {
        const usd = avgSize * Math.exp(0.9 * rng.gauss())
        const tag = usd > avgSize * 6 ? 'whale' : rng.chance(0.04) ? 'smart' : age < 300 && side === 'buy' && rng.chance(0.3) ? 'sniper' : undefined
        addTape(m, t, { time: m.time, side, usd, price: t.price, wallet: walletName(rng), tag })
      }
    }
    const ns = n - nb
    t.buys = t.buys * DECAY_1H + nb
    t.sells = t.sells * DECAY_1H + ns
    t.win = stepWin(getWin(old, m.time), tickVol, nb, ns)
    t.holders = Math.max(1, Math.round(t.holders + nb * rng.range(0.2, 0.5) - ns * rng.range(0.15, 0.4) + (live && rng.chance(t.hype / 400) ? 1 : 0)))

    // NPC devs: most sell into early pumps, a few top up. Their trades become DEV markers on the chart.
    if (live && t.creator !== 'you' && t.devPct > 0.2 && s.rugAt === null) {
      if (r > 0 && rng.chance(t.status === 'bonding' ? 0.006 : 0.0015)) {
        const frac = rng.chance(0.4) ? 1 : rng.range(0.25, 0.7)
        const usd = (t.devPct / 100) * frac * t.mcap
        t.devPct *= 1 - frac
        s.pressure -= 0.004 * frac
        t.hype = Math.max(0, t.hype - 8 * frac)
        logDev(t, { time: m.time, side: 'sell', usd })
        addTape(m, t, { time: m.time, side: 'sell', usd, price: t.price, wallet: walletName(rng), tag: 'dev' })
      } else if (t.status === 'bonding' && rng.chance(0.0008)) {
        const usd = t.liquidity * rng.range(0.02, 0.06)
        t.devPct += (usd / t.mcap) * 100
        s.pressure += 0.002
        logDev(t, { time: m.time, side: 'buy', usd })
        addTape(m, t, { time: m.time, side: 'buy', usd, price: t.price, wallet: walletName(rng), tag: 'dev' })
      }
    }
    // Mayhem coins: an AI agent trades them for their first day.
    if (live && LAUNCHPADS[t.pad].mayhem && age < D) {
      s.volBoost = Math.max(s.volBoost, 0.35)
      if (rng.chance(0.45)) addTape(m, t, { time: m.time, side: rng.chance(0.5 + clamp(s.pressure * 40, -0.2, 0.2)) ? 'buy' : 'sell', usd: avgSize * rng.range(0.5, 3), price: t.price, wallet: 'MayhemAI', tag: 'agent' })
    }

    // 7. Liquidity & bonding curve.
    if (t.status === 'bonding') {
      const nu = nativeUsdOf(native, t.chain)
      const complete = syncCurve(t, nu)
      if (complete && s.rugAt === null) {
        // Curve sold out: the raise and the leftover tokens seed a DEX pool.
        migrate(t, m, nu, emit)
      } else if (age > 1200 && t.bondingProgress < 1.5) {
        // Nobody left buying: the coin sits at the bottom of its curve.
        t.status = 'dead'
        t.diedAt = m.time
      }
    } else if (t.status === 'graduated') {
      t.liquidity = clamp(t.liquidity * Math.exp(0.5 * r) * (1 + (t.hype - 40) * 0.00002), t.mcap * 0.02, t.mcap * 0.4)
    }

    // 8. Social hype drifts toward activity level.
    const hypeTarget = live ? clamp(20 + t.momentumScore * 0.5 + Math.min(30, (t.volume / Math.max(1, t.mcap)) * 20), 0, 100) : 0
    t.hype = clamp(t.hype + (hypeTarget - t.hype) * 0.015 + rng.gauss() * 0.6, 0, 100)

    pushCandles(t, m.time, prevPrice, tickVol, rng)
    refreshChanges(t, m.time)
    const risk = computeRisk(t, m.time)
    t.riskScore = risk.score
    t.riskLevel = risk.level
    accrue()
    tokens.push(t)
  }

  // 8b. Readers of player calls who decided to ape: their buys land now, on the same curve / pool as everyone's.
  if (m.shillQueue?.length) {
    const due = m.shillQueue.filter((q) => q.atTick <= m.tick)
    m.shillQueue = m.shillQueue.filter((q) => q.atTick > m.tick)
    for (const q of due) {
      const t = tokens.find((x) => x.id === q.tokenId)
      if (!t || (t.status !== 'bonding' && t.status !== 'graduated')) continue
      const prev = t.price
      t.price = quoteBuy(t, q.usd).newPrice
      t.mcap = t.price * SUPPLY
      t.ath = Math.max(t.ath, t.mcap)
      touchCandles(t, m.time, prev, q.usd, native)
      t.volume += q.usd
      t.buys += 1
      t.win = addWin(getWin(t, m.time), q.usd, 1, 0)
      t.holders += 1
      addTape(m, t, { time: m.time, side: 'buy', usd: q.usd, price: t.price, wallet: q.wallet })
      if (t.status === 'bonding' && syncCurve(t, nativeUsdOf(native, t.chain))) migrate(t, m, nativeUsdOf(native, t.chain), emit)
    }
  }

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
  if (realistic && liveFlow < FLOW.maxLive && rng.chance(FLOW.launchPerSec)) {
    // Realistic: pump.fun launches arrive at its real pace; most will be dead within a minute.
    const base = nextName()
    if (base) {
      const t = launchFlowToken(rng, m, base)
      pushCandles(t, m.time, t.price, 0)
      tokens.unshift(t)
      emit({ kind: 'launch', tokenId: t.id, ticker: t.ticker, text: `$${t.ticker} just launched on pump.fun`, icon: '🆕', tone: 'info' })
    }
  }
  const liveClassic = tokens.filter((t) => !t.sim.flow && (t.status === 'bonding' || t.status === 'graduated')).length
  if (liveClassic < MAX_TOKENS && rng.chance(LAUNCH_CHANCE)) {
    const base = nextName()
    if (base) {
      // On the realistic engine pump.fun coins come from the order-flow launcher above; the other pads stay classic.
      const chain = pickChain(rng)
      const pad = realistic && chain === 'sol' ? rng.pick(padsFor('sol').filter((p) => p.id !== 'pump')).id : undefined
      const t = makeToken(rng, { ...base, chain, pad, archetype: rng.weighted<Archetype>({ rugger: 3, chaotic: 3, runner: 2, sleeper: 1, bleeder: 2 }) }, m.time, true, m.native)
      pushCandles(t, m.time, t.price, 0)
      tokens.unshift(t)
      emit({ kind: 'launch', tokenId: t.id, ticker: t.ticker, text: `$${t.ticker} just launched on the curve`, icon: '🆕', tone: 'info' })
    }
  }

  m.tokens = tokens
  m.seed = rng.s
  return { market: m, events }
}

// ─── Constant-product pool math (used by the trading engine) ─────────────────
/** Pool quote reserve = half the liquidity. Returns fill info for a USD buy (after fee). */
export function quoteBuy(t: Token, usdIn: number) {
  const Q = Math.max(1, t.liquidity / 2)
  const T = Q / t.price
  const qty = (T * usdIn) / (Q + usdIn)
  const avgPrice = usdIn / Math.max(1e-18, qty)
  const newPrice = t.price * ((Q + usdIn) / Q) ** 2
  return { qty, avgPrice, newPrice, slippage: avgPrice / t.price - 1 }
}

export function quoteSell(t: Token, qty: number) {
  const Q = Math.max(1, t.liquidity / 2)
  const T = Q / t.price
  const usdOut = (Q * qty) / (T + qty)
  const avgPrice = usdOut / Math.max(1e-18, qty)
  const newPrice = t.price * (T / (T + qty)) ** 2
  return { usdOut, avgPrice, newPrice, slippage: 1 - avgPrice / t.price }
}

/** Apply a player trade's price impact to the token and add it to the tape. */
export function applyPlayerTrade(m: MarketState, tokenId: string, side: 'buy' | 'sell', usd: number, newPrice: number, who?: { name: string; pid: string }): MarketState {
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
    // Multiplayer: the server tags another player's trade with their name and id (each browser shows its own as YOU).
    const entry: TapeTrade = who ? { id: m.nextTradeId, time: m.time, side, usd, price: newPrice, wallet: who.name, pid: who.pid } : { id: m.nextTradeId, time: m.time, side, usd, price: newPrice, wallet: 'YOU', tag: 'you' }
    t.tape = [entry, ...t.tape].slice(0, TAPE_LEN)
    pushCandles(t, m.time, prevPrice, usd)
    refreshChanges(t, m.time)
    return t
  })
  return { ...m, tokens, nextTradeId: m.nextTradeId + 1 }
}

// ─── Cooking: player-launched tokens ─────────────────────────────────────────
export const COOK_FEE = 25

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
