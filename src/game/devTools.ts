// Dev tools for tokens you cooked: a launch bundler and a volume bot. Both are fictional game mechanics that show
// how these tactics look on-chain and why they tend to backfire: sleuths flag them, and the market punishes it.
import type { Chain, MarketEvent, MarketState, SimWallet, Token, VolumeBot } from '../types'
import { clamp, type Rng } from '../utils/rng'
import { tradeFee } from './tradingEngine'
import { addWin, getWin } from './windows'
import { hash01 } from './feedFlavor'
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
/**
 * Two things a real dev does with an airdrop, and the game has both:
 *  - 'own': the dev splits part of the dev bag over fresh wallets of their own. Nothing is given away: the dev wallet
 *    looks smaller, the holder count goes up, and the coins are still the dev's to sell (they join the hidden bundle
 *    share, and can be traced back like any bundle).
 *  - 'kols': the dev sends tokens to known traders they pick, so the trackers show those names holding the coin.
 *    The tokens are gone for good. A trader who was sent a coin did not choose it: it brings no followers, and most
 *    sell what they were sent, some at once.
 */
export type AirdropTarget = 'own' | 'kols'
export const AIRDROP_MAX_WALLETS = 50
export const AIRDROP_MAX_KOLS = 10
/** Network cost per recipient, in the chain's coin: on Solana a wallet new to the coin needs a token account opened for it (~0.002 SOL rent). */
export const airdropFeePerWallet = (chain: Chain, _target?: AirdropTarget) => (chain === 'sol' ? 0.00204 : chain === 'bsc' ? 0.00005 : 0.000012)

/** What splitting `qty` of the dev bag over `wallets` wallets of the dev's own does to what the coin's page shows. */
export function planAirdrop(t: Token, qty: number, wallets: number) {
  const supplyPct = (qty / SUPPLY) * 100
  // A piece only leaves the top-10 list when it is small: a bag cut in three is still three top holders.
  return { holdersAdd: wallets, top10Drop: Math.min(t.top10Pct * 0.5, supplyPct * Math.min(1, wallets / 20) * 0.9) }
}

/** A known trader a dev can send tokens to: a tracked wallet of the market's own that does not hold the coin yet. */
export const canReceive = (w: SimWallet, tokenId: string) => !w.bot && !w.rival && (w.style === 'kol' || w.style === 'smart' || w.style === 'whale') && !w.positions[tokenId]

/**
 * Put `qty` tokens, in equal parts, into the picked traders' wallets (the ones that may receive them). Each holds a
 * real position from here on and sells it like any other of theirs, through the curve or pool, under its own name.
 * About half were never going to keep a coin they did not pick: those sell at their next look. (No dice: which ones
 * comes from the wallet and the coin.) Returns the new wallets and who received.
 */
export function giftTo(wallets: SimWallet[], ids: string[], t: Pick<Token, 'id' | 'price'>, qty: number, tick: number): { wallets: SimWallet[]; to: string[] } {
  const want = new Set(ids)
  const to = wallets.filter((w) => want.has(w.id) && canReceive(w, t.id)).slice(0, AIRDROP_MAX_KOLS).map((w) => w.id)
  if (!to.length || !(qty > 0)) return { wallets, to: [] }
  const share = qty / to.length
  return {
    to,
    wallets: wallets.map((w) => (to.includes(w.id) ? { ...w, positions: { ...w.positions, [t.id]: { qty: share, cost: Math.max(1e-9, share * t.price), openedTick: hash01(`gift|${w.id}|${t.id}`) < 0.5 ? tick - 100_000 : tick, gift: true } } } : w)),
  }
}

/** Your hidden bundle share and your visible dev share, given your total bag and the bundled part of it. */
export function splitBag(totalQty: number, bundleQty: number) {
  const b = Math.min(bundleQty, totalQty)
  return { bundlePct: (b / SUPPLY) * 100, devPct: ((totalQty - b) / SUPPLY) * 100 }
}
