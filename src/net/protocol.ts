// Messages between the MOONRUSH multiplayer server and browsers. The server owns the shared market (coins, prices,
// bot wallets, posts, events); each browser owns its own wallet and sends its trades so everyone feels the impact.
import type { CandlePoint } from '../game/marketEngine'
import type { Candle, GameMode, MarketEngine, MarketEvent, MarketState, SimWallet, SocialPost, Timeframe, Token, VolumeBot, WalletAction } from '../types'

export const MP_PATH = '/mp'

export interface RoomPlayer {
  id: string
  name: string
  avatar: string
  level: number
  online: boolean
  // Round standing, reported by the player's own browser.
  equity: number
  startEquity: number
  trades: number
  wins: number
  finished?: boolean
  seasonPoints?: number // their real season points (sets the tier everyone sees for them)
  holdings?: MainHolding[] // what their public main wallet holds (side wallets stay hidden)
}

/** A coin in a player's main wallet, as everyone in the room can see it on-chain. */
export interface MainHolding {
  tokenId: string
  qty: number
  cost: number // USD cost basis
  openedAt: number // tick
}

export interface RoundInfo {
  id: number // increments every round in a room
  state: 'lobby' | 'running' | 'ended'
  mode: GameMode
  durationTicks: number | null // null = no limit
  startTick: number
  seed: number
  startTime: number // market time the round's market was created at
  engine?: MarketEngine // Classic (6x clock) or Realistic (real-time, pump.fun order flow)
}

/**
 * A coin as sent over the wire. On the server `creator: 'you'` means "a real player cooked it" (so the sim never
 * plays its dev); `creatorId` says which player. Each browser keeps `creator: 'you'` only on its own coins.
 */
export type NetToken = Token
export type NetMarket = Omit<MarketState, 'tokens'> & { tokens: NetToken[] }

export interface BotRun {
  vol: number
  cost: number
  event?: MarketEvent
}

// ─── Browser → server ────────────────────────────────────────────────────────
export type ClientMsg =
  | { t: 'hello'; name: string; avatar: string; level: number; playerId: string; room?: string; create?: boolean }
  | { t: 'start'; mode: GameMode; durationTicks: number | null; engine?: MarketEngine }
  // `main`: traded from your public main wallet (shows your name); otherwise it shows only `addr` (stealth side wallet).
  | { t: 'trade'; tokenId: string; side: 'buy' | 'sell'; usd: number; qty: number; addr?: string; main?: boolean }
  | { t: 'cook'; token: NetToken; candles?: Record<Timeframe, Candle[]>; event?: MarketEvent }
  | { t: 'patch'; tokenId: string; patch: Partial<Pick<Token, 'devPct' | 'bundlePct' | 'bundleWallets' | 'holders' | 'top10Pct' | 'hype' | 'bundleFlagged'>> }
  | { t: 'bot'; tokenId: string; bot: VolumeBot | null }
  | { t: 'status'; equity: number; startEquity: number; trades: number; wins: number; level: number; finished: boolean; protect: string[]; seasonPoints?: number; holdings?: MainHolding[] }
  | { t: 'candles'; tokenId: string }
  | { t: 'chat'; text: string }
  | { t: 'event'; event: MarketEvent } // something you did to your own coin (dev sells, bundle dumps)
  | { t: 'post'; text: string; tokenId?: string; followers: number; rep: number; repeats: number } // a post / call on the timeline

// ─── Server → browser ────────────────────────────────────────────────────────
/** A coin in a tick: `id` plus only the fields that changed since the last tick (`tape` = new trades only). */
export type TokenDiff = Partial<NetToken> & { id: string }
/** A bot wallet in a tick: only wallets that changed are sent; `trades` = new trades only. */
export type WalletDiff = Partial<SimWallet> & { id: string }

export interface TickMsg {
  t: 'tick'
  // Every live coin is listed (so order and delistings are known), each as a diff. A full refresh ("keyframe")
  // is sent every ~30s, and coins new to the market always arrive in full.
  market: Omit<NetMarket, 'tokens'> & { tokens: TokenDiff[] }
  wallets: WalletDiff[]
  events: MarketEvent[]
  posts: SocialPost[]
  actions: WalletAction[]
  points: Record<string, CandlePoint[]>
  newCandles: Record<string, Record<Timeframe, Candle[]>> // full history of coins that appeared this tick
  bots: Record<string, BotRun>
}

export type ServerMsg =
  | { t: 'welcome'; you: string; code: string; hostId: string; players: RoomPlayer[]; round: RoundInfo; market: NetMarket; wallets: SimWallet[]; posts: SocialPost[]; events: MarketEvent[] }
  | { t: 'players'; hostId: string; players: RoomPlayer[] }
  | { t: 'round'; round: RoundInfo; market?: NetMarket; wallets?: SimWallet[] }
  | TickMsg
  | { t: 'candles'; tokenId: string; candles: Record<Timeframe, Candle[]> | null }
  | { t: 'chat'; from: string; name: string; avatar: string; text: string; time: number }
  | { t: 'error'; message: string }
