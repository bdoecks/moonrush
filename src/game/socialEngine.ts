import { CHAINS } from '../data/chains'
import { WALLET_SEEDS } from '../data/wallets'
import type { MarketEvent, MarketState, SocialAccount, SocialPost, SocialProfile, Token, WalletAction } from '../types'
import { walletName } from './marketEngine'
import { fakeAddress } from '../utils/address'
import { fmtCompact } from '../utils/format'
import { type Rng } from '../utils/rng'

// Simulated X / Telegram chatter. Everything here is fictional: invented accounts reacting to the sim.

const KOL_ACCOUNTS: SocialAccount[] = WALLET_SEEDS.map((s, i) => ({ s, i }))
  .filter(({ s }) => s.style === 'kol')
  .map(({ s, i }) => ({ id: `x-${s.name}`, platform: 'x' as const, name: s.name, handle: s.name.toLowerCase(), avatar: s.avatar, followers: 40_000 + i * 17_000, kind: 'kol' as const, walletId: `w${i}` }))

export const ACCOUNTS: SocialAccount[] = [
  ...KOL_ACCOUNTS,
  { id: 'x-trenchnews', platform: 'x', name: 'Trench News', handle: 'trenchnews', avatar: '📰', followers: 212_000, kind: 'news' },
  { id: 'x-memealerts', platform: 'x', name: 'Meme Alerts', handle: 'memealerts', avatar: '🚨', followers: 96_000, kind: 'news' },
  { id: 'x-chartcrimes', platform: 'x', name: 'Chart Crimes', handle: 'chartcrimes', avatar: '🕵️', followers: 58_000, kind: 'poster' },
  { id: 'x-gmgmgm', platform: 'x', name: 'gm enjoyer', handle: 'gmgmgm', avatar: '☀️', followers: 8_400, kind: 'poster' },
  { id: 'x-bagholder', platform: 'x', name: 'Professional Bagholder', handle: 'bagsforever', avatar: '👜', followers: 21_000, kind: 'poster' },
  { id: 'tg-moonsignals', platform: 'tg', name: 'Moon Signals', handle: 'moonsignals', avatar: '🌙', followers: 34_000, kind: 'caller' },
  { id: 'tg-degenden', platform: 'tg', name: 'Degen Den Calls', handle: 'degenden', avatar: '🕳️', followers: 18_500, kind: 'caller' },
  { id: 'tg-gemhunters', platform: 'tg', name: 'Gem Hunters VIP', handle: 'gemhuntersvip', avatar: '💎', followers: 51_000, kind: 'caller' },
  { id: 'tg-earlybird', platform: 'tg', name: 'Early Bird Alpha', handle: 'earlybirdalpha', avatar: '🐦', followers: 9_800, kind: 'caller' },
]
/** Who made a post, as something you can follow: an account id, or `player:<id>` for a real player. */
export const callerKey = (p: Pick<SocialPost, 'accountId' | 'author'>) => (p.accountId === 'player' ? `player:${p.author?.pid ?? p.author?.handle ?? 'you'}` : p.accountId)

const byWallet = new Map(ACCOUNTS.filter((a) => a.walletId).map((a) => [a.walletId!, a]))

const T = (t: Token) => `$${t.ticker}`
const CA = (t: Token) => `CA: ${fakeAddress(t.id, t.chain)} (${CHAINS[t.chain].short})`
const KOL_BUY = [
  (t: Token) => `aped some ${T(t)} here. chart looks primed 🚀\n${CA(t)}`,
  (t: Token) => `${T(t)} is the play. nfa but i'm in\n${CA(t)}`,
  (t: Token) => `not selling ${T(t)} until ${fmtCompact(t.mcap * 10)} 🫡\n${CA(t)}`,
  (t: Token) => `been watching ${T(t)} all day, finally loaded a bag\n${CA(t)}`,
]
const KOL_SELL_LIE = [
  (t: Token) => `${T(t)} still looks strong, holding 💎`,
  (t: Token) => `trimmed a tiny bit of ${T(t)} for gas, still bullish`,
]
const CHATTER = [
  'gm trenches', 'who else is down bad today', 'the real alpha is touching grass', 'every chart is either a rocket or a rug, no in between',
  'dev please do something', 'i was early. again. and still lost money', 'green candles cure everything', 'new meta just dropped and i missed it',
]

// ─── Player posts: shill a coin and see if the timeline bites ────────────────
export const POST_COOLDOWN_TICKS = 20
export const CALL_SETTLE_TICKS = 300 // a call is judged ~5 real minutes after it's posted
export const KOL_FOLLOWERS = 10_000
export const freshSocial = (): SocialProfile => ({ followers: 50, rep: 30, posts: 0, lastPostTick: -999, calls: [] })

const GOOD_REPLIES = ['aped 🦍', 'LFG 🚀', 'bought a bag', 'sending this', 'early for once', 'chart looks clean ngl', 'in. nfa', 'this is the one']
const BAD_REPLIES = ['rug?', 'ser this looks like a honeypot', 'dev already sold', 'ngmi', 'chart is cooked', 'exit liquidity detected', 'who is this guy', 'bag holder spotted']
const MEH_REPLIES = ['👀', 'watching', 'hmm', 'dyor', 'what mc', 'ca?']
const CHAT_REPLIES = ['gm', 'real', 'this', 'lmao', 'facts', 'touch grass ser']

/** How tempting a coin is to a reader of a call: hype, momentum, and not looking like a rug. 0..1. */
export function callAppeal(t: Token | undefined) {
  if (!t || (t.status !== 'bonding' && t.status !== 'graduated')) return 0
  const risk = t.riskLevel === 'LOW' ? 0.25 : t.riskLevel === 'MEDIUM' ? 0.16 : t.riskLevel === 'HIGH' ? 0.07 : 0
  return Math.max(0, Math.min(1, (t.hype / 100) * 0.35 + (t.momentumScore / 100) * 0.3 + risk + (t.liquidity > 5_000 ? 0.1 : 0)))
}

export interface ShillResult {
  likes: number
  rts: number
  replies: string[]
  buyers: number
  queue: NonNullable<MarketState['shillQueue']>
}

/**
 * The timeline's reaction to a player's post. Reach comes from followers, conviction from reputation and how good
 * the coin looks; posting the same coin again and again wears thin (`repeats` = your recent calls on it). Nudges the
 * coin's hype and attention now; the buyers' orders land over the next half-minute via `queue`.
 */
export function shill(m: MarketState, rng: Rng, t: Token | undefined, author: { followers: number; rep: number }, text: string, repeats = 0): ShillResult {
  const trust = Math.max(0, Math.min(1, author.rep / 100))
  const reach = author.followers * rng.range(0.05, 0.12) + 6 // plus a few randoms scrolling the timeline
  const fatigue = 0.45 ** repeats
  const spammy = text.length > 12 && text.replace(/[^A-Z]/g, '').length / text.replace(/[^A-Za-z]/g, '').length > 0.7 ? 0.6 : 1
  if (!t) {
    const likes = Math.round(reach * rng.range(0.05, 0.2))
    return { likes, rts: Math.round(likes * 0.1), replies: rng.chance(0.5) ? [rng.pick(CHAT_REPLIES)] : [], buyers: 0, queue: [] }
  }
  const appeal = callAppeal(t) * fatigue * spammy
  // A nobody with a good call still gets a few degens (~2); a trusted 10k-follower caller gets dozens.
  const buyers = Math.min(60, rng.poisson(reach * 0.05 * appeal * (0.35 + trust) + appeal * 2.5))
  const queue = Array.from({ length: buyers }, () => ({
    tokenId: t.id,
    atTick: m.tick + 1 + Math.floor(rng.range(0, 30) ** 1.2 / 3), // most land within seconds, stragglers later
    usd: Math.min(3000, 25 * Math.exp(0.9 * rng.gauss()) * (1 + trust)),
    wallet: walletName(rng),
  }))
  const likes = Math.round(reach * (0.04 + appeal * 0.2) + buyers * 1.5 + rng.range(0, 3))
  const good = appeal > 0.45 ? 0.75 : appeal > 0.25 ? 0.45 : 0.15
  const replies = Array.from({ length: Math.min(3, rng.int(0, 1 + Math.floor(likes / 15))) }, () => (rng.chance(good) ? rng.pick(GOOD_REPLIES) : rng.chance(0.5) ? rng.pick(BAD_REPLIES) : rng.pick(MEH_REPLIES)))
  // The buzz itself: a little hype and attention, bigger for trusted callers on coins people like.
  t.hype = Math.min(100, t.hype + appeal * (4 + trust * 10))
  if (t.sim.flow) t.sim.flow.att += buyers * 0.06 + appeal * trust * 0.5
  else t.sim.pressure += 0.0008 * buyers * (0.5 + trust)
  return { likes, rts: Math.round(likes * rng.range(0.08, 0.2)), replies, buyers, queue }
}

/**
 * After a call settles: did the coin run? Rep moves with the result; followers with engagement and wins.
 * `x` = best price since the call ÷ price at the call.
 */
export function settleCall(s: SocialProfile, x: number, likes: number): SocialProfile {
  const repDelta = x >= 1.5 ? Math.min(12, (x - 1) * 6) : x >= 1.1 ? 2 : x < 0.6 ? -8 : -3
  const followerGain = Math.round(likes * 0.3 + (x > 1.2 ? s.followers * Math.min(0.5, (x - 1) * 0.15) : x < 0.7 ? -s.followers * 0.04 : 0))
  return { ...s, rep: Math.max(0, Math.min(100, s.rep + repDelta)), followers: Math.max(10, s.followers + followerGain) }
}

// ─── KOL copy traders ────────────────────────────────────────────────────────
// Once you're a KOL (10k+ followers), some followers run copy-trade bots on your wallet: they buy a few seconds after
// you, and sell when you sell. More followers and a better reputation = more of them. They're anonymous wallets on the
// same curve / pool as everyone, so they push the price up behind your buy and down behind your sell.
export const COPY_MIN_USD = 20 // smaller buys don't set the copiers off
export const COPY_GAP_TICKS = 60 // one wave per coin per minute (buying in pieces doesn't summon more)

/** What your copiers hold, per coin: how many tokens, and when they last piled in. */
export type CopyBook = Record<string, { qty: number; at: number }>

export interface CopyWave {
  queue: NonNullable<MarketState['shillQueue']>
  copiers: number
  usd: number
}

/** Your followers' copy buys after you buy `usd` of a coin (nothing if you're not a KOL, too small, or too soon). */
export function copyBuys(m: MarketState, rng: Rng, t: Token, author: { followers: number; rep: number }, usd: number, book: CopyBook): CopyWave | null {
  if (author.followers < KOL_FOLLOWERS || usd < COPY_MIN_USD || (t.status !== 'bonding' && t.status !== 'graduated')) return null
  if (m.tick - (book[t.id]?.at ?? -1e9) < COPY_GAP_TICKS) return null
  const trust = Math.max(0, Math.min(1, author.rep / 100))
  // 10k followers ≈ a handful; 100k+ ≈ a crowd (capped so one buy can't move a coin forever).
  const copiers = Math.min(40, rng.poisson((author.followers / 1000) * (0.25 + trust) * 0.5))
  if (!copiers) return null
  let total = 0
  let qty = 0
  const queue = Array.from({ length: copiers }, () => {
    const each = Math.max(5, Math.min(usd, 30 * Math.exp(0.8 * rng.gauss()) * (1 + trust))) // never more than you put in
    total += each
    qty += (each / Math.max(1e-18, t.price)) * 0.85 // they buy after you, a bit higher
    return { tokenId: t.id, atTick: m.tick + rng.int(1, 8), usd: each, wallet: walletName(rng) } // copy bots are quick
  })
  book[t.id] = { qty: (book[t.id]?.qty ?? 0) + qty, at: m.tick }
  return { queue, copiers, usd: total }
}

/** Your copiers sell the same share of their bag as you just sold of yours. */
export function copySells(m: MarketState, rng: Rng, t: Token, fraction: number, book: CopyBook): CopyWave | null {
  const held = book[t.id]?.qty ?? 0
  if (!(held > 0) || !(fraction > 0)) return null
  const qty = fraction >= 0.999 ? held : held * fraction
  const n = Math.max(1, Math.min(12, Math.round(Math.sqrt(qty * t.price / 20))))
  const queue = Array.from({ length: n }, () => ({ tokenId: t.id, atTick: m.tick + rng.int(1, 6), usd: 0, wallet: walletName(rng), side: 'sell' as const, qty: qty / n }))
  if (fraction >= 0.999) delete book[t.id]
  else book[t.id] = { ...book[t.id], qty: held - qty }
  return { queue, copiers: n, usd: qty * t.price }
}

/** Generate this tick's posts from wallet actions, market events and ambient chatter. May nudge called tokens. */
export function tickSocial(m: MarketState, rng: Rng, actions: WalletAction[], events: MarketEvent[]): SocialPost[] {
  const posts: SocialPost[] = []
  const byId = new Map(m.tokens.map((t) => [t.id, t]))
  const post = (accountId: string, text: string, t?: Token, isCall = false) =>
    posts.push({ id: m.tick * 1000 + 700 + posts.length, tick: m.tick, time: m.time, accountId, text, tokenId: t?.id, ticker: t?.ticker, mcapAtPost: t?.mcap, peakMcap: t?.mcap, isCall })

  // KOLs shill their buys and sometimes pretend they're still holding while they sell.
  for (const a of actions) {
    const acc = byWallet.get(a.walletId)
    const t = byId.get(a.tokenId)
    if (!acc || !t) continue
    if (a.side === 'buy' && a.kind === 'first' && rng.chance(0.85)) post(acc.id, rng.pick(KOL_BUY)(t), t, true)
    else if (a.side === 'sell' && rng.chance(0.3)) post(acc.id, rng.pick(KOL_SELL_LIE)(t), t)
  }

  // News accounts cover notable events.
  for (const e of events) {
    const t = e.tokenId ? byId.get(e.tokenId) : undefined
    if (!rng.chance(e.kind === 'rug' || e.kind === 'graduation' ? 0.8 : 0.35)) continue
    switch (e.kind) {
      case 'graduation': if (t) post('x-trenchnews', `🎓 ${T(t)} just graduated to the ${CHAINS[t.chain].dex} pool at ${fmtCompact(t.mcap)} MC\n${CA(t)}`, t); break
      case 'rug': if (t) post('x-memealerts', `💀 ${T(t)} rugged. liquidity pulled. stay safe out there`, t); break
      case 'trending': case 'viral': if (t) post('x-memealerts', `🔥 ${T(t)} trending across the timeline · MC ${fmtCompact(t.mcap)}\n${CA(t)}`, t); break
      case 'whale': if (t) post('x-trenchnews', `🐋 whale just bought ${T(t)}\n${CA(t)}`, t); break
      case 'devsell': if (t) post('x-chartcrimes', `dev wallet on ${T(t)} is selling. you've been warned 👀`, t); break
      case 'meta': post('x-trenchnews', `📢 ${e.text}`); break
      case 'marketdown': post('x-bagholder', 'the whole market is bleeding and i am holding all of it'); break
      case 'marketup': post('x-gmgmgm', 'green everywhere. gm to everyone except bears'); break
    }
  }

  // Telegram channels post calls, and their members briefly pump what gets called.
  if (rng.chance(0.03)) {
    const pool = m.tokens.filter((t) => t.status === 'bonding' || (t.status === 'graduated' && t.mcap < 3_000_000))
    const pick = rng.chance(0.6) ? pool.filter((t) => t.momentumScore > 55) : pool
    if (pick.length) {
      const t = rng.pick(pick)
      const ch = rng.pick(ACCOUNTS.filter((a) => a.platform === 'tg'))
      post(ch.id, `🔥 NEW CALL: ${T(t)}\nMC: ${fmtCompact(t.mcap)} · Liq: ${fmtCompact(t.liquidity)}\n${CA(t)}`, t, true)
      t.sim.pressure += 0.003 * (ch.followers / 30_000)
      t.hype = Math.min(100, t.hype + 6)
    }
  }

  if (rng.chance(0.03)) post(rng.pick(['x-gmgmgm', 'x-bagholder', 'x-chartcrimes']), rng.pick(CHATTER))
  return posts
}
