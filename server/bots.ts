// World bots: a crowd of labeled (🤖) players who trade the World next to real people. Each has a style, a real
// server wallet (same rules as everyone), comes and goes like a person, chats, posts calls, cooks coins, and goes
// broke sometimes. Each also has a public "mirror" wallet so players can track and copy-trade it.
import type { SimWallet, Token, WalletStyle } from '../src/types'
import { Rng } from '../src/utils/rng'
import type { ExitPlan, Tier } from './brainBots'

// Dumpers trade like snipers but sell big into the first pump; chefs launch coins and dump the dev bag.
export type BotStyle = 'sniper' | 'whale' | 'scalper' | 'diamond' | 'degen' | 'dumper' | 'chef'

export interface BotBrain {
  style: BotStyle
  nextAct: number // tick of the next entry decision
  switchAt: number // tick they come online / go offline next (always-on bots never switch)
  entries: Record<string, { tick: number; peak: number }> // when each bag was opened, and its best price since
  followers: number
  rep: number
  lastChat: number
  lastPost: number
  lastCook: number
  cooked: Record<string, { mcap: number; tick: number; dumpAt?: number }> // coins they launched: launch MC, tick, planned dev dump
  busts: number
  plans?: Record<string, ExitPlan> // bags bought from the market brain: how this bot means to get out
  streak?: number // wins (+) or losses (-) in a row: moves its mood
  fills?: number // every trade it ever made, and the sells that made money (its wallet keeps only the latest few)
  wins?: number
}

/** What makes one bot different from another of the same style and level. */
export interface Persona {
  size: number // bet size × (0.6 careful … 1.6 big)
  react: number // seconds between looks at the market
  patience: number // hold time × (0.6 jumpy … 1.6 patient)
  mistake: number // chance a decision is a bad one (chasing a top, selling too early)
  tilt: 'chase' | 'scared' // after a losing streak: bets bigger, or gets small
}
/** How a bot talks in chat. */
export interface Voice { caps: 'lower' | 'normal' | 'shout'; emoji: string[]; emojiRate: number; catchphrase: string; short: boolean }

export interface BotSpec {
  id: string
  name: string
  avatar: string
  style: BotStyle
  tier: Tier
  always: boolean // always online
  followers: number
  rep: number
  persona: Persona
  voice: Voice
}

// ─── The crowd: 100 bots, each its own person ───────────────────────────────
// Made from a fixed seed, so every restart gives the same names and personalities (wallets are saved per id). Don't
// reorder these lists: that would rename the crowd and leave the old bots' saved wallets behind.
const FIRST = ['jay', 'mo', 'lexi', 'dre', 'kenzo', 'rina', 'theo', 'nova', 'bash', 'ivy', 'ozzy', 'pia', 'remy', 'tara', 'vic', 'yuki', 'zane', 'cleo', 'dex', 'faye', 'gio', 'hana', 'ike', 'juno', 'kip', 'lola', 'milo', 'nia', 'otis', 'quin', 'rio', 'sage', 'tobi', 'uma', 'vik', 'wren', 'xan', 'yara', 'zuri', 'ash', 'bo', 'cass', 'dax', 'eli', 'fitz', 'gwen', 'hux', 'iris', 'jett', 'kai']
const TRADE = ['apes', 'flips', 'snipes', 'holds', 'jeets', 'pumps', 'bags', 'scalps', 'moons', 'rugs', 'chads', 'cooks', 'dumps', 'trenches', 'degens', 'grinds', 'bids', 'fades', 'charts', 'yolos']
const STYLE_WORDS: Record<BotStyle, string[]> = {
  sniper: ['sniper', 'firstblock', 'early', 'launchhunter', 'zerosec'],
  whale: ['whale', 'bigbag', 'deeppockets', 'sizeking', 'heavybid'],
  scalper: ['scalp', 'quickflip', 'inout', 'tapemaxi', 'fastfinger'],
  diamond: ['diamond', 'neverselling', 'hodl', 'convicted', 'longterm'],
  degen: ['degen', 'fullport', 'yolo', 'gambler', 'sendit'],
  dumper: ['jeet', 'dumpster', 'exitliq', 'takeprofit', 'rugpuller'],
  chef: ['chef', 'cooker', 'devmode', 'launcher', 'kitchen'],
}
const AVATARS = ['🦊', '🐸', '🐺', '🦁', '🐯', '🐻', '🐼', '🐨', '🐙', '🦈', '🐬', '🦄', '🐲', '👽', '🤠', '😎', '🧙', '🥷', '🧛', '👻', '💀', '🤡', '🎩', '🎲', '🎰', '🔥', '⚡', '🌊', '🌵', '🍄', '🌶️', '🍕', '🍩', '🧃', '🛸', '🚀', '💎', '🪙', '📈', '🧨']
const EMOJI = [['🚀', '🔥'], ['💀', '😭'], ['🫡', '💯'], ['👀', '🤔'], ['💰', '🤑'], ['🐸', '🦍'], ['😤', '😮‍💨'], ['🙏', '✨'], ['📉', '🩸'], ['🍀', '🎰']]
const CATCH = ['lfg', 'ngmi', 'wagmi', 'trust the process', 'not financial advice', 'we ride', 'send it', 'cope', 'ez', 'gg', 'stay poor', 'dyor', 'few understand', 'its so over', 'we are so back', 'probably nothing', 'bullish', 'down bad', 'bag secured', 'up only']
// How many of each style, and the skill mix: most people lose, a few win big (like the real market).
const MIX: [BotStyle, number][] = [['sniper', 22], ['scalper', 20], ['degen', 18], ['diamond', 12], ['whale', 8], ['dumper', 10], ['chef', 10]]
const TIER_POOL: Tier[] = ['pro', 'good', 'good', 'average', 'average', 'average', 'average', 'bad', 'bad', 'degen']
const MISTAKES: Record<Tier, number> = { pro: 0.02, good: 0.04, average: 0.07, bad: 0.12, degen: 0.2 }
const FOLLOWERS: Record<Tier, [number, number]> = { pro: [20_000, 60_000], good: [8_000, 25_000], average: [1_500, 9_000], bad: [500, 4_000], degen: [200, 3_000] }
const REP: Record<Tier, [number, number]> = { pro: [60, 75], good: [52, 64], average: [42, 54], bad: [32, 44], degen: [25, 40] }

function makeRoster(): BotSpec[] {
  const rng = new Rng(0x6d6f6f6e) // fixed: same crowd every boot
  const out: BotSpec[] = []
  const used = new Set<string>()
  let n = 0
  for (const [si, [style, count]] of MIX.entries()) {
    for (let i = 0; i < count; i++, n++) {
      // Each style walks the whole skill pool, starting at a different place, so every style gets every level.
      const tier = TIER_POOL[(i + si * 3) % TIER_POOL.length]
      let handle = ''
      for (let k = 0; !handle || used.has(handle); k++) {
        const first = FIRST[rng.int(0, FIRST.length - 1)]
        const pattern = rng.int(0, 3)
        const word = pattern === 0 ? TRADE[rng.int(0, TRADE.length - 1)] : STYLE_WORDS[style][rng.int(0, STYLE_WORDS[style].length - 1)]
        handle = pattern === 1 ? `${word}${first}` : pattern === 2 ? `${first}_${word}` : pattern === 3 ? `${first}${word}${rng.int(1, 99)}` : `${first}${word}`
        if (k > 20) handle = `${handle}${n}`
      }
      used.add(handle)
      const sniperish = style === 'sniper' || style === 'dumper'
      out.push({
        id: `bot-${handle.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
        name: `${handle} 🤖`,
        avatar: AVATARS[rng.int(0, AVATARS.length - 1)],
        style, tier,
        always: rng.chance(0.12),
        followers: rng.int(...FOLLOWERS[tier]),
        rep: rng.int(...REP[tier]),
        persona: {
          size: Math.round(rng.range(0.6, 1.6) * 100) / 100,
          react: sniperish ? rng.int(2, 6) : style === 'scalper' ? rng.int(3, 10) : rng.int(6, 25),
          patience: Math.round(rng.range(0.6, 1.6) * 100) / 100,
          mistake: MISTAKES[tier] * rng.range(0.6, 1.4),
          tilt: tier === 'pro' || tier === 'good' ? (rng.chance(0.8) ? 'scared' : 'chase') : rng.chance(0.7) ? 'chase' : 'scared',
        },
        voice: {
          caps: rng.chance(0.55) ? 'lower' : rng.chance(0.75) ? 'normal' : 'shout',
          emoji: EMOJI[rng.int(0, EMOJI.length - 1)],
          emojiRate: Math.round(rng.range(0, 0.7) * 100) / 100,
          catchphrase: CATCH[rng.int(0, CATCH.length - 1)],
          short: rng.chance(0.35),
        },
      })
    }
  }
  return out
}

/** Everyone in the crowd; WORLD_BOTS (e.g. 20) runs fewer of them. */
export const ALL_BOTS: BotSpec[] = makeRoster()
export const BOT_ROSTER: BotSpec[] = ALL_BOTS.slice(0, Math.max(0, Math.min(ALL_BOTS.length, Number(process.env.WORLD_BOTS ?? ALL_BOTS.length) || 0)))
export const BOT_BY_ID = new Map(BOT_ROSTER.map((s) => [s.id, s]))

/** A chat line said the way this bot talks. */
export function inVoice(spec: BotSpec | undefined, text: string, rng: Rng) {
  if (!spec) return text
  const v = spec.voice
  let s = v.short && text.length > 28 && rng.chance(0.5) ? text.split(/[,.]/)[0] : text
  if (rng.chance(0.08)) s = `${s}, ${v.catchphrase}`
  if (rng.chance(v.emojiRate)) s = `${s} ${v.emoji[rng.int(0, v.emoji.length - 1)]}`
  return v.caps === 'lower' ? s.toLowerCase() : v.caps === 'shout' && rng.chance(0.4) ? s.toUpperCase() : s
}

/** How each style trades: seconds between entry decisions, bag size (USD, share of cash), max bags, exits. */
export const STYLE: Record<BotStyle, { every: [number, number]; size: [number, number]; share: number; maxBags: number; tp: number; sl: number | null; hold: number | null; mirror: WalletStyle }> = {
  sniper: { every: [20, 60], size: [80, 250], share: 0.15, maxBags: 4, tp: 0.8, sl: 0.35, hold: 600, mirror: 'sniper' },
  whale: { every: [60, 180], size: [800, 2500], share: 0.3, maxBags: 3, tp: 0.4, sl: 0.2, hold: 1800, mirror: 'whale' },
  scalper: { every: [15, 45], size: [150, 500], share: 0.2, maxBags: 2, tp: 0.12, sl: 0.08, hold: 180, mirror: 'degen' },
  diamond: { every: [90, 240], size: [300, 800], share: 0.15, maxBags: 5, tp: 3, sl: null, hold: null, mirror: 'smart' },
  degen: { every: [30, 90], size: [100, 100], share: 0.35, maxBags: 3, tp: 1, sl: 0.5, hold: 1200, mirror: 'degen' },
  dumper: { every: [20, 60], size: [150, 600], share: 0.25, maxBags: 3, tp: 0.3, sl: 0.3, hold: 300, mirror: 'sniper' },
  chef: { every: [900, 1800], size: [0, 0], share: 0, maxBags: 0, tp: 0, sl: null, hold: null, mirror: 'fresh' },
}

export const BOT_BUST_USD = 25 // below this (and no bags) a bot is broke…
export const BOT_RESTART_USD = 1_000 // …and restarts small

export const freshBrain = (spec: BotSpec, tick: number, rng: Rng): BotBrain => ({
  style: spec.style, nextAct: tick + rng.int(5, 40), switchAt: tick + rng.int(600, 2400), entries: {}, followers: spec.followers, rep: spec.rep,
  lastChat: tick - rng.int(0, 300), lastPost: tick - 300, lastCook: tick - rng.int(600, 1200), cooked: {}, busts: 0,
})

/** A bot's public wallet as trader wallets show it (tracking, copy trading, the wallet page). */
export function mirrorWallet(spec: BotSpec, start: number): SimWallet {
  const zero = { pnl24h: 0, pnl7d: 0, wins: 0, losses: 0, buys: 0, sells: 0, volume: 0, inflow: 0 }
  return {
    id: spec.id, name: spec.name, avatar: spec.avatar, style: STYLE[spec.style].mirror, skill: 0.5, cash: start, startValue: start,
    positions: {}, trades: [], base: { ...zero }, live: { ...zero }, lastActive: 0, bot: true,
  }
}

const live = (t: Token) => t.status === 'bonding' || t.status === 'graduated'

/** The coin a style wants to buy right now (or none). */
export function pickCoin(style: BotStyle, tokens: Token[], now: number, held: Set<string>, rng: Rng): Token | undefined {
  const ok = tokens.filter((t) => live(t) && !held.has(t.id) && t.liquidity > 2_000 && t.riskLevel !== 'EXTREME')
  const pick = (list: Token[]) => (list.length ? list[rng.int(0, Math.min(list.length, 4) - 1)] : undefined)
  switch (style) {
    case 'sniper':
    case 'dumper':
      return pick(ok.filter((t) => t.status === 'bonding' && now - t.createdAt < 120).sort((a, b) => b.createdAt - a.createdAt))
    case 'whale':
      return pick(ok.filter((t) => t.status === 'graduated' && t.mcap > 200_000 && t.change['5m'] > 0).sort((a, b) => b.mcap - a.mcap))
    case 'scalper':
      return pick(ok.filter((t) => t.change['5m'] > 15).sort((a, b) => b.change['5m'] - a.change['5m']))
    case 'diamond':
      return pick(ok.filter((t) => t.hype > 60 && t.mcap < 500_000).sort((a, b) => b.hype - a.hype))
    case 'degen':
      return pick([...ok].sort((a, b) => b.change['5m'] - a.change['5m']).slice(0, 5))
    default:
      return undefined
  }
}

// ─── Chat ────────────────────────────────────────────────────────────────────
const LINES: Record<string, string[]> = {
  buy: ['aped $T 🦍', 'in $T, lfg', 'bought some $T, chart looks clean', 'small bag of $T 👀', '$T sending? im in', 'starter bag of $T', 'ok fine i bought $T', '$T dip looked too good', 'adding $T here'],
  snipe: ['sniped $T at launch 🎯', 'first block on $T', 'early on $T, lets see', 'got $T under 10k mc', '$T fresh out the oven, im in'],
  whale: ['loaded up on $T 🐋', 'size in $T. dont fade me', 'accumulating $T'],
  win: ['took profit on $T +P% 💰', '$T paid +P%, ty', 'out of $T +P%. easy', 'secured the bag on $T (+P%)', '+P% on $T, ill take it', '$T printed. +P%', 'sold $T +P%, watch it double now lol'],
  loss: ['cut $T -P% 🩸', '$T rugged me -P%', 'paper handed $T -P%, next', 'stop loss hit on $T', '$T -P%. pain', 'never buying $T again (-P%)', 'exit liquidity on $T again 🤡'],
  cook: ['just cooked $T 🍳 dev is based', '$T is live, fair launch fr', 'new coin $T, get in early 👨‍🍳'],
  devsell: ['took some off $T, still believe 🫡', 'dev wallet needs gas money, $T'],
  bust: ['rekt 💀 starting over with $1k', 'account blown. back to $1k', 'gg. $0. restarting'],
  idle: ['market kinda slow rn', 'who is in something good?', 'sol trenches cooking today', 'anyone watching the graduates?', 'gm', 'lfg world 🌍', 'patience pays', 'new pairs looking spicy', 'whats the play', 'need one good runner today', 'who cooked that last one lol', 'leaderboard looking tight this week', 'anyone else get rugged this morning', 'trenches never sleep'],
  // Calling out what the market is doing.
  hype: ['$T up P% in 5m 👀', 'who is in $T?? +P%', '$T is sending rn (+P%)', 'missed $T, already +P% 😭', '$T chart is crazy'],
  // Answers to real players, so nobody talks to an empty room.
  gm: ['gm', 'gm 🫡', 'gm gm', 'gm, what are we buying'],
  reply: ['fr', 'lol true', 'real', 'same tbh', 'facts', '👀', 'lfg', 'wagmi', 'big if true', 'haha', 'not financial advice 🤖'],
  coin: ['watching $T too 👀', '$T? might take a look', 'how early are you on $T', 'careful with $T, check the dev', 'i like $T ngl'],
  ask: ['new pairs in trenches are moving', 'check the final stretch column', 'im mostly sniping launches today', 'top gainers on discover, 5m', 'depends, how much risk you want lol'],
}

export function chatLine(kind: keyof typeof LINES, rng: Rng, ticker = '', pct = 0) {
  const arr = LINES[kind]
  return arr[rng.int(0, arr.length - 1)].replace('$T', `$${ticker}`).replace('P%', `${Math.round(Math.abs(pct * 100))}%`)
}
