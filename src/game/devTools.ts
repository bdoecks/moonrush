// Dev tools for tokens you cooked: a launch bundler and a volume bot. Both are fictional game mechanics that show
// how these tactics look on-chain and why they tend to backfire: sleuths flag them, and the market punishes it.
import type { Chain, MarketEvent, MarketState, Token, VolumeBot } from '../types'
import { clamp, type Rng } from '../utils/rng'
import { tradeFee } from './tradingEngine'
import { addWin, getWin } from './windows'
import { fillSim, quoteBuy, SIM_SEC_PER_TICK, SUPPLY, walletName } from './marketEngine'

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
/**
 * A volume bot is a service a dev pays for, as on the real market: a package of so much volume from so many maker
 * wallets over so long, for a service fee up front. The trading fees on the bot's own buys and sells come on top
 * (paid by the dev wallet as it goes), and the dev earns the coin's creator fee on that volume like on any other.
 * (Sizes are the game's: a package always costs more than the creator fees it brings back.)
 */
export const BOT_PACKS = [
  { id: 'starter', label: 'Starter', volume: 5_000, minutes: 5, makers: 25, fee: 15 },
  { id: 'boost', label: 'Boost', volume: 25_000, minutes: 10, makers: 80, fee: 60 },
  { id: 'trending', label: 'Trending', volume: 100_000, minutes: 20, makers: 250, fee: 200 },
  { id: 'whale', label: 'Whale', volume: 400_000, minutes: 30, makers: 800, fee: 700 },
] as const
export type BotPack = (typeof BOT_PACKS)[number]
export const botPack = (id: unknown): BotPack | undefined => BOT_PACKS.find((p) => p.id === id)
/** A bought package as the bot runs it: `before` = the volume the coin's bot had already made. */
export const botOf = (pack: BotPack, before: number, spent: number, tick: number): VolumeBot => ({ on: true, pack: pack.id, rate: pack.volume / pack.minutes, target: before + pack.volume, budget: spent + pack.fee + pack.volume * 0.06, spent: spent + pack.fee, volume: before, startedTick: tick })
export const BOT_RATES: number[] = BOT_PACKS.map((p) => p.volume / p.minutes) // USD of volume per simulated minute
const ticksPerMin = () => 60 / SIM_SEC_PER_TICK // the clock depends on the market (classic 6s/tick, realistic 1s)

const BOT_TX_COST = 0.03 // USD network/priority cost per bot transaction

/**
 * Cost of one tick of wash volume. A buy immediately followed by an equal sell on a constant-product pool gets its
 * price impact back, so what burns is the trading fee on both legs plus a few cents of network cost per tx.
 */
export function botTickCost(t: Token, vol: number) {
  return (vol / 2) * (tradeFee(t, 'buy') + tradeFee(t, 'sell')) + 4 * BOT_TX_COST
}

/** What a whole package costs in trading fees, start to end (the per-trade network cost adds up over its minutes). */
export const botPackCost = (t: Token, pack: { volume: number; minutes: number }) => {
  const ticks = pack.minutes * ticksPerMin()
  return botTickCost(t, pack.volume / ticks) * ticks
}

/** Rough cost per simulated minute, for the UI. */
export const botCostPerMin = (t: Token, rate: number) => botTickCost(t, rate / ticksPerMin()) * ticksPerMin()

/** Share of the token's rolling volume that's bot volume. */
export const washShare = (t: Token) => (t.volume > 0 ? clamp((t.washVol ?? 0) / t.volume, 0, 1) : 0)

/**
 * Run one tick of a volume bot on a token (mutates it). Fresh wallets REALLY buy and then sell the same money's worth
 * through the coin's curve or pool (`fillSim`, like every other trade in the game), so the price ends the tick where it
 * began, the chart shows the small wicks of it, and volume, trade counts and makers go up. That is what climbs the
 * volume lists and pulls in some real attention, until somebody notices. A buy that would finish a curve is not made
 * (a sold-out curve cannot be sold back into, and the bot would be left holding).
 */
export function runBotTick(t: Token, bot: VolumeBot, m: MarketState, rng: Rng): { vol: number; cost: number; event?: MarketEvent } {
  const want = (bot.rate / ticksPerMin()) * (0.7 + 0.6 * rng.next())
  const pairs = rng.int(1, 3)
  let vol = 0
  let done = 0
  for (let i = 0; i < pairs; i++) {
    const usd = want / 2 / pairs
    if (t.status === 'bonding' && quoteBuy(t, usd).used < usd * 0.999) break
    const w = walletName(rng)
    const bought = fillSim(m, t, 'buy', usd, m.time, w)
    if (!(bought > 0)) break
    // (The same money out puts the reserves, and so the price, back where they were.)
    vol += bought + fillSim(m, t, 'sell', bought, m.time, w)
    done++
  }
  const cost = vol > 0 ? botTickCost(t, vol) : 0
  t.volume += vol
  t.washVol = (t.washVol ?? 0) + vol
  // A coin that is being traded is not a dead one: the bot's trades count as trades for the clock that writes a
  // quiet coin off (it costs its dev fees every second it does).
  if (vol > 0 && t.sim.flow) t.sim.flow.lastTrade = m.time
  t.win = addWin(getWin(t, m.time), vol, done, done)
  t.buys += done
  t.sells += done
  if (done && rng.chance(0.25)) t.holders += 1 // a maker wallet now and then keeps a little dust
  // Fake activity draws a little real interest (trending lists), until it's flagged.
  // The pull is relative to the coin's size: a bot can juice a tiny coin, but barely registers on a big one.
  if (!t.washFlagged && vol > 0) t.sim.pressure += 0.00025 * Math.min(1.5, Math.log10(1 + vol / Math.max(10, t.mcap * 0.002)))

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

// ─── Airdrop ─────────────────────────────────────────────────────────────────
export type AirdropTarget = 'holders' | 'fresh'
export const AIRDROP_MAX_WALLETS = 200
/**
 * Network cost per recipient, in the chain's coin. On Solana a fresh wallet needs a token account opened for it
 * (~0.002 SOL rent); wallets that already hold the coin only cost the tx fee. EVM chains pay gas per transfer.
 */
export const airdropFeePerWallet = (chain: Chain, target: AirdropTarget) => (chain === 'sol' ? (target === 'fresh' ? 0.00204 : 0.00002) : chain === 'bsc' ? 0.00005 : 0.000012)

export interface AirdropPlan {
  queue: NonNullable<MarketState['shillQueue']> // recipients who dump, and when
  dumpers: number
  holdersAdd: number
  hype: number
  top10Drop: number // percentage points the top-10 share falls
}

/**
 * Dev gives `qty` tokens away across `wallets` recipients. Existing holders mostly keep it (goodwill, a hype bump);
 * fresh wallets pump the holder count but many are airdrop farmers who dump within minutes.
 */
export function planAirdrop(t: Token, qty: number, wallets: number, target: AirdropTarget, rng: Rng, tick: number, secPerTick: number): AirdropPlan {
  const share = qty / Math.max(1, wallets)
  const supplyPct = (qty / SUPPLY) * 100
  const dumpChance = target === 'fresh' ? 0.55 : 0.22
  const queue: AirdropPlan['queue'] = []
  for (let i = 0; i < wallets; i++) {
    if (!rng.chance(dumpChance)) continue
    const delaySec = 15 + Math.pow(rng.next(), 1.6) * 480 // most dump in the first couple of minutes
    queue.push({ tokenId: t.id, atTick: tick + Math.max(1, Math.round(delaySec / secPerTick)), usd: 0, wallet: walletName(rng), side: 'sell', qty: share * (0.6 + rng.next() * 0.4) })
  }
  const reach = Math.log2(1 + wallets)
  return {
    queue,
    dumpers: queue.length,
    holdersAdd: target === 'fresh' ? wallets : 0,
    hype: Math.min(25, (target === 'holders' ? 1.6 : 1.1) * reach + supplyPct * 0.8),
    top10Drop: Math.min(t.top10Pct * 0.5, supplyPct * (target === 'fresh' ? 0.9 : 0.4)),
  }
}

/** Your hidden bundle share and your visible dev share, given your total bag and the bundled part of it. */
export function splitBag(totalQty: number, bundleQty: number) {
  const b = Math.min(bundleQty, totalQty)
  return { bundlePct: (b / SUPPLY) * 100, devPct: ((totalQty - b) / SUPPLY) * 100 }
}
