// Messages between the MOONRUSH multiplayer server and browsers. The server owns the shared market (coins, prices,
// bot wallets, posts, events) and every player's wallets; browsers send orders and show the results instantly.
import type { CandlePoint } from '../game/marketEngine'
import type { WalletLayout, WalletState } from '../game/orders'
import type { Asset } from '../game/tradingEngine'
import type { Chain, TradeSetting } from '../types'
import type { Candle, GameMode, LaunchStyle, MarketEngine, MarketEvent, MarketState, SimWallet, SocialPost, Timeframe, Token, VolumeBot, WalletAction } from '../types'

export const MP_PATH = '/mp'

/** The one public room everyone plays in (always on, never resets). Private rooms use random 5-letter codes. */
export const WORLD_CODE = 'WORLD'
/** What a new player starts with in the World (USD). */
export const WORLD_START_BALANCE = 10_000
/** Going broke in the World: below this net worth you can restart with `WORLD_RESTART_BALANCE`, once every `WORLD_RESTART_EVERY_MS`. */
export const WORLD_BROKE_BELOW = 250
export const WORLD_RESTART_BALANCE = 1_000
export const WORLD_RESTART_EVERY_MS = 24 * 3600_000

/** A chat message someone reported, as the admin sees it. */
export interface ChatReport {
  id: number
  at: number // real time (ms)
  by: { id: string; name: string }
  target: { id: string; name: string }
  text: string
  context: string[] // the reported player's messages around it
  count: number // how many different players reported this message
}

/** One player on the World leaderboards. */
export interface BoardRow {
  id: string
  name: string
  avatar: string
  level: number
  online: boolean
  verified?: boolean
  bot?: boolean
  equity: number // net worth now (USD + coins + bags)
  pnl: number // all-time profit: net worth minus everything put in
  week: number // profit since this week began (or since they joined, if later)
  day: number // profit today (UTC)
  season: number // profit this season (the calendar month)
  chains: Record<Chain, number> // realized profit this season on each chain's coins
  dev?: DevStats // coins they've launched in the World
  trophies?: string[] // season awards, e.g. "🏆 S1"
  restarts: number // bankruptcy restarts taken
}
/** A dev's record in the World (lifetime, and this season). */
export interface DevStats {
  cooked: number
  migrated: number
  fees: number // creator fees + graduation bonuses earned (USD)
  bestAth: number // best all-time-high market cap of a coin they launched
  bestTicker?: string
  season: { cooked: number; migrated: number; fees: number }
}
/** One finished season: who won what. */
export interface HallEntry {
  n: number
  name: string // "October 2026"
  winners: { list: BoardList; name: string; avatar: string; value: number; bot?: boolean }[]
}
export type BoardList = 'worth' | 'day' | 'week' | 'season' | 'sol' | 'bsc' | 'hood' | 'dev'
/** The World leaderboards: the top of each list, where you stand, and when you may next restart. */
export interface BoardMsg {
  t: 'board'
  list: BoardList // which ranking `rows` is
  week: number // the week number
  season: { n: number; name: string; endsAt: number }
  total: number // players ranked
  rows: BoardRow[] // the top 100 of that list
  me?: { row: BoardRow; rank: number; restartAt: number | null } // restartAt: real time (ms) you can next restart, null = now
  hall: HallEntry[] // past seasons' winners, newest first
}

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
  bot?: boolean // a World bot (labeled 🤖): trades by the same rules, with its own wallet
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
  | { side: 'buy'; tokenId: string; walletIds: string[]; usdEach: number; setting?: TradeSetting; autoSwap?: boolean; kol?: { followers: number; rep: number } } // kol: your followers copy you
  | { side: 'sell'; tokenId: string; legs: { walletId: string; qty: number }[]; setting?: TradeSetting }
/** A swap inside one wallet, or moving a coin between two of your wallets. */
export type OpMsg =
  | { kind: 'swap'; from: Asset; to: Asset; amount: number; walletId: string }
  | { kind: 'transfer'; fromId: string; toId: string; chain: Chain; amount: number }
  | { kind: 'convert'; from: Asset; to: Asset; amount: number; fromWallet: string; toWallet: string } // any asset / wallet → any asset / wallet
  | { kind: 'claimFees'; tokenIds?: string[] } // creator fees from your coins' vaults, into each coin's dev wallet
  | { kind: 'cashback'; chains: Chain[]; as: 'coin' | 'usdc' }
  | { kind: 'bankrupt' } // World: broke, start over with the restart balance (once a day)

/** What a launch costs and buys: the server charges it and runs the dev buy / bundle on your wallet. */
export interface CookMoney {
  devWallet: string
  devBuy: number // chain coin
  bundle?: { wallets: number; perWallet: number; stagger: boolean }
  marketing: number // USD
  autoSwap?: boolean
  style?: LaunchStyle // the server builds the coin itself from your choices (see Room.cook)
}

// ─── Browser → server ────────────────────────────────────────────────────────
export type ClientMsg =
  // `token`: your login (signed-in players); the server checks it and uses your account name.
  // `key`: a guest's private seat key (kept in this browser, never shown to others); only it can rejoin as that guest.
  | { t: 'hello'; name: string; avatar: string; level: number; playerId: string; room?: string; create?: boolean; token?: string; key?: string }
  | { t: 'start'; mode: GameMode; durationTicks: number | null; engine?: MarketEngine }
  // `token` is the fresh coin before any buys; the server runs your dev buy / bundle (`money`) on it as order `ref`.
  | { t: 'cook'; token: NetToken; candles?: Record<Timeframe, Candle[]>; event?: MarketEvent; seq?: number; ref?: number; money?: CookMoney }
  | { t: 'patch'; tokenId: string; patch: Partial<Pick<Token, 'devPct' | 'bundlePct' | 'bundleWallets' | 'holders' | 'top10Pct' | 'hype' | 'bundleFlagged'>> }
  | { t: 'bot'; tokenId: string; bot: VolumeBot | null }
  | { t: 'status'; equity: number; startEquity: number; trades: number; wins: number; level: number; finished: boolean; protect: string[]; seasonPoints?: number; holdings?: MainHolding[]; addrs?: string[]; cbVolume?: number; cbAuto?: 'off' | 'coin' | 'usdc' }
  | { t: 'candles'; tokenId: string }
  | { t: 'board'; list?: BoardList } // World: ask for one leaderboard
  // Report a chat message to the admins (`from` + `time` + `text` say which one).
  | { t: 'report'; from: string; time: number; text: string }
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
  // A post / call on the timeline. The server keeps your followers and reputation itself (see `social` below):
  // `followers` / `rep` are only read once, to start a friends room from your own profile; the World ignores them.
  | { t: 'post'; text: string; tokenId?: string; followers: number; rep: number; repeats: number }

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
  // `reset`: an admin wiped your wallet back to the start (applied right away, trade history cleared).
  | { t: 'wallet'; ack: number; state: WalletState; ref?: number; fills?: import('../types').Trade[]; failures?: string[]; reset?: boolean; note?: string }
  | BoardMsg
  // Your followers and reputation as the server has them, sent when you join and whenever they change (a post, a
  // call being judged: `results`). The World keeps its own count from a fresh start; a friends room starts from yours.
  | { t: 'social'; social: import('../types').SocialProfile; results?: import('../game/socialEngine').CallResult[] }
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
