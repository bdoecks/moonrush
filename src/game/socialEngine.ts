import { CHAINS } from '../data/chains'
import { WALLET_SEEDS } from '../data/wallets'
import type { MarketEvent, MarketState, SocialAccount, SocialPost, Token, WalletAction } from '../types'
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
