// World bots: a crowd of labeled (🤖) players who trade the World next to real people. Each has a style, a real
// server wallet (same rules as everyone), comes and goes like a person, chats, posts calls, cooks coins, and goes
// broke sometimes. Each also has a public "mirror" wallet so players can track and copy-trade it.
import type { SimWallet, Token, WalletStyle } from '../src/types'
import type { Rng } from '../src/utils/rng'

export type BotStyle = 'sniper' | 'whale' | 'scalper' | 'diamond' | 'degen' | 'chef'

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
  cooked: Record<string, { mcap: number; tick: number }> // coins they launched: launch MC and tick
  busts: number
}

export interface BotSpec {
  id: string
  name: string
  avatar: string
  style: BotStyle
  always: boolean // always online
  followers: number
  rep: number
}

export const BOT_ROSTER: BotSpec[] = [
  { id: 'bot-sam', name: 'SniperSam 🤖', avatar: '🎯', style: 'sniper', always: true, followers: 12_000, rep: 55 },
  { id: 'bot-wendy', name: 'WhaleWendy 🤖', avatar: '🐋', style: 'whale', always: false, followers: 48_000, rep: 68 },
  { id: 'bot-pete', name: 'PaperPete 🤖', avatar: '📄', style: 'scalper', always: false, followers: 4_000, rep: 45 },
  { id: 'bot-dan', name: 'DiamondDan 🤖', avatar: '💎', style: 'diamond', always: false, followers: 21_000, rep: 60 },
  { id: 'bot-dana', name: 'DegenDana 🤖', avatar: '🦍', style: 'degen', always: true, followers: 9_000, rep: 40 },
  { id: 'bot-carl', name: 'ChefCarl 🤖', avatar: '👨‍🍳', style: 'chef', always: true, followers: 30_000, rep: 50 },
  // The second wave: enough of a crowd that the tape, the chat and the leaderboard always have someone on them.
  { id: 'bot-kai', name: 'KaiTrenches 🤖', avatar: '⛏️', style: 'sniper', always: true, followers: 7_500, rep: 52 },
  { id: 'bot-otto', name: 'ScalpOtto 🤖', avatar: '⚡', style: 'scalper', always: true, followers: 3_200, rep: 47 },
  { id: 'bot-tess', name: 'TessTenX 🤖', avatar: '🚀', style: 'degen', always: true, followers: 15_000, rep: 44 },
  { id: 'bot-mia', name: 'MoonMia 🤖', avatar: '🌙', style: 'degen', always: false, followers: 6_000, rep: 42 },
  { id: 'bot-rex', name: 'RugRex 🤖', avatar: '🦖', style: 'sniper', always: false, followers: 2_800, rep: 38 },
  { id: 'bot-luna', name: 'LunaLong 🤖', avatar: '🌕', style: 'diamond', always: false, followers: 18_000, rep: 62 },
  { id: 'bot-bea', name: 'BagholderBea 🤖', avatar: '🎒', style: 'diamond', always: false, followers: 1_900, rep: 35 },
  { id: 'bot-zed', name: 'ZedApe 🤖', avatar: '🐵', style: 'degen', always: false, followers: 5_400, rep: 41 },
  { id: 'bot-ivy', name: 'IvyWhale 🤖', avatar: '🐳', style: 'whale', always: false, followers: 36_000, rep: 66 },
  { id: 'bot-moe', name: 'MoeMomentum 🤖', avatar: '📈', style: 'whale', always: false, followers: 22_000, rep: 58 },
  { id: 'bot-gus', name: 'GasFeeGus 🤖', avatar: '⛽', style: 'scalper', always: false, followers: 2_100, rep: 43 },
  { id: 'bot-fin', name: 'FinFlipper 🤖', avatar: '🐬', style: 'scalper', always: false, followers: 4_600, rep: 49 },
  { id: 'bot-pip', name: 'PipSniper 🤖', avatar: '🏹', style: 'sniper', always: false, followers: 8_800, rep: 54 },
  { id: 'bot-nori', name: 'ChefNori 🤖', avatar: '🍣', style: 'chef', always: false, followers: 11_000, rep: 46 },
]

/** How each style trades: seconds between entry decisions, bag size (USD, share of cash), max bags, exits. */
export const STYLE: Record<BotStyle, { every: [number, number]; size: [number, number]; share: number; maxBags: number; tp: number; sl: number | null; hold: number | null; mirror: WalletStyle }> = {
  sniper: { every: [20, 60], size: [80, 250], share: 0.15, maxBags: 4, tp: 0.8, sl: 0.35, hold: 600, mirror: 'sniper' },
  whale: { every: [60, 180], size: [800, 2500], share: 0.3, maxBags: 3, tp: 0.4, sl: 0.2, hold: 1800, mirror: 'whale' },
  scalper: { every: [15, 45], size: [150, 500], share: 0.2, maxBags: 2, tp: 0.12, sl: 0.08, hold: 180, mirror: 'degen' },
  diamond: { every: [90, 240], size: [300, 800], share: 0.15, maxBags: 5, tp: 3, sl: null, hold: null, mirror: 'smart' },
  degen: { every: [30, 90], size: [100, 100], share: 0.35, maxBags: 3, tp: 1, sl: 0.5, hold: 1200, mirror: 'degen' },
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
