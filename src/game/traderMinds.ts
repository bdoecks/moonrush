// V2 stage 3: trader types. On top of its style (how big, how often, what it hunts), a tracked wallet has a mind: how
// it reacts to what a coin's feed says. A mind only reads what a player can read (the coin's Story tab, its price
// change, its status), and it acts a tick or more after the line showed, like anybody reading it.
// A wallet's mind comes from its id and style, so it is the same wallet in every market and nothing has to be saved.
// Their orders are orders from outside the crowd like any tracked wallet's: where the fair market answers those (see
// TOPS in marketEngine), it answers these. `scripts/minds-test.ts` holds what each mind must do, and `fair-test`
// that none of it turns the feed into a tip.
import type { Beat, MarketState, SimWallet, Token, WalletPosition } from '../types'
import type { Rng } from '../utils/rng'

export type TraderMind = 'narrative' | 'fomo' | 'contrarian' | 'panic' | 'swing'

export const MIND_META: Record<TraderMind, { label: string; icon: string; blurb: string }> = {
  narrative: { label: 'Narrative trader', icon: '📖', blurb: 'Buys coins whose story is heating up, and leaves when the story turns' },
  fomo: { label: 'FOMO buyer', icon: '🏃', blurb: 'Chases what has already run and what everybody is talking about; gives up fast when it dips' },
  contrarian: { label: 'Contrarian', icon: '🔄', blurb: 'Buys the fear after drama and dumps, sells into the hype' },
  panic: { label: 'Panic seller', icon: '😱', blurb: 'Dumps the whole bag on any bad news, in profit or not' },
  swing: { label: 'Swing trader', icon: '🌊', blurb: 'Buys dips in migrated coins with deep pools and takes small, steady exits' },
}

const MINDS_BY_STYLE: Record<SimWallet['style'], TraderMind[]> = {
  kol: ['narrative', 'narrative', 'fomo'],
  smart: ['contrarian', 'swing', 'narrative'],
  whale: ['swing', 'contrarian'],
  degen: ['fomo', 'panic', 'fomo'],
  fresh: ['panic', 'fomo'],
  sniper: [], // a sniper is in and out before a coin has a story
}

const hash = (s: string) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

/** This wallet's mind, or null (snipers, and the World's bots: those trade from the market brain). */
export function mindOf(w: Pick<SimWallet, 'id' | 'style' | 'bot'>): TraderMind | null {
  if (w.bot) return null
  const list = MINDS_BY_STYLE[w.style]
  return list.length ? list[hash(w.id) % list.length] : null
}

export const MIND = {
  share: 0.6, // of a minded wallet's entries, how many its mind picks (the rest are its style's, as before)
  kolShare: 0.25, // …for a KOL: most of a KOL's buys stay its own calls, the ones that bring its followers
  seen: 2, // seconds a line must have been on the feed before a mind acts on it (nobody reads faster)
  fresh: { narrative: 75, fomo: 45, contrarian: 90, panic: 40 }, // how long a line stays worth acting on, seconds
  fomoRun: 0.35, // up this much in five minutes (0.35 = 35%) sets a FOMO buyer off
  fomoCut: -0.12, // …and the loss at which one gives up
  fearDrop: -0.15, // down this much in five minutes is what a contrarian wants to see next to the bad news
  swingDip: [-0.3, -0.08] as [number, number], // the five-minute change a swing trader calls a dip
  swingPool: 20_000, // dollars of liquidity a swing trader needs
  swingOut: [0.12, -0.1] as [number, number], // take profit / stop
}

const GOOD: Beat['kind'][] = ['post', 'call', 'trend', 'partner', 'news', 'theme']
const BAD: Beat['kind'][] = ['drama', 'fade', 'bigsell', 'dev', 'warn', 'exit']
const HYPE: Beat['kind'][] = ['trend', 'call', 'partner', 'milestone', 'bigbuy']

/** The newest line on a coin's feed that passes `ok`, if it is old enough to have been read and still fresh. */
function line(t: Token, now: number, fresh: number, ok: (b: Beat) => boolean): Beat | undefined {
  for (const b of t.beats ?? []) {
    const age = now - b.time
    if (age > fresh) return undefined // (newest first: the rest are older still)
    if (age >= MIND.seen && ok(b)) return b
  }
  return undefined
}

const short = (b: Beat) => (b.by?.name ? `${b.by.name}: ` : '') + (b.text.length > 60 ? `${b.text.slice(0, 57)}…` : b.text)

/** What this mind would buy now, and why (a reason a player can check on the coin's feed). */
export function mindEntry(mind: TraderMind, w: SimWallet, pool: Token[], m: MarketState, rng: Rng): { t: Token; why: string } | undefined {
  const now = m.time
  const picks: { t: Token; why: string; score: number }[] = []
  for (const t of pool) {
    if (w.positions[t.id]) continue
    if (mind === 'narrative') {
      const b = line(t, now, MIND.fresh.narrative, (x) => x.src !== 'market' && x.tone === 'up' && GOOD.includes(x.kind))
      // (Not a coin whose story has already turned.)
      if (b && !line(t, now, MIND.fresh.narrative, (x) => x.kind === 'drama' || x.kind === 'fade')) picks.push({ t, why: `the story: ${short(b)}`, score: b.heat ?? 30 })
    } else if (mind === 'fomo') {
      const b = line(t, now, MIND.fresh.fomo, (x) => HYPE.includes(x.kind) && x.tone !== 'down')
      if (t.change['5m'] >= MIND.fomoRun) picks.push({ t, why: `it is up ${Math.round(t.change['5m'] * 100)}% in five minutes`, score: t.change['5m'] })
      else if (b) picks.push({ t, why: `everybody is on it: ${short(b)}`, score: 0.2 + (b.heat ?? 0) / 100 })
    } else if (mind === 'contrarian') {
      const b = line(t, now, MIND.fresh.contrarian, (x) => x.tone === 'down' && (x.kind === 'drama' || x.kind === 'bigsell' || x.kind === 'exit'))
      // (Fear, not a rug: a coin with an insider warning out is left alone.)
      if (b && t.change['5m'] <= MIND.fearDrop && t.riskLevel !== 'EXTREME' && !line(t, now, 300, (x) => x.kind === 'warn')) picks.push({ t, why: `buying the fear after: ${short(b)}`, score: -t.change['5m'] })
    } else if (mind === 'swing') {
      const c = t.change['5m']
      if (t.status === 'graduated' && t.liquidity >= MIND.swingPool && c >= MIND.swingDip[0] && c <= MIND.swingDip[1] && t.riskLevel !== 'EXTREME' && !line(t, now, 300, (x) => x.kind === 'warn')) picks.push({ t, why: `a ${Math.round(-c * 100)}% dip in a deep pool`, score: -c })
    }
  }
  if (!picks.length) return undefined
  // One of the strongest few: minds of a kind do not all land on the same coin in the same second.
  const top = picks.sort((a, b) => b.score - a.score).slice(0, 4)
  const p = rng.pick(top)
  return { t: p.t, why: p.why }
}

/** Whether this mind sells now, on top of its style's own exits: the share of the bag, and why. */
export function mindExit(mind: TraderMind, t: Token, pos: WalletPosition, pnlPct: number, held: number, m: MarketState): { frac: number; why: string } | null {
  const now = m.time
  // (Only lines that came after it bought: what it knew going in is not news.)
  const since = (fresh: number, ok: (b: Beat) => boolean) => {
    const b = line(t, now, Math.min(fresh, Math.max(0, held)), ok)
    return b
  }
  if (mind === 'panic') {
    const b = since(MIND.fresh.panic, (x) => BAD.includes(x.kind) && x.tone !== 'up')
    if (b) return { frac: 1, why: `panic: ${short(b)}` }
  } else if (mind === 'narrative') {
    const b = since(MIND.fresh.narrative, (x) => x.kind === 'drama' || x.kind === 'fade')
    if (b) return { frac: 1, why: `the story turned: ${short(b)}` }
  } else if (mind === 'contrarian') {
    const b = since(MIND.fresh.fomo, (x) => HYPE.includes(x.kind) && x.tone === 'up')
    if (b && pnlPct > 0.05) return { frac: 1, why: `selling into the hype: ${short(b)}` }
  } else if (mind === 'fomo') {
    if (pnlPct <= MIND.fomoCut) return { frac: 1, why: `gave up at ${Math.round(pnlPct * 100)}%` }
  } else if (mind === 'swing') {
    if (pnlPct >= MIND.swingOut[0]) return { frac: 1, why: `took the swing: +${Math.round(pnlPct * 100)}%` }
    if (pnlPct <= MIND.swingOut[1]) return { frac: 1, why: `stopped out at ${Math.round(pnlPct * 100)}%` }
  }
  void pos
  return null
}
