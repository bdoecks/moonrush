// Messages between the MOONRUSH multiplayer server and browsers. The server owns the shared market (coins, prices,
// bot wallets, posts, events) and every player's wallets; browsers send orders and show the results instantly.
import type { CandlePoint } from '../game/marketEngine'
import type { WalletLayout, WalletState } from '../game/orders'
import type { Asset } from '../game/tradingEngine'
import type { Chain, TradeSetting } from '../types'
import type { Candle, GameMode, MarketEngine, MarketEvent, MarketState, SimWallet, SocialPost, Timeframe, Token, VolumeBot, WalletAction } from '../types'

export const MP_PATH = '/mp'

/** The one public room everyone plays in (always on, never resets). Private rooms use random 5-letter codes. */
export const WORLD_CODE = 'WORLD'
/** What a new player starts with in the World (USD). */
export const WORLD_START_BALANCE = 10_000

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
  verified?: boolean // signed in: the server confirmed this is their account
  spectator?: boolean // World guests: watching only (not listed, can't trade or chat)
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
  world?: boolean // the public World: one round that never ends
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
  stop?: string // the server stopped it (dev wallet out of coin, budget used up)
}

// ─── Wallets run by the server (rooms) ───────────────────────────────────────
/** A buy or sell for the server to run on your wallets (it's the judge; your screen shows it instantly). */
export type OrderMsg =
  | { side: 'buy'; tokenId: string; walletIds: string[]; usdEach: number; setting?: TradeSetting; autoSwap?: boolean }
  | { side: 'sell'; tokenId: string; legs: { walletId: string; qty: number }[]; setting?: TradeSetting }
/** A swap inside one wallet, or moving a coin between two of your wallets. */
export type OpMsg =
  | { kind: 'swap'; from: Asset; to: Asset; amount: number; walletId: string }
  | { kind: 'transfer'; fromId: string; toId: string; chain: Chain; amount: number }
  | { kind: 'claimFees'; tokenIds?: string[] } // creator fees from your coins' vaults, into each coin's dev wallet
  | { kind: 'cashback'; chains: Chain[]; as: 'coin' | 'usdc' }

/** What a launch costs and buys: the server charges it and runs the dev buy / bundle on your wallet. */
export interface CookMoney {
  devWallet: string
  devBuy: number // chain coin
  bundle?: { wallets: number; perWallet: number; stagger: boolean }
  marketing: number // USD
  autoSwap?: boolean
}

// ─── Browser → server ────────────────────────────────────────────────────────
export type ClientMsg =
  // `token`: your login (signed-in players); the server checks it and uses your account name.
  | { t: 'hello'; name: string; avatar: string; level: number; playerId: string; room?: string; create?: boolean; token?: string }
  | { t: 'start'; mode: GameMode; durationTicks: number | null; engine?: MarketEngine }
  // `token` is the fresh coin before any buys; the server runs your dev buy / bundle (`money`) on it as order `ref`.
  | { t: 'cook'; token: NetToken; candles?: Record<Timeframe, Candle[]>; event?: MarketEvent; seq?: number; ref?: number; money?: CookMoney }
  | { t: 'patch'; tokenId: string; patch: Partial<Pick<Token, 'devPct' | 'bundlePct' | 'bundleWallets' | 'holders' | 'top10Pct' | 'hype' | 'bundleFlagged'>> }
  | { t: 'bot'; tokenId: string; bot: VolumeBot | null }
  | { t: 'status'; equity: number; startEquity: number; trades: number; wins: number; level: number; finished: boolean; protect: string[]; seasonPoints?: number; holdings?: MainHolding[]; addrs?: string[]; cbVolume?: number; cbAuto?: 'off' | 'coin' | 'usdc' }
  | { t: 'candles'; tokenId: string }
  // Wallets (rooms). `seq` numbers every wallet message so the game knows which server answers are up to date.
  | { t: 'order'; seq: number; ref: number; order: OrderMsg }
  | { t: 'op'; seq: number; op: OpMsg }
  | { t: 'layout'; seq: number; layout: WalletLayout }
  | { t: 'chat'; text: string }
  // Your airdrop: `qty` leaves your dev wallet `walletId` for `wallets` recipients; `queue` = the ones who'll dump.
  | { t: 'airdrop'; seq?: number; tokenId: string; queue: NonNullable<MarketState['shillQueue']>; walletId?: string; qty?: number; wallets?: number; target?: 'holders' | 'fresh' }
  | { t: 'event'; event: MarketEvent } // something you did to your own coin (dev sells, bundle dumps)
  // Send coins to another player: to their main wallet (`to` = player id) or to any wallet address they gave you.
  | { t: 'send'; ref: number; to?: string; toAddr?: string; asset: SendAsset; amount: number; usd: number; main: boolean; fromAddr: string; fromWallet?: string }
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
  | { t: 'welcome'; you: string; code: string; hostId: string; players: RoomPlayer[]; round: RoundInfo; market: NetMarket; wallets: SimWallet[]; posts: SocialPost[]; events: MarketEvent[]; spectator?: boolean }
  | { t: 'players'; hostId: string; players: RoomPlayer[] }
  | { t: 'round'; round: RoundInfo; market?: NetMarket; wallets?: SimWallet[] }
  | TickMsg
  | { t: 'candles'; tokenId: string; candles: Record<Timeframe, Candle[]> | null }
  | { t: 'chat'; from: string; name: string; avatar: string; text: string; time: number }
  | { t: 'error'; message: string }
  // Admin: a message for everyone, being removed from the room, or money added to your round.
  | { t: 'notice'; text: string }
  // Your wallets as the server has them, after it handled your message number `ack` (and the order `ref`'s fills).
  | { t: 'wallet'; ack: number; state: WalletState; ref?: number; fills?: import('../types').Trade[]; failures?: string[] }
  | { t: 'kicked'; reason: string }
  | { t: 'grant'; usd: number; asset?: 'usd' | 'sol' | 'bsc' | 'hood'; amount?: number }
  | { t: 'sendResult'; ref: number; ok: boolean; error?: string; toName?: string }
  | TransferMsg

export type SendAsset = 'sol' | 'bsc' | 'hood' | 'usdc'

/** Coins arriving from another player. `from` is their name for a main-wallet send, else just the sending address. */
export interface TransferMsg {
  t: 'recv'
  from: string
  fromPid?: string
  asset: SendAsset
  amount: number
  usd: number
  toAddr?: string // which of your wallets (none = main)
}
