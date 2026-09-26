// Dev tools for tokens you cooked: a launch bundler and a volume bot. Both are fictional game mechanics that show
// how these tactics look on-chain and why they tend to backfire: sleuths flag them, and the market punishes it.
import type { MarketEvent, MarketState, Token, VolumeBot } from '../types'
import { clamp, type Rng } from '../utils/rng'
import { tradeFee } from './tradingEngine'
import { addWin, getWin } from './windows'
import { SIM_SEC_PER_TICK, SUPPLY, touchCandles, walletName } from './marketEngine'

// ─── Bundler ─────────────────────────────────────────────────────────────────
export const BUNDLE_MAX_WALLETS = 20
export const BUNDLE_WALLET_FEE = 0.4 // USD per wallet: funding transfers and priority tips
export const STAGGER_FEE = 0.01 // spreading buys over a few blocks costs extra priority tips (share of bundle size)

/** Chance that on-chain sleuths spot the bundle at launch. Fewer, bigger wallets in one block are obvious. */
export function bundleDetectChance(wallets: number, pct: number, stagger: boolean) {
  if (wallets <= 0 || pct <= 0) return 0
  return clamp(0.2 + pct / 30 + (wallets < 6 ? 0.2 : 0) - wallets / 80 - (stagger ? 0.25 : 0), 0.05, 0.95)
}

/** Bundle share the public audit shows: the usual insider/sniper read, plus your bundle once it's been flagged. */
export function publicBundlePct(t: Token) {
  return Math.min(99, t.insidersPct * 0.7 + t.snipers * 0.4 + (t.bundleFlagged ? (t.bundlePct ?? 0) : 0))
}

/** Mark a bundle as flagged: holders see it and some bail. Mutates the token. */
export function flagBundle(t: Token, m: Pick<MarketState, 'tick' | 'time'>, wallets: number): MarketEvent {
  t.bundleFlagged = true
  t.insidersPct = Math.min(95, t.insidersPct + (t.bundlePct ?? 0))
  t.hype = Math.max(0, t.hype - 25)
  t.sim.pressure -= 0.005
  return {
    id: m.tick * 100 + 97, tick: m.tick, time: m.time, kind: 'bundle', tokenId: t.id, ticker: t.ticker, icon: '📦', tone: 'down',
    text: `Bundle spotted on $${t.ticker}: ${wallets} linked wallets hold ${(t.bundlePct ?? 0).toFixed(1)}% of supply`,
  }
}

/** Unflagged bundles can still be found later by bubble-map sleuths; bigger bundles get found faster. */
export function sleuthBundle(t: Token, rng: Rng) {
  const pct = t.bundlePct ?? 0
  return !t.bundleFlagged && pct > 1 && rng.chance(0.0012 * (pct / 10))
}

// ─── Volume bot ──────────────────────────────────────────────────────────────
export const BOT_RATES = [500, 2000, 5000, 15000] // USD of volume per simulated minute
const ticksPerMin = () => 60 / SIM_SEC_PER_TICK // the clock depends on the market (classic 6s/tick, realistic 1s)

const BOT_TX_COST = 0.03 // USD network/priority cost per bot transaction

/**
 * Cost of one tick of wash volume. A buy immediately followed by an equal sell on a constant-product pool gets its
 * price impact back, so what burns is the trading fee on both legs plus a few cents of network cost per tx.
 */
export function botTickCost(t: Token, vol: number) {
  return (vol / 2) * (tradeFee(t, 'buy') + tradeFee(t, 'sell')) + 4 * BOT_TX_COST
}

/** Rough cost per simulated minute, for the UI. */
export const botCostPerMin = (t: Token, rate: number) => botTickCost(t, rate / ticksPerMin()) * ticksPerMin()

/** Share of the token's rolling volume that's bot volume. */
export const washShare = (t: Token) => (t.volume > 0 ? clamp((t.washVol ?? 0) / t.volume, 0, 1) : 0)

/**
 * Run one tick of a volume bot on a token (mutates it). Buys and sells the same size from rotating wallets, so price
 * barely moves, but volume, tx counts and "makers" go up, which pulls in some real attention until someone notices.
 */
export function runBotTick(t: Token, bot: VolumeBot, m: MarketState, rng: Rng): { vol: number; cost: number; event?: MarketEvent } {
  const vol = (bot.rate / ticksPerMin()) * (0.7 + 0.6 * rng.next())
  const cost = botTickCost(t, vol)
  t.volume += vol
  t.washVol = (t.washVol ?? 0) + vol
  const pairs = rng.int(1, 3)
  t.win = addWin(getWin(t, m.time), vol, pairs, pairs)
  t.buys += pairs
  t.sells += pairs
  if (rng.chance(0.25)) t.holders += 1 // fresh bot wallets show up as tiny holders
  for (let i = 0; i < Math.min(2, pairs); i++) {
    const usd = vol / 2 / pairs
    const w = walletName(rng)
    t.tape = [
      { id: m.nextTradeId++, time: m.time, side: 'sell' as const, usd, price: t.price, wallet: w },
      { id: m.nextTradeId++, time: m.time, side: 'buy' as const, usd, price: t.price, wallet: w },
      ...t.tape,
    ].slice(0, 40)
  }
  touchCandles(t, m.time, t.price, vol)
  // Fake activity draws a little real interest (trending lists), until it's flagged.
  // The pull is relative to the coin's size: a bot can juice a tiny coin, but barely registers on a big one.
  if (!t.washFlagged) t.sim.pressure += 0.00025 * Math.min(1.5, Math.log10(1 + vol / Math.max(10, t.mcap * 0.002)))

  let event: MarketEvent | undefined
  const share = washShare(t)
  if (!t.washFlagged && rng.chance(0.001 + 0.02 * Math.max(0, share - 0.35))) {
    t.washFlagged = true
    t.hype = Math.max(0, t.hype - 30)
    t.sim.pressure -= 0.006
    event = {
      id: m.tick * 100 + 96, tick: m.tick, time: m.time, kind: 'wash', tokenId: t.id, ticker: t.ticker, icon: '🤖', tone: 'down',
      text: `$${t.ticker} flagged for wash trading: ~${Math.round(share * 100)}% of its volume is bots`,
    }
  }
  return { vol, cost, event }
}

/** Your hidden bundle share and your visible dev share, given your total bag and the bundled part of it. */
export function splitBag(totalQty: number, bundleQty: number) {
  const b = Math.min(bundleQty, totalQty)
  return { bundlePct: (b / SUPPLY) * 100, devPct: ((totalQty - b) / SUPPLY) * 100 }
}
